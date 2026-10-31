import {artifactContext} from '../../shared/artifacts';
import { conversationPath, conversationIdFromURL } from '../routes';
import { showLoading } from './loading-indicator';
import { publishConversationChange, cachedConversation, cacheConversation, invalidateConversation, invalidateWorkspaceResource, saveChatView, chatView, clearChatView } from './workspace-cache';
import { isOllamaModel } from './api-data';
import { requiredElement, optionalElement, errorMessage, present, elementList } from './dom';
import { record, numberValue, apiError, stringValue } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const scroller = requiredElement(document, '.workspace__content', HTMLElement);
    const page = optionalElement(document, '.computer-page', HTMLElement);
    if (!page) return;
    const form = requiredElement(page, 'form', HTMLFormElement);
    const input = optionalElement(form, 'textarea', HTMLTextAreaElement);
    const send = requiredElement(form, '.home__send', HTMLButtonElement);
    const microphone = requiredElement(form, '.home__microphone', HTMLButtonElement);
    const note = requiredElement(page, '.computer-note', HTMLElement);
    const historyStatus = document.createElement('div'); historyStatus.className='computer-history-status'; historyStatus.hidden=true;
    const existingHistoryStatus=optionalElement(page,'.computer-history-status',HTMLElement);
    if(existingHistoryStatus)existingHistoryStatus.replaceWith(historyStatus);else note.closest('.computer-composer')?.before(historyStatus);
    const conversation = optionalElement(page, '.computer-messages', HTMLElement);
    let historyLoadingTimer=0,historyLoadingVisible=false;
    function resetHistoryLoading(){
        clearTimeout(historyLoadingTimer);historyLoadingTimer=0;historyLoadingVisible=false;
    }
    let recover = () => initialize();
    let recoveryTimer = 0, recoveryDelay = 1000;
    function resetRecovery() {
        clearTimeout(recoveryTimer); recoveryTimer = 0; recoveryDelay = 1000;
    }
    function scheduleRecovery() {
        clearTimeout(recoveryTimer);
        if (leaving) return;
        recoveryTimer = setTimeout(async () => {
            recoveryTimer = 0;
            if (leaving) return;
            if (loading || active || syncing || document.hidden || editing) { scheduleRecovery(); return; }
            await syncHistory();
        }, recoveryDelay);
        recoveryDelay = Math.min(recoveryDelay * 2, 15000);
    }
    function recovery(error: unknown, action = () => initialize()) {
        note.textContent = errorMessage(error); recover = action; scheduleRecovery();
    }

    const handoffParams = new URL(location.href).searchParams;
    const cryptoQuestion = handoffParams.has('crypto') ? window.CometCryptoQuestion : undefined;
    const studyQuestion = handoffParams.has('study') ? window.CometStudyQuestion : cryptoQuestion ? {message:cryptoQuestion.message,attachments:[],provider:cryptoQuestion.provider} : undefined;
    let studyQuestionSent = false;
    const sessions = window.ComputerSessions;
    const models = window.ComputerModels;
    const olderButton = requiredElement(page, '.computer-history__older', HTMLButtonElement);
    const service = new window.ComputerService();
    let editing: HTMLElement | null = null, anonymous = false, forking=false;
    if(!optionalElement(document, '.anonymous-toggle', HTMLButtonElement)){
        const button=document.createElement('button');button.type='button';button.className='workspace__header-button anonymous-toggle';button.setAttribute('aria-label','Ativar modo anônimo');button.setAttribute('aria-pressed','false');button.innerHTML='<i aria-hidden="true"></i>';requiredElement(document, '.computer-header', HTMLElement).append(button);
    }
    if(!optionalElement(document, '.anonymous-note', HTMLElement)){const note=document.createElement('p');note.className='anonymous-note';note.hidden=true;note.textContent='As conversas que você criar não serão salvas no histórico e expiram após 24 horas.';form.after(note);}
    const anonymousButton = requiredElement(document, '.anonymous-toggle', HTMLButtonElement);
    const privateChats = new Map<string, {conversation: Conversation; turns: Turn[]}>();
    let privateId: string | null = null;
    let privateExpiresAt = 0;
    function expirePrivateChats() {
        if (!anonymous || !privateExpiresAt || Date.now() < privateExpiresAt) return;
        revision++; active?.abort(); active = null; privateChats.clear(); privateExpiresAt = 0;
        feedback.clear(); newConversation(); drawPrivateChats();
    }
    setInterval(expirePrivateChats, 1000);
    scope.listen(document, 'visibilitychange', expirePrivateChats);
    function drawPrivateChats() { sessions.render([...privateChats.values()].map(item=>item.conversation)); sessions.select(privateId); }
    let activeRequestId: string | null = null;
    let currentTitle = '';
    let currentConversation: Conversation | null = null;
    let currentId: string | null = null, active: AbortController | null = null, loading = true, ready = false, remoteActive = false;
    let nextOffset: number | null = null, before: string | null = null, turns: Turn[] = [], pollTimer = 0, leaving = false, revision = 0;

    let navigation: AbortController | null = null, historyChecked = 0;
    function saveView() {
        if (anonymous || !ready) return;
        saveChatView(currentId, {draft:present(input).value, attachments:window.ComputerAttachments?.files() || [], scrollTop:scroller.scrollTop, following:followingLatest});
    }
    function saveHistory() {
        if (!anonymous && currentConversation && ready && !active) cacheConversation({conversation:currentConversation, turns, before, active:remoteActive}, historyChecked);
    }
    function restoreView(id: string | null) {
        const saved = chatView(id);
        present(input).value = saved?.draft || '';
        window.ComputerAttachments?.restore(saved?.attachments || []);
        present(input).dispatchEvent(new Event('input', {bubbles:true}));
        followingLatest = saved?.following ?? true;
        const version = revision;
        requestAnimationFrame(() => {
            if (version !== revision || leaving) return;
            if (followingLatest) followLatest();
            else scroller.scrollTop = saved?.scrollTop || 0;
            previousScrollTop = scroller.scrollTop; updateJump();
        });
    }
    let followingLatest = true, previousScrollTop = scroller.scrollTop;
    const composer = requiredElement(page, '.computer-composer', HTMLElement);
    const sharedNotice=document.createElement('p');sharedNotice.className='chat-shared-notice';sharedNotice.hidden=true;sharedNotice.setAttribute('role','status');sharedNotice.textContent='Você está vendo uma sessão compartilhada. Suas perguntas de seguimento serão privadas.';composer.prepend(sharedNotice);
    function syncComposerSpace() {
        present(page).style.setProperty('--computer-composer-height', `${Math.ceil(composer.getBoundingClientRect().height)}px`);
    }
    new ResizeObserver(syncComposerSpace).observe(composer);
    function syncScrollbarWidth() {
        present(page).style.setProperty('--chat-scrollbar-width', `${scroller.offsetWidth - scroller.clientWidth}px`);
    }
    new ResizeObserver(syncScrollbarWidth).observe(scroller);
    syncScrollbarWidth();
    function syncKeyboard() {
        const viewport = window.visualViewport;
        const offset = viewport && matchMedia('(width < 769px)').matches && viewport.scale === 1
            ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
        present(page).style.setProperty('--computer-keyboard-offset', `${offset}px`);
    }
    scope.listen(window.visualViewport, 'resize', syncKeyboard);
    scope.listen(window.visualViewport, 'scroll', syncKeyboard);
    scope.listen(window, 'resize', syncKeyboard);
    syncKeyboard();
    function nearLatest() {
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
    }
    function followLatest() {
        if (!followingLatest || present(page).hidden) return;
        scroller.scrollTo({top:scroller.scrollHeight, behavior:'instant'});
        previousScrollTop = scroller.scrollTop;
    }
    function scrollToLatest() {
        followingLatest = true;
        requestAnimationFrame(followLatest);
    }
    scope.listen(scroller, 'wheel', event => {
        if(present(page).hidden)return;
        if (event.deltaY < 0) followingLatest = false;
    }, {passive:true});
    scope.listen(scroller, 'scroll', () => {
        if(present(page).hidden)return;
        if (nearLatest()) followingLatest = true;
        else if (scroller.scrollTop < previousScrollTop - 1) followingLatest = false;
        previousScrollTop = scroller.scrollTop;
    }, {passive:true});
    const followObserver = new ResizeObserver(() => { followLatest(); updateJump(); });
    followObserver.observe(present(conversation));
    followObserver.observe(composer);
    followObserver.observe(scroller);

    const jump = document.createElement('button');
    jump.type = 'button'; jump.className = 'computer-jump'; jump.hidden = true;
    jump.setAttribute('aria-label', 'Descer para a última mensagem');
    jump.innerHTML = '<i aria-hidden="true"></i>';
    composer.append(jump);
    function updateJump() {
        jump.hidden = present(conversation).hidden || nearLatest();
    }
    jump.addEventListener('click', scrollToLatest, {signal: scope.signal});
    scope.listen(scroller, 'scroll', updateJump, {passive:true});
    scope.listen(window, 'resize', updateJump);
    new ResizeObserver(updateJump).observe(composer);
    new ResizeObserver(updateJump).observe(present(conversation));
    const durationKey = 'ascenda-thinking-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    let durations: Record<string,number> = {};
    try { durations = Object.fromEntries(Object.entries(record(JSON.parse(localStorage.getItem(durationKey) || '{}'))).map(([id,value])=>[id,numberValue(value)])); } catch {}
    function thoughtLabel(seconds: number | null | undefined) {
        if (!Number.isFinite(seconds)) return 'Pensamento concluído';
        const total = Math.max(1, Math.round(seconds ?? 0));
        const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
        return 'Pensou por ' + [hours ? hours+'h' : '', minutes ? minutes+'m' : '', rest ? rest+'s' : ''].filter(Boolean).join(' ');
    }
    const feedback = new Map<string|HTMLElement,string|null>();
    const feedbackMenu=document.createElement('div');feedbackMenu.id='response-feedback-menu';feedbackMenu.className='response-feedback-menu';feedbackMenu.setAttribute('popover','auto');feedbackMenu.setAttribute('role','menu');feedbackMenu.setAttribute('aria-label','Avaliar resposta');scope.append(feedbackMenu);
    let feedbackTarget: {article:HTMLElement;button:HTMLButtonElement}|null=null;
    function updateFeedback(article:HTMLElement,button:HTMLButtonElement) {
        const value=feedback.get(article.dataset.turn || article);
        const label=value==='helpful'?'Boa resposta':value==='unhelpful'?'Resposta ruim':'Avaliar resposta';
        button.dataset.feedback=value || '';
        button.title=value?label+' — Remover avaliação':label;button.setAttribute('aria-label',button.title);
        button.setAttribute('aria-pressed',String(Boolean(value)));
        requiredElement(button,'i',HTMLElement).style.setProperty('--action-icon',`url('/static/img/icons/library/${value==='helpful'?'thumb-up-filled':value==='unhelpful'?'thumb-down-filled':'thumb-mixed'}.svg')`);
    }
    function closeFeedback() { if(feedbackMenu.matches(':popover-open'))feedbackMenu.hidePopover(); }
    feedbackMenu.addEventListener('beforetoggle',event=>{
        if(event.newState==='closed'){feedbackTarget?.button.setAttribute('aria-expanded','false');feedbackTarget=null;}
    },{signal:scope.signal});
    for(const [kind,label,icon] of [['helpful','Boa resposta','thumb-up'],['unhelpful','Resposta ruim','thumb-down']]) {
        const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');
        option.innerHTML=`<i aria-hidden="true" style="--action-icon:url('/static/img/icons/library/${icon}.svg')"></i><span>${label}</span>`;
        option.addEventListener('click',()=>{
            const target=feedbackTarget;if(!target)return;
            feedback.set(target.article.dataset.turn || target.article,kind);updateFeedback(target.article,target.button);
            closeFeedback();target.button.focus({preventScroll:true});
        },{signal:scope.signal});feedbackMenu.append(option);
    }
    feedbackMenu.addEventListener('keydown',event=>{
        const options=elementList(feedbackMenu,'button',HTMLButtonElement);
        const index=options.findIndex(option=>option===document.activeElement);
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();
        } else if(event.key==='Escape'||event.key==='Tab') {
            const trigger=feedbackTarget?.button;closeFeedback();trigger?.focus({preventScroll:true});
            if(event.key==='Escape')event.preventDefault();
        }
    },{signal:scope.signal});
    scope.listen(scroller,'scroll',closeFeedback,{passive:true});scope.listen(window,'resize',closeFeedback);
    const copyTimers = new WeakMap<HTMLButtonElement,number>();
    const attachedFiles = new WeakMap<HTMLElement,Attachment[]>();
    function copied(button: HTMLButtonElement, glyph: HTMLElement, original: string) {
        clearTimeout(copyTimers.get(button));
        glyph.style.setProperty('--action-icon', "url('/static/img/icons/check.svg')");
        button.setAttribute('aria-label','Texto copiado');
        copyTimers.set(button,setTimeout(()=>{glyph.style.setProperty('--action-icon',original);button.setAttribute('aria-label','Copiar');},2200));
    }
    async function rewrite(article: HTMLElement) {
        if(active || loading || remoteActive || editing || currentConversation?.is_owner===false)return;
        const turn=turns.find(item=>item.id===article.dataset.turn);if(!turn)return;
        await submitMessage(turn);
    }
    function addActions(article: HTMLElement, body: HTMLElement) {
        const actions = document.createElement('div'); actions.className = 'computer-message__actions'; actions.hidden = true;
        const status = document.createElement('span'); status.className = 'computer-action-status'; status.setAttribute('role','status');
        for (const [kind,label] of [['copy','Copiar'],['feedback','Avaliar resposta']]) {
            const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);
            const icon=document.createElement('i');icon.setAttribute('aria-hidden','true');button.append(icon);
            if(kind==='copy')icon.style.setProperty('--action-icon',"url('/static/img/icons/copy.svg')");
            else {
                button.className='computer-feedback';button.popoverTargetElement=feedbackMenu;button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls',feedbackMenu.id);button.setAttribute('aria-expanded','false');updateFeedback(article,button);
                messageSignal(article).addEventListener('abort',()=>{if(feedbackTarget?.article===article)closeFeedback();},{once:true});
                requestAnimationFrame(()=>updateFeedback(article,button));
            }
            button.addEventListener('click',async event=>{
                event.preventDefault();
                if(kind==='copy') {
                    try { await navigator.clipboard.writeText(answerText(body)); status.textContent=''; copied(button,icon,"url('/static/img/icons/copy.svg')"); }
                    catch { status.textContent='Não foi possível copiar. Selecione o texto para copiar.'; }
                    return;
                }
                const value=feedback.get(article.dataset.turn || article),wasOpen=feedbackTarget?.button===button;
                closeFeedback();
                if(value){feedback.delete(article.dataset.turn || article);updateFeedback(article,button);return;}
                if(wasOpen)return;
                feedbackTarget={article,button};feedbackMenu.showPopover();button.setAttribute('aria-expanded','true');
                const rect=button.getBoundingClientRect(),bounds=feedbackMenu.getBoundingClientRect();
                feedbackMenu.style.left=Math.max(8,Math.min(rect.left,innerWidth-bounds.width-8))+'px';
                feedbackMenu.style.top=Math.max(8,Math.min(rect.top>=bounds.height+14?rect.top-bounds.height-6:rect.bottom+6,innerHeight-bounds.height-8))+'px';
                requiredElement(feedbackMenu,'button',HTMLButtonElement).focus({preventScroll:true});
            },{signal:messageSignal(article)});actions.append(button);
        }
        const rewriteButton=document.createElement('button');rewriteButton.type='button';rewriteButton.className='computer-rewrite';rewriteButton.setAttribute('aria-label','Reescrever resposta');rewriteButton.title='Reescrever resposta';rewriteButton.innerHTML='<i aria-hidden="true"></i>';rewriteButton.addEventListener('click',()=>rewrite(article), {signal: messageSignal(article)});
        const download=document.createElement('button');download.type='button';download.className='computer-download';download.setAttribute('aria-label','Baixar pergunta e resposta em PDF');download.title='Baixar pergunta e resposta em PDF';download.innerHTML='<i aria-hidden="true" style="--action-icon:url(/static/img/icons/library/download.svg)"></i>';
        download.addEventListener('click',()=>{
            if (!currentId || !article.dataset.turn) { status.textContent='Esta resposta ainda não está salva para exportação.'; return; }
            window.dispatchEvent(new CustomEvent('chat:export',{detail:{id:currentId,title:currentTitle||'Resposta',format:'pdf',turnId:article.dataset.turn}}));
        },{signal:scope.signal});
        const share=document.createElement('button');share.type='button';share.className='computer-share';share.setAttribute('aria-label','Compartilhar sessão');share.innerHTML='<i aria-hidden="true" style="--action-icon:url(/static/img/icons/library/share.svg)"></i>';share.addEventListener('click',()=>{if(currentId&&!anonymous)window.dispatchEvent(new CustomEvent('chat:share',{detail:{id:currentId,trigger:share}}));},{signal:messageSignal(article)});actions.append(status,download,rewriteButton,share); article.append(actions);
    }
    function messageAttachments(article: HTMLElement, files: Attachment[] | undefined) {
        attachedFiles.set(article,files||[]);
        window.ComputerResponseDetails.files(article,files||[]);
        optionalElement(article, '.attachment-list', HTMLElement)?.remove();
        if(!files?.length)return;
        const list=document.createElement('div');list.className='attachment-list';
        for(const file of files)list.append(window.ComputerAttachmentCard(file));
        article.prepend(list);
    }
    function messageTime(article: HTMLElement, value: string) {
        const stamp=optionalElement(article, 'time', HTMLTimeElement); if(!stamp)return;
        const date=new Date(value); stamp.hidden=!value||Number.isNaN(date.getTime());
        if(stamp.hidden)return;
        stamp.dateTime=date.toISOString();stamp.textContent=date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});stamp.title=date.toLocaleString('pt-BR');
    }
    function userActions(article: HTMLElement, body: HTMLElement) {
        const actions=document.createElement('div'); actions.className='computer-user-actions';
        const status=document.createElement('span'); status.className='computer-user-status';status.setAttribute('role','status');
        for(const [kind,label,icon] of [['copy','Copiar','copy'],['edit','Editar','conversation-rename']]) {
            const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);
            const glyph=document.createElement('i');glyph.style.setProperty('--action-icon',`url('/static/img/icons/${icon}.svg')`);glyph.setAttribute('aria-hidden','true');button.append(glyph);
            button.addEventListener('click',async()=>{
                if(kind==='copy'){try{await navigator.clipboard.writeText(body.textContent);status.textContent='';copied(button,glyph,"url('/static/img/icons/copy.svg')");}catch{status.textContent='Não foi possível copiar.';}return;}
                if(active||loading||remoteActive||editing||anonymous||currentConversation?.is_owner===false||!article.dataset.turn)return;
                const original=body.textContent;
                const editor=document.createElement('div');editor.className='computer-user-editor';
                const text=document.createElement('textarea');text.value=original;text.maxLength=8000;text.setAttribute('aria-label','Editar mensagem');
                const footer=document.createElement('div');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';
                const done=document.createElement('button');done.type='button';done.textContent='Concluído';done.className='computer-user-editor__save';
                const error=document.createElement('p');error.setAttribute('role','alert');
                footer.append(cancel,done);editor.append(text,error,footer);article.append(editor);article.classList.add('is-editing');body.hidden=true;editing=article;
                const close=()=>{editor.remove();article.classList.remove('is-editing');body.hidden=false;editing=null;button.focus();};
                cancel.addEventListener('click',close, {signal: messageSignal(article)});text.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}}, {signal: messageSignal(article)});
                done.addEventListener('click',async()=>{
                    const value=text.value.trim();if(!value){text.focus();return;}if(value===original){close();return;}
                    if(active||loading||remoteActive)return;
                    const editId = present(currentId), editRevision = revision;
                    done.disabled=cancel.disabled=true;text.disabled=true;loading=true;controls();
                    try{
                        const response=await fetch(`/api/ai/conversations/${currentId}/messages/${article.dataset.turn}/edit`,{method:'POST',credentials:'same-origin',headers:{'X-CSRFToken':requiredElement(document, 'meta[name="csrf-token"]', HTMLMetaElement).content}});
                        const result=record(await response.json());if(!response.ok)throw new Error(apiError(result,'Não foi possível editar.'));
                        const attached=attachedFiles.get(article)||[];
                        invalidateConversation(editId); invalidateConversation(stringValue(result.conversation_id));
                        publishConversationChange(editId);
                        if (leaving || revision !== editRevision) return;
                        editing=null; ready=false; await loadConversation(stringValue(result.conversation_id));
                        if (leaving || revision !== editRevision + 1 || currentId !== stringValue(result.conversation_id)) return;
                        window.ComputerAttachments?.restore(attached);
                        present(input).value=value;present(input).dispatchEvent(new Event('input',{bubbles:true}));
                        if(ready){form.requestSubmit();}else{recovery('A edição foi preparada. Tente carregar a conversa novamente.');}
                    }catch(failure){if(leaving || revision!==editRevision)return;loading=false;controls();error.textContent=errorMessage(failure);done.disabled=cancel.disabled=false;text.disabled=false;}
                }, {signal: messageSignal(article)});
                text.focus();text.setSelectionRange(text.value.length,text.value.length);
            }, {signal: messageSignal(article)});actions.append(button);
        }
        const stamp=document.createElement('time');stamp.className='computer-user-time';stamp.hidden=true;actions.prepend(stamp,status);article.append(actions);
    }
    function addMessage(role: 'user'|'assistant', text: string) {
        const article = document.createElement('article');
        article.className = `computer-message computer-message--${role}`;
        article.setAttribute('aria-label', role === 'assistant' ? 'Resposta da IA' : 'Mensagem enviada');
        const body = document.createElement('div');
        body.className = 'computer-message__text';
        body.textContent = text;
        article.append(body);
        if (role === 'assistant') addActions(article, body); else userActions(article, body);
        present(conversation).append(article);
        return { article, body };
    }
    function addThinking(assistant: {article:HTMLElement;body:HTMLElement}, connecting = false) {
        const cursor=document.createElement('span');cursor.className='computer-connecting';cursor.hidden=!connecting;
        cursor.setAttribute('role','status');cursor.setAttribute('aria-label','Conectando à IA');
        const details = document.createElement('details');
        details.className = 'computer-thinking is-thinking';
        details.open = true;
        details.hidden=connecting;
        const summary = document.createElement('summary');
        summary.className = 'computer-thinking__toggle';
        const label = document.createElement('span');
        label.textContent = 'Pensando';
        const arrow = requiredElement(document, '[data-profile-submenu] > svg', SVGElement).cloneNode(true);
        if (!(arrow instanceof SVGElement)) throw new Error('Invalid icon');
        arrow.classList.add('computer-thinking__arrow');
        summary.append(label, arrow);
        const panel = document.createElement('div');
        panel.className = 'computer-thinking__content';
        panel.tabIndex = 0;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Resumo do raciocínio do Computer');
        const text = document.createTextNode('');
        panel.append(text);
        details.append(summary, panel);
        details.addEventListener('toggle', () => { if (details.open) panel.scrollTop = panel.scrollHeight; }, {signal: messageSignal(assistant.article)});
        assistant.article.insertBefore(cursor, assistant.body);
        assistant.article.insertBefore(details, assistant.body);
        assistant.body.hidden = true;
        return { details, label, panel, text, cursor };
    }
    function warning(assistant: {article:HTMLElement}, text: string) {
        const item = document.createElement('p');
        item.className = 'computer-message__warning';
        item.textContent = text;
        assistant.article.append(item);
    }
    function controls() {
        if (leaving) return;
        document.body.classList.toggle('chat-is-loading', loading);
        const busy = !!active;
        const empty = !present(input).value.trim() && !(window.ComputerAttachments?.files()?.length);
        send.classList.toggle('is-empty', empty && !busy);

        const unavailable = loading || !ready || remoteActive || forking;
        const historyLoading=loading&&Boolean(currentId)&&!turns.length;
        if(!historyLoading)resetHistoryLoading();
        else if(!historyLoadingVisible&&!historyLoadingTimer)historyLoadingTimer=setTimeout(()=>{
            historyLoadingTimer=0;historyLoadingVisible=true;controls();
        },1000);
        const statusLabel=historyLoading?(historyLoadingVisible?'Carregando conversa':''):remoteActive?'Resposta em andamento':'';
        historyStatus.hidden=!statusLabel;
        historyStatus.classList.toggle('is-remote-response',!historyLoading&&remoteActive);
        if(statusLabel&&historyStatus.textContent!==statusLabel)showLoading(historyStatus,statusLabel);
        if(!statusLabel)historyStatus.replaceChildren();
        form.classList.toggle('is-responding', busy);
        send.disabled = !busy && (unavailable || window.ComputerAttachments?.busy() || (empty && microphone.getAttribute("aria-pressed") !== "true"));
        window.ComputerAttachments?.setBusy(busy || unavailable);
        anonymousButton.hidden = present(conversation).children.length > 0;
        anonymousButton.disabled = unavailable;
        const privateToggle = optionalElement(document, '.profile-anonymous', HTMLButtonElement);
        if (privateToggle) privateToggle.disabled = unavailable;
        const options=optionalElement(document,'.chat-options-toggle',HTMLButtonElement);
        if(options){options.hidden=!currentId || anonymous || currentConversation?.is_owner===false;options.disabled=busy || unavailable;}
        document.body.classList.toggle('chat-is-empty', present(conversation).children.length === 0);
        requiredElement(document, '.chat-tabs', HTMLElement).hidden = present(conversation).children.length === 0;
        elementList(present(conversation), '.computer-rewrite', HTMLButtonElement).forEach(button=>button.disabled=busy||unavailable);
        send.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar mensagem');
        send.title = busy ? 'Parar resposta' : 'Enviar mensagem';
        present(input).readOnly = busy || unavailable;
        microphone.disabled = busy || unavailable;
        present(conversation).setAttribute('aria-busy', String(loading || busy || remoteActive));
        sessions.setBusy(anonymous && (loading || busy));
        models.setBusy(loading || busy || remoteActive);
        olderButton.disabled = loading || busy || !ready;
    }
    function showConversation() {
        present(conversation).hidden = !currentId && !present(conversation).childElementCount;
        present(page).classList.toggle('has-conversation', !present(conversation).hidden);
        resizeInput();
    }
    function remember(id: string | null, title?: string, details?: Conversation) {
        if (leaving) return;
        if (id !== currentId) window.ComputerResponseDetails.reset();
        currentId = id;
        if(!id){sharedNotice.hidden=true;present(page).classList.remove('is-shared-conversation');}
        currentTitle = id ? (title || "") : "";
        document.title = (id ? (title || 'Conversa') : 'Novo chat');
        const url = new URL(location.href);
        url.searchParams.delete('new');
        url.searchParams.delete('anonymous');
        url.pathname = id ? conversationPath(id) : '/new';
        url.searchParams.delete('conversation');
        if (window.WorkspaceNavigation.replaceURL) window.WorkspaceNavigation.replaceURL(url);
        else history.replaceState(null, '', url);
        sessions.select(id, title);
        const now=new Date().toISOString();
        currentConversation=id ? details || {id,title:currentTitle,created_at:currentConversation?.id===id?currentConversation.created_at:now,updated_at:now} : null;
        window.dispatchEvent(new CustomEvent('chat:context',{detail:currentConversation}));
    }

    const messageLifetimes = new Map<HTMLElement, AbortController>();
    function messageSignal(article: HTMLElement) {
        let lifetime = messageLifetimes.get(article);
        if (!lifetime) { lifetime = new AbortController(); messageLifetimes.set(article, lifetime); }
        return lifetime.signal;
    }
    function removeMessage(article: HTMLElement) {
        messageLifetimes.get(article)?.abort(); messageLifetimes.delete(article); article.remove();
    }
    function clearMessages() { for (const article of messageLifetimes.keys()) removeMessage(article); present(conversation).replaceChildren(); }
    scope.cleanup(() => { for (const lifetime of messageLifetimes.values()) lifetime.abort(); messageLifetimes.clear(); });
    const versionSelection = new Map<string, number>();
    function addResponseInfo(article: HTMLElement, turn: Turn) {
        const actions = requiredElement(article, '.computer-message__actions', HTMLElement);
        const versions = turn.metadata?.versions || [];
        const index = Math.min(versionSelection.get(turn.id || '') ?? versions.length, versions.length);
        const metadata = index < versions.length ? versions[index].metadata : turn.metadata;
        if (versions.length) {
            const picker = document.createElement('span'); picker.className = 'response-versions';
            for (const direction of [-1, 1]) {
                if (direction === 1) { const count = document.createElement('span'); count.textContent = `${index + 1} / ${versions.length + 1}`; picker.append(count); }
                const button = document.createElement('button'); button.type = 'button';
                button.setAttribute('aria-label', direction < 0 ? 'Resposta anterior' : 'Próxima resposta');
                button.disabled = direction < 0 ? index === 0 : index === versions.length;
                const icon = document.createElement('i'); icon.className = direction < 0 ? 'response-version-previous' : 'response-version-next'; button.append(icon);
                button.addEventListener('click', () => {
                    if (active || loading) return;
                    versionSelection.set(turn.id || '', index + direction);
                    const top = scroller.scrollTop;
                    window.ComputerResponseDetails.reset(); renderTurns(turns, true); scroller.scrollTop = top;
                    const updated = present(conversation).querySelector<HTMLElement>(`.computer-message--assistant[data-turn="${turn.id}"]`);
                    if (updated) window.ComputerResponseDetails.research(updated, (index + direction < versions.length ? versions[index + direction].metadata : turn.metadata)?.research, true);
                }, {signal: messageSignal(article)});
                picker.append(button);
            }
            actions.append(picker);
        }
        const date = new Date(metadata?.answered_at || turn.created_at);
        if (Number.isFinite(date.getTime())) {
            const time = document.createElement('time'); time.className = 'response-time'; time.dateTime = date.toISOString();
            time.title = date.toLocaleString('pt-BR', {dateStyle:'medium', timeStyle:'short'});
            actions.append(time); updateResponseTime(time);
        }
    }
    function updateResponseTime(time: HTMLTimeElement) {
        const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time.dateTime)) / 60000));
        const relative = new Intl.RelativeTimeFormat('pt-BR', {numeric:'always'});
        time.textContent = minutes < 1 ? 'agora' : minutes < 60 ? relative.format(-minutes, 'minute') : minutes < 1440 ? relative.format(-Math.floor(minutes / 60), 'hour') : relative.format(-Math.floor(minutes / 1440), 'day');
    }
    setInterval(() => elementList(present(conversation), '.response-time', HTMLTimeElement).forEach(updateResponseTime), 60000);
    const renderedTurns = new Map<string, {signature:string; user:HTMLElement; assistant:HTMLElement}>();
    function renderTurns(items: Turn[], preserveOpen = false) {
        const opened = preserveOpen ? new Set([...elementList(present(conversation), '[data-turn]', HTMLElement)]
            .filter(node => optionalElement(node, 'details', HTMLDetailsElement)?.open).map(node => node.dataset.turn)) : new Set();
        const nodes: HTMLElement[] = [], retained = new Set<string>();
        for (const [index, original] of items.entries()) {
            const key = original.id ?? `unsaved-${index}`;
            const signature = JSON.stringify([original, versionSelection.get(key)]);
            retained.add(key);
            const existing = renderedTurns.get(key);
            if (existing?.signature === signature && existing.user.parentElement === conversation && existing.assistant.parentElement === conversation) {
                window.ComputerResponseDetails.artifacts(existing.assistant,(original.metadata?.versions?.[versionSelection.get(key)??-1]?.metadata??original.metadata)?.artifacts||[]);
                nodes.push(existing.user, existing.assistant); continue;
            }
            if (existing) { removeMessage(existing.user); removeMessage(existing.assistant); }
            const versions = original.metadata?.versions || [];
            const selectedVersion = versions[versionSelection.get(original.id || '') ?? versions.length];
            const turn = selectedVersion ? {...original, ...selectedVersion} : original;
            const user = addMessage('user', turn.message); user.article.dataset.turn=turn.id ?? ''; messageTime(user.article,turn.created_at); messageAttachments(user.article,turn.attachments);
            const assistant = addMessage('assistant', turn.answer);
            renderAnswer(assistant.body, turn.answer, turn.metadata?.research?.sources);
            assistant.article.classList.toggle('is-computer-response', !!turn.metadata?.provider && turn.metadata.provider !== 'gemini');
            requiredElement(assistant.article, '.computer-message__actions', HTMLElement).hidden = turn.status === 'running';
            assistant.article.dataset.turn = turn.id ?? '';
            assistant.article.dataset.answerStarted = String(!!turn.answer);
            if (turn.thinking || turn.metadata?.research || turn.status === 'running') {
                const running = turn.status === 'running' && !turn.answer;
                const thinking = addThinking(assistant, running && !turn.thinking && !turn.metadata?.research && !turn.metadata?.artifacts?.length);
                thinking.text.appendData(turn.thinking);
                const firstAnswer=!!turn.answer && existing?.assistant.dataset.answerStarted!=='true';
                thinking.details.open = !firstAnswer && (opened.has(turn.id) || (!existing && running && !turn.answer));
                if(turn.answer&&!turn.thinking&&!turn.metadata?.research)thinking.details.hidden=true;
                thinking.details.classList.toggle('is-thinking', running);
                thinking.label.textContent = running ? 'Pensando' : ['completed', 'running'].includes(turn.status) ? thoughtLabel(turn.metadata?.thinking_seconds ?? durations[turn.id ?? '']) : 'Pensamento interrompido';
            }
            window.ComputerResponseDetails.artifacts(assistant.article,turn.metadata?.artifacts||[]);
            window.ComputerResponseDetails.research(assistant.article, turn.metadata?.research, turn.status !== 'running');
            
            if (turn.status !== 'running') addResponseInfo(assistant.article, original);
            assistant.body.hidden = !turn.answer;
            if (turn.status === 'interrupted' || turn.status === 'failed') {
                warning(assistant, turn.metadata?.error || (turn.answer ? 'Resposta interrompida. O conteúdo salvo não foi incluído no contexto das próximas mensagens.' : 'Não foi possível gerar a resposta. Tente novamente ou escolha outro modelo.'));
            } else if (turn.status === 'running') warning(assistant, 'Resposta em andamento. O histórico será atualizado automaticamente.');
            renderedTurns.set(key, {signature, user:user.article, assistant:assistant.article});
            nodes.push(user.article, assistant.article);
        }
        const wanted = new Set(nodes);
        for (const node of [...present(conversation).children]) if (!wanted.has(node as HTMLElement)) removeMessage(node as HTMLElement);
        let cursor = present(conversation).firstElementChild;
        for (const node of nodes) {
            if (node === cursor) cursor = cursor.nextElementSibling;
            else present(conversation).insertBefore(node, cursor);
        }
        for (const key of renderedTurns.keys()) if (!retained.has(key)) renderedTurns.delete(key);
        showConversation();
    }
    async function listConversations(append = false) {
        if (anonymous) { drawPrivateChats(); return; }
        const result = await service.list(append ? nextOffset : 0);
        if (leaving || anonymous) return [];
        nextOffset = result.next_offset;
        const saved=result.conversations.find(chat=>chat.id===currentId);
        if(saved && currentConversation?.is_owner!==false){currentConversation={...currentConversation,...saved};window.dispatchEvent(new CustomEvent('chat:context',{detail:saved}));}
        sessions.render(result.conversations, append, nextOffset !== null);
        if (currentId) sessions.select(currentId);
        return result.conversations;
    }
    function applyHistory(result: ConversationHistory, merge = false, checked = Date.now()) {
        remember(result.conversation.id, result.conversation.title, result.conversation);
        sharedNotice.hidden=result.conversation.is_owner!==false;present(page).classList.toggle('is-shared-conversation',result.conversation.is_owner===false);
        const first = result.turns[0]?.id;
        const offset = merge && first ? turns.findIndex(turn => turn.id === first) : -1;
        turns = offset > 0 ? [...turns.slice(0, offset), ...result.turns] : [...result.turns];
        if (offset <= 0) before = result.before;
        olderButton.hidden = !before;
        remoteActive = result.active;
        renderTurns(turns, merge);
        if (!document.hidden) sessions.markRead(result.conversation.id, result.conversation.last_response_at, !merge);
        ready = true; historyChecked = checked; saveHistory();
        note.textContent = '';
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (!remoteActive || leaving || !currentId || document.hidden) return;
        pollTimer = setTimeout(() => void syncHistory(), 2000);
    }
    async function loadConversation(id: string) {
        resetHistoryLoading();
        if (anonymous) {
            const saved = privateChats.get(id); if (!saved) return;
            privateId = id; currentTitle = saved.conversation.title; turns = saved.turns;
            window.ComputerResponseDetails.reset(); renderTurns(turns); sessions.select(id);
            present(input).value = ''; present(input).dispatchEvent(new Event('input', {bubbles:true}));
            showConversation(); controls(); return;
        }
        saveView(); saveHistory();
        navigation?.abort();
        const controller = new AbortController(); navigation = controller;
        const version = ++revision;
        const current = () => !leaving && !controller.signal.aborted && revision === version;
        clearTimeout(pollTimer); resetRecovery();
        editing = null; remoteActive = false;
        const cached = cachedConversation(id);
        remember(id, cached?.value.conversation.title);
        turns = []; before = null; olderButton.hidden = true;
        loading = !cached; ready = !!cached;
        if (cached) {
            applyHistory(cached.value, false, cached.checked);
        } else {
            renderedTurns.clear(); clearMessages(); showConversation();
            note.textContent='';
        }
        restoreView(id); controls();
        if (cached && cached.value.conversation.is_owner!==false && !cached.value.active && Date.now() - cached.checked < 15000) { resetRecovery(); return; }
        try {
            const result = await service.load(id, null, controller.signal);
            if (!current() || editing) return;
            applyHistory(result, !!cached); resetRecovery();
            if (!cached) restoreView(id);
            else if (followingLatest) scrollToLatest();
        } catch (error) {
            if (!current()) return;
            if (error instanceof Error && 'status' in error && [401,403,404].includes(Number(error.status))) {
                invalidateConversation(id, true); ready = false; turns = []; renderTurns(turns);
            }
            if(error instanceof Error && 'code' in error && error.code==='conversation_private'){
                sharedNotice.hidden=true;resetRecovery();note.textContent='Esta resposta é privada.';window.dispatchEvent(new CustomEvent('chat:private',{detail:{id}}));
            }else recovery(error, () => loadConversation(id));
        } finally {
            if (current()) { loading = false; controls(); schedulePoll(); }
        }
    }
    function newConversation() {
        saveView(); saveHistory(); navigation?.abort(); loading = false;
        privateId = null;
        window.ComputerResponseDetails.reset();
        resetRecovery();
        editing = null;
        window.ComputerAttachments?.clear();
        revision++;
        clearTimeout(pollTimer);
        remember(null);
        turns = []; before = null; remoteActive = false; ready = true;
        renderedTurns.clear(); clearMessages(); showConversation(); olderButton.hidden = true;
        note.textContent = ''; present(input).value = '';
        present(input).dispatchEvent(new Event('input', { bubbles: true }));
        if (!anonymous) restoreView(null);
        controls(); present(input).focus({preventScroll:true});
    }
    async function initialize() {
        const url = new URL(location.href);
        const startAnonymous = url.searchParams.get('anonymous') === '1';
        if (!startAnonymous) void listConversations().catch(() => {
            if (!scope.active || anonymous) return;
            const status = optionalElement(document, '.sessions:has(#recent-chats) .sessions__status', HTMLElement);
            if (status) status.textContent = 'Não foi possível carregar a lista de chats.';
            const retry = optionalElement(document, '.sessions [data-action="refresh"]', HTMLButtonElement);
            if (retry) retry.hidden = false;
        });
        const id = conversationIdFromURL(url);
        if (startAnonymous) { loading = false; newConversation(); setAnonymous(true); drawPrivateChats(); }
        else if (id) await loadConversation(id);
        else newConversation();
        if (ready && !leaving && studyQuestion && !studyQuestionSent && !currentId) {
            const version = revision;
            await models.whenReady();
            if (leaving || revision !== version) return;
            studyQuestionSent = true;
            delete window.CometStudyQuestion;
            delete window.CometCryptoQuestion;
            if (studyQuestion.provider) models.select(studyQuestion.provider);
            window.ComputerAttachments.restore(studyQuestion.attachments);
            const webToggle = optionalElement(document, '.web-search-toggle', HTMLButtonElement);
            webToggle?.setAttribute('aria-pressed', 'true');
            present(input).value = studyQuestion.message;
            present(input).dispatchEvent(new Event('input', {bubbles:true}));
            void submitMessage();
        }
    }
    scope.listen(window, 'attachments:changed',controls);
    function detachResponse() {
        if (active && currentId && !anonymous) invalidateConversation(currentId);
        saveView();
        if (!active) saveHistory(); else ready = false;
        revision++; active?.abort(); active=null; activeRequestId=null;
    }
    scope.listen(window, 'sessions:open', event => { if (!(anonymous && active) && (event.detail.id !== currentId || !ready)) { detachResponse(); void loadConversation(event.detail.id); } });
    scope.listen(document, 'click', event => {
        const target = event.target instanceof Element ? event.target.closest('a') : null;
        if (anonymous && target && (target.matches('.sidebar__logo, .sidebar__link[aria-label="Novo chat"], .sessions__new'))) {
            event.preventDefault(); event.stopImmediatePropagation(); if (!loading && !active) newConversation();
        }
    }, {capture:true});
    scope.listen(window, 'sessions:new', () => { if (!(anonymous && active)) { detachResponse(); newConversation(); } });
    scope.listen(window, 'sessions:refresh', () => { if (!loading && !active) { invalidateWorkspaceResource('/api/ai/conversations?'); saveView(); if (currentId) invalidateConversation(currentId); ready = false; void initialize(); } });
    scope.listen(window, 'sessions:changed', async event => {
        if (anonymous) {
            if (event.detail.deleted) { privateChats.delete(event.detail.id); if (privateId === event.detail.id) newConversation(); }
            else { const saved=privateChats.get(event.detail.id); if(saved && event.detail.title) saved.conversation.title=event.detail.title; }
            drawPrivateChats(); return;
        }
        if (event.detail.id === currentId) { historyChecked = 0; navigation?.abort(); if (!active) revision++; }
        if (event.detail.deleted && event.detail.id === currentId) { ready = false; detachResponse(); newConversation(); }
        else if (event.detail.id === currentId) {
            if (event.detail.title) remember(currentId, event.detail.title);
            if (!active) {
                if (loading) { ready = false; void loadConversation(event.detail.id); }
                else void syncHistory();
            }
        }
        try { await listConversations(); } catch (error) { recovery(error); }
    });
    scope.listen(window, 'sessions:more', async () => {
        if (loading || active) return;
        const version = revision; loading = true; controls();
        try { await listConversations(true); } catch (error) { if (version === revision) recovery(error); }
        finally { if (version === revision) { loading = false; controls(); } }
    });
    olderButton.addEventListener('click', async () => {
        loading = true; controls();
        const height = present(conversation).getBoundingClientRect().height, version = revision;
        try {
            const result = await service.load(present(currentId), before);
            if (leaving || version !== revision) return;
            turns = [...result.turns, ...turns]; before = result.before; saveHistory();
            renderTurns(turns, true); olderButton.hidden = !before;
            scroller.scrollBy(0, present(conversation).getBoundingClientRect().height - height);
        } catch (error) { if (!leaving && version === revision) recovery(error); }
        finally { if (!leaving && version === revision) { loading = false; controls(); } }
    }, {signal: scope.signal});
    form.addEventListener('submit', event => {
        event.preventDefault();
        if(active){
            if(activeRequestId && !anonymous) void fetch('/api/ai/chat/cancel',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRFToken':requiredElement(document,'meta[name="csrf-token"]',HTMLMetaElement).content},body:JSON.stringify({request_id:activeRequestId})}).catch(()=>{});
            active.abort();return;
        }
        submitMessage();
    }, {signal: scope.signal});
    async function submitMessage(rewriting: Turn | null = null) {
        expirePrivateChats();
        if(active||forking)return;
        if (editing || loading || !ready || remoteActive || microphone.getAttribute('aria-pressed') === 'true') return;
        if(window.ComputerAttachments?.busy())return;
        if(currentConversation?.is_owner===false){
            if(rewriting)return;
            const draft=present(input).value,files=window.ComputerAttachments?.files()||[],sourceId=currentId,version=revision;
            if(!draft.trim()&&!files.length)return;
            forking=true;controls();send.disabled=true;
            try{
                const result=record(await sessions.request('/api/ai/conversations/'+encodeURIComponent(sourceId!)+'/fork','POST',{}));
                if(leaving||revision!==version||currentId!==sourceId)return;
                const id=stringValue(record(result.conversation).id);await loadConversation(id);
                if(currentId!==id||!ready)return;
                present(input).value=draft;window.ComputerAttachments?.restore(files);present(input).dispatchEvent(new Event('input',{bubbles:true}));
            }catch(error){note.textContent=errorMessage(error);return;}
            finally{forking=false;controls();}
            await submitMessage();return;
        }
        navigation?.abort();
        const privateTurn = anonymous, requestRevision = ++revision;
        if(privateTurn && !privateExpiresAt) privateExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
        const currentRequest=()=>!leaving && revision===requestRevision;
        const attached=rewriting?.attachments || window.ComputerAttachments?.files()||[];
        const text = rewriting ? rewriting.message : present(input).value.trim() || (attached.length ? 'Analise os arquivos anexados.' : '');
        if (!text) { present(input).focus(); return; }
        if (text.length > 8000) { note.textContent = 'Escreva uma mensagem com até 8.000 caracteres.'; return; }
        if(attached.length&&isOllamaModel(models.selected()))models.select('gemini');
        const modelError = models.error();
        if (modelError === 'Carregando modelos. Aguarde um instante.') {
            showLoading(note, 'Carregando modelos');
            void models.whenReady().then(() => {
                if (currentRequest() && note.querySelector('.loading-indicator')) note.textContent = models.error();
            });
            return;
        }
        if (modelError) { note.textContent = modelError; return; }
        const payload: ChatRequest = { conversation_id: currentId, message: text, request_id: crypto.randomUUID(), provider: models.selected() };
        payload.web_search = optionalElement(document, '.web-search-toggle', HTMLButtonElement)?.getAttribute('aria-pressed') !== 'false';
        if(attached.length)payload.attachments=attached.map(file=>file.id);
        if(rewriting?.id && !privateTurn)payload.regenerate=rewriting.id;
        if(privateTurn){
            const prior=rewriting?turns.slice(0,turns.indexOf(rewriting)):turns;
            let history: {role:'user'|'assistant';content:string}[]=prior.filter(t=>t.status==='completed').slice(-19).flatMap(t=>[{role:'user',content:t.message},{role:'assistant',content:t.answer+artifactContext(t.metadata?.artifacts)}]);
            while(history.reduce((n,m)=>n+m.content.length,0)+text.length>48000)history.splice(0,2);
            payload.anonymous=true;payload.history=history;payload.conversation_id=null;
        }
        if (!privateTurn && currentId) invalidateConversation(currentId);
        const existingUser=rewriting&&present(conversation).querySelector<HTMLElement>(`.computer-message--user[data-turn="${rewriting.id}"]`);
        const user = existingUser ? {article:existingUser} : addMessage('user', text);messageAttachments(user.article,attached);
        let sentAt = new Date().toISOString();messageTime(user.article,sentAt);
        const oldAssistant=rewriting&&present(conversation).querySelector(`.computer-message--assistant[data-turn="${rewriting.id}"]`);
        const assistant = addMessage('assistant', '');
        assistant.article.classList.toggle('is-computer-response', payload.provider !== 'gemini');
        if(oldAssistant instanceof HTMLElement){oldAssistant.replaceWith(assistant.article);removeMessage(oldAssistant);window.ComputerResponseDetails.reset();}
        const thinking = addThinking(assistant, true);
        showConversation(); note.textContent = '';
        if(!rewriting){present(input).value = ''; if (!privateTurn) clearChatView(currentId); present(input).dispatchEvent(new Event('input', { bubbles: true }));}
        const controller = new AbortController(); active = controller; activeRequestId=payload.request_id;
        let timedOut = false, answer = '', persisted = false, savedTurnId: string | null = null;
        let thoughtStart: number | null = null, thoughtSeconds: number | null = null, responseMeta: ResponseMetadata = {provider:payload.provider};
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 310000);
        let paintFrame = 0;
        function paintAnswer() {
            paintFrame = 0;
            if (!currentRequest()) return;
            renderAnswer(assistant.body, answer, responseMeta.research?.sources);
            if (followingLatest) followLatest();
        }
        controls(); scrollToLatest();
        try {
            await service.chat(payload, delta => {
                if(!currentRequest() || !delta)return;
                thinking.cursor.hidden=true;
                if(!answer){
                    thinking.details.open=false;assistant.article.dataset.answerStarted='true';
                    if(thoughtStart!==null)thoughtSeconds=(performance.now()-thoughtStart)/1000;
                    thinking.label.textContent=thoughtLabel(thoughtSeconds);
                }
                if (nearLatest()) followingLatest = true;
                answer += delta;
                assistant.body.hidden = false;
                if (!paintFrame) paintFrame = requestAnimationFrame(paintAnswer);
                thinking.details.classList.remove('is-thinking');
                thinking.details.hidden = !thinking.text.length && !responseMeta.research;
            }, controller.signal, delta => {
                if(!currentRequest() || !delta)return;
                thinking.cursor.hidden=true;
                if (thoughtStart === null) thoughtStart = performance.now();
                thinking.label.textContent = 'Pensando';
                thinking.details.classList.add('is-thinking');
                thinking.details.hidden = false;
                if (thinking.text.length + delta.length > 48000) throw new Error('O pensamento excedeu o limite. Tente novamente.');
                const follow = thinking.panel.scrollHeight - thinking.panel.scrollTop - thinking.panel.clientHeight < 40;
                thinking.text.appendData(delta);
                if (thinking.details.open && follow) thinking.panel.scrollTop = thinking.panel.scrollHeight;
            }, metadata => {
                if(!currentRequest())return;
                persisted = !privateTurn;
                window.ComputerAttachments?.clear();
                if(metadata.provider)models.select(metadata.provider);
                if(metadata.provider){responseMeta.provider=metadata.provider;assistant.article.classList.toggle('is-computer-response', metadata.provider !== 'gemini');}
                savedTurnId = rewriting?.id || metadata.turn_id; user.article.dataset.turn=savedTurnId; sentAt=metadata.created_at||sentAt; messageTime(user.article,sentAt);
                assistant.article.dataset.turn = savedTurnId;
                const chatTitle = currentId === metadata.conversation_id
                    ? currentTitle
                    : text.slice(0, 100);
                if(!privateTurn){remember(metadata.conversation_id, chatTitle); if (currentId) { invalidateConversation(currentId); publishConversationChange(currentId); }}
            }, research => {
                if(!currentRequest())return;
                responseMeta.research = research;
                thinking.cursor.hidden=true;
                thinking.details.hidden = false;
                thinking.details.classList.add('is-thinking');
                thinking.label.textContent = 'Pensando';
                window.ComputerResponseDetails.research(assistant.article, research);
            }, metadata => {
                if(!currentRequest())return;
                responseMeta = {...metadata, provider:metadata.provider ?? responseMeta.provider};
                window.ComputerResponseDetails.artifacts(assistant.article,metadata.artifacts||[]);
                window.ComputerResponseDetails.research(assistant.article, metadata.research, true);
                
                if (thinking.text.length || responseMeta.research) thinking.label.textContent = thoughtLabel(metadata.thinking_seconds ?? thoughtSeconds);
            },event=>{
                if(!currentRequest())return;
                thinking.cursor.hidden=true;
                if(event.artifact)responseMeta.artifacts=[...(responseMeta.artifacts||[]),event.artifact];
                window.ComputerResponseDetails.artifacts(assistant.article,responseMeta.artifacts||[],event.state,event.message);
                if(followingLatest)followLatest();
            });
            if(!currentRequest())return;
            if (!answer.trim()) throw new Error('A resposta veio vazia. Tente novamente.');
            thinking.details.classList.remove('is-thinking');
            thinking.details.hidden = !thinking.text.length && !responseMeta.research;
            if (thinking.text.length) thinking.label.textContent = thoughtLabel(responseMeta.thinking_seconds);
            const follow = followingLatest || nearLatest();
            renderAnswer(assistant.body, answer, responseMeta.research?.sources);
            if(!currentRequest())return;
            requiredElement(assistant.article, '.computer-message__actions', HTMLElement).hidden = false;
            if (follow) scrollToLatest();
            const completed: Turn={ id:savedTurnId, message:text, answer, thinking:thinking.text.data, status:'completed', metadata:responseMeta, created_at:sentAt, attachments:attached };
            if (rewriting && !responseMeta.versions) {
                const {versions = [], ...previousMetadata} = rewriting.metadata || {};
                responseMeta.versions = [...versions, {answer:rewriting.answer, thinking:rewriting.thinking, metadata:{...previousMetadata, answered_at:previousMetadata.answered_at || rewriting.created_at}}];
            }
            responseMeta.answered_at ||= new Date().toISOString();
            versionSelection.delete(savedTurnId || '');
            if(rewriting)turns[turns.indexOf(rewriting)]=completed;else turns.push(completed);
            if (privateTurn) {
                privateId ||= 'anonymous-' + crypto.randomUUID();
                const saved = privateChats.get(privateId), now = new Date().toISOString();
                privateChats.set(privateId, {conversation:{id:privateId,title:saved?.conversation.title || text.slice(0,100),created_at:saved?.conversation.created_at || now,updated_at:now},turns});
                drawPrivateChats();
            }
            addResponseInfo(assistant.article, completed);
            if (completed.id) renderedTurns.set(completed.id, {signature:JSON.stringify([completed, undefined]), user:user.article, assistant:assistant.article});
            historyChecked = Date.now();
            note.textContent = '';
        } catch (error) {
            if(!currentRequest())return;
            if (responseMeta.research) window.ComputerResponseDetails.research(assistant.article, responseMeta.research, true);
            thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento interrompido';
            if (!answer && !thinking.text.length) thinking.details.hidden = true;
            if(rewriting){renderTurns(turns,true);}
            else if (!persisted) { removeMessage(user.article); removeMessage(assistant.article); showConversation(); }
            else warning(assistant, errorMessage(error));
            if(!rewriting){present(input).value = text; present(input).dispatchEvent(new Event('input', { bubbles: true }));}
            note.textContent = timedOut ? 'A resposta demorou mais que o esperado.'
                : (error instanceof Error ? error.name : '') === 'AbortError' ? 'Resposta interrompida.' : errorMessage(error);
            if (persisted) {
                ready = false;
                recovery(note.textContent);
            }
        } finally {
            thinking.cursor.hidden=true;
            cancelAnimationFrame(paintFrame);
            clearTimeout(timeout); if(active===controller){active = null;activeRequestId=null;} controls();
            if (currentRequest()) {
                saveHistory(); saveView(); if (!privateTurn && currentId) publishConversationChange(currentId); invalidateWorkspaceResource('/api/ai/conversations?');
                try { await listConversations(); if (!document.hidden && currentId) sessions.markRead(currentId); } catch (error) { recovery(error); }
                if (currentRequest()) present(input).focus({ preventScroll: true });
            }
        }
    }
    present(input).addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !active) { event.preventDefault(); form.requestSubmit(); }
    }, {signal: scope.signal});
    scope.listen(window, 'workspace:before-mount', () => { saveView(); saveHistory(); });
    scope.listen(window, 'pagehide', () => { if (scroller.isConnected) saveView(); if (active && currentId && !anonymous) invalidateConversation(currentId); else saveHistory(); navigation?.abort(); leaving = true; revision++; sessions.setBusy(false); clearTimeout(pollTimer); clearTimeout(recoveryTimer); active?.abort(); if(anonymous){revision++;turns=[];present(conversation).replaceChildren();window.ComputerResponseDetails.reset();present(input).value='';feedback.clear();setAnonymous(false);showConversation();} });
    scope.listen(window, 'pageshow', event => { if (event.persisted) { leaving = false; active = null; initialize(); } });
    let syncing = false, syncAgain = false;
    async function syncHistory() {
        if (anonymous || document.hidden || editing || loading || active || forking || leaving) return;
        if (syncing) { syncAgain = true; return; }
        if (!ready) {
            syncing = true;
            const draft = present(input).value, id = currentId;
            try {
                await recover();
                if (draft && currentId === id) {
                    present(input).value = draft;
                    present(input).dispatchEvent(new Event('input', { bubbles: true }));
                }
            } finally { syncing = false; }
            return;
        }
        syncing = true;
        const id = currentId, version = revision;
        try {
            if (id) {
                const result = await service.load(id);
                if (active || loading || revision !== version || currentId !== id || leaving || editing) return;
                applyHistory(result, true); controls();
                if (followingLatest) scrollToLatest();
            } else await listConversations();
            if (recover === syncHistory) note.textContent = '';
            resetRecovery();
        } catch (error) {
            if (revision === version && !leaving) {
                if(error instanceof Error && 'status' in error && [401,403,404].includes(Number(error.status)) && currentConversation?.is_owner===false){
                    invalidateConversation(id!,true);ready=false;turns=[];renderTurns(turns);sharedNotice.hidden=true;window.ComputerResponseDetails.reset();resetRecovery();controls();
                    if('code' in error && error.code==='conversation_private')window.dispatchEvent(new CustomEvent('chat:private',{detail:{id:id!}}));
                    else note.textContent=errorMessage(error);
                }else recovery(error,syncHistory);
            }
        }
        finally {
            syncing = false;
            if (syncAgain) { syncAgain = false; void syncHistory(); }
            else if (revision === version) schedulePoll();
        }
    }
    // Active responses poll quickly; completed chats only reconcile periodically or on return.
    setInterval(() => { if (!remoteActive) void syncHistory(); }, 60000);
    scope.listen(window, 'online', syncHistory);
    scope.listen(document, 'visibilitychange', syncHistory);
    scope.listen(window, 'focus', () => { if (Date.now() - historyChecked > 15000) void syncHistory(); });
    function resizeInput() {
        const started = present(page).classList.contains('has-conversation');
        present(input).rows = started ? 1 : 2;
        const style = getComputedStyle(present(input));
        const line = parseFloat(style.lineHeight) || 24;
        const rows = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--composer-max-lines')) || 10;
        const limit = line * rows + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        present(input).style.height = 'auto';
        present(input).style.height = Math.max(started ? line + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 38, Math.min(present(input).scrollHeight, limit)) + 'px';
        present(input).style.overflowY = present(input).scrollHeight > limit ? 'auto' : 'hidden';
        controls();
    }
    present(input).addEventListener('input',resizeInput, {signal: scope.signal});
    scope.listen(window, 'resize',resizeInput);
    function setAnonymous(value: boolean) {
        if(!value) privateExpiresAt=0;
        anonymous=value;document.body.classList.toggle('is-anonymous',value);
        anonymousButton.setAttribute('aria-pressed',String(value));
        anonymousButton.setAttribute('aria-label',value?'Desativar modo anônimo':'Ativar modo anônimo');
        const privacyNote = optionalElement(present(page), '.anonymous-note', HTMLElement);
        if (privacyNote) privacyNote.hidden=!value;
        window.dispatchEvent(new CustomEvent('chat:anonymous',{detail:value}));
        if(value){window.ComputerAttachments?.clear();document.title='Chat anônimo';}else if(!currentId){document.title='Novo chat';}
        controls();
    }
    function toggleAnonymous() {
        if (loading || leaving) return;
        const next = !anonymous;
        saveView(); saveHistory(); ready = false; navigation?.abort();
        revision++;
        active?.abort(); active = null;
        feedback.clear();
        setAnonymous(next);
        privateChats.clear();
        newConversation();
        if (next) drawPrivateChats(); else { sessions.render([]); void listConversations(); }
    }
    anonymousButton.addEventListener('click', toggleAnonymous, {signal: scope.signal});
    scope.listen(window, 'chat:toggle-anonymous', toggleAnonymous);
    requiredElement(document, '.anonymous-close', HTMLElement).addEventListener('click', () => {
        if (!anonymous) return;
        active?.abort();
        active = null; ready = false;
        feedback.clear();
        setAnonymous(false); privateChats.clear(); newConversation(); void listConversations();
    }, {signal: scope.signal});
    scope.listen(requiredElement(document, '.anonymous-composer-exit', HTMLButtonElement), 'click', () => requiredElement(document, '.anonymous-close', HTMLButtonElement).click());
    initialize();
    resizeInput();
}
import {answerText, renderAnswer } from './answer-content';
