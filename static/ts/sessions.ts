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
        const heading = document.createElement(href ? 'a' : 'span');
        heading.className = 'sessions__heading'; heading.textContent = label;
        if (href && heading instanceof HTMLAnchorElement) heading.href = href;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sessions__collapse';
        button.setAttribute('aria-controls', id);
        button.innerHTML = '<i class="sessions__chevron" aria-hidden="true"></i>';
        summary.append(heading, button); requiredElement(container, '.sessions__list', HTMLElement).id = id;
        container.open = open !== false;
        function sync() {
            button.setAttribute('aria-expanded', String(container.open));
            button.setAttribute('aria-label', (container.open ? 'Recolher ' : 'Expandir ') + label.toLowerCase());
        }
        summary.addEventListener('click', event => {
            if (eventElement(event.target)?.closest('a')) return;
            event.preventDefault();
            if (eventElement(event.target)?.closest('button')) { container.open = !container.open; sync(); }
        });
        container.addEventListener('toggle', sync); sync();
    }
    configureHeading(section, 'Recentes', 'recent-chats', '/recentes.html', savedState.recentOpen);
    configureHeading(pinned, 'Fixados', 'pinned-chats', null, savedState.pinnedOpen);
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
        for(const item of items.values()){
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
    menu.innerHTML = '<button type="button" data-action="pin"><i class="sessions-icon sessions-icon--pin" aria-hidden="true"></i><span>Fixar</span></button><button type="button" data-action="rename"><i class="sessions-icon sessions-icon--rename" aria-hidden="true"></i>Renomear</button><button type="button" class="sessions-menu__delete" data-action="delete"><i class="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Excluir</button>';
    requiredElement(document, '.sidebar', HTMLElement).append(menu);
    const dialog = document.createElement('dialog');
    dialog.className = 'sessions-dialog';
    dialog.setAttribute('aria-labelledby','sessions-dialog-title');
    dialog.innerHTML = '<form><h2 id="sessions-dialog-title"></h2><p class="sessions-dialog__description"></p><label>Nome da conversa<input name="title" maxlength="100" required autocomplete="off"></label><p class="sessions-dialog__error" role="alert"></p><div><button type="button" data-cancel>Cancelar</button><button type="submit" data-confirm>Salvar</button></div></form>';
    document.body.append(dialog);
    let action: string | undefined, changing = false;
    const field = requiredElement(dialog, 'input', HTMLInputElement), error = requiredElement(dialog, '.sessions-dialog__error', HTMLElement);
    function emit(name: string | undefined, detail: Record<string,unknown> = {}) { window.dispatchEvent(new CustomEvent('sessions:' + name, {detail})); }
    function closeMobile() { if (matchMedia('(width < 640px)').matches && !document.body.classList.contains('is-sidebar-collapsed')) requiredElement(document, '.sidebar__toggle', HTMLButtonElement).click(); }
    async function request(path: string, method = 'GET', data?: unknown):Promise<unknown> {
        const csrf = optionalElement(document, 'meta[name="csrf-token"]', HTMLMetaElement)?.content || optionalElement(document, '[name="csrf_token"]', HTMLInputElement)?.value || '';
        const response = await fetch(path, {method, credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json','X-CSRFToken':csrf}, body:data ? JSON.stringify(data) : undefined});
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(result,'Não foi possível atualizar as sessões.'));
        return result;
    }
    function openOptions(item: Conversation, options: HTMLElement) {
        if (menu.matches(':popover-open') && opener === options) { menu.hidePopover(); return; }
        if (menu.matches(':popover-open')) menu.hidePopover();
        target = item; opener = options;
        requiredElement(menu, '[data-action="pin"] span', HTMLElement).textContent = pins[item.id] ? 'Desafixar' : 'Fixar';
        const rect = options.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 224)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 156)) + 'px';
        menu.showPopover(); options.setAttribute('aria-expanded','true'); requiredElement(menu, 'button', HTMLButtonElement).focus({preventScroll:true});
    }
    function draw() {
        drawRecents();
        const recentRows = document.createDocumentFragment(), pinnedRows = document.createDocumentFragment();
        const combined = new Map([...Object.values(pins).map(item => [item.id, item] satisfies [string,Conversation]), ...items]);
        for (const item of combined.values()) {
            const row = document.createElement('div'); row.className = 'sessions__row'; row.dataset.id = item.id;
            const link = document.createElement('a'); link.className = 'sessions__link'; link.href = `/computer.html?conversation=${encodeURIComponent(item.id)}`;
            link.textContent = item.title; link.title = item.title;
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
        requiredElement(dialog, 'h2', HTMLElement).textContent = action === 'rename' ? 'Renomear conversa' : 'Excluir sessão?';
        dialog.classList.toggle('sessions-dialog--delete', action === 'delete');
        const description = requiredElement(dialog, '.sessions-dialog__description', HTMLElement);
        description.replaceChildren();
        if (action === 'delete') {
            description.append(document.createTextNode('Isso excluirá permanentemente a sessão:'));
            const title = document.createElement('strong'); title.textContent = target.title;
            description.append(title);
        }
        present(field.closest('label')).hidden = action !== 'rename'; field.disabled = action !== 'rename'; field.value = target.title;
        requiredElement(dialog, '[data-confirm]', HTMLElement).textContent = action === 'rename' ? 'Salvar' : 'Excluir';
        requiredElement(dialog, '[data-confirm]', HTMLElement).classList.toggle('sessions-menu__delete', action === 'delete');
        error.textContent = ''; dialog.showModal();
        if (action === 'rename') { field.focus(); field.select(); } else requiredElement(dialog, '[data-cancel]', HTMLElement).focus();
    });
    requiredElement(dialog, '[data-cancel]', HTMLElement).addEventListener('click', () => { if (!changing) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (changing) event.preventDefault(); });
    dialog.addEventListener('close', () => { (opener?.isConnected ? opener : requiredElement(section, 'summary', HTMLElement)).focus(); });
    requiredElement(dialog, 'form', HTMLFormElement).addEventListener('submit', async event => {
        event.preventDefault(); if (changing || !target) return;
        changing = true; elementList(dialog, 'button', HTMLButtonElement).forEach(button=>button.disabled=true); error.textContent = '';
        try {
            const id = target.id, deleted = action === 'delete';
            const result = record(await request(`/api/ai/conversations/${id}`, deleted ? 'DELETE' : 'PATCH', deleted ? undefined : {title:field.value.trim()}));
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
