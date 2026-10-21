import type {CSSProperties} from 'react';
import type {CryptoAsset,CryptoHistory} from '../../../shared/crypto';
import type {FinancePoint} from '../../../shared/finance-chart';
import {comparisonPrices,priceSamples} from '../../../shared/crypto-chart';
import {COMPARISON_COLORS,comparisonURL} from '../../../shared/crypto-comparison';
import type {ComparedAsset} from './useCryptoComparisons';
import {FinanceNumber} from './FinanceNumber';
import {Icon} from './FinanceChartTools';
import {changePercent} from './FinancePlot';
import LoadingIndicator from '../LoadingIndicator';
const timestamp=(point:FinancePoint)=>Date.parse(point.date+'T'+(point.clock||'00:00:00')+'Z');
export default function CryptoComparisonLegend({asset,history,entries,hover,selection,onRemove,onRetry,onHighlight}:{asset:CryptoAsset;history:CryptoHistory|null;entries:(ComparedAsset&{id:string})[];hover:FinancePoint|null;selection:[FinancePoint,FinancePoint]|null;onRemove:(id:string)=>void;onRetry:()=>void;onHighlight:(index:number|null)=>void}) {
    const rows=[{id:asset.id,asset,history:history??undefined},...entries];
    return <div className="crypto-comparison-legend" aria-label="Ativos comparados">{rows.map((entry,index)=>{
        const coin=entry.asset,samples=priceSamples(entry.history?.points??[]),name=coin?.name??entry.id;
        const loading=!entry.history&&!entry.error,empty=!loading&&samples.length<2;
        let price=coin?.price??null,change=coin?.change??null,percentage=coin?.changePercent??null;
        if(hover||selection){
            const end=selection?.[1]??hover!,start=selection?.[0];
            price=comparisonPrices([{time:timestamp(end),value:0}],samples)[0];
            const from=start?comparisonPrices([{time:timestamp(start),value:0}],samples)[0]:samples[0]?.value??null;
            change=price!==null&&from!==null?price-from:null;percentage=price!==null&&from!==null?changePercent(price,from):null;
        }
        const href=comparisonURL(location.href,entry.id,rows.filter(row=>row.id!==entry.id).map(row=>row.id));href.pathname='/finance/crypto/'+encodeURIComponent(entry.id);
        return <div className="crypto-comparison-row" key={entry.id} data-asset={entry.id} onPointerEnter={()=>onHighlight(index)} onPointerLeave={()=>onHighlight(null)} onFocus={()=>onHighlight(index)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))onHighlight(null);}} style={{'--comparison-color':COMPARISON_COLORS[index]} as CSSProperties}>
            <a className="crypto-comparison-quote" href={href.pathname+href.search+href.hash} aria-label={`Ver ${name} como ativo principal`} onClick={event=>{if(index===0)event.preventDefault();}}>
                <span className="market-logo">{coin?.image?.startsWith('https://')?<img src={coin.image} alt="" onError={e=>{e.currentTarget.hidden=true;}}/>:(coin?.symbol??entry.id).slice(0,2)}</span><span className="crypto-search-name"><strong>{name}</strong><small>{coin?.symbol??entry.id} · USD</small></span>
                <span className="crypto-comparison-price">{price===null?'—':<FinanceNumber value={price} currency="USD"/>}</span>
                <span className={'crypto-comparison-change market-change--'+(change===null||change===0?'neutral':change>0?'up':'down')}>{change===null?'—':<FinanceNumber value={change} currency="USD" signed/>}</span>
                <span className={'crypto-search-change market-change--'+(percentage===null||percentage===0?'neutral':percentage>0?'up':'down')}>{percentage===null?'—':<>{percentage!==0&&<Icon name={percentage>0?'rise':'fall'}/>}<FinanceNumber value={Math.abs(percentage)} percentage/></>}</span>
            </a>
            {index>0&&<button type="button" className="crypto-comparison-remove" aria-label={`Remover ${name} da comparação`} onClick={()=>onRemove(entry.id)}><Icon name="x"/></button>}
            {loading?<div className="crypto-comparison-status"><LoadingIndicator label={`Carregando comparação de ${name}`}/></div>:(entry.error||empty)?<div className="crypto-comparison-status" role="status">{entry.error||'Sem histórico suficiente neste período.'}{entry.error&&<button type="button" onClick={onRetry}>Tentar novamente</button>}</div>:entry.history?.stale?<div className="crypto-comparison-status">{entry.history.notice||'Exibindo o último histórico disponível.'}</div>:null}
        </div>;
    })}</div>;
}
