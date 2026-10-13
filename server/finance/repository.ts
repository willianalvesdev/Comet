import { createHash } from 'node:crypto';
import { query, transaction } from '../db';
import { ApiError } from '../http';
import { dateString, fields, invalid, isObject, localClock, localDay, serialize, summarize, timestampString, validDay, validId, validateTransaction, type Transaction, type TransactionRow } from './model';

type Query = typeof query;
type Db = { query: Query };
type Action = { type: 'create'; transaction: Record<string, unknown> } | { type: 'update' | 'delete' | 'restore' | 'permanent_delete'; transaction_ids: string[]; changes?: Record<string, unknown>; confirmation?: string };
const idOrder = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const sameKeys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const insertSql = 'INSERT INTO finance_transactions (usuario_id, external_id, kind, amount, description, category, occurred_on, occurred_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
const dataValues = (values: Transaction) => fields.map(key => values[key]);
const normalizeRow = (row: TransactionRow): TransactionRow => ({ ...row, occurred_on: dateString(row.occurred_on), occurred_time: row.occurred_time ?? null });

async function recordEvent(db: Db, userId: number, operationId: string | null, transactionId: string, event: string, before: unknown, after: unknown, timestamp = new Date()) {
  await db.query('INSERT INTO finance_transaction_events (usuario_id, operation_id, transaction_id, event, occurred_at, before_json, after_json) VALUES ($1,$2,$3,$4,$5,$6,$7)', [userId, operationId, transactionId, event, timestamp, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)]);
}

export async function receive(userId: number, payload: unknown) {
  const values = validateTransaction(payload);
  return transaction(async db => {
    const inserted = await db.query<TransactionRow>(insertSql + ' ON CONFLICT (usuario_id, external_id) DO NOTHING RETURNING *', [userId, ...dataValues(values)]);
    if (inserted[0]) {
      const { external_id: _, ...after } = values;
      await recordEvent(db, userId, null, String(inserted[0].id), 'TRANSACTION_CREATED', null, after);
      return { transaction: serialize(inserted[0]), created: true };
    }
    const [stored] = await db.query<TransactionRow>('SELECT * FROM finance_transactions WHERE usuario_id=$1 AND external_id=$2 FOR UPDATE', [userId, values.external_id]);
    const existing = stored && normalizeRow(stored);
    if (!existing || fields.some(key => (key !== 'occurred_time' || (payload as Record<string, unknown>).occurred_time != null) && existing[key] !== values[key])) throw new ApiError(409, 'external_id já utilizado com dados diferentes.');
    return { transaction: serialize(existing), created: false };
  });
}

