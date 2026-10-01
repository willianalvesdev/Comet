window.WorkspaceNavigation.page('/static/js/message-navigator.js', ({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}) => {
    const scroller = requiredElement(document, '.workspace__content', HTMLElement);
    const messages = optionalElement(document, '.computer-messages', HTMLElement);
    if (!messages) return;
    const nav = document.createElement('nav');
    nav.className = 'message-navigator';
    nav.setAttribute('aria-label', 'Navegar pelas mensagens enviadas');
    nav.hidden = true;
    const rail = document.createElement('div'); rail.className = 'message-navigator__rail';
    const panel = document.createElement('div'); panel.className = 'message-navigator__panel'; panel.hidden = true;
    const list = document.createElement('div'); list.className = 'message-navigator__list';
    panel.append(list); nav.append(rail, panel); scope.append(nav);
    let entries: {message:HTMLElement;mark:HTMLButtonElement;item:HTMLButtonElement}[] = [], current = -1, frame = 0;
    function open() { panel.hidden = false; nav.classList.add('is-open'); }
    function close() { panel.hidden = true; nav.classList.remove('is-open'); }
    function go(index: number) {
        const entry = entries[index]; if (!entry) return;
        const rect = entry.message.getBoundingClientRect();
        scroller.scrollTo({top: Math.max(0, scroller.scrollTop + rect.top + rect.height/2 - innerHeight/2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
        close();
    }
    function update() {
        frame = 0; if (!entries.length) return;
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
        let index = entries.length - 1;
        if (!atBottom) {
            let distance = Infinity;
            entries.forEach((entry,i) => {
                const rect = entry.message.getBoundingClientRect();
                const next = Math.abs(rect.top + rect.height/2 - innerHeight/2);
                if (next < distance) { distance = next; index = i; }
            });
        }
        if (index === current) return;
        const previous = entries[current];
        if (previous) { previous.mark.removeAttribute('aria-current'); previous.item.removeAttribute('aria-current'); }
        current = index;
        entries[index].mark.setAttribute('aria-current', 'true');
        entries[index].item.setAttribute('aria-current', 'true');
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    function rebuild() {
        const nodes = [...elementList(present(messages), '.computer-message--user', HTMLElement)];
        if (nodes.length === entries.length && nodes.every((node, i) => node === entries[i].message)) return;
        const marks = document.createDocumentFragment(), items = document.createDocumentFragment(); current = -1;
        entries = nodes.map((message, index) => {
            const text = requiredElement(message, '.computer-message__text', HTMLElement).textContent.trim();
            const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'message-navigator__mark';
            mark.setAttribute('aria-label', `Mensagem ${index + 1}: ${text.slice(0, 100)}`);
            const item = document.createElement('button'); item.type = 'button'; item.textContent = text; item.title = text;
            item.setAttribute('aria-label', `Ir para mensagem ${index + 1}: ${text.slice(0, 100)}`);
            mark.addEventListener('click', () => { if (matchMedia('(hover: none)').matches && panel.hidden) open(); else go(index); });
            item.addEventListener('click', () => go(index));
            marks.append(mark); items.append(item);
            return {message, mark, item};
        });
        rail.replaceChildren(marks); list.replaceChildren(items);
        nav.hidden = !entries.length;
        if (!entries.length) close();
        schedule();
    }
    nav.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(); });
    nav.addEventListener('pointerleave', () => { if (!nav.contains(document.activeElement)) close(); });
    nav.addEventListener('focusin', open);
    nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) close(); });
    nav.addEventListener('keydown', event => {
        if (event.key === 'Escape') { close(); document.activeElement instanceof HTMLElement && document.activeElement.blur(); event.stopPropagation(); }
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            const buttons = elementList(list, 'button', HTMLButtonElement); let index = buttons.findIndex(button => button === document.activeElement);
            index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
            event.preventDefault(); buttons[index]?.focus();
        }
    });
    scope.listen(document, 'pointerdown', event => { if (!nav.contains(event.target instanceof Node ? event.target : null)) close(); });
    scope.listen(scroller, 'scroll', schedule, {passive:true});
    scope.listen(window, 'resize', schedule);
    new ResizeObserver(schedule).observe(messages);
    const composer = requiredElement(document, '.computer-composer', HTMLElement);
    if (composer) new ResizeObserver(schedule).observe(composer);
    new MutationObserver(rebuild).observe(messages, {childList:true});
    rebuild();
});
