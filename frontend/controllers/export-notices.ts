import { requiredElement, errorMessage } from './dom';
import { apiError, record } from './api-data';

export default function mount({scope,fetch,setTimeout}: PageContext) {
    const notices=document.createElement('aside');notices.className='export-notices';notices.setAttribute('aria-label','Exportações');notices.hidden=true;
    notices.innerHTML='<div class="export-notices__list" aria-live="polite" aria-relevant="additions text"></div><button class="export-notices__clear" type="button">Dispensar tudo</button>';
    scope.append(notices);
    const list=requiredElement(notices,'.export-notices__list',HTMLElement),pending=new Set<string>(),downloads=new Set<string>();
    scope.cleanup(()=>downloads.forEach(url=>URL.revokeObjectURL(url)));
    function refresh() {notices.hidden=!list.childElementCount;}
    requiredElement(notices,'.export-notices__clear',HTMLButtonElement).addEventListener('click',()=>{list.replaceChildren();refresh();},{signal:scope.signal});
    scope.listen(window,'chat:export',async event=>{
        const {id,title,format}=event.detail,key=id+':'+format;if(pending.has(key))return;pending.add(key);
        const notice=document.createElement('div');notice.className='export-notice';notice.dataset.state='pending';
        notice.innerHTML='<i class="export-notice__icon" aria-hidden="true"></i><div><p>Exportando tópico…</p><small></small></div><button type="button" aria-label="Dispensar notificação"><i class="ui-icon-x" aria-hidden="true"></i></button>';
        requiredElement(notice,'small',HTMLElement).textContent=title;list.prepend(notice);refresh();
        requiredElement(notice,'button',HTMLButtonElement).addEventListener('click',()=>{notice.remove();refresh();},{signal:scope.signal});
        const label=requiredElement(notice,'p',HTMLElement),detail=requiredElement(notice,'small',HTMLElement);
        try {
            const response=await fetch('/api/ai/conversations/'+encodeURIComponent(id)+'/export?format='+format,{credentials:'same-origin',cache:'no-store'});
            if (!response.ok) {
                let message='Não foi possível exportar o chat.';
                try {message=apiError(record(await response.json()),message);}catch{}
                throw new Error(message);
            }
            const blob=await response.blob();if(!blob.size)throw new Error('O arquivo exportado está vazio.');
            const url=URL.createObjectURL(blob),link=document.createElement('a');
            const disposition=response.headers.get('Content-Disposition') || '',encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i);
            let filename='';try {filename=encoded?decodeURIComponent(encoded[1]):'';}catch{}
            const safeTitle=title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').trim().slice(0,100) || 'Conversa';
            link.href=url;link.download=filename || safeTitle+'.'+(format==='markdown'?'md':format);
            downloads.add(url);document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},60000);
            notice.dataset.state='complete';label.textContent='Exportação concluída';detail.textContent=link.download;
        } catch(error) {
            if (!scope.active) return;
            notice.dataset.state='failed';label.textContent='Falha na exportação';detail.textContent=errorMessage(error);
        } finally {pending.delete(key);}
    });
}
