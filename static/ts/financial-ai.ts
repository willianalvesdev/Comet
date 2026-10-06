type FinancialAIFields = {[K in keyof TransactionFields]-?: Exclude<TransactionFields[K], undefined> | null};
interface FinancialAIAction {
    type: FinancialAction['type'];
    transactionId: string | null;
    fields: FinancialAIFields;
}
interface FinancialAIResponse {
    status: 'ready' | 'needs_clarification' | 'unknown';
    actions: FinancialAIAction[];
    clarification: string | null;
}
interface FinancialAISnapshot {
    currentDate: string;
    currentTime: string;
    timezone: string;
    availableCategories: string[];
    recentTransactions: StoredTransaction[];
    recentDeletedTransactions: StoredTransaction[];
}

function financialExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    const data = record(value);
    if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) throw new Error('Formato de interpretação inválido.');
    return data;
}

function financialNullableText(value: unknown, limit: number): string | null {
    if (value === null) return null;
    const text = stringValue(value);
    if (text.length > limit || /[\u0000-\u001f]/.test(text)) throw new Error('Campo de interpretação inválido.');
    return text;
}

function financialAIResponse(value: unknown): FinancialAIResponse {
    const data = financialExactRecord(value, ['status','actions','clarification']);
    if (data.status !== 'ready' && data.status !== 'needs_clarification' && data.status !== 'unknown') throw new Error('Estado de interpretação inválido.');
    if (!Array.isArray(data.actions) || data.actions.length > 100) throw new Error('Lote de interpretação inválido.');
    const actions = arrayValue(data.actions, (value): FinancialAIAction => {
        const action = financialExactRecord(value, ['type','transactionId','fields']);
        const type = action.type;
        if (type !== 'create' && type !== 'update' && type !== 'delete' && type !== 'restore' && type !== 'permanent_delete') throw new Error('Operação de interpretação inválida.');
        const rawFields = record(action.fields);
        const fields = financialExactRecord(rawFields, ['kind','amount','description','category','occurred_on', ...(Object.hasOwn(rawFields,'occurred_time') ? ['occurred_time'] : [])]);
        if (fields.kind !== null && fields.kind !== 'income' && fields.kind !== 'expense') throw new Error('Tipo de transação inválido.');
        return {type, transactionId:financialNullableText(action.transactionId,20), fields:{
            kind:fields.kind, amount:financialNullableText(fields.amount,15), description:financialNullableText(fields.description,200),
            category:financialNullableText(fields.category,80), occurred_on:financialNullableText(fields.occurred_on,10), occurred_time:financialNullableText(fields.occurred_time ?? null,8)
        }};
    });
    const clarification = financialNullableText(data.clarification,500);
    if (data.status === 'ready' ? !actions.length || clarification !== null : actions.length > 0) throw new Error('Lote incompleto ou ambíguo.');
    if (data.status === 'needs_clarification' && !clarification?.trim()) throw new Error('Pergunta ausente.');
    return {status:data.status, actions, clarification};
}

function financialAISnapshot(value: unknown): FinancialAISnapshot {
    const data = financialExactRecord(value, ['currentDate','currentTime','timezone','availableCategories','recentTransactions','recentDeletedTransactions']);
    const currentDate = stringValue(data.currentDate), currentTime = stringValue(data.currentTime), timezone = stringValue(data.timezone);
    const availableCategories = arrayValue(data.availableCategories, value => {
        const category = stringValue(value);
        if (!category.trim() || category.length > 80) throw new Error('Categoria inválida no contexto.');
        return category;
    });
    function rows(value: unknown, deleted: boolean): StoredTransaction[] {
        const result = financeHistoryData({transactions:value,next_cursor:null}).transactions;
        if (result.length > 120 || result.some(row => !/^[1-9]\d{0,19}$/.test(row.id) || row.currency !== 'BRL' || (row.deleted_at !== null) !== deleted)) throw new Error('Contexto de transações inválido.');
        return result;
    }
    const recentTransactions = rows(data.recentTransactions,false), recentDeletedTransactions = rows(data.recentDeletedTransactions,true);
    const ids = [...recentTransactions,...recentDeletedTransactions].map(row=>row.id);
    if (new Set(ids).size !== ids.length || availableCategories.length > 200) throw new Error('Contexto duplicado ou excessivo.');
    if (financialCurrentDate({currentDate,currentTime,timezone,locale:'pt-BR',currency:'BRL',categories:[],transactions:[],deleted_transactions:[],transactions_complete:false,deleted_transactions_complete:false,recent_events:[],pending_clarification:null}) !== currentDate) throw new Error('Relógio de interpretação inválido.');
    return {currentDate,currentTime,timezone,availableCategories,recentTransactions,recentDeletedTransactions};
}

