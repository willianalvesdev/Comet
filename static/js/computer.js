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
    let editing = null, anonymous = false;
    if(!document.querySelector('.anonymous-toggle')){
        const button=document.createElement('button');button.type='button';button.className='workspace__header-button anonymous-toggle';button.setAttribute('aria-label','Ativar modo anônimo');button.setAttribute('aria-pressed','false');button.innerHTML='<i aria-hidden="true"></i>';document.querySelector('.computer-header').append(button);
    }
    if(!document.querySelector('.anonymous-note')){const note=document.createElement('p');note.className='anonymous-note';note.hidden=true;note.textContent='Esse chat não será salvo no histórico';form.after(note);}
    const anonymousButton = document.querySelector('.anonymous-toggle');
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

    const jump = document.createElement('button');
    jump.type = 'button'; jump.className = 'computer-jump'; jump.hidden = true;
    jump.setAttribute('aria-label', 'Descer para a última mensagem');
    jump.innerHTML = '<img src="/static/img/icons/scroll-down.svg" alt="">';
    page.append(jump);
    function updateJump() {
        jump.hidden = conversation.hidden || nearLatest();
        const rect = composer.getBoundingClientRect();
        jump.style.left = (rect.left + rect.width / 2 - 16) + 'px';
        jump.style.bottom = Math.max(16, innerHeight - rect.top + 12) + 'px';
    }
    jump.addEventListener('click', () => window.scrollTo({top:document.documentElement.scrollHeight, behavior:'smooth'}));
    window.addEventListener('scroll', updateJump, {passive:true});
    window.addEventListener('resize', updateJump);
    new ResizeObserver(updateJump).observe(composer);
    new ResizeObserver(updateJump).observe(conversation);
    const durationKey = 'ascenda-thinking-' + document.querySelector('[data-user-id]')?.dataset.userId;
    let durations = {};
    try { durations = JSON.parse(localStorage.getItem(durationKey) || '{}'); } catch {}
    function thoughtLabel(seconds) {
        if (!Number.isFinite(seconds)) return 'Pensamento concluído';
        const total = Math.max(1, Math.round(seconds)), minutes = Math.floor(total / 60), rest = total % 60;
        return minutes ? 'Pensou por ' + minutes + (minutes === 1 ? ' minuto e ' : ' minutos e ') + rest + (rest === 1 ? ' segundo' : ' segundos')
            : 'Pensou por ' + total + (total === 1 ? ' segundo' : ' segundos');
    }
    const feedback = new Map();
    function copied(button, glyph, original) {
        clearTimeout(button.copyTimer);
        glyph.style.setProperty('--action-icon', "url('/static/img/icons/check.svg')");
        button.setAttribute('aria-label','Texto copiado');
        button.copyTimer=setTimeout(()=>{glyph.style.setProperty('--action-icon',original);button.setAttribute('aria-label','Copiar');},2200);
    }
    async function rewrite(article) {
        if(active || loading || remoteActive || editing)return;
        const turn=turns.find(item=>item.id===article.dataset.turn);if(!turn)return;
        await submitMessage(turn);
    }
    function addActions(article, body) {
        const actions = document.createElement('div'); actions.className = 'computer-message__actions';
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
                actions.querySelectorAll('[aria-pressed]').forEach(b=>b.setAttribute('aria-pressed','false'));
                button.setAttribute('aria-pressed',String(selected));
                feedback.set(article.dataset.turn || article, selected ? kind : null);
            });
            button.dataset.feedback=kind; actions.append(button);
        }
        const rewriteButton=document.createElement('button');rewriteButton.type='button';rewriteButton.className='computer-rewrite';rewriteButton.setAttribute('aria-label','Reescrever resposta');rewriteButton.title='Reescrever resposta';rewriteButton.innerHTML='<i aria-hidden="true"></i>';rewriteButton.addEventListener('click',()=>rewrite(article));
        actions.append(status,rewriteButton); article.append(actions);
        requestAnimationFrame(()=>{const value=feedback.get(article.dataset.turn || article);if(value)actions.querySelector(`[data-feedback="${value}"]`).setAttribute('aria-pressed','true');});
    }
    function messageAttachments(article, files) {
        article.attachedFiles=files||[];
        article.querySelector('.attachment-list')?.remove();
        if(!files?.length)return;
        const list=document.createElement('div');list.className='attachment-list';
        for(const file of files)list.append(window.ComputerAttachmentCard(file));
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
        article.setAttribute('aria-label', role === 'assistant' ? 'Resposta da IA' : 'Mensagem enviada');
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
        label.textContent = 'Pensando';
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
        const empty = !input.value.trim() && !(window.ComputerAttachments?.files()?.length);
        send.classList.toggle('is-empty', empty && !busy);

        const unavailable = loading || !ready || remoteActive;
        form.classList.toggle('is-responding', busy);
        send.disabled = !busy && (unavailable || window.ComputerAttachments?.busy() || (empty && microphone.getAttribute("aria-pressed") !== "true"));
        window.ComputerAttachments?.setBusy(busy || unavailable || anonymous);
        anonymousButton.hidden = !!currentId || conversation.children.length > 0;
        anonymousButton.disabled = busy || unavailable;
        document.body.classList.toggle('chat-is-empty', conversation.children.length === 0);
        document.querySelector('.chat-tabs').hidden = conversation.children.length === 0;
        conversation.querySelectorAll('.computer-rewrite').forEach(button=>button.disabled=busy||unavailable);
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
        if (id !== currentId) window.ComputerResponseDetails.reset();
        currentId = id;
        document.querySelector(".computer-chat-title").textContent = id ? (title || "") : "";
        document.title = (id ? (title || 'Conversa') : 'Novo chat');
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
                thinking.label.textContent = running ? 'Pensando' : ['completed', 'running'].includes(turn.status) ? thoughtLabel(turn.metadata?.thinking_seconds ?? durations[turn.id]) : 'Pensamento interrompido';
            }
            window.ComputerResponseDetails.research(assistant.article, turn.metadata?.research, turn.status !== 'running');
            window.ComputerResponseDetails.timing(assistant.article, turn.metadata);
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
        setAnonymous(false);
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
        setAnonymous(false);
        window.ComputerResponseDetails.reset();
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
            await listConversations();
            const requested = new URL(location.href).searchParams.get('conversation');
            const id = new URL(location.href).searchParams.has('new') ? null : requested;
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
        else if (event.detail.id === currentId && event.detail.title) remember(currentId, event.detail.title);
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
    form.addEventListener('submit', event => {
        event.preventDefault();
        if(active){active.abort();return;}
        submitMessage();
    });
    async function submitMessage(rewriting = null) {
        if(active)return;
        if (editing || loading || !ready || remoteActive || microphone.getAttribute('aria-pressed') === 'true') return;
        if(window.ComputerAttachments?.busy())return;
        const privateTurn = anonymous, requestRevision = revision;
        const currentRequest=()=>!leaving && revision===requestRevision;
        const attached=rewriting?.attachments || window.ComputerAttachments?.files()||[];
        const text = rewriting ? rewriting.message : input.value.trim() || (attached.length ? 'Analise os arquivos anexados.' : '');
        if (!text) { input.focus(); return; }
        if (text.length > 8000) { note.textContent = 'Escreva uma mensagem com até 8.000 caracteres.'; return; }
        if(attached.length)models.select('gemini');
        if (models.error()) { note.textContent = models.error(); return; }
        const payload = { conversation_id: currentId, message: text, request_id: crypto.randomUUID(), provider: models.selected() };
        if(attached.length)payload.attachments=attached.map(file=>file.id);
        if(rewriting && !privateTurn)payload.regenerate=rewriting.id;
        if(privateTurn){
            const prior=rewriting?turns.slice(0,turns.indexOf(rewriting)):turns;
            let history=prior.filter(t=>t.status==='completed').slice(-19).flatMap(t=>[{role:'user',content:t.message},{role:'assistant',content:t.answer}]);
            while(history.reduce((n,m)=>n+m.content.length,0)+text.length>48000)history.splice(0,2);
            payload.anonymous=true;payload.history=history;payload.conversation_id=null;
        }
        const existingUser=rewriting&&conversation.querySelector(`.computer-message--user[data-turn="${rewriting.id}"]`);
        const user = existingUser ? {article:existingUser} : addMessage('user', text);messageAttachments(user.article,attached);
        let sentAt = new Date().toISOString();messageTime(user.article,sentAt);
        const oldAssistant=rewriting&&conversation.querySelector(`.computer-message--assistant[data-turn="${rewriting.id}"]`);
        const assistant = addMessage('assistant', '');
        if(oldAssistant){oldAssistant.replaceWith(assistant.article);window.ComputerResponseDetails.reset();}
        const thinking = addThinking(assistant);
        showConversation(); note.textContent = '';
        if(!rewriting){input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));}
        const controller = new AbortController(); active = controller;
        let timedOut = false, answer = '', persisted = false, savedTurnId = null;
        let thoughtStart = null, thoughtSeconds = null, responseMeta = {};
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 310000);
        controls(); scrollToLatest();
        try {
            await service.chat(payload, delta => {
                if(!currentRequest())return;
                answer += delta;
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
                savedTurnId = rewriting?.id || metadata.turn_id; user.article.dataset.turn=savedTurnId; sentAt=metadata.created_at||sentAt; messageTime(user.article,sentAt);
                assistant.article.dataset.turn = savedTurnId;
                const chatTitle = currentId === metadata.conversation_id
                    ? document.querySelector('.computer-chat-title').textContent
                    : text.slice(0, 100);
                if(!privateTurn)remember(metadata.conversation_id, chatTitle);
            }, research => {
                if(!currentRequest())return;
                responseMeta.research = research;
                thinking.details.hidden = false;
                thinking.details.classList.add('is-thinking');
                thinking.label.textContent = ['searching','reading'].includes(research.state) ? 'Pesquisando' : 'Pensando';
                window.ComputerResponseDetails.research(assistant.article, research);
            }, metadata => {
                if(!currentRequest())return;
                responseMeta = metadata;
                window.ComputerResponseDetails.research(assistant.article, metadata.research, true);
                window.ComputerResponseDetails.timing(assistant.article, metadata);
                if (thinking.text.length) thinking.label.textContent = thoughtLabel(metadata.thinking_seconds ?? thoughtSeconds);
            });
            if(!currentRequest())return;
            if (!answer.trim()) throw new Error('A resposta veio vazia. Tente novamente.');
            thinking.details.classList.remove('is-thinking');
            thinking.details.hidden = !thinking.text.length;
            if (thinking.text.length) thinking.label.textContent = thoughtLabel(responseMeta.thinking_seconds);
            await revealAnswer(assistant.body, answer, controller.signal);
            if(!currentRequest())return;
            const completed={ id:savedTurnId, message:text, answer, thinking:thinking.text.data, status:'completed', metadata:responseMeta, created_at:sentAt, attachments:attached };
            if(rewriting)turns[turns.indexOf(rewriting)]=completed;else turns.push(completed);
            note.textContent = '';
        } catch (error) {
            if(!currentRequest())return;
            if (responseMeta.research) window.ComputerResponseDetails.research(assistant.article, responseMeta.research, true);
            thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento interrompido';
            if (!answer && !thinking.text.length) thinking.details.hidden = true;
            if(rewriting){renderTurns(turns,true);}
            else if (!persisted) { user.article.remove(); assistant.article.remove(); showConversation(); }
            else warning(assistant, 'Resposta interrompida. Reabra a conversa para conferir o conteúdo salvo.');
            if(!rewriting){input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));}
            note.textContent = timedOut ? 'A resposta demorou mais que o esperado.'
                : error.name === 'AbortError' ? 'Resposta interrompida.' : error.message;
            if (persisted && !rewriting) {
                ready = false;
                recovery(note.textContent);
            }
        } finally {
            clearTimeout(timeout); if(active===controller)active = null; controls();
            if (currentRequest()) {
                try { await listConversations(); } catch (error) { recovery(error); }
                input.focus({ preventScroll: true });
            }
        }
    }
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !active) { event.preventDefault(); form.requestSubmit(); }
    });
    window.addEventListener('pagehide', () => { leaving = true; clearTimeout(pollTimer); clearTimeout(recoveryTimer); active?.abort(); if(anonymous){revision++;turns=[];conversation.replaceChildren();window.ComputerResponseDetails.reset();input.value='';feedback.clear();setAnonymous(false);showConversation();} });
    window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; active = null; initialize(); } });
    let syncing = false;
    async function syncHistory() {
        if (anonymous || document.hidden || editing || loading || active || syncing || leaving) return;
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
    function resizeInput() {
        const style = getComputedStyle(input);
        const line = parseFloat(style.lineHeight) || 24;
        const rows = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--composer-max-lines')) || 10;
        const limit = line * rows + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        input.style.height = 'auto';
        input.style.height = Math.max(38, Math.min(input.scrollHeight, limit)) + 'px';
        input.style.overflowY = input.scrollHeight > limit ? 'auto' : 'hidden';
        controls();
    }
    input.addEventListener('input',resizeInput);
    window.addEventListener('resize',resizeInput);
    async function revealAnswer(body,text,signal) {
        body.hidden = false;
        body.replaceChildren(); let shown=0;
        const speed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--response-characters-per-second')) || 500;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const started = performance.now();
        await new Promise(resolve => {
            function frame(now) {
                const follow = nearLatest();
                const count = reduce || signal.aborted || document.hidden ? text.length : Math.min(text.length, Math.ceil((now-started)*speed/1000));
                if(count>shown){const chunk=document.createElement('span');chunk.className='computer-response-reveal';chunk.textContent=text.slice(shown,count);body.append(chunk);shown=count;}
                if (follow) scrollToLatest();
                if (count === text.length) resolve(); else requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        });
    }
    function setAnonymous(value) {
        anonymous=value;document.body.classList.toggle('is-anonymous',value);
        anonymousButton.setAttribute('aria-pressed',String(value));
        anonymousButton.setAttribute('aria-label',value?'Desativar modo anônimo':'Ativar modo anônimo');
        document.querySelector('.anonymous-note').hidden=!value;
        window.dispatchEvent(new CustomEvent('chat:anonymous',{detail:value}));
        if(value){window.ComputerAttachments?.clear();document.title='Chat anônimo';}else if(!currentId){document.title='Novo chat';}
        controls();
    }
    anonymousButton.addEventListener('click',()=>{if(!active&&!currentId&&!conversation.children.length)setAnonymous(!anonymous);});
    initialize();
    resizeInput();
})();
