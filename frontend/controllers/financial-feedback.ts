import { financialCurrentDate } from './financial-parser';
export function financialFeedbackAmount(amount: string): string {
    const [whole, fraction = '00'] = amount.split('.');
    return `R$ ${BigInt(whole).toLocaleString('pt-BR')},${fraction.padEnd(2, '0')}`;
}

export function financialFeedbackDate(date: string, context: FinancialContext): string {
    const today = financialCurrentDate(context);
    const days = today ? (Date.parse(today) - Date.parse(date)) / 86400000 : -1;
    return days === 0 ? 'hoje' : days === 1 ? 'ontem' : days === 2 ? 'anteontem' : date.split('-').reverse().join('/');
}

export function financialUserMessage(message: string, fallback: string): string {
    return !message.trim() || /\b(?:ids?|json|confidence|parserSource|deleted_?at|transaction_?ids?|operation_id|external_id|occurred_on|amount|kind|schema|sql|traceback|stack|parser)\b|\/api\//i.test(message) ? fallback : message;
}

export function financialClarificationFeedback(result: Exclude<ParserResult, {status:'resolved'}>, context: FinancialContext): string {
    if (result.status !== 'needs_clarification') return financialUserMessage(result.reason, 'Qual transação você quer registrar ou alterar?');
    const question = result.clarification;
    const candidates = question.candidates ?? [];
    if (question.reason === 'ambiguous_target' && candidates.length > 1) {
        const first = candidates[0];
        const sameDescription = candidates.every(row => row.description === first.description);
        const sameDate = candidates.every(row => row.occurred_on === first.occurred_on);
        const noun = candidates.every(row => row.kind === 'expense') ? 'compras' : candidates.every(row => row.kind === 'income') ? 'receitas' : 'transações';
        const count = candidates.length === 2 ? 'duas' : String(candidates.length);
        const details = candidates.map(row => financialFeedbackAmount(row.amount) +
            (sameDescription ? '' : ` — ${row.description}`) + (sameDate ? '' : ` — ${financialFeedbackDate(row.occurred_on, context)}`));
        const operation = question.intent?.type;
        const verb = operation === 'delete' ? 'apagar' : operation === 'restore' ? 'restaurar' : operation === 'permanent_delete' ? 'excluir definitivamente' : operation === 'update' ? 'alterar' : 'selecionar';
        return `Encontrei ${count} ${noun}${sameDescription ? ` de ${first.description}` : ''}${sameDate ? ` ${financialFeedbackDate(first.occurred_on, context)}` : ''}: ${new Intl.ListFormat('pt-BR').format(details)}. Qual delas você quer ${verb}?`;
    }
    const missing = question.missing_fields;
    const fallback = missing.includes('amount') ? 'Qual foi o valor em reais?' : missing.includes('occurred_on') ? 'Em que dia aconteceu?' : 'Qual transação você quer selecionar?';
    return financialUserMessage(question.question, fallback);
}

export function financialExecutionFeedback(result: FinancialExecutionResult, context: FinancialContext): string {
    const count = result.operations.reduce((total, operation) => total + operation.transaction_ids.length, 0);
    const [operation] = result.operations;
    if (!operation || result.operations.some(item => item.type !== operation.type)) return `Concluí ${count} operações.`;
    if (operation.type === 'create') {
        if (count > 1) return `Adicionei ${count} transações.`;
        const row = context.transactions.find(row => row.id === operation.transaction_ids[0]);
        return row ? `Adicionei ${financialFeedbackAmount(row.amount)} — ${row.description} — ${financialFeedbackDate(row.occurred_on, context)}.` : 'Transação adicionada.';
    }
    const words = {
        update: ['atualizada', 'atualizadas'], delete: ['removida', 'removidas'],
        restore: ['restaurada', 'restauradas'], permanent_delete: ['excluída definitivamente', 'excluídas definitivamente']
    };
    return count === 1 ? `Transação ${words[operation.type][0]}.` : `${count} transações ${words[operation.type][1]}.`;
}
