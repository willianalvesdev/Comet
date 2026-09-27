(() => {
    const nav = document.querySelector('.sidebar__nav');
    if (!nav) return;
    const inComputer = !!document.querySelector('.computer-page');
    const items = new Map();
    let selected = new URL(location.href).searchParams.get('conversation'), busy = false, nextOffset = null, target = null, opener = null;
    const section = document.createElement('details');
    section.className = 'sessions'; section.open = true;
    section.innerHTML = `<summary>Recentes<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><div class="sessions__list"></div><p class="sessions__status" role="status"></p><div class="sessions__tools"><button type="button" data-action="more" hidden>Mais sessões</button><button type="button" data-action="refresh" hidden>Tentar novamente</button></div>`;
    const pinKey = 'ascenda-pinned-' + document.querySelector('[data-user-id]')?.dataset.userId;
    let pins = {};
    try { pins = JSON.parse(localStorage.getItem(pinKey) || '{}'); } catch {}
    const pinned = document.createElement('details');
    pinned.className = 'sessions'; pinned.open = true;
    pinned.innerHTML = section.innerHTML;
    pinned.querySelector('summary').firstChild.textContent = 'Fixados';
    pinned.querySelector('.sessions__tools').remove();
    pinned.querySelector('.sessions__status').remove();
    const pinList = pinned.querySelector('.sessions__list');
    nav.append(pinned, section);
    function savePins() { try { localStorage.setItem(pinKey, JSON.stringify(pins)); } catch {} }

    const list = section.querySelector('.sessions__list'), status = section.querySelector('.sessions__status');
    const more = section.querySelector('[data-action="more"]');
    const menu = document.createElement('div');
    menu.className = 'sessions-menu'; menu.id = 'sessions-menu'; menu.setAttribute('popover','auto');
    menu.setAttribute('aria-label','Opções da conversa');
    menu.innerHTML = '<button type="button" data-action="pin"><i class="sessions-icon sessions-icon--pin" aria-hidden="true"></i><span>Fixar</span></button><button type="button" data-action="rename"><i class="sessions-icon sessions-icon--rename" aria-hidden="true"></i>Renomear</button><button type="button" class="sessions-menu__delete" data-action="delete"><i class="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Excluir</button>';
    document.querySelector('.sidebar').append(menu);
    const dialog = document.createElement('dialog');
    dialog.className = 'sessions-dialog';
    dialog.setAttribute('aria-labelledby','sessions-dialog-title');
    dialog.innerHTML = '<form><h2 id="sessions-dialog-title"></h2><p class="sessions-dialog__description"></p><label>Nome da conversa<input name="title" maxlength="100" required autocomplete="off"></label><p class="sessions-dialog__error" role="alert"></p><div><button type="button" data-cancel>Cancelar</button><button type="submit" data-confirm>Salvar</button></div></form>';
    document.body.append(dialog);
    let action = null, changing = false;
    const field = dialog.querySelector('input'), error = dialog.querySelector('.sessions-dialog__error');
    function emit(name, detail = {}) { window.dispatchEvent(new CustomEvent('sessions:' + name, {detail})); }
    function closeMobile() { if (matchMedia('(width < 640px)').matches && !document.body.classList.contains('is-sidebar-collapsed')) document.querySelector('.sidebar__toggle').click(); }
    async function request(path, method = 'GET', data) {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('[name="csrf_token"]')?.value;
        const response = await fetch(path, {method, credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json','X-CSRFToken':csrf}, body:data ? JSON.stringify(data) : undefined});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar as sessões.');
        return result;
    }
    function draw() {
        list.replaceChildren(); pinList.replaceChildren();
        const combined = new Map([...Object.values(pins).map(item => [item.id, item]), ...items]);
        for (const item of combined.values()) {
            const row = document.createElement('div'); row.className = 'sessions__row'; row.dataset.id = item.id;
            const link = document.createElement('a'); link.className = 'sessions__link'; link.href = `/computer.html?conversation=${encodeURIComponent(item.id)}`;
            link.textContent = item.title; link.title = item.title;
            if (item.id === selected && inComputer) link.setAttribute('aria-current','page');
            link.addEventListener('click', event => {
                if (!inComputer || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); if (busy) return;
                emit('open', {id:item.id}); closeMobile();
            });
            const options = document.createElement('button'); options.type = 'button'; options.className = 'sessions__more';
            options.innerHTML = '<i class="sessions-icon sessions-icon--more" aria-hidden="true"></i>';
            options.setAttribute('aria-label', `Opções de ${item.title}`); options.setAttribute('aria-expanded','false'); options.setAttribute('aria-controls',menu.id); options.disabled = busy;
            options.addEventListener('click', () => {
                if (menu.matches(':popover-open') && opener === options) { menu.hidePopover(); return; }
                if (menu.matches(':popover-open')) menu.hidePopover();
                target = item; opener = options;
                menu.querySelector('[data-action="pin"] span').textContent = pins[item.id] ? 'Desafixar' : 'Fixar';
                const rect = options.getBoundingClientRect();
                menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 224)) + 'px';
                menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 156)) + 'px';
                menu.showPopover(); options.setAttribute('aria-expanded','true'); menu.querySelector('button').focus({preventScroll:true});
            });
            row.append(link,options); (pins[item.id] ? pinList : list).append(row);
            if (pins[item.id]) pins[item.id] = item;
        }
        pinned.hidden = !pinList.children.length; savePins();
        status.textContent = list.children.length ? '' : 'Nenhuma conversa recente.';
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.matches(':popover-open')) { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); opener?.focus({preventScroll:true}); } }, true);
    menu.addEventListener('toggle', event => { if (event.newState === 'closed') opener?.setAttribute('aria-expanded','false'); });
    window.addEventListener('resize', () => { if (menu.matches(':popover-open')) menu.hidePopover(); });
    menu.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button || !target) return;
        action = button.dataset.action; menu.hidePopover();
        if (action === 'pin') {
            if (pins[target.id]) delete pins[target.id]; else pins[target.id] = target;
            savePins(); draw(); return;
        }
        dialog.querySelector('h2').textContent = action === 'rename' ? 'Renomear conversa' : 'Excluir sessão?';
        dialog.classList.toggle('sessions-dialog--delete', action === 'delete');
        const description = dialog.querySelector('.sessions-dialog__description');
        description.replaceChildren();
        if (action === 'delete') {
            description.append(document.createTextNode('Isso excluirá permanentemente a sessão:'));
            const title = document.createElement('strong'); title.textContent = target.title;
            description.append(title);
        }
        field.closest('label').hidden = action !== 'rename'; field.disabled = action !== 'rename'; field.value = target.title;
        dialog.querySelector('[data-confirm]').textContent = action === 'rename' ? 'Salvar' : 'Excluir';
        dialog.querySelector('[data-confirm]').classList.toggle('sessions-menu__delete', action === 'delete');
        error.textContent = ''; dialog.showModal();
        if (action === 'rename') { field.focus(); field.select(); } else dialog.querySelector('[data-cancel]').focus();
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => { if (!changing) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (changing) event.preventDefault(); });
    dialog.addEventListener('close', () => { (opener?.isConnected ? opener : section.querySelector('summary')).focus(); });
    dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault(); if (changing) return;
        changing = true; dialog.querySelectorAll('button').forEach(button=>button.disabled=true); error.textContent = '';
        try {
            const id = target.id, deleted = action === 'delete';
            const result = await request(`/api/ai/conversations/${id}`, deleted ? 'DELETE' : 'PATCH', deleted ? undefined : {title:field.value.trim()});
            if (deleted) { items.delete(id); delete pins[id]; }
            else { items.set(id, {...target, title:result.title}); if (pins[id]) pins[id] = items.get(id); }
            savePins();
            dialog.close(); draw(); emit('changed',{id,deleted,title:result.title});
            if (!inComputer) await load();
        } catch (failure) { error.textContent = failure.message; }
        finally { changing=false; dialog.querySelectorAll('button').forEach(button=>button.disabled=false); }
    });
    section.querySelector('.sessions__tools').addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button || busy) return;
        const command=button.dataset.action;
        if (inComputer) { emit(command); if (command==='new') closeMobile(); }
        else if(command==='new') location.href='/computer.html?new=1';
        else await load(command==='more');
    });
    function render(data, append=false, hasMore=false) {
        if (!append) items.clear(); data.forEach(item=>items.set(item.id,item));
        section.querySelector('[data-action="refresh"]').hidden=true;
        more.hidden=!hasMore; draw();
    }
    function select(id,title) {
        selected=id;
        if(id&&!items.has(id)) items.set(id,{id,title:title||'Conversa atual'});
        draw();
    }
    function setBusy(value) { busy=value; nav.querySelectorAll('.sessions button').forEach(button=>button.disabled=value); }
    async function load(append=false) {
        setBusy(true);
        try { const result=await request(`/api/ai/conversations?offset=${append ? nextOffset : 0}`); nextOffset=result.next_offset; render(result.conversations,append,nextOffset!==null); }
        catch(failure) { status.textContent='Não foi possível carregar as sessões.'; section.querySelector('[data-action="refresh"]').hidden=false; }
        finally { setBusy(false); }
    }
    window.ComputerSessions={render,select,setBusy};
    if (!inComputer) {
        load();
        window.addEventListener('online',()=>{if(!busy)load();});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)load();});
    }
})();
