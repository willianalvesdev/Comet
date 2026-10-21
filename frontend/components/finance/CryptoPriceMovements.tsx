import {useMemo} from 'react';
import type {CryptoAsset,CryptoHistory,CryptoRange} from '../../../shared/crypto';
import {cryptoMoney,notableMovements} from '../../../shared/crypto-chart';
import LoadingIndicator from '../LoadingIndicator';
const day=(time:number)=>new Date(time).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'numeric',month:'short'});
const clock=(time:number)=>new Date(time).toLocaleTimeString('pt-BR',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
const percent=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Math.abs(value))+'%';
export default function CryptoPriceMovements({asset,history,range,loading,error}:{asset:CryptoAsset;history:CryptoHistory|null;range:CryptoRange;loading:boolean;error:string}) {
    const movements=useMemo(()=>notableMovements(history?.points??[],range),[history,range]);
    return <section className="market-section crypto-price-movements" aria-labelledby="crypto-movements-title">
        <div className="market-section-heading"><h2 id="crypto-movements-title">Movimento de preço notável</h2><span className="market-caption">Negociação 24 horas</span></div>
        <div className="crypto-timeline market-card" tabIndex={0} role="region" aria-label="Movimentos de preço">
            {loading?<div className="market-empty"><LoadingIndicator label="Carregando movimentos de preço"/></div>:error?<p className="market-empty">Os movimentos estarão disponíveis quando o histórico puder ser consultado.</p>:movements.length?<ol>{movements.map((movement,index)=><li key={movement.time}>
                <time dateTime={new Date(movement.time).toISOString()}>{day(movement.time)}<small>{clock(movement.time)} UTC</small></time>
                <span className={'crypto-timeline-dot'+(index===0?' is-latest':'')} aria-hidden="true"/>
                <div><p className="crypto-timeline-price"><strong>{cryptoMoney(movement.price)}</strong><span className={'market-change market-change--'+(movement.percent>0?'up':'down')}>{movement.percent>0?'↑':'↓'} {percent(movement.percent)}</span></p>
                    <p>{asset.name} {movement.percent>0?'subiu':'caiu'} {percent(movement.percent)}, de {cryptoMoney(movement.previous)} para {cryptoMoney(movement.price)}, entre as cotações de {day(movement.fromTime)} às {clock(movement.fromTime)} e {day(movement.time)} às {clock(movement.time)} (UTC).</p>
                    <a className="crypto-timeline-source" href={`https://www.coingecko.com/en/coins/${encodeURIComponent(asset.id)}`} target="_blank" rel="noopener noreferrer">CoinGecko <span aria-hidden="true">↗</span></a>
                </div>
            </li>)}</ol>:<p className="market-empty">Não há variações suficientes para destacar neste período.</p>}
        </div>
        <p className="crypto-timeline-note">{range==='1d'?'Maiores variações entre as últimas amostras de cada hora.':'Maiores variações entre as últimas amostras de cada dia.'} Horários em UTC.</p>
    </section>;
}
