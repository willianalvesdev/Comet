import { optionalElement, requiredElement, present } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    if (window.self !== window.top && new URLSearchParams(location.search).get('panel') === '1') {
        document.documentElement.classList.add('discovery-embedded');
        return;
    }
    const trigger = optionalElement(document, '.mobile-discover-toggle', HTMLButtonElement);
    const panel = optionalElement(document, "#mobile-discovery-panel", HTMLDialogElement);
    if (!trigger || !panel) return;
    const frame = requiredElement(panel, 'iframe', HTMLIFrameElement);
    let timer = 0;
    function close() {
        present(panel).classList.remove('is-visible');
        document.documentElement.classList.remove('discovery-panel-shift');
        clearTimeout(timer);
        const duration = parseFloat(getComputedStyle(present(panel)).transitionDuration) * 1000 || 0;
        timer = setTimeout(() => present(panel).close(), duration);
    }
    trigger.addEventListener('click', () => {
        clearTimeout(timer);
        if (!present(frame).getAttribute('src')) present(frame).src = present(frame).dataset.src || '';
        panel.showModal();
        document.documentElement.classList.add('discovery-panel-open');
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!panel.open) return;
            panel.classList.add('is-visible');
            document.documentElement.classList.add('discovery-panel-shift');
        }));
    }, {signal: scope.signal});
    requiredElement(panel, 'button', HTMLButtonElement).addEventListener('click', close, {signal: scope.signal});
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); }, {signal: scope.signal});
    panel.addEventListener('close', () => {
        panel.classList.remove('is-visible');
        document.documentElement.classList.remove('discovery-panel-shift');
        document.documentElement.classList.remove('discovery-panel-open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    }, {signal: scope.signal});
    scope.listen(matchMedia('(width < 640px)'), 'change', event => {
        if (event instanceof MediaQueryListEvent && !event.matches && panel.open) panel.close();
    });
}
