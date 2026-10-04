import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert = require('node:assert/strict');
import {test} from 'node:test';

let parse: FinancialParser = () => {throw new Error('Parser não carregado');};
runInNewContext(['financial-parser','financial-context'].map(name=>readFileSync(resolve(__dirname, '../../static/js/'+name+'.js'), 'utf8')).join('\n') + '\ncapture(parseFinancialInput);', {
    capture: (parser: FinancialParser) => {parse = parser;}
});
const context: FinancialContext = {
    reference_date: '2026-10-01', time_zone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL',
    categories: [], transactions: [], deleted_transactions: [], transactions_complete: false,
    deleted_transactions_complete: false, recent_events: [], pending_clarification: null
};
function transaction(text: string, clock: FinancialContext = context): TransactionFields {
    const result = parse(text, clock);
    assert.equal(result.status, 'resolved');
    if (result.status !== 'resolved' || result.actions[0].type !== 'create') throw new Error(text);
    assert.equal(result.actions.length,1,text);
    return result.actions[0].transaction;
}

test('parser local interpreta exemplos simples sem executar transações', () => {
    for (const [text, kind, amount, description] of [
        ['Gastei 50','expense','50.00','Gasto'],
        ['Gastei 50 no mercado','expense','50.00','Mercado'],
        ['Recebi 100','income','100.00','Recebimento'],
        ['Recebi 1500 do trabalho','income','1500.00','Trabalho'],
        ['Paguei 80 na internet','expense','80.00','Internet'],
        ['Comprei algo por 120','expense','120.00','Algo']
    ]) {
        const value = transaction(text);
        assert.equal(value.kind, kind);assert.equal(value.amount, amount);assert.equal(value.description, description);
        assert.equal(value.category, '');assert.equal(value.occurred_on, context.reference_date);
    }
});

test('parser preserva reais, decimais, milhares e precisão monetária', () => {
    for (const [input, expected] of [
        ['200','200.00'],['200,50','200.50'],['200.50','200.50'],['R$ 200','200.00'],
        ['R$200','200.00'],['200 reais','200.00'],['200 real','200.00'],['200 conto','200.00'],
        ['1.200','1200.00'],['1.200,50','1200.50'],['1200,50','1200.50'],['1,5 mil','1500.00'],
        ['2 mil','2000.00'],['0,01','0.01'],['999.999.999.999,99','999999999999.99']
    ]) assert.equal(transaction('Gastei '+input).amount, expected, input);
    assert.equal(transaction('  EU   GASTEI R$200,50 no mercado! ').description, 'Mercado');
});

test('parser distingue quantidades de um preço total explícito', () => {
    assert.equal(transaction('Comprei 2 livros por 120').amount, '120.00');
    for (const text of ['Comprei 2 livros','Gastei 2 horas','Recebi 3 presentes','Comprei 120','Paguei 2 parcelas de 80','Gastei 50 e 20','Gastei 50 no mercado e um valor na farmácia']) {
        assert.notEqual(parse(text, context).status, 'resolved', text);
    }
});

test('parser não resolve valores inválidos, negações, datas e operações fora do escopo', () => {
    for (const text of ['', 'Não gastei 50','Se gastei 50','Gastei 50?','Gastei -50','Gastei 0',
        'Gastei 1000000000000','Gastei 1,234','Gastei 1.20.0','Gastei 50 dólares',
        'Apague tudo','Recebi 100 e talvez gastei 50']) {
        assert.notEqual(parse(text, context).status, 'resolved', text);
    }
    assert.equal(parse('Gastei 50', {...context,currency:'USD'}).status,'unrecognized');
    assert.equal(parse('Gastei 50', {...context,reference_date:'2026-02-30'}).status,'needs_clarification');
});

test('parser solicita valor ausente, é determinístico e não altera o contexto', () => {
    const original = JSON.stringify(context);
    const result = parse('Gastei no mercado', context);
    assert.equal(result.status,'needs_clarification');
    assert.equal(JSON.stringify(parse('Gastei 50', context)),JSON.stringify(parse('Gastei 50', context)));
    assert.equal(JSON.stringify(context),original);
});


const september: FinancialContext = {...context, reference_date: undefined, time_zone: undefined,
    currentDate: '2026-09-15', currentTime: '12:00:00', timezone: 'America/Sao_Paulo'};

