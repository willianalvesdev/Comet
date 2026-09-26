(() => {
    const messages = document.querySelector('.computer-messages');
    if (!messages) return;
    const nav = document.createElement('nav');
    nav.className = 'message-navigator';
    nav.setAttribute('aria-label', 'Navegar pelas mensagens enviadas');
    nav.hidden = true;
    const rail = document.createElement('div'); rail.className = 'message-navigator__rail';
    const panel = document.createElement('div'); panel.className = 'message-navigator__panel'; panel.hidden = true;
    const list = document.createElement('div'); list.className = 'message-navigator__list';
    panel.append(list); nav.append(rail, panel); document.body.append(nav);
    let entries = [], current = '', frame = 0;
    function open() { panel.hidden = false; nav.classList.add('is-open'); }
    function close() { panel.hidden = true; nav.classList.remove('is-open'); }
    function go(index) {
        const entry = entries[index]; if (!entry) return;
        const header = document.querySelector('.workspace__header');
        const offset = (header?.getBoundingClientRect().height || 52) + 24;
        window.scrollTo({top: Math.max(0, scrollY + entry.message.getBoundingClientRect().top - offset), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
        close();
    }
    function update() {
        frame = 0; if (!entries.length) return;
        const target = (document.querySelector('.workspace__header')?.getBoundingClientRect().height || 52) + 50;
        let index = 0;
        entries.forEach((entry, i) => { if (entry.message.getBoundingClientRect().top <= target) index = i; });
        const headerBottom = Math.max(0, document.querySelector('.workspace__header')?.getBoundingClientRect().bottom || 0);
        const composerTop = Math.min(innerHeight, document.querySelector('.computer-composer')?.getBoundingClientRect().top ?? innerHeight);
        const visible = entries.map((entry, i) => ({i, rect: entry.message.getBoundingClientRect()}))
            .filter(({rect}) => rect.bottom > headerBottom && rect.top < composerTop)
            .map(({i}) => i);
        const active = visible.length ? visible : [index];
        const signature = active.join(',');
        if (signature === current) return;
        current = signature;
        entries.forEach((entry, i) => {
            for (const button of [entry.mark, entry.item]) {
                if (active.includes(i)) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
            }
        });
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    function rebuild() {
        const nodes = [...messages.querySelectorAll('.computer-message--user')];
        if (nodes.length === entries.length && nodes.every((node, i) => node === entries[i].message)) return;
        rail.replaceChildren(); list.replaceChildren(); current = '';
        entries = nodes.map((message, index) => {
            const text = message.querySelector('.computer-message__text').textContent.trim();
            const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'message-navigator__mark';
            mark.setAttribute('aria-label', `Mensagem ${index + 1}: ${text.slice(0, 100)}`);
            const item = document.createElement('button'); item.type = 'button'; item.textContent = text; item.title = text;
            item.setAttribute('aria-label', `Ir para mensagem ${index + 1}: ${text.slice(0, 100)}`);
            mark.addEventListener('click', () => { if (matchMedia('(hover: none)').matches && panel.hidden) open(); else go(index); });
            item.addEventListener('click', () => go(index));
            rail.append(mark); list.append(item);
            return {message, mark, item};
        });
        nav.hidden = !entries.length;
        if (!entries.length) close();
        schedule();
    }
    nav.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(); });
    nav.addEventListener('pointerleave', () => { if (!nav.contains(document.activeElement)) close(); });
    nav.addEventListener('focusin', open);
    nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget)) close(); });
    nav.addEventListener('keydown', event => {
        if (event.key === 'Escape') { close(); document.activeElement.blur(); event.stopPropagation(); }
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            const buttons = [...list.children]; let index = buttons.indexOf(document.activeElement);
            index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
            event.preventDefault(); buttons[index]?.focus();
        }
    });
    document.addEventListener('pointerdown', event => { if (!nav.contains(event.target)) close(); });
    window.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('resize', schedule);
    new ResizeObserver(schedule).observe(messages);
    const composer = document.querySelector('.computer-composer');
    if (composer) new ResizeObserver(schedule).observe(composer);
    new MutationObserver(rebuild).observe(messages, {childList:true});
    rebuild();
})();
