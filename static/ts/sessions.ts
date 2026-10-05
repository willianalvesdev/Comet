(() => {
    const nav = optionalElement(document, '.sidebar__nav', HTMLElement);
    if (!nav) return;
    const inComputer = () => !!optionalElement(document, '.computer-page', HTMLElement);
    const items = new Map<string,Conversation>();
    let drawn = false;
    let selected = new URL(location.href).searchParams.get('conversation'), busy = false, nextOffset: number | null = null, target: Conversation | null = null, opener: HTMLElement | null = null;
    const section = document.createElement('details');
    section.className = 'sessions'; section.open = true;
    section.innerHTML = `<summary>Recentes<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><div class="sessions__list"></div><p class="sessions__status" role="status"></p><div class="sessions__tools"><button type="button" data-action="more" hidden>Mais chats</button><button type="button" data-action="refresh" hidden>Tentar novamente</button></div>`;
    const pinKey = 'ascenda-pinned-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    const stateKey = 'ascenda-sidebar-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    let savedState: Record<string,unknown> = {};
    try { savedState = record(JSON.parse(sessionStorage.getItem(stateKey) || '{}')); } catch {}
    let pins: Record<string,Conversation> = {};
    try { pins = Object.fromEntries(Object.entries(record(JSON.parse(localStorage.getItem(pinKey) || '{}'))).map(([id,item])=>[id,conversationData(item)])); } catch {}
    const pinned = document.createElement('details');
    pinned.className = 'sessions'; pinned.open = true;
    pinned.innerHTML = section.innerHTML;
    present(requiredElement(pinned, 'summary', HTMLElement).firstChild).textContent = 'Fixados';
    requiredElement(pinned, '.sessions__tools', HTMLElement).remove();
    requiredElement(pinned, '.sessions__status', HTMLElement).remove();
    function configureHeading(container: HTMLDetailsElement, label: string, id: string, href: string | null, open: unknown) {
        const summary = requiredElement(container, 'summary', HTMLElement);
        summary.tabIndex = -1;
        summary.replaceChildren();
        const heading = document.createElement('button');
        heading.type = 'button'; heading.className = 'sessions__heading';
        const text = document.createElement('span'); text.textContent = label;
        const chevron = document.createElement('i'); chevron.className = 'sessions__chevron'; chevron.setAttribute('aria-hidden', 'true');
        heading.append(text, chevron); heading.setAttribute('aria-controls', id);
        const visit = document.createElement('a'); visit.className = 'sessions__visit'; visit.href = href || '/recentes.html';
        visit.setAttribute('aria-label', 'Abrir página de recentes'); visit.innerHTML = '<i aria-hidden="true"></i>';
        const preferences = document.createElement('button'); preferences.type = 'button'; preferences.className = 'sessions__preferences';
        preferences.setAttribute('aria-label', 'Preferências de ' + label.toLowerCase()); preferences.innerHTML = '<i aria-hidden="true"></i>';
        summary.append(heading);
        if (href) summary.append(visit, preferences);
        requiredElement(container, '.sessions__list', HTMLElement).id = id;
        container.open = open !== false;
        function sync() {
            heading.setAttribute('aria-expanded', String(container.open));
            heading.setAttribute('aria-label', (container.open ? 'Recolher ' : 'Expandir ') + label.toLowerCase());
        }
        summary.addEventListener('click', event => {
            if (eventElement(event.target)?.closest('a')) return;
            event.preventDefault();
            if (eventElement(event.target)?.closest('.sessions__heading')) { container.open = !container.open; sync(); }
        });
        container.addEventListener('toggle', sync); sync();
    }
    configureHeading(section, 'Recentes', 'recent-chats', '/recentes.html', savedState.recentOpen);
    configureHeading(pinned, 'Fixados', 'pinned-chats', null, savedState.pinnedOpen);
    type RecentOrder = 'name' | 'created' | 'activity';
    const orderKey = pinKey.replace('pinned', 'recent-order');
    let order: RecentOrder = 'activity';
    try {
        const saved = localStorage.getItem(orderKey);
        if (saved === 'name' || saved === 'created' || saved === 'activity') order = saved;
    } catch {}
    function sortedRecent(chats: Conversation[]): Conversation[] {
        return chats.sort((a, b) => {
            if (order === 'name') return a.title.localeCompare(b.title, 'pt-BR', {sensitivity:'base', numeric:true});
            const timestamp = (chat: Conversation) => Date.parse(order === 'created' ? chat.created_at : chat.updated_at) || 0;
            return timestamp(b) - timestamp(a);
        });
    }
    const preferences = requiredElement(section, '.sessions__preferences', HTMLButtonElement);
    const sortMenu = document.createElement('div');
    sortMenu.className = 'sessions-sort'; sortMenu.id = 'sessions-sort';
    sortMenu.setAttribute('popover', 'auto'); sortMenu.setAttribute('role', 'menu');
    sortMenu.setAttribute('aria-label', 'Ordenar recentes');
    sortMenu.innerHTML = '<p>Ordenar por</p>';
    const sortOptions: [RecentOrder, string][] = [['name','Nome'],['created','Recém-criados'],['activity','Última atividade']];
    for (const [value, label] of sortOptions) {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('role', 'menuitemradio'); button.dataset.order = value;
        const text = document.createElement('span'); text.textContent = label;
        const check = document.createElement('i'); check.setAttribute('aria-hidden', 'true');
        button.append(text, check); sortMenu.append(button);
        button.addEventListener('click', () => {
            order = value;
            try { localStorage.setItem(orderKey, order); } catch {}
            syncOrder(); draw(); sortMenu.hidePopover(); preferences.focus();
        });
    }
    function syncOrder() {
        elementList(sortMenu, 'button', HTMLButtonElement).forEach(button => button.setAttribute('aria-checked', String(button.dataset.order === order)));
    }
    syncOrder(); document.body.append(sortMenu);
    preferences.setAttribute('aria-label', 'Ordenar recentes'); preferences.setAttribute('aria-haspopup', 'menu');
    preferences.setAttribute('aria-controls', sortMenu.id); preferences.setAttribute('aria-expanded', 'false');
    preferences.addEventListener('click', () => {
        if (sortMenu.matches(':popover-open')) { sortMenu.hidePopover(); return; }
        sortMenu.showPopover();
        const rect = preferences.getBoundingClientRect();
        sortMenu.style.left = Math.max(8, Math.min(rect.left, innerWidth - sortMenu.offsetWidth - 8)) + 'px';
        sortMenu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - sortMenu.offsetHeight - 8)) + 'px';
        requiredElement(sortMenu, '[aria-checked="true"]', HTMLButtonElement).focus();
    });
    sortMenu.addEventListener('toggle', () => preferences.setAttribute('aria-expanded', String(sortMenu.matches(':popover-open'))));
    sortMenu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); sortMenu.hidePopover(); preferences.focus(); }
        const buttons = elementList(sortMenu, 'button', HTMLButtonElement);
        const index = buttons.findIndex(button => button === document.activeElement);
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus();
        }
        if (event.key === 'Tab') sortMenu.hidePopover();
    });
    window.addEventListener('resize', () => { if (sortMenu.matches(':popover-open')) sortMenu.hidePopover(); });
    const pinList = optionalElement(pinned, '.sessions__list', HTMLElement);
    nav.append(pinned, section);
    const recentsButton=document.createElement('button');recentsButton.type='button';recentsButton.className='sidebar-recents';
    recentsButton.setAttribute('aria-label','Recentes');recentsButton.setAttribute('aria-expanded','false');recentsButton.innerHTML='<i aria-hidden="true"></i>';
    nav.insertBefore(recentsButton,pinned);
    const recentMenu=document.createElement('div');recentMenu.className='recents-popover';recentMenu.setAttribute('popover','auto');recentMenu.setAttribute('aria-label','Recentes');
    recentMenu.innerHTML='<a class="recents-popover__heading" href="/recentes.html">Recentes</a><div class="recents-popover__list"></div>';
    document.body.append(recentMenu);let recentTimer = 0;
    function closeRecents(){clearTimeout(recentTimer);if(recentMenu.matches(':popover-open'))recentMenu.hidePopover();}
    function openRecents(){
        clearTimeout(recentTimer);
        if(!document.body.classList.contains('is-sidebar-collapsed')||innerWidth<640)return;
        recentMenu.showPopover();const rect=recentsButton.getBoundingClientRect();
        recentMenu.style.left=Math.min(requiredElement(document, '.sidebar', HTMLElement).getBoundingClientRect().right+4,innerWidth-332)+'px';
        recentMenu.style.top=Math.max(8,Math.min(rect.top,innerHeight-270))+'px';
    }
    function delayClose(){recentTimer=setTimeout(()=>{if(!recentMenu.contains(document.activeElement)&&document.activeElement!==recentsButton)closeRecents();},160);}
    recentsButton.addEventListener('pointerenter',openRecents);recentsButton.addEventListener('pointerleave',delayClose);
    recentsButton.addEventListener('focus',openRecents);recentsButton.addEventListener('blur',delayClose);
    recentsButton.addEventListener('click',()=>{window.WorkspaceNavigation.go('/recentes.html');});
    recentMenu.addEventListener('pointerenter',()=>clearTimeout(recentTimer));recentMenu.addEventListener('pointerleave',delayClose);recentMenu.addEventListener('focusout',delayClose);
    recentMenu.addEventListener('toggle',()=>recentsButton.setAttribute('aria-expanded',String(recentMenu.matches(':popover-open'))));
    recentMenu.addEventListener('click',event=>{
        const link=eventElement(event.target)?.closest<HTMLElement>('[data-chat-id]');if(!link)return;
        if(busy){event.preventDefault();return;}
        closeRecents();if(inComputer()){event.preventDefault();emit('open',{id:link.dataset.chatId});}
    });
    new MutationObserver(closeRecents).observe(document.body,{attributes:true,attributeFilter:['class']});
    function drawRecents(){
        const container=optionalElement(recentMenu, '.recents-popover__list', HTMLElement), fragment=document.createDocumentFragment();
        for(const item of sortedRecent([...items.values()])){
            const link=document.createElement('a');link.href='/computer.html?conversation='+encodeURIComponent(item.id);link.dataset.chatId=item.id;link.textContent=item.title||'Conversa';
            if(item.id===selected)link.setAttribute('aria-current','page');fragment.append(link);
        }
        if(!items.size){const empty=document.createElement('p');empty.textContent='Nenhum chat recente';fragment.append(empty);}
        present(container).replaceChildren(fragment);
    }
    function savePins() { try { localStorage.setItem(pinKey, JSON.stringify(pins)); } catch {} }

    const list = requiredElement(section, '.sessions__list', HTMLElement), status = requiredElement(section, '.sessions__status', HTMLElement);
    const more = requiredElement(section, '[data-action="more"]', HTMLElement);
    const menu = document.createElement('div');
    menu.className = 'sessions-menu'; menu.id = 'sessions-menu'; menu.setAttribute('popover','auto');
    menu.setAttribute('aria-label','Opções da conversa');
    menu.innerHTML = '<button type="button" data-action="pin"><i class="sessions-icon sessions-icon--pin" aria-hidden="true"></i><span>Fixar</span></button><button type="button" data-action="rename"><i class="sessions-icon sessions-icon--rename" aria-hidden="true"></i>Renomear</button><button type="button" class="sessions-menu__delete" data-action="delete"><i class="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Apagar</button>';
    requiredElement(document, '.sidebar', HTMLElement).append(menu);
    const dialog = document.createElement('dialog');
    dialog.className = 'sessions-dialog';
    dialog.setAttribute('aria-labelledby','sessions-dialog-title');
    dialog.innerHTML = '<form><h2 id="sessions-dialog-title"></h2><p class="sessions-dialog__description"></p><p class="sessions-dialog__error" role="alert"></p><div><button type="button" data-cancel>Cancelar</button><button type="submit" data-confirm>Salvar</button></div></form>';
    document.body.append(dialog);
    let action: string | undefined, changing = false;
    const error = requiredElement(dialog, '.sessions-dialog__error', HTMLElement);
    function emit(name: string | undefined, detail: Record<string,unknown> = {}) { window.dispatchEvent(new CustomEvent('sessions:' + name, {detail})); }
    function closeMobile() { if (matchMedia('(width < 640px)').matches && !document.body.classList.contains('is-sidebar-collapsed')) requiredElement(document, '.sidebar__toggle', HTMLButtonElement).click(); }
    async function request(path: string, method = 'GET', data?: unknown):Promise<unknown> {
        const csrf = optionalElement(document, 'meta[name="csrf-token"]', HTMLMetaElement)?.content || optionalElement(document, '[name="csrf_token"]', HTMLInputElement)?.value || '';
        const response = await fetch(path, {method, credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json','X-CSRFToken':csrf}, body:data ? JSON.stringify(data) : undefined});
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(result,'Não foi possível atualizar as sessões.'));
        return result;
    }
    function renameInline(item: Conversation) {
        const candidate = opener?.closest<HTMLElement>('.sessions__row, .recent-chats__row');
        if (!candidate) return;
        const row = candidate;
        const link = requiredElement(row, '.sessions__link, .recent-chats__link', HTMLAnchorElement);
        const input = document.createElement('input');
        input.className = 'sessions-rename'; input.value = item.title; input.maxLength = 100;
        input.setAttribute('aria-label', 'Nome da sessão'); input.autocomplete = 'off';
        row.classList.add('is-renaming'); link.replaceWith(input);
        let finished = false, saving = false;
        function cancel() {
            if (finished || saving) return;
            finished = true; input.replaceWith(link); row.classList.remove('is-renaming'); link.focus();
        }
        async function save() {
            if (finished || saving) return;
            const title = input.value.trim();
            if (!title || title === item.title) { cancel(); return; }
            saving = true; input.readOnly = true;
            try {
                const result = record(await request(`/api/ai/conversations/${item.id}`, 'PATCH', {title}));
                const updated = {...item, title: stringValue(result.title)};
                items.set(item.id, updated); if (pins[item.id]) pins[item.id] = updated;
                finished = true; input.replaceWith(link); row.classList.remove('is-renaming');
                savePins(); draw(); emit('changed', {id:item.id, deleted:false, title:updated.title});
                if (!inComputer()) await load();
            } catch (failure) {
                input.setCustomValidity(errorMessage(failure)); input.reportValidity(); input.focus();
            } finally { saving = false; input.readOnly = false; }
        }
        input.addEventListener('input', () => input.setCustomValidity(''));
        input.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); void save(); }
            if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => { void save(); });
        input.focus(); input.select();
    }
    function openOptions(item: Conversation, options: HTMLElement) {
        if (menu.matches(':popover-open') && opener === options) { menu.hidePopover(); return; }
        if (menu.matches(':popover-open')) menu.hidePopover();
        target = item; opener = options;
        requiredElement(menu, '[data-action="pin"] span', HTMLElement).textContent = pins[item.id] ? 'Desafixar' : 'Fixar';
        requiredElement(menu, '[data-action="pin"] i', HTMLElement).classList.toggle('sessions-icon--unpin', Boolean(pins[item.id]));
        const rect = options.getBoundingClientRect();
        const sidebarBounds = requiredElement(document, '.sidebar', HTMLElement).getBoundingClientRect();
        menu.style.width = Math.max(0, sidebarBounds.width - 20) + 'px';
        menu.showPopover();
        const bounds = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(sidebarBounds.left + (sidebarBounds.width - bounds.width) / 2, innerWidth - bounds.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8)) + 'px';
        options.setAttribute('aria-expanded','true'); requiredElement(menu, 'button', HTMLButtonElement).focus({preventScroll:true});
    }
    function draw() {
        drawRecents();
        const recentRows = document.createDocumentFragment(), pinnedRows = document.createDocumentFragment();
        const combined = new Map([...Object.values(pins).map(item => [item.id, item] satisfies [string,Conversation]), ...items]);
        const chats = [...combined.values()];
        for (const item of [...chats.filter(chat => pins[chat.id]), ...sortedRecent(chats.filter(chat => !pins[chat.id]))]) {
            const row = document.createElement('div'); row.className = 'sessions__row'; row.dataset.id = item.id;
            const link = document.createElement('a'); link.className = 'sessions__link'; link.href = `/computer.html?conversation=${encodeURIComponent(item.id)}`;
            link.title = item.title;
            const titleViewport = document.createElement('span'); titleViewport.className = 'sessions__title';
            const titleText = document.createElement('span'); titleText.textContent = item.title;
            titleViewport.append(titleText); link.append(titleViewport);
            function stopTitleScroll() { titleText.classList.remove('is-scrolling'); }
            function scrollTitle() {
                stopTitleScroll();
                if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                if (titleText.scrollWidth <= titleViewport.clientWidth - 32) return;
                const distance = Math.max(0, titleText.scrollWidth - titleViewport.clientWidth + 60);
                titleText.style.setProperty('--title-scroll-distance', `${-distance}px`);
                titleText.style.setProperty('--title-scroll-duration', `${Math.max(2, distance / 28)}s`);
                titleText.classList.add('is-scrolling');
            }
            row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') scrollTitle(); });
            row.addEventListener('pointerleave', stopTitleScroll);
            row.addEventListener('focusin', scrollTitle);
            row.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) stopTitleScroll(); });
            if (item.id === selected && inComputer()) link.setAttribute('aria-current','page');
            link.addEventListener('click', event => {
                if (!inComputer() || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); if (busy) return;
                emit('open', {id:item.id}); closeMobile();
            });
            const options = document.createElement('button'); options.type = 'button'; options.className = 'sessions__more';
            options.innerHTML = '<i class="sessions-icon sessions-icon--more" aria-hidden="true"></i>';
            options.setAttribute('aria-label', `Opções de ${item.title}`); options.setAttribute('aria-expanded','false'); options.setAttribute('aria-controls',menu.id); options.disabled = busy;
            options.addEventListener('click', () => openOptions(item, options));
            row.append(link,options); (pins[item.id] ? pinnedRows : recentRows).append(row);
            if (pins[item.id]) pins[item.id] = item;
        }
        list.replaceChildren(recentRows); present(pinList).replaceChildren(pinnedRows);
        pinned.hidden = !present(pinList).children.length; savePins();
        status.textContent = list.children.length ? '' : 'Nenhuma conversa recente.';
        drawn = true;
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.matches(':popover-open')) { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); opener?.focus({preventScroll:true}); } }, true);
    menu.addEventListener('toggle', event => { if (event.newState === 'closed') opener?.setAttribute('aria-expanded','false'); });
    window.addEventListener('resize', () => { if (menu.matches(':popover-open')) menu.hidePopover(); });
    menu.addEventListener('click', event => {
        const button = eventElement(event.target)?.closest('button'); if (!button || !target) return;
        action = button.dataset.action; menu.hidePopover();
        if (action === 'pin') {
            if (pins[target.id]) delete pins[target.id]; else pins[target.id] = target;
            savePins(); draw(); emit('pins'); return;
        }
        if (action === 'rename') { renameInline(target); return; }
        requiredElement(dialog, 'h2', HTMLElement).textContent = 'Excluir sessão?';
        dialog.classList.add('sessions-dialog--delete');
        const description = requiredElement(dialog, '.sessions-dialog__description', HTMLElement);
        description.replaceChildren();
        if (action === 'delete') {
            description.append(document.createTextNode('Isso excluirá permanentemente a sessão:'));
            const title = document.createElement('strong'); title.textContent = target.title;
            description.append(title);
        }
        requiredElement(dialog, '[data-confirm]', HTMLElement).textContent = action === 'rename' ? 'Salvar' : 'Excluir';
        requiredElement(dialog, '[data-confirm]', HTMLElement).classList.toggle('sessions-menu__delete', action === 'delete');
        error.textContent = ''; dialog.showModal();
        requiredElement(dialog, '[data-cancel]', HTMLElement).focus();
    });
    requiredElement(dialog, '[data-cancel]', HTMLElement).addEventListener('click', () => { if (!changing) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (changing) event.preventDefault(); });
    dialog.addEventListener('close', () => { (opener?.isConnected ? opener : requiredElement(section, 'summary', HTMLElement)).focus(); });
    requiredElement(dialog, 'form', HTMLFormElement).addEventListener('submit', async event => {
        event.preventDefault(); if (changing || !target) return;
        changing = true; elementList(dialog, 'button', HTMLButtonElement).forEach(button=>button.disabled=true); error.textContent = '';
        try {
            const id = target.id, deleted = action === 'delete';
            const result = record(await request(`/api/ai/conversations/${id}`, deleted ? 'DELETE' : 'PATCH', undefined));
            if (deleted) { items.delete(id); delete pins[id]; }
            else { items.set(id, {...target, title:stringValue(result.title)}); if (pins[id]) pins[id] = present(items.get(id)); }
            savePins();
            dialog.close(); draw(); emit('changed',{id,deleted,title:optionalString(result.title)});
            if (!inComputer()) await load();
        } catch (failure) { error.textContent = errorMessage(failure); }
        finally { changing=false; elementList(dialog, 'button', HTMLButtonElement).forEach(button=>button.disabled=false); }
    });
    requiredElement(section, '.sessions__tools', HTMLElement).addEventListener('click', async event => {
        const button = eventElement(event.target)?.closest('button'); if (!button || busy) return;
        const command=button.dataset.action;
        if (inComputer()) { emit(command); if (command==='new') closeMobile(); }
        else if(command==='new') window.WorkspaceNavigation.go('/computer.html?new=1');
        else await load(command==='more');
    });
    function render(data: Conversation[], append=false, hasMore=false) {
        const unchanged = !append && JSON.stringify([...items.values()]) === JSON.stringify(data);
        if (!append) items.clear(); data.forEach(item=>items.set(item.id,item));
        requiredElement(section, '[data-action="refresh"]', HTMLElement).hidden=true;
        more.hidden=!hasMore; if (!unchanged || !drawn) draw();
    }
    function markSelected(link: HTMLElement, active: boolean) {
        if(active===link.hasAttribute('aria-current'))return;
        if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    function select(id: string | null,title?: string) {
        selected=id;
        markSelected(requiredElement(document, '.sidebar__new-chat .sidebar__link', HTMLElement), inComputer() && !id);
        if(id&&!items.has(id)) { items.set(id,{id,title:title||'Conversa atual',created_at:'',updated_at:''}); draw(); return; }
        if(!drawn) { draw(); return; }
        elementList(present(nav), '.sessions__link', HTMLAnchorElement).forEach(link=>markSelected(link,inComputer()&&link.closest<HTMLElement>('.sessions__row')?.dataset.id===id));
        elementList(recentMenu, '[data-chat-id]', HTMLElement).forEach(link=>markSelected(link,link.dataset.chatId===id));
    }
    function setBusy(value: boolean) { if(busy===value)return; busy=value; elementList(present(nav), '.sessions button', HTMLButtonElement).forEach(button=>button.disabled=value); }
    async function load(append=false) {
        setBusy(true);
        try { const result=conversationsData(await request(`/api/ai/conversations?offset=${append ? nextOffset : 0}`)); nextOffset=result.next_offset; render(result.conversations,append,nextOffset!==null); }
        catch(failure) { status.textContent='Não foi possível carregar os chats.'; requiredElement(section, '[data-action="refresh"]', HTMLElement).hidden=false; }
        finally { setBusy(false); }
    }
    window.ComputerSessions={render,select,setBusy,openOptions,request,isPinned:id=>!!pins[id]};
    if (Array.isArray(savedState.chats)) {
        nextOffset = typeof savedState.nextOffset === 'number' ? savedState.nextOffset : null;
        render(arrayValue(savedState.chats,conversationData), false, nextOffset !== null);
        nav.scrollTop = typeof savedState.scrollTop === 'number' ? savedState.scrollTop : 0;
    }
    let loggingOut = false;
    window.addEventListener('pagehide', () => {
        if (loggingOut) return;
        try {
            sessionStorage.setItem(stateKey, JSON.stringify({
                recentOpen: section.open, pinnedOpen: pinned.open, scrollTop: nav.scrollTop,
                collapsed: document.body.classList.contains('is-sidebar-collapsed'),
                chats: [...items.values()], nextOffset
            }));
        } catch {}
    });
    document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement && new URL(event.target.action, location.href).pathname === '/logout') {
            loggingOut = true;
            try { sessionStorage.removeItem(stateKey); } catch {}
        }
    });
    window.addEventListener('sessions:changed', event => {
        if (!event.detail.deleted) return;
        items.delete(event.detail.id); delete pins[event.detail.id]; savePins(); draw();
    });
    window.addEventListener('workspace:navigated', () => { select(new URL(location.href).searchParams.get('conversation')); if (!inComputer() && !items.size) load(); });
    if (!inComputer()) {
        load();
        window.addEventListener('online',()=>{if(!busy)load();});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)load();});
    }
})();
