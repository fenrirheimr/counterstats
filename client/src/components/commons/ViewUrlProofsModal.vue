<template>
	

	<b-modal id="viewUrlProofs" :title="$t('urlProofModalTitle')" hide-footer>
		<b-container  >
			<b-row v-if="proofsByOutcome.in && proofsByOutcome.in.length>0" class="pt-3" >
				<b-col cols="12">
					<b-row>
						{{$t("urlProofModalProofForAdding")}}
					</b-row >
					<b-row v-for="(url,index) in proofsByOutcome.in" :key="index">
						<b-link :href="url" target="_blank">{{url}}</b-link>
					</b-row>
				</b-col>
			</b-row>
			<b-row v-if="proofsByOutcome.out && proofsByOutcome.out.length>0" class="pt-3" >
				<b-col cols="12">
					<b-row>
						{{$t("urlProofModalProofForRemoving")}}
					</b-row >
					<b-row v-for="(url,index) in proofsByOutcome.out" :key="index">
						<b-link :href="url" target="_blank">{{url}}</b-link>
					</b-row>
				</b-col>
			</b-row>
		</b-container>

	</b-modal>


</template>

<script>
const conf = require("../../conf.js");

export default {	
	components: {
	},
	props: {
		operationItem: {
			type: Object,
			required: false,
			default:  function () {
				return {}
			}
		}
	},
	data(){
		return {
			proofsByOutcome: {}
		}
	},
	watch:{
		operationItem:function(){
			this.proofsByOutcome = this.operationItem.url_proofs_by_outcome || {};
		}
	}
}
</script>

<style lang='scss' scoped>
</style>