test('datas relativas e dias da semana usam apenas o relógio fornecido', () => {
    for (const [expression, expected] of [
        ['hoje','2026-09-15'],['ontem','2026-09-14'],['anteontem','2026-09-13'],
        ['segunda','2026-09-14'],['terça','2026-09-15'],['quarta','2026-09-09'],
        ['quinta','2026-09-10'],['sexta','2026-09-11'],['sábado','2026-09-12'],['domingo','2026-09-13'],
        ['segunda passada','2026-09-14'],['terça passada','2026-09-08'],['segunda-feira passada','2026-09-14']
    ]) assert.equal(transaction('Gastei 50 no mercado '+expression, september).occurred_on, expected, expression);
    assert.equal(transaction('Gastei ontem 50 no mercado',september).description,'Mercado');
    assert.equal(transaction('Ontem gastei 50 no mercado',september).occurred_on,'2026-09-14');
    assert.equal(transaction('Gastei 50',september).occurred_on,'2026-09-15');
});

test('dia isolado usa mês atual ou anterior inclusive na virada de ano', () => {
    for (const [expression, expected] of [['dia 5','2026-09-05'],['dia 10','2026-09-10'],['dia 15','2026-09-15'],['dia 20','2026-08-20'],['dia 23','2026-08-23']]) {
        assert.equal(transaction('Paguei 80 na internet '+expression,september).occurred_on,expected);
    }
    assert.equal(transaction('Gastei 50 dia 20',{...september,currentDate:'2026-01-15'}).occurred_on,'2025-12-20');
    assert.equal(transaction('Gastei 50 ontem',{...september,currentDate:'2026-01-01'}).occurred_on,'2025-12-31');
});

test('datas numéricas e por extenso validam ano, mês e dia', () => {
    for (const expression of ['05/09','05/09/2026','5 de setembro','5 de setembro de 2026','no dia 5 de setembro']) {
        assert.equal(transaction('Gastei 50 '+expression,september).occurred_on,'2026-09-05');
    }
    assert.equal(transaction('Gastei 50 em 05/12',september).occurred_on,'2025-12-05');
    assert.equal(transaction('Gastei 50 em 29/02/2024',september).occurred_on,'2024-02-29');
    for (const expression of ['31/09','29/02/2025','31 de abril','dia 32','semana passada','mês passado','amanhã','20/09/2026','hoje ou ontem','05/09/26','5 de desconhecido']) {
        assert.equal(parse('Gastei 50 '+expression,september).status,'needs_clarification',expression);
    }
    assert.equal(parse('Gastei 50 dia 31',{...september,currentDate:'2026-03-15'}).status,'needs_clarification');
});

test('instante fornecido respeita São Paulo e não o fuso da máquina', () => {
    const clock: FinancialContext = {...september,currentDate:undefined,currentTime:'2026-10-01T01:30:00Z'};
    assert.equal(transaction('Gastei 50 hoje',clock).occurred_on,'2026-09-30');
    assert.equal(transaction('Gastei 50 ontem',clock).occurred_on,'2026-09-29');
    assert.equal(transaction('Gastei 50 hoje',{...clock,timezone:'UTC'}).occurred_on,'2026-10-01');
    assert.equal(transaction('Gastei 50',{...clock,timezone:undefined}).occurred_on,'2026-09-30');
    for (const invalid of [{...clock,timezone:'invalid'}, {...clock,currentTime:'2026-02-30T00:00:00Z'}, {...clock,currentDate:'2026-10-01'}, {...september,currentTime:'25:00'}, {...clock,currentTime:undefined}]) {
        assert.equal(parse('Gastei 50',invalid).status,'needs_clarification');
    }
});

