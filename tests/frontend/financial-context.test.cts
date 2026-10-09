import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert = require('node:assert/strict');
import {test} from 'node:test';

let turn: typeof parseFinancialTurn = () => {throw new Error('Não carregado');};
let confirmed: typeof rememberFinancialOperation = () => {throw new Error('Não carregado');};
runInNewContext(['financial-parser','financial-context'].map(name=>readFileSync(resolve(__dirname,'../../artifacts/test-runtime/'+name+'.js'),'utf8')).join('\n') +
    '\ncapture(parseFinancialTurn, rememberFinancialOperation);', {
    capture: (parse: typeof parseFinancialTurn, remember: typeof rememberFinancialOperation) => {turn=parse;confirmed=remember;}
});
const empty: FinancialContext = {
    currentDate:'2026-10-01',timezone:'America/Sao_Paulo',locale:'pt-BR',currency:'BRL',categories:[],
    transactions:[],deleted_transactions:[],transactions_complete:true,deleted_transactions_complete:true,
    recent_events:[],pending_clarification:null
};
const market: StoredTransaction = {id:'101',kind:'expense',amount:'80.00',description:'Mercado',category:'',occurred_on:'2026-09-30',currency:'BRL',deleted_at:null};
const cheap: StoredTransaction = {...market,id:'102',amount:'50.00'};
const work: StoredTransaction = {...market,id:'103',kind:'income',amount:'500.00',description:'Trabalho'};
function action(result:ParserResult):FinancialAction {
    assert.equal(result.status,'resolved');if(result.status!=='resolved')throw new Error('Expected action');
    assert.equal(result.actions.length,1);return result.actions[0];
}
function target(result:ParserResult):string[] {
    const value=action(result);if(value.type==='create')throw new Error('Expected target');
    return Array.from(value.transaction_ids);
}
function question(result:ParserResult):PendingClarification {
    assert.equal(result.status,'needs_clarification');if(result.status!=='needs_clarification')throw new Error('Expected question');
    assert(!('actions' in result));return result.clarification;
}

test('conversa corrige valor e data e exclui o mesmo ID confirmado pelo armazenamento',()=>{
    const created=turn('Gastei 80 no mercado ontem.',empty);
    assert.equal(action(created.result).type,'create');
    assert.deepEqual(Array.from(created.context.last_created_transaction_ids ?? []),[]);
    question(turn('Na verdade foram 90.',created.context).result);
    let context=confirmed({...created.context,transactions:[market]},'create',['101']);
    const amount=turn('Na verdade foram 90.',context);
    const updated=action(amount.result);assert.equal(updated.type,'update');
    if(updated.type!=='update')throw new Error();assert.equal(updated.changes.amount,'90.00');
    assert.deepEqual(target(amount.result),['101']);
    assert.deepEqual(Array.from(amount.context.last_updated_transaction_ids ?? []),[]);
    context=confirmed({...amount.context,transactions:[{...market,amount:'90.00'}]},'update',['101']);
    const date=turn('Foi anteontem.',context);
    const changed=action(date.result);if(changed.type!=='update')throw new Error();
    assert.equal(changed.changes.occurred_on,'2026-09-29');assert.deepEqual(target(date.result),['101']);
    context=confirmed({...date.context,transactions:[{...market,amount:'90.00',occurred_on:'2026-09-29'}]},'update',['101']);
    const removed=turn('Apaga ela.',context);assert.equal(action(removed.result).type,'delete');
    assert.deepEqual(target(removed.result),['101']);
    assert.equal(context.transactions.length,1);
    assert.deepEqual(Array.from(removed.context.last_deleted_transaction_ids ?? []),[]);
    assert.equal(removed.context.last_intent?.type,'delete');
    const deleted = {...market,amount:'90.00',occurred_on:'2026-09-29',deleted_at:'2026-10-01T12:00:00Z'};
    context=confirmed({...removed.context,transactions:[],deleted_transactions:[deleted]},'delete',['101']);
    const undo=turn('Desfaz',context);
    assert.equal(action(undo.result).type,'restore');assert.deepEqual(target(undo.result),['101']);
    context=confirmed({...undo.context,transactions:[{...deleted,deleted_at:null}],deleted_transactions:[]},'restore',['101']);
    assert.equal(context.transactions[0].amount,'90.00');assert.equal(context.transactions[0].occurred_on,'2026-09-29');
    assert.deepEqual(Array.from(context.last_restored_transaction_ids ?? []),['101']);
});

