type TransactionFields = Omit<Transaction, 'external_id'>;
type TransactionChanges = {
    [K in keyof TransactionFields]: Pick<TransactionFields, K> & Partial<Omit<TransactionFields, K>>
}[keyof TransactionFields];
type TransactionIds = readonly [StoredTransaction['id'], ...StoredTransaction['id'][]];

interface CreateFinancialAction {
    type: 'create';
    transaction: TransactionFields;
}
interface UpdateFinancialAction {
    type: 'update';
    transaction_ids: TransactionIds;
    changes: TransactionChanges;
}
interface DeleteFinancialAction {
    type: 'delete';
    transaction_ids: TransactionIds;
}
interface RestoreFinancialAction {
    type: 'restore';
    transaction_ids: TransactionIds;
}
interface PermanentDeleteFinancialAction {
    type: 'permanent_delete';
    transaction_ids: TransactionIds;
}
type FinancialAction = CreateFinancialAction | UpdateFinancialAction | DeleteFinancialAction
    | RestoreFinancialAction | PermanentDeleteFinancialAction;

interface FinancialTarget {
    reference: string;
    candidate_ids: readonly StoredTransaction['id'][];
}
type FinancialIntent =
    | {type: 'create'; transaction: Partial<TransactionFields>}
    | {type: 'update'; target: FinancialTarget | null; changes: Partial<TransactionFields>}
    | {type: 'delete' | 'restore' | 'permanent_delete'; target: FinancialTarget | null};

type ParserConfidence = 'high' | 'medium' | 'low';
interface PendingClarification {
    id: string;
    original_text: string;
    intent: FinancialIntent | null;
    reason: 'missing_fields' | 'ambiguous_target' | 'ambiguous_action' | 'confirmation_required';
    question: string;
    missing_fields: readonly (keyof TransactionFields)[];
    candidate_ids: readonly StoredTransaction['id'][];
}

interface FinancialContext {
    currentDate?: Transaction['occurred_on'];
    currentTime?: string;
    timezone?: string;
    reference_date?: Transaction['occurred_on'];
    time_zone?: string;
    locale: string;
    currency: StoredTransaction['currency'];
    categories: readonly Transaction['category'][];
    transactions: readonly Readonly<StoredTransaction>[];
    deleted_transactions: readonly Readonly<StoredTransaction>[];
    transactions_complete: boolean;
    deleted_transactions_complete: boolean;
    recent_events: readonly TransactionHistoryEvent[];
    pending_clarification: PendingClarification | null;
}

type ParserResult =
    | {status: 'resolved'; confidence: ParserConfidence; actions: readonly [FinancialAction, ...FinancialAction[]]}
    | {status: 'needs_clarification'; confidence: ParserConfidence; clarification: PendingClarification}
    | {status: 'unrecognized'; confidence: ParserConfidence; reason: string};

type FinancialParser = (text: string, context: FinancialContext) => ParserResult;

interface TransactionHistoryEventBase {
    id: string;
    operation_id: string;
    transaction_id: StoredTransaction['id'];
    occurred_at: string;
}
type TransactionHistoryEvent = TransactionHistoryEventBase & (
    | {type: 'create'; before: null; after: Readonly<StoredTransaction>}
    | {type: 'update'; before: Readonly<StoredTransaction>; after: Readonly<StoredTransaction>}
    | {type: 'delete'; before: Readonly<StoredTransaction>; after: null}
    | {type: 'restore'; before: null; after: Readonly<StoredTransaction>}
    | {type: 'permanent_delete'; before: null; after: null}
);
