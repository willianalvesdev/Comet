interface FinancialMoneyMatch {
    amount: string;
    start: number;
    end: number;
    explicit: boolean;
}

function normalizeFinancialInput(input: string): string {
    return input.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim();
}

function financialAmount(raw: string, thousands: boolean): string | null {
    let decimal = raw;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw)) decimal = raw.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(?:[.,]\d{1,2})?$/.test(raw)) decimal = raw.replace(',', '.');
    else return null;
    const [whole, fraction = ''] = decimal.split('.');
    const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (thousands ? 1000n : 1n);
    if (cents <= 0n || cents > 99999999999999n) return null;
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function extractFinancialMonetaryValues(text: string): FinancialMoneyMatch[] | null {
    const matches: FinancialMoneyMatch[] = [];
    const tokens = /(?:R\$\s*)?\d[\d.,]*(?:\s+mil\b)?(?:\s+(?:reais|real|contos?|conto)\b)?/gi;
    for (const match of text.matchAll(tokens)) {
        const token = match[0];
        const raw = token.match(/\d[\d.,]*/)?.[0];
        if (!raw) return null;
        const start = match.index, end = start + token.length;
        if (/[\p{L}\d+\-/]/u.test(text[start - 1] ?? '') || /[\p{L}\d%/]/u.test(text[end] ?? '')) return null;
        const amount = financialAmount(raw, /\bmil\b/i.test(token));
        if (amount === null) return null;
        matches.push({amount, start, end, explicit: /R\$|\b(?:reais|real|contos?)\b/i.test(token)});
    }
    return matches;
}

function extractFinancialTransactionType(verb: string): Transaction['kind'] {
    return ['recebi','lucrei','ganhei'].includes(verb) ? 'income' : 'expense';
}

function extractFinancialDescription(text: string, fallback: string): string {
    const description = text.replace(/^(?:no|na|nos|nas|do|da|dos|das|de|em|com)\s+/i, '').trim();
    return description ? description.charAt(0).toLocaleUpperCase('pt-BR') + description.slice(1) : fallback;
}

