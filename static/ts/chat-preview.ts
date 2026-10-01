(() => {
    const list = optionalElement(document, '.sidebar__nav', HTMLElement);
    if (!list) return;
    const preview = document.createElement('div');
    preview.className = 'chat-preview'; preview.id = 'chat-preview'; preview.hidden = true;
    preview.setAttribute('role', 'tooltip');
    preview.innerHTML = '<time class="chat-preview__time"></time><p class="chat-preview__question"></p><p class="chat-preview__answer"></p>';
    document.body.append(preview);
    const stamp = requiredElement(preview, 'time', HTMLTimeElement), question = requiredElement(preview, '.chat-preview__question', HTMLElement), answer = requiredElement(preview, '.chat-preview__answer', HTMLElement);
    const relative = new Intl.RelativeTimeFormat('pt-BR', {numeric:'always'});
    let anchor: HTMLAnchorElement | null = null, timer = 0, closeTimer = 0, controller: AbortController | undefined, version = 0;
    function hide() {
        clearTimeout(timer); clearTimeout(closeTimer); controller?.abort(); version++;
        anchor?.removeAttribute('aria-describedby'); anchor = null; preview.hidden = true;
    }
    function elapsed(value: string) {
        const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
        if (seconds < 60) return 'Agora';
        for (const [unit, size] of ([['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60]] satisfies [Intl.RelativeTimeFormatUnit, number][])) {
            if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
        }
        return '';
    }
    function position() {
        const rect = present(anchor?.closest('.sessions__row')).getBoundingClientRect();
        const width = Math.min(340, innerWidth - 24);
        preview.style.width = width + 'px';
        preview.style.left = Math.max(12, Math.min(rect.right + 8, innerWidth - width - 12)) + 'px';
        preview.style.top = Math.max(12, Math.min(rect.top, innerHeight - preview.offsetHeight - 12)) + 'px';
    }
    function open(link: HTMLAnchorElement) {
        if (link === anchor) { clearTimeout(closeTimer); return; }
        hide(); anchor = link; const current = version;
        timer = setTimeout(async () => {
            controller = new AbortController();
            try {
                const id = present(link.closest<HTMLElement>('.sessions__row')?.dataset.id);
                const response = await fetch('/api/ai/conversations/' + encodeURIComponent(id) + '/preview', {credentials:'same-origin',cache:'no-store',signal:controller.signal});
                if (!response.ok) return;
                const data = record(await response.json());
                const message = optionalString(data.message), text = optionalString(data.answer), created = optionalString(data.created_at) || ''; 
                if (current !== version || !link.isConnected) return;
                question.textContent = message || 'Conversa sem mensagens';
                answer.textContent = text || 'Resposta ainda não disponível.';
                const date = new Date(created);
                present(stamp).hidden = !created || Number.isNaN(date.getTime());
                present(stamp).textContent = present(stamp).hidden ? '' : elapsed(created);
                if (!present(stamp).hidden) { present(stamp).dateTime = date.toISOString(); present(stamp).title = date.toLocaleString('pt-BR'); }
                preview.hidden = false; position(); link.setAttribute('aria-describedby', preview.id);
            } catch {   }
        }, 260);
    }
    function closeSoon() { clearTimeout(closeTimer); closeTimer = setTimeout(hide, 150); }
    list.addEventListener('pointerover', event => { const link = eventElement(event.target)?.closest<HTMLAnchorElement>('.sessions__link'); if (link && event.pointerType !== 'touch') open(link); });
    list.addEventListener('pointerout', event => { if (eventElement(event.target)?.closest<HTMLAnchorElement>('.sessions__link') && !anchor?.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null) && !preview.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) closeSoon(); });
    list.addEventListener('focusin', event => { const link = eventElement(event.target)?.closest<HTMLAnchorElement>('.sessions__link'); if (link) open(link); });
    list.addEventListener('focusout', closeSoon);
    preview.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    preview.addEventListener('pointerleave', closeSoon);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    function clearTitles(root: Node) {
        if (!(root instanceof Element)) return;
        if (root.matches('.sessions__link[title]')) root.removeAttribute('title');
        elementList(root, '.sessions__link[title]', HTMLAnchorElement).forEach(link => link.removeAttribute('title'));
    }
    new MutationObserver(records => {
        if (anchor && !anchor.isConnected) hide();
        records.forEach(record => record.addedNodes.forEach(clearTitles));
    }).observe(list, {childList:true,subtree:true});
    clearTitles(list);
})();
