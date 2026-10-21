import {showLoading} from './loading-indicator';
import type {ImageResult} from '../../server/ai/research';
export function chatImages(section:HTMLElement,{scope,fetch}:Pick<PageContext,'scope'|'fetch'>){
    let controller:AbortController|null=null,current='';
    const cache=new Map<string,{at:number;images:ImageResult[]}>();
    const valid=(value:unknown)=>{try{const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
    function gallery(images:ImageResult[]){
        const grid=document.createElement('div');grid.className='chat-images__grid';
        for(const item of images){
            const url=valid(item.url),image=valid(item.image),thumbnail=valid(item.thumbnail);
            if(!url||!image||!thumbnail)continue;
            const link=document.createElement('a');link.className='chat-images__result';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title=item.title;
            const preview=document.createElement('span');preview.className='chat-images__preview';
            const img=document.createElement('img');img.src=thumbnail;img.alt=item.title;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
            const aspect=(width:number,height:number)=>link.style.setProperty('--image-ratio',String(Math.max(.55,Math.min(2.25,width/height||1.4))));
            aspect(item.width??1.4,item.height??1);
            img.addEventListener('load',()=>aspect(img.naturalWidth,img.naturalHeight),{signal:scope.signal});
            img.addEventListener('error',()=>{if(img.src!==image){img.src=image;return;}img.hidden=true;preview.classList.add('is-unavailable');preview.textContent='Imagem indisponível';},{signal:scope.signal});
            const publisher=document.createElement('span');publisher.className='chat-images__publisher';
            const icon=document.createElement('i');icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=item.domain||new URL(url).hostname;publisher.append(icon,label);
            preview.append(img);link.append(preview,publisher);grid.append(link);
        }
        section.append(grid);
        if(!grid.childElementCount){const empty=document.createElement('p');empty.className='chat-images__status';empty.textContent='Nenhuma imagem encontrada para esta pesquisa.';empty.setAttribute('role','status');section.append(empty);}
    }
    async function show(query:string,engine='searxng',retry=false){
        const key=engine+':'+query;
        if(current===key&&!retry)return;
        controller?.abort();const pending=new AbortController();controller=pending;current=key;section.replaceChildren();
        const title=document.createElement('p');title.className='chat-links__query';title.textContent='Resultados de imagens para: '+query;section.append(title);
        const saved=cache.get(key);if(saved&&Date.now()-saved.at<300000&&!retry){gallery(saved.images);return;}
        const status=document.createElement('div');status.className='chat-images__status';showLoading(status,'Buscando imagens');section.append(status);section.setAttribute('aria-busy','true');
        try{
            const response=await fetch('/api/ai/images?'+new URLSearchParams({q:query,engine}),{signal:pending.signal});
            if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.images))throw Error();
            if(pending.signal.aborted||!scope.active)return;
            const images=data.images.filter((item:unknown)=>item&&typeof item==='object').slice(0,40) as ImageResult[];
            cache.set(key,{at:Date.now(),images});if(cache.size>12)cache.delete(cache.keys().next().value!);status.remove();gallery(images);
        }catch{
            if(pending.signal.aborted||!scope.active)return;
            status.replaceChildren();const message=document.createElement('p');message.textContent='Não foi possível buscar imagens.';message.setAttribute('role','status');
            const button=document.createElement('button');button.type='button';button.textContent='Tentar novamente';button.addEventListener('click',()=>void show(query,engine,true),{signal:scope.signal});status.append(message,button);
        }finally{if(!pending.signal.aborted&&scope.active)section.setAttribute('aria-busy','false');}
    }
    return {show,reset(){controller?.abort();controller=null;current='';section.replaceChildren();section.setAttribute('aria-busy','false');}};
}
