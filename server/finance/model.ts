import { ApiError } from '../http';

export const fields = ['external_id', 'kind', 'amount', 'description', 'category', 'occurred_on', 'occurred_time'] as const;
export type Transaction = { external_id: string; kind: 'income' | 'expense'; amount: string; description: string; category: string; occurred_on: string; occurred_time: string | null };
export type TransactionRow = Transaction & { id: string | number; deleted_at?: string | Date | null };
export type BalanceRow = Pick<Transaction, 'kind' | 'amount' | 'occurred_on'> & Partial<Pick<TransactionRow, 'id' | 'occurred_time' | 'deleted_at'>>;
export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export function invalid(message: string): never { throw new ApiError(422, message); }
export const localClock = (instant = new Date()) => new Date(instant.getTime() - 3 * 3600000).toISOString().slice(0, 19);
export const localDay = () => localClock().slice(0, 10);
export const dateString = (value: string | Date) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
export const timestampString = (value: string | Date) => value instanceof Date ? value.toISOString() : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value + 'Z').toISOString();
export const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const cents = (amount: string) => {
  const [whole, decimal = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
};
export const money = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

export function validateTransaction(payload: unknown, defaultTime = true, now = localClock()): Transaction {
  if (!isObject(payload) || Object.keys(payload).some(key => !(fields as readonly string[]).includes(key))) invalid('Envie apenas os campos da transação.');
  const result: Record<string, unknown> = {};
  for (const [field, limit] of [['external_id', 100], ['description', 200], ['category', 80]] as const) {
    const value = payload[field] === undefined && field === 'category' ? '' : payload[field];
    if (typeof value !== 'string' || Array.from(value.trim()).length > limit || (field !== 'category' && !value.trim())) invalid('Campo inválido: ' + field);
    result[field] = value.trim();
  }
  if (payload.kind !== 'income' && payload.kind !== 'expense') invalid('kind deve ser income ou expense.');
  result.kind = payload.kind;
  if (typeof payload.amount !== 'string' || !/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(payload.amount)) invalid('amount deve ser uma string decimal, como 1250.50.');
  const amount = cents(payload.amount);
  if (amount <= 0n || amount > 99999999999999n) invalid('Valor monetário inválido.');
  result.amount = money(amount);
  if (!validDay(payload.occurred_on)) invalid('occurred_on deve usar AAAA-MM-DD.');
  if (payload.occurred_on < '1970-01-01' || payload.occurred_on > now.slice(0, 10)) invalid('Informe uma data passada ou atual, a partir de 1970.');
  result.occurred_on = payload.occurred_on;
  let clock = payload.occurred_time ?? (defaultTime ? now.slice(11, 19) : null);
  if (clock !== null) {
    if (typeof clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock)) invalid('Informe um horário válido, como 14:30.');
    clock = clock.length === 5 ? clock + ':00' : clock;
  }
  result.occurred_time = clock;
  return result as Transaction;
}

export function transactionTitle(description: string) {
  let title = description.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').replace(/\s+(?:hoje|ontem|anteontem)$/i, '');
  const match = title.match(/^(?:eu )?(gastei|paguei|comprei|recebi|ganhei)\s+(?:r\$\s*)?[0-9.,]+\s*(?:reais|real)?(?:\s+(?:no|na|nos|nas|em|com|de|do|da|por)\s+(.+))?$/i);
  if (match) title = match[2] || match[1];
  const connectors = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'no', 'na', 'para', 'com']);
  return title.split(/\s+/).map((word, index) => index && connectors.has(word.toLowerCase()) ? word.toLowerCase() : /\p{Lu}/u.test(word.slice(1)) ? word : word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

export function serialize(row: TransactionRow) {
  return { id: String(row.id), external_id: row.external_id, kind: row.kind, amount: money(cents(row.amount)), description: transactionTitle(row.description), category: row.category, currency: 'BRL', occurred_on: dateString(row.occurred_on), occurred_time: row.occurred_time ?? null, deleted_at: row.deleted_at ? timestampString(row.deleted_at) : null };
}

const zero = (balance = 0n) => ({ open: balance, high: balance, low: balance, close: balance, volume: 0n, income: 0n, expense: 0n });
const chartValues = (point: ReturnType<typeof zero>) => Object.fromEntries((['open', 'high', 'low', 'close', 'volume'] as const).map(key => [key, Number(point[key]) / 100]));
const nextDay = (day: string, delta = 1) => new Date(Date.parse(day) + delta * 86400000).toISOString().slice(0, 10);
const abs = (amount: bigint) => amount < 0n ? -amount : amount;
const percentage = (difference: bigint, old: bigint) => {
  const numerator = abs(difference) * 10000n, denominator = abs(old);
  let quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n)) quotient += 1n;
  return money(difference < 0n ? -quotient : quotient);
};

