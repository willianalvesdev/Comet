import { optionalElement, present } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const header = optionalElement(document, ".site-header", HTMLElement);
    if (!header) return;

    function updateHeader() {
        present(header).classList.toggle("is-scrolled", window.scrollY > 0);
    }

    window.addEventListener("scroll", updateHeader, {...{ passive: true }, signal: scope.signal});
    window.addEventListener("pageshow", updateHeader, {signal: scope.signal});
    updateHeader();
}
