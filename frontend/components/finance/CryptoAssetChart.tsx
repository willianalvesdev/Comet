import {useEffect,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import type {CryptoAsset,CryptoHistory,CryptoRange} from '../../../shared/crypto';
import type {FinancePoint} from '../../../shared/finance-chart';
import {comparisonValues,cryptoSeries,priceSamples} from '../../../shared/crypto-chart';
import {FinancePlot,changePercent,dateLabel} from './FinancePlot';
import {FinanceNumber} from './FinanceNumber';
import {Icon,Menu,download,downloadChart} from './FinanceChartTools';
import {COMPARISON_COLORS} from '../../../shared/crypto-comparison';
import {useCryptoComparisons} from './useCryptoComparisons';
import CryptoCompareMenu from './CryptoCompareMenu';
import CryptoComparisonLegend from './CryptoComparisonLegend';
import CryptoPriceMovements from './CryptoPriceMovements';
import LoadingIndicator from '../LoadingIndicator';
const ranges:{value:CryptoRange;label:string}[]=[{value:'1d',label:'1D'},{value:'5d',label:'5D'},{value:'1m',label:'1M'},{value:'6m',label:'6M'},{value:'1y',label:'1Y'}];
const compactUSD=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(value);
const trend=(value:number)=>value===0?'neutral':value>0?'up':'down';
export default function CryptoAssetChart({asset,assets}:{asset:CryptoAsset;assets:CryptoAsset[]}) {
    const [range,setRange]=useState<CryptoRange>('1m');
    const compared=useCryptoComparisons(asset,assets,range);
    const [history,setHistory]=useState<CryptoHistory|null>(null);
    const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
    const [candles,setCandles]=useState(false),[options,setOptions]=useState({grid:true,baseline:true,average:false,percentage:false});
    const [hover,setHover]=useState<FinancePoint|null>(null),[selection,setSelection]=useState<[FinancePoint,FinancePoint]|null>(null);
    const [highlight,setHighlight]=useState<number|null>(null);
    const [fullscreen,setFullscreen]=useState(false),[exportError,setExportError]=useState('');
    const column=useRef<HTMLDivElement>(null),expand=useRef<HTMLButtonElement>(null);
    useEffect(()=>{
        const controller=new AbortController();setLoading(true);setError('');setHistory(null);setHover(null);setSelection(null);
        const load=async(id:string)=>{const response=await fetch(`/api/finance/crypto/history?${new URLSearchParams({id,range})}`,{signal:controller.signal});if(!response.ok)throw new Error();const body=await response.json() as CryptoHistory;if(!Array.isArray(body.points))throw new Error();return body;};
        load(asset.id).then(first=>{if(!controller.signal.aborted)setHistory(first);})
            .catch(()=>{if(!controller.signal.aborted)setError('Não foi possível consultar este histórico. Tente novamente.');})
            .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
        return()=>controller.abort();
    },[asset.id,range,retry]);
    const toggleFullscreen=(value:boolean)=>{const update=()=>flushSync(()=>setFullscreen(value));if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(update);else update();};
    useEffect(()=>{
        if(!fullscreen)return;
        const previous=document.activeElement as HTMLElement|null,before=document.body.style.overflow;document.body.style.overflow='hidden';column.current?.focus();
        const key=(event:KeyboardEvent)=>{
            if(event.key==='Escape'&&!column.current?.querySelector(':popover-open')){toggleFullscreen(false);return;}
            if(event.key!=='Tab')return;
            const items=[...column.current!.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"],select,input,a[href]')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);
            if(event.shiftKey&&(document.activeElement===first||document.activeElement===column.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        };
        document.addEventListener('keydown',key);return()=>{document.body.style.overflow=before;document.removeEventListener('keydown',key);requestAnimationFrame(()=>{if(previous?.isConnected)previous.focus();else expand.current?.focus();});};
    },[fullscreen]);
    const samples=useMemo(()=>priceSamples(history?.points??[]),[history]);
    const series=useMemo(()=>cryptoSeries(samples,asset.name,range,candles),[samples,asset.name,range,candles]);
    const comparing=!candles&&compared.ids.length>0;
    const comparisonPlots=useMemo(()=>comparing?compared.entries.flatMap((entry,index)=>{
        const values=comparisonValues(samples,entry.history?.points??[]);
        return values.filter(value=>value!==null).length>1?[{id:entry.id,color:COMPARISON_COLORS[index+1],position:index+1,values}]:[];
    }):[],[comparing,compared.entries,samples]);
    const current=selection?.[1].close??hover?.close??series.points.at(-1)?.close??asset.price;
    const reference=selection?.[0].close??series.baseline,difference=current===null?0:current-reference,percentage=current===null?null:changePercent(current,reference);
    const price=(value:number)=> <FinanceNumber value={value} currency="USD"/>;
    function csv(){const rows=['Data UTC;Preço USD',...samples.map(p=>new Date(p.time).toISOString()+';'+String(p.value).replace('.',','))];download(new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),`comet-${asset.id}-${range}.csv`);}
    return <>
        <div ref={column} className={'finance-chart-column crypto-chart'+(fullscreen?' is-fullscreen':'')} tabIndex={-1} role={fullscreen?'dialog':undefined} aria-modal={fullscreen||undefined} aria-label={fullscreen?`${asset.name} em tela cheia`:undefined}>
            {fullscreen&&<header className="finance-fullscreen-header"><div><strong>{asset.name}</strong><span>{asset.symbol}/USD</span></div><button type="button" aria-label="Sair da tela cheia" onClick={()=>toggleFullscreen(false)}><Icon name="x"/></button></header>}
            <section className="crypto-chart-card" aria-label={`Evolução de ${asset.name}`}>
                <div className="market-summary"><div className="market-summary__values"><span id="market-price" className="market-price">{current===null?'—':price(current)}</span><span id="market-change" className="market-change" data-trend={trend(difference)}>{!loading&&samples.length>0&&<><FinanceNumber value={difference} currency="USD" signed/>{!selection&&difference!==0&&<Icon name={difference>0?'rise':'fall'}/>}<span>{selection?'(':''}{percentage===null?'—':<FinanceNumber value={selection?percentage:Math.abs(percentage)} percentage/>}{selection?')':''}</span></>}</span></div>
                    <p id="market-period" className="market-period">{hover?dateLabel(hover)+' UTC':samples.length?`${dateLabel(series.points[0])} – ${dateLabel(series.points.at(-1)!)} · UTC`:loading?<LoadingIndicator label="Buscando histórico"/>:'Histórico indisponível'}</p>
                </div>
                <div className="finance-chart-body">
                    <div className="chart-toolbar">
                        <div className="finance-periods" role="group" aria-label="Período do gráfico">{ranges.map(item=><button type="button" key={item.value} data-range={item.value} aria-pressed={range===item.value} onClick={()=>setRange(item.value)}>{item.label}</button>)}</div>
                        <div className="finance-chart-tools">
                            <div className="chart-styles" role="group" aria-label="Tipo de gráfico"><button type="button" aria-label="Gráfico de linha" title="Gráfico de linha" aria-pressed={!candles} onClick={()=>setCandles(false)}><Icon name="line"/></button><button type="button" aria-label="Gráfico de velas" title="Gráfico de velas" aria-pressed={candles} onClick={()=>setCandles(true)}><Icon name="candles"/></button></div>
                            <button type="button" className="finance-toolbar-icon" aria-label="Baixar imagem" title="Baixar imagem" disabled={loading||samples.length<2} onClick={()=>{setExportError('');const svg=column.current?.querySelector<SVGSVGElement>('.finance-main-svg');if(svg)void downloadChart(svg).catch(()=>setExportError('Não foi possível baixar a imagem. Tente novamente.'));}}><Icon name="camera"/></button>
                            {!fullscreen&&<button ref={expand} type="button" className="finance-toolbar-icon" aria-label="Tela cheia" title="Tela cheia" onClick={()=>toggleFullscreen(true)}><Icon name="expand"/></button>}
                            <Menu label="Opções do gráfico" icon="more">{([['grid','Linhas de grade'],['baseline','Linha inicial'],['average','Média móvel (20 períodos)'],['percentage','Escala percentual']] as const).map(([key,label])=><button type="button" key={key} role="menuitemcheckbox" aria-checked={key==='percentage'?comparing||options[key]:options[key]} disabled={key==='percentage'&&(series.baseline===0||comparing)} onClick={()=>setOptions(prev=>({...prev,[key]:!prev[key]}))}>{label}{(options[key]||key==='percentage'&&comparing)&&<Icon name="check"/>}</button>)}<button type="button" data-dismiss disabled={!samples.length} onClick={csv}>Exportar CSV<Icon name="download"/></button></Menu>
                        </div>
                        {!candles&&<CryptoCompareMenu selected={[asset.id,...compared.ids]} onAdd={compared.add}/>}
                    </div>
                    <div className="market-history" aria-busy={loading}>{error?<div className="market-chart-empty"><p role="status">{error}</p><button type="button" className="market-small-pill" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></div>:<>
                        <FinancePlot series={series} candles={candles} volume={false} {...options} percentage={(options.percentage||comparing)&&series.baseline!==0} comparisons={comparisonPlots} comparisonColor={comparing?COMPARISON_COLORS[0]:undefined} comparisonFocus={highlight} currency="USD" priceOnly resetKey={asset.id+range+candles+retry} onHover={setHover} onSelection={setSelection}/>
                        {loading&&<p className="finance-loading" role="status"><LoadingIndicator label="Buscando histórico"/></p>}
                        {!loading&&samples.length<2&&<p className="chart-empty">Não há histórico suficiente neste período.</p>}
                    </>}</div>
                    {comparing&&<CryptoComparisonLegend asset={asset} history={history} entries={compared.entries} hover={hover} selection={selection} onRemove={id=>{setHighlight(null);compared.remove(id);}} onRetry={compared.retry} onHighlight={setHighlight}/>}
                </div>
                <dl className="chart-statistics" aria-label="Resumo do período selecionado">{([['Inicial',series.baseline],['Máxima',samples.length?Math.max(...samples.map(p=>p.value)):null],['Mínima',samples.length?Math.min(...samples.map(p=>p.value)):null]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{!samples.length||typeof value!=='number'?'—':price(value)}</dd></div>)}</dl>
            </section>
            {exportError&&<p role="alert">{exportError}</p>}
            {candles&&<p className="market-caption crypto-chart-caption">Velas calculadas a partir das cotações amostradas · UTC.</p>}
            {history?.stale&&<p className="market-caption crypto-chart-caption" role="status">{history.notice||'Exibindo o último histórico disponível.'}</p>}
        </div>
        <dl className="market-stat-grid"><div><dt>Valor de mercado</dt><dd>{asset.marketCap===null?'—':compactUSD(asset.marketCap)}</dd></div><div><dt>Volume 24h</dt><dd>{asset.volume===null?'—':compactUSD(asset.volume)}</dd></div><div><dt>Variação 24h</dt><dd className={'market-change--'+trend(asset.changePercent??0)}>{asset.changePercent===null?'—':<FinanceNumber value={asset.changePercent} percentage/>}</dd></div></dl>
        <CryptoPriceMovements asset={asset} history={history} range={range} loading={loading} error={error}/>
    </>;
}