test('cálculos usam centavos inteiros para juros, descontos e quantidades', () => {
    for (const [text, expected] of [
        ['Paguei 500 com 10% de juros','550.00'],['Paguei 500 mais 30 de juros','530.00'],
        ['Comprei por 500 com 10% de desconto','450.00'],['Comprei 3 camisetas de 40 cada','120.00'],
        ['Comprei 2 livros por 50 cada','100.00'],['Comprei 3 camisetas de R$ 40,50 cada','121.50'],
        ['Paguei 500 com 1,5% de juros','507.50'],['Paguei 0,05 com 10% de juros','0.06'],
        ['Comprei por 0,05 com 10% de desconto','0.05'],['Paguei 500 com 0% de juros','500.00']
    ]) assert.equal(transaction(text,september).amount,expected,text);
    const value=transaction('Comprei 3 camisetas de 40 cada ontem',september);
    assert.equal(value.description,'Camisetas');assert.equal(value.occurred_on,'2026-09-14');
    assert.equal(transaction('Paguei 500 na internet com 10% de juros dia 5',september).description,'Internet');
    for (const text of ['Comprei por 500 com 110% de desconto','Comprei por 500 com 100% de desconto',
        'Paguei 500 com -10% de juros','Paguei 500 com 10% de juros e 5% de desconto',
        'Comprei 0 camisetas de 40 cada','Comprei 3 camisetas de 999999999999 cada']) {
        assert.equal(parse(text,september).status,'needs_clarification',text);
    }
});


function transactions(text: string): TransactionFields[] {
    const result = parse(text, september);
    assert.equal(result.status,'resolved',text);
    if(result.status !== 'resolved')throw new Error(text);
    return Array.from(result.actions, action=>{
        if(action.type !== 'create')throw new Error('Expected create');
        return {...action.transaction};
    });
}

test('eventos independentes herdam tipo sem dividir descrições ou decimais', () => {
    assert.deepEqual(transactions('Gastei 30 no almoço e 20 no ônibus').map(t=>[t.kind,t.amount,t.description]),
        [['expense','30.00','Almoço'],['expense','20.00','Ônibus']]);
    assert.deepEqual(transactions('Gastei 100 no mercado e recebi 20 do João').map(t=>[t.kind,t.amount,t.description]),
        [['expense','100.00','Mercado'],['income','20.00','João']]);
    for(const text of ['Gastei 30,50 no almoço e 20,25 no ônibus','Gastei R$30,50 no almoço, R$20,25 no ônibus']) {
        assert.deepEqual(transactions(text).map(t=>t.amount),['30.50','20.25']);
    }
    assert.equal(transactions('Gastei 50 no pão e café').length,1);
    assert.equal(transactions('Gastei 50 no pão, café e leite')[0].description,'Pão, café e leite');
    assert.deepEqual(transactions('Recebi 100 do João e 200 da Maria').map(t=>t.kind),['income','income']);
});

test('data inicial é compartilhada e datas locais permanecem independentes', () => {
    const events=transactions('Ontem gastei 30 no almoço, 12 no café e recebi 150 do João');
    assert.deepEqual(events.map(t=>[t.kind,t.amount,t.description,t.occurred_on]),[
        ['expense','30.00','Almoço','2026-09-14'],['expense','12.00','Café','2026-09-14'],['income','150.00','João','2026-09-14']]);
    assert.deepEqual(transactions('Gastei 30 ontem no almoço e recebi 150 hoje do João').map(t=>t.occurred_on),['2026-09-14','2026-09-15']);
});

test('compensações explícitas produzem somente a despesa líquida', () => {
    for(const [text, amount, description] of [
        ['Perdi 200 reais em aposta e recebi 50 de volta','150.00','Aposta'],
        ['Gastei 100 mas recebi 20 de reembolso','80.00','Gasto'],
        ['Comprei por 300 e me devolveram 50','250.00','Compra'],
        ['Gastei 100 e recuperei 20','80.00','Gasto'],
        ['Gastei 100 e retornaram 20','80.00','Gasto'],
        ['Gastei 100 e voltou 20','80.00','Gasto'],
        ['Paguei 100 e recebi 20 de estorno','80.00','Pagamento'],
        ['Gastei 100 e devolveram 20','80.00','Gasto'],
        ['Gastei 100 e recebi 20 como reembolso','80.00','Gasto'],
        ['Gastei 100,50 e recebi 20,25 de volta','80.25','Gasto'],
        ['Gastei 100 e recuperei 20 e recebi 10 de volta','70.00','Gasto']
    ]) {
        const events=transactions(text);assert.equal(events.length,1,text);
        assert.equal(events[0].kind,'expense');assert.equal(events[0].amount,amount,text);assert.equal(events[0].description,description);
    }
    assert.equal(transactions('Gastei 100 ontem e recebi 20 de volta')[0].occurred_on,'2026-09-14');
});

