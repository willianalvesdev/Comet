import test from 'node:test';
import assert from 'node:assert/strict';
import { financeOverview, chartRequest } from '../../server/finance/chart';
import type { TransactionRow } from '../../server/finance/model';
const row=(id:number,kind:'income'|'expense',amount:string,date:string,extra:Partial<TransactionRow>={}):TransactionRow=>({id,kind,amount,occurred_on:date,occurred_time:null,description:'Teste',category:'',external_id:String(id),...extra});
const params=(extra:Record<string,string>={})=>new URLSearchParams({period:'custom',start:'2026-10-01',end:'2026-10-04',...extra});

test('chart API aggregates exact cents, carries days and preserves the opening balance',()=>{
 const data=financeOverview([row(1,'income','100.10','2026-09-30'),row(2,'expense','110.05','2026-10-01',{occurred_time:'08:00:00'}),row(3,'income','0.20','2026-10-01',{occurred_time:'09:00:00'}),row(4,'income','5.00','2026-10-03')],params(),'2026-10-04');
 assert.equal(data.series.balance.baseline,100.1);
 assert.deepEqual(data.series.balance.points.map(p=>p.close),[-9.75,-9.75,-4.75,-4.75]);
 assert.deepEqual(data.series.balance.points.map(p=>p.volume),[110.25,0,5,0]);
 assert.equal(data.series.balance.points[0].low,-9.95);
 assert.equal(data.summary.balance.amount,'-4.75');
 assert.equal(data.series.income.points.at(-1)?.close,105.3);
 assert.equal(data.series.expense.points.at(-1)?.close,110.05);
});
test('chart API keeps same-time movements distinct and excludes deleted/future rows',()=>{
 const data=financeOverview([row(2,'income','20','2026-10-01',{occurred_time:'08:00:00'}),row(1,'expense','100','2026-10-01',{occurred_time:'08:00:00'}),row(3,'income','999','2026-10-01',{deleted_at:'2026-10-02'}),row(4,'income','999','2026-10-05')],params({interval:'movement'}),'2026-10-04');
 assert.deepEqual(data.series.balance.points.map(p=>p.close),[-100,-80]);
 assert.deepEqual(data.series.balance.points.map(p=>p.clock),['08:00:00','08:00:00']);
 assert.equal(data.summary.balance.amount,'-80.00');
 const unknown=financeOverview([row(1,'income','3','2026-10-01')],params({interval:'movement'}),'2026-10-04');
 assert.equal(unknown.series.balance.points[0].clock,null);
});
test('chart API groups weeks/months and custom ranges without changing closing totals',()=>{
 const rows=[row(1,'income','10','2026-09-30'),row(2,'expense','1.10','2026-10-01'),row(3,'expense','2.20','2026-10-02'),row(4,'income','3.30','2026-10-03')];
 for(const interval of ['week','month']){const data=financeOverview(rows,params({interval}),'2026-10-04');assert.deepEqual(data.series.balance.points,[{date:'2026-10-01',clock:null,open:10,high:10,low:6.7,close:10,volume:6.6}]);}
 const old=financeOverview(rows,params({end:'2026-10-02'}),'2026-10-04');assert.equal(old.series.balance.points.at(-1)?.close,6.7);
 const empty=financeOverview(rows,params({start:'2026-10-04'}),'2026-10-04');assert.equal(empty.series.balance.baseline,10);assert.deepEqual(empty.series.balance.points,[]);
});
test('chart API rejects invalid dates, intervals, periods and future custom ranges',()=>{
 for(const values of ([{period:'bad'},{interval:'hour'},{start:'2026-02-30'},{end:'2026-10-05'},{start:'2026-10-03',end:'2026-10-02'},{start:'0000-01-01'}] as Record<string,string>[]))assert.throws(()=>chartRequest(params(values),'2026-10-04'),{status:400});
 assert.equal(chartRequest(new URLSearchParams({period:'1d'}),'2026-10-04').interval,'movement');
 assert.equal(chartRequest(new URLSearchParams({period:'ytd'}),'2026-10-04').start,'2026-01-01');
 assert.equal(chartRequest(new URLSearchParams({period:'1m'}),'2024-03-31').start,'2024-02-29');
 assert.equal(chartRequest(new URLSearchParams({period:'1y'}),'2024-02-29').start,'2023-02-28');
 assert.deepEqual(financeOverview([],new URLSearchParams({period:'max'}),'2026-10-04').series.balance,{label:'Saldo',baseline:0,points:[]});
});
