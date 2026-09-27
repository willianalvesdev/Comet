(() => {
    const list = document.querySelector('.sidebar__nav');
    if (!list) return;
    const preview = document.createElement('div');
    preview.className = 'chat-preview'; preview.id = 'chat-preview'; preview.hidden = true;
    preview.setAttribute('role', 'tooltip');
    preview.innerHTML = '<time class="chat-preview__time"></time><p class="chat-preview__question"></p><p class="chat-preview__answer"></p>';
    document.body.append(preview);
    const stamp = preview.querySelector('time'), question = preview.querySelector('.chat-preview__question'), answer = preview.querySelector('.chat-preview__answer');
    const relative = new Intl.RelativeTimeFormat('pt-BR', {numeric:'always'});
    let anchor = null, timer, closeTimer, controller, version = 0;
    function hide() {
        clearTimeout(timer); clearTimeout(closeTimer); controller?.abort(); version++;
        anchor?.removeAttribute('aria-describedby'); anchor = null; preview.hidden = true;
    }
    function elapsed(value) {
        const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
        if (seconds < 60) return 'Agora';
        for (const [unit, size] of [['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60]]) {
            if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
        }
        return '';
    }
    function position() {
        const rect = anchor.closest('.sessions__row').getBoundingClientRect();
        const width = Math.min(340, innerWidth - 24);
        preview.style.width = width + 'px';
        preview.style.left = Math.max(12, Math.min(rect.right + 8, innerWidth - width - 12)) + 'px';
        preview.style.top = Math.max(12, Math.min(rect.top, innerHeight - preview.offsetHeight - 12)) + 'px';
    }
    function open(link) {
        if (link === anchor) { clearTimeout(closeTimer); return; }
        hide(); anchor = link; const current = version;
        timer = setTimeout(async () => {
            controller = new AbortController();
            try {
                const id = link.closest('.sessions__row').dataset.id;
                const response = await fetch('/api/ai/conversations/' + encodeURIComponent(id) + '/preview', {credentials:'same-origin',cache:'no-store',signal:controller.signal});
                if (!response.ok) return;
                const data = await response.json();
                if (current !== version || !link.isConnected) return;
                question.textContent = data.message || 'Conversa sem mensagens';
                answer.textContent = data.answer || 'Resposta ainda não disponível.';
                const date = new Date(data.created_at);
                stamp.hidden = !data.created_at || Number.isNaN(date.getTime());
                stamp.textContent = stamp.hidden ? '' : elapsed(data.created_at);
                if (!stamp.hidden) { stamp.dateTime = date.toISOString(); stamp.title = date.toLocaleString('pt-BR'); }
                preview.hidden = false; position(); link.setAttribute('aria-describedby', preview.id);
            } catch { /* Hover failures do not interrupt conversation navigation. */ }
        }, 260);
    }
    function closeSoon() { clearTimeout(closeTimer); closeTimer = setTimeout(hide, 150); }
    list.addEventListener('pointerover', event => { const link = event.target.closest('.sessions__link'); if (link && event.pointerType !== 'touch') open(link); });
    list.addEventListener('pointerout', event => { if (event.target.closest('.sessions__link') && !anchor?.contains(event.relatedTarget) && !preview.contains(event.relatedTarget)) closeSoon(); });
    list.addEventListener('focusin', event => { const link = event.target.closest('.sessions__link'); if (link) open(link); });
    list.addEventListener('focusout', closeSoon);
    preview.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    preview.addEventListener('pointerleave', closeSoon);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    new MutationObserver(() => { if (anchor && !anchor.isConnected) hide(); }).observe(list, {childList:true,subtree:true});
    // Replace the browser's native title popup with this richer preview.
    const clearTitles = () => list.querySelectorAll('.sessions__link[title]').forEach(link => link.removeAttribute('title'));
    new MutationObserver(clearTitles).observe(list, {childList:true,subtree:true}); clearTitles();
})();
