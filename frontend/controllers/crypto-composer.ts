import { optionalElement, requiredElement } from './dom';
export default function mount({scope, requestAnimationFrame, ResizeObserver, MutationObserver}: PageContext) {
    const composer = optionalElement(document, '.crypto-composer', HTMLElement);
    if (!composer) return;
    const column = requiredElement(document, '.crypto-main', HTMLElement);
    const page = requiredElement(document, '.crypto-page', HTMLElement);
    const form = requiredElement(composer, 'form', HTMLFormElement);
    const input = requiredElement(form, 'textarea', HTMLTextAreaElement);
    const send = requiredElement(form, '.home__send', HTMLButtonElement);
    const error = requiredElement(composer, '.crypto-composer-error', HTMLElement);
    function align() {
        const bounds = column.getBoundingClientRect();
        page.style.setProperty('--finance-composer-left', bounds.left + 'px');
        page.style.setProperty('--finance-composer-width', bounds.width + 'px');
        page.style.setProperty('--finance-composer-height', composer!.offsetHeight + 'px');
    }
    const observer = new ResizeObserver(align);
    observer.observe(column); observer.observe(composer);
    scope.listen(window, 'resize', align);
    let frame = 0;
    new MutationObserver(() => {
        cancelAnimationFrame(frame);
        const start = performance.now();
        function follow(time: number) { align(); if (time - start < 550) frame = requestAnimationFrame(follow); }
        frame = requestAnimationFrame(follow);
    }).observe(requiredElement(document, '.workspace', HTMLElement), {attributes:true, attributeFilter:['class']});
    function update() {
        input.style.height = 'auto';
        input.style.height = Math.max(parseFloat(getComputedStyle(input).lineHeight), Math.min(input.scrollHeight, 120)) + 'px';
        send.classList.toggle('is-empty', !input.value.trim());
    }
    scope.listen(input, 'input', update);
    scope.listen(input, 'keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (!form.classList.contains('is-dictating')) form.requestSubmit();
        }
    });
    let busy = false;
    scope.listen(form, 'submit', async event => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message || busy || form.classList.contains('is-dictating')) return;
        busy = true; send.disabled = true; input.readOnly = true; error.hidden = true;
        try {
            await window.ComputerModels.whenReady();
            if (!scope.active) return;
            const modelError = window.ComputerModels.error();
            if (modelError) throw new Error(modelError);
            window.CometCryptoQuestion = {message, provider:window.ComputerModels.selected()};
            await window.WorkspaceNavigation.go('/new?new=1&crypto=1');
        } catch (failure) {
            delete window.CometCryptoQuestion;
            if (scope.active) { error.textContent = failure instanceof Error ? failure.message : 'Não foi possível enviar. Tente novamente.'; error.hidden = false; }
        } finally {
            if (scope.active) { busy = false; send.disabled = false; input.readOnly = false; }
        }
    });
    update(); align();
}