test('reembolso não vincula fontes ou eventos independentes', () => {
    for(const text of [
        'Gastei 100 no mercado e recebi 20 do João',
        'Gastei 100 no mercado mas recebi 20 do trabalho',
        'Gastei 100 e recebi 20',
        'Perdi 200 em aposta e recebi 50 de salário'
    ]) assert.equal(transactions(text).length,2,text);
    for(const text of [
        'Gastei 100 no mercado e recebi 20 de reembolso da farmácia',
        'Gastei 100 e recuperei 20 do João',
        'Gastei 100 e recebi 20 de volta do João',
        'Gastei 100 e me devolveram 20 de outra compra',
        'Gastei 100 e 50 no ônibus e recebi 20 de reembolso',
        'Recebi 100 e gastei 50 e recebi 20 de volta',
        'Gastei 100 ontem e recebi 20 de volta hoje',
        'Recebi 100 e recebi 20 de volta',
        'Recebi 20 de reembolso',
        'Gastei 100 e recebi 20 de reembolso e 10 de estorno'
    ]) assert.equal(parse(text,september).status,'needs_clarification',text);
});

test('compensações inválidas não geram ações parciais nem valores negativos', () => {
    for(const text of ['Gastei 100 e recebi 100 de volta','Gastei 100 e recebi 101 de volta',
        'Gastei 100 e me devolveram -20','Gastei 100 e recebi 0 de volta',
        'Gastei 100 e recebi 20 e 30 de volta','Gastei 30 no almoço e paguei algo',
        'Gastei 30 no almoço e recebi 20 amanhã','Gastei 100 e não recebi 20 de volta']) {
        const result=parse(text,september);assert.notEqual(result.status,'resolved',text);assert(!('actions' in result));
    }
});

test('cálculos por evento e herança de tipo permanecem separados', () => {
    assert.deepEqual(transactions('Paguei 500 com 10% de juros e 20 no ônibus').map(t=>t.amount),['550.00','20.00']);
    assert.deepEqual(transactions('Comprei 3 camisetas de 40 cada e recebi 200 do trabalho').map(t=>t.amount),['120.00','200.00']);
    assert.equal(transactions('Comprei 3 camisetas de 40 cada e recebi 20 de volta')[0].amount,'100.00');
    assert.equal(transactions('Paguei 500 com 10% de juros e recebi 50 de estorno')[0].amount,'500.00');
    assert.deepEqual(transactions('Gastei 100 e recebi 20 de volta e paguei 30 no ônibus').map(t=>t.amount),['80.00','30.00']);
});


test('resultado de múltiplos eventos é atômico, determinístico e não altera contexto', () => {
    const before=JSON.stringify(september);
    const text='Ontem perdi 200 em aposta e recebi 50 de volta e paguei 20 no ônibus';
    const first=parse(text,september),second=parse(text,september);
    assert.equal(JSON.stringify(first),JSON.stringify(second));assert.equal(JSON.stringify(september),before);
    assert.deepEqual(transactions(text).map(t=>[t.amount,t.occurred_on]),[['150.00','2026-09-14'],['20.00','2026-09-14']]);
    for(const invalid of ['Gastei 30 no almoço e 20 de desconto','Gastei 30 no almoço e paguei -20',
        'Gastei 30 no almoço e paguei 20 dia 32','Gastei 30 no almoço e recebi 20 de reembolso da farmácia']) {
        const result=parse(invalid,september);assert.notEqual(result.status,'resolved',invalid);assert(!('actions' in result));
    }
});


test('confiança permite execução local de frases simples, cálculos e múltiplos eventos sem IA',()=>{
    for(const text of ['Gastei 50 no mercado','Recebi 100 ontem','Paguei 200 de internet',
        'Gastei 30 no almoço e 20 no ônibus','Comprei 3 camisetas de 40 cada',
        'Paguei 500 com 10% de juros','Perdi 200 reais em aposta e recebi 50 de volta',
        'Comprei 2 livros por 120','Gastei 200,50 no pão e café','Gastei 50 dia 5']) {
        const result=parse(text,september), confidence=result.confidence;
        assert.equal(result.status,'resolved',text);
        assert.equal(confidence.canExecuteLocally,true,text);assert.equal(confidence.requiresFallback,false,text);
        for(const field of ['intentCertain','amountCertain','dateCertain','typeCertain','descriptionCertain','referenceCertain','calculationCertain'] as const) assert.equal(confidence[field],true,`${text}: ${field}`);
        assert.equal(confidence.multiplePossibleTargets,false);assert.equal(confidence.unknownNumbers,false);
        assert.equal(confidence.hasAmbiguity,false);assert.deepEqual(Array.from(confidence.reasons),[]);
    }
});