function parseSingleFinancialInput(input: string, context: FinancialContext, defaultDate?: string): LocalFinancialResult {
    const reject = (reason: string, issues: readonly FinancialConfidenceIssue[] = ['intent']): LocalFinancialResult => ({status: 'unrecognized', reason, issues});
    if (input.length > 1000) return reject('Descreva uma única transação simples.');
    const text = normalizeFinancialInput(input);
    if (context.currency && context.currency !== 'BRL') return reject('Somente valores em reais são suportados.');
    const today = financialCurrentDate(context);
    if (!today) return financialClarification(input, 'occurred_on', 'Informe uma data atual válida e o fuso horário.');
    if (/[?;\n]/.test(input) || /\b(?:não|nao|se|talvez|parcelas?|dólares?|dolares?|euros?)\b/i.test(text)) return reject('A frase exige interpretação além dos casos simples.');
    const dates = extractFinancialDate(text, today);
    if (!dates) return financialClarification(input, 'occurred_on', 'Qual foi a data exata da transação?');
    const intent = /^(?:eu )?(gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b\s*(.*)$/i.exec(dates.text);
    if (!intent) return reject('Não foi identificada uma transação simples realizada.');
    const verb = intent[1].toLowerCase();
    const calculation = calculateFinancialInput(intent[2], verb);
    if (calculation === null) return financialClarification(input, 'amount', 'Qual foi o valor total em reais?', ['amount','calculation']);
    const body = calculation;
    if (/\b(?:gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b/i.test(body)) return reject('Informe somente uma transação.');
    const kind = extractFinancialTransactionType(verb);
    const values = extractFinancialMonetaryValues(body);
    if (values === null) return reject('Valor monetário inválido ou formato não suportado.', ['amount','unknown_numbers']);
    const candidates = values.filter(value => {
        const before = body.slice(0, value.start).trim();
        const after = body.slice(value.end).trim();
        const itemPrice = verb === 'comprei' && value.explicit && /^(?:um|uma|1)\s+[\p{L} ][\p{L} '-]*\s+de$/iu.test(before);
        const position = itemPrice || /\bpor$/i.test(before) || (before === '' && (!['comprei','abasteci'].includes(verb) || value.explicit));
        return position && (after === '' || /^(?:no|na|nos|nas|do|da|dos|das|de|em|com)\s+/i.test(after));
    });
    if (candidates.length !== 1) {
        return {status: 'needs_clarification', clarification: {
            id: `financial-input:${text}`, original_text: input,
            intent: {type: 'create', transaction: values.length === 0 ? {kind, category: '', occurred_on: dates.text === text ? defaultDate ?? dates.date : dates.date, description: extractFinancialDescription(body, kind === 'income' ? 'Recebimento' : 'Gasto')} : {kind}}, reason: 'missing_fields',
            question: 'Qual foi o valor total em reais?', missing_fields: ['amount'], candidate_ids: []
        }};
    }
    const money = candidates[0];
    const before = body.slice(0, money.start).trim();
    const after = body.slice(money.end).trim();
    const itemPrice = verb === 'comprei' && money.explicit && /^(?:um|uma|1)\s+[\p{L} ][\p{L} '-]*\s+de$/iu.test(before);
    const quantityPrefix = before.replace(itemPrice ? /\s+de$/i : /\s*\bpor$/i, '').trim();
    const otherValues = values.filter(value => value !== money);
    if (otherValues.some(value => value.explicit || value.start > money.start) ||
        (otherValues.length && (!['comprei','abasteci'].includes(verb) || !/^\d+\s+[\p{L} ]+$/u.test(quantityPrefix)))) return reject('Há mais de um número sem um único total inequívoco.', ['amount','unknown_numbers','calculation']);
    if (before && !itemPrice && !/\bpor$/i.test(before)) return reject('Informe uma transação simples.');
    const fallback = verb === 'lucrei' ? 'Lucro' : kind === 'income' ? 'Recebimento' : verb === 'comprei' ? 'Compra' : verb === 'paguei' ? 'Pagamento' : verb === 'perdi' ? 'Perda' : verb === 'abasteci' ? 'Abastecimento' : 'Gasto';
    const description = extractFinancialDescription(after || quantityPrefix.replace(verb === 'comprei' ? /^(?:um|uma|1)\s+/i : /^$/, ''), fallback);
    if (description.length > 200) return reject('Descrição muito longa.', ['description']);
    return {status: 'resolved', actions: [{type: 'create', transaction: {
        kind, amount: money.amount, description, category: '', occurred_on: dates.text === text ? defaultDate ?? dates.date : dates.date
    } }]};
}

function financialClarification(input: string, field: 'amount' | 'occurred_on', question: string, issues: readonly FinancialConfidenceIssue[] = [field === 'amount' ? 'amount' : 'date']): LocalFinancialResult {
    return {status: 'needs_clarification', issues, clarification: {
        id: `financial-input:${input}`, original_text: input, intent: null,
        reason: 'missing_fields', question, missing_fields: [field], candidate_ids: []
    }};
}

function financialCalendarDate(year: number, month: number, day: number): string | null {
    if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
    return value.toISOString().slice(0, 10);
}

function financialValidDate(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return financialCalendarDate(year, month, day);
}

function financialCurrentDate(context: FinancialContext): string | null {
    const zone = context.timezone ?? context.time_zone ?? 'America/Sao_Paulo';
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'});
        const supplied = context.currentDate ?? context.reference_date;
        const date = supplied === undefined ? null : financialValidDate(supplied);
        if (supplied !== undefined && !date) return null;
        if (context.currentTime !== undefined) {
            if (/^\d{2}:\d{2}(?::\d{2})?$/.test(context.currentTime)) {
                const [hour, minute, second = 0] = context.currentTime.split(':').map(Number);
                return hour < 24 && minute < 60 && second < 60 ? date : null;
            }
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(context.currentTime) ||
                !financialValidDate(context.currentTime.slice(0, 10))) return null;
            const instant = new Date(context.currentTime);
            if (!Number.isFinite(instant.getTime())) return null;
            const parts = formatter.formatToParts(instant);
            const part = (name: string) => parts.find(item => item.type === name)?.value ?? '';
            const local = `${part('year')}-${part('month')}-${part('day')}`;
            return date && date !== local ? null : financialValidDate(local);
        }
        return date;
    } catch { return null; }
}

function extractFinancialDate(text: string, today: string): {text: string; date: string} | null {
    const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const weekdays = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
    const patterns = [
        /\b(?:anteontem|ontem|hoje|amanhã|amanha|semana passada|mês passado|mes passado)\b/gi,
        /\b(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?(?:\s+passad[ao])?\b/gi,
        /\b(?:dia\s+)?\d{1,2}\s+de\s+(?!(?:juros|desconto|reembolso|estorno|volta)\b)[a-zç]+(?:\s+de\s+\d{4})?\b/gi,
        /\b(?:dia\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
        /\bdia\s+\d{1,2}\b/gi
    ];
    const found: {start: number; end: number; value: string}[] = [];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const start = match.index, end = start + match[0].length;
            const namedMonth = /^\d{1,2}\s+de\s+([a-zç]+)/i.exec(match[0])?.[1]?.toLowerCase();
            if (namedMonth && !months.includes(namedMonth) && /\b(?:gastei|recebi|lucrei|ganhei|paguei|abasteci|perdi|recuperei|devolveram|retornaram|voltou|por)\s*(?:R\$\s*)?$/i.test(text.slice(0, start))) continue;
            if (found.some(item => start < item.end && end > item.start)) continue;
            found.push({start, end, value: match[0].toLowerCase()});
        }
    }
    if (!found.length) {
        if (/\b(?:dia|dias|semana|semanas|mês|mes|meses|ano|anos)\b|\d\/\d|\d{4}-\d{2}-\d{2}/i.test(text)) return null;
        return {text, date: today};
    }
    if (found.length !== 1) return null;
    const match = found[0], value = match.value.replace(/^dia\s+/, '');
    const [year, month, day] = today.split('-').map(Number);
    let date: string | null = null;
    if (['hoje','ontem','anteontem'].includes(value)) {
        const offset = value === 'ontem' ? 1 : value === 'anteontem' ? 2 : 0;
        date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0,10);
    } else if (/^(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)/.test(value)) {
        const name = value.split(/[- ]/)[0].replace('terca','terça').replace('sabado','sábado');
        const weekday = weekdays.indexOf(name);
        let offset = (new Date(today).getUTCDay() - weekday + 7) % 7;
        if (!offset && /passad[ao]$/.test(value)) offset = 7;
        date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0,10);
    } else if (/^\d{1,2}$/.test(value)) {
        const previous = Number(value) > day;
        const targetMonth = previous ? month - 1 : month;
        date = financialCalendarDate(targetMonth === 0 ? year - 1 : year, targetMonth || 12, Number(value));
    } else {
        const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(value);
        const named = /^(\d{1,2}) de ([a-zç]+)(?: de (\d{4}))?$/.exec(value);
        if (numeric || named) {
            const targetDay = Number(numeric?.[1] ?? named?.[1]);
            const targetMonth = numeric ? Number(numeric[2]) : months.indexOf(named?.[2] ?? '') + 1;
            const explicitYear = numeric?.[3] ?? named?.[3];
            const targetYear = explicitYear ? Number(explicitYear) : year - (targetMonth > month || targetMonth === month && targetDay > day ? 1 : 0);
            date = financialCalendarDate(targetYear, targetMonth, targetDay);
        }
    }
    if (!date || !financialValidDate(date) || date > today) return null;
    const before = text.slice(0, match.start).replace(/\b(?:na|no|em|desde)\s*$/i, '');
    const remaining = (before + ' ' + text.slice(match.end)).replace(/\s+/g, ' ').trim();
    if (/\b(?:dia|dias|semana|semanas|mês|mes|meses|ano|anos)\b|\d\/\d/i.test(remaining)) return null;
    return {text: remaining, date};
}

