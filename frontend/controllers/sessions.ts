import { optionalElement, present, requiredElement, eventElement, elementList, setupSortMenu, errorMessage } from './dom';
import { record, conversationData, apiError, stringValue, conversationsData, arrayValue } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const nav = optionalElement(document, '.sidebar__nav', HTMLElement);
    if (!nav) return;
    const inComputer = () => !!optionalElement(document, '.computer-page', HTMLElement);
    const items = new Map<string,Conversation>();
    let drawn = false;
    let hasMoreChats = false;
    let selected = new URL(location.href).searchParams.get('conversation'), busy = false, nextOffset: number | null = null, target: Conversation | null = null, opener: HTMLElement | null = null;
    const section = document.createElement('details');
    section.className = 'sessions'; section.open = true;
    section.innerHTML = `<summary>Recentes<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M9.29289 18.7071C8.90237 18.3166 8.90237 17.6834 9.29289 17.2929L14.5858 12L9.29289 6.70711C8.90237 6.31658 8.90237 5.68342 9.29289 5.29289C9.68342 4.90237 10.3166 4.90237 10.7071 5.29289L16.7071 11.2929C16.8946 11.4804 17 11.7348 17 12C17 12.2652 16.8946 12.5196 16.7071 12.7071L10.7071 18.7071C10.3166 19.0976 9.68342 19.0976 9.29289 18.7071Z" fill="currentColor"/>
</svg></summary><div class="sessions__list"></div><p class="sessions__status" role="status"></p><div class="sessions__tools"><button type="button" data-action="more" hidden>Mais chats</button><button type="button" data-action="refresh" hidden>Tentar novamente</button></div>`;
    const pinKey = 'ascenda-pinned-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    const stateKey = 'ascenda-sidebar-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    let savedState: Record<string,unknown> = {};
    try { savedState = record(JSON.parse(sessionStorage.getItem(stateKey) || '{}')); } catch {}
    const readKey = stateKey + '-read';
    let readResponses: Record<string,unknown> = {};
    try { readResponses = record(JSON.parse(localStorage.getItem(readKey) || '{}')); } catch {}
    function isUnread(chat: Conversation) {
        const seen = readResponses[chat.id];
        return seen === false || !!chat.last_response_at && (typeof seen !== 'string' || chat.last_response_at > seen);
    }
    function markRead(id: string, version?: string | null, force=false) {
        if (readResponses[id] === false && !force) return;
        if (id.startsWith('anonymous-')) return;
        const stamp = version ?? items.get(id)?.last_response_at ?? pins[id]?.last_response_at ?? (force ? new Date().toISOString() : null);
        if (!stamp || (typeof readResponses[id] === 'string' && String(readResponses[id]) >= stamp)) return;
        readResponses[id] = stamp;
        try { localStorage.setItem(readKey, JSON.stringify(readResponses)); } catch {}
        draw(); window.dispatchEvent(new Event('sessions:read'));
    }
    window.addEventListener('storage', event => {
        if (event.key !== readKey) return;
        try { readResponses = record(JSON.parse(event.newValue || '{}')); } catch { return; }
        draw(); window.dispatchEvent(new Event('sessions:read'));
    }, {signal: scope.signal});
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
        heading.type = 'button'; heading.className = 'sessions__heading sessions__toggle';
        const chevron = document.createElement('i'); chevron.className = 'sessions__chevron'; chevron.setAttribute('aria-hidden', 'true');
        heading.append(chevron); heading.setAttribute('aria-controls', id);
        const title = document.createElement(href ? 'a' : 'span'); title.className = 'sessions__title';
        if (href) title.setAttribute('href', href);
        title.textContent = label;
        const preferences = document.createElement('button'); preferences.type = 'button'; preferences.className = 'sessions__preferences';
        preferences.setAttribute('aria-label', 'Preferências de ' + label.toLowerCase()); preferences.innerHTML = '<i aria-hidden="true"></i>';
        summary.append(title, heading);
        const create = document.createElement('a'); create.className = 'sessions__new'; create.href = '/novo.html?new=1'; create.setAttribute('aria-label', 'Novo chat em ' + label.toLowerCase()); create.innerHTML = '<i aria-hidden="true"></i>';
        summary.append(preferences);
        if (href) summary.append(create);
        requiredElement(container, '.sessions__list', HTMLElement).id = id;
        container.open = open !== false;
        function sync() {
            heading.setAttribute('aria-expanded', String(container.open));
            heading.setAttribute('aria-label', (container.open ? 'Recolher ' : 'Expandir ') + label.toLowerCase());
        }
        summary.addEventListener('click', event => {
            if (eventElement(event.target)?.closest('a, .sessions__preferences')) return;
            event.preventDefault();
            if (eventElement(event.target)?.closest('.sessions__heading')) { container.open = !container.open; sync(); }
        }, {signal: scope.signal});
        container.addEventListener('toggle', sync, {signal: scope.signal}); sync();
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
    let pinnedOrder: RecentOrder = 'activity';
    try { const saved = localStorage.getItem(pinKey + '-order'); if (saved === 'name' || saved === 'created' || saved === 'activity') pinnedOrder = saved; } catch {}
    function sortedRecent(chats: Conversation[], selectedOrder = order): Conversation[] {
        return chats.sort((a, b) => {
            if (selectedOrder === 'name') return a.title.localeCompare(b.title, 'pt-BR', {sensitivity:'base', numeric:true});
            const timestamp = (chat: Conversation) => Date.parse(selectedOrder === 'created' ? chat.created_at : chat.updated_at) || 0;
            return timestamp(b) - timestamp(a);
        });
    }
    for (const container of [section, pinned]) {
    const isPinned = container === pinned;
    const preferences = requiredElement(container, '.sessions__preferences', HTMLButtonElement);
    const sortMenu = document.createElement('div');
    sortMenu.className = 'sessions-sort'; sortMenu.id = isPinned ? 'pinned-sort' : 'sessions-sort';
    sortMenu.setAttribute('popover', 'auto'); sortMenu.setAttribute('role', 'menu');
    sortMenu.setAttribute('aria-label', isPinned ? 'Ordenar fixados' : 'Ordenar recentes');
    sortMenu.innerHTML = '<p>Ordenar por</p>';
    const sortOptions: [RecentOrder, string][] = [['name','Nome'],['created','Recém-criados'],['activity','Última atividade']];
    for (const [value, label] of sortOptions) {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('role', 'menuitemradio'); button.dataset.order = value;
        const text = document.createElement('span'); text.textContent = label;
        const check = document.createElement('i'); check.setAttribute('aria-hidden', 'true');
        button.append(text, check); sortMenu.append(button);
        button.addEventListener('click', () => {
            if (isPinned) pinnedOrder = value; else order = value;
            try { localStorage.setItem(isPinned ? pinKey + '-order' : orderKey, value); } catch {}
            syncOrder(); draw(); sortMenu.hidePopover(); preferences.focus();
        }, {signal: scope.signal});
    }
    function syncOrder() {
        elementList(sortMenu, 'button', HTMLButtonElement).forEach(button => button.setAttribute('aria-checked', String(button.dataset.order === (isPinned ? pinnedOrder : order))));
    }
    syncOrder(); scope.append(sortMenu);
    preferences.setAttribute('aria-label', isPinned ? 'Ordenar fixados' : 'Ordenar recentes'); preferences.setAttribute('aria-haspopup', 'menu');
    preferences.setAttribute('aria-controls', sortMenu.id); preferences.setAttribute('aria-expanded', 'false');
    preferences.popoverTargetElement = sortMenu;
    setupSortMenu(sortMenu, preferences);
    window.addEventListener('resize', () => { if (sortMenu.matches(':popover-open')) sortMenu.hidePopover(); }, {signal: scope.signal});
    }
    const pinList = optionalElement(pinned, '.sessions__list', HTMLElement);
    nav.append(pinned, section);
    const recentsButton=document.createElement('button');recentsButton.type='button';recentsButton.className='sidebar-recents';
    recentsButton.setAttribute('aria-label','Recentes');recentsButton.setAttribute('aria-expanded','false');recentsButton.innerHTML='<i aria-hidden="true"></i>';
    nav.insertBefore(recentsButton,pinned);
    const recentMenu=document.createElement('div');recentMenu.className='recents-popover';recentMenu.setAttribute('popover','auto');recentMenu.setAttribute('aria-label','Recentes');
    recentMenu.innerHTML='<a class="recents-popover__heading" href="/recentes.html">Recentes</a><div class="recents-popover__list"></div>';
    scope.append(recentMenu);let recentTimer = 0;
    function closeRecents(){clearTimeout(recentTimer);if(recentMenu.matches(':popover-open'))recentMenu.hidePopover();}
    function openRecents(){
        clearTimeout(recentTimer);
        if(!document.body.classList.contains('is-sidebar-collapsed')||innerWidth<640)return;
        recentMenu.showPopover();const rect=recentsButton.getBoundingClientRect();
        recentMenu.style.left=Math.min(requiredElement(document, '.sidebar', HTMLElement).getBoundingClientRect().right+4,innerWidth-332)+'px';
        recentMenu.style.top=Math.max(8,Math.min(rect.top,innerHeight-270))+'px';
    }
    function delayClose(){recentTimer=setTimeout(()=>{if(!recentMenu.contains(document.activeElement)&&document.activeElement!==recentsButton)closeRecents();},160);}
    recentsButton.addEventListener('pointerenter',openRecents, {signal: scope.signal});recentsButton.addEventListener('pointerleave',delayClose, {signal: scope.signal});
    recentsButton.addEventListener('focus',openRecents, {signal: scope.signal});recentsButton.addEventListener('blur',delayClose, {signal: scope.signal});
    recentsButton.addEventListener('click',()=>{window.WorkspaceNavigation.go('/recentes.html');}, {signal: scope.signal});
    recentMenu.addEventListener('pointerenter',()=>clearTimeout(recentTimer), {signal: scope.signal});recentMenu.addEventListener('pointerleave',delayClose, {signal: scope.signal});recentMenu.addEventListener('focusout',delayClose, {signal: scope.signal});
    recentMenu.addEventListener('toggle',()=>recentsButton.setAttribute('aria-expanded',String(recentMenu.matches(':popover-open'))), {signal: scope.signal});
    recentMenu.addEventListener('click',event=>{
        const link=eventElement(event.target)?.closest<HTMLElement>('[data-chat-id]');if(!link)return;
        if(busy){event.preventDefault();return;}
        closeRecents();if(inComputer()){event.preventDefault();emit('open',{id:link.dataset.chatId});}
    }, {signal: scope.signal});
    new MutationObserver(closeRecents).observe(document.body,{attributes:true,attributeFilter:['class']});
    function drawRecents(){
        const container=optionalElement(recentMenu, '.recents-popover__list', HTMLElement), fragment=document.createDocumentFragment();
        for(const item of sortedRecent([...items.values()])){
            const link=document.createElement('a');link.href='/novo.html?conversation='+encodeURIComponent(item.id);link.dataset.chatId=item.id;link.textContent=item.title||'Conversa';
            if(item.id===selected)link.setAttribute('aria-current','page');fragment.append(link);
        }
        if(!items.size){const empty=document.createElement('p');empty.textContent='Nenhum chat recente';fragment.append(empty);}
        present(container).replaceChildren(fragment);
    }
    function savePins() { if(document.body.classList.contains('is-anonymous'))return; try { localStorage.setItem(pinKey, JSON.stringify(pins)); } catch {} }

    const list = requiredElement(section, '.sessions__list', HTMLElement), status = requiredElement(section, '.sessions__status', HTMLElement);
    const more = requiredElement(section, '[data-action="more"]', HTMLElement);
    const menu = document.createElement('div');
    menu.className = 'sessions-menu'; menu.id = 'sessions-menu'; menu.setAttribute('popover','auto');
    menu.setAttribute('aria-label','Opções da conversa');
    menu.innerHTML = '<button type="button" data-action="pin"><i class="sessions-icon sessions-icon--pin" aria-hidden="true"></i><span>Fixar</span></button><button type="button" data-action="rename"><i class="sessions-icon sessions-icon--rename" aria-hidden="true"></i>Renomear</button><button type="button" data-action="read"><i class="sessions-icon sessions-icon--read" aria-hidden="true"></i>Marcar como lida</button><button type="button" class="sessions-menu__delete" data-action="delete"><i class="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Apagar</button>';
    requiredElement(document, '.sidebar', HTMLElement).append(menu);
    const dialog = document.createElement('dialog');
    dialog.className = 'sessions-dialog';
    dialog.setAttribute('aria-labelledby','sessions-dialog-title');
    dialog.innerHTML = '<form><h2 id="sessions-dialog-title"></h2><p class="sessions-dialog__description"></p><p class="sessions-dialog__error" role="alert"></p><div><button type="button" data-cancel>Cancelar</button><button type="submit" data-confirm>Salvar</button></div></form>';
    scope.append(dialog);
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
                const result = item.id.startsWith('anonymous-') ? {title} : record(await request(`/api/ai/conversations/${item.id}`, 'PATCH', {title}));
                const updated = {...item, title: stringValue(result.title)};
                items.set(item.id, updated); if (pins[item.id]) pins[item.id] = updated;
                finished = true; input.replaceWith(link); row.classList.remove('is-renaming');
                savePins(); draw(); emit('changed', {id:item.id, deleted:false, title:updated.title});
                if (!inComputer()) await load();
            } catch (failure) {
                input.setCustomValidity(errorMessage(failure)); input.reportValidity(); input.focus();
            } finally { saving = false; input.readOnly = false; }
        }
        input.addEventListener('input', () => input.setCustomValidity(''), {signal: scope.signal});
        input.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); void save(); }
            if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        }, {signal: scope.signal});
        input.addEventListener('blur', () => { void save(); }, {signal: scope.signal});
        input.focus(); input.select();
    }
    function openOptions(item: Conversation, options: HTMLElement) {
        if (menu.matches(':popover-open') && opener === options) { menu.hidePopover(); return; }
        if (menu.matches(':popover-open')) menu.hidePopover();
        target = item; opener = options;
        requiredElement(menu, '[data-action="pin"] span', HTMLElement).textContent = pins[item.id] ? 'Desafixar' : 'Fixar';
        requiredElement(menu, '[data-action="pin"] i', HTMLElement).classList.toggle('sessions-icon--unpin', Boolean(pins[item.id]));
        requiredElement(menu, '[data-action="read"]', HTMLButtonElement).lastChild!.textContent = isUnread(item) ? 'Marcar como lida' : 'Marcar como não lida';
        const rect = options.getBoundingClientRect();
        menu.style.width = Math.min(240, innerWidth - 16) + 'px';
        menu.showPopover();
        const bounds = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8)) + 'px';
        options.setAttribute('aria-expanded','true'); requiredElement(menu, 'button', HTMLButtonElement).focus({preventScroll:true});
    }
    function draw() {
        drawRecents();
        const recentRows = document.createDocumentFragment(), pinnedRows = document.createDocumentFragment();
        const combined = new Map([...Object.values(pins).map(item => [item.id, item] satisfies [string,Conversation]), ...items]);
        const chats = [...combined.values()];
        const recentChats = sortedRecent(chats.filter(chat => !pins[chat.id]));
        more.textContent = recentChats.length >= 20 ? 'Ver Tudo' : 'Mais chats';
        more.hidden = recentChats.length < 20 && !hasMoreChats;
        for (const item of [...sortedRecent(chats.filter(chat => pins[chat.id]), pinnedOrder), ...recentChats.slice(0, 20)]) {
            const row = document.createElement('div'); row.className = 'sessions__row'; row.dataset.id = item.id;
            const link = document.createElement('a'); link.className = 'sessions__link'; link.href = `/novo.html?conversation=${encodeURIComponent(item.id)}`;
            const titleViewport = document.createElement('span'); titleViewport.className = 'sessions__title';
            const titleText = document.createElement('span'); titleText.textContent = item.title;
            const icon = document.createElement('span'); icon.className = 'sessions__chat-icon'; icon.setAttribute('aria-hidden', 'true');
            titleViewport.append(titleText); link.append(icon, titleViewport);
            function stopTitleScroll() { titleText.classList.remove('is-scrolling'); }
            function scrollTitle() {
                stopTitleScroll();
                if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                if (titleText.scrollWidth <= titleViewport.clientWidth - 24) return;
                const distance = Math.max(0, titleText.scrollWidth - titleViewport.clientWidth + 24);
                titleText.style.setProperty('--title-scroll-distance', `${-distance}px`);
                titleText.style.setProperty('--title-scroll-duration', `${Math.max(2, distance / 28)}s`);
                titleText.classList.add('is-scrolling');
            }
            row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') scrollTitle(); }, {signal: scope.signal});
            row.addEventListener('pointerleave', stopTitleScroll, {signal: scope.signal});
            row.addEventListener('focusin', scrollTitle, {signal: scope.signal});
            row.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) stopTitleScroll(); }, {signal: scope.signal});
            if (item.id === selected && inComputer()) link.setAttribute('aria-current','page');
            link.addEventListener('click', event => {
                if (!inComputer() || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); if (busy) return;
                emit('open', {id:item.id}); closeMobile();
            }, {signal: scope.signal});
            const options = document.createElement('button'); options.type = 'button'; options.className = 'sessions__more';
            options.innerHTML = '<i class="sessions-icon sessions-icon--more" aria-hidden="true"></i>';
            options.setAttribute('aria-label', `Opções de ${item.title}`); options.setAttribute('aria-expanded','false'); options.setAttribute('aria-controls',menu.id); options.disabled = busy; options.popoverTargetElement = menu;
            options.addEventListener('click', event => { event.preventDefault(); openOptions(item, options); }, {signal: scope.signal});
            if (isUnread(item)) { const dot = document.createElement('span'); dot.className = 'sessions__unread'; dot.setAttribute('role','img'); dot.setAttribute('aria-label','Resposta não lida'); row.append(dot); }
            row.append(link,options); (pins[item.id] ? pinnedRows : recentRows).append(row);
            if (pins[item.id]) pins[item.id] = item;
        }
        list.replaceChildren(recentRows); present(pinList).replaceChildren(pinnedRows);
        pinned.hidden = !present(pinList).children.length; savePins();
        status.textContent = list.children.length ? '' : 'Nenhuma conversa';
        drawn = true;
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.matches(':popover-open')) { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); opener?.focus({preventScroll:true}); } }, {capture:true, signal: scope.signal});
    menu.addEventListener('toggle', event => { if (event.newState === 'closed') opener?.setAttribute('aria-expanded','false'); }, {signal: scope.signal});
    window.addEventListener('resize', () => { if (menu.matches(':popover-open')) menu.hidePopover(); }, {signal: scope.signal});
    function runAction(item: Conversation, value: string, origin: HTMLElement) {
        target=item;opener=origin;action=value;
        if (menu.matches(':popover-open')) menu.hidePopover();
        if (action === 'read') {
            if (isUnread(target)) markRead(target.id, target.last_response_at, true);
            else { readResponses[target.id]=false; try {localStorage.setItem(readKey,JSON.stringify(readResponses));} catch {} draw(); window.dispatchEvent(new Event('sessions:read')); }
            return;
        }
        if (action === 'pin') {
            if (pins[target.id]) delete pins[target.id]; else pins[target.id] = target;
            savePins(); draw(); emit('pins'); return;
        }
        if (action === 'rename') { renameInline(target); return; }
        if (action !== 'delete') return;
        requiredElement(dialog, 'h2', HTMLElement).textContent = 'Excluir sessão?';
        dialog.classList.add('sessions-dialog--delete');
        const description = requiredElement(dialog, '.sessions-dialog__description', HTMLElement);
        description.replaceChildren();
        description.append(document.createTextNode('Isso excluirá permanentemente a sessão:'));
        const title = document.createElement('strong'); title.textContent = target.title;
        description.append(title);
        requiredElement(dialog, '[data-confirm]', HTMLElement).textContent = 'Excluir';
        requiredElement(dialog, '[data-confirm]', HTMLElement).classList.add('sessions-menu__delete');
        error.textContent = ''; dialog.showModal();
        requiredElement(dialog, '[data-cancel]', HTMLElement).focus();
    }
    menu.addEventListener('click', event => {
        const button=eventElement(event.target)?.closest('button');
        if (button && target && opener) runAction(target,button.dataset.action || '',opener);
    }, {signal: scope.signal});
    requiredElement(dialog, '[data-cancel]', HTMLElement).addEventListener('click', () => { if (!changing) dialog.close(); }, {signal: scope.signal});
    dialog.addEventListener('cancel', event => { if (changing) event.preventDefault(); }, {signal: scope.signal});
    dialog.addEventListener('close', () => { (opener?.isConnected ? opener : requiredElement(section, 'summary', HTMLElement)).focus(); }, {signal: scope.signal});
    requiredElement(dialog, 'form', HTMLFormElement).addEventListener('submit', async event => {
        event.preventDefault(); if (changing || !target) return;
        changing = true; elementList(dialog, 'button', HTMLButtonElement).forEach(button=>button.disabled=true); error.textContent = '';
        try {
            const id = target.id;
            if (!id.startsWith('anonymous-')) await request(`/api/ai/conversations/${id}`, 'DELETE');
            items.delete(id); delete pins[id];
            savePins();
            dialog.close(); draw(); emit('changed',{id,deleted:true});
            if (!inComputer()) await load();
        } catch (failure) { error.textContent = errorMessage(failure); }
        finally { changing=false; elementList(dialog, 'button', HTMLButtonElement).forEach(button=>button.disabled=false); }
    }, {signal: scope.signal});
    requiredElement(section, '.sessions__tools', HTMLElement).addEventListener('click', async event => {
        const button = eventElement(event.target)?.closest('button'); if (!button || busy) return;
        const command=button.dataset.action;
        if (command === 'more' && list.children.length >= 20) { window.WorkspaceNavigation.go('/recentes.html'); return; }
        if (inComputer()) { emit(command); if (command==='new') closeMobile(); }
        else if(command==='new') window.WorkspaceNavigation.go('/novo.html?new=1');
        else await load(command==='more');
    }, {signal: scope.signal});
    function render(data: Conversation[], append=false, hasMore=false) {
        const unchanged = !append && JSON.stringify([...items.values()]) === JSON.stringify(data);
        if (!append) items.clear(); data.forEach(item=>items.set(item.id,item));
        requiredElement(section, '[data-action="refresh"]', HTMLElement).hidden=true;
        hasMoreChats = hasMore; more.hidden = list.children.length < 20 && !hasMore; if (!unchanged || !drawn) draw();
    }
    function markSelected(link: HTMLElement, active: boolean) {
        if(active===link.hasAttribute('aria-current'))return;
        if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    function select(id: string | null,title?: string) {
        selected=id;
        markSelected(requiredElement(document, '.sidebar__new-chat .sidebar__link', HTMLElement), inComputer() && !id);
        if(id&&!items.has(id)) {
            const now = new Date().toISOString();
            items.set(id,{id,title:title||'Conversa atual',created_at:now,updated_at:now}); draw(); return;
        }
        if(!drawn) { draw(); return; }
        elementList(present(nav), '.sessions__link', HTMLAnchorElement).forEach(link=>markSelected(link,inComputer()&&link.closest<HTMLElement>('.sessions__row')?.dataset.id===id));
        elementList(recentMenu, '[data-chat-id]', HTMLElement).forEach(link=>markSelected(link,link.dataset.chatId===id));
    }
    function setBusy(value: boolean) { if(busy===value)return; busy=value; elementList(present(nav), '.sessions__more, .sessions__tools button', HTMLButtonElement).forEach(button=>button.disabled=value); }
    async function load(append=false) {
        if (document.body.classList.contains('is-anonymous')) return;
        setBusy(true);
        try { const result=conversationsData(await request(`/api/ai/conversations?offset=${append ? nextOffset : 0}`)); nextOffset=result.next_offset; render(result.conversations,append,nextOffset!==null); }
        catch(failure) { status.textContent='Não foi possível carregar os chats.'; requiredElement(section, '[data-action="refresh"]', HTMLElement).hidden=false; }
        finally { setBusy(false); }
    }
    window.ComputerSessions={runAction,isUnread,markRead,render,select,setBusy,openOptions,request,isPinned:id=>!!pins[id]};
    if (Array.isArray(savedState.chats)) {
        nextOffset = typeof savedState.nextOffset === 'number' ? savedState.nextOffset : null;
        render(arrayValue(savedState.chats,conversationData), false, nextOffset !== null);
        nav.scrollTop = typeof savedState.scrollTop === 'number' ? savedState.scrollTop : 0;
    }
    let normalPins = pins;
    window.addEventListener('chat:anonymous', event => {
        if (event.detail) { if (pins === normalPins) pins = {}; }
        else { pins = normalPins; }
    }, {signal:scope.signal});
    let loggingOut = false;
    window.addEventListener('pagehide', () => {
        if (loggingOut || document.body.classList.contains('is-anonymous')) return;
        try {
            sessionStorage.setItem(stateKey, JSON.stringify({
                recentOpen: section.open, pinnedOpen: pinned.open, scrollTop: nav.scrollTop,
                collapsed: document.body.classList.contains('is-sidebar-collapsed'),
                chats: [...items.values()], nextOffset
            }));
        } catch {}
    }, {signal: scope.signal});
    document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement && new URL(event.target.action, location.href).pathname === '/logout') {
            loggingOut = true;
            try { sessionStorage.removeItem(stateKey); } catch {}
        }
    }, {signal: scope.signal});
    window.addEventListener('sessions:changed', event => {
        const {id,deleted,title}=event.detail;
        if (deleted) { items.delete(id);delete pins[id];savePins();draw(); }
        else if (title && items.has(id) && items.get(id)?.title!==title) {
            const chat={...present(items.get(id)),title};items.set(id,chat);if(pins[id])pins[id]=chat;savePins();draw();
        }
    }, {signal: scope.signal});
    window.addEventListener('workspace:navigated', () => { select(new URL(location.href).searchParams.get('conversation')); if (!inComputer() && !busy) load(); }, {signal: scope.signal});
    if (!inComputer()) {
        load();
        window.addEventListener('online',()=>{if(!busy)load();}, {signal: scope.signal});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)load();}, {signal: scope.signal});
    }
}
