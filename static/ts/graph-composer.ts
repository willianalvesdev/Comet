window.WorkspaceNavigation.page('/static/js/graph-composer.js', ({scope, requestAnimationFrame, ResizeObserver, MutationObserver}) => {
    const composer = optionalElement(document, '.finance-composer', HTMLElement);
    if (!composer) return;
    const column = requiredElement(document, '.finance-chart-column', HTMLElement);
    const page = requiredElement(document, '.finance-page', HTMLElement);
    function alignComposer() {
        const bounds = column.getBoundingClientRect();
        page.style.setProperty('--finance-composer-left', bounds.left + 'px');
        page.style.setProperty('--finance-composer-width', bounds.width + 'px');
        page.style.setProperty('--finance-composer-height', present(composer).offsetHeight + 'px');
    }
    const observer = new ResizeObserver(alignComposer);
    observer.observe(column);
    observer.observe(composer);
    scope.listen(window, 'resize', alignComposer);
    let animationFrame = 0;
    function followSidebar() {
        cancelAnimationFrame(animationFrame);
        const start = performance.now();
        function frame(now: number) {
            alignComposer();
            if (now - start < 550) animationFrame = requestAnimationFrame(frame);
        }
        animationFrame = requestAnimationFrame(frame);
    }
    new MutationObserver(followSidebar).observe(requiredElement(document, '.workspace', HTMLElement), { attributes: true, attributeFilter: ['class'] });
    alignComposer();
    const input = optionalElement(composer, 'textarea', HTMLTextAreaElement);
    const send = requiredElement(composer, '.home__send', HTMLButtonElement);
    function updateInput() {
        present(input).style.height = 'auto';
        present(input).style.height = Math.max(38, Math.min(present(input).scrollHeight, 240)) + 'px';
        send.classList.toggle('is-empty', !present(input).value.trim());
    }
    present(input).addEventListener('input', updateInput);
    updateInput();
    requiredElement(composer, 'form', HTMLFormElement).addEventListener('submit', event => event.preventDefault());
    present(input).addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) event.preventDefault();
    });
});
