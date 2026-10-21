import {useEffect,useId,useRef,useState} from 'react';
import type {CryptoAsset} from '../../../shared/crypto';
import {cryptoMoney} from '../../../shared/crypto-chart';
import {useCryptoSearch} from './useCryptoSearch';
import {Icon} from './FinanceChartTools';
import {percent} from './FinancePlot';
import LoadingIndicator from '../LoadingIndicator';
export default function CryptoCompareMenu({selected,onAdd}:{selected:string[];onAdd:(asset:CryptoAsset)=>void}) {
    const id=useId(),menu=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
    const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
    const {assets,loading,error,notice,retry}=useCryptoSearch(query,open);
    const results=assets;
    useEffect(()=>setActive(-1),[query,open,selected.join(',')]);
    useEffect(()=>{if(active>=0)document.getElementById(id+'-'+active)?.scrollIntoView({block:'nearest'});},[active,id]);
    function add(asset:CryptoAsset){onAdd(asset);menu.current?.hidePopover();trigger.current?.focus();}
    return <div className="finance-menu-anchor crypto-compare-anchor">
        <button ref={trigger} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id}>Comparar<Icon name="chevron"/></button>
        <div id={id} ref={menu} popover="auto" className="finance-menu crypto-compare-menu" onToggle={event=>{const visible=event.newState==='open';setOpen(visible);if(visible){setQuery('');input.current?.focus();}}}>
            <div className="crypto-search-field"><i className="market-icon market-icon--search" aria-hidden="true"/><input ref={input} type="search" role="combobox" aria-label="Pesquisar moedas para comparar" placeholder="Pesquisar tickers..." autoComplete="off" maxLength={80} value={query} aria-expanded={open} aria-controls={id+'-results'} aria-activedescendant={active>=0?id+'-'+active:undefined} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{
                if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!loading&&results.length)setActive(value=>Math.max(0,Math.min(results.length-1,value+(e.key==='ArrowDown'?1:-1))));}
                if(e.key==='Enter'&&active>=0&&results[active]&&!loading){e.preventDefault();add(results[active]);}
            }}/>{query&&<button type="button" className="crypto-search-clear" aria-label="Limpar pesquisa de comparação" onClick={()=>{setQuery('');input.current?.focus();}}><Icon name="x"/></button>}</div>
            {loading?<div className="crypto-search-status"><LoadingIndicator label="Buscando moedas para comparar"/></div>:error?<div className="crypto-search-status"><p role="status">{error}</p><button type="button" onClick={retry}>Tentar novamente</button></div>:<>
                <div id={id+'-results'} role="listbox" aria-label="Moedas para comparar">{results.map((asset,index)=><button type="button" role="option" id={id+'-'+index} key={asset.id} aria-selected={active===index} className="crypto-search-result" onPointerMove={()=>setActive(index)} onClick={()=>add(asset)}>
                    <span className="market-logo">{asset.image?.startsWith('https://')?<img src={asset.image} alt="" onError={e=>{e.currentTarget.hidden=true;}}/>:asset.symbol.slice(0,2)}</span><span className="crypto-search-name"><strong>{asset.name}</strong><small>{asset.symbol} · CRIPTO</small></span>
                    <span className="crypto-search-price">{asset.price===null?'—':cryptoMoney(asset.price)}</span><span className={'crypto-search-change market-change--'+(asset.changePercent===null||asset.changePercent===0?'neutral':asset.changePercent>0?'up':'down')}>{asset.changePercent===null?'—':<>{asset.changePercent!==0&&<Icon name={asset.changePercent>0?'rise':'fall'}/>} {percent(Math.abs(asset.changePercent))}</>}</span><i className="market-icon market-icon--right" aria-hidden="true"/>
                </button>)}</div>{!results.length&&<div className="crypto-search-status" role="status">Nenhuma outra criptomoeda encontrada.</div>}{notice&&<div className="crypto-search-notice">{notice}</div>}
            </>}
        </div>
    </div>;
}