test('pergunta contém candidatos reais e resposta por valor mantém a intenção original',()=>{
    const first=turn('Apaga o mercado de ontem.',{...empty,transactions:[market,cheap,work]});
    const pending=question(first.result);
    assert.deepEqual(Array.from(pending.candidate_ids),['101','102']);
    assert.deepEqual(Array.from(pending.candidates ?? [],row=>[row.id,row.amount]),[['101','80.00'],['102','50.00']]);
    assert.equal(first.context.pending_clarification,pending);
    const second=turn('A de 80.',first.context);
    assert.equal(action(second.result).type,'delete');assert.deepEqual(target(second.result),['101']);
    assert.equal(second.context.pending_clarification,null);
    assert.deepEqual(Array.from(second.context.last_mentioned_transaction_ids ?? []),['101']);
    assert.deepEqual(target(turn('Corrige ela para 90.',second.context).result),['101']);
});

test('seleção ambígua persiste e não escolhe pelo primeiro item',()=>{
    const first=turn('Apaga o mercado de ontem',{...empty,transactions:[market,{...cheap,amount:'80.00'}]});
    const second=turn('A de 80',first.context);question(second.result);
    assert.deepEqual(Array.from(second.context.pending_clarification?.candidate_ids ?? []),['101','102']);
    question(turn('ela',second.context).result);
    assert.deepEqual(target(turn('os dois',second.context).result),['101','102']);
});

test('pronomes singulares e plurais respeitam a quantidade de referentes',()=>{
    const one=confirmed({...empty,transactions:[market,cheap]},'create',['101']);
    for(const word of ['ela','ele','essa','essa compra','essa despesa','aquela','a anterior']) {
        assert.deepEqual(target(turn('Apaga '+word,one).result),['101'],word);
    }
    const two=confirmed({...empty,transactions:[market,cheap]},'create',['101','102']);
    for(const word of ['ela','ele','essa','aquela'])question(turn('Apaga '+word,two).result);
    for(const word of ['os dois','as duas','essas','elas'])assert.deepEqual(target(turn('Apaga '+word,two).result),['101','102']);
    question(turn('Apaga os dois',one).result);
    question(turn('Apaga ela',empty).result);
});

test('última exige histórico completo e pergunta quando há empate de data',()=>{
    const rows=[market,{...cheap,occurred_on:'2026-09-29'}];
    assert.deepEqual(target(turn('Apaga a última',{...empty,transactions:rows}).result),['101']);
    question(turn('Apaga a última',{...empty,transactions:rows,transactions_complete:false}).result);
    question(turn('Apaga a última',{...empty,transactions:[cheap,market]}).result);
});