function financialCents(amount: string): bigint {
    return BigInt(amount.replace('.', ''));
}

function financialTotal(cents: bigint): string | null {
    return cents > 0n && cents <= 99999999999999n ? `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` : null;
}

function calculateFinancialInput(body: string, verb: string): string | null {
    const quantity = /^(\d+)\s+([\p{L} ]+?)\s+(?:de|por)\s+(.+?)\s+cada(?:\s+(.*))?$/iu.exec(body);
    if (quantity && verb === 'comprei') {
        const unit = extractFinancialMonetaryValues(quantity[3]);
        if (!unit || unit.length !== 1 || unit[0].start !== 0 || unit[0].end !== quantity[3].length) return null;
        const total = financialTotal(BigInt(quantity[1]) * financialCents(unit[0].amount));
        if (!total) return null;
        return `por ${total} ${quantity[4] || 'com ' + quantity[2]}`;
    }
    const adjustment = /\s+(com|mais)\s+(\d+(?:[.,]\d{1,2})?)\s*(%)?\s+de\s+(juros|desconto)\b/i.exec(body);
    if (adjustment) {
        if (adjustment[1].toLowerCase() === 'mais' && adjustment[4].toLowerCase() === 'desconto') return null;
        const baseText = body.slice(0, adjustment.index);
        const values = extractFinancialMonetaryValues(baseText);
        if (!values || values.length !== 1) return null;
        const money = values[0];
        if (money.start !== 0 && !/\bpor\s*$/i.test(baseText.slice(0, money.start))) return null;
        const rate = adjustment[2].replace(',', '.').split('.');
        const units = BigInt(rate[0]) * 100n + BigInt((rate[1] ?? '').padEnd(2, '0'));
        const base = financialCents(money.amount);
        const discount = adjustment[4].toLowerCase() === 'desconto';
        if (discount && adjustment[3] && units > 10000n) return null;
        const numerator = adjustment[3] ? base * (10000n + (discount ? -units : units)) : (base + (discount ? -units : units)) * 10000n;
        const total = financialTotal((numerator + 5000n) / 10000n);
        if (!total) return null;
        const result = baseText.slice(0, money.start) + total + baseText.slice(money.end) + body.slice(adjustment.index + adjustment[0].length);
        return /%|\b(?:juros|desconto|cada|mais|menos)\b/i.test(result) ? null : result;
    }
    return /%|\b(?:juros|desconto|cada|mais|menos|vezes)\b/i.test(body) ? null : body;
}

