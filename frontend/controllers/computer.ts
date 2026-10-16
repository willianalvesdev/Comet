import { isLocalModel } from './api-data';
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
    const conversation = optionalElement(page, '.computer-messages', HTMLElement);
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

    const studyQuestion = new URL(location.href).searchParams.has('study') ? window.CometStudyQuestion : undefined;
    let studyQuestionSent = false;
    const sessions = window.ComputerSessions;
    const models = window.ComputerModels;
    const olderButton = requiredElement(page, '.computer-history__older', HTMLButtonElement);
    const service = new window.ComputerService();
    let editing: HTMLElement | null = null, anonymous = false;
    if(!optionalElement(document, '.anonymous-toggle', HTMLButtonElement)){
        const button=document.createElement('button');button.type='button';button.className='workspace__header-button anonymous-toggle';button.setAttribute('aria-label','Ativar modo anônimo');button.setAttribute('aria-pressed','false');button.innerHTML='<i aria-hidden="true"></i>';requiredElement(document, '.computer-header', HTMLElement).append(button);
    }
    if(!optionalElement(document, '.anonymous-note', HTMLElement)){const note=document.createElement('p');note.className='anonymous-note';note.hidden=true;note.textContent='Esse chat não será salvo no histórico';form.after(note);}
    const anonymousButton = requiredElement(document, '.anonymous-toggle', HTMLButtonElement);
    const privateChats = new Map<string, {conversation: Conversation; turns: Turn[]}>();
    let privateId: string | null = null;
    function drawPrivateChats() { sessions.render([...privateChats.values()].map(item=>item.conversation)); sessions.select(privateId); }
    let activeRequestId: string | null = null;
    let currentTitle = '';
    let currentConversation: Conversation | null = null;
    let currentId: string | null = null, active: AbortController | null = null, loading = true, ready = false, remoteActive = false;
    let nextOffset: number | null = null, before: string | null = null, turns: Turn[] = [], pollTimer = 0, leaving = false, revision = 0;

    let followingLatest = true, previousScrollTop = scroller.scrollTop;
    const composer = requiredElement(page, '.computer-composer', HTMLElement);
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
        const offset = viewport && matchMedia('(width < 640px)').matches && viewport.scale === 1
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
        if (!followingLatest) return;
        scroller.scrollTo({top:scroller.scrollHeight, behavior:'instant'});
        previousScrollTop = scroller.scrollTop;
    }
    function scrollToLatest() {
        followingLatest = true;
        requestAnimationFrame(followLatest);
    }
    scope.listen(scroller, 'wheel', event => {
        if (event.deltaY < 0) followingLatest = false;
    }, {passive:true});
    scope.listen(scroller, 'scroll', () => {
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
    page.append(jump);
    function updateJump() {
        jump.hidden = present(conversation).hidden || nearLatest();
        const rect = composer.getBoundingClientRect();
        jump.style.left = (rect.left + rect.width / 2 - 16) + 'px';
        jump.style.bottom = Math.max(16, innerHeight - rect.top + 12) + 'px';
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
    const copyTimers = new WeakMap<HTMLButtonElement,number>();
    const attachedFiles = new WeakMap<HTMLElement,Attachment[]>();
    function copied(button: HTMLButtonElement, glyph: HTMLElement, original: string) {
        clearTimeout(copyTimers.get(button));
        glyph.style.setProperty('--action-icon', "url('/static/img/icons/check.svg')");
        button.setAttribute('aria-label','Texto copiado');
        copyTimers.set(button,setTimeout(()=>{glyph.style.setProperty('--action-icon',original);button.setAttribute('aria-label','Copiar');},2200));
    }
    async function rewrite(article: HTMLElement) {
        if(active || loading || remoteActive || editing)return;
        const turn=turns.find(item=>item.id===article.dataset.turn);if(!turn)return;
        await submitMessage(turn);
    }
    function addActions(article: HTMLElement, body: HTMLElement) {
        const actions = document.createElement('div'); actions.className = 'computer-message__actions'; actions.hidden = true;
        const status = document.createElement('span'); status.className = 'computer-action-status'; status.setAttribute('role','status');
        for (const [kind,label] of [['copy','Copiar'],['helpful','Útil'],['unhelpful','Não útil']]) {
            const button = document.createElement('button'); button.type='button'; button.title=label; button.setAttribute('aria-label',label);
            const icon=document.createElement('i'); icon.style.setProperty('--action-icon',`url('/static/img/icons/${kind}.svg')`); icon.setAttribute('aria-hidden','true'); button.append(icon);
            if(kind!=='copy') button.setAttribute('aria-pressed','false');
            button.addEventListener('click',async()=>{
                if(kind==='copy') {
                    try { await navigator.clipboard.writeText(body.textContent); status.textContent=''; copied(button,icon,"url('/static/img/icons/copy.svg')"); }
                    catch { status.textContent='Não foi possível copiar. Selecione o texto para copiar.'; }
                    return;
                }
                const selected=button.getAttribute('aria-pressed')!=='true';
                elementList(actions, '[aria-pressed]', HTMLElement).forEach(b=>b.setAttribute('aria-pressed','false'));
                button.setAttribute('aria-pressed',String(selected));
                feedback.set(article.dataset.turn || article, selected ? kind : null);
            }, {signal: scope.signal});
            button.dataset.feedback=kind; actions.append(button);
        }
        const rewriteButton=document.createElement('button');rewriteButton.type='button';rewriteButton.className='computer-rewrite';rewriteButton.setAttribute('aria-label','Reescrever resposta');rewriteButton.title='Reescrever resposta';rewriteButton.innerHTML='<i aria-hidden="true"></i>';rewriteButton.addEventListener('click',()=>rewrite(article), {signal: scope.signal});
        const download=document.createElement('button');download.type='button';download.className='computer-download';download.setAttribute('aria-label','Baixar pergunta e resposta em PDF');download.title='Baixar pergunta e resposta em PDF';download.innerHTML='<i aria-hidden="true" style="--action-icon:url(/static/img/icons/library/download.svg)"></i>';
        download.addEventListener('click',()=>{
            if (!currentId || !article.dataset.turn) { status.textContent='Esta resposta ainda não está salva para exportação.'; return; }
            window.dispatchEvent(new CustomEvent('chat:export',{detail:{id:currentId,title:currentTitle||'Resposta',format:'pdf',turnId:article.dataset.turn}}));
        },{signal:scope.signal});
        actions.append(status,download,rewriteButton); article.append(actions);
        requestAnimationFrame(()=>{const value=feedback.get(article.dataset.turn || article);if(value)actions.querySelector(`[data-feedback="${value}"]`)?.setAttribute('aria-pressed','true');});
    }
    function messageAttachments(article: HTMLElement, files: Attachment[] | undefined) {
        attachedFiles.set(article,files||[]);
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
                if(active||loading||remoteActive||editing||anonymous||!article.dataset.turn)return;
                const original=body.textContent;
                const editor=document.createElement('div');editor.className='computer-user-editor';
                const text=document.createElement('textarea');text.value=original;text.maxLength=8000;text.setAttribute('aria-label','Editar mensagem');
                const footer=document.createElement('div');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';
                const done=document.createElement('button');done.type='button';done.textContent='Concluído';done.className='computer-user-editor__save';
                const error=document.createElement('p');error.setAttribute('role','alert');
                footer.append(cancel,done);editor.append(text,error,footer);article.append(editor);article.classList.add('is-editing');body.hidden=true;editing=article;
                const close=()=>{editor.remove();article.classList.remove('is-editing');body.hidden=false;editing=null;button.focus();};
                cancel.addEventListener('click',close, {signal: scope.signal});text.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}}, {signal: scope.signal});
                done.addEventListener('click',async()=>{
                    const value=text.value.trim();if(!value){text.focus();return;}if(value===original){close();return;}
                    if(active||loading||remoteActive)return;
                    done.disabled=cancel.disabled=true;text.disabled=true;loading=true;controls();
                    try{
                        const response=await fetch(`/api/ai/conversations/${currentId}/messages/${article.dataset.turn}/edit`,{method:'POST',credentials:'same-origin',headers:{'X-CSRFToken':requiredElement(document, 'meta[name="csrf-token"]', HTMLMetaElement).content}});
                        const result=record(await response.json());if(!response.ok)throw new Error(apiError(result,'Não foi possível editar.'));
                        const attached=attachedFiles.get(article)||[];editing=null;await loadConversation(stringValue(result.conversation_id));window.ComputerAttachments?.restore(attached);
                        present(input).value=value;present(input).dispatchEvent(new Event('input',{bubbles:true}));
                        if(ready){form.requestSubmit();}else{recovery('A edição foi preparada. Tente carregar a conversa novamente.');}
                    }catch(failure){loading=false;controls();error.textContent=errorMessage(failure);done.disabled=cancel.disabled=false;text.disabled=false;}
                }, {signal: scope.signal});
                text.focus();text.setSelectionRange(text.value.length,text.value.length);
            }, {signal: scope.signal});actions.append(button);
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
    function addThinking(assistant: {article:HTMLElement;body:HTMLElement}) {
        const details = document.createElement('details');
        details.className = 'computer-thinking is-thinking';
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
        details.addEventListener('toggle', () => { if (details.open) panel.scrollTop = panel.scrollHeight; }, {signal: scope.signal});
        assistant.article.insertBefore(details, assistant.body);
        assistant.body.hidden = true;
        return { details, label, panel, text };
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

        const unavailable = loading || !ready || remoteActive;
        form.classList.toggle('is-responding', busy);
        send.disabled = !busy && (unavailable || window.ComputerAttachments?.busy() || (empty && microphone.getAttribute("aria-pressed") !== "true"));
        window.ComputerAttachments?.setBusy(busy || unavailable);
        anonymousButton.hidden = present(conversation).children.length > 0;
        anonymousButton.disabled = unavailable;
        const privateToggle = optionalElement(document, '.profile-anonymous', HTMLButtonElement);
        if (privateToggle) privateToggle.disabled = unavailable;
        const options=optionalElement(document,'.chat-options-toggle',HTMLButtonElement);
        if(options){options.hidden=!currentId || anonymous;options.disabled=busy || unavailable;}
        document.body.classList.toggle('chat-is-empty', present(conversation).children.length === 0);
        requiredElement(document, '.chat-tabs', HTMLElement).hidden = present(conversation).children.length === 0;
        elementList(present(conversation), '.computer-rewrite', HTMLButtonElement).forEach(button=>button.disabled=busy||unavailable);
        send.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar mensagem');
        send.title = busy ? 'Parar resposta' : 'Enviar mensagem';
        present(input).readOnly = busy || unavailable;
        microphone.disabled = busy || unavailable;
        present(conversation).setAttribute('aria-busy', String(busy || remoteActive));
        sessions.setBusy(loading || (anonymous && busy));
        models.setBusy(loading || busy || remoteActive);
        olderButton.disabled = loading || busy || !ready;
    }
    function showConversation() {
        present(conversation).hidden = !present(conversation).childElementCount;
        present(page).classList.toggle('has-conversation', !present(conversation).hidden);
        resizeInput();
    }
    function remember(id: string | null, title?: string, details?: Conversation) {
        if (leaving) return;
        if (id !== currentId) window.ComputerResponseDetails.reset();
        currentId = id;
        currentTitle = id ? (title || "") : "";
        document.title = (id ? (title || 'Conversa') : 'Novo chat');
        const url = new URL(location.href);
        url.searchParams.delete('new');
        url.searchParams.delete('anonymous');
        if (id) url.searchParams.set('conversation', id); else url.searchParams.delete('conversation');
        if (window.WorkspaceNavigation.replaceURL) window.WorkspaceNavigation.replaceURL(url);
        else history.replaceState(null, '', url);
        sessions.select(id, title);
        const now=new Date().toISOString();
        currentConversation=id ? details || {id,title:currentTitle,created_at:currentConversation?.id===id?currentConversation.created_at:now,updated_at:now} : null;
        window.dispatchEvent(new CustomEvent('chat:context',{detail:currentConversation}));
    }

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
                }, {signal: scope.signal});
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
    function renderTurns(items: Turn[], preserveOpen = false) {
        const opened = preserveOpen ? new Set([...elementList(present(conversation), '[data-turn]', HTMLElement)]
            .filter(node => optionalElement(node, 'details', HTMLDetailsElement)?.open).map(node => node.dataset.turn)) : new Set();
        present(conversation).replaceChildren();
        for (const original of items) {
            const versions = original.metadata?.versions || [];
            const selectedVersion = versions[versionSelection.get(original.id || '') ?? versions.length];
            const turn = selectedVersion ? {...original, ...selectedVersion} : original;
            const user = addMessage('user', turn.message); user.article.dataset.turn=turn.id ?? ''; messageTime(user.article,turn.created_at); messageAttachments(user.article,turn.attachments);
            const assistant = addMessage('assistant', turn.answer);
            renderAnswer(assistant.body, turn.answer, turn.metadata?.research?.sources);
            assistant.article.classList.toggle('is-computer-response', !!turn.metadata?.provider && turn.metadata.provider !== 'gemini');
            requiredElement(assistant.article, '.computer-message__actions', HTMLElement).hidden = turn.status === 'running';
            assistant.article.dataset.turn = turn.id ?? '';
            if (turn.thinking || turn.metadata?.research || turn.status === 'running') {
                const thinking = addThinking(assistant);
                thinking.text.appendData(turn.thinking);
                thinking.details.open = opened.has(turn.id);
                const running = turn.status === 'running' && !turn.answer;
                thinking.details.classList.toggle('is-thinking', running);
                thinking.label.textContent = running ? 'Pensando' : ['completed', 'running'].includes(turn.status) ? thoughtLabel(turn.metadata?.thinking_seconds ?? durations[turn.id ?? '']) : 'Pensamento interrompido';
            }
            window.ComputerResponseDetails.research(assistant.article, turn.metadata?.research, turn.status !== 'running');
            
            if (turn.status !== 'running') addResponseInfo(assistant.article, original);
            assistant.body.hidden = !turn.answer;
            if (turn.status === 'interrupted' || turn.status === 'failed') {
                warning(assistant, turn.metadata?.error || (turn.answer ? 'Resposta interrompida. O conteúdo salvo não foi incluído no contexto das próximas mensagens.' : 'Não foi possível gerar a resposta. Tente novamente ou escolha outro modelo.'));
            } else if (turn.status === 'running') warning(assistant, 'Resposta em andamento. O histórico será atualizado automaticamente.');
        }
        showConversation();
    }
    async function listConversations(append = false) {
        if (anonymous) { drawPrivateChats(); return; }
        const result = await service.list(append ? nextOffset : 0);
        if (leaving) return [];
        nextOffset = result.next_offset;
        const saved=result.conversations.find(chat=>chat.id===currentId);
        if(saved){currentConversation=saved;window.dispatchEvent(new CustomEvent('chat:context',{detail:saved}));}
        sessions.render(result.conversations, append, nextOffset !== null);
        if (currentId) sessions.select(currentId);
        return result.conversations;
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (!remoteActive || leaving || !currentId) return;
        const id = currentId, version = revision;
        pollTimer = setTimeout(async () => {
            try {
                const result = await service.load(id);
                if (leaving || active || loading || currentId !== id || revision !== version) return;
                const updatedIds = new Set(result.turns.map(turn => turn.id));
                turns = [...turns.filter(turn => !updatedIds.has(turn.id)), ...result.turns];
                remoteActive = result.active;
                renderTurns(turns, true);
                if (!document.hidden) sessions.markRead(id, result.conversation.last_response_at);
                note.textContent = remoteActive ? 'Resposta em andamento…' : '';
            } catch (error) {
                if (currentId !== id || revision !== version || leaving) return;
                remoteActive = false;
                ready = false;
                recovery(error);
            }
            controls();
            schedulePoll();
        }, 2000);
    }
    async function loadConversation(id: string) {
        if (anonymous) {
            const saved = privateChats.get(id); if (!saved) return;
            privateId = id; currentTitle = saved.conversation.title; turns = saved.turns;
            window.ComputerResponseDetails.reset(); renderTurns(turns); sessions.select(id);
            present(input).value = ''; present(input).dispatchEvent(new Event('input', {bubbles:true}));
            showConversation(); controls(); return;
        }
        setAnonymous(false);
        editing = null;
        window.ComputerAttachments?.clear();
        revision++;
        clearTimeout(pollTimer);
        loading = true; ready = false; controls();
        note.textContent = '';
        try {
            const result = await service.load(id);
            remember(result.conversation.id, result.conversation.title, result.conversation);
            turns = result.turns;
            before = result.before;
            olderButton.hidden = !before;
            remoteActive = result.active;
            renderTurns(turns);
            if (!document.hidden) sessions.markRead(id, result.conversation.last_response_at, true);
            ready = true;
            resetRecovery();
            present(input).value = '';
            present(input).dispatchEvent(new Event('input', { bubbles: true }));
            note.textContent = remoteActive ? 'Resposta em andamento…' : '';
            scrollToLatest();
        } catch (error) {
            sessions.select(currentId);
            recovery(error, () => loadConversation(id));
        } finally {
            loading = false; controls(); schedulePoll();
        }
    }
    function newConversation() {
        privateId = null;
        window.ComputerResponseDetails.reset();
        resetRecovery();
        editing = null;
        window.ComputerAttachments?.clear();
        revision++;
        clearTimeout(pollTimer);
        remember(null);
        turns = []; before = null; remoteActive = false; ready = true;
        present(conversation).replaceChildren(); showConversation(); olderButton.hidden = true;
        note.textContent = ''; present(input).value = '';
        present(input).dispatchEvent(new Event('input', { bubbles: true }));
        controls(); present(input).focus();
    }
    async function initialize() {
        const draft = present(input).value, previousId = currentId;
        loading = true; ready = false; controls();
        note.textContent = '';
        try {
            const startAnonymous = new URL(location.href).searchParams.get('anonymous') === '1';
            if (!startAnonymous) await listConversations();
            if (leaving) return;
            const requested = new URL(location.href).searchParams.get('conversation');
            const id = new URL(location.href).searchParams.has('new') ? null : requested;
            if (startAnonymous) { loading = false; newConversation(); setAnonymous(true); drawPrivateChats(); }
            else if (id) await loadConversation(id);
            else { loading = false; newConversation(); }
            if (draft && previousId === currentId) { present(input).value = draft; present(input).dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (error) {
            recovery(error);
        } finally { loading = false; controls(); }
        if (ready && !leaving && studyQuestion && !studyQuestionSent && !currentId) {
            studyQuestionSent = true;
            delete window.CometStudyQuestion;
            models.select(studyQuestion.provider);
            window.ComputerAttachments.restore(studyQuestion.attachments);
            const webToggle = optionalElement(document, '.web-search-toggle', HTMLButtonElement);
            webToggle?.setAttribute('aria-pressed', 'true');
            present(input).value = studyQuestion.message;
            present(input).dispatchEvent(new Event('input', {bubbles:true}));
            void submitMessage();
        }
    }
    scope.listen(window, 'attachments:changed',controls);
    function detachResponse() { revision++; active?.abort(); active=null; activeRequestId=null; }
    scope.listen(window, 'sessions:open', event => { if (!loading && !(anonymous && active)) { detachResponse(); void loadConversation(event.detail.id); } });
    scope.listen(document, 'click', event => {
        const target = event.target instanceof Element ? event.target.closest('a') : null;
        if (anonymous && target && (target.matches('.sidebar__logo, .sidebar__link[aria-label="Novo chat"], .sessions__new'))) {
            event.preventDefault(); event.stopImmediatePropagation(); if (!loading && !active) newConversation();
        }
    }, {capture:true});
    scope.listen(window, 'sessions:new', () => { if (!loading && !(anonymous && active)) { detachResponse(); newConversation(); } });
    scope.listen(window, 'sessions:refresh', () => { if (!loading && !active) initialize(); });
    scope.listen(window, 'sessions:changed', async event => {
        if (anonymous) {
            if (event.detail.deleted) { privateChats.delete(event.detail.id); if (privateId === event.detail.id) newConversation(); }
            else { const saved=privateChats.get(event.detail.id); if(saved && event.detail.title) saved.conversation.title=event.detail.title; }
            drawPrivateChats(); return;
        }
        if (event.detail.deleted && event.detail.id === currentId) newConversation();
        else if (event.detail.id === currentId && event.detail.title) remember(currentId, event.detail.title);
        try { await listConversations(); } catch (error) { recovery(error); }
    });
    scope.listen(window, 'sessions:more', async () => {
        if (loading || active) return;
        loading = true; controls();
        try { await listConversations(true); } catch (error) { recovery(error); }
        finally { loading = false; controls(); }
    });
    olderButton.addEventListener('click', async () => {
        loading = true; controls();
        const height = present(conversation).getBoundingClientRect().height;
        try {
            const result = await service.load(present(currentId), before);
            turns = [...result.turns, ...turns]; before = result.before;
            renderTurns(turns, true); olderButton.hidden = !before;
            scroller.scrollBy(0, present(conversation).getBoundingClientRect().height - height);
        } catch (error) { recovery(error); }
        finally { loading = false; controls(); }
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
        if(active)return;
        if (editing || loading || !ready || remoteActive || microphone.getAttribute('aria-pressed') === 'true') return;
        if(window.ComputerAttachments?.busy())return;
        const privateTurn = anonymous, requestRevision = revision;
        const currentRequest=()=>!leaving && revision===requestRevision;
        const attached=rewriting?.attachments || window.ComputerAttachments?.files()||[];
        const text = rewriting ? rewriting.message : present(input).value.trim() || (attached.length ? 'Analise os arquivos anexados.' : '');
        if (!text) { present(input).focus(); return; }
        if (text.length > 8000) { note.textContent = 'Escreva uma mensagem com até 8.000 caracteres.'; return; }
        if(attached.length&&isLocalModel(models.selected()))models.select('gemini');
        if (models.error()) { note.textContent = models.error(); return; }
        const payload: ChatRequest = { conversation_id: currentId, message: text, request_id: crypto.randomUUID(), provider: models.selected() };
        payload.web_search = optionalElement(document, '.web-search-toggle', HTMLButtonElement)?.getAttribute('aria-pressed') !== 'false';
        if(attached.length)payload.attachments=attached.map(file=>file.id);
        if(rewriting?.id && !privateTurn)payload.regenerate=rewriting.id;
        if(privateTurn){
            const prior=rewriting?turns.slice(0,turns.indexOf(rewriting)):turns;
            let history: {role:'user'|'assistant';content:string}[]=prior.filter(t=>t.status==='completed').slice(-19).flatMap(t=>[{role:'user',content:t.message},{role:'assistant',content:t.answer}]);
            while(history.reduce((n,m)=>n+m.content.length,0)+text.length>48000)history.splice(0,2);
            payload.anonymous=true;payload.history=history;payload.conversation_id=null;
        }
        const existingUser=rewriting&&present(conversation).querySelector<HTMLElement>(`.computer-message--user[data-turn="${rewriting.id}"]`);
        const user = existingUser ? {article:existingUser} : addMessage('user', text);messageAttachments(user.article,attached);
        let sentAt = new Date().toISOString();messageTime(user.article,sentAt);
        const oldAssistant=rewriting&&present(conversation).querySelector(`.computer-message--assistant[data-turn="${rewriting.id}"]`);
        const assistant = addMessage('assistant', '');
        assistant.article.classList.toggle('is-computer-response', payload.provider !== 'gemini');
        if(oldAssistant){oldAssistant.replaceWith(assistant.article);window.ComputerResponseDetails.reset();}
        const thinking = addThinking(assistant);
        showConversation(); note.textContent = '';
        if(!rewriting){present(input).value = ''; present(input).dispatchEvent(new Event('input', { bubbles: true }));}
        const controller = new AbortController(); active = controller; activeRequestId=payload.request_id;
        let timedOut = false, answer = '', persisted = false, savedTurnId: string | null = null;
        let thoughtStart: number | null = null, thoughtSeconds: number | null = null, responseMeta: ResponseMetadata = {provider:payload.provider};
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 310000);
        controls(); scrollToLatest();
        try {
            await service.chat(payload, delta => {
                if(!currentRequest())return;
                if (nearLatest()) followingLatest = true;
                answer += delta;
                assistant.body.hidden = false;
                renderAnswer(assistant.body, answer, responseMeta.research?.sources);
                thinking.details.classList.remove('is-thinking');
                thinking.details.hidden = !thinking.text.length && !responseMeta.research;
                if (followingLatest) followLatest();
            }, controller.signal, delta => {
                if(!currentRequest())return;
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
                if(!privateTurn)remember(metadata.conversation_id, chatTitle);
            }, research => {
                if(!currentRequest())return;
                responseMeta.research = research;
                thinking.details.hidden = false;
                thinking.details.classList.add('is-thinking');
                thinking.label.textContent = 'Pensando';
                window.ComputerResponseDetails.research(assistant.article, research);
            }, metadata => {
                if(!currentRequest())return;
                responseMeta = {...metadata, provider:metadata.provider ?? responseMeta.provider};
                window.ComputerResponseDetails.research(assistant.article, metadata.research, true);
                
                if (thinking.text.length || responseMeta.research) thinking.label.textContent = thoughtLabel(metadata.thinking_seconds ?? thoughtSeconds);
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
            note.textContent = '';
        } catch (error) {
            if(!currentRequest())return;
            if (responseMeta.research) window.ComputerResponseDetails.research(assistant.article, responseMeta.research, true);
            thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento interrompido';
            if (!answer && !thinking.text.length) thinking.details.hidden = true;
            if(rewriting){renderTurns(turns,true);}
            else if (!persisted) { user.article.remove(); assistant.article.remove(); showConversation(); }
            else warning(assistant, errorMessage(error));
            if(!rewriting){present(input).value = text; present(input).dispatchEvent(new Event('input', { bubbles: true }));}
            note.textContent = timedOut ? 'A resposta demorou mais que o esperado.'
                : (error instanceof Error ? error.name : '') === 'AbortError' ? 'Resposta interrompida.' : errorMessage(error);
            if (persisted && !rewriting) {
                ready = false;
                recovery(note.textContent);
            }
        } finally {
            clearTimeout(timeout); if(active===controller){active = null;activeRequestId=null;} controls();
            if (currentRequest()) {
                try { await listConversations(); if (!document.hidden && currentId) sessions.markRead(currentId); } catch (error) { recovery(error); }
                present(input).focus({ preventScroll: true });
            }
        }
    }
    present(input).addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !active) { event.preventDefault(); form.requestSubmit(); }
    }, {signal: scope.signal});
    scope.listen(window, 'pagehide', () => { leaving = true; revision++; sessions.setBusy(false); clearTimeout(pollTimer); clearTimeout(recoveryTimer); active?.abort(); if(anonymous){revision++;turns=[];present(conversation).replaceChildren();window.ComputerResponseDetails.reset();present(input).value='';feedback.clear();setAnonymous(false);showConversation();} });
    scope.listen(window, 'pageshow', event => { if (event.persisted) { leaving = false; active = null; initialize(); } });
    let syncing = false;
    async function syncHistory() {
        if (anonymous || document.hidden || editing || loading || active || syncing || leaving) return;
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
            await listConversations();
            if (id && !active && !loading && revision === version) {
                const result = await service.load(id);
                if (active || loading || revision !== version || currentId !== id) return;
                const updated = new Set(result.turns.map(turn => turn.id));
                const merged = [...turns.filter(turn => !updated.has(turn.id)), ...result.turns];
                if (JSON.stringify(merged) !== JSON.stringify(turns)) {
                    const follow = followingLatest; turns = merged; renderTurns(turns, true); if (follow) scrollToLatest();
                }
                if (!document.hidden) sessions.markRead(id, result.conversation.last_response_at);
                remoteActive = result.active; controls(); schedulePoll();
            }
            if (recover === syncHistory) note.textContent = '';
            resetRecovery();
        } catch (error) { recovery(error, syncHistory); }
        finally { syncing = false; }
    }
    setInterval(syncHistory, 4000);
    scope.listen(window, 'online', syncHistory);
    scope.listen(document, 'visibilitychange', syncHistory);
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
        active = null;
        feedback.clear();
        setAnonymous(false); privateChats.clear(); newConversation(); void listConversations();
    }, {signal: scope.signal});
    initialize();
    resizeInput();
}
import { renderAnswer } from './answer-content';
