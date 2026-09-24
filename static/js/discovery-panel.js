(() => {
    if (window.self !== window.top && new URLSearchParams(location.search).get('panel') === '1') {
        document.documentElement.classList.add('discovery-embedded');
        return;
    }
    const trigger = document.querySelector('.mobile-discover-toggle');
    const panel = document.getElementById('mobile-discovery-panel');
    if (!trigger || !panel) return;
    const frame = panel.querySelector('iframe');
    let timer;
    function close() {
        panel.classList.remove('is-visible');
        document.documentElement.classList.remove('discovery-panel-shift');
        clearTimeout(timer);
        const duration = parseFloat(getComputedStyle(panel).transitionDuration) * 1000 || 0;
        timer = setTimeout(() => panel.close(), duration);
    }
    trigger.addEventListener('click', () => {
        clearTimeout(timer);
        if (!frame.getAttribute('src')) frame.src = frame.dataset.src;
        panel.showModal();
        document.documentElement.classList.add('discovery-panel-open');
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!panel.open) return;
            panel.classList.add('is-visible');
            document.documentElement.classList.add('discovery-panel-shift');
        }));
    });
    panel.querySelector('button').addEventListener('click', close);
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
    panel.addEventListener('close', () => {
        panel.classList.remove('is-visible');
        document.documentElement.classList.remove('discovery-panel-shift');
        document.documentElement.classList.remove('discovery-panel-open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    });
    matchMedia('(width < 640px)').addEventListener('change', event => {
        if (!event.matches && panel.open) panel.close();
    });
})();
