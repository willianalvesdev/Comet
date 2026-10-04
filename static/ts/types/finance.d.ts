interface Transaction { external_id?: string; kind: 'income'|'expense'; amount: string; description: string; category: string; occurred_on: string; }
interface StoredTransaction extends Transaction { id: string; currency: string; deleted_at: string | null; }
interface ChartPoint { time: import('lightweight-charts').UTCTimestamp; open: number; high: number; low: number; close: number; volume: number; }
interface ChartData { kind?: string; currency?: string; demo?: boolean; as_of?: string; points: ChartPoint[]; intraday?: ChartPoint[]; }
interface FinanceCard { amount: string; difference: string; percentage: string | null; series: number[]; }
interface FinanceDashboard { summary: Record<'balance'|'income'|'expense',FinanceCard>; chart: ChartData; as_of: string; }
interface FinanceHistory { transactions: StoredTransaction[]; next_cursor: string | null; }
