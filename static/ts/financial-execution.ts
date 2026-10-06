class FinancialExecutionRejected extends Error {}

function validateFinancialActions(actions: readonly FinancialAction[]): void {
    if (!actions.length || actions.length > 100) throw new Error('Envie de 1 a 100 ações.');
    const ids = new Set<string>();
    const singleBulk = actions.length === 1 && (actions[0].type === 'delete' || actions[0].type === 'restore');
    for (const action of actions) {
        if (action.type === 'create' || action.type === 'update') {
            const values = action.type === 'create' ? action.transaction : action.changes;
            if (!Object.keys(values).length) throw new Error('Informe as alterações.');
            if (action.type === 'create' && ['kind','amount','description','occurred_on'].some(key => !Object.hasOwn(values,key))) throw new Error('Informe o tipo, valor, descrição e data.');
            if (values.kind !== undefined && values.kind !== 'expense' && values.kind !== 'income') throw new Error('Informe se é uma receita ou despesa.');
            if (values.description !== undefined && (!values.description.trim() || values.description.length > 200)) throw new Error('Informe uma descrição com até 200 caracteres.');
            if (values.category !== undefined && values.category.length > 80) throw new Error('Informe uma categoria com até 80 caracteres.');
            if (values.amount !== undefined && (!/^\d{1,12}\.\d{2}$/.test(values.amount) || financialCents(values.amount) <= 0n)) throw new Error('Valor inválido.');
            if (values.occurred_on !== undefined && !financialValidDate(values.occurred_on)) throw new Error('Data inválida.');
            if (values.occurred_time != null && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(values.occurred_time)) throw new Error('Horário inválido.');
        }
        if (action.type === 'create') continue;
        if (!action.transaction_ids.length) throw new Error('Selecione uma transação.');
        for (const id of action.transaction_ids) {
            if (!/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n || ids.has(id)) throw new Error('Transação inválida ou repetida.');
            ids.add(id);
        }
        if (action.type === 'permanent_delete' && action.confirmation !== 'explicit_permanent_delete') throw new Error('A exclusão definitiva exige um pedido explícito.');
    }
    if (!singleBulk && ids.size > 100) throw new Error('Limite de 100 transações por pedido misto.');
}

async function executeFinancialActions(actions: readonly FinancialAction[], operationId: string = crypto.randomUUID(), fetcher: typeof fetch = fetch): Promise<FinancialExecutionResult> {
    validateFinancialActions(actions);
    const response = await fetcher('/api/finance/actions', {
        method:'POST', credentials:'same-origin', cache:'no-store',
        headers:{'Content-Type':'application/json', 'X-CSRFToken':requiredElement(document, 'meta[name="csrf-token"]', HTMLMetaElement).content},
        body:JSON.stringify({operation_id:operationId, actions})
    });
    const value: unknown = await response.json();
    if (!response.ok) {
        const message = apiError(value, 'Não foi possível executar o pedido.');
        if (response.status >= 400 && response.status < 500) throw new FinancialExecutionRejected(message);
        throw new Error(message);
    }
    const data = record(value);
    const receivedIds = new Set<string>();
    const maxTargets = Math.max(...actions.map(action => action.type === 'create' ? 1 : action.transaction_ids.length));
    const operations = arrayValue(data.operations, (value): FinancialExecutionResult['operations'][number] => {
        const operation = record(value), type = operation.type;
        if (type !== 'create' && type !== 'update' && type !== 'delete' && type !== 'restore' && type !== 'permanent_delete') throw new Error('Operação inválida na resposta.');
        const [first, ...rest] = arrayValue(operation.transaction_ids, stringValue);
        if (!first || rest.length >= maxTargets) throw new Error('Resposta sem transação ou excessiva.');
        const transaction_ids: TransactionIds = [first, ...rest];
        for (const id of transaction_ids) {
            if (!/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n || receivedIds.has(id)) throw new Error('Transação inválida ou repetida na resposta.');
            receivedIds.add(id);
        }
        return {type, transaction_ids};
    });
    if (data.operation_id !== operationId || operations.length !== actions.length || operations.some((item,index) => {
        const action = actions[index];
        const targets = action.type === 'create' ? null : new Set(action.transaction_ids);
        return item.type !== action.type || (targets === null ? item.transaction_ids.length !== 1 :
            item.transaction_ids.length !== targets.size || item.transaction_ids.some(id=>!targets.has(id)));
    })) throw new Error('Resposta de outra operação.');
    return {operation_id:operationId, operations};
}

async function refreshFinancialContext(context: FinancialContext, fetcher: typeof fetch = fetch): Promise<FinancialContext> {
    async function history(state: 'active' | 'deleted'): Promise<StoredTransaction[]> {
        const rows: StoredTransaction[] = [], seen = new Set<string>();
        let cursor: string | null = null;
        do {
            const response = await fetcher('/api/finance/transactions?limit=100&state=' + state + (cursor ? '&before=' + encodeURIComponent(cursor) : ''), {credentials:'same-origin',cache:'no-store'});
            const data: unknown = await response.json();
            if (!response.ok) throw new Error(apiError(data, 'Não foi possível conferir as transações.'));
            const page = financeHistoryData(data);
            rows.push(...page.transactions);
            cursor = page.next_cursor;
            if (cursor && seen.has(cursor)) throw new Error('Histórico incompleto. Tente novamente.');
            if (cursor) seen.add(cursor);
        } while (cursor);
        return rows;
    }
    const [transactions, deleted_transactions] = await Promise.all([history('active'), history('deleted')]);
    return {...context, currentDate:undefined, reference_date:undefined, currentTime:new Date().toISOString(), timezone:'America/Sao_Paulo',
        transactions, deleted_transactions, transactions_complete:true, deleted_transactions_complete:true};
}

function rememberFinancialExecution(context: FinancialContext, result: FinancialExecutionResult): FinancialContext {
    let next = context;
    for (const type of new Set(result.operations.map(operation=>operation.type))) {
        const [first, ...rest] = result.operations.filter(operation=>operation.type === type).flatMap(operation=>[...operation.transaction_ids]);
        if (first) next = rememberFinancialOperation(next, type, [first, ...rest]);
    }
    return {...next, last_mentioned_transaction_ids:result.operations.filter(operation=>operation.type !== 'permanent_delete').flatMap(operation=>[...operation.transaction_ids])};
}
