(() => {
    const composer = document.querySelector('.finance-composer');
    if (!composer) return;
    const column = document.querySelector('.finance-chart-column');
    const page = document.querySelector('.finance-page');
    function alignComposer() {
        const bounds = column.getBoundingClientRect();
        page.style.setProperty('--finance-composer-left', bounds.left + 'px');
        page.style.setProperty('--finance-composer-width', bounds.width + 'px');
        page.style.setProperty('--finance-composer-height', composer.offsetHeight + 'px');
    }
    const observer = new ResizeObserver(alignComposer);
    observer.observe(column);
    observer.observe(composer);
    window.addEventListener('resize', alignComposer);
    let animationFrame;
    function followSidebar() {
        cancelAnimationFrame(animationFrame);
        const start = performance.now();
        function frame(now) {
            alignComposer();
            if (now - start < 550) animationFrame = requestAnimationFrame(frame);
        }
        animationFrame = requestAnimationFrame(frame);
    }
    new MutationObserver(followSidebar).observe(document.querySelector('.workspace'), { attributes: true, attributeFilter: ['class'] });
    alignComposer();
    const modes = [...composer.querySelectorAll('[data-composer-mode]')];
    modes.forEach(button => button.addEventListener('click', () => {
        const computer = button.dataset.composerMode === 'computer';
        composer.classList.toggle('is-computer', computer);
        modes.forEach(mode => mode.setAttribute('aria-pressed', String(mode === button)));
        composer.querySelector('textarea').placeholder = computer ? 'Faça qualquer coisa...' : 'Digite sua pergunta...';
    }));
    composer.querySelector('form').addEventListener('submit', event => event.preventDefault());
})();