interface FinancialClause {
    text: string;
    inherited: boolean;
}

function financialEventStart(text: string): boolean {
    return /^(?:(?:hoje|ontem|anteontem)\s+)?(?:eu\s+)?(?:gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi|recuperei|retornaram|voltou|(?:me\s+)?devolveram)\b/i.test(text);
}

function splitFinancialEvents(text: string): FinancialClause[] {
    const clauses: FinancialClause[] = [];
    let start = 0;
    for (const separator of text.matchAll(/,\s*|\s+(?:e|mas)\s+/gi)) {
        const after = text.slice(separator.index + separator[0].length).replace(/^e\s+/i, '');
        const newEvent = financialEventStart(after);
        const inheritedEvent = /^(?:R\$\s*)?\d[\d.,]*(?:\s+mil)?(?:\s+(?:reais|real|contos?))?\s+(?:no|na|nos|nas|do|da|dos|das|de|em|com)\s+/i.test(after);
        const decimal = separator[0] === ',' && /\d/.test(text[separator.index - 1] ?? '') && /^\d/.test(after);
        if (decimal || !newEvent && (!inheritedEvent || /^.*?\d[\d.,]*\s+de\s+(?:juros|desconto)\b/i.test(after))) continue;
        clauses.push({text: text.slice(start, separator.index).trim(), inherited: clauses.length > 0 && !financialEventStart(text.slice(start))});
        start = separator.index + separator[0].length;
        if (/^e\s+/i.test(text.slice(start))) start += 2;
    }
    clauses.push({text: text.slice(start).trim(), inherited: clauses.length > 0 && !financialEventStart(text.slice(start))});
    return clauses;
}

