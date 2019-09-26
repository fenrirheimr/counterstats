/*jslint node: true */
"use strict";
const db = require('ocore/db.js');
const request = require('request');
const async = require('async');
const crypto = require('crypto');
const mutex = require('ocore/mutex.js');



const heightAboveCatchup = 596000;


const confirmationsBeforeIndexing = 3;

(async function(){
	await db.query("CREATE TABLE IF NOT EXISTS btc_addresses (\n\
	address VARCHAR(70) PRIMARY KEY, \n\
	wallet_id INTEGER)");
	await db.query("CREATE INDEX IF NOT EXISTS byWalletId ON btc_addresses(wallet_id)");

	await db.query("CREATE TABLE IF NOT EXISTS redirections (\n\
		from_id INTEGER PRIMARY KEY, \n\
		to_id INTEGER)");

	await db.query("CREATE TABLE IF NOT EXISTS btc_wallets (\n\
		id INTEGER PRIMARY KEY AUTOINCREMENT, \n\
		wallet CHAR(40) UNIQUE)");

	await db.query("CREATE TABLE IF NOT EXISTS transactions (\n\
		id INTEGER PRIMARY KEY AUTOINCREMENT, \n\
		tx_id CHAR(64) UNIQUE NOT NULL,\n\
		block_height INTEGER NOT NULL\n\
		)");
	await db.query("CREATE TABLE IF NOT EXISTS transactions_from (\n\
		id INTEGER PRIMARY KEY, \n\
		wallet_id INTEGER NOT NULL,\n\
		amount INTEGER NOT NULL)");
	await db.query("CREATE INDEX IF NOT EXISTS fromByWalletId ON transactions_from(wallet_id)");

	await db.query("CREATE TABLE IF NOT EXISTS transactions_to (\n\
		id INTEGER, \n\
		wallet_id INTEGER,\n\
		address VARCHAR(70),\n\
		amount INTEGER NOT NULL)");
	await db.query("CREATE INDEX IF NOT EXISTS toByWalletId ON transactions_to(wallet_id)");
	await db.query("CREATE INDEX IF NOT EXISTS toByAddress ON transactions_to(address)");

	await db.query("CREATE TABLE IF NOT EXISTS processed_blocks (\n\
		block_height INTEGER  PRIMARY KEY, \n\
		block_time INTEGER,\n\
		tx_index INTEGERNOT NULL )")
	await db.query("REPLACE INTO processed_blocks (block_height,tx_index) VALUES ("+ (process.env.testnet || process.env.devnet ? 590000 : 0 )+",0)");
	if (process.env.delete)
		await db.query("PRAGMA journal_mode=DELETE");
	else
		await db.query("PRAGMA journal_mode=WAL");

})();

getLastHeightThenProcess();
setInterval(getLastHeightThenProcess, 60000);

function getLastHeightThenProcess(){
	getLastBlockHeight(function(error, last_block_height){
		if (error)
			return error;
		processToBlock(last_block_height - confirmationsBeforeIndexing);
	});
}

function processToBlock(to_block_height){
	mutex.lockOrSkip(["process"], async function(unlock){
		const rows = await db.query("SELECT MAX(block_height) as height,tx_index FROM processed_blocks");
		console.error("catchup from block " + rows[0].height + " tx index " + rows[0].tx_index);
		if (rows[0].height >= to_block_height)
			return;

		var nextBlock = await downloadNextWhileProcessing(rows[0].height, rows[0].tx_index);
		for (var i = rows[0].height+1; i<=to_block_height; i++){
			if (i % 200 == 0){
				await db.query("VACUUM");
				console.error("db vaccumed");
			}
			nextBlock = await	downloadNextWhileProcessing(i, 0, nextBlock);
		}
		unlock();
	});
}

async function processBlock(objBlock, start_tx_index, handle){
		var block_start_time = Date.now();
		console.error("block " + objBlock.height + " txs in this block: " + objBlock.tx.length + " start_tx_index " + start_tx_index);
		objBlock.tx.sort(function(a,b){
			if (a.hash > b.hash)
				return 1;
			else
				return -1;
		});

		async.eachOfSeries(objBlock.tx,  function(tx, tx_index, callback){
			if (tx_index <start_tx_index)
				return callback();
			var input_addresses = [];
			var value_in = 0;
			tx.inputs.forEach(function(input){
				if (!input.prev_out || !input.prev_out.addr) // coinbase
					return;
				input_addresses.push(input.prev_out.addr);
				value_in+=input.prev_out.value;
			})
			input_addresses = [...new Set(input_addresses)];
			input_addresses.sort();
			var wallets = [];
			input_addresses.forEach(function(address){
				wallets.push(crypto.createHash("ripemd160").update(address, "utf8").digest().toString('hex'));
			})
			wallets.sort();

			var outputs = [];
			tx.out.forEach(function(output){
				if (output.addr)
					outputs.push({address: output.addr, value:output.value});
			});
			if (input_addresses.length == 0){ // coinbase
				(async function(){
					await saveTransactions(tx.hash, objBlock.height, null ,value_in,outputs)
				})();
				return callback();
			}
			//it looks eachOfSeries doesn't work serially anymore with async function, so we wrap in anonymous function
			(async function(){
				await Promise.all([saveInputAddresses(input_addresses, wallets[0]), saveTransactions(tx.hash, objBlock.height, wallets[0],value_in,outputs)]);
				await mergeWallets(input_addresses, objBlock.height,objBlock.time, tx_index);// we merge these input addresses in the wallet id that has already the most addresses and set up redirections
				callback()	
			})();
		}, function(){
			var processingTime = Date.now()-block_start_time;
			console.error("block " + objBlock.height + " processed in " + processingTime +'ms, ' + (processingTime/objBlock.tx.length).toFixed(4) + " ms per transaction");
			return handle();
		});
}

