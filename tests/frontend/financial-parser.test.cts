import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert = require('node:assert/strict');
import {test} from 'node:test';

let parse: FinancialParser = () => {throw new Error('Parser não carregado');};
runInNewContext(readFileSync(resolve(__dirname, '../../static/js/financial-parser.js'), 'utf8') + '\ncapture(parseFinancialInput);', {
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