interface FinancialCompensation {
    amount: string;
    date: string;
    linked: boolean;
}

function extractFinancialCompensation(text: string, today: string): FinancialCompensation | null | 'ambiguous' {
    const dated = extractFinancialDate(text, today);
    if (!dated) return 'ambiguous';
    const match = /^(?:eu\s+)?(recebi|ganhei|recuperei|retornaram|voltou|(?:me\s+)?devolveram)\s+(.+)$/i.exec(dated.text);
    if (!match) return /^(?:R\$\s*)?\d.*\b(?:de volta|reembolso|estorno)\b/i.test(dated.text) ? 'ambiguous' : null;
    const returning = !['recebi','ganhei'].includes(match[1].toLowerCase());
    const marked = /\b(?:de volta|reembolso|estorno)\b/i.test(match[2]);
    if (!returning && !marked) return null;
    const values = extractFinancialMonetaryValues(match[2]);
    if (!values || values.length !== 1 || values[0].start !== 0) return 'ambiguous';
    const tail = match[2].slice(values[0].end).trim();
    const linked = /^(?:de volta|(?:de |como )?(?:reembolso|estorno))$/i.test(tail) || returning && tail === '';
    return {amount: values[0].amount, date: dated.date, linked};
}

function belongToSameFinancialEvent(transaction: TransactionFields, compensation: FinancialCompensation): boolean {
    return transaction.kind === 'expense' && compensation.linked && transaction.occurred_on === compensation.date;
}

