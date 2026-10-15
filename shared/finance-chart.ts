export type Metric = 'balance' | 'income' | 'expense';
export type ChartInterval = 'movement' | 'day' | 'week' | 'month';
export interface FinancePoint { date: string; clock: string | null; open: number; high: number; low: number; close: number; volume: number; }
export interface FinanceSeries { label: string; baseline: number; points: FinancePoint[]; }
export interface FinanceOverview {
  currency: 'BRL'; asOf: string; start: string; end: string; interval: ChartInterval;
  summary: Record<Metric, { amount: string; difference: string; percentage: string | null; series: number[] }>;
  series: Record<Metric, FinanceSeries>;
}
export const metricLabels: Record<Metric,string> = {balance:'Saldo',income:'Receitas',expense:'Despesas'};
export const periodLabels = {'1d':'1D','5d':'5D','1m':'1M','6m':'6M',ytd:'YTD','1y':'1Y','5y':'5Y',max:'MAX',custom:'Personalizado'} as const;
