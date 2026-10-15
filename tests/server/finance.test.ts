import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateTransaction, summarize, localClock, transactionTitle, validId } from '../../server/finance/model';
import { requestHash, validateActions } from '../../server/finance/repository';
import { requestData, validateInterpretation, SCHEMA } from '../../server/finance/interpretation';

const payload = (changes: Record<string, unknown> = {}) => ({ external_id: 'bank-001', kind: 'income', amount: '100.10', description: 'Salário', category: 'Trabalho', occurred_on: '2026-01-15', ...changes });
const create = (changes: Record<string, unknown> = {}) => { const { external_id: _, ...transaction } = payload(changes); return { type: 'create', transaction }; };
const ready = () => ({ status: 'ready', actions: [{ type: 'create', transactionId: null, fields: { kind: 'expense', amount: '80.00', description: 'Mercado', category: null, occurred_on: '2026-09-30', occurred_time: null } }], clarification: null });

test('money validates decimal strings without floating point conversion', () => {
  for (const amount of ['0.01', '100.10', '999999999999.99']) assert.equal(validateTransaction(payload({ amount })).amount, amount);
  assert.equal(validateTransaction(payload({ amount: '01.1' })).amount, '1.10');
  for (const amount of ['NaN', 'Infinity', '-1', '0', '1.001', '1e3', '1,50', 12.5, true, '1000000000000']) assert.throws(() => validateTransaction(payload({ amount })), { status: 422 });
  for (const change of [{ occurred_on: '2999-01-01' }, { occurred_on: '2026-02-30' }, { occurred_on: '20260115' }, { occurred_on: '2025-02-29' }, { kind: 'transfer' }, { usuario_id: 9 }, { external_id: '' }, { category: null }]) assert.throws(() => validateTransaction(payload(change)), { status: 422 });
});

test('clock is Sao Paulo across month/year boundaries and updates preserve absent time', () => {
  assert.equal(localClock(new Date('2027-01-01T01:30:00Z')), '2026-12-31T22:30:00');
  assert.equal(localClock(new Date('2024-03-01T02:59:59Z')), '2024-02-29T23:59:59');
  assert.equal(validateTransaction(payload(), true, '2026-10-05T23:58:17').occurred_time, '23:58:17');
  assert.equal(validateTransaction(payload({ occurred_time: '09:15' })).occurred_time, '09:15:00');
  assert.equal(validateTransaction(payload(), false).occurred_time, null);
  for (const occurred_time of ['24:00', '09:60', '12:00:60', 'abc', 930, '', '9:00']) assert.throws(() => validateTransaction(payload({ occurred_time })), { status: 422 });
});

test('monthly totals, sparklines and percentages remain exact', () => {
  const data = summarize([
    { kind: 'income', amount: '100.10', occurred_on: '2026-01-31' },
    { kind: 'expense', amount: '10.05', occurred_on: '2026-02-01' },
    { kind: 'income', amount: '0.20', occurred_on: '2026-02-01' },
    { kind: 'income', amount: '5.00', occurred_on: '2026-02-03' },
  ], '2026-02-04');
  assert.equal(data.summary.balance.amount, '95.25');
  assert.equal(data.summary.income.amount, '5.20');
  assert.equal(data.summary.expense.amount, '10.05');
  assert.equal(data.summary.balance.difference, '-4.85');
  assert.equal(data.summary.balance.percentage, '-4.85');
  assert.equal(data.summary.expense.percentage, null);
  assert.equal(summarize([], '2024-02-29').summary.income.series.length, 29);
  const large = summarize([{ kind: 'income', amount: '999999999999.99', occurred_on: '2026-01-01' }, { kind: 'expense', amount: '0.01', occurred_on: '2026-01-01' }], '2026-01-01');
  assert.equal(large.summary.balance.amount, '999999999999.98');
});

test('same-time movements keep stable IDs, negative balances, deleted and future filtering', () => {
  const data = summarize([
    { id: '3', kind: 'expense', amount: '20', occurred_on: '2026-10-01', occurred_time: '23:30:00' },
    { id: '2', kind: 'income', amount: '30', occurred_on: '2026-10-01', occurred_time: '08:00:00' },
    { id: '1', kind: 'expense', amount: '100', occurred_on: '2026-10-01', occurred_time: '08:00:00' },
    { id: '4', kind: 'income', amount: '999', occurred_on: '2026-10-01', deleted_at: '2026-10-01T12:00:00Z' },
    { id: '5', kind: 'income', amount: '999', occurred_on: '2026-10-03' },
  ], '2026-10-02');
  assert.equal(data.summary.balance.amount, '-90.00');
});

