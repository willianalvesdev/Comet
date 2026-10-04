import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert = require('node:assert/strict');
import {test} from 'node:test';

type Helpers = {success:typeof financialExecutionFeedback; question:typeof financialClarificationFeedback; execute:typeof executeFinancialActions};
let helpers: Helpers;
runInNewContext(['financial-parser','financial-execution','financial-feedback'].map(name=>readFileSync(resolve(__dirname,'../../static/js/'+name+'.js'),'utf8')).join('\n') +
    '\ncapture({success:financialExecutionFeedback, question:financialClarificationFeedback, execute:executeFinancialActions});', {
    capture:(value:Helpers)=>{helpers=value;}
});
const market:StoredTransaction={id:'55501',kind:'expense',amount:'67.00',description:'Mercado',category:'',occurred_on:'2026-09-14',currency:'BRL',deleted_at:null};
const context:FinancialContext={currentDate:'2026-09-15',timezone:'America/Sao_Paulo',locale:'pt-BR',currency:'BRL',categories:[],transactions:[market],deleted_transactions:[],transactions_complete:true,deleted_transactions_complete:true,recent_events:[],pending_clarification:null};
const confidence:ParserConfidence={intentCertain:true,amountCertain:true,dateCertain:true,typeCertain:true,descriptionCertain:true,referenceCertain:false,calculationCertain:true,multiplePossibleTargets:true,unknownNumbers:false,hasAmbiguity:true,canExecuteLocally:false,requiresFallback:true,reasons:['multiple_targets']};
function result(type:FinancialAction['type'], ids:TransactionIds=['55501']):FinancialExecutionResult {return {operation_id:'internal-operation',operations:[{type,transaction_ids:ids}]};}

test('feedback usa valor e descrição persistidos, data relativa e nenhum identificador interno',()=>{
    assert.equal(helpers.success(result('create'),context),'Adicionei R$ 67,00 — Mercado — ontem.');
    assert.equal(helpers.success(result('create'),{...context,transactions:[{...market,amount:'999999999999.99',occurred_on:'2026-09-05'}]}),'Adicionei R$ 999.999.999.999,99 — Mercado — 05/09/2026.');
    for(const [type,message] of [['update','Transação atualizada.'],['delete','Transação removida.'],['restore','Transação restaurada.'],['permanent_delete','Transação excluída definitivamente.']] as const) {
        assert.equal(helpers.success(result(type),context),message);
    }
    const batch:FinancialExecutionResult={operation_id:'private',operations:[{type:'create',transaction_ids:['55501']},{type:'create',transaction_ids:['55502']}]};
    assert.equal(helpers.success(batch,context),'Adicionei 2 transações.');
    assert.equal(helpers.success(result('delete',['55501','55502']),context),'2 transações removidas.');
    assert.equal(helpers.success(result('restore',['55501','55502']),context),'2 transações restauradas.');
    batch.operations[1].type='delete';
    assert.equal(helpers.success(batch,context),'Concluí 2 operações.');
});

test('esclarecimento informa candidatos reais e a operação solicitada sem IDs',()=>{
    const clarification:PendingClarification={id:'private-question',original_text:'Apaga a compra do mercado de ontem',intent:{type:'delete',target:{reference:'mercado',candidate_ids:['55501','55502']}},reason:'ambiguous_target',question:'Qual transação?',missing_fields:[],candidate_ids:['55501','55502'],candidates:[{...market,amount:'50.00'},{...market,id:'55502',amount:'80.00'}]};
    const message=helpers.question({status:'needs_clarification',clarification,confidence},context);
    assert.equal(message,'Encontrei duas compras de Mercado ontem: R$ 50,00 e R$ 80,00. Qual delas você quer apagar?');
    assert(!/55501|55502|private|confidence|parserSource|deletedAt/.test(message));
    assert.equal(helpers.question({status:'needs_clarification',confidence,clarification:{...clarification,reason:'missing_fields',candidates:[],missing_fields:['amount'],question:'Informe amount no JSON, transactionId 55501'}},context),'Qual foi o valor em reais?');
});

test('todas as ações são validadas antes de chamar a persistência',async()=>{
    let calls=0;
    const fetcher:typeof fetch=async()=>{calls++;throw new Error('Não deveria executar');};
    const transaction:TransactionFields={kind:'expense',amount:'67.00',description:'Mercado',category:'',occurred_on:'2026-09-14'};
    for(const invalid of [{...transaction,amount:'0.00'},{...transaction,description:''},{...transaction,category:'x'.repeat(81)},{...transaction,occurred_on:'2026-02-30'}]) {
        await assert.rejects(helpers.execute([{type:'create',transaction},{type:'create',transaction:invalid}],'operation',fetcher));
    }
    assert.equal(calls,0);
});