export async function history(userId: number, limit = 30, before: string | null = null, state = 'active') {
  if (!['active', 'deleted'].includes(state)) invalid('Estado de transação inválido.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit deve estar entre 1 e 100.');
  let condition = ' AND deleted_at IS ' + (state === 'active' ? 'NULL' : 'NOT NULL');
  const params: unknown[] = [userId];
  if (before) {
    const [day, identifier, extra] = before.split(':');
    if (extra !== undefined || !validDay(day) || !validId(identifier)) invalid('Cursor inválido.');
    condition += ' AND (occurred_on < $2 OR (occurred_on=$2 AND id < $3))';
    params.push(day, identifier);
  }
  params.push(limit + 1);
  const rows = await query<TransactionRow>('SELECT * FROM finance_transactions WHERE usuario_id=$1' + condition + ` ORDER BY occurred_on DESC, id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, limit), last = page.at(-1);
  return { transactions: page.map(serialize), next_cursor: rows.length > limit && last ? `${dateString(last.occurred_on)}:${last.id}` : null };
}

export async function dashboard(userId: number) {
  const today = localDay();
  const rows = await query<TransactionRow>('SELECT * FROM finance_transactions WHERE usuario_id=$1 AND deleted_at IS NULL AND occurred_on<=$2 ORDER BY occurred_on, id', [userId, today]);
  return summarize(rows, today);
}

export function validateActions(payload: unknown, now = localClock()): { operationId: string; actions: Action[] } {
  if (!isObject(payload) || !sameKeys(payload, ['operation_id', 'actions'])) invalid('Envie operation_id e actions.');
  if (typeof payload.operation_id !== 'string') invalid('Identificador da operação inválido.');
  const hex = payload.operation_id.replace(/^urn:uuid:/i, '').replace(/[{}-]/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) invalid('Identificador da operação inválido.');
  const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
  if (!Array.isArray(payload.actions) || payload.actions.length < 1 || payload.actions.length > 100) invalid('Envie de 1 a 100 ações.');
  const actions = payload.actions;
  const bulkLifecycle = actions.length === 1 && isObject(actions[0]) && ['delete', 'restore'].includes(String(actions[0].type));
  const seen = new Set<string>();
  for (const action of actions) {
    if (!isObject(action)) invalid('Ação inválida.');
    const kind = action.type;
    if (kind === 'create') {
      if (!sameKeys(action, ['type', 'transaction']) || !isObject(action.transaction) || 'external_id' in action.transaction) invalid('Criação inválida.');
      validateTransaction({ ...action.transaction, external_id: operationId }, true, now);
      continue;
    }
    if (typeof kind !== 'string' || !['update', 'delete', 'restore', 'permanent_delete'].includes(kind)) invalid('Operação inválida.');
    const keys = ['type', 'transaction_ids', ...(kind === 'update' ? ['changes'] : kind === 'permanent_delete' ? ['confirmation'] : [])];
    if (!sameKeys(action, keys)) invalid('Campos da ação inválidos.');
    if (kind === 'permanent_delete' && action.confirmation !== 'explicit_permanent_delete') invalid('A exclusão permanente exige um pedido explícito.');
    const ids = action.transaction_ids;
    if (!Array.isArray(ids) || !ids.length || (!bulkLifecycle && ids.length > 100) || !ids.every(validId)) invalid('IDs de transações inválidos.');
    for (const id of ids) {
      if (seen.has(id)) invalid('Uma transação não pode aparecer duas vezes no mesmo pedido.');
      seen.add(id);
    }
    if (kind === 'update' && (!isObject(action.changes) || !Object.keys(action.changes).length || Object.keys(action.changes).some(key => key === 'external_id' || !(fields as readonly string[]).includes(key)))) invalid('Alterações inválidas.');
  }
  if (!bulkLifecycle && seen.size > 100) invalid('Limite de 100 transações por pedido.');
  return { operationId, actions: actions as Action[] };
}

export function requestHash(value: unknown): string {
  const pythonJson = (item: unknown): string => {
    if (Array.isArray(item)) return '[' + item.map(pythonJson).join(', ') + ']';
    if (isObject(item)) return '{' + Object.keys(item).sort().map(key => pythonJson(key) + ': ' + pythonJson(item[key])).join(', ') + '}';
    return JSON.stringify(item).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  };
  return createHash('sha256').update(pythonJson(value)).digest('hex');
}

export async function executeActions(userId: number, payload: unknown) {
  const now = localClock();
  const { operationId, actions } = validateActions(payload, now);
  const digest = requestHash(actions);
  return transaction(async db => {
    await db.query('INSERT INTO finance_operations (usuario_id, operation_id, request_hash) VALUES ($1,$2,$3) ON CONFLICT (usuario_id, operation_id) DO NOTHING', [userId, operationId, digest]);
    const [previous] = await db.query<{ request_hash: string; result: unknown }>('SELECT request_hash, result FROM finance_operations WHERE usuario_id=$1 AND operation_id=$2 FOR UPDATE', [userId, operationId]);
    if (previous.request_hash !== digest) throw new ApiError(409, 'Este pedido já foi utilizado com outras ações.');
    if (previous.result != null) return typeof previous.result === 'string' ? JSON.parse(previous.result) : previous.result;
    const targetActions = new Map<string, Exclude<Action, { type: 'create' }>>();
    for (const action of actions) if (action.type !== 'create') for (const id of action.transaction_ids) targetActions.set(id, action);
    const targets = new Map<string, TransactionRow>(), updates = new Map<string, Transaction>();
    for (const identifier of [...targetActions.keys()].sort(idOrder)) {
      const action = targetActions.get(identifier)!;
      const [stored] = await db.query<TransactionRow>('SELECT * FROM finance_transactions WHERE usuario_id=$1 AND id=$2 FOR UPDATE', [userId, identifier]);
      if (!stored) throw new ApiError(409, 'A transação não está mais disponível nesta conta. Atualize os dados.');
      const row = normalizeRow(stored), deleted = row.deleted_at != null;
      if (['update', 'delete'].includes(action.type) && deleted) throw new ApiError(409, 'Esta transação está na lixeira. Restaure antes de alterá-la.');
      if (['restore', 'permanent_delete'].includes(action.type) && !deleted) throw new ApiError(409, 'Esta transação não está na lixeira.');
      targets.set(identifier, row);
      if (action.type === 'update') updates.set(identifier, validateTransaction({ ...Object.fromEntries(fields.map(key => [key, row[key]])), ...action.changes }, false, now));
    }
    const operations: { type: string; transaction_ids: string[] }[] = [];
    for (const [index, action] of actions.entries()) {
      const kind = action.type, ids: string[] = [];
      if (action.type === 'create') {
        const values = validateTransaction({ ...action.transaction, external_id: `${operationId}:${index}` }, true, now);
        const [created] = await db.query<{ id: string }>(insertSql + ' RETURNING id', [userId, ...dataValues(values)]);
        const identifier = String(created.id), { external_id: _, ...after } = values;
        await recordEvent(db, userId, operationId, identifier, 'TRANSACTION_CREATED', null, after);
        ids.push(identifier);
      } else {
        for (const identifier of [...action.transaction_ids].sort(idOrder)) {
          const row = targets.get(identifier)!, timestamp = new Date();
          let before: Record<string, unknown> | null = null, after: Record<string, unknown> | null = null;
          if (kind === 'update') {
            const values = updates.get(identifier)!;
            await db.query('UPDATE finance_transactions SET kind=$1, amount=$2, description=$3, category=$4, occurred_on=$5, occurred_time=$6 WHERE usuario_id=$7 AND id=$8', [...fields.slice(1).map(key => values[key]), userId, identifier]);
            const changed = fields.filter(key => key !== 'external_id' && row[key] !== values[key]);
            before = Object.fromEntries(changed.map(key => [key, row[key]]));
            after = Object.fromEntries(changed.map(key => [key, values[key]]));
          } else if (kind === 'delete') {
            await db.query('UPDATE finance_transactions SET deleted_at=$1 WHERE usuario_id=$2 AND id=$3', [timestamp, userId, identifier]);
            before = { deleted_at: null }; after = { deleted_at: timestamp.toISOString() };
          } else if (kind === 'restore') {
            await db.query('UPDATE finance_transactions SET deleted_at=NULL WHERE usuario_id=$1 AND id=$2', [userId, identifier]);
            before = { deleted_at: timestampString(row.deleted_at!) }; after = { deleted_at: null };
          } else {
            await db.query('DELETE FROM finance_transactions WHERE usuario_id=$1 AND id=$2 AND deleted_at IS NOT NULL', [userId, identifier]);
          }
          const event = { update: 'TRANSACTION_UPDATED', delete: 'TRANSACTION_DELETED', restore: 'TRANSACTION_RESTORED', permanent_delete: 'TRANSACTION_PERMANENTLY_DELETED' }[action.type];
          await recordEvent(db, userId, operationId, identifier, event, before, after, timestamp);
          ids.push(identifier);
        }
      }
      operations.push({ type: kind, transaction_ids: ids });
    }
    const result = { operation_id: operationId, operations };
    await db.query('UPDATE finance_operations SET result=$1 WHERE usuario_id=$2 AND operation_id=$3', [JSON.stringify(result), userId, operationId]);
    return result;
  });
}
