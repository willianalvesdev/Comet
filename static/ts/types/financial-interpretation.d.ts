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
    confirmation: 'explicit_permanent_delete';
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

interface FinancialConfidenceIndicators {
    intentCertain: boolean;
    amountCertain: boolean;
    dateCertain: boolean;
    typeCertain: boolean;
    descriptionCertain: boolean;
    referenceCertain: boolean;
    calculationCertain: boolean;
    multiplePossibleTargets: boolean;
    unknownNumbers: boolean;
    hasAmbiguity: boolean;
}

type FinancialConfidenceIssue = 'intent' | 'amount' | 'date' | 'type' | 'description'
    | 'reference' | 'calculation' | 'multiple_targets' | 'unknown_numbers' | 'complex_language' | 'rejected_input';

interface ParserConfidence extends FinancialConfidenceIndicators {
    canExecuteLocally: boolean;
    requiresFallback: boolean;
    reasons: readonly FinancialConfidenceIssue[];
}
type FinancialReference =
    | {type: 'focus'; ids: readonly StoredTransaction['id'][]; count: 'one' | 'two' | 'many'}
    | {type: 'query'; description: string; occurred_on?: string; amount?: string; kind?: Transaction['kind']; latest: boolean};

interface FinancialConversationState {
    last_mentioned_transaction_ids: readonly StoredTransaction['id'][];
    last_created_transaction_ids: readonly StoredTransaction['id'][];
    last_updated_transaction_ids: readonly StoredTransaction['id'][];
    last_deleted_transaction_ids: readonly StoredTransaction['id'][];
    last_restored_transaction_ids: readonly StoredTransaction['id'][];
    last_intent: FinancialIntent | null;
    pending_clarification: PendingClarification | null;
}

interface FinancialInterpretationMetadata {
    parserSource: 'local' | 'ai';
}

interface FinancialInterpretationTurn extends FinancialTurn {
    metadata: FinancialInterpretationMetadata;
}

interface FinancialTurn {
    result: ParserResult;
    context: FinancialContext;
}

interface PendingClarification {
    id: string;
    original_text: string;
    intent: FinancialIntent | null;
    reason: 'missing_fields' | 'ambiguous_target' | 'ambiguous_action' | 'confirmation_required';
    question: string;
    missing_fields: readonly (keyof TransactionFields)[];
    date_range?: {start: string; end: string};
    reference?: FinancialReference;
    candidates?: readonly Readonly<StoredTransaction>[];
    candidate_ids: readonly StoredTransaction['id'][];
}

interface FinancialContext extends Partial<Omit<FinancialConversationState, 'pending_clarification'>> {
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

type FinancialInterpretation =
    | {status: 'resolved'; actions: readonly [FinancialAction, ...FinancialAction[]]}
    | {status: 'needs_clarification'; clarification: PendingClarification}
    | {status: 'unrecognized'; reason: string};

type LocalFinancialResult = FinancialInterpretation & {issues?: readonly FinancialConfidenceIssue[]};

type ParserResult = (FinancialInterpretation | {status: 'needs_fallback'; reason: string}) & {confidence: ParserConfidence};

type FinancialParser = (text: string, context: FinancialContext) => ParserResult;

interface TransactionHistoryEventBase {
    id: string;
    operation_id: string | null;
    transaction_id: StoredTransaction['id'];
    occurred_at: string;
}
type TransactionHistoryEvent = TransactionHistoryEventBase & (
    | {event: 'TRANSACTION_CREATED'; before: null; after: Readonly<TransactionFields>}
    | {event: 'TRANSACTION_UPDATED'; before: Readonly<Partial<TransactionFields>>; after: Readonly<Partial<TransactionFields>>}
    | {event: 'TRANSACTION_DELETED'; before: {readonly deleted_at: null}; after: {readonly deleted_at: string}}
    | {event: 'TRANSACTION_RESTORED'; before: {readonly deleted_at: string}; after: {readonly deleted_at: null}}
    | {event: 'TRANSACTION_PERMANENTLY_DELETED'; before: null; after: null}
);

interface FinancialExecutionResult {
    operation_id: string;
    operations: {type: FinancialAction['type']; transaction_ids: TransactionIds}[];
}
