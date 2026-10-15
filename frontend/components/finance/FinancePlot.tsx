import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FinancePoint, FinanceSeries } from '../../../shared/finance-chart';
export const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
export const percent=(n:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n)+'%';
export const changePercent=(a:number,b:number)=>b===0?(a===0?0:null):(a-b)/Math.abs(b)*100;
export const dateLabel=(p:FinancePoint)=>new Date(p.date+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'})+(p.clock?' · '+p.clock.slice(0,5):'');
export function pathFor(values:number[],width:number,height:number,baseline:number,pad=8){
 const min=Math.min(baseline,...values),max=Math.max(baseline,...values),span=max-min||Math.max(Math.abs(max)*.1,1);
 const y=(v:number)=>height-pad-(v-min+span*.05)/(span*1.1)*(height-pad*2);
 const points=values.length>1?values:[values[0]??baseline,values[0]??baseline];
 return {d:points.map((v,i)=>(i?'L':'M')+(i*width/(points.length-1)).toFixed(2)+' '+y(v).toFixed(2)).join(' '),y,baseline:y(baseline)};
}
export function Sparkline({values,baseline}:{values:number[];baseline:number}) {
 const id=useId().replaceAll(':',''),{d,baseline:y}=pathFor(values,260,76,baseline);
 return <svg className="finance-total__sparkline" viewBox="0 0 260 76" preserveAspectRatio="none" role="img" aria-label="Evolução no mês atual"><defs>
  <linearGradient id={id+'color'} x1="0" y1="0" x2="0" y2="76" gradientUnits="userSpaceOnUse"><stop offset={y/76} stopColor="var(--chart-up)"/><stop offset={y/76} stopColor="var(--chart-down)"/></linearGradient>
  <linearGradient id={id+'fade'} x2="0" y2="1"><stop stopColor="white" stopOpacity=".22"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient><mask id={id+'mask'}><rect width="260" height="76" fill={'url(#'+id+'fade)'}/></mask>
  <filter id={id+'glow'} x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="1.6"/></filter>
 </defs><path d={'M0 '+y+' H260'} className="finance-total__baseline"/>
 <path d={d+' L260 76 L0 76 Z'} fill={'url(#'+id+'color)'} mask={'url(#'+id+'mask)'}/><path className="finance-total__glow" d={d} fill="none" stroke={'url(#'+id+'color)'} strokeWidth="3" opacity=".3" filter={'url(#'+id+'glow)'}/><path className="finance-total__line" d={d} fill="none" stroke={'url(#'+id+'color)'} strokeWidth="1.75" vectorEffect="non-scaling-stroke"/></svg>;
}
interface Props {series:FinanceSeries;candles:boolean;volume:boolean;grid:boolean;baseline:boolean;average:boolean;percentage:boolean;resetKey:string;onHover:(point:FinancePoint|null)=>void;onSelection:(range:[FinancePoint,FinancePoint]|null)=>void;}
export function FinancePlot(p:Props){
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),[width,setWidth]=useState(800),[height,setHeight]=useState(292);
 const [zoom,setZoom]=useState({k:1,x:0}),[hover,setHover]=useState<number|null>(null),[selection,setSelection]=useState<[number,number]|null>(null),[cursorX,setCursorX]=useState(0),drag=useRef<{index:number;x:number}|null>(null),id=useId().replaceAll(':','');
 useEffect(()=>{const node=host.current!;const resize=new ResizeObserver(()=>{setWidth(Math.max(1,node.clientWidth));setHeight(Math.max(1,node.clientHeight));});resize.observe(node);return()=>resize.disconnect();},[]);
 useEffect(()=>{setZoom({k:1,x:0});setHover(null);setSelection(null);p.onHover(null);},[p.resetKey,p.series]); // period/metric switches reset the viewport
 const tooltip=useRef<HTMLDivElement>(null),[pointer,setPointer]=useState({x:0,y:0}),[tooltipSize,setTooltipSize]=useState({width:200,height:180});
 const points=p.series.points,base=p.series.baseline;
 useEffect(()=>{const start=selection&&points[Math.min(...selection)],end=selection&&points[Math.max(...selection)];p.onSelection(start&&end?[start,end]:null);},[selection,p.series]);
 useEffect(()=>{const hide=()=>{setHover(null);setSelection(null);drag.current=null;p.onHover(null);};window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);return()=>{window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);};},[p.onHover]);
 const normalize=(v:number,b:number)=>p.percentage&&b!==0?(v-b)/Math.abs(b)*100:v;
 const x=(i:number)=>points.length<=1?width/2:(i/(points.length-1)*width)*zoom.k+zoom.x;
 // Horizontal zoom preserves the vertical domain of the complete period.
 const domain=points.flatMap(point=>p.candles?[normalize(point.low,base),normalize(point.high,base)]:[normalize(point.close,base)]);
 const reference=normalize(base,base),rawMin=Math.min(reference,...domain),rawMax=Math.max(reference,...domain),span=rawMax-rawMin||Math.max(Math.abs(rawMax)*.1,1),min=rawMin-span*.05,max=rawMax+span*.05;
 const rawStep=(max-min)/5,magnitude=10**Math.floor(Math.log10(rawStep)),fraction=rawStep/magnitude,step=(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*magnitude;
 const ticks=Array.from({length:Math.max(0,Math.floor(max/step)-Math.ceil(min/step)+1)},(_,i)=>(Math.ceil(min/step)+i)*step);
 const top=16,bottom=height-42,volumeHeight=p.volume?42:0,chartBottom=bottom-volumeHeight;
 const y=(v:number)=>chartBottom-(v-min)/(max-min)*(chartBottom-top),baseY=y(reference);
 const d=points.map((point,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(normalize(point.close,base)).toFixed(2)).join(' ');
 const maxVolume=Math.max(1,...points.map(pt=>pt.volume));
 const barWidth=Math.max(1,Math.min(16,width/Math.max(1,points.length)*zoom.k*.7));
 const average=useMemo(()=>points.map((_,i)=>i<19?null:points.slice(i-19,i+1).reduce((sum,p)=>sum+p.close,0)/20),[points]);
 const candlePaths=['up','down'].map((trend)=>points.map((pt,i)=>{if((pt.close>=pt.open?'up':'down')!==trend)return '';const cx=x(i),a=y(normalize(pt.open,base)),b=y(normalize(pt.close,base));return `M${cx} ${y(normalize(pt.high,base))}V${y(normalize(pt.low,base))} M${cx-barWidth/2} ${Math.min(a,b)}h${barWidth}v${Math.max(1,Math.abs(a-b))}h${-barWidth}Z`;}).join(' '));
 const closest=(clientX:number)=>Math.max(0,Math.min(points.length-1,Math.round(((clientX-host.current!.getBoundingClientRect().left-zoom.x)/zoom.k)/width*Math.max(1,points.length-1))));
 const localX=(clientX:number)=>Math.max(Math.max(0,x(0)),Math.min(Math.min(width,x(points.length-1)),clientX-host.current!.getBoundingClientRect().left));
 const select=(i:number|null,px=i===null?0:x(i),clientY?:number)=>{setHover(i);setCursorX(px);const box=host.current?.getBoundingClientRect();if(box&&i!==null)setPointer({x:box.left+px,y:clientY??box.top+y(normalize(points[i].close,base))});p.onHover(i===null?null:points[i]??null);};
 const clearPointer=()=>{touches.current.clear();pinch.current=null;drag.current=null;setSelection(null);select(null);};
 useEffect(()=>{const node=host.current!;const wheel=(e:WheelEvent)=>{if(!points.length)return;e.preventDefault();const px=e.clientX-node.getBoundingClientRect().left;setZoom(old=>{const k=Math.max(1,Math.min(20,old.k*Math.exp(-e.deltaY*.002)));return {k,x:Math.max(width*(1-k),Math.min(0,px-(px-old.x)*k/old.k))};});setSelection(null);select(null);};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[width,points]);
 const touches=useRef(new Map<number,number>()),pinch=useRef<{distance:number;center:number;k:number;x:number}|null>(null);
 const zoomAt=(factor:number,center=width/2)=>{setZoom(old=>{const k=Math.max(1,Math.min(20,old.k*factor));return {k,x:Math.max(width*(1-k),Math.min(0,center-(center-old.x)*k/old.k))};});setSelection(null);select(null);};
 const selected=hover===null?null:points[hover];
 const range=selection&&selection[0]!==selection[1]&&points[Math.min(...selection)]&&points[Math.max(...selection)]?[points[Math.min(...selection)],points[Math.max(...selection)]]:null;
 const selectionX=drag.current?Math.min(drag.current.x,cursorX):0,selectionWidth=drag.current?Math.abs(cursorX-drag.current.x):0;
 const selectionTrend=range?Math.sign(range[1].close-range[0].close):0;
 useLayoutEffect(()=>{const box=tooltip.current?.getBoundingClientRect();if(box)setTooltipSize({width:box.width,height:box.height});},[!!selected,!!range]);
 return <div ref={host} className="finance-svg-stage" id="market-chart" tabIndex={0} role="group" aria-label="Gráfico interativo de saldo e movimentação. Use as setas para navegar; arraste para comparar." onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)&&points.length){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(hover??0)+(e.key==='ArrowLeft'?-1:1))));}if(['+','=','-'].includes(e.key)){e.preventDefault();zoomAt(e.key==='-'?.8:1.25);}if(e.key==='Escape'){select(null);setSelection(null);setZoom({k:1,x:0});}}}>
 <svg ref={svg} className="finance-main-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={'Evolução de '+p.series.label} onPointerMove={e=>{if(!points.length)return;if(touches.current.has(e.pointerId))touches.current.set(e.pointerId,e.clientX);if(pinch.current&&touches.current.size===2){const [a,b]=[...touches.current.values()],old=pinch.current,k=Math.max(1,Math.min(20,old.k*Math.abs(a-b)/old.distance)),center=(a+b)/2-host.current!.getBoundingClientRect().left;setZoom({k,x:Math.max(width*(1-k),Math.min(0,center-(old.center-old.x)*k/old.k))});return;}const bounds=e.currentTarget.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom){clearPointer();return;}const i=closest(e.clientX);select(i,localX(e.clientX),e.clientY);if(drag.current)setSelection([drag.current.index,i]);}} onPointerDown={e=>{if(!points.length)return;if(e.pointerType==='touch'){touches.current.set(e.pointerId,e.clientX);if(touches.current.size===2){const [a,b]=[...touches.current.values()];pinch.current={distance:Math.max(1,Math.abs(a-b)),center:(a+b)/2-host.current!.getBoundingClientRect().left,...zoom};drag.current=null;setSelection(null);select(null);e.currentTarget.setPointerCapture(e.pointerId);return;}}const i=closest(e.clientX),px=localX(e.clientX);drag.current={index:i,x:px};select(i,px,e.clientY);setSelection([i,i]);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{touches.current.delete(e.pointerId);pinch.current=null;drag.current=null;setSelection(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(e.pointerType==='touch')select(null);}} onPointerCancel={clearPointer} onPointerLeave={clearPointer} onLostPointerCapture={()=>{drag.current=null;setSelection(null);}} onDoubleClick={()=>{setSelection(null);setZoom({k:1,x:0});}}>
 <defs><clipPath id={id+'selection'}><rect x={selection?selectionX:0} width={selection?selectionWidth:width} height={height}/></clipPath><clipPath id={id+'clip'}><rect x="0" y={top-2} width={width} height={bottom-top+2}/></clipPath><linearGradient id={id+'line'} x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="var(--chart-up)"/><stop offset="1" stopColor="var(--chart-up)"/></linearGradient><clipPath id={id+'positive'}><rect width={width} height={Math.max(0,baseY)}/></clipPath><clipPath id={id+'negative'}><rect y={baseY} width={width} height={height}/></clipPath><linearGradient id={id+'fill'} x2="0" y2="1"><stop stopColor="white" stopOpacity=".14"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient><mask id={id+'mask'}><rect width={width} height={height} fill={'url(#'+id+'fill)'}/></mask></defs>
 {ticks.map((v,i)=>{const py=y(v);return <g key={i}>{p.grid&&<path d={`M0 ${py}H${width}`} className="finance-grid-line"/>}<text x="20" y={py-6} className="finance-axis-label">{p.percentage?percent(v):new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(v)}</text></g>;})}
 {[...new Set(Array.from({length:Math.min(points.length,width<500?3:5)},(_,i)=>Math.max(0,Math.min(points.length-1,Math.round((i/Math.max(1,Math.min(points.length,width<500?3:5)-1)*width-zoom.x)/zoom.k/width*Math.max(0,points.length-1))))))].map(j=>{const px=x(j);return <g key={j}>{p.grid&&<path d={`M${px} ${top}V${bottom}`} className="finance-grid-line"/>}{points[j]&&<text x={Math.max(42,Math.min(width-42,px))} y={height-14} textAnchor="middle" className="finance-axis-label">{points[j].clock?.slice(0,5)||new Date(points[j].date+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'UTC',day:'numeric',month:'short'})}</text>}</g>;})}
 <g clipPath={'url(#'+id+'clip)'}>
 {!points.length&&<path d={`M0 ${baseY}H${width}`} stroke="var(--chart-muted)" strokeWidth="1.75"/>}
 {p.volume&&points.map((pt,i)=><rect key={i} x={x(i)-barWidth/2} y={bottom-Math.pow(pt.volume/maxVolume,.4)*volumeHeight} width={barWidth} height={Math.pow(pt.volume/maxVolume,.4)*volumeHeight} fill={pt.close>=pt.open?'var(--chart-up)':'var(--chart-down)'} opacity=".25"/>)}
 {points.length===1&&!p.candles&&<circle cx={x(0)} cy={y(normalize(points[0].close,base))} r="3" fill={points[0].close>=base?'var(--chart-up)':'var(--chart-down)'}/> }
 {p.candles?candlePaths.map((path,i)=><path className="finance-candle" key={i} d={path} fill={i?'var(--chart-down)':'var(--chart-up)'} stroke={i?'var(--chart-down)':'var(--chart-up)'} strokeWidth="1"/>):<>{['positive','negative'].map((part,i)=><g key={part} clipPath={'url(#'+id+part+')'}><g clipPath={'url(#'+id+'selection)'}><path d={d+(points.length?` L${x(points.length-1)} ${chartBottom} L${x(0)} ${chartBottom}Z`:'')} fill={i?'var(--chart-down)':'var(--chart-up)'} mask={'url(#'+id+'mask)'}/></g><path className="finance-price-line" d={d} fill="none" stroke={i?'var(--chart-down)':'var(--chart-up)'} strokeWidth="1.75"/></g>)}</>}
 {p.average&&<path d={average.map((v,i)=>v===null?'':(i===19?'M':'L')+x(i)+' '+y(normalize(v,base))).join(' ')} fill="none" stroke="var(--chart-muted)" strokeWidth="1.5" strokeDasharray="4 3"/>}
 {p.baseline&&<path d={`M0 ${baseY}H${width}`} stroke="var(--chart-muted)" opacity=".6" strokeDasharray="3 3"/>}
 </g>
 {selection&&<rect className="finance-selection" x={selectionX} y="0" width={selectionWidth} height={height} rx="6" fill="var(--chart-text)" opacity=".05"/>}
 {selected&&hover!==null&&<path className="finance-cursor" d={`M${cursorX} 0V${height}`} stroke={selectionTrend>0?'var(--chart-up)':selectionTrend<0?'var(--chart-down)':'var(--text-tertiary,var(--chart-muted))'} strokeWidth="1"/>}
 </svg>
 {selected&&hover!==null&&createPortal(<div className="finance-page finance-tooltip-layer"><div ref={tooltip} className="finance-hover" id="chart-tooltip" style={{left:Math.max(8,Math.min(window.innerWidth-tooltipSize.width-8,pointer.x+16)),top:Math.max(8,Math.min(window.innerHeight-tooltipSize.height-8,pointer.y+16))}}><time>{dateLabel(selected)}{!selected.clock&&p.resetKey.includes('movement')?' · sem horário':''}</time>{range?<strong className="finance-range-value" data-trend={selectionTrend>0?'up':selectionTrend<0?'down':'neutral'}>{selectionTrend>0?'+':''}{brl(range[1].close-range[0].close)} ({changePercent(range[1].close,range[0].close)===null?'—':percent(changePercent(range[1].close,range[0].close)!)})</strong>:<dl>{(['close','open','high','low','volume'] as const).map((k,i)=><div key={k}><dt>{['Final','Inicial','Máxima','Mínima','Movimentação'][i]}</dt><dd>{brl(selected[k])}</dd></div>)}</dl>}</div></div>,document.body)}
 {zoom.k>1&&<button type="button" className="finance-reset-zoom" onClick={()=>{setZoom({k:1,x:0});setSelection(null);}}>Redefinir zoom</button>}
 </div>;
}