function financialHasAmountEvidence(text: string, today: string): boolean {
    text = text.replace(financialClockPattern, ' ');
    const dated = extractFinancialDate(normalizeFinancialInput(text), today);
    const value = dated?.text ?? text.replace(/\bdia\s+\d+|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\b\d{4}-\d{2}-\d{2}\b/gi, '');
    const words = /\b(?:dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|milh[aã]o|milh[oõ]es)\b|\b(?:um|uma)\s+(?:real|conto|centavo)\b/i;
    if (/\b(?:comprei|peguei|abasteci)\s+(?:\d+|[\p{L}-]+)\s+[\p{L}]+/iu.test(value) && !/R\$|\b(?:reais|real|conto|contos|por|custou|custaram|cada)\b/i.test(value)) return false;
    return /\d/.test(value) || words.test(value);
}

function financialClarificationReply(input: string, context: FinancialContext): boolean {
    const reply = financialReferenceText(input).replace(/^(?:(?:a|o|essa|esse)\s+)?de\s+/, '').replace(/\s+(?:real|reais|contos?|centavos?)$/, '');
    const numberWords = /^(?:zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|milhao|milhoes)$/;
    const words = reply.split(' ');
    const wordAmount = words.every((word,index) => numberWords.test(word) || word === 'e' && index > 0 && index < words.length - 1 && words[index - 1] !== 'e');
    const correction = financialCorrection(input,context);
    return wordAmount || correction !== null && !('kind' in correction) || /^(?:(?:a|o|essa|esse)\s+de\s+)?(?:R\$\s*)?\d[\d.,]*(?:\s+reais)?[.!]?$|^(?:ela|ele|essa|esse|as duas|os dois|ambos|ambas)$/i.test(input.trim());
}

function financialExplicitOperation(type: FinancialAction['type'], input: string, context: FinancialContext): boolean {
    const pending = context.pending_clarification;
    const followup = financialClarificationReply(input,context);
    if (followup && pending?.intent && pending.intent.type !== type) return false;
    const text = financialReferenceText(followup && pending?.intent?.type === type ? pending.original_text : input)
        .replace(/^(?:por favor[,]?\s+|quero que voce\s+|pode\s+)/, '');
    const permanence = financialPermanentDeletionRequest(text);
    if (permanence === 'ambiguous' || /\b(?:nao|talvez|se)\b/.test(text)) return false;
    const deletion = /^(?:apaga|apague|apagar|exclua|exclui|excluir|remove|remova|remover|desconsidere|desconsidera)\b/.test(text);
    const restoration = /^(?:restaura|restaure|restaurar|desfaz|desfaca|desfazer|recupera|recupere)\b/.test(text);
    const update = /^(?:corrige|corrija|corrigir|muda|mude|mudar|altera|altere|alterar|atualiza|atualize|ajusta|ajuste|retifique|retifica|na verdade|e foi)\b/.test(text);
    if (type === 'permanent_delete') return permanence === 'explicit';
    if (type === 'delete') return deletion && permanence === 'none';
    if (type === 'restore') return restoration;
    if (type === 'update') return update;
    return !deletion && !restoration && !update;
}