test('categoria vazia ou desconhecida e descrição padrão não provocam fallback',()=>{
    for(const text of ['Gastei 50','Recebi 100','Gastei 50 no bazar do Zé','Paguei 200 de internet']) {
        const result=parse(text,{...september,categories:['Saúde']});
        assert.equal(result.status,'resolved',text);assert.equal(result.confidence.requiresFallback,false);
        if(result.status!=='resolved'||result.actions[0].type!=='create')throw new Error();
        assert.equal(result.actions[0].transaction.category,'');
    }
});

test('frases incomuns e relações semânticas não cobertas solicitam fallback sem ações parciais',()=>{
    for(const text of ['Saíram cinquenta reais da minha carteira para o mercado',
        'Quitei a internet por duzentos reais',
        'Gastei 50 no mercado usando metade do vale','Gastei 50 no mercado que o João vai reembolsar',
        'Gastei 50 no mercado aproximadamente','Gastei 50 no mercado; recebi 100 do João',
        'Gastei 50 no mercado na data combinada','Gastei 50 no mercado a dividir entre amigos']) {
        const result=parse(text,september);
        assert.equal(result.status,'needs_fallback',text);
        assert.equal(result.confidence.canExecuteLocally,false,text);assert.equal(result.confidence.requiresFallback,true,text);
        assert(result.confidence.reasons.length>0);assert(!('actions' in result));
    }
});

test('incerteza em valores, cálculos, datas ou campos obrigatórios sinaliza fallback',()=>{
    for(const [text,field] of [
        ['Gastei no mercado','amountCertain'],
        ['Gastei cinquenta no mercado','amountCertain'],
        ['Gastei 50 no mercado e 20','amountCertain'],
        ['Gastei 50 semana passada','dateCertain'],
        ['Gastei 50 hoje ou ontem','dateCertain'],
        ['Paguei 500 com 10% de juros e 5% de desconto','calculationCertain'],
        ['Gastei 100 e recebi 20 de reembolso da farmácia','referenceCertain']
    ] as const){
        const result=parse(text,september);
        assert.notEqual(result.status,'resolved',text);assert(!('actions' in result));
        assert.equal(result.confidence[field],false,text);assert.equal(result.confidence.requiresFallback,true,text);
        assert.equal(result.confidence.hasAmbiguity,true,text);
    }
    const numbers=parse('Gastei 50 no mercado e 20',september).confidence;
    assert.equal(numbers.unknownNumbers,true);assert(numbers.reasons.includes('unknown_numbers'));
});

test('ambiguidade real e contexto difícil não autorizam a IA a inventar alvos',()=>{
    const market:StoredTransaction={id:'1',kind:'expense',amount:'50.00',description:'Mercado',category:'',occurred_on:'2026-09-14',currency:'BRL',deleted_at:null};
    const ctx={...september,transactions:[market,{...market,id:'2',amount:'80.00'}],transactions_complete:true};
    const ambiguous=parse('Apaga o mercado de ontem',ctx);
    assert.equal(ambiguous.status,'needs_clarification');assert.equal(ambiguous.confidence.requiresFallback,true);
    assert.equal(ambiguous.confidence.multiplePossibleTargets,true);assert.equal(ambiguous.confidence.referenceCertain,false);
    assert.equal(ambiguous.confidence.intentCertain,true);assert.equal(ambiguous.confidence.amountCertain,true);
    if(ambiguous.status!=='needs_clarification')throw new Error();
    assert.deepEqual(Array.from(ambiguous.clarification.candidate_ids),['1','2']);assert(!('actions' in ambiguous));
    const resolved=parse('A de 80',{...ctx,pending_clarification:ambiguous.clarification});
    assert.equal(resolved.status,'resolved');assert.equal(resolved.confidence.requiresFallback,false);
    const difficult=parse('Muda aquela compra que fiz junto com ele para 90',ctx);
    assert.notEqual(difficult.status,'resolved');assert.equal(difficult.confidence.requiresFallback,true);
    const update=parse('Na verdade foram 90',{...ctx,last_mentioned_transaction_ids:['1']});
    assert.equal(update.status,'resolved');assert.equal(update.confidence.requiresFallback,false);
    const partial=parse('Apaga o mercado',{...ctx,transactions:[market],transactions_complete:false});
    assert.equal(partial.confidence.referenceCertain,false);assert.equal(partial.confidence.requiresFallback,true);
    assert.equal(partial.confidence.multiplePossibleTargets,false);
});

