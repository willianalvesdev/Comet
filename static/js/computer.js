(() => {
    const page = document.querySelector('.computer-page');
    if (!page) return;
    const form = page.querySelector('form');
    const input = form.querySelector('textarea');
    const send = form.querySelector('.home__send');
    const microphone = form.querySelector('.home__microphone');
    const note = page.querySelector('.computer-note');
    const conversation = page.querySelector('.computer-messages');
    const sessions = window.ComputerSessions;
    const olderButton = page.querySelector('.computer-history__older');
    const service = new window.ComputerService();
    let currentId = null, active = null, loading = true, ready = false, remoteActive = false;
    let nextOffset = null, before = null, turns = [], pollTimer = null, leaving = false, revision = 0;

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
        panel.setAttribute('aria-label', 'Pensamento do Computer');
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
        send.disabled = !busy && unavailable;
        send.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar mensagem');
        send.title = busy ? 'Parar resposta' : 'Enviar mensagem';
        input.readOnly = busy || unavailable;
        microphone.disabled = busy || unavailable;
        conversation.setAttribute('aria-busy', String(busy || remoteActive));
        sessions.setBusy(loading || busy);
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
            addMessage('user', turn.message);
            const assistant = addMessage('assistant', turn.answer);
            assistant.article.dataset.turn = turn.id;
            if (turn.thinking || turn.status === 'running') {
                const thinking = addThinking(assistant);
                thinking.text.appendData(turn.thinking);
                thinking.details.open = opened.has(turn.id);
                const running = turn.status === 'running' && !turn.answer;
                thinking.details.classList.toggle('is-thinking', running);
                thinking.label.textContent = running ? 'Pensando…' : ['completed', 'running'].includes(turn.status) ? 'Pensamento' : 'Pensamento interrompido';
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
                note.textContent = remoteActive ? 'Resposta em andamento…' : 'Conversa atualizada.';
            } catch (error) {
                if (currentId !== id || revision !== version || leaving) return;
                remoteActive = false;
                ready = false;
                note.textContent = error.message + ' Use Atualizar histórico para tentar novamente.';
            }
            controls();
            schedulePoll();
        }, 2000);
    }
    async function loadConversation(id) {
        revision++;
        clearTimeout(pollTimer);
        loading = true; ready = false; controls();
        note.textContent = 'Carregando conversa…';
        try {
            const result = await service.load(id);
            remember(result.conversation.id, result.conversation.title);
            turns = result.turns;
            before = result.before;
            olderButton.hidden = !before;
            remoteActive = result.active;
            renderTurns(turns);
            ready = true;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            note.textContent = remoteActive ? 'Resposta em andamento…' : '';
            form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        } catch (error) {
            sessions.select(currentId);
            note.textContent = error.message + ' Use Atualizar histórico para tentar novamente.';
        } finally {
            loading = false; controls(); schedulePoll();
        }
    }
    function newConversation() {
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
        note.textContent = 'Carregando suas conversas…';
        try {
            const items = await listConversations();
            const requested = new URL(location.href).searchParams.get('conversation');
            const id = new URL(location.href).searchParams.has('new') ? null : requested || items[0]?.id;
            if (id) await loadConversation(id);
            else { loading = false; newConversation(); }
            if (draft && previousId === currentId) { input.value = draft; input.dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (error) {
            note.textContent = error.message + ' Use Atualizar histórico para tentar novamente.';
        } finally { loading = false; controls(); }
    }
    window.addEventListener('sessions:open', event => { if (!loading && !active) loadConversation(event.detail.id); });
    window.addEventListener('sessions:new', () => { if (!loading && !active) newConversation(); });
    window.addEventListener('sessions:refresh', () => { if (!loading && !active) initialize(); });
    window.addEventListener('sessions:changed', async event => {
        if (event.detail.deleted && event.detail.id === currentId) newConversation();
        try { await listConversations(); } catch (error) { note.textContent = error.message; }
    });
    window.addEventListener('sessions:more', async () => {
        if (loading || active) return;
        loading = true; controls();
        try { await listConversations(true); } catch (error) { note.textContent = error.message; }
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
        } catch (error) { note.textContent = error.message; }
        finally { loading = false; controls(); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (active) { active.abort(); return; }
        if (loading || !ready || remoteActive || microphone.getAttribute('aria-pressed') === 'true') return;
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        if (text.length > 8000) { note.textContent = 'Escreva uma mensagem com até 8.000 caracteres.'; return; }
        const payload = { conversation_id: currentId, message: text, request_id: crypto.randomUUID() };
        const user = addMessage('user', text);
        const assistant = addMessage('assistant', '');
        const thinking = addThinking(assistant);
        showConversation(); note.textContent = 'Pensando…';
        input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
        const controller = new AbortController(); active = controller;
        let timedOut = false, answer = '', persisted = false, savedTurnId = null;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 310000);
        controls(); form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        try {
            await service.chat(payload, delta => {
                const nearBottom = form.getBoundingClientRect().bottom <= innerHeight + 120;
                answer += delta;
                thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento';
                if (!thinking.text.length) thinking.details.hidden = true;
                assistant.body.hidden = false; assistant.body.textContent = answer;
                note.textContent = 'Computer está respondendo…';
                if (nearBottom) form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            }, controller.signal, delta => {
                if (answer) throw new Error('A resposta foi interrompida. Tente novamente.');
                if (thinking.text.length + delta.length > 48000) throw new Error('O pensamento excedeu o limite. Tente novamente.');
                const follow = thinking.panel.scrollHeight - thinking.panel.scrollTop - thinking.panel.clientHeight < 40;
                thinking.text.appendData(delta);
                if (thinking.details.open && follow) thinking.panel.scrollTop = thinking.panel.scrollHeight;
            }, metadata => {
                persisted = true;
                savedTurnId = metadata.turn_id;
                assistant.article.dataset.turn = metadata.turn_id;
                remember(metadata.conversation_id, text.slice(0, 100));
            });
            if (!answer.trim()) throw new Error('A resposta veio vazia. Tente novamente.');
            turns.push({ id: savedTurnId, message: text, answer, thinking: thinking.text.data, status: 'completed' });
            note.textContent = 'Resposta concluída e salva.';
        } catch (error) {
            thinking.details.classList.remove('is-thinking'); thinking.label.textContent = 'Pensamento interrompido';
            if (!answer && !thinking.text.length) thinking.details.hidden = true;
            if (!persisted) { user.article.remove(); assistant.article.remove(); showConversation(); }
            else warning(assistant, 'Resposta interrompida. Reabra a conversa para conferir o conteúdo salvo.');
            input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
            note.textContent = timedOut ? 'A resposta demorou mais que o esperado.'
                : error.name === 'AbortError' ? 'Resposta interrompida.' : error.message;
            // Re-read the authoritative history before another send after a connection loss.
            ready = false;
            note.textContent += ' Use Atualizar histórico antes de continuar.';
        } finally {
            clearTimeout(timeout); active = null; controls();
            if (!leaving) {
                try { await listConversations(); } catch { /* The explicit load control can retry. */ }
                input.focus({ preventScroll: true });
            }
        }
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !active) { event.preventDefault(); form.requestSubmit(); }
    });
    window.addEventListener('pagehide', () => { leaving = true; clearTimeout(pollTimer); active?.abort(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; active = null; initialize(); } });
    initialize();
})();
