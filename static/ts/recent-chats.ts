window.WorkspaceNavigation.page('/static/js/recent-chats.js', ({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}) => {
    const page = optionalElement(document, '.recent-chats', HTMLElement);
    if (!page) return;
    const sessions = window.ComputerSessions;
    const list = requiredElement(page, '.recent-chats__list', HTMLElement);
    const status = requiredElement(page, '.recent-chats__status', HTMLElement);
    const retry = requiredElement(page, '.recent-chats__retry', HTMLButtonElement);
    const title = requiredElement(document, '#recent-chats-title', HTMLElement);
    const search = requiredElement(document, '#recent-chats-search', HTMLInputElement);
    const sort = requiredElement(page, 'select', HTMLSelectElement);
    const selectAll = requiredElement(page, '#select-all-chats', HTMLInputElement);
    const menu = requiredElement(page, '#chat-selection-menu', HTMLElement);
    const dialog = requiredElement(document, '.recent-chats__confirm', HTMLDialogElement);
    const selected = new Set<string>();
    let chats: Conversation[] = [], visible: Conversation[] = [], loaded = false, loading = false, deleting = false;
    const relative = new Intl.RelativeTimeFormat('pt-BR', {numeric: 'auto'});
    function timeLabel(value: string) {
        const time = Date.parse(value);
        if (!Number.isFinite(time)) return '';
        const days = Math.floor((Date.now() - time) / 86400000);
        if (days < 1) return 'hoje';
        return relative.format(-days, 'day');
    }
    function updateSelection() {
        const count = visible.filter(chat => selected.has(chat.id)).length;
        selectAll.checked = !!visible.length && count === visible.length;
        selectAll.indeterminate = count > 0 && count < visible.length;
        selectAll.disabled = !loaded || !visible.length;
        title.textContent = selected.size ? `${selected.size} selecionado(s)` : 'Recentes';
        requiredElement(document, '.recent-chats__default-actions', HTMLElement).hidden = selected.size > 0;
        requiredElement(document, '.recent-chats__selection-actions', HTMLElement).hidden = !selected.size;
        list.classList.toggle('has-selection', selected.size > 0);
        for (const row of elementList(list, '.recent-chats__row', HTMLElement)) {
            const checked = selected.has(row.dataset.id || '');
            row.classList.toggle('is-selected', checked);
            requiredElement(row, 'input', HTMLInputElement).checked = checked;
        }
    }
    function render() {
        const query = search.value.trim().toLocaleLowerCase('pt-BR');
        visible = chats.filter(chat => !query || chat.title.toLocaleLowerCase('pt-BR').includes(query));
        visible.sort((a, b) => sort.value === 'title' ? a.title.localeCompare(b.title, 'pt-BR') :
            (Date.parse(a.updated_at) - Date.parse(b.updated_at)) * (sort.value === 'oldest' ? 1 : -1));
        const fragment = document.createDocumentFragment();
        for (const chat of visible) {
            const row = document.createElement('div'); row.className = 'recent-chats__row'; row.dataset.id = chat.id; row.classList.toggle('is-unread', sessions.isUnread(chat));
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'recent-chats__checkbox';
            checkbox.setAttribute('aria-label', `Selecionar ${chat.title}`); checkbox.disabled = !loaded;
            checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(chat.id); else selected.delete(chat.id); updateSelection(); });
            const link = document.createElement('a'); link.className = 'recent-chats__link'; link.href = '/computer.html?conversation=' + encodeURIComponent(chat.id);
            const kind = document.createElement('span'); kind.className = 'recent-chats__kind'; kind.textContent = 'Chat'; if (sessions.isUnread(chat)) kind.setAttribute('aria-label', 'Resposta não lida');
            const name = document.createElement('span'); name.className = 'recent-chats__name'; name.textContent = chat.title; name.title = chat.title;
            const time = document.createElement('time'); time.dateTime = chat.updated_at; time.textContent = timeLabel(chat.updated_at);
            link.append(kind, name, time);
            const pin = document.createElement('i'); pin.className = 'sessions-icon recent-chats__pin'; pin.hidden = !sessions.isPinned(chat.id); pin.setAttribute('aria-label', 'Fixado');
            const more = document.createElement('button'); more.type = 'button'; more.className = 'recent-chats__more'; more.setAttribute('aria-label', `Opções de ${chat.title}`);
            more.setAttribute('aria-controls', 'sessions-menu'); more.setAttribute('aria-expanded', 'false');
            more.innerHTML = '<i class="sessions-icon sessions-icon--more" aria-hidden="true"></i>';
            more.addEventListener('click', () => sessions.openOptions(chat, more));
            const actions = document.createElement('div'); actions.className = 'recent-chats__row-actions';
            actions.append(pin, more); row.append(checkbox, link, actions); fragment.append(row);
        }
        list.replaceChildren(fragment);
        if (loaded) status.textContent = visible.length ? '' : chats.length ? 'Nenhuma conversa encontrada.' : 'Você ainda não tem conversas.';
        updateSelection();
    }
    async function load() {
        if (loading) return;
        loading = true; loaded = false; retry.hidden = true; status.textContent = 'Carregando conversas…'; list.setAttribute('aria-busy', 'true');
        chats = []; selected.clear(); render();
        try {
            let offset: number | null = 0;
            do {
                const result = conversationsData(await sessions.request('/api/ai/conversations?offset=' + offset));
                chats.push(...result.conversations);
                offset = result.next_offset;
            } while (offset !== null);
            loaded = true; render();
        } catch (error) { status.textContent = errorMessage(error); retry.hidden = false; }
        finally { loading = false; list.setAttribute('aria-busy', 'false'); }
    }
    function selectVisible(all: boolean) {
        if (!loaded) return;
        for (const chat of visible) { if (all) selected.add(chat.id); else selected.delete(chat.id); }
        updateSelection();
    }
    selectAll.addEventListener('change', () => selectVisible(selectAll.checked));
    requiredElement(page, '[popovertarget]', HTMLElement).addEventListener('click', event => {
        const rect = present(eventElement(event.currentTarget)).getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 208)) + 'px'; menu.style.top = rect.bottom + 6 + 'px';
    });
    menu.addEventListener('click', event => {
        const button = eventElement(event.target)?.closest<HTMLElement>('[data-select]'); if (!button) return;
        if (button.dataset.select === 'all') selectVisible(true);
        else { selected.clear(); updateSelection(); }
        menu.hidePopover();
    });
    requiredElement(document, '.recent-chats__cancel', HTMLElement).addEventListener('click', () => { selected.clear(); updateSelection(); });
    requiredElement(document, '.recent-chats__search-toggle', HTMLButtonElement).addEventListener('click', event => {
        requiredElement(document, '.recent-chats__search-toggle', HTMLButtonElement).hidden = true; present(eventElement(event.currentTarget)).setAttribute('aria-expanded', 'true'); present(search.closest('label')).hidden = false; search.focus();
    });
    search.addEventListener('input', render); sort.addEventListener('change', render);
    retry.addEventListener('click', load);
    requiredElement(document, '.recent-chats__delete', HTMLElement).addEventListener('click', () => {
        if (!selected.size) return;
        requiredElement(dialog, '.recent-chats__delete-description', HTMLElement).textContent = `Excluir permanentemente ${selected.size} conversa(s)? Essa ação não pode ser desfeita.`;
        requiredElement(dialog, '[role="alert"]', HTMLElement).textContent = ''; dialog.showModal(); requiredElement(dialog, '[data-cancel]', HTMLElement).focus();
    });
    requiredElement(dialog, '[data-cancel]', HTMLElement).addEventListener('click', () => { if (!deleting) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
    requiredElement(dialog, 'form', HTMLFormElement).addEventListener('submit', async event => {
        event.preventDefault(); if (deleting) return;
        deleting = true; elementList(dialog, 'button', HTMLButtonElement).forEach(button => button.disabled = true);
        const failures = [];
        for (const id of [...selected]) {
            try {
                await sessions.request('/api/ai/conversations/' + encodeURIComponent(id), 'DELETE');
                window.dispatchEvent(new CustomEvent('sessions:changed', {detail: {id, deleted: true}}));
            } catch (error) { failures.push(errorMessage(error)); }
        }
        deleting = false; elementList(dialog, 'button', HTMLButtonElement).forEach(button => button.disabled = false);
        if (!failures.length) dialog.close();
        else {
            requiredElement(dialog, '[role="alert"]', HTMLElement).textContent = `${failures.length} conversa(s) não foram excluídas. ${failures[0]}`;
            requiredElement(dialog, '.recent-chats__delete-description', HTMLElement).textContent = 'As conversas não excluídas continuam selecionadas. Você pode tentar novamente.';
        }
    });
    scope.listen(window, 'sessions:changed', event => {
        const {id, deleted, title} = event.detail;
        if (deleted) { chats = chats.filter(chat => chat.id !== id); selected.delete(id); }
        else if (title) { const chat = chats.find(chat => chat.id === id); if (chat) chat.title = title; }
        render();
    });
    scope.listen(window, 'sessions:pins', render);
    scope.listen(window, 'sessions:read', render);
    load();
});
