import test from 'node:test';
import assert from 'node:assert/strict';
import {cryptoSeries,notableMovements,comparisonValues,comparisonPrices,priceSamples} from '../../shared/crypto-chart';
const day=Date.UTC(2026,9,10),hour=3_600_000;
test('crypto chart: normalized USD samples and UTC candles retain observed open/high/low/close',()=>{
 const raw=[{time:day+3*hour,value:110},{time:day,value:100},{time:day+hour,value:90},{time:day+hour,value:95},{time:NaN,value:50},{time:day+2*hour,value:120},{time:day+4*hour,value:-5}];
 assert.deepEqual(priceSamples(raw).map(p=>p.value),[100,95,120,110]);
 const line=cryptoSeries(raw,'Bitcoin','1m');assert.equal(line.baseline,100);assert.equal(line.points[1].clock,'01:00:00');assert.equal(line.points[1].date,'2026-10-10');assert.equal(line.points[1].close,95);
 const candle=cryptoSeries(raw,'Bitcoin','1m',true);assert.equal(candle.points.length,1);assert.deepEqual(candle.points[0],{date:'2026-10-10',clock:'00:00:00',open:100,high:120,low:95,close:110,volume:0});
});
test('crypto timeline: largest real close changes, chronology and sparse periods',()=>{
 const values=[100,105,80,79,120,122,80,150];
 const samples=values.map((value,i)=>({time:day+i*24*hour,value}));
 const changes=notableMovements(samples,'1m');assert.equal(changes.length,5);assert(changes.every((p,i)=>i===0||changes[i-1].time>p.time));
 const fall=changes.find(p=>p.price===80&&p.previous===105)!;assert(fall);assert.equal(fall.fromTime,day+24*hour);assert(Math.abs(fall.percent-((80/105-1)*100))<1e-10);
 assert.deepEqual(notableMovements([{time:day,value:0},{time:day+24*hour,value:10}],'1m'),[]);
 assert.deepEqual(notableMovements([{time:day,value:10},{time:day+hour,value:20}],'1m'),[]);
 assert.equal(notableMovements([{time:day,value:10},{time:day+hour,value:20}],'1d')[0].percent,100);
 assert.deepEqual(notableMovements([],'1m'),[]);
});
test('crypto comparison: percentages align by timestamp without extrapolating outside the series',()=>{
 const primary=[0,1,2,3,4].map(i=>({time:day+i*hour,value:100}));
 const other=[{time:day+hour,value:20},{time:day+3*hour,value:25}];
 assert.deepEqual(comparisonValues(primary,other),[null,0,0,25,null]);
 assert.deepEqual(comparisonValues(primary,[]),[null,null,null,null,null]);
});

import {comparisonIds,comparisonURL,COMPARISON_LIMIT} from '../../shared/crypto-comparison';
test('crypto comparison: shared URLs keep order, primary, other parameters and fragment, with bounded valid IDs',()=>{
 const query='?other=1&comparing=ethereum,bitcoin,ethereum,solana,../invalid,cardano,dogecoin,tether';
 const ids=comparisonIds(query,'bitcoin');assert.deepEqual(ids,['ethereum','solana','cardano','dogecoin','tether'].slice(0,COMPARISON_LIMIT-1));
 const url=comparisonURL('https://comet.test/finance/crypto/bitcoin?other=1#settings/general','bitcoin',ids);
 assert.equal(url.searchParams.get('comparing'),['bitcoin',...ids].join(','));assert.equal(url.searchParams.get('other'),'1');assert.equal(url.hash,'#settings/general');
 const cleared=comparisonURL(url.href,'bitcoin',[]);assert.equal(cleared.searchParams.get('comparing'),'bitcoin');assert.equal(cleared.searchParams.get('other'),'1');
 assert.equal(comparisonIds('?comparing=bitcoin,a,b,c,d,e,f,g,h','bitcoin').length,COMPARISON_LIMIT-1);
 assert.deepEqual(comparisonIds('?comparing=bitcoin','bitcoin'),[]);assert.deepEqual(comparisonIds('?comparing=ETH,<script>,','bitcoin'),[]);
});
test('crypto comparison: hover prices preserve zero and do not fabricate missing history',()=>{
 const primary=[0,1,2,3].map(i=>({time:day+i*hour,value:100}));
 assert.deepEqual(comparisonPrices(primary,[{time:day+hour,value:0},{time:day+2*hour,value:10}]),[null,0,10,null]);
 assert.deepEqual(comparisonValues(primary,[{time:day+hour,value:0},{time:day+2*hour,value:10}]),[null,null,null,null]);
});
