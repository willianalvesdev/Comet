import type { CryptoHistory, CryptoRange } from './crypto';
import type { FinancePoint, FinanceSeries } from './finance-chart';

type Sample = CryptoHistory['points'][number];
const HOUR = 3_600_000;
export const cryptoMoney = (value:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',maximumFractionDigits:value!==0&&Math.abs(value)<1?6:2}).format(value);
const percentFormat = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'});
export const cryptoPercent = (value:number|null) => value===null||!Number.isFinite(value)?'—':percentFormat.format(value)+'%';
export const cryptoTrend = (value:number|null) => value===null||!Number.isFinite(value)||Math.abs(value)<.005?'neutral':value>0?'up':'down';
export function priceSamples(values:Sample[]):Sample[] {
    return [...new Map(values.filter(p=>Number.isFinite(p.time)&&p.time>0&&Number.isFinite(p.value)&&p.value>=0).map(p=>[p.time,p])).values()].sort((a,b)=>a.time-b.time);
}
function point(time:number,open:number,high:number,low:number,close:number):FinancePoint {
    const date=new Date(time).toISOString();
    return {date:date.slice(0,10),clock:date.slice(11,19),open,high,low,close,volume:0};
}
export function cryptoSeries(samples:Sample[],label:string,range:CryptoRange,candles=false):FinanceSeries {
    const clean=priceSamples(samples);
    if(!candles)return {label,baseline:clean[0]?.value??0,points:clean.map(p=>point(p.time,p.value,p.value,p.value,p.value))};
    // These candles summarize the available samples, not an exchange's complete trade tape.
    const bucket=range==='1d'?HOUR:range==='5d'?6*HOUR:range==='1m'?24*HOUR:7*24*HOUR;
    const groups=new Map<number,Sample[]>();
    for(const sample of clean){const key=Math.floor(sample.time/bucket);const group=groups.get(key)??[];group.push(sample);groups.set(key,group);}
    return {label,baseline:clean[0]?.value??0,points:[...groups.values()].map(group=>point(group[0].time,group[0].value,Math.max(...group.map(p=>p.value)),Math.min(...group.map(p=>p.value)),group.at(-1)!.value))};
}
export function comparisonPrices(primary:Sample[],comparison:Sample[]):(number|null)[] {
    const other=priceSamples(comparison),first=other[0];
    if(!first)return primary.map(()=>null);
    let index=0;
    return primary.map(sample=>{
        if(sample.time<first.time||sample.time>other.at(-1)!.time)return null;
        while(index+1<other.length&&other[index+1].time<=sample.time)index++;
        return other[index].value;
    });
}
export function comparisonValues(primary:Sample[],comparison:Sample[]):(number|null)[] {
    const first=priceSamples(comparison)[0]?.value;
    return comparisonPrices(primary,comparison).map(value=>value===null||!first?null:(value/first-1)*100);
}
export interface PriceMovement {time:number;fromTime:number;price:number;previous:number;percent:number;}
export function notableMovements(samples:Sample[],range:CryptoRange):PriceMovement[] {
    const buckets=new Map<number,Sample>(),size=range==='1d'?HOUR:24*HOUR;
    for(const sample of priceSamples(samples))buckets.set(Math.floor(sample.time/size),sample);
    const closes=[...buckets.values()];
    return closes.slice(1).flatMap((sample,index)=>{
        const previous=closes[index];
        if(previous.value<=0||sample.value===previous.value)return [];
        return [{time:sample.time,fromTime:previous.time,price:sample.value,previous:previous.value,percent:(sample.value/previous.value-1)*100}];
    }).sort((a,b)=>Math.abs(b.percent)-Math.abs(a.percent)).slice(0,5).sort((a,b)=>b.time-a.time);
}
