<template>
	<div :class="{bordered: !no_border}" class="py-4">
		<b-row class="transaction-headers mx-lg-4 mx-2">
			<b-col  cols="6" >
				<TxId label="Transaction: " :tx_id="tx_id"/>
			</b-col>
			<b-col  cols="3" class="text-center" >
				Time: {{transaction.time}}
			</b-col>
			<b-col  cols="3" class="text-center" >
				Block: {{transaction.height}}
			</b-col>
		</b-row>
		<b-row>
			<b-col  cols="5" class="py-3 text-left">
				<div class="w-100 px-4">
					<wallet-id v-if="transaction.from && transaction.from.id" :label="$t('explorerTransactionLabelWallet')" :id="transaction.from.id"/>
					<span v-if="transaction.from.exchange"><Exchange :label="$t('explorerTransactionLabelExchange')" :id="transaction.from.exchange"/></span>
					<btc-amount v-if="transaction.from && transaction.from.amount" :label="$t('explorerTransactionLabelAmount')" :amount="transaction.from.amount" :isNegative="about_ids.indexOf(transaction.from.id)>-1"/>
				</div>
			</b-col>
			<b-col cols="2" class="text-center">
				<div class="centered">
					<v-icon name='arrow-right' class="custom-icon"/>
				</div>
			</b-col>
			<b-col  cols="5" class="py-3 text-left">
				<div v-for="(t_out,index) in transaction.to" :key="index" class="py-2">
					<wallet-id v-if="t_out.id" label="Wallet: " :id="t_out.id"/>
					<span v-else>{{$t("explorerTransactionUnknownWallet")}}</span>
					<span v-if="t_out.exchange"><Exchange :label="$t('explorerTransactionLabelExchange')" :id="t_out.exchange"/></span>
					<btc-address v-if="t_out.address" :label="$t('explorerTransactionLabelAddress')" :address="t_out.address"/>
					<btc-amount :label="$t('explorerTransactionLabelAmount')" :amount="t_out.amount" :isPositive="about_ids.indexOf(t_out.id)>-1"/>
				</div>
				<div v-if="transaction.is_expandable" class="py-2">
				<b-button
					variant="primary"
					v-on:click="$emit('expand', tx_id)" 
					size="s">Expand</b-button>
					</div>
			</b-col>
		</b-row >
	</div>
</template>

<script>
//commons
import BtcAmount from './commons/BtcAmount.vue';
import WalletId from './commons/WalletId.vue';
import TxId from './commons/TxId.vue';
import BtcAddress from './commons/BtcAddress.vue';
import Exchange from './commons/Exchange.vue';

export default {
	components: {
		BtcAmount,
		WalletId,
		TxId,
		BtcAddress,
		Exchange
	},
	props: ['transaction','tx_id','no_border','about_wallet_ids'],
	data() {
		return {
			about_ids: this.about_wallet_ids || [],
			isExpandable: false
		}
	},
	created() {

	},
}
</script>

<style scoped>
.bordered{
	border-bottom: 2px;
	border-bottom-style: solid;
}


.custom-icon {
	height: 50px;
	padding: auto;
}

.centered {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
}

.transaction-headers{
	background-color: gainsboro
}
</style>