test('pedidos negados, hipotéticos e inválidos por política não disparam fallback automático',()=>{
    for(const text of ['Não gastei 50','Talvez apague ela','Se gastei 50','Gastei 50?','']) {
        const result=parse(text,september);
        assert.equal(result.status,'unrecognized',text);assert.equal(result.confidence.requiresFallback,false,text);
        assert.equal(result.confidence.canExecuteLocally,false);assert(result.confidence.reasons.includes('rejected_input'));
    }
    assert.equal(parse('Gastei 50',{...september,currency:'USD'}).confidence.requiresFallback,false);
});


test('auditoria: todos os exemplos financeiros exigidos resolvem localmente com valores exatos', () => {
    const cases: readonly [string, readonly [Transaction['kind'], string, string][]][] = [
        ['Gastei 67 reais no mercado ontem', [['expense','67.00','Mercado']]],
        ['Gastei 200 no mercado', [['expense','200.00','Mercado']]],
        ['Recebi 1500 do trabalho', [['income','1500.00','Trabalho']]],
        ['Gastei 30 no almoço e 20 no ônibus', [['expense','30.00','Almoço'],['expense','20.00','Ônibus']]],
        ['Recebi 100 e gastei 30', [['income','100.00','Recebimento'],['expense','30.00','Gasto']]],
        ['Perdi 200 em aposta e recebi 50 de volta', [['expense','150.00','Aposta']]],
        ['Gastei 100 mas recebi 20 de reembolso', [['expense','80.00','Gasto']]],
        ['Gastei 100 no mercado e recebi 20 do João', [['expense','100.00','Mercado'],['income','20.00','João']]],
        ['Paguei 500 com 10% de juros', [['expense','550.00','Pagamento']]],
        ['Paguei 500 com 10% de desconto', [['expense','450.00','Pagamento']]],
        ['Comprei 3 produtos de 20 cada', [['expense','60.00','Produtos']]],
        ['Comprei 2 pizzas por 80', [['expense','80.00','2 pizzas']]],
        ['Abasteci 20 litros por 120', [['expense','120.00','20 litros']]],
        ['Recebi 1,5 mil', [['income','1500.00','Recebimento']]],
        ['Gastei 1.250,90', [['expense','1250.90','Gasto']]]
    ];
    for (const [text, expected] of cases) {
        const parsed = parse(text, september);
        assert.equal(parsed.confidence.requiresFallback, false, text);
        assert.equal(parsed.confidence.canExecuteLocally, true, text);
        assert.deepEqual(transactions(text).map(row => [row.kind,row.amount,row.description]), expected, text);
        assert.deepEqual(transactions(text).map(row => row.occurred_on), expected.map(() => text.endsWith('ontem') ? '2026-09-14' : '2026-09-15'), text);
    }
});

test('auditoria: combustível mantém quantidade separada do total e nunca inventa preço', () => {
    assert.deepEqual(transactions('Abasteci 20 litros por 120 e 30 no pedágio').map(row => row.amount), ['120.00','30.00']);
    assert.equal(transaction('Abasteci por 120').description, 'Abastecimento');
    for (const text of ['Abasteci 20 litros','Abasteci 20','Abasteci 20 litros por 120 e 30','Abasteci 20 litros por 120 reais com 10 litros']) {
        const result = parse(text, september);
        assert.notEqual(result.status, 'resolved', text);
        assert(!('actions' in result), text);
    }
});

