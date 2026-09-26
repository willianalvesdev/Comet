(() => {
    const page = document.querySelector('.computer-page');
    if (!page) return;
    const form = page.querySelector('form');
    const input = form.querySelector('textarea');
    const send = form.querySelector('.home__send');
    const microphone = form.querySelector('.home__microphone');
    const note = page.querySelector('.computer-note');
    const conversation = page.querySelector('.computer-messages');
    let recover = () => initialize();
    let recoveryTimer = null, recoveryDelay = 1000;
    function resetRecovery() {
        clearTimeout(recoveryTimer); recoveryTimer = null; recoveryDelay = 1000;
    }
    function scheduleRecovery() {
        clearTimeout(recoveryTimer);
        if (leaving) return;
        recoveryTimer = setTimeout(async () => {
            recoveryTimer = null;
            if (leaving) return;
            if (loading || active || syncing || document.hidden || editing) { scheduleRecovery(); return; }
            await syncHistory();
        }, recoveryDelay);
        recoveryDelay = Math.min(recoveryDelay * 2, 15000);
    }
    function recovery(error, action = () => initialize()) {
        note.textContent = error.message || error; recover = action; scheduleRecovery();
    }

    const sessions = window.ComputerSessions;
    const models = window.ComputerModels;
    const olderButton = page.querySelector('.computer-history__older');
    const service = new window.ComputerService();
    let editing = null;
    let currentId = null, active = null, loading = true, ready = false, remoteActive = false;
    let nextOffset = null, before = null, turns = [], pollTimer = null, leaving = false, revision = 0;

    const composer = page.querySelector('.computer-composer');
    function syncComposerSpace() {
        page.style.setProperty('--computer-composer-height', `${Math.ceil(composer.getBoundingClientRect().height)}px`);
    }
    new ResizeObserver(syncComposerSpace).observe(composer);
    function syncKeyboard() {
        const viewport = window.visualViewport;
        const offset = viewport && matchMedia('(width < 640px)').matches && viewport.scale === 1
            ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
        page.style.setProperty('--computer-keyboard-offset', `${offset}px`);
    }
    window.visualViewport?.addEventListener('resize', syncKeyboard);
    window.visualViewport?.addEventListener('scroll', syncKeyboard);
    window.addEventListener('resize', syncKeyboard);
    syncKeyboard();
    function nearLatest() {
        return document.documentElement.scrollHeight - window.scrollY - innerHeight < 160;
    }
    function scrollToLatest() {
        requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    }

    const feedback = new Map();
    function addActions(article, body) {
        const actions = document.createElement('div'); actions.className = 'computer-message__actions';
        const status = document.createElement('span'); status.className = 'computer-action-status'; status.setAttribute('role','status');
        for (const [kind,label] of [['copy','Copiar'],['helpful','Útil'],['unhelpful','Não útil']]) {
            const button = document.createElement('button'); button.type='button'; button.title=label; button.setAttribute('aria-label',label);
            const icon=document.createElement('i'); icon.style.setProperty('--action-icon',`url('/static/img/icons/${kind}.svg')`); icon.setAttribute('aria-hidden','true'); button.append(icon);
            if(kind!=='copy') button.setAttribute('aria-pressed','false');
            button.addEventListener('click',async()=>{
                if(kind==='copy') {
                    try { await navigator.clipboard.writeText(body.textContent); status.textContent='Copiado'; }
                    catch { status.textContent='Não foi possível copiar. Selecione o texto para copiar.'; }
                    return;
                }
                const selected=button.getAttribute('aria-pressed')!=='true';
                actions.querySelectorAll('[aria-pressed]').forEach(b=>b.setAttribute('aria-pressed','false'));
                button.setAttribute('aria-pressed',String(selected));
                feedback.set(article.dataset.turn || article, selected ? kind : null);
            });
            button.dataset.feedback=kind; actions.append(button);
        }
        actions.append(status); article.append(actions);
        requestAnimationFrame(()=>{const value=feedback.get(article.dataset.turn || article);if(value)actions.querySelector(`[data-feedback="${value}"]`).setAttribute('aria-pressed','true');});
    }
    function messageAttachments(article, files) {
        article.attachedFiles=files||[];
        article.querySelector('.attachment-list')?.remove();
        if(!files?.length)return;
        const list=document.createElement('div');list.className='attachment-list';
        for(const file of files){const chip=document.createElement('div');chip.className='attachment-chip';const name=document.createElement('span');name.textContent=file.name;chip.append(name);list.append(chip);}
        article.prepend(list);
    }
    function messageTime(article, value) {
        const stamp=article.querySelector('time'); if(!stamp)return;
        const date=new Date(value); stamp.hidden=!value||Number.isNaN(date.getTime());
        if(stamp.hidden)return;
        stamp.dateTime=date.toISOString();stamp.textContent=date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});stamp.title=date.toLocaleString('pt-BR');
    }
    function userActions(article, body) {
        const actions=document.createElement('div'); actions.className='computer-user-actions';
        const status=document.createElement('span'); status.className='computer-user-status';status.setAttribute('role','status');
        for(const [kind,label,icon] of [['copy','Copiar','copy'],['edit','Editar','conversation-rename']]) {
            const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);
            const glyph=document.createElement('i');glyph.style.setProperty('--action-icon',`url('/static/img/icons/${icon}.svg')`);glyph.setAttribute('aria-hidden','true');button.append(glyph);
            button.addEventListener('click',async()=>{
                if(kind==='copy'){try{await navigator.clipboard.writeText(body.textContent);status.textContent='Copiado';}catch{status.textContent='Não foi possível copiar.';}return;}
                if(active||loading||remoteActive||editing||!article.dataset.turn)return;
                const original=body.textContent;
                const editor=document.createElement('div');editor.className='computer-user-editor';
                const text=document.createElement('textarea');text.value=original;text.maxLength=8000;text.setAttribute('aria-label','Editar mensagem');
                const footer=document.createElement('div');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';
                const done=document.createElement('button');done.type='button';done.textContent='Concluído';done.className='computer-user-editor__save';
                const error=document.createElement('p');error.setAttribute('role','alert');
                footer.append(cancel,done);editor.append(text,error,footer);article.append(editor);article.classList.add('is-editing');body.hidden=true;editing=article;
                const close=()=>{editor.remove();article.classList.remove('is-editing');body.hidden=false;editing=null;button.focus();};
                cancel.addEventListener('click',close);text.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
                done.addEventListener('click',async()=>{
                    const value=text.value.trim();if(!value){text.focus();return;}if(value===original){close();return;}
                    if(active||loading||remoteActive)return;
                    done.disabled=cancel.disabled=true;text.disabled=true;loading=true;controls();
                    try{
                        const response=await fetch(`/api/ai/conversations/${currentId}/messages/${article.dataset.turn}/edit`,{method:'POST',credentials:'same-origin',headers:{'X-CSRFToken':document.querySelector('meta[name="csrf-token"]').content}});
                        const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível editar.');
                        const attached=article.attachedFiles||[];editing=null;await loadConversation(result.conversation_id);window.ComputerAttachments?.restore(attached);
                        input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
                        if(ready){form.requestSubmit();}else{recovery('A edição foi preparada. Tente carregar a conversa novamente.');}
                    }catch(failure){loading=false;controls();error.textContent=failure.message;done.disabled=cancel.disabled=false;text.disabled=false;}
                });
                text.focus();text.setSelectionRange(text.value.length,text.value.length);
            });actions.append(button);
        }
        const stamp=document.createElement('time');stamp.className='computer-user-time';stamp.hidden=true;actions.prepend(stamp,status);article.append(actions);
    }
    function addMessage(role, text) {
        const article = document.createElement('article');
        article.className = `computer-message computer-message--${role}`;
        if (role === 'assistant') {
            const label = document.createElement('h2');
            label.textContent = 'Computer';
            article.append(label);
        } else article.setAttribute('aria-label', 'Mensagem enviada');
        const body = document.createElement('div');
        body.className = 'computer-message__text';
        body.textContent = text;
        article.append(body);
        if (role === 'assistant') addActions(article, body); else userActions(article, body);
        conversation.append(article);
        return { article, body };
    }
    function addThinking(assistant) {
        const details = document.createElement('details');
        details.className = 'computer-thinking is-thinking';
        const summary = document.createElement('summary');
        summary.className = 'computer-thinking__toggle';
        const label = document.createElement('span');
        label.textContent = 'Pensando…';
        const arrow = document.querySelector('[data-profile-submenu] > svg').cloneNode(true);
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
        details.addEventListener('toggle', () => { if (details.open) panel.scrollTop = panel.scrollHeight; });
        assistant.article.insertBefore(details, assistant.body);
        assistant.body.hidden = true;
        return { details, label, panel, text };
    }
    function warning(assistant, text) {
        const item = document.createElement('p');
        item.className = 'computer-message__warning';
        item.textContent = text;
        assistant.article.append(item);
    }
    function controls() {
        const busy = !!active;

        const unavailable = loading || !ready || remoteActive;
        form.classList.toggle('is-responding', busy);
        send.disabled = !busy && (unavailable || window.ComputerAttachments?.busy());
        window.ComputerAttachments?.setBusy(busy || unavailable);
        send.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar mensagem');
        send.title = busy ? 'Parar resposta' : 'Enviar mensagem';
        input.readOnly = busy || unavailable;
        microphone.disabled = busy || unavailable;
        conversation.setAttribute('aria-busy', String(busy || remoteActive));
        sessions.setBusy(loading || busy);
        models.setBusy(loading || busy || remoteActive);
        olderButton.disabled = loading || busy || !ready;
    }
    function showConversation() {
        conversation.hidden = !conversation.childElementCount;
        page.classList.toggle('has-conversation', !conversation.hidden);
    }
    function remember(id, title) {
        currentId = id;
        const url = new URL(location.href);
        url.searchParams.delete('new');
        if (id) url.searchParams.set('conversation', id); else url.searchParams.delete('conversation');
        history.replaceState(null, '', url);
        sessions.select(id, title);
    }

    function renderTurns(items, preserveOpen = false) {
        const opened = preserveOpen ? new Set([...conversation.querySelectorAll('[data-turn]')]
            .filter(node => node.querySelector('details')?.open).map(node => node.dataset.turn)) : new Set();
        conversation.replaceChildren();
        for (const turn of items) {
            const user = addMessage('user', turn.message); user.article.dataset.turn=turn.id; messageTime(user.article,turn.created_at); messageAttachments(user.article,turn.attachments);
            const assistant = addMessage('assistant', turn.answer);
            assistant.article.dataset.turn = turn.id;
            if (turn.thinking || turn.status === 'running') {
                const thinking = addThinking(assistant);
                thinking.text.appendData(turn.thinking);
                thinking.details.open = opened.has(turn.id);
                const running = turn.status === 'running' && !turn.answer;
                thinking.details.classList.toggle('is-thinking', running);
                thinking.label.textContent = running ? 'Pensando…' : ['completed', 'running'].includes(turn.status) ? 'Resumo do raciocínio' : 'Pensamento interrompido';
            }
            assistant.body.hidden = !turn.answer;
            if (turn.status === 'interrupted' || turn.status === 'failed') {
                warning(assistant, 'Resposta interrompida. O conteúdo salvo não foi incluído no contexto das próximas mensagens.');
            } else if (turn.status === 'running') warning(assistant, 'Resposta em andamento. O histórico será atualizado automaticamente.');
        }
        showConversation();
    }
    async function listConversations(append = false) {
        const result = await service.list(append ? nextOffset : 0);
        nextOffset = result.next_offset;
        sessions.render(result.conversations, append, nextOffset !== null);
        if (currentId) sessions.select(currentId);
        return result.conversations;
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        if (!remoteActive || leaving) return;
        const id = currentId, version = revision;
        pollTimer = setTimeout(async () => {
            try {
                const result = await service.load(id);
                if (leaving || active || loading || currentId !== id || revision !== version) return;
                const updatedIds = new Set(result.turns.map(turn => turn.id));
                turns = [...turns.filter(turn => !updatedIds.has(turn.id)), ...result.turns];
                remoteActive = result.active;
                renderTurns(turns, true);
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
    async function loadConversation(id) {
        editing = null;
        window.ComputerAttachments?.clear();
        revision++;
        clearTimeout(pollTimer);
        loading = true; ready = false; controls();
        note.textContent = '';
        try {
            const result = await service.load(id);
            remember(result.conversation.id, result.conversation.title);
            turns = result.turns;
            before = result.before;
            olderButton.hidden = !before;
            remoteActive = result.active;
            renderTurns(turns);
            ready = true;
            resetRecovery();
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
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
        resetRecovery();
        editing = null;
        window.ComputerAttachments?.clear();
        revision++;
        clearTimeout(pollTimer);
        remember(null);
        turns = []; before = null; remoteActive = false; ready = true;
        conversation.replaceChildren(); showConversation(); olderButton.hidden = true;
        note.textContent = ''; input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        controls(); input.focus();
    }
    async function initialize() {
        const draft = input.value, previousId = currentId;
        loading = true; ready = false; controls();
        note.textContent = '';
        try {
            const items = await listConversations();
            const requested = new URL(location.href).searchParams.get('conversation');
            const id = new URL(location.href).searchParams.has('new') ? null : requested || items[0]?.id;
            if (id) await loadConversation(id);
            else { loading = false; newConversation(); }
            if (draft && previousId === currentId) { input.value = draft; input.dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (error) {
            recovery(error);
        } finally { loading = false; controls(); }
    }
    window.addEventListener('attachments:changed',controls);
    window.addEventListener('sessions:open', event => { if (!loading && !active) loadConversation(event.detail.id); });
    window.addEventListener('sessions:new', () => { if (!loading && !active) newConversation(); });
    window.addEventListener('sessions:refresh', () => { if (!loading && !active) initialize(); });
    window.addEventListener('sessions:changed', async event => {
        if (event.detail.deleted && event.detail.id === currentId) newConversation();
        try { await listConversations(); } catch (error) { recovery(error); }
    });
    window.addEventListener('sessions:more', async () => {
        if (loading || active) return;
        loading = true; controls();
        try { await listConversations(true); } catch (error) { recovery(error); }
        finally { loading = false; controls(); }
    });
    olderButton.addEventListener('click', async () => {
        loading = true; controls();
        const height = conversation.getBoundingClientRect().height;
        try {
            const result = await service.load(currentId, before);
            turns = [...result.turns, ...turns]; before = result.before;
            renderTurns(turns, true); olderButton.hidden = !before;
            window.scrollBy(0, conversation.getBoundingClientRect().height - height);
        } catch (error) { recovery(error); }
        finally { loading = false; controls(); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (active) { active.abort(); return; }
        if (editing || loading || !ready || remoteActive || microphone.getAttribute('aria-pressed') === 'true') return;
        if(window.ComputerAttachments?.busy())return;
        const attached=window.ComputerAttachments?.files()||[];
        const text = input.value.trim() || (attached.length ? 'Analise os arquivos anexados.' : '');
        if (!text) { input.focus(); return; }
        if (text.length > 8000) { note.textContent = 'Escreva uma mensagem com até 8.000 caracteres.'; return; }
        if(attached.length)models.select('gemini');
        if (models.error()) { note.textContent = models.error(); return; }
        const payload = { conversation_id: currentId, message: text, request_id: crypto.randomUUID(), provider: models.selected() };
        if(attached.length)payload.attachments=attached.map(file=>file.id);
        const user = addMessage('user', text);messageAttachments(user.article,attached);
        let sentAt = new Date().toISOString();messageTime(user.article,sentAt);
        const assistant = addMessage('assistant', '');
        const thinking = addThinking(assistant);
        showConversation(); note.textContent = '';
        input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
        const controller = new AbortController(); active = controller;
        let timedOut = false, answer = '', persisted = false, savedTurnId = null;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 310000);
        controls(); scrollToLatest();
        try {
            await service.chat(payload, delta => {
                const nearBottom = nearLatest();
                answer += delta;
                thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Resumo do raciocínio';
                if (!thinking.text.length) thinking.details.hidden = true;
                assistant.body.hidden = false;
                const reveal = document.createElement('span');
                reveal.className = 'computer-response-reveal';
                reveal.textContent = delta;
                assistant.body.append(reveal);
                note.textContent = '';
                if (nearBottom) scrollToLatest();
            }, controller.signal, delta => {
                thinking.details.hidden = false;
                if (thinking.text.length + delta.length > 48000) throw new Error('O pensamento excedeu o limite. Tente novamente.');
                const follow = thinking.panel.scrollHeight - thinking.panel.scrollTop - thinking.panel.clientHeight < 40;
                thinking.text.appendData(delta);
                if (thinking.details.open && follow) thinking.panel.scrollTop = thinking.panel.scrollHeight;
            }, metadata => {
                persisted = true;
                window.ComputerAttachments?.clear();
                if(metadata.provider)models.select(metadata.provider);
                savedTurnId = metadata.turn_id; user.article.dataset.turn=metadata.turn_id; sentAt=metadata.created_at||sentAt; messageTime(user.article,sentAt);
                assistant.article.dataset.turn = metadata.turn_id;
                remember(metadata.conversation_id, text.slice(0, 100));
            });
            if (!answer.trim()) throw new Error('A resposta veio vazia. Tente novamente.');
            turns.push({ id: savedTurnId, message: text, answer, thinking: thinking.text.data, status: 'completed', created_at:sentAt, attachments:attached });
            note.textContent = '';
        } catch (error) {
            thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento interrompido';
            if (!answer && !thinking.text.length) thinking.details.hidden = true;
            if (!persisted) { user.article.remove(); assistant.article.remove(); showConversation(); }
            else warning(assistant, 'Resposta interrompida. Reabra a conversa para conferir o conteúdo salvo.');
            input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
            note.textContent = timedOut ? 'A resposta demorou mais que o esperado.'
                : error.name === 'AbortError' ? 'Resposta interrompida.' : error.message;
            // Re-read the authoritative history before another send after a connection loss.
            if (persisted) {
                ready = false;
                recovery(note.textContent);
            }
        } finally {
            clearTimeout(timeout); active = null; controls();
            if (!leaving) {
                try { await listConversations(); } catch (error) { recovery(error); }
                input.focus({ preventScroll: true });
            }
        }
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !active) { event.preventDefault(); form.requestSubmit(); }
    });
    window.addEventListener('pagehide', () => { leaving = true; clearTimeout(pollTimer); clearTimeout(recoveryTimer); active?.abort(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; active = null; initialize(); } });
    let syncing = false;
    async function syncHistory() {
        if (document.hidden || editing || loading || active || syncing || leaving) return;
        if (!ready) {
            syncing = true;
            const draft = input.value, id = currentId;
            try {
                await recover();
                if (draft && currentId === id) {
                    input.value = draft;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
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
                    const follow = nearLatest(); turns = merged; renderTurns(turns, true); if (follow) scrollToLatest();
                }
                remoteActive = result.active; controls(); schedulePoll();
            }
            if (recover === syncHistory) note.textContent = '';
            resetRecovery();
        } catch (error) { recovery(error, syncHistory); }
        finally { syncing = false; }
    }
    window.addEventListener('online', syncHistory);
    document.addEventListener('visibilitychange', syncHistory);
    initialize();
})();