function financialAIActions(response: FinancialAIResponse, snapshot: FinancialAISnapshot, input: string, context: FinancialContext, local: ParserResult): readonly [FinancialAction, ...FinancialAction[]] {
    const ids = new Set<string>();
    const source = input + ' ' + (financialClarificationReply(input,context) ? context.pending_clarification?.original_text ?? '' : '');
    const actions = response.actions.map((action): FinancialAction => {
        const {fields,type,transactionId} = action;
        if (!financialExplicitOperation(type,input,context)) throw new Error('Confirme qual operação você quer realizar.');
        if (fields.amount !== null) {
            if (!/^\d{1,12}\.\d{2}$/.test(fields.amount) || financialCents(fields.amount) <= 0n || !financialHasAmountEvidence(source,snapshot.currentDate)) throw new Error('Qual foi o valor exato em reais?');
        }
        if (fields.occurred_on !== null && (!financialValidDate(fields.occurred_on) || fields.occurred_on > snapshot.currentDate)) throw new Error('Qual foi a data válida dessa transação?');
        if (fields.occurred_time !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(fields.occurred_time)) throw new Error('Qual foi o horário da transação?');
        if (fields.category !== null && fields.category !== '' && !snapshot.availableCategories.includes(fields.category)) throw new Error('Informe uma categoria existente ou deixe sem categoria.');
        if (fields.description !== null && !fields.description.trim()) throw new Error('Qual é a descrição da transação?');
        if (type === 'create') {
            if (transactionId !== null) throw new Error('Uma criação não pode escolher um ID.');
            if (fields.kind === null || fields.amount === null || fields.description === null || fields.occurred_on === null) throw new Error('Informe o tipo, valor, descrição e data necessários para registrar a transação.');
            return {type, transaction:{kind:fields.kind,amount:fields.amount,description:fields.description,category:fields.category ?? '',occurred_on:fields.occurred_on,...(fields.occurred_time !== null ? {occurred_time:fields.occurred_time} : {})}};
        }
        if (transactionId === null || ids.has(transactionId)) throw new Error('Selecione uma transação real, sem repetir o mesmo registro.');
        ids.add(transactionId);
        const pool = type === 'restore' || type === 'permanent_delete' ? snapshot.recentDeletedTransactions : snapshot.recentTransactions;
        if (!pool.some(row=>row.id === transactionId)) throw new Error('A transação indicada não está disponível para essa operação.');
        const clarification = local.status === 'needs_clarification' ? local.clarification : context.pending_clarification;
        const reference = clarification?.reference;
        const permitted = reference?.type === 'focus' ? reference.ids : clarification?.candidate_ids;
        if (reference?.type === 'focus' && !reference.ids.includes(transactionId) || permitted?.length && !permitted.includes(transactionId)) throw new Error('A resposta não corresponde à transação selecionada.');
        if (/\b(?:ela|ele|essa|esse|anterior|citada|citado)\b/i.test(input) && !(context.last_mentioned_transaction_ids ?? []).includes(transactionId)) throw new Error('A resposta não corresponde à transação mencionada.');
        const transaction_ids: TransactionIds = [transactionId];
        if (type === 'update') {
            const changes: Partial<TransactionFields> = {};
            if (fields.kind !== null) changes.kind = fields.kind;
            if (fields.amount !== null) changes.amount = fields.amount;
            if (fields.description !== null) changes.description = fields.description;
            if (fields.category !== null) changes.category = fields.category;
            if (fields.occurred_on !== null) changes.occurred_on = fields.occurred_on;
            if (fields.occurred_time !== null) changes.occurred_time = fields.occurred_time;
            if (changes.amount !== undefined) return {type,transaction_ids,changes:{...changes,amount:changes.amount}};
            if (changes.occurred_on !== undefined) return {type,transaction_ids,changes:{...changes,occurred_on:changes.occurred_on}};
            if (changes.occurred_time !== undefined) return {type,transaction_ids,changes:{...changes,occurred_time:changes.occurred_time}};
            if (changes.description !== undefined) return {type,transaction_ids,changes:{...changes,description:changes.description}};
            if (changes.kind !== undefined) return {type,transaction_ids,changes:{...changes,kind:changes.kind}};
            if (changes.category !== undefined) return {type,transaction_ids,changes:{...changes,category:changes.category}};
            throw new Error('O que você quer alterar nessa transação?');
        }
        if (Object.values(fields).some(value=>value !== null)) throw new Error('Exclusão e restauração não podem alterar outros campos.');
        return type === 'permanent_delete' ? {type,transaction_ids,confirmation:'explicit_permanent_delete'} : {type,transaction_ids};
    });
    const [first,...rest] = actions;
    if (!first) throw new Error('Nenhuma ação completa foi identificada.');
    validateFinancialActions(actions);
    return [first,...rest];
}