test('auditoria: calendário inclui viradas de mês/ano, séculos bissextos e dias inválidos', () => {
    for (const [currentDate, expression, expected] of [
        ['2026-03-01','ontem','2026-02-28'],
        ['2024-03-01','ontem','2024-02-29'],
        ['2024-03-01','anteontem','2024-02-28'],
        ['2026-01-01','anteontem','2025-12-30'],
        ['2026-01-01','dia 31','2025-12-31'],
        ['2024-03-15','dia 29','2024-02-29'],
        ['2000-03-01','29/02/2000','2000-02-29'],
        ['2026-01-01','31/12','2025-12-31']
    ]) assert.equal(transaction('Gastei 10 '+expression,{...september,currentDate}).occurred_on, expected, currentDate+' '+expression);
    for (const [currentDate, expression] of [
        ['2026-03-15','dia 29'],['2026-03-15','dia 31'],['2100-03-01','29/02/2100'],
        ['2026-10-01','00/09'],['2026-10-01','01/00'],['2026-10-01','01/13'],
        ['2026-10-01','dia 0'],['2026-10-01','32/01'],['2026-10-01','31 de novembro']
    ]) {
        const result = parse('Gastei 10 '+expression,{...september,currentDate});
        assert.equal(result.status,'needs_clarification',currentDate+' '+expression);
        assert(!('actions' in result));
    }
});


test('frases variadas de compra, ganho e perda mantêm natureza e valor corretos',()=>{
    for(const [input,kind,amount,description] of [
        ['Comprei um salgado de 10 reais hoje','expense','10.00','Salgado'],
        ['Comprei uma coxinha de R$8,50 ontem','expense','8.50','Coxinha'],
        ['Comprei 1 lanche de 15 reais','expense','15.00','Lanche'],
        ['Comprei uma pizza por 40','expense','40.00','Pizza'],
        ['Eu comprei um café de 2,50 reais','expense','2.50','Café'],
        ['Lucrei 200 com vendas','income','200.00','Vendas'],
        ['Lucrei R$1.250,90 hoje','income','1250.90','Lucro'],
        ['Ontem lucrei 1,5 mil','income','1500.00','Lucro'],
        ['Ganhei 100 de presente','income','100.00','Presente'],
        ['Ganhei 500 do trabalho','income','500.00','Trabalho'],
        ['Perdi 40 na rua','expense','40.00','Rua'],
        ['Perdi 200 em aposta','expense','200.00','Aposta'],
        ['Comprei 3 camisetas de 40 cada','expense','120.00','Camisetas']
    ] as const) {
        const parsed=parse(input,september);assert.equal(parsed.confidence.requiresFallback,false,input);
        const row=transaction(input,september);
        assert.deepEqual([row.kind,row.amount,row.description],[kind,amount,description],input);
        assert.equal(row.occurred_on,/ontem/i.test(input)?'2026-09-14':'2026-09-15');
    }
    for(const input of ['Lucrei 100 e gastei 30','Ganhei 100 e perdi 30','Recebi 100 e comprei um salgado de 30 reais']) {
        assert.deepEqual(transactions(input).map(row=>[row.kind,row.amount]),[['income','100.00'],['expense','30.00']],input);
    }
});

test('produto, quantidade ou gratuidade não são confundidos com dinheiro pago',()=>{
    for(const input of [
        'Comprei 2 salgados de 10 reais','Comprei dois salgados de 10 reais','Comprei uma caixa de 12 ovos',
        'Comprei um livro de 1984','Comprei um celular de 128 GB','Comprei 2 salgados',
        'Ganhei um salgado de 10 reais','Lucrei','Comprei um salgado de graça',
        'Comprei um salgado de 10 reais e outro valor no café','Lucrei 100 mas perdi um valor',
        'Talvez lucrei 100','Não comprei um salgado de 10 reais'
    ]) {
        const result=parse(input,september);assert.notEqual(result.status,'resolved',input);assert(!('actions' in result),input);
    }
});


test('ganho por extenso continua exigindo fallback sem perder o restante do lote',()=>{
    const input='Gastei 50 no mercado e ganhei vinte do João';
    const result=parse(input,september);
    assert.equal(result.status,'needs_clarification');
    assert.equal(result.confidence.requiresFallback,true);assert(!('actions' in result));
    if(result.status!=='needs_clarification')throw new Error();
    assert.equal(result.clarification.original_text,input);
    assert.equal(result.clarification.intent,null);
    assert.deepEqual(transactions('Perdi 200 em aposta e ganhei 50 de volta').map(row=>[row.kind,row.amount]),[['expense','150.00']]);
});
