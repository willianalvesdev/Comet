import { requiredElement, optionalElement, elementList, present } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
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
    let previewIndex = -1;
    function depth() {
        const bounds = rail.getBoundingClientRect();
        const selected = panel.hidden ? current : previewIndex;
        entries.forEach((entry, index) => {
            const rect = entry.mark.getBoundingClientRect();
            const edgeDistance = Math.min(rect.top + rect.height / 2 - bounds.top, bounds.bottom - rect.top - rect.height / 2);
            const edge = Math.max(0, Math.min(1, 1 - edgeDistance / 72));
            const relief = selected < 0 ? 1 : Math.max(0, Math.min(1, (Math.abs(index - selected) - 2) / 3));
            const fade = edge * edge * (3 - 2 * edge);
            const amount = fade * relief;
            entry.mark.style.setProperty('--mark-blur', (amount * 1.8).toFixed(2) + 'px');
            entry.mark.style.setProperty('--mark-depth', (amount * 42).toFixed(2) + 'deg');
            entry.mark.style.setProperty('--mark-opacity', String(1 - amount * .97));
        });
    }
    function open(index = Math.max(0, current)) {
        const entry = entries[index]; if (!entry) return;
        previewIndex = index;
        entries.forEach((value, i) => { value.item.hidden = i !== index; value.mark.classList.toggle('is-previewed', i === index); value.mark.classList.toggle('is-near-preview', Math.abs(i - index) === 1); value.mark.classList.toggle('is-next-preview', Math.abs(i - index) === 2); });
        const answer = entry.message.nextElementSibling;
        const preview = requiredElement(entry.item, '.message-navigator__answer', HTMLElement);
        preview.textContent = answer?.classList.contains('computer-message--assistant') ? answer.querySelector('.computer-message__text')?.textContent?.trim() ?? '' : '';
        preview.hidden = !preview.textContent;
        const time = requiredElement(entry.item, '.message-navigator__time', HTMLTimeElement);
        const value = entry.message.querySelector('time')?.dateTime;
        const date = new Date(value || '');
        time.hidden = Number.isNaN(date.getTime());
        if (!time.hidden) {
            time.dateTime = date.toISOString();
            time.textContent = date.toLocaleDateString('pt-BR', {day:'numeric',month:'short'}) + ', ' + date.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
        }
        panel.hidden = false; nav.classList.add('is-open'); depth();
        panel.style.top = `${entry.mark.getBoundingClientRect().top - nav.getBoundingClientRect().top + entry.mark.offsetHeight / 2}px`;
        const bounds = panel.getBoundingClientRect();
        const correction = Math.max(8 - bounds.top, Math.min(0, innerHeight - 8 - bounds.bottom));
        panel.style.top = `${parseFloat(panel.style.top) + correction}px`;
    }
    function close() { panel.hidden = true; nav.classList.remove('is-open'); entries.forEach(entry => entry.mark.classList.remove('is-previewed', 'is-near-preview', 'is-next-preview')); depth(); }
    function go(index: number) {
        const entry = entries[index]; if (!entry) return;
        const rect = entry.message.getBoundingClientRect();
        scroller.scrollTo({top: Math.max(0, scroller.scrollTop + rect.top + rect.height/2 - innerHeight/2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
        close();
    }
    function update() {
        frame = 0; if (!entries.length) return;
        const atTop = scroller.scrollTop <= 8;
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
        let index = atTop ? 0 : entries.length - 1;
        if (!atTop && !atBottom) {
            let distance = Infinity;
            entries.forEach((entry,i) => {
                const rect = entry.message.getBoundingClientRect();
                const next = Math.abs(rect.top + rect.height/2 - innerHeight/2);
                if (next < distance) { distance = next; index = i; }
            });
        }
        if (index === current) { depth(); return; }
        const previous = entries[current];
        if (previous) { previous.mark.removeAttribute('aria-current'); previous.item.removeAttribute('aria-current'); }
        current = index;
        entries[index].mark.setAttribute('aria-current', 'true');
        entries[index].item.setAttribute('aria-current', 'true');
        depth();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    function rebuild() {
        const nodes = [...elementList(present(messages), '.computer-message--user', HTMLElement)];
        if (nodes.length === entries.length && nodes.every((node, i) => node === entries[i].message)) { if (!panel.hidden) open(previewIndex); return; }
        const marks = document.createDocumentFragment(), items = document.createDocumentFragment(); current = -1;
        entries = nodes.map((message, index) => {
            const text = requiredElement(message, '.computer-message__text', HTMLElement).textContent.trim();
            const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'message-navigator__mark';
            mark.setAttribute('aria-label', `Mensagem ${index + 1}: ${text.slice(0, 100)}`);
            const item = document.createElement('button'); item.type = 'button'; item.hidden = true; const title = document.createElement('strong'); title.className = 'message-navigator__question'; title.textContent = text; const answer = document.createElement('span'); answer.className = 'message-navigator__answer'; const time = document.createElement('time'); time.className = 'message-navigator__time'; time.hidden = true; item.append(title, answer, time);
            item.setAttribute('aria-label', `Ir para mensagem ${index + 1}: ${text.slice(0, 100)}`);
            mark.addEventListener('click', () => { if (matchMedia('(hover: none)').matches && panel.hidden) open(index); else go(index); }, {signal: scope.signal});
            mark.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(index); }, {signal: scope.signal});
            mark.addEventListener('focus', () => { if (!matchMedia('(hover: none)').matches) open(index); }, {signal: scope.signal});
            item.addEventListener('click', () => go(index), {signal: scope.signal});
            marks.append(mark); items.append(item);
            return {message, mark, item};
        });
        rail.replaceChildren(marks); list.replaceChildren(items);
        nav.hidden = !entries.length;
        if (!entries.length) close(); else if (!panel.hidden) open(Math.min(previewIndex, entries.length - 1));
        schedule();
    }
    nav.addEventListener('pointerleave', () => { if (!nav.contains(document.activeElement)) close(); }, {signal: scope.signal});

    nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) close(); }, {signal: scope.signal});
    nav.addEventListener('keydown', event => {
        if (event.key === 'Escape') { close(); document.activeElement instanceof HTMLElement && document.activeElement.blur(); event.stopPropagation(); }
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            const buttons = elementList(list, 'button', HTMLButtonElement); let index = previewIndex;
            index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
            event.preventDefault(); open(index); buttons[index]?.focus();
        }
    }, {signal: scope.signal});
    scope.listen(document, 'pointerdown', event => { if (!nav.contains(event.target instanceof Node ? event.target : null)) close(); });
    scope.listen(scroller, 'scroll', schedule, {passive:true});
    scope.listen(rail, 'scroll', schedule, {passive:true});
    scope.listen(window, 'resize', schedule);
    new ResizeObserver(schedule).observe(messages);
    const composer = requiredElement(document, '.computer-composer', HTMLElement);
    if (composer) new ResizeObserver(schedule).observe(composer);
    new MutationObserver(rebuild).observe(messages, {childList:true, subtree:true, characterData:true});
    rebuild();
}