export function summarize(rows: BalanceRow[], today = localDay()) {
  const monthStart = today.slice(0, 7) + '-01';
  const previousStart = nextDay(monthStart, -1).slice(0, 7) + '-01';
  const current = { income: 0n, expense: 0n }, previous = { income: 0n, expense: 0n };
  let balance = 0n, previousBalance = 0n;
  const daily = new Map<string, ReturnType<typeof zero>>();
  const movements: Record<string, unknown>[] = [];
  const sorted = [...rows].sort((a, b) => dateString(a.occurred_on).localeCompare(dateString(b.occurred_on)) || (a.occurred_time ?? '').localeCompare(b.occurred_time ?? '') || (BigInt(a.id ?? 0) < BigInt(b.id ?? 0) ? -1 : BigInt(a.id ?? 0) > BigInt(b.id ?? 0) ? 1 : 0));
  for (const row of sorted) {
    const day = dateString(row.occurred_on), amount = cents(row.amount);
    if (day > today || row.deleted_at != null) continue;
    const point = daily.get(day) ?? zero(balance);
    daily.set(day, point);
    const opening = balance;
    balance += row.kind === 'income' ? amount : -amount;
    const clock = row.occurred_time ?? null;
    movements.push({ time: Date.parse(`${day}T${clock ?? '00:00:00'}-03:00`) / 1000, occurred_on: day, occurred_time: clock, open: Number(opening) / 100, high: Number(opening > balance ? opening : balance) / 100, low: Number(opening < balance ? opening : balance) / 100, close: Number(balance) / 100, volume: Number(amount) / 100 });
    point.high = point.high > balance ? point.high : balance;
    point.low = point.low < balance ? point.low : balance;
    point.close = balance;
    point.volume += amount;
    point[row.kind] += amount;
    if (day < monthStart) previousBalance = balance;
    if (day >= monthStart) current[row.kind] += amount;
    else if (day >= previousStart) previous[row.kind] += amount;
  }
  const points: Record<string, number>[] = [];
  const sparks = { balance: [] as number[], income: [] as number[], expense: [] as number[] };
  let income = 0n, expense = 0n, carried = 0n;
  const first = daily.keys().next().value as string | undefined;
  for (let day = first && first < monthStart ? first : monthStart; day <= today; day = nextDay(day)) {
    const point = daily.get(day) ?? zero(carried);
    carried = point.close;
    if (daily.size) points.push({ time: Date.parse(day + 'T00:00:00Z') / 1000, ...chartValues(point) });
    if (day >= monthStart) {
      income += point.income; expense += point.expense;
      sparks.balance.push(Number(carried) / 100); sparks.income.push(Number(income) / 100); sparks.expense.push(Number(expense) / 100);
    }
  }
  const card = (value: bigint, old: bigint, key: keyof typeof sparks) => ({ amount: money(value), difference: money(value - old), percentage: old ? percentage(value - old, old) : null, series: sparks[key] });
  return { currency: 'BRL', as_of: today, month: today.slice(0, 7), summary: { balance: card(balance, previousBalance, 'balance'), income: card(current.income, previous.income, 'income'), expense: card(current.expense, previous.expense, 'expense') }, chart: { currency: 'BRL', kind: 'balance', points, movements, intraday: [] } };
}
