import {zipSync} from 'fflate';
import {csvText,chartSVG,type Artifact,type ArtifactFile} from '../../shared/artifacts';
import {conversationIdFromURL} from '../routes';
import {renderAnswer,tableView,positionTableHeaders} from './answer-content';
import type {Sheet} from '../../shared/artifacts';
import {showLoading} from './loading-indicator';
export function chatArtifacts({scope,fetch,ResizeObserver,requestAnimationFrame}:Pick<PageContext,'scope'|'fetch'|'ResizeObserver'|'requestAnimationFrame'>,changed:()=>void) {
    const records=new Map<HTMLElement,Artifact[]>(),section=document.createElement('details');section.className='sources-card artifact-section';section.open=true;section.hidden=true;
    const workspace=document.querySelector<HTMLElement>('.workspace')!,scroller=document.querySelector<HTMLElement>('.workspace__content')!;
    const preview=document.createElement('aside');preview.className='artifact-preview';preview.hidden=true;preview.setAttribute('aria-label','Prévia do arquivo');scope.append(preview);
    let zipController:AbortController|null=null;
    let trigger:HTMLElement|null=null,downloadController:AbortController|null=null,paneWidth=0,expanded=false,frame=false,previousInert=false;
    const labels:Record<string,string>={xlsx:'Planilha do Excel',csv:'CSV',pdf:'PDF',docx:'Documento Word',md:'Markdown',png:'Imagem PNG',svg:'Gráfico SVG',html:'Página HTML',txt:'Texto',json:'JSON'};
    const icon=(file:ArtifactFile)=>{const i=document.createElement('i');i.className='artifact-file-icon '+(file.format==='xlsx'?'artifact-file-icon--sheet':'');i.setAttribute('aria-hidden','true');return i;};
    const all=()=>{for(const article of records.keys())if(!article.isConnected)records.delete(article);return [...records.values()].flat().filter(a=>!a.expires_at||Date.parse(a.expires_at)>Date.now());};
    function updateTables(){if(frame)return;frame=true;requestAnimationFrame(()=>{frame=false;const content=preview.querySelector<HTMLElement>('.artifact-preview__content');if(content)positionTableHeaders(content);});}
    function layout(){
        if(preview.hidden)return;
        const available=innerWidth-Math.max(0,scroller.getBoundingClientRect().left),mobile=innerWidth<900||available<720;
        const width=mobile||expanded?innerWidth:Math.max(340,Math.min(paneWidth||available*.5,available-360));
        workspace.style.setProperty('--artifact-panel-width',width+'px');preview.style.width=width+'px';
        workspace.classList.toggle('artifact-preview-expanded',expanded||mobile);
        const handle=preview.querySelector<HTMLElement>('.artifact-resizer');if(handle){handle.hidden=expanded||mobile;handle.setAttribute('aria-valuenow',String(Math.round(width)));handle.setAttribute('aria-valuemax',String(Math.max(340,Math.round(available-360))));}
        scroller.inert=expanded||mobile;
        updateTables();
    }
    function close(restoreFocus=true){
        downloadController?.abort();downloadController=null;if(!preview.hidden)scroller.inert=previousInert;preview.hidden=true;preview.replaceChildren();expanded=false;
        workspace.classList.remove('has-artifact-preview','artifact-preview-expanded','is-resizing-artifact');workspace.style.removeProperty('--artifact-panel-width');
        if(restoreFocus&&trigger?.isConnected)trigger.focus({preventScroll:true});
    }
    scope.listen(window,'resize',layout);new ResizeObserver(()=>{layout();}).observe(scroller);
    scope.listen(preview,'scroll',updateTables,{capture:true,passive:true});
    scope.listen(document,'keydown',event=>{if(event.key==='Escape'&&!preview.hidden&&!document.querySelector(':popover-open')){event.preventDefault();close();}});
    async function download(artifact:Artifact,file:ArtifactFile,status:HTMLElement,button:HTMLButtonElement){
        if(artifact.expires_at&&Date.parse(artifact.expires_at)<=Date.now()){status.textContent='Este arquivo expirou.';return;}
        const cid=conversationIdFromURL(new URL(location.href));downloadController?.abort();const controller=new AbortController();downloadController=controller;button.disabled=true;showLoading(status,'Preparando arquivo');
        try{
            const response=artifact.expires_at?await fetch('/api/ai/artifacts/render',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRFToken':document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content||''},body:JSON.stringify({artifact,format:file.format})}):await fetch(`/api/ai/conversations/${encodeURIComponent(cid||'')}/artifacts/${artifact.id}?format=${file.format}`,{signal:controller.signal,cache:'no-store'});
            if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'Não foi possível baixar o arquivo. Tente novamente.');}
            const blob=await response.blob();if(controller.signal.aborted)return;
            const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='';
        }catch(error){if(!controller.signal.aborted)status.textContent=error instanceof Error?error.message:'Não foi possível baixar o arquivo.';}
        finally{button.disabled=false;}
    }
    function open(artifact:Artifact,file:ArtifactFile,source:HTMLElement,tableOnly=false){
        close(false);previousInert=scroller.inert;trigger=source;source.closest<HTMLElement>('[popover]')?.hidePopover();
        const heading=document.createElement('header'),title=document.createElement('strong');title.textContent=file.name;
        const controls=document.createElement('div'),format=document.createElement('select');format.setAttribute('aria-label','Formato para baixar');
        for(const f of artifact.files){const option=document.createElement('option');option.value=f.format;option.textContent=f.format.toUpperCase();format.append(option);}format.value=file.format;
        const save=document.createElement('button');save.type='button';save.textContent='Baixar';
        const expand=document.createElement('button');expand.type='button';expand.className='artifact-expand';expand.setAttribute('aria-label','Expandir artefato');expand.setAttribute('aria-pressed','false');expand.innerHTML='<i aria-hidden="true"></i>';
        const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='artifact-close';dismiss.setAttribute('aria-label','Fechar artefato');dismiss.innerHTML='<i aria-hidden="true"></i>';
        controls.append(format,save,expand,dismiss);heading.append(title,controls);const status=document.createElement('p');status.className='artifact-preview__status';status.setAttribute('role','status');
        const content=document.createElement('div');content.className='artifact-preview__content';
        const handle=document.createElement('div');handle.className='artifact-resizer';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label','Largura do painel de arquivo');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','340');
        let drag:number|null=null;
        handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag=event.pointerId;handle.setPointerCapture(drag);workspace.classList.add('is-resizing-artifact');event.preventDefault();});
        handle.addEventListener('pointermove',event=>{if(drag===event.pointerId){paneWidth=innerWidth-event.clientX;layout();}});
        const finish=()=>{drag=null;workspace.classList.remove('is-resizing-artifact');};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
        handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();paneWidth=event.key==='Home'?340:event.key==='End'?Number(handle.getAttribute('aria-valuemax')):preview.offsetWidth+(event.key==='ArrowLeft'?32:-32);layout();});
        handle.addEventListener('dblclick',()=>{paneWidth=0;layout();});preview.append(handle,heading,status,content);
        save.addEventListener('click',()=>{
            if(tableOnly&&artifact.spec.kind==='spreadsheet'){
                const url=URL.createObjectURL(new Blob(['\ufeff'+csvText(artifact.spec.sheets[0])],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
            }else void download(artifact,artifact.files.find(f=>f.format===format.value)!,status,save);
        });
        expand.addEventListener('click',()=>{expanded=!expanded;expand.setAttribute('aria-label',expanded?'Reduzir artefato':'Expandir artefato');expand.title=expanded?'Reduzir artefato':'Expandir artefato';expand.setAttribute('aria-pressed',String(expanded));layout();});
        dismiss.addEventListener('click',()=>close());
        const spec=artifact.spec;
        if(spec.kind==='spreadsheet'){
            const tabs=document.createElement('nav');tabs.className='artifact-sheet-tabs';tabs.setAttribute('aria-label','Abas da planilha');const grid=document.createElement('div');
            const draw=(index:number)=>{grid.replaceChildren(tableView(spec.sheets[index],false));[...tabs.children].forEach((tab,i)=>tab.setAttribute('aria-pressed',String(i===index)));updateTables();};
            for(const [index,sheet] of spec.sheets.entries()){const button=document.createElement('button');button.type='button';button.textContent=sheet.name;button.addEventListener('click',()=>draw(index));tabs.append(button);}
            if(!tableOnly)content.append(tabs);content.append(grid);draw(0);if(spec.sheets.length>1){const note=document.createElement('small');note.textContent='O CSV contém a primeira aba. O Excel inclui todas as abas.';content.append(note);}
        }else if(spec.kind==='chart'){const img=document.createElement('img');img.alt=spec.name;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(chartSVG(spec));content.append(img);
        }else if(spec.kind==='document'||spec.extension==='md'){const documentBody=document.createElement('div');documentBody.className='artifact-document';renderAnswer(documentBody,spec.content);content.append(documentBody);
        }else if(spec.extension==='html'){const frame=document.createElement('iframe');frame.title='Prévia estática de '+file.name;frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer';frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">'+spec.content;content.append(frame);
        }else{const code=document.createElement('pre');code.textContent=spec.content;content.append(code);}
        preview.hidden=false;workspace.classList.add('has-artifact-preview');layout();dismiss.focus({preventScroll:true});
    }
    const tableDialog=document.createElement('dialog');tableDialog.className='table-dialog';tableDialog.setAttribute('aria-label','Tabela');scope.append(tableDialog);
    scope.listen(tableDialog,'click',event=>{if(event.target===tableDialog){const r=tableDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)tableDialog.close();}});
    scope.listen(tableDialog,'scroll',()=>{const content=tableDialog.querySelector<HTMLElement>('.table-dialog__content');if(content)positionTableHeaders(content);},{capture:true,passive:true});
    window.addEventListener('artifacts:table-preview',event=>{
        const {sheet}=(event as CustomEvent<{sheet:Sheet;trigger:HTMLElement}>).detail;
        const header=document.createElement('header'),title=document.createElement('span');title.textContent='Tabela';
        const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='table-dialog__close';dismiss.setAttribute('aria-label','Fechar tabela');dismiss.innerHTML='<i aria-hidden="true"></i>';dismiss.addEventListener('click',()=>tableDialog.close());
        header.append(title,dismiss);const content=document.createElement('div');content.className='table-dialog__content';content.append(tableView(sheet,false));tableDialog.replaceChildren(header,content);tableDialog.showModal();
    },{signal:scope.signal});
    function card(artifact:Artifact,file:ArtifactFile,compact=false){
        const row=document.createElement('div');row.className=compact?'artifact-row':'artifact-card';
        const button=document.createElement('button');button.type='button';button.className='artifact-card__open';button.setAttribute('aria-label','Abrir '+file.name);
        const info=document.createElement('span'),name=document.createElement('strong'),type=document.createElement('small');name.textContent=compact?file.name:file.name.slice(0,-file.format.length-1);type.textContent=labels[file.format]||file.format.toUpperCase();info.append(name);if(!compact)info.append(type);button.append(icon(file),info);button.addEventListener('click',()=>open(artifact,file,button));
        const more=document.createElement('button');more.type='button';more.className='artifact-card__more';more.setAttribute('aria-label','Opções de '+file.name);more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.innerHTML='<i aria-hidden="true"></i>';
        const menu=document.createElement('div');menu.className='artifact-file-menu';menu.popover='auto';menu.setAttribute('role','menu');
        const status=document.createElement('div');status.className='artifact-card__status';status.setAttribute('role','status');
        const show=document.createElement('button');show.type='button';show.textContent='Abrir arquivo';show.setAttribute('role','menuitem');show.addEventListener('click',()=>{menu.hidePopover();open(artifact,file,button);});
        const save=document.createElement('button');save.type='button';save.textContent='Baixar arquivo';save.setAttribute('role','menuitem');save.addEventListener('click',()=>{menu.hidePopover();void download(artifact,file,status,save);});menu.append(show,save);
        more.addEventListener('click',()=>{menu.togglePopover();if(menu.matches(':popover-open')){const r=more.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.right-menu.offsetWidth))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+4))+'px';show.focus();}});
        menu.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();(event.key==='Home'?show:event.key==='End'?save:document.activeElement===show?save:show).focus();}});
        menu.addEventListener('toggle',()=>more.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
        row.append(button,more,menu,status);return row;
    }
    function update(){
        const files=all();section.hidden=!files.length;
        const summary=document.createElement('summary'),label=document.createElement('span');label.textContent='Artefatos';summary.append(label);const count=document.createElement('span');count.className='artifact-count';count.textContent=String(files.reduce((n,a)=>n+a.files.length,0));const save=document.createElement('button');save.type='button';save.className='artifact-download-all';save.setAttribute('aria-label','Baixar todos os arquivos em ZIP');save.innerHTML='<i aria-hidden="true"></i>';
        const arrow=document.createElement('i');arrow.className='ui-arrow';arrow.setAttribute('aria-hidden','true');const action=document.createElement('span');action.className='artifact-summary-action';action.append(count,save);summary.append(action,arrow);
        const reflect=()=>{save.inert=!section.open;save.setAttribute('aria-hidden',String(!section.open));count.setAttribute('aria-hidden',String(section.open));};reflect();section.ontoggle=reflect;
        const status=document.createElement('p');status.className='artifact-card__status';status.setAttribute('role','status');
        save.addEventListener('click',async event=>{
            event.preventDefault();event.stopPropagation();if(zipController)return;
            const controller=new AbortController();zipController=controller;save.disabled=true;status.textContent='Preparando ZIP…';
            try{
                const archive:Record<string,Uint8Array>=Object.create(null),cid=conversationIdFromURL(new URL(location.href));
                for(const artifact of files)for(const file of artifact.files){
                    const response=artifact.expires_at?await fetch('/api/ai/artifacts/render',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRFToken':document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content||''},body:JSON.stringify({artifact,format:file.format})}):await fetch(`/api/ai/conversations/${encodeURIComponent(cid||'')}/artifacts/${artifact.id}?format=${file.format}`,{signal:controller.signal,cache:'no-store'});
                    if(!response.ok)throw Error('Não foi possível baixar todos os arquivos. Tente novamente.');
                    const base=file.name.replace(/[\\/]/g,'_');let name=base,n=2;while(Object.hasOwn(archive,name))name=String(n++)+'_'+base;
                    archive[name]=new Uint8Array(await response.arrayBuffer());
                }
                if(controller.signal.aborted)return;
                const data=zipSync(archive),url=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download='artefatos.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='';
            }catch(error){if(!controller.signal.aborted)status.textContent=error instanceof Error?error.message:'Não foi possível criar o ZIP.';}
            finally{if(zipController===controller)zipController=null;save.disabled=false;}
        });
        const list=document.createElement('div');list.className='artifact-list';for(const artifact of files)for(const file of artifact.files)list.append(card(artifact,file,true));section.replaceChildren(summary,status,list);changed();
    }
    function register(article:HTMLElement,files:Artifact[],state?:string,message?:string){
        const previous=records.get(article);records.set(article,files);
        if(!previous||JSON.stringify(previous)!==JSON.stringify(files)){
            article.querySelector('.response-artifacts')?.remove();
            if(files.length){const cards=document.createElement('div');cards.className='response-artifacts';for(const artifact of files)for(const file of artifact.files)cards.append(card(artifact,file));article.querySelector('.computer-message__text')?.before(cards);}
            update();
        }
        let status=article.querySelector<HTMLElement>('.response-artifact-status');
        if(state==='creating'||state==='failed'){if(!status){status=document.createElement('div');status.className='response-artifact-status';status.setAttribute('role','status');article.querySelector('.computer-message__text')?.before(status);}if(state==='creating')showLoading(status,'Criando arquivo');else status.textContent=message||'Não foi possível criar o arquivo.';}
        else status?.remove();
    }
    function reset(){zipController?.abort();zipController=null;if(tableDialog.open)tableDialog.close();close(false);records.clear();section.replaceChildren();section.hidden=true;}
    scope.cleanup(reset);return {section,register,reset,hasFiles:()=>all().length>0};
}