test('titles retain mixed-case names and remove redundant natural-language amounts', () => {
  for (const [raw, expected] of [['Gastei 67 reais no mercado ontem', 'Mercado'], ['gastei 200 reais no presente do ravi', 'Presente do Ravi'], ['farmácia', 'Farmácia'], ['ganhei 200 reais ontem', 'Ganhei'], ['Compra no iFood', 'Compra no iFood']]) assert.equal(transactionTitle(raw), expected);
});

test('action validation rejects duplicate, foreign fields and unconfirmed permanent deletion', () => {
  const operation_id = randomUUID();
  for (const actions of [[], [create({ amount: 'NaN' })], [{ type: 'update', transaction_ids: ['1'], changes: { usuario_id: 9 } }], [{ type: 'delete', transaction_ids: ['1 OR 1=1'] }], [{ type: 'delete', transaction_ids: ['1', '1'] }], [{ type: 'delete', transaction_ids: ['1'] }, { type: 'restore', transaction_ids: ['1'] }], [{ type: 'permanent_delete', transaction_ids: ['1'] }]]) assert.throws(() => validateActions({ operation_id, actions }), { status: 422 });
  assert.equal(validateActions({ operation_id, actions: [{ type: 'permanent_delete', transaction_ids: ['1'], confirmation: 'explicit_permanent_delete' }] }).actions.length, 1);
  assert.equal(validateActions({ operation_id, actions: [{ type: 'delete', transaction_ids: Array.from({ length: 101 }, (_, index) => String(index + 1)) }] }).actions.length, 1);
  assert.throws(() => validateActions({ operation_id, actions: [{ type: 'delete', transaction_ids: Array.from({ length: 101 }, (_, index) => String(index + 1)) }, create()] }), { status: 422 });
  assert.equal(validId('9223372036854775807'), true);
  assert.equal(validId('9223372036854775808'), false);
});

test('request digest stays compatible with existing canonical financial operations', () => {
  const actions = [create({ description: 'Farmácia 🛒' })];
  assert.equal(requestHash(actions), requestHash([{ transaction: actions[0].transaction, type: 'create' }]));
  assert.notEqual(requestHash(actions), requestHash([create({ amount: '1.00' })]));
});

test('financial context rejects impersonation, injected clocks and excessive references', () => {
  const input = { input: 'Paguei metade de 160 no mercado', provider: 'qwen' };
  for (const payload of [null, [], {}, { ...input, input: ' ' }, { ...input, input: 'x'.repeat(1001) }, { ...input, provider: 'https://attacker.invalid' }, { ...input, currentDate: '2099-01-01' }, { ...input, conversation_context: { transactions: [] } }, { ...input, conversation_context: { last_mentioned_transaction_ids: [1] } }, { ...input, conversation_context: { last_mentioned_transaction_ids: ['1 OR 1=1'] } }, { ...input, pending_clarification: { reason: 'ambiguous_target', missing_fields: [null] } }]) assert.throws(() => requestData(payload, ['qwen']), { status: 422 });
  assert.throws(() => requestData({ ...input, conversation_context: { last_mentioned_transaction_ids: Array.from({ length: 100 }, (_, index) => String(index + 1)), last_created_transaction_ids: ['101'] } }, ['qwen']), { status: 422 });
});

test('structured interpretations fail closed for malformed and partial batches', () => {
  assert.deepEqual(validateInterpretation(ready()), ready());
  assert.deepEqual(validateInterpretation({ status: 'needs_clarification', actions: [], clarification: 'Qual valor?' }), { status: 'needs_clarification', actions: [], clarification: 'Qual valor?' });
  for (const value of [null, [], {}, { ...ready(), status: [] }, { ...ready(), actions: [] }, { ...ready(), actions: [{ type: 'create' }] }, { ...ready(), status: 'needs_clarification', clarification: 'Qual valor?' }, { ...ready(), clarification: 'Qual?' }, { ...ready(), extra: 'SQL' }]) assert.throws(() => validateInterpretation(value), { status: 502, code: 'invalid_response' });
  for (const field of ['kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time']) {
    const response = ready();
    Object.assign(response.actions[0].fields, { [field]: {} });
    assert.throws(() => validateInterpretation(response), { status: 502 });
  }
  assert.equal(SCHEMA.additionalProperties, false);
  assert.equal(SCHEMA.properties.actions.maxItems, 100);
});