function parseLocally(input: string, context: FinancialContext): LocalFinancialResult {
    if (context.currency && context.currency !== 'BRL') return {status: 'unrecognized', reason: 'Somente valores em reais são suportados.'};
    if (input.length > 1000 || /[?;\n]/.test(input) || /\b(?:não|nao|se|talvez)\b/i.test(input)) return {status: 'unrecognized', reason: 'Descreva eventos financeiros realizados e inequívocos.'};
    const today = financialCurrentDate(context);
    if (!today) return financialClarification(input, 'occurred_on', 'Informe uma data atual válida e o fuso horário.');
    const contextual = parseContextualFinancialInput(input, context);
    if (contextual) return contextual;
    if (/\b(?:e|mas)\s+(?:um|outro)\s+valor\b/i.test(input)) return financialClarification(input, 'amount', 'Qual foi o valor de cada evento?');
    const clauses = splitFinancialEvents(normalizeFinancialInput(input));
    const actions: CreateFinancialAction[] = [];
    let inheritedVerb = '', sharedDate = today;
    const firstVerb = /\b(?:gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b/i.exec(clauses[0].text);
    if (firstVerb && firstVerb.index > 0) {
        const prefix = extractFinancialDate(clauses[0].text.slice(0, firstVerb.index).trim(), today);
        if (prefix && prefix.text === '') sharedDate = prefix.date;
    }
    for (const clause of clauses) {
        const compensation = extractFinancialCompensation(clause.text, today);
        if (compensation) {
            const dated = extractFinancialDate(clause.text, today);
            const previous = actions[actions.length - 1];
            if (compensation !== 'ambiguous' && dated?.text === clause.text) compensation.date = previous?.transaction.occurred_on ?? sharedDate;
            if (compensation === 'ambiguous' || actions.length !== 1 || !previous || !belongToSameFinancialEvent(previous.transaction, compensation)) {
                return {status: 'needs_clarification', issues:['reference','calculation'], clarification: {
                    id: `financial-input:${input}`, original_text: input, intent: null, reason: 'ambiguous_target',
                    question: 'A qual despesa esse retorno se refere?', missing_fields: [], candidate_ids: []
                }};
            }
            const total = financialTotal(financialCents(previous.transaction.amount) - financialCents(compensation.amount));
            if (!total) return financialClarification(input, 'amount', 'Qual é o valor líquido da despesa?');
            previous.transaction = {...previous.transaction, amount: total};
            continue;
        }
        const verb = /\b(gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b/i.exec(clause.text)?.[1];
        const text = clause.inherited ? `${inheritedVerb} ${clause.text}` : clause.text;
        const result = parseSingleFinancialInput(text, context, sharedDate);
        if (result.status !== 'resolved') {
            if (result.status === 'needs_clarification') return {...result, clarification: {
                ...result.clarification, original_text: input, id: `financial-input:${input}`,
                intent: clauses.length > 1 ? null : result.clarification.intent,
                question: result.clarification.question + (clauses.length > 1 ? ' Reformule o pedido completo com todos os eventos.' : '')
            }};
            return result;
        }
        const action = result.actions[0];
        if (action.type !== 'create') return {status: 'unrecognized', reason: 'Operação não suportada.'};
        actions.push(action);
        if (verb) inheritedVerb = ['comprei','abasteci'].includes(verb.toLowerCase()) ? 'gastei' : verb;
    }
    const [first, ...rest] = actions;
    if (!first) return {status: 'unrecognized', reason: 'Nenhum evento financeiro identificado.'};
    return {status: 'resolved', actions: [first, ...rest]};
}


function financialSemanticIssues(input: string): FinancialConfidenceIssue[] {
    const text = financialReferenceText(input);
    const issues = new Set<FinancialConfidenceIssue>();
    if (/\b(?:aproximadamente|cerca de|por volta de|uns|umas|ou|acho|quase)\b/.test(text)) {
        issues.add('amount');issues.add('complex_language');
    }
    if (/\b(?:metade|dobro|triplo|dividi|dividir|dividido|dividida|rateado|rateio|saldo restante|restante|parcelas?|vezes)\b/.test(text)) {
        issues.add('calculation');issues.add('complex_language');
    }
    if (/\b(?:na data combinada|na mesma data|data de sempre|como antes|mesmo valor)\b/.test(text)) {
        issues.add('reference');issues.add('complex_language');
        if (/data/.test(text)) issues.add('date');
        if (/valor/.test(text)) issues.add('amount');
    }
    if (/\b(?:porque|porem|embora|enquanto|quando|cujo|cuja|que|referente ao anterior)\b|\b(?:e|mas)\s+(?:depositei|transferi|usei|sobrou|ficou|era|foi)\b/.test(text)) {
        issues.add('description');issues.add('complex_language');
    }
    return [...issues];
}

function assessFinancialConfidence(input: string, context: FinancialContext, result: LocalFinancialResult): ParserConfidence {
    const resolved = result.status === 'resolved';
    const text = normalizeFinancialInput(input);
    const today = financialCurrentDate(context);
    const clarification = result.status === 'needs_clarification' ? result.clarification : null;
    const intent = clarification?.intent;
    const contextual = intent != null && intent.type !== 'create';
    const issues = new Set<FinancialConfidenceIssue>(result.issues ?? []);
    const rejected = issues.has('rejected_input') || !text || text.length > 1000 || (context.currency !== '' && context.currency !== 'BRL') ||
        /\b(?:não|nao|se|talvez)\b/i.test(text) || /[?]/.test(input);
    const clauses = splitFinancialEvents(text);
    const dated = today ? clauses.map(clause => extractFinancialDate(clause.text, today)) : [];
    const recognizedVerb = /\b(?:gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b/i.test(text);
    const pending = context.pending_clarification?.intent;
    const draft = intent?.type === 'create' ? intent.transaction : null;
    const targetMissing = clarification?.reason === 'ambiguous_target';
    const change = intent?.type === 'update' ? intent.changes : draft;
    const knownAmount = change?.amount !== undefined && /^\d{1,12}\.\d{2}$/.test(change.amount) && financialCents(change.amount) > 0n;
    const hasMoneyNumbers = dated.some(date => date && /\d/.test(date.text));
    const indicators: FinancialConfidenceIndicators = {
        intentCertain: resolved || intent !== null && intent !== undefined || recognizedVerb,
        amountCertain: resolved || knownAmount || contextual && intent.type !== 'update' || contextual && intent.type === 'update' &&
            !clarification?.missing_fields.includes('amount') && !('amount' in intent.changes),
        dateCertain: resolved || !!draft?.occurred_on || !!today && dated.length > 0 && dated.every(date => date !== null),
        typeCertain: resolved || contextual || recognizedVerb,
        descriptionCertain: resolved || contextual || !!draft?.description,
        referenceCertain: resolved || !contextual && !targetMissing && (recognizedVerb || pending?.type === 'create'),
        calculationCertain: resolved || !/%|\b(?:juros|desconto|cada|mais|menos|vezes|metade|dobro|dividi|reembolso|estorno|volta)\b/i.test(text),
        multiplePossibleTargets: !resolved && (clarification?.candidate_ids.length ?? 0) > 1,
        unknownNumbers: !resolved && hasMoneyNumbers && !contextual && !knownAmount,
        hasAmbiguity: false
    };
    if (clarification?.missing_fields.includes('amount')) indicators.amountCertain = false;
    if (clarification?.missing_fields.includes('occurred_on')) indicators.dateCertain = false;
    if (targetMissing) indicators.referenceCertain = false;
    if (resolved && result.actions.some(action => action.type === 'create')) {
        for (const issue of financialSemanticIssues(input)) issues.add(issue);
    }
    const fields: readonly (readonly [FinancialConfidenceIssue, keyof FinancialConfidenceIndicators])[] = [
        ['intent','intentCertain'], ['amount','amountCertain'], ['date','dateCertain'], ['type','typeCertain'],
        ['description','descriptionCertain'], ['reference','referenceCertain'], ['calculation','calculationCertain']
    ];
    for (const [issue, field] of fields) if (issues.has(issue)) indicators[field] = false;
    if (issues.has('unknown_numbers')) indicators.unknownNumbers = true;
    const reasons: FinancialConfidenceIssue[] = [];
    for (const [issue, field] of fields) if (!indicators[field]) reasons.push(issue);
    if (indicators.multiplePossibleTargets) reasons.push('multiple_targets');
    if (indicators.unknownNumbers) reasons.push('unknown_numbers');
    if (issues.has('complex_language')) reasons.push('complex_language');
    if (rejected) reasons.push('rejected_input');
    indicators.hasAmbiguity = reasons.some(reason => reason !== 'rejected_input');
    const canExecuteLocally = resolved && reasons.length === 0;
    return {...indicators, canExecuteLocally, requiresFallback:!canExecuteLocally && !rejected, reasons};
}

function parseFinancialInput(input: string, context: FinancialContext): ParserResult {
    const local = parseLocally(input, context);
    const confidence = assessFinancialConfidence(input, context, local);
    if (local.status === 'resolved' && confidence.canExecuteLocally) return {status:'resolved',actions:local.actions,confidence};
    if (local.status === 'needs_clarification') return {status:'needs_clarification',clarification:local.clarification,confidence};
    const reason = local.status === 'unrecognized' ? local.reason : 'A relação entre os dados exige interpretação adicional. Reformule o pedido com valores e eventos separados.';
    return {status:confidence.requiresFallback ? 'needs_fallback' : 'unrecognized',reason,confidence};
}
