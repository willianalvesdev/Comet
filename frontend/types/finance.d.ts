interface Transaction { external_id?: string; kind: 'income'|'expense'; amount: string; description: string; category: string; occurred_on: string; occurred_time?: string | null; }
interface StoredTransaction extends Transaction { id: string; currency: string; deleted_at: string | null; }
interface FinanceHistory { transactions: StoredTransaction[]; next_cursor: string | null; }
