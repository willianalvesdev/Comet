import { elementList, eventElement } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const tip = document.createElement('div');
    tip.className = 'site-tooltip'; tip.id = 'site-tooltip'; tip.setAttribute('role', 'tooltip');
    tip.setAttribute('popover', 'manual'); scope.append(tip);
    let active: HTMLElement | null = null, timer = 0;
    function prepareTitle(node: Node) {
        if (!(node instanceof HTMLElement) || !node.hasAttribute('title')) return;
        if (node.matches('.sessions__link, [data-chat-id]')) { node.removeAttribute('title'); delete node.dataset.tooltip; return; }
        if (node.title) node.dataset.tooltip = node.title;
        node.removeAttribute('title');
    }
    function prepare(root: Node) {
        if (!(root instanceof HTMLElement)) return;
        elementList(root, '[title]', HTMLElement).forEach(prepareTitle);
        prepareTitle(root);
    }
    prepare(document.body);
    new MutationObserver(records => records.forEach(record => {
        if (record.type === 'attributes') prepareTitle(record.target);
        else record.addedNodes.forEach(prepare);
    })).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['title']});
    function hide() {
        clearTimeout(timer);
        if (tip.matches(':popover-open')) tip.hidePopover();
        if (active?.getAttribute('aria-describedby') === tip.id) active.removeAttribute('aria-describedby');
        active = null;
    }
    function show(node: HTMLElement | null | undefined) {
        if (!node || node === active) return;
        hide(); active = node;
        timer = setTimeout(() => {
            if (!node.isConnected) return hide();
            tip.textContent = node.dataset.tooltip || ''; tip.showPopover();
            const rect = node.getBoundingClientRect();
            tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, rect.left + (rect.width-tip.offsetWidth)/2)) + 'px';
            tip.style.top = Math.max(8, rect.top > tip.offsetHeight + 12 ? rect.top-tip.offsetHeight-8 : rect.bottom+8) + 'px';
            if (!node.hasAttribute('aria-describedby')) node.setAttribute('aria-describedby',tip.id);
        }, 450);
    }
    document.addEventListener('pointerover', event => { if(event.pointerType !== 'touch') show(eventElement(event.target)?.closest<HTMLElement>('[data-tooltip]')); }, {signal: scope.signal});
    document.addEventListener('pointerout', event => { if(active && !active.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) hide(); }, {signal: scope.signal});
    document.addEventListener('focusin', event => show(eventElement(event.target)?.closest<HTMLElement>('[data-tooltip]')), {signal: scope.signal});
    document.addEventListener('focusout', hide, {signal: scope.signal});
    document.addEventListener('pointerdown', hide, {signal: scope.signal});
    document.addEventListener('keydown', event => { if(event.key === 'Escape') hide(); }, {signal: scope.signal});
    window.addEventListener('scroll',hide,{capture:true, signal: scope.signal});
}
