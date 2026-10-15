import { ApiError } from '../http';
import { cents, dateString, localDay, summarize, validDay, type TransactionRow } from './model';
import { metricLabels, type ChartInterval, type FinanceOverview, type FinancePoint, type Metric } from '../../shared/finance-chart';
const dayMs=86400000;
const shift=(day:string,days:number)=>new Date(Date.parse(day)+days*dayMs).toISOString().slice(0,10);
const money=(value:bigint)=>Number(value)/100;
export function chartRequest(params:URLSearchParams,today=localDay()) {
  const period=params.get('period')??'6m', interval=params.get('interval')??(period==='1d'?'movement':'day');
  if(!['1d','5d','1m','6m','ytd','1y','5y','max','custom'].includes(period))throw new ApiError(400,'Período inválido.');
  if(!['movement','day','week','month'].includes(interval))throw new ApiError(400,'Intervalo inválido.');
  let end=today, start='0001-01-01';
  if(period==='custom') {
    start=params.get('start')??'';end=params.get('end')??'';
    if(!validDay(start)||!validDay(end)||start>end||end>today||start<'1970-01-01')throw new ApiError(400,'Selecione datas válidas até hoje.');
  } else if(period==='ytd')start=today.slice(0,4)+'-01-01';
  else if(period!=='max') {
    if(period==='1d'||period==='5d')start=shift(today,period==='1d'?0:-4);
    else {const months:Record<string,number>={'1m':1,'6m':6,'1y':12,'5y':60};const date=new Date(today+'T12:00:00Z'),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-months[period]);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));start=date.toISOString().slice(0,10);}
  }
  return {start,end,interval:interval as ChartInterval};
}
export function financeOverview(rows:TransactionRow[],params:URLSearchParams,today=localDay()):FinanceOverview {
  const range=chartRequest(params,today);
  const sorted=rows.filter(r=>!r.deleted_at&&dateString(r.occurred_on)<=today).sort((a,b)=>dateString(a.occurred_on).localeCompare(dateString(b.occurred_on))||(a.occurred_time??'').localeCompare(b.occurred_time??'')||(BigInt(a.id)<BigInt(b.id)?-1:1));
  const summary=summarize(sorted,today).summary;
  const keys:Metric[]=['balance','income','expense'];
  const running={balance:0n,income:0n,expense:0n};
  const groups:Record<Metric,Map<string,FinancePoint>>={balance:new Map(),income:new Map(),expense:new Map()};
  const baseline={balance:0,income:0,expense:0};
  const volumes:Record<Metric,Map<string,bigint>>={balance:new Map(),income:new Map(),expense:new Map()};
  const start=range.start==='0001-01-01'?(sorted[0]?dateString(sorted[0].occurred_on):today):range.start;
  for(const row of sorted){
    const date=dateString(row.occurred_on), amount=cents(row.amount),before={...running};
    if(date>range.end)continue;
    running[row.kind]+=amount;running.balance+=row.kind==='income'?amount:-amount;
    if(date<start){for(const key of keys)baseline[key]=money(running[key]);continue;}
    let bucket=date;
    if(range.interval==='week')bucket=shift(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
    if(range.interval==='month')bucket=date.slice(0,7)+'-01';
    if(range.interval==='movement')bucket=date+':'+row.id;
    for(const key of keys){
      const open=money(before[key]),close=money(running[key]);
      const p=groups[key].get(bucket)??{date:range.interval==='movement'?date:(bucket<start?start:bucket),clock:range.interval==='movement'?row.occurred_time??null:null,open,high:open,low:open,close:open,volume:0};
      p.high=Math.max(p.high,close);p.low=Math.min(p.low,close);p.close=close;
      // Aggregate money in cents, including across repeated movements in a bucket.
      const total=(volumes[key].get(bucket)??0n)+(key==='balance'||row.kind===key?amount:0n);
      volumes[key].set(bucket,total);p.volume=money(total);
      groups[key].set(bucket,p);
    }
  }
  // A day without activity carries the actual balance; it is not a missing quote.
  if(range.interval!=='movement'&&groups.balance.size){
    let day=start;
    if(range.interval==='week')day=shift(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
    if(range.interval==='month')day=day.slice(0,7)+'-01';
    const buckets:string[]=[];
    while(day<=range.end){buckets.push(day);if(range.interval==='month'){const next=new Date(day+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);day=next.toISOString().slice(0,10);}else day=shift(day,range.interval==='week'?7:1);}
    for(const key of keys){let value=baseline[key];const filled=new Map<string,FinancePoint>();for(const bucket of buckets){const point=groups[key].get(bucket)??{date:bucket<start?start:bucket,clock:null,open:value,close:value,high:value,low:value,volume:0};filled.set(bucket,point);value=point.close;}groups[key]=filled;}
  }
  const series=Object.fromEntries(keys.map(key=>[key,{label:metricLabels[key],baseline:baseline[key],points:[...groups[key].values()]}])) as FinanceOverview['series'];
  return {currency:'BRL',asOf:today,start,end:range.end,interval:range.interval,summary,series};
}