test('IDs ausentes, repetidos ou removidos não são inventados nem substituídos',()=>{
    for(const context of [
        {...empty,last_mentioned_transaction_ids:['999']},
        {...empty,transactions:[market],last_mentioned_transaction_ids:['101','999']},
        {...empty,transactions:[market,market],last_mentioned_transaction_ids:['101']},
        {...empty,transactions:[market],deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'}],last_mentioned_transaction_ids:['101']}
    ])question(turn('Apaga ela',context).result);
    assert.throws(()=>confirmed(empty,'create',['999']));
    assert.throws(()=>confirmed({...empty,transactions:[market]},'delete',['101']));
    assert.throws(()=>confirmed({...empty,transactions:[market]},'create',['101','101']));
    const first=turn('Apaga o mercado de ontem',{...empty,transactions:[market,cheap]});
    question(turn('A de 80',{...first.context,transactions:[cheap]}).result);
    question(turn('A de 80',{...first.context,transactions:[{...market,description:'Farmácia'},cheap]}).result);
    question(turn('A de 80',{...first.context,transactions:[{...market,amount:'70.00'},cheap]}).result);
    question(turn('ID 999',first.context).result);
});

test('histórico parcial não prova unicidade e nova seleção consulta dados atuais',()=>{
    const first=turn('Apaga o mercado de ontem',{...empty,transactions:[market],transactions_complete:false});
    question(first.result);question(turn('A de 80',first.context).result);
    const second=turn('A de 80',{...first.context,transactions:[market,cheap],transactions_complete:true});
    assert.deepEqual(target(second.result),['101']);
    question(turn('A de 80',{...first.context,transactions:[],transactions_complete:true}).result);
});

test('correção ambígua preserva mudanças durante esclarecimento e pede valor ausente',()=>{
    const first=turn('Corrige o mercado de ontem para 90',{...empty,transactions:[market,cheap]});
    question(first.result);
    const result=action(turn('A de 80',first.context).result);
    if(result.type!=='update')throw new Error();assert.equal(result.changes.amount,'90.00');assert.deepEqual(Array.from(result.transaction_ids),['101']);
    const known=confirmed({...empty,transactions:[market]},'create',['101']);
    const missing=turn('Na verdade foram vários',known);question(missing.result);
    const fixed=action(turn('90',missing.context).result);if(fixed.type!=='update')throw new Error();assert.equal(fixed.changes.amount,'90.00');
    const date=action(turn('Muda ela para anteontem',known).result);if(date.type!=='update')throw new Error();assert.equal(date.changes.occurred_on,'2026-09-29');
    question(turn('Muda ela para amanhã',known).result);
});

test('exclusão e restauração confirmadas atualizam estado sem modificar snapshots',()=>{
    const input={...empty,deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'}]};const before=JSON.stringify(input);
    const removed=confirmed(input,'delete',['101']);assert.equal(JSON.stringify(input),before);
    assert.deepEqual(Array.from(removed.last_deleted_transaction_ids ?? []),['101']);
    const restored=turn('Restaura ela',removed);assert.equal(action(restored.result).type,'restore');assert.deepEqual(target(restored.result),['101']);
    const context=confirmed({...restored.context,transactions:[market],deleted_transactions:[]},'restore',['101']);
    assert.deepEqual(Array.from(context.last_restored_transaction_ids ?? []),['101']);
    question(turn('Restaura ela',context).result);
});

test('pedido novo troca intenção sem carregar IDs de uma criação ainda não confirmada',()=>{
    const first=turn('Apaga o mercado de ontem',{...empty,transactions:[market,cheap]});
    const created=turn('Gastei 20 no ônibus',first.context);assert.equal(action(created.result).type,'create');
    assert.equal(created.context.pending_clarification,null);question(turn('Apaga ela',created.context).result);
    const known=confirmed({...empty,transactions:[market,cheap]},'create',['101']);
    const before=JSON.stringify(known);
    const result=turn('Não apaga ela',known);assert.equal(result.result.status,'unrecognized');assert.equal(JSON.stringify(known),before);
    assert.deepEqual(Array.from(result.context.last_mentioned_transaction_ids ?? []),['101']);
    assert.equal(turn('Na verdade foram 90',{...known,currency:'USD'}).result.status,'unrecognized');
});


test('valor faltante na criação é esclarecido sem inventar ID nem reinterpretar a data',()=>{
    const first=turn('Gastei no mercado ontem',empty);question(first.result);
    const next=turn('80 reais',{...first.context,currentDate:'2026-10-02'});
    const created=action(next.result);if(created.type!=='create')throw new Error();
    assert.equal(created.transaction.amount,'80.00');assert.equal(created.transaction.description,'Mercado');
    assert.equal(created.transaction.occurred_on,'2026-09-30');
    assert.deepEqual(Array.from(next.context.last_created_transaction_ids ?? []),[]);
    question(turn('Na verdade foram 90',next.context).result);
    question(turn('80 ou 90',first.context).result);
});


test('exclusões comuns nunca se tornam definitivas e restauração pesquisa apenas a lixeira',()=>{
    const active={...empty,transactions:[market],last_mentioned_transaction_ids:['101']};
    for(const text of ['Apaga ela','Remove ela','Exclui ela']) assert.equal(action(turn(text,active).result).type,'delete');
    const deleted={...market,deleted_at:'2026-10-01T12:00:00Z'};
    const trash={...empty,deleted_transactions:[deleted],last_mentioned_transaction_ids:['101']};
    for(const text of ['Apague definitivamente ela','Exclua ela permanentemente','Remova da lixeira para sempre']) {
        const result=action(turn(text,trash).result);
        assert.equal(result.type,'permanent_delete');
        if(result.type!=='permanent_delete')throw new Error();
        assert.equal(result.confirmation,'explicit_permanent_delete');
        assert.deepEqual(Array.from(result.transaction_ids),['101']);
        question(turn(text,active).result);
    }
    assert.equal(action(turn('Restaura o mercado que apaguei.',trash).result).type,'restore');
    question(turn('Apaga ela',trash).result);
    question(turn('Na verdade foram 90',trash).result);
    for(const text of ['Não apague definitivamente ela','Talvez remova da lixeira para sempre']) assert.equal(turn(text,trash).result.status,'unrecognized');
});

test('desfaz restaura a última exclusão confirmada sem inventar IDs nem repetir uma restauração',()=>{
    const deletion=turn('Apaga ela',{...empty,transactions:[market],last_mentioned_transaction_ids:['101']});
    question(turn('Desfaz',deletion.context).result);
    const deleted={...market,deleted_at:'2026-10-01T12:00:00Z'};
    const state=confirmed({...deletion.context,transactions:[],deleted_transactions:[deleted]},'delete',['101']);
    const undo=turn('Desfaz.',state);
    assert.equal(action(undo.result).type,'restore');assert.deepEqual(target(undo.result),['101']);
    const restored=confirmed({...undo.context,transactions:[market],deleted_transactions:[]},'restore',['101']);
    question(turn('Desfaz',restored).result);
    question(turn('Desfaz',{...state,deleted_transactions:[]}).result);
});

test('exclusão definitiva ambígua conserva o pedido explícito durante o esclarecimento',()=>{
    const trash={...empty,deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'},{...cheap,deleted_at:'2026-10-01T12:00:00Z'}]};
    const first=turn('Apague definitivamente o mercado',trash);question(first.result);
    const choice=action(turn('A de 80',first.context).result);
    assert.equal(choice.type,'permanent_delete');
    question(turn('A de 80',{...first.context,deleted_transactions:[]}).result);
});


test('esclarecimento de um lote incompleto nunca executa somente a última transação', () => {
    const first = turn('Gastei 30 no almoço e paguei no ônibus', empty);
    const pending = question(first.result);
    assert.equal(pending.original_text, 'Gastei 30 no almoço e paguei no ônibus');
    assert.equal(pending.intent, null);
    const amountOnly = turn('20', first.context);
    assert.notEqual(amountOnly.result.status, 'resolved');
    assert(!('actions' in amountOnly.result));
    const complete = turn('Gastei 30 no almoço e paguei 20 no ônibus', first.context);
    if (complete.result.status !== 'resolved') throw new Error('Expected complete batch');
    assert.equal(complete.result.actions.length, 2);
    assert.deepEqual(Array.from(complete.result.actions, item => item.type === 'create' ? item.transaction.amount : null), ['30.00','20.00']);
});


test('negações, condições e qualificadores citados não autorizam exclusão definitiva ou outra ação', () => {
    const trash = {...empty,deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'}],last_mentioned_transaction_ids:['101']};
    for (const input of [
        'Apaga ela sem excluir definitivamente',
        'Apaga ela sem apagar permanentemente',
        'Apague ela definitivamente caso já esteja na lixeira',
        'Apague definitivamente ela quando eu confirmar',
        'Apague definitivamente ela mas mantenha uma cópia',
        'Apague definitivamente ela se estiver na lixeira',
        'Não apague definitivamente ela',
        'Apaga "definitivamente" ela',
        'Apaga ela “permanentemente”',
        "Apaga ela 'para sempre'",
        'Apaga ela `definitivamente`',
        'Apaga definitivamente ela, exceto se for do mercado'
    ]) {
        const result = turn(input, trash).result;
        assert.notEqual(result.status, 'resolved', input);
        assert(!('actions' in result), input);
    }
    const first = turn('Apaga ela sem excluir definitivamente', trash);
    assert.equal(question(first.result).intent, null);
    const followup = turn('A de 80', first.context).result;
    assert.notEqual(followup.status, 'resolved');
    assert(!('actions' in followup));
});

test('pendingClarification não promove um pedido permanente negado ou citado', () => {
    const trash = {...empty,deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'},{...cheap,deleted_at:'2026-10-01T12:00:00Z'}]};
    const original = turn('Apague definitivamente o mercado', trash);
    const pending = question(original.result);
    for (const original_text of ['Apague o mercado sem excluir definitivamente','Apague "definitivamente" o mercado','Apague definitivamente o mercado caso eu confirme']) {
        const result = turn('A de 80', {...original.context,pending_clarification:{...pending,original_text}}).result;
        assert.notEqual(result.status, 'resolved', original_text);
        assert(!('actions' in result));
    }
});


test('nome Para Sempre em uma criação não é confundido com exclusão definitiva', () => {
    const result = turn('Gastei 50 na loja Para Sempre', empty).result;
    const created = action(result);
    if (created.type !== 'create') throw new Error('Expected create');
    assert.equal(created.transaction.description, 'Loja Para Sempre');
    assert.equal(created.transaction.amount, '50.00');
    assert.equal(result.confidence.canExecuteLocally, true);
    assert.equal(result.confidence.requiresFallback, false);
});


test('apagar todas seleciona todas as ativas em uma única exclusão local e preserva a lixeira', () => {
    const oldTrash = {...market, id: '900', deleted_at: '2026-09-01T12:00:00Z'};
    for (const transactions of [[market], [market, cheap, work]]) {
        const context = {...empty, transactions, deleted_transactions: [oldTrash]};
        const before = JSON.stringify(context);
        for (const input of [
            'apague todas as transações', 'Apaga todas as transações.', 'Remova todas as minhas transações',
            'Exclua todas minhas transações', 'Remove todas transações', 'Exclui tudo',
            'Apaga todas', 'Apague todos', 'Por favor, apague todas as transações', 'Apague tudo, por favor'
        ]) {
            const result = turn(input, context).result;
            assert.equal(action(result).type, 'delete', input);
            assert.deepEqual(target(result), transactions.map(row => row.id), input);
            assert.equal(result.confidence.canExecuteLocally, true, input);
            assert.equal(result.confidence.requiresFallback, false, input);
        }
        assert.equal(JSON.stringify(context), before);
    }
});

test('apagar todas não limita IDs a uma página e desfaz restaura somente a última exclusão confirmada', () => {
    const transactions = Array.from({length: 125}, (_, index) => ({...market, id: String(index + 1000)}));
    const oldTrash = {...cheap, deleted_at: '2026-09-01T12:00:00Z'};
    const deletion = turn('Apague todas as transações', {...empty, transactions, deleted_transactions: [oldTrash]});
    assert.equal(action(deletion.result).type, 'delete');
    assert.deepEqual(target(deletion.result), transactions.map(row => row.id));
    question(turn('Desfaz', deletion.context).result);
    const deleted = transactions.map(row => ({...row, deleted_at: '2026-10-01T12:00:00Z'}));
    const state = confirmed({...deletion.context, transactions: [], deleted_transactions: [oldTrash, ...deleted]},
        'delete', [transactions[0].id, ...transactions.slice(1).map(row => row.id)]);
    const undo = turn('Desfaz', state);
    assert.equal(action(undo.result).type, 'restore');
    assert.deepEqual(target(undo.result), transactions.map(row => row.id));
    assert.equal(undo.result.confidence.requiresFallback, false);
    const restored = confirmed({...undo.context, transactions, deleted_transactions: [oldTrash]},
        'restore', [transactions[0].id, ...transactions.slice(1).map(row => row.id)]);
    assert.deepEqual(Array.from(restored.last_restored_transaction_ids ?? []), transactions.map(row => row.id));
    assert.deepEqual(Array.from(restored.deleted_transactions, row => row.id), [oldTrash.id]);
    question(turn('Desfaz', restored).result);
});

test('apagar todas com histórico vazio, incompleto ou inconsistente não executa parcialmente nem solicita IA', () => {
    const deleted = {...market, deleted_at: '2026-10-01T12:00:00Z'};
    const contexts: FinancialContext[] = [
        empty, {...empty, deleted_transactions: [deleted]},
        {...empty, transactions: [market], transactions_complete: false},
        {...empty, transactions: [market], deleted_transactions_complete: false},
        {...empty, transactions: [market, market]},
        {...empty, transactions: [market], deleted_transactions: [deleted]},
        {...empty, transactions: [deleted]},
        {...empty, transactions: [market], deleted_transactions: [cheap]},
        {...empty, transactions: [{...market, id: ' '}]},
        {...empty, transactions: [cheap], deleted_transactions: [deleted, deleted]}
    ];
    for (const context of contexts) {
        const result = turn('Apague todas as transações', context).result;
        assert.equal(result.status, 'unrecognized');
        assert(!('actions' in result));
        assert.equal(result.confidence.requiresFallback, false);
        assert.equal(result.confidence.canExecuteLocally, false);
        assert(result.confidence.reasons.includes('rejected_input'));
        if (result.status !== 'unrecognized') throw new Error('Expected safe refusal');
        assert(result.reason.length > 0);
    }
    const noRows = turn('Apague todas as transações', empty).result;
    if (noRows.status !== 'unrecognized') throw new Error('Expected empty notice');
    assert.equal(noRows.reason, 'Não há transações ativas para apagar.');
});

test('qualificadores, condições e exclusão definitiva não autorizam apagar todas nem fallback parcial', () => {
    const context = {...empty, transactions: [market, cheap, work], deleted_transactions: [{...market, id: '900', deleted_at: '2026-09-01T12:00:00Z'}]};
    for (const input of [
        'Apague todas as transações menos mercado', 'Apague todas as transações exceto a de 80',
        'Apague todas as transações de ontem', 'Apague todas as despesas', 'Apague tudo do mercado',
        'Apague todas as transações definitivamente', 'Apague definitivamente todas as transações',
        'Apague todas as transações da lixeira para sempre', 'Apague todas permanentemente',
        'Não apague todas as transações', 'Nunca apague todas as transações', 'Jamais apague todas as transações',
        'Apague todas as transações se eu confirmar', 'Apague todas as transações quando eu confirmar',
        'Apague todas as transações caso sejam antigas', 'Apague todas as transações mas mantenha receitas',
        'Apague "todas as transações"', 'Apague todas as transações e recebi 100'
    ]) {
        const result = turn(input, context).result;
        assert.equal(result.status, 'unrecognized', input);
        assert(!('actions' in result), input);
        assert.equal(result.confidence.requiresFallback, false, input);
    }
});


test('descrição com palavras de exclusão coletiva continua sendo uma criação', () => {
    for (const input of ['Gastei 50 no livro Apague Todas', 'Recebi 100 da loja Remove Tudo']) {
        const result = turn(input, empty).result;
        const created = action(result);
        assert.equal(created.type, 'create', input);
        assert.equal(result.confidence.requiresFallback, false, input);
        if (created.type !== 'create') throw new Error('Expected creation');
        assert.equal(created.transaction.description, input.startsWith('Gastei') ? 'Livro Apague Todas' : 'Loja Remove Tudo');
    }
});


test('correção com verbo muda valor e natureza sem criar outra transação ou perder descrição e data',()=>{
    for(const [input,changes] of [
        ['Na verdade eu gastei 90',{amount:'90.00',kind:'expense'}],
        ['Na verdade eu gastei',{kind:'expense'}],
        ['Na verdade eu lucrei 120',{amount:'120.00',kind:'income'}],
        ['Na verdade ganhei 90 ontem',{amount:'90.00',kind:'income',occurred_on:'2026-09-30'}],
        ['Na verdade perdi 40',{amount:'40.00',kind:'expense'}],
        ['Na verdade foram 90 ontem',{amount:'90.00',occurred_on:'2026-09-30'}]
    ] as const) {
        const ctx={...empty,transactions:[market],last_mentioned_transaction_ids:['101']};
        const result=turn(input,ctx).result, changed=action(result);
        assert.equal(changed.type,'update');if(changed.type!=='update')throw new Error();
        assert.deepEqual(JSON.parse(JSON.stringify(changed.changes)),changes,input);
        assert.deepEqual(Array.from(changed.transaction_ids),['101']);
        assert.equal(result.confidence.requiresFallback,false,input);
        assert.equal(ctx.transactions[0].amount,'80.00');
    }
    const missing=turn('Na verdade eu gastei 90',empty).result;
    assert.notEqual(missing.status,'resolved');
});

test('correção composta ambígua preserva tipo, valor e data na escolha seguinte',()=>{
    const first=turn('Na verdade eu ganhei 90 ontem',{...empty,transactions:[market,cheap],last_mentioned_transaction_ids:['101','102']});
    question(first.result);
    const result=action(turn('A de 80',first.context).result);
    assert.equal(result.type,'update');if(result.type!=='update')throw new Error();
    assert.deepEqual(Array.from(result.transaction_ids),['101']);
    assert.deepEqual(JSON.parse(JSON.stringify(result.changes)),{amount:'90.00',kind:'income',occurred_on:'2026-09-30'});
});

test('foi de graça cancela somente a despesa indicada e permite desfazer',()=>{
    for(const input of ['Na verdade foi de graça','Na verdade foi grátis','Foi gratuito','Na verdade foi sem custo']) {
        const deletion=turn(input,{...empty,transactions:[market],last_mentioned_transaction_ids:['101']});
        assert.equal(action(deletion.result).type,'delete');assert.deepEqual(target(deletion.result),['101']);
        assert.equal(deletion.result.confidence.requiresFallback,false);
        const state=confirmed({...deletion.context,transactions:[],deleted_transactions:[{...market,deleted_at:'2026-10-01T12:00:00Z'}]},'delete',['101']);
        assert.equal(action(turn('Desfaz',state).result).type,'restore');
    }
    for(const ctx of [empty,{...empty,transactions:[work],last_mentioned_transaction_ids:['103']},
        {...empty,transactions:[market,cheap],last_mentioned_transaction_ids:['101','102']}]) {
        const result=turn('Na verdade foi de graça',ctx).result;
        question(result);assert.equal(result.confidence.requiresFallback,false);assert(!('actions' in result));
    }
    const ambiguous=turn('Na verdade foi de graça',{...empty,transactions:[market,cheap,work],last_mentioned_transaction_ids:['101','102','103']});
    assert.deepEqual(Array.from(question(ambiguous.result).candidate_ids),['101','102']);
    assert.deepEqual(target(turn('A de 80',ambiguous.context).result),['101']);
});

test('semana passada pergunta o dia e interpreta a resposta naquela semana, inclusive virada de ano',()=>{
    for(const [currentDate,start,end,reply,expected] of [
        ['2026-10-03','2026-09-21','2026-09-27','quinta','2026-09-24'],
        ['2026-10-03','2026-09-21','2026-09-27','domingo','2026-09-27'],
        ['2026-01-02','2025-12-22','2025-12-28','quarta','2025-12-24'],
        ['2026-10-03','2026-09-21','2026-09-27','dia 23','2026-09-23']
    ]) {
        const first=turn('Na verdade foi semana passada',{...empty,currentDate,transactions:[market],last_mentioned_transaction_ids:['101']});
        const pending=question(first.result);
        assert.equal(first.result.confidence.requiresFallback,false);
        assert.deepEqual(JSON.parse(JSON.stringify(pending.date_range)),{start,end});
        assert.match(pending.question,/qual dia da semana passada/i);
        const result=action(turn(reply,first.context).result);
        assert.equal(result.type,'update');if(result.type!=='update')throw new Error();
        assert.deepEqual(JSON.parse(JSON.stringify(result.changes)),{occurred_on:expected});
        assert.deepEqual(Array.from(result.transaction_ids),['101']);
        for(const invalid of ['01/10/2026','32/09','90','semana passada']) {
            const next=turn(invalid,first.context).result;
            assert.notEqual(next.status,'resolved',invalid);assert.equal(next.confidence.requiresFallback,false,invalid);
        }
    }
});
