const groups = new WeakMap<HTMLAnchorElement, ResearchSource[]>();
function domain(source:ResearchSource){return new URL(source.url).hostname.replace(/^www\./,'');}
function label(link:HTMLAnchorElement, sources:ResearchSource[], index=0){
    const source=sources[index];link.href=source.url;
    const name=document.createElement('span');name.textContent=domain(source);link.replaceChildren(name);
    if(sources.length>1){const extra=document.createElement('small');extra.textContent=' +'+(sources.length-1);link.append(extra);}
    link.setAttribute('aria-label',source.title+' · '+sources.length+(sources.length===1?' fonte':' fontes'));
}
export function citationLink(values:(ResearchSource|undefined)[]){
    if(values.some(source=>{try{const url=new URL(source!.url);return url.protocol!=='https:'||!!url.username||!!url.password;}catch{return true;}}))return null;
    const sources=values.filter((source,index)=>values.findIndex(other=>other?.url===source?.url)===index) as ResearchSource[];
    if(!sources.length)return null;
    const link=document.createElement('a');link.className='computer-citation';link.target='_blank';link.rel='noopener noreferrer';
    link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-expanded','false');label(link,sources);groups.set(link,sources);return link;
}
export function citationPreviews({scope,setTimeout,MutationObserver}:Pick<PageContext,'scope'|'setTimeout'|'MutationObserver'>){
    const panel=document.createElement('div');panel.className='citation-preview';panel.popover='manual';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Prévia das fontes');
    panel.innerHTML='<div class="citation-preview__nav"><button type="button" aria-label="Fonte anterior">‹</button><span class="citation-preview__position" aria-live="polite"></span><button type="button" aria-label="Próxima fonte">›</button><span class="citation-preview__count"></span></div><a class="citation-preview__source" target="_blank" rel="noopener noreferrer"><span class="citation-preview__domain"></span><strong></strong><p></p></a>';
    scope.append(panel);
    const buttons=panel.querySelectorAll('button'),position=panel.querySelector<HTMLElement>('.citation-preview__position')!,count=panel.querySelector<HTMLElement>('.citation-preview__count')!,link=panel.querySelector('a')!,publisher=panel.querySelector<HTMLElement>('.citation-preview__domain')!,title=panel.querySelector('strong')!,excerpt=panel.querySelector('p')!;
    let trigger:HTMLAnchorElement|null=null,sources:ResearchSource[]=[],index=0,timer=0;
    const cancel=()=>{clearTimeout(timer);};
    function close(){cancel();trigger?.setAttribute('aria-expanded','false');panel.hidePopover();trigger=null;sources=[];}
    function place(){
        if(!trigger?.isConnected){close();return;}
        const bounds=trigger.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
        panel.style.left=Math.max(8,Math.min(bounds.left,innerWidth-width-8))+'px';
        const below=bounds.bottom+10;
        const top=Math.max(8,Math.min(below+height<=innerHeight-8?below:bounds.top-height-10,innerHeight-height-8));
        panel.style.top=top+'px';panel.style.maxHeight=(innerHeight-top-8)+'px';
    }
    function render(){
        const source=sources[index];position.textContent=(index+1)+'/'+sources.length;count.textContent=sources.length+(sources.length===1?' fonte':' fontes');
        buttons.forEach(button=>{button.hidden=sources.length===1;});buttons[0].disabled=index===0;buttons[1].disabled=index===sources.length-1;
        link.href=source.url;publisher.textContent=domain(source);
        const image=document.createElement('img');image.alt='';image.width=image.height=16;image.referrerPolicy='no-referrer';image.src='https://www.google.com/s2/favicons?domain='+encodeURIComponent(domain(source))+'&sz=32';
        image.addEventListener('error',()=>image.remove(),{once:true,signal:scope.signal});publisher.prepend(image);
        title.textContent=source.title;excerpt.textContent=source.excerpt||source.snippet||'';
        if(trigger)label(trigger,sources,index);
    }
    function open(anchor:HTMLAnchorElement){
        cancel();if(anchor===trigger)return;
        const value=groups.get(anchor);if(!value)return;
        close();trigger=anchor;sources=value;index=Math.max(0,sources.findIndex(source=>new URL(source.url).href===anchor.href));
        anchor.setAttribute('aria-expanded','true');panel.style.maxHeight='';panel.showPopover();render();place();
    }
    const inside=(node:EventTarget|null)=>node instanceof Node&&(panel.contains(node)||!!trigger?.contains(node));
    const defer=()=>{cancel();timer=setTimeout(()=>{if(!panel.matches(':hover')&&!trigger?.matches(':hover')&&!inside(document.activeElement))close();},180);};
    // Layout changes under a stationary pointer must not switch the active source.
    scope.listen(document,'pointermove',event=>{
        const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('.computer-citation'):null;
        if(anchor)open(anchor);else if(inside(event.target))cancel();
    });
    scope.listen(document,'pointerout',event=>{if(inside(event.target)&&!inside(event.relatedTarget))defer();});
    scope.listen(document,'focusin',event=>{
        const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('.computer-citation'):null;
        if(anchor)open(anchor);else if(inside(event.target))cancel();else close();
    });
    scope.listen(document,'focusout',event=>{if(inside(event.target)&&!inside(event.relatedTarget))defer();});
    scope.listen(document,'keydown',event=>{
        if(!trigger)return;
        if(event.key==='Escape'){const anchor=trigger;anchor.focus();close();event.preventDefault();}
        else if(event.key==='ArrowDown'&&event.target===trigger){event.preventDefault();([...buttons].find(button=>!button.hidden&&!button.disabled)??link).focus();}
    });
    scope.listen(document,'pointerdown',event=>{if(trigger&&!inside(event.target))close();});
    buttons.forEach((button,i)=>scope.listen(button,'click',()=>{index+=i?1:-1;render();}));
    scope.listen(window,'resize',()=>{if(trigger)place();});
    scope.listen(document,'scroll',event=>{if(trigger&&!panel.contains(event.target as Node))close();},true);
    new MutationObserver(()=>{if(trigger&&!trigger.isConnected)close();}).observe(document.body,{childList:true,subtree:true});
    scope.cleanup(close);return {reset:close};
}
