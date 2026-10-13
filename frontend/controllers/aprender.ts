import { optionalElement, requiredElement, elementList } from './dom';
export default function mount({scope, ResizeObserver, MutationObserver, requestAnimationFrame}: PageContext) {
    const page = optionalElement(document, '.study-page', HTMLElement);
    if (!page) return;
    const form = requiredElement(page, 'form', HTMLFormElement);
    const input = requiredElement(form, 'textarea', HTMLTextAreaElement);
    const send = requiredElement(form, '.home__send', HTMLButtonElement);
    const microphone = requiredElement(form, ".home__microphone", HTMLButtonElement);
    let sending = false;
    function controls() {
        send.disabled = sending || window.ComputerAttachments.busy() || (microphone.getAttribute('aria-pressed') !== 'true' && !input.value.trim() && !window.ComputerAttachments.files().length);
        resizeInput();
    }
    function resizeInput() {
        input.style.height = '0px';
        input.style.height = Math.min(input.scrollHeight, 240) + 'px';
    }
    let inputWidth = 0;
    new ResizeObserver(() => {
        if (input.clientWidth === inputWidth) return;
        inputWidth = input.clientWidth;
        resizeInput();
    }).observe(input);
    scope.listen(window, 'resize', resizeInput);
    document.fonts.addEventListener('loadingdone', resizeInput, {signal: scope.signal});
    scope.cleanup(() => document.fonts.removeEventListener('loadingdone', resizeInput));
    void document.fonts.ready.then(() => { if (scope.active) resizeInput(); });
    new MutationObserver(controls).observe(microphone, {attributes:true, attributeFilter:['aria-pressed']});
    scope.listen(window, 'attachments:changed', controls);
    input.addEventListener('input', controls, {signal: scope.signal});
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (send.disabled || microphone.getAttribute('aria-pressed') === 'true') return;
        sending = true;
        window.CometStudyQuestion = {message: input.value.trim() || 'Analise os arquivos anexados.', attachments: window.ComputerAttachments.files(), provider: window.ComputerModels.selected()};
        controls();
        void window.WorkspaceNavigation.go('/novo.html?new=1&study=1');
    }, {signal: scope.signal});
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    }, {signal: scope.signal});
    const list = requiredElement(page, '.study-topic-list', HTMLElement);
    const buttons = elementList(page, '[data-topic-direction]', HTMLButtonElement);
    function updateList() {
        buttons.forEach(button => { button.disabled = Number(button.dataset.topicDirection) < 0 ? list.scrollLeft < 2 : list.scrollLeft + list.clientWidth >= list.scrollWidth - 2; });
    }
    let animation = 0;
    function stopScroll() {
        cancelAnimationFrame(animation);
        animation = 0;
        list.style.removeProperty('scroll-snap-type');
    }
    function scrollTopics(direction: number) {
        stopScroll();
        const start = list.scrollLeft, maximum = list.scrollWidth - list.clientWidth;
        const proposed = Math.max(0, Math.min(maximum, start + direction * list.clientWidth));
        const stops = [0, maximum, ...elementList(list, 'li', HTMLElement).map(item => Math.min(maximum, item.offsetLeft - list.offsetLeft))];
        const target = stops.reduce((nearest, value) => Math.abs(value - proposed) < Math.abs(nearest - proposed) ? value : nearest, proposed === maximum ? maximum : 0);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { list.scrollLeft = target; return; }
        list.style.scrollSnapType = 'none';
        const began = performance.now();
        function frame(now: number) {
            const progress = Math.min(1, (now - began) / 1200);
            list.scrollLeft = start + (target - start) * (1 - Math.pow(1 - progress, 4));
            if (progress < 1) animation = requestAnimationFrame(frame);
            else stopScroll();
        }
        animation = requestAnimationFrame(frame);
    }
    buttons.forEach(button => button.addEventListener('click', () => scrollTopics(Number(button.dataset.topicDirection)), {signal: scope.signal}));
    for (const event of ['wheel', 'pointerdown', 'keydown'] as const) scope.listen(list, event, stopScroll);
    scope.listen(window, 'resize', stopScroll);
    scope.cleanup(stopScroll);
    list.addEventListener('scroll', updateList, {signal: scope.signal});
    new ResizeObserver(updateList).observe(list);
    controls(); updateList();
}
