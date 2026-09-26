(() => {
    const toggle = document.querySelector('.sidebar__toggle');
    if (!toggle) return;
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'sidebar__search';
    trigger.title = 'Pesquisar chats'; trigger.setAttribute('aria-label', 'Pesquisar chats');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.innerHTML = '<i class="chat-search__icon" aria-hidden="true"></i>';
    toggle.before(trigger);
    const dialog = document.createElement('dialog');
    dialog.className = 'chat-search'; dialog.setAttribute('aria-label', 'Pesquisar chats');
    dialog.innerHTML = '<div class="chat-search__field"><i class="chat-search__icon" aria-hidden="true"></i><input type="search" placeholder="Pesquisar chats" aria-label="Pesquisar chats" maxlength="100" autocomplete="off"></div><div class="chat-search__body"><h2>Chats</h2><p class="chat-search__status" role="status"></p><div class="chat-search__results"></div><button class="chat-search__more" type="button" hidden>Mostrar mais</button></div>';
    document.body.append(dialog);
    const input = dialog.querySelector('input'), results = dialog.querySelector('.chat-search__results');
    const status = dialog.querySelector('.chat-search__status'), more = dialog.querySelector('.chat-search__more');
    const body = dialog.querySelector('.chat-search__body');
    let controller, timer, nextOffset = null, version = 0;
    async function search(append = false) {
        controller?.abort(); controller = new AbortController();
        const current = ++version;
        more.hidden = true; status.textContent = 'Buscando…';
        results.setAttribute('aria-busy', 'true');
        if (!append) { results.replaceChildren(); body.scrollTop = 0; }
        try {
            const query = new URLSearchParams({q: input.value.trim(), offset: String(append ? nextOffset : 0)});
            const response = await fetch('/api/ai/conversations?' + query, {credentials:'same-origin', cache:'no-store', signal:controller.signal});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Não foi possível pesquisar seus chats.');
            if (current !== version || !dialog.open) return;
            for (const chat of data.conversations) {
                const link = document.createElement('a');
                link.className = 'chat-search__result';
                link.href = '/computer.html?conversation=' + encodeURIComponent(chat.id);
                link.textContent = chat.title; link.title = chat.title;
                results.append(link);
            }
            nextOffset = data.next_offset; more.hidden = nextOffset === null;
            status.textContent = results.childElementCount ? '' : input.value.trim() ? 'Nenhum chat encontrado.' : 'Você ainda não tem chats.';
        } catch (error) {
            if (error.name !== 'AbortError' && current === version) status.textContent = error.message || 'Não foi possível pesquisar seus chats.';
        } finally {
            if (current === version) results.setAttribute('aria-busy', 'false');
        }
    }
    trigger.addEventListener('click', () => { dialog.showModal(); input.value = ''; input.focus(); search(); });
    input.addEventListener('input', () => {
        clearTimeout(timer); controller?.abort(); version++;
        results.replaceChildren(); more.hidden = true; status.textContent = 'Buscando…';
        timer = setTimeout(() => search(), 180);
    });
    more.addEventListener('click', () => search(true));
    dialog.addEventListener('close', () => { clearTimeout(timer); controller?.abort(); version++; trigger.focus({preventScroll:true}); });
    dialog.addEventListener('click', event => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); return; }
        const links = [...results.querySelectorAll('a')];
        if (event.target === input && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); links[0]?.click(); }
        if (!['ArrowDown','ArrowUp'].includes(event.key) || !links.length) return;
        event.preventDefault();
        const index = links.indexOf(document.activeElement);
        if (event.key === 'ArrowUp' && index <= 0) input.focus();
        else links[Math.min(links.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    });
})();