async function interpretFinancialInput(input: string, context: FinancialContext, provider: string, fetcher: typeof fetch = fetch): Promise<FinancialInterpretationTurn> {
    const local = parseFinancialTurn(input,context);
    if (!local.result.confidence.requiresFallback || local.result.confidence.multiplePossibleTargets) return {...local,metadata:{parserSource:'local'}};
    let parserSource: FinancialInterpretationMetadata['parserSource'] = 'local';
    function question(message: string): FinancialInterpretationTurn {
        const followup = financialClarificationReply(input,context);
        const prior = followup ? context.pending_clarification : null;
        const currentQuestion = local.result.status === 'needs_clarification' &&
            (followup || financialReferenceText(local.result.clarification.original_text) === financialReferenceText(input)) ? local.result.clarification : null;
        const clarification: PendingClarification = currentQuestion ? {...currentQuestion,question:message} : {
            id:`financial-input:${input}`, original_text:prior?.original_text ?? input, intent:prior?.intent ?? null,
            reason:'missing_fields',question:message,missing_fields:[],candidate_ids:[]
        };
        const result: ParserResult = {status:'needs_clarification',clarification,confidence:local.result.confidence};
        return {result,context:rememberFinancialResult(context,result),metadata:{parserSource}};
    }
    const instructionText = financialReferenceText(input);
    if (/\b(?:ignore|ignora|desconsidere)\s+(?:(?:as|todas|todas as|suas)\s+)?(?:instrucoes|regras)|\b(?:system|developer|assistant)\s*:|<\|(?:im_start|system)|\b(?:execute|rode)\s+(?:o\s+)?(?:codigo|sql|script)\b/.test(instructionText)) return question('Descreva somente a operação financeira e seus dados.');
    let sentContext = context;
    const pending = context.pending_clarification;
    const groups = [context.last_mentioned_transaction_ids ?? [], context.last_created_transaction_ids ?? [],
        context.last_updated_transaction_ids ?? [], context.last_deleted_transaction_ids ?? [], context.last_restored_transaction_ids ?? [],
        context.last_intent && context.last_intent.type !== 'create' ? context.last_intent.target?.candidate_ids ?? [] : [],
        pending?.candidate_ids ?? [], pending?.reference?.type === 'focus' ? pending.reference.ids : [],
        pending?.intent && pending.intent.type !== 'create' ? pending.intent.target?.candidate_ids ?? [] : []];
    if (groups.some(ids => ids.length > 100) || new Set(groups.flat()).size > 100) {
        const independentCreation = /^(?:eu )?(?:gastei|recebi|lucrei|ganhei|paguei|comprei|abasteci|perdi)\b/.test(instructionText) &&
            !financialSemanticIssues(input).includes('reference') &&
            !/\b(?:ela|ele|[dn]?(?:ess|aquel)[ae]s?|anterior|ultima|ultimo|delas|deles|mesm[oa]s?)\b/.test(instructionText);
        if (!independentCreation) return question('Esse pedido depende de um grupo muito grande. Informe uma transação específica ou um grupo menor.');
        sentContext = {...context, ...createFinancialConversationState()};
    }
    try {
        parserSource = 'ai';
        const response = await fetcher('/api/finance/interpret', {method:'POST',credentials:'same-origin',cache:'no-store',
            headers:{'Content-Type':'application/json','X-CSRFToken':requiredElement(document,'meta[name="csrf-token"]',HTMLMetaElement).content},
            body:JSON.stringify({input,provider,conversation_context:{
                last_mentioned_transaction_ids:sentContext.last_mentioned_transaction_ids ?? [],
                last_created_transaction_ids:sentContext.last_created_transaction_ids ?? [],
                last_updated_transaction_ids:sentContext.last_updated_transaction_ids ?? [],
                last_deleted_transaction_ids:sentContext.last_deleted_transaction_ids ?? [],
                last_restored_transaction_ids:sentContext.last_restored_transaction_ids ?? [],last_intent:sentContext.last_intent ?? null
            },pending_clarification:sentContext.pending_clarification})});
        const unknownResponse: unknown = await response.json();
        if (!response.ok) return question(apiError(unknownResponse,'Não foi possível interpretar agora. Informe o pedido completo com valor e data.'));
        const envelope = financialExactRecord(unknownResponse,['interpretation','context']);
        const interpretation = financialAIResponse(envelope.interpretation);
        const snapshot = financialAISnapshot(envelope.context);
        if (interpretation.status !== 'ready') return question(interpretation.clarification || 'Não consegui determinar todos os dados. Informe a operação, o valor e a data.');
        const actions = financialAIActions(interpretation,snapshot,input,context,local.result);
        const result: ParserResult = {status:'resolved',actions,confidence:local.result.confidence};
        return {result,context:rememberFinancialResult(context,result),metadata:{parserSource}};
    } catch {
        return question('Não consegui validar a interpretação completa. Informe a operação, o valor, a data e a transação desejada.');
    }
}
