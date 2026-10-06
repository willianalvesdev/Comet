function createFinancialConversationState(): FinancialConversationState {
    return {
        last_mentioned_transaction_ids: [], last_created_transaction_ids: [],
        last_updated_transaction_ids: [], last_deleted_transaction_ids: [],
        last_restored_transaction_ids: [], last_intent: null, pending_clarification: null
    };
}

type ContextualFinancialOperation = 'update' | 'delete' | 'restore' | 'permanent_delete';

function financialReferenceText(text: string): string {
    return normalizeFinancialInput(text).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function financialPermanentDeletionRequest(input: string): 'none' | 'explicit' | 'ambiguous' {
    const text = financialReferenceText(input).replace(/^(?:por favor[, ]*|quero que voce\s+|pode\s+)/, '');
    const deletion = /^(?:apaga|apague|apagar|exclua|exclui|excluir|remove|remova|remover)\s+(.+)$/.exec(text);
    if (!deletion) return 'none';
    const qualifiers = text.match(/\b(?:definitivamente|permanentemente|para sempre)\b/g);
    if (!qualifiers) return 'none';
    if (qualifiers.length !== 1 || /["'`“”‘’«»;?]|\b(?:nao|nunca|jamais|sem|se|caso|quando|talvez|exceto|menos|mas|porem|senao|evite|evitar|impedir)\b/.test(text)) return 'ambiguous';
    return /^(?:definitivamente|permanentemente|para sempre)\b|\b(?:definitivamente|permanentemente|para sempre)$/.test(deletion[1]) ? 'explicit' : 'ambiguous';
}

function makeFinancialReference(text: string, context: FinancialContext): FinancialReference | null {
    const normalized = financialReferenceText(text).replace(/^(?:a|o)\s+/, '');
    const focus = context.last_mentioned_transaction_ids ?? [];
    if (/^(?:|ela|ele|essa|esse|aquela|aquele|essa compra|essa despesa|essa transacao|aquela compra|aquela despesa|aquela transacao|anterior)$/.test(normalized)) {
        return {type: 'focus', ids: [...focus], count: 'one'};
    }
    if (/^(?:os dois|as duas|ambos|ambas)$/.test(normalized)) return {type: 'focus', ids: [...focus], count: 'two'};
    if (/^(?:essas|esses|elas|eles|essas compras|essas despesas)$/.test(normalized)) return {type: 'focus', ids: [...focus], count: 'many'};
    if (/^ultima(?: compra| despesa| transacao)?$/.test(normalized)) return {type: 'query', description: '', latest: true};
    const today = financialCurrentDate(context);
    if (!today) return null;
    const dated = extractFinancialDate(normalizeFinancialInput(text), today);
    if (!dated) return null;
    let description = financialReferenceText(dated.text).replace(/^(?:o|a|um|uma)\s+/, '').replace(/\s+de$/, '');
    let kind: Transaction['kind'] | undefined;
    if (/^(?:compra|despesa)\b/.test(description)) {kind = 'expense';description = description.replace(/^(?:compra|despesa)(?:\s+(?:do|da|no|na|de|em))?\s*/, '');}
    if (/^receita\b/.test(description)) {kind = 'income';description = description.replace(/^receita(?:\s+(?:do|da|de))?\s*/, '');}
    if (!description || /\d|\b(?:tudo|todas|todos|permanentemente|definitivamente)\b/.test(description)) return null;
    return {type: 'query', description, kind, latest: false,
        occurred_on: dated.text !== normalizeFinancialInput(text) ? dated.date : undefined};
}

function financialReferenceCandidates(reference: FinancialReference, operation: ContextualFinancialOperation, context: FinancialContext): readonly Readonly<StoredTransaction>[] {
    const rows = (operation === 'restore' || operation === 'permanent_delete') ? context.deleted_transactions : context.transactions;
    const valid = rows.filter(row => row.id.trim() !== '' && (operation === 'restore' || operation === 'permanent_delete' ? row.deleted_at !== null : row.deleted_at === null) && !(
        (operation === 'restore' || operation === 'permanent_delete') ? context.transactions : context.deleted_transactions
    ).some(other => other.id === row.id));
    if (reference.type === 'focus') return valid.filter(row => reference.ids.includes(row.id));
    const matches = valid.filter(row => (!reference.description || financialReferenceText(row.description) === reference.description) &&
        (!reference.occurred_on || row.occurred_on === reference.occurred_on) &&
        (!reference.amount || row.amount === reference.amount) && (!reference.kind || row.kind === reference.kind));
    if (!reference.latest || !matches.length) return matches;
    const date = matches.reduce((latest, row) => row.occurred_on > latest ? row.occurred_on : latest, '');
    return matches.filter(row => row.occurred_on === date);
}

function financialTargetQuestion(input: string, operation: ContextualFinancialOperation, reference: FinancialReference,
    context: FinancialContext, changes?: TransactionChanges, question = 'Qual transação você quer selecionar?', candidates = financialReferenceCandidates(reference, operation, context)): LocalFinancialResult {
    const target = {reference: input, candidate_ids: candidates.map(row => row.id)};
    const intent: FinancialIntent = operation === 'update' ? {type: 'update', target, changes: changes ?? {}} : {type: operation, target};
    return {status: 'needs_clarification', clarification: {
        id: `financial-input:${input}`, original_text: input, intent, reason: 'ambiguous_target', question,
        missing_fields: [], reference, candidate_ids: target.candidate_ids, candidates: candidates.map(row => ({...row}))
    }};
}

function financialActionForTargets(operation: ContextualFinancialOperation, candidates: readonly Readonly<StoredTransaction>[], changes?: TransactionChanges): LocalFinancialResult | null {
    const ids = [...new Set(candidates.map(row => row.id))];
    const [first, ...rest] = ids;
    if (!first || ids.length !== candidates.length) return null;
    const transaction_ids: TransactionIds = [first, ...rest];
    if (operation === 'update') return changes ? {status: 'resolved', actions: [{type: 'update', transaction_ids, changes}]} : null;
    if (operation === 'permanent_delete') return {status: 'resolved', actions: [{type: operation, transaction_ids, confirmation: 'explicit_permanent_delete'}]};
    return {status: 'resolved', actions: [{type: operation, transaction_ids}]};
}

function resolveFinancialReference(input: string, operation: ContextualFinancialOperation, reference: FinancialReference, context: FinancialContext, changes?: TransactionChanges): LocalFinancialResult {
    const candidates = financialReferenceCandidates(reference, operation, context);
    const complete = (operation === 'restore' || operation === 'permanent_delete') ? context.deleted_transactions_complete : context.transactions_complete;
    const count = reference.type === 'focus' ? reference.count : 'one';
    const expected = count === 'one' ? candidates.length === 1 : count === 'two' ? candidates.length === 2 : candidates.length >= 2;
    const allKnown = reference.type === 'focus' ? new Set(reference.ids).size === candidates.length && reference.ids.length === candidates.length : complete;
    if (allKnown && expected) {
        const result = financialActionForTargets(operation, candidates, changes);
        if (result) return result;
    }
    return financialTargetQuestion(input, operation, reference, context, changes,
        reference.type === 'query' && !complete ? 'Carregue o histórico completo para identificar essa transação com segurança.' :
        candidates.length ? 'Qual dessas transações você quer selecionar?' : 'Não encontrei a transação nos dados atuais. Qual é ela?');
}

function financialCorrection(text: string, context: FinancialContext): TransactionChanges | null {
    let value = normalizeFinancialInput(text).replace(/^(?:foi|foram|era|eram|o valor(?: para)?|a data(?: para)?)\s+/i, '');
    const verb = /^(?:eu\s+)?(gastei|paguei|comprei|abasteci|perdi|recebi|lucrei|ganhei)\b\s*/i.exec(value);
    if (verb) value = value.slice(verb[0].length);
    const kind = verb ? extractFinancialTransactionType(verb[1].toLowerCase()) : undefined;
    if (!value) return kind ? {kind} : null;
    const today = financialCurrentDate(context);
    if (!today) return null;
    const dated = extractFinancialDate(value, today);
    if (!dated) return null;
    const money = extractFinancialMonetaryValues(dated.text);
    const date = dated.text !== value ? {occurred_on: dated.date} : {};
    if (money?.length === 1 && money[0].start === 0 && money[0].end === dated.text.length) {
        return {amount: money[0].amount, ...date, ...(kind ? {kind} : {})};
    }
    return dated.text === '' ? {occurred_on: dated.date, ...(kind ? {kind} : {})} : null;
}

function financialPendingChanges(intent: FinancialIntent, context: FinancialContext): TransactionChanges | undefined {
    if (intent.type !== 'update') return undefined;
    const changes = intent.changes;
    if (Object.keys(changes).some(key => !['amount','occurred_on','kind'].includes(key))) return undefined;
    if (changes.kind !== undefined && changes.kind !== 'expense' && changes.kind !== 'income') return undefined;
    if (changes.amount !== undefined && financialAmount(changes.amount, false) !== changes.amount) return undefined;
    if (changes.occurred_on !== undefined) {
        const date = financialValidDate(changes.occurred_on), today = financialCurrentDate(context);
        if (!date || !today || date > today) return undefined;
    }
    if (changes.amount !== undefined) return {...changes, amount: changes.amount};
    if (changes.occurred_on !== undefined) return {...changes, occurred_on: changes.occurred_on};
    if (changes.kind !== undefined) return {...changes, kind: changes.kind};
    return undefined;
}

function financialPreviousWeek(context: FinancialContext): {start: string; end: string} | null {
    const today = financialCurrentDate(context);
    if (!today) return null;
    const day = new Date(today), offset = (day.getUTCDay() + 6) % 7;
    const monday = day.getTime() - (offset + 7) * 86400000;
    return {start: new Date(monday).toISOString().slice(0,10), end: new Date(monday + 6 * 86400000).toISOString().slice(0,10)};
}

function resolveFinancialClarification(input: string, context: FinancialContext): LocalFinancialResult {
    const pending = context.pending_clarification;
    if (pending?.intent?.type === 'create' && pending.missing_fields.length === 1 && pending.missing_fields[0] === 'amount') {
        const draft = pending.intent.transaction, change = financialCorrection(input, context), today = financialCurrentDate(context);
        if (change && 'amount' in change && change.amount && draft.kind && draft.description && draft.description.length <= 200 &&
            typeof draft.category === 'string' && draft.occurred_on && financialValidDate(draft.occurred_on) && today && draft.occurred_on <= today) {
            return {status: 'resolved', actions: [{type: 'create', transaction: {
                kind: draft.kind, amount: change.amount, description: draft.description, category: draft.category, occurred_on: draft.occurred_on,
                ...(draft.occurred_time ? {occurred_time:draft.occurred_time} : {})
            }}]};
        }
        return {status: 'needs_clarification', clarification: {...pending, question: 'Qual foi o valor exato em reais? Se houver vários valores, reformule o pedido completo.'}};
    }
    if (!pending?.intent || !pending.reference || !['update','delete','restore','permanent_delete'].includes(pending.intent.type)) {
        return {status: 'unrecognized', reason: 'Reformule o pedido completo para esclarecer essa entrada.'};
    }
    const operation = pending.intent.type;
    if (operation === 'permanent_delete' && financialPermanentDeletionRequest(pending.original_text) !== 'explicit') {
        return {status: 'needs_clarification', clarification: {...pending, intent: null,
            question: 'Você quer remover essa transação ou apagá-la definitivamente? Reformule o pedido sem condições.'}};
    }
    if (operation !== 'update' && operation !== 'delete' && operation !== 'restore' && operation !== 'permanent_delete') return {status: 'unrecognized', reason: 'Operação não suportada.'};
    const changes = financialPendingChanges(pending.intent, context);
    if (operation === 'update' && pending.date_range) {
        const range = pending.date_range, today = financialCurrentDate(context);
        const valid = financialValidDate(range.start) && financialValidDate(range.end) && today && range.start <= range.end && range.end <= today;
        const correction = valid ? financialCorrection(input, {...context, currentDate:range.end, currentTime:undefined}) : null;
        if (correction?.occurred_on && Object.keys(correction).length === 1 && correction.occurred_on >= range.start && correction.occurred_on <= range.end) {
            return resolveFinancialReference(pending.original_text, 'update', pending.reference, context, correction);
        }
        return {status:'needs_clarification', issues:['rejected_input'], clarification:{...pending,question:'Em qual dia daquela semana aconteceu? Informe somente o dia ou a data exata.'}};
    }
    if (operation === 'update' && !changes) {
        const correction = financialCorrection(input, context);
        if (correction) return resolveFinancialReference(pending.original_text, operation, pending.reference, context, correction);
        return {status: 'needs_clarification', clarification: {...pending, question: 'Qual é o novo valor ou a nova data?'}};
    }
    const current = financialReferenceCandidates(pending.reference, operation, context);
    const rows = current.filter(row => pending.candidate_ids.includes(row.id));
    const text = financialReferenceText(input);
    const monetary = normalizeFinancialInput(input).replace(/^(?:(?:a|o|essa|esse)\s+)?de\s+/i, '');
    const values = extractFinancialMonetaryValues(monetary);
    let selected: readonly Readonly<StoredTransaction>[] = [];
    if (values?.length === 1 && values[0].start === 0 && values[0].end === monetary.length) selected = rows.filter(row => row.amount === values[0].amount);
    else if (/^(?:os dois|as duas|ambos|ambas)$/.test(text) && rows.length === 2 && pending.candidate_ids.length === 2) selected = rows;
    else if (/^(?:essas|esses|elas|eles)$/.test(text) && rows.length >= 2 && rows.length === pending.candidate_ids.length) selected = rows;
    const plural = /^(?:os dois|as duas|ambos|ambas|essas|esses|elas|eles)$/.test(text);
    const complete = (operation === 'restore' || operation === 'permanent_delete') ? context.deleted_transactions_complete : context.transactions_complete;
    if ((pending.reference.type === 'focus' || complete) && (selected.length === 1 || plural && selected.length >= 2)) {
        const result = financialActionForTargets(operation, selected, changes);
        if (result) return result;
    }
    return financialTargetQuestion(pending.original_text, operation, pending.reference, context, changes,
        'Não consegui identificar uma seleção única nos dados atuais. Qual transação você quer?', rows);
}

function resolveFinancialDeleteAll(input: string, context: FinancialContext): LocalFinancialResult | null {
    const text = financialReferenceText(input);
    const deletion = /^(?:(?:por favor[, ]*|(?:quero que voce|pode|nunca|jamais|nao|talvez)\s+))*(?:apaga|apague|apagar|remove|remova|remover|exclui|exclua|excluir)\b/.test(text);
    if (!deletion || !/\b(?:tudo|todas|todos)\b/.test(text)) return null;
    const reject = (reason: string): LocalFinancialResult => ({status: 'unrecognized', reason, issues: ['rejected_input']});
    if (!/^(?:por favor[, ]*)?(?:apaga|apague|apagar|remove|remova|remover|exclui|exclua|excluir)\s+(?:tudo|todas|todos|todas (?:(?:as )?(?:minhas )?)transacoes)(?:[, ]+por favor)?$/.test(text)) {
        return reject('Para apagar todas as transações ativas, diga “Apague todas as transações”. Para selecionar apenas algumas, descreva quais.');
    }
    if (!context.transactions_complete || !context.deleted_transactions_complete) {
        return reject('Não consegui carregar todas as transações. Tente novamente para apagar todas com segurança.');
    }
    const ids = new Set<string>();
    for (const [rows, deleted] of [[context.transactions, false], [context.deleted_transactions, true]] as const) {
        for (const row of rows) {
            if (!row.id.trim() || ids.has(row.id) || (row.deleted_at !== null) !== deleted) {
                return reject('Os dados das transações precisam ser atualizados. Tente novamente antes de apagar todas.');
            }
            ids.add(row.id);
        }
    }
    return financialActionForTargets('delete', context.transactions) ?? reject('Não há transações ativas para apagar.');
}

function parseContextualFinancialInput(input: string, context: FinancialContext): LocalFinancialResult | null {
    const text = normalizeFinancialInput(input);
    const deleteAll = resolveFinancialDeleteAll(text, context);
    if (deleteAll) return deleteAll;
    const permanentRequest = financialPermanentDeletionRequest(text);
    if (permanentRequest === 'ambiguous') return {status: 'needs_clarification', clarification: {
        id: `financial-input:${input}`, original_text: input, intent: null, reason: 'ambiguous_target',
        question: 'Você quer remover essa transação ou apagá-la definitivamente? Reformule o pedido sem condições.',
        missing_fields: [], candidate_ids: []
    }};
    const undo = /^(?:desfaz|desfaca)$/i.test(financialReferenceText(text));
    if (undo) {
        const ids = context.last_intent?.type === 'delete' ? context.last_deleted_transaction_ids ?? [] : [];
        return resolveFinancialReference(input, 'restore', {type:'focus', ids, count:ids.length > 1 ? 'many' : 'one'}, context);
    }
    const deletion = /^(apaga|apague|exclua|exclui|remove|remova|restaura|restaure)\s+(.+)$/i.exec(text);
    const correction = /^(?:na verdade[,]?\s+|(?:e\s+)?foi\s+)(.+)$/i.exec(text);
    const update = /^(?:corrige|corrija|muda|mude|altere|atualiza|atualize)\s+(?:(.*?)\s+)?para\s+(.+)$/i.exec(text);
    const newCreation = /\b(?:gastei|paguei|comprei|abasteci|perdi|recebi|lucrei|ganhei)\b/i.test(text);
    if (context.pending_clarification && !deletion && !correction && !update && !newCreation) return resolveFinancialClarification(text, context);
    if (!deletion && !correction && !update) return null;
    const permanent = permanentRequest === 'explicit';
    const operation: ContextualFinancialOperation = deletion ? /^restaur/i.test(deletion[1]) ? 'restore' : permanent ? 'permanent_delete' : 'delete' : 'update';
    const targetText = (deletion?.[2] ?? update?.[1] ?? '').replace(/\b(?:definitivamente|permanentemente|para sempre|da lixeira)\b/gi, '').replace(/\s+que (?:eu )?apaguei$/i, '').trim();
    const reference = makeFinancialReference(targetText, context);
    if (!reference) return financialClarification(input, 'occurred_on', 'Informe a transação e uma data válida, sem referências ambíguas.');
    if (operation !== 'update') return resolveFinancialReference(input, operation, reference, context);
    const correctionText = correction?.[1] ?? update?.[2] ?? '';
    const normalizedCorrection = financialReferenceText(correctionText).replace(/^(?:foi|era)\s+/, '');
    if (correction && /^(?:de graca|gratis|gratuito|gratuita|sem custo)$/.test(normalizedCorrection)) {
        const candidates = financialReferenceCandidates(reference, 'delete', context).filter(row => row.kind === 'expense');
        if (reference.type === 'focus' && reference.ids.length === 1 && candidates.length === 1) {
            return financialActionForTargets('delete', candidates);
        }
        return {...financialTargetQuestion(input, 'delete', reference, context, undefined,
            'Qual despesa foi gratuita e deve ser removida?', candidates), issues:['rejected_input']};
    }
    if (normalizedCorrection === 'semana passada') {
        const range = financialPreviousWeek(context);
        const result = financialTargetQuestion(input, 'update', reference, context);
        if (range && result.status === 'needs_clarification') return {...result, issues:['rejected_input'], clarification:{
            ...result.clarification, reason:'missing_fields', missing_fields:['occurred_on'], date_range:range,
            question:'Em qual dia da semana passada aconteceu?'
        }};
    }
    const changes = financialCorrection(correctionText, context);
    if (changes) return resolveFinancialReference(input, 'update', reference, context, changes);
    const result = financialTargetQuestion(input, 'update', reference, context);
    if (result.status !== 'needs_clarification') return result;
    return {...result, clarification: {...result.clarification, reason: 'missing_fields', missing_fields: ['amount','occurred_on'], question: 'Qual é o novo valor ou a nova data?'}};
}

function rememberFinancialResult(context: FinancialContext, result: ParserResult): FinancialContext {
    const next: FinancialContext = {...createFinancialConversationState(), ...context};
    if (result.status === 'needs_clarification') return {...next, pending_clarification: result.clarification, last_intent: result.clarification.intent};
    if (result.status !== 'resolved') return next;
    const action = result.actions[result.actions.length - 1];
    const ids = result.actions.flatMap(item => item.type === 'create' ? [] : [...item.transaction_ids]);
    const last_intent: FinancialIntent = action.type === 'create' ? {type: 'create', transaction: action.transaction} :
        action.type === 'update' ? {type: 'update', target: {reference: '', candidate_ids: action.transaction_ids}, changes: action.changes} :
        {type: action.type, target: {reference: '', candidate_ids: action.transaction_ids}};
    return {...next, pending_clarification: null, last_intent, last_mentioned_transaction_ids: [...new Set(ids)]};
}

function rememberFinancialOperation(context: FinancialContext, operation: FinancialAction['type'], ids: TransactionIds): FinancialContext {
    if (operation === 'permanent_delete') {
        if (!context.transactions_complete || !context.deleted_transactions_complete || ids.some(id => [...context.transactions, ...context.deleted_transactions].some(row => row.id === id))) throw new Error('A exclusão definitiva precisa ser confirmada pelo armazenamento.');
        return {...context, pending_clarification:null, last_mentioned_transaction_ids:[], last_deleted_transaction_ids:(context.last_deleted_transaction_ids ?? []).filter(id=>!ids.includes(id)), last_intent:{type:operation,target:{reference:'',candidate_ids:ids}}};
    }
    const pool = operation === 'delete' ? context.deleted_transactions : context.transactions;
    const other = operation === 'delete' ? context.transactions : context.deleted_transactions;
    if (new Set(ids).size !== ids.length || ids.some(id => !id || pool.filter(row => row.id === id).length !== 1 || other.some(row => row.id === id))) {
        throw new Error('A operação confirmada precisa de IDs reais no snapshot atualizado do armazenamento.');
    }
    const next: FinancialContext = {...createFinancialConversationState(), ...context, pending_clarification: null, last_mentioned_transaction_ids: [...ids]};
    if (operation === 'create') next.last_created_transaction_ids = [...ids];
    if (operation === 'update') next.last_updated_transaction_ids = [...ids];
    if (operation === 'delete') next.last_deleted_transaction_ids = [...ids];
    if (operation === 'restore') next.last_restored_transaction_ids = [...ids];
    return next;
}

function parseFinancialTurn(input: string, context: FinancialContext): FinancialTurn {
    const result = parseFinancialInput(input, context);
    return {result, context: rememberFinancialResult(context, result)};
}
