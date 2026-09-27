(() => {
    const tip = document.createElement('div');
    tip.className = 'site-tooltip'; tip.id = 'site-tooltip'; tip.setAttribute('role', 'tooltip');
    tip.setAttribute('popover', 'manual'); document.body.append(tip);
    let active, timer;
    function prepare(root) {
        if (root.nodeType !== 1) return;
        const nodes = [...root.querySelectorAll('[title]')];
        if (root.hasAttribute('title')) nodes.push(root);
        nodes.forEach(node => {
            if (node.title) node.dataset.tooltip = node.title;
            node.removeAttribute('title');
        });
    }
    prepare(document.body);
    new MutationObserver(records => records.forEach(record => {
        if (record.type === 'attributes') prepare(record.target);
        else record.addedNodes.forEach(prepare);
    })).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['title']});
    function hide() {
        clearTimeout(timer);
        if (tip.matches(':popover-open')) tip.hidePopover();
        if (active?.getAttribute('aria-describedby') === tip.id) active.removeAttribute('aria-describedby');
        active = null;
    }
    function show(node) {
        if (!node || node === active) return;
        hide(); active = node;
        timer = setTimeout(() => {
            if (!node.isConnected) return hide();
            tip.textContent = node.dataset.tooltip; tip.showPopover();
            const rect = node.getBoundingClientRect();
            tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, rect.left + (rect.width-tip.offsetWidth)/2)) + 'px';
            tip.style.top = Math.max(8, rect.top > tip.offsetHeight + 12 ? rect.top-tip.offsetHeight-8 : rect.bottom+8) + 'px';
            if (!node.hasAttribute('aria-describedby')) node.setAttribute('aria-describedby',tip.id);
        }, 450);
    }
    document.addEventListener('pointerover', event => { if(event.pointerType !== 'touch') show(event.target.closest('[data-tooltip]')); });
    document.addEventListener('pointerout', event => { if(active && !active.contains(event.relatedTarget)) hide(); });
    document.addEventListener('focusin', event => show(event.target.closest('[data-tooltip]')));
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', event => { if(event.key === 'Escape') hide(); });
    window.addEventListener('scroll',hide,true);
})();