function saveTransactions(tx_id, height, from_wallet, value_in, outputs){
	return new Promise(function(resolve){
		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN TRANSACTION");
			conn.addQuery(arrQueries,"REPLACE INTO transactions (tx_id, block_height) VALUES (?,?)",[tx_id, height]);
			if (from_wallet)
				conn.addQuery(arrQueries,"REPLACE INTO transactions_from (id, wallet_id,amount) VALUES (last_insert_rowid(),(SELECT id FROM btc_wallets WHERE wallet=?),?)",[from_wallet, value_in]);
			for (var i=0; i<outputs.length; i++){
				conn.addQuery(arrQueries,"REPLACE INTO transactions_to(id, wallet_id, address, amount) \n\
				VALUES ((SELECT id FROM transactions WHERE tx_id=?), (SELECT wallet_id FROM btc_addresses WHERE address=?),?,?)",[tx_id, outputs[i].address, outputs[i].address, outputs[i].value]);
			}
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
				resolve();
			});
		});
	});
}

function saveInputAddresses(input_addresses, wallet){
	return new Promise(function(resolve){
		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN TRANSACTION");
			conn.addQuery(arrQueries,"INSERT OR IGNORE INTO btc_wallets (wallet) VALUES (?)", [wallet]);
			for (var i=0; i< input_addresses.length; i++){
				conn.addQuery(arrQueries,"INSERT OR IGNORE INTO btc_addresses (wallet_id, address) VALUES ((SELECT id FROM btc_wallets WHERE wallet=?),?)",[wallet,input_addresses[i]]);
			}
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
				resolve();
			});
		});
	});
}

function mergeWallets(input_addresses,block_height, block_time, tx_index){
	return new Promise(function(resolve){
		if (input_addresses.length > 1){
			db.takeConnectionFromPool(async function(conn) {
				var InputaddressesSqlString = input_addresses.join("','");
				var rows =  await conn.query("SELECT COUNT(ROWID) as count,wallet_id FROM btc_addresses INDEXED BY byWalletId WHERE wallet_id \n\
				IN(SELECT DISTINCT(wallet_id) FROM btc_addresses \n\
					WHERE address IN('"+InputaddressesSqlString+"'))\n\
				GROUP BY wallet_id ORDER BY count DESC,wallet_id ASC"); 
				var arrQueries = [];
				conn.addQuery(arrQueries, "BEGIN");
				var wallet_ids_to_update = rows.splice(1).map(function(row){
					return row.wallet_id
				});
				if (wallet_ids_to_update.length > 0){
						var wallet_ids_to_update_string =  wallet_ids_to_update.join("','");

					conn.addQuery(arrQueries, "UPDATE btc_addresses SET wallet_id=? WHERE wallet_id IN('"+wallet_ids_to_update_string+"')",[rows[0].wallet_id]);
					conn.addQuery(arrQueries, "UPDATE transactions_from SET wallet_id=? WHERE wallet_id IN('"+wallet_ids_to_update_string+"')",[rows[0].wallet_id]);
					conn.addQuery(arrQueries, "UPDATE transactions_to SET wallet_id=? WHERE wallet_id IN('"+wallet_ids_to_update_string+"')",[rows[0].wallet_id]);
					if (block_height < heightAboveCatchup)
						conn.addQuery(arrQueries, "DELETE FROM btc_wallets WHERE id IN('"+wallet_ids_to_update_string+"')");
				}
				conn.addQuery(arrQueries, "UPDATE transactions_to INDEXED BY toByAddress SET wallet_id=?,address=NULL WHERE address IN('"+InputaddressesSqlString+"')", [rows[0].wallet_id]);
				if (block_height >= heightAboveCatchup){
					wallet_ids_to_update.forEach(function(row){
						conn.addQuery(arrQueries, "REPLACE INTO redirections (from_id, to_id) VALUES (?,?)",[row, rows[0].wallet_id]);
					});
				}
				conn.addQuery(arrQueries, "REPLACE INTO processed_blocks (block_height,tx_index,block_time) VALUES (?,?,?)",[block_height, tx_index, block_time]);
				conn.addQuery(arrQueries, "COMMIT");
				async.series(arrQueries, function() {
					conn.release();
					resolve();
				});
			});
		} else {
			resolve();
		}
	});
}

function downloadNextWhileProcessing(blockheight, start_tx_index,  objBlock){
	return new Promise((resolve)=>{
		if (!objBlock){
			downloadBlockAndParse(blockheight, async function(error, objBlock){
				resolve(await downloadNextWhileProcessing(blockheight, start_tx_index, objBlock));
			});
		} else {
			async.parallel([
				function(callback) {
					downloadBlockAndParse(blockheight + 1, callback);
				},
				function(callback) {
					processBlock(objBlock, start_tx_index, callback);
				}
			],
			function(error, arrResults) {
				resolve(arrResults[0]);
			});
		}
	})
}

function downloadBlockAndParse(blockheight, handle){
	request({
		url: "https://blockchain.info/block-height/"+blockheight+"?format=json"
	}, function(error, response, body) {
		try {
			var objBlock = JSON.parse(body).blocks[0];
		} catch (e) {
			console.error(e);
			return downloadBlockAndParse(blockheight, handle)
		}
		console.error("block " + blockheight + " downloaded");
		handle(null, objBlock);
	});
}


function getLastBlockHeight( handle){
	request({
		url: "https://blockchain.info/latestblock"
	}, function(error, response, body) {
		try {
			var objLastBlock = JSON.parse(body);
		} catch (e) {
			console.error(e);
			return handle(e);
		}
		console.error("last block " + objLastBlock.height + " downloaded");
		handle(null, objLastBlock.height);
	});
}