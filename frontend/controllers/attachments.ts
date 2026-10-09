import { optionalElement, requiredElement, errorMessage, elementList } from './dom';
import { apiError, attachmentData } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const picker=optionalElement(document, '#attachment-input', HTMLInputElement), menu=requiredElement(document, '#attachment-menu', HTMLElement), toggle=requiredElement(document, '.attachment-toggle', HTMLButtonElement);
    if(!picker)return;
    const webToggle = optionalElement(menu, '.web-search-toggle', HTMLButtonElement);
    webToggle?.addEventListener('click', () => webToggle.setAttribute('aria-pressed', String(webToggle.getAttribute('aria-pressed') !== 'true')), {signal: scope.signal});

    const composer=requiredElement(document, '.home__composer', HTMLFormElement), list=requiredElement(composer, '.attachment-list', HTMLElement), status=requiredElement(document, '.attachment-status', HTMLElement);
    const previews=new Map<string,string>();
    let files: Attachment[]=[], uploading=false, locked=false, version=0, controller: AbortController | null=null;
    function sizeLabel(bytes: number){
        if(!Number.isFinite(bytes))return '';
        const unit=bytes>=1024*1024?'MB':'KB', value=bytes/(unit==='MB'?1024*1024:1024);
        return value.toLocaleString('pt-BR',{maximumFractionDigits:1})+' '+unit;
    }
    function card(file: Attachment,onRemove?: () => void){
        const chip=document.createElement('div');chip.className='attachment-chip';
        const thumb=document.createElement('div');thumb.className='attachment-chip__preview';thumb.setAttribute('aria-hidden','true');
        const fallback=document.createElement('i');fallback.className='attachment-chip__file-icon';thumb.append(fallback);
        if(file.kind==='image'){
            const image=document.createElement('img');image.alt='';image.loading='lazy';
            image.src=previews.get(file.id)||'/api/ai/attachments/'+encodeURIComponent(file.id)+'/preview';
            image.addEventListener('load',()=>fallback.hidden=true,{...{once:true}, signal: scope.signal});
            image.addEventListener('error',()=>image.remove(),{...{once:true}, signal: scope.signal});thumb.append(image);
        }
        const info=document.createElement('div');info.className='attachment-chip__info';
        const name=document.createElement('span');name.className='attachment-chip__name';name.textContent=file.name;name.title=file.name;
        const size=document.createElement('span');size.className='attachment-chip__size';size.textContent=sizeLabel(file.size);
        info.append(name,size);chip.append(thumb,info);
        if(onRemove){const remove=document.createElement('button');remove.type='button';remove.className='attachment-chip__remove';remove.innerHTML='<i class="ui-icon-x" aria-hidden="true"></i>';remove.setAttribute('aria-label','Remover '+file.name);remove.disabled=locked||uploading;remove.addEventListener('click',onRemove, {signal: scope.signal});chip.append(remove);}
        return chip;
    }
    window.ComputerAttachmentCard=card;
    function render(){
        list.replaceChildren();list.hidden=!files.length;
        files.forEach(file=>list.append(card(file,()=>{files=files.filter(item=>item.id!==file.id);render();})));
        toggle.disabled=locked||uploading;window.dispatchEvent(new Event('attachments:changed'));
    }
    function position(){const r=toggle.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(r.left,innerWidth-menu.offsetWidth-12))+'px';menu.style.top=Math.max(12,r.top-menu.offsetHeight-8)+'px';}
    menu.addEventListener('toggle',()=>{if(menu.matches(':popover-open'))position();}, {signal: scope.signal});scope.listen(window, 'resize',position);
    requiredElement(menu, '[data-upload-files]', HTMLElement).addEventListener('click',()=>{menu.hidePopover();picker.click();}, {signal: scope.signal});
    async function upload(selected: File[]){
        if(!selected.length)return;
        if(locked||uploading){status.textContent='Aguarde a operação atual antes de anexar arquivos.';return;}
        if(files.length+selected.length>4){status.textContent='Anexe até 4 arquivos por mensagem.';return;}
        if(selected.some(file=>file.size>8*1024*1024)){status.textContent='Cada arquivo pode ter até 8 MB.';return;}
        const expected=version;controller=new AbortController();uploading=true;status.textContent='Preparando anexos…';render();
        try{
            for(const file of selected){
                const body=new FormData();body.append('file',file);
                const response=await fetch('/api/ai/attachments',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'X-CSRFToken':requiredElement(document, 'meta[name="csrf-token"]', HTMLMetaElement).content},body});
                const raw:unknown=await response.json();if(!response.ok)throw new Error(apiError(raw,'Não foi possível anexar o arquivo.'));const data=attachmentData(raw);if(expected!==version)return;
                if(data.kind==='image')previews.set(data.id,URL.createObjectURL(file));
                files.push(data);window.ComputerModels?.select('gemini');render();
            }
            status.textContent='';
        }catch(error){if(expected===version&&(error instanceof Error ? error.name : '')!=='AbortError')status.textContent=errorMessage(error);}
        finally{if(expected===version){uploading=false;controller=null;render();}}
    }
    picker.addEventListener('change',()=>{const selected=[...(picker.files ?? [])];picker.value='';upload(selected);}, {signal: scope.signal});
    composer.addEventListener('paste',event=>{
        const clipboard=event.clipboardData;if(!clipboard)return;
        const selected=clipboard.files.length?[...clipboard.files]:[...clipboard.items].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file): file is File => file !== null);
        if(!selected.length)return;
        event.preventDefault();
        if(document.body.classList.contains('is-anonymous')){status.textContent='Anexos não estão disponíveis no modo anônimo.';return;}
        upload(selected);
    }, {signal: scope.signal});
    function releasePreviews(){previews.forEach(url=>URL.revokeObjectURL(url));previews.clear();}
    scope.listen(window, 'pagehide',releasePreviews);
    scope.listen(window, 'sessions:new',releasePreviews);
    scope.listen(window, 'sessions:open',releasePreviews);
    window.ComputerAttachments={
        files:()=>files.map(file=>({...file})),busy:()=>uploading,
        clear:()=>{version++;controller?.abort();controller=null;files=[];uploading=false;status.textContent='';render();},
        restore:items=>{files=items.map(file=>({...file}));if(files.length)window.ComputerModels?.select('gemini');render();},
        setBusy:value=>{locked=value;toggle.disabled=locked||uploading;elementList(list, 'button', HTMLButtonElement).forEach(button=>button.disabled=locked||uploading);}
    };
    render();
}
