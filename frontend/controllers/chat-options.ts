import { requiredElement, optionalElement, eventElement, elementList, errorMessage } from './dom';
import { record, stringValue } from './api-data';

export default function mount({scope}: PageContext) {
    const trigger=optionalElement(document,'.chat-options-toggle',HTMLButtonElement);
    if (!trigger) return;
    const menu=document.createElement('div');menu.className='chat-options';menu.id='chat-options';menu.setAttribute('popover','auto');menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Opções do chat');
    menu.innerHTML='<h2 class="chat-options__title"></h2><dl><div><dt>Criado por</dt><dd class="chat-options__owner"></dd></div><div><dt>Última atualização</dt><dd><time></time></dd></div></dl><div class="chat-options__group"><button type="button" data-action="pin"><i class="sessions-icon sessions-icon--pin" aria-hidden="true"></i><span>Fixar</span></button><button type="button" data-action="rename"><i class="sessions-icon sessions-icon--rename" aria-hidden="true"></i>Renomear sessão</button></div><div class="chat-options__group"><button type="button" data-export="pdf"><i class="chat-options__icon chat-options__icon--pdf" aria-hidden="true"></i>Exportar como PDF</button><button type="button" data-export="markdown"><i class="chat-options__icon chat-options__icon--markdown" aria-hidden="true"></i>Exportar como Markdown</button><button type="button" data-export="docx"><i class="chat-options__icon chat-options__icon--docx" aria-hidden="true"></i>Exportar como DOCX</button></div><div class="chat-options__group"><button type="button" class="chat-options__delete" data-action="delete"><i class="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Excluir</button></div>';
    const rename=document.createElement('dialog');rename.className='sessions-dialog chat-rename';rename.setAttribute('aria-labelledby','chat-rename-title');
    rename.innerHTML='<form><h2 id="chat-rename-title">Renomear sessão</h2><label for="chat-rename-input">Nome da sessão</label><input id="chat-rename-input" name="title" maxlength="100" required autocomplete="off"><p role="alert"></p><div><button type="button" data-cancel>Cancelar</button><button type="submit">Salvar</button></div></form>';
    scope.append(menu,rename);
    trigger.setAttribute('aria-controls',menu.id);trigger.popoverTargetElement=menu;
    let chat: Conversation|null=null, editing: Conversation|null=null, saving=false;
    function update() {
        if (!chat) return;
        requiredElement(menu,'h2',HTMLElement).textContent=chat.title;
        const owner=optionalElement(document,'.sidebar__profile-label',HTMLElement)?.textContent || 'Você';
        requiredElement(menu,'.chat-options__owner',HTMLElement).textContent=owner+' (Você)';
        const date=new Date(chat.updated_at),time=requiredElement(menu,'time',HTMLTimeElement);
        time.textContent=Number.isNaN(date.getTime())?'—':date.toLocaleString('pt-BR',{dateStyle:'long',timeStyle:'short'});
        if (!Number.isNaN(date.getTime())) time.dateTime=date.toISOString();
        time.title=time.textContent;
        requiredElement(menu,'[data-action="pin"] span',HTMLElement).textContent=window.ComputerSessions.isPinned(chat.id)?'Desafixar':'Fixar';
    }
    function close() {if(menu.matches(':popover-open'))menu.hidePopover();}
    scope.listen(window,'chat:context',event=>{if(chat?.id!==event.detail?.id)close();chat=event.detail;update();});
    scope.listen(window,'sessions:pins',update);
    scope.listen(window,'chat:anonymous',event=>{if(event.detail)close();});
    menu.addEventListener('toggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')),{signal:scope.signal});
    trigger.addEventListener('click',event=>{
        event.preventDefault();if (!chat || trigger.disabled) return;
        if(menu.matches(':popover-open')){close();return;}
        update();menu.showPopover();const rect=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
        menu.style.left=Math.max(12,Math.min(rect.right-bounds.width,innerWidth-bounds.width-12))+'px';
        menu.style.top=Math.max(12,Math.min(rect.bottom+6,innerHeight-bounds.height-12))+'px';
    },{signal:scope.signal});
    scope.listen(window,'resize',close);
    menu.addEventListener('click',event=>{
        const button=eventElement(event.target)?.closest<HTMLButtonElement>('button');if(!button || !chat)return;
        const format=button.dataset.export;close();
        if(format==='pdf' || format==='markdown' || format==='docx') {
            window.dispatchEvent(new CustomEvent('chat:export',{detail:{id:chat.id,title:chat.title,format}}));return;
        }
        if(button.dataset.action==='rename') {
            editing={...chat};requiredElement(rename,'input',HTMLInputElement).value=chat.title;requiredElement(rename,'p',HTMLElement).textContent='';
            rename.showModal();const input=requiredElement(rename,'input',HTMLInputElement);input.focus();input.select();return;
        }
        window.ComputerSessions.runAction(chat,button.dataset.action || '',trigger);
    },{signal:scope.signal});
    requiredElement(rename,'[data-cancel]',HTMLButtonElement).addEventListener('click',()=>{if(!saving)rename.close();},{signal:scope.signal});
    rename.addEventListener('cancel',event=>{if(saving)event.preventDefault();},{signal:scope.signal});
    rename.addEventListener('close',()=>{editing=null;trigger.focus({preventScroll:true});},{signal:scope.signal});
    requiredElement(rename,'form',HTMLFormElement).addEventListener('submit',async event=>{
        event.preventDefault();if(saving || !editing)return;
        const title=requiredElement(rename,'input',HTMLInputElement).value.trim();if(!title)return;
        const id=editing.id;saving=true;elementList(rename,'button',HTMLButtonElement).forEach(button=>button.disabled=true);
        try {
            const result=record(await window.ComputerSessions.request('/api/ai/conversations/'+encodeURIComponent(id),'PATCH',{title}));
            window.dispatchEvent(new CustomEvent('sessions:changed',{detail:{id,title:stringValue(result.title)}}));
            rename.close();
        } catch(error) { requiredElement(rename,'p',HTMLElement).textContent=errorMessage(error); }
        finally {saving=false;elementList(rename,'button',HTMLButtonElement).forEach(button=>button.disabled=false);}
    },{signal:scope.signal});
}
