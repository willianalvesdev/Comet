import { useId, useRef, type ReactNode } from 'react';
export function Icon({name}:{name:string}) {return <i className={'finance-icon finance-icon--'+name} aria-hidden="true"/>;}
export function Menu({label,children,icon}:{label:string;children:ReactNode;icon?:string}) {
 const id=useId(),ref=useRef<HTMLDivElement>(null);
 return <div className="finance-menu-anchor"><button type="button" aria-label={label} title={label} popoverTarget={id}>{icon?<Icon name={icon}/>:label}{!icon&&<Icon name="chevron"/>}</button><div id={id} ref={ref} className="finance-menu" popover="auto" onClick={e=>{if((e.target as HTMLElement).closest('[data-dismiss]'))ref.current?.hidePopover();}}>{children}</div></div>;
}
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function downloadChart(node:SVGSVGElement) {
 const copy=node.cloneNode(true) as SVGSVGElement;
 const original=[node,...node.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
 // Inline computed paint and font properties so an exported SVG keeps the current theme.
 original.forEach((element,i)=>{const style=getComputedStyle(element);for(const key of ['fill','stroke','stroke-width','stroke-dasharray','opacity','stop-color','stop-opacity','font-family','font-size','font-weight']) (clones[i] as SVGElement).style.setProperty(key,style.getPropertyValue(key));});
 copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
 const box=node.viewBox.baseVal;copy.setAttribute('width',String(box.width));copy.setAttribute('height',String(box.height));
 const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
 try {const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=box.width*2;canvas.height=box.height*2;const ctx=canvas.getContext('2d');if(!ctx)throw Error();ctx.scale(2,2);ctx.fillStyle=getComputedStyle(node).getPropertyValue('--chart-surface');ctx.fillRect(0,0,box.width,box.height);ctx.drawImage(img,0,0);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve));if(!blob)throw Error();download(blob,'comet-grafico.png');}finally{URL.revokeObjectURL(url);}
}
