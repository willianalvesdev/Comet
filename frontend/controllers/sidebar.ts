import { optionalElement, requiredElement, present, eventElement, elementList } from './dom';
import { record } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const workspace = optionalElement(document, ".workspace", HTMLElement);
    const toggle = optionalElement(document, ".sidebar__toggle", HTMLButtonElement);
    if (!workspace || !toggle) return;
    const sidebar = requiredElement(document, ".sidebar", HTMLElement);
    const mobileToggle = () => requiredElement(document, ".workspace__menu-toggle", HTMLButtonElement);
    const backdrop = requiredElement(document, ".sidebar-backdrop", HTMLElement);
    const content = () => requiredElement(document, ".workspace__content", HTMLElement);
    const nav = requiredElement(document, '.sidebar__nav', HTMLElement);
    function updateScrollFades() {
        sidebar.classList.toggle('is-nav-scrolled', nav.scrollTop > 0);
        sidebar.classList.toggle('has-nav-overflow', nav.scrollHeight - nav.clientHeight - nav.scrollTop > 1);
    }
    nav.addEventListener('scroll', updateScrollFades, {...{passive:true}, signal: scope.signal});
    nav.addEventListener('toggle', () => requestAnimationFrame(updateScrollFades), {capture:true, signal: scope.signal});
    new ResizeObserver(updateScrollFades).observe(nav);
    new MutationObserver(updateScrollFades).observe(nav, {childList:true, subtree:true, characterData:true});
    updateScrollFades();
    const smallScreen = window.matchMedia("(width < 640px)");
    const storageKey = "ascensao-sidebar-collapsed";
    let initialCollapsed = smallScreen.matches;

    try {
        const account = optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
        const layout = record(JSON.parse(sessionStorage.getItem('ascenda-sidebar-' + account) || '{}'));
        const savedState = typeof layout.collapsed === 'boolean' ? String(layout.collapsed) : window.CometStorage.getItem(storageKey);
        if (!smallScreen.matches && (savedState === "true" || savedState === "false")) {
            initialCollapsed = savedState === "true";
        }
    } catch {
    }

    function setCollapsed(collapsed: boolean) {
        present(workspace).classList.toggle("is-sidebar-collapsed", collapsed);
        if (collapsed) optionalElement(document, "#notifications-panel:popover-open", HTMLElement)?.hidePopover();
        present(toggle).setAttribute("aria-expanded", String(!collapsed));
        const label = collapsed ? "Expandir menu" : "Recolher menu";
        present(toggle).setAttribute("aria-label", label);
        present(toggle).title = label;
        mobileToggle()?.setAttribute("aria-expanded", String(!collapsed));
        sidebar.inert = smallScreen.matches && collapsed;
        content().inert = smallScreen.matches && !collapsed;
        backdrop.hidden = !smallScreen.matches || collapsed;
        try {
            window.CometStorage.setItem(storageKey, String(collapsed));
        } catch {
        }
    }

    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'sidebar__resize';
    resize.setAttribute('aria-label', 'Ajustar largura do menu');
    resize.title = 'Arraste para ajustar a largura';
    sidebar.append(resize);
    const minimumWidth = parseFloat(getComputedStyle(workspace).getPropertyValue('--sidebar-default-width'));
    const widthStorageKey = 'ascensao-sidebar-width';
    try {
        const savedWidth = Number(localStorage.getItem(widthStorageKey));
        if (Number.isFinite(savedWidth) && savedWidth >= minimumWidth && savedWidth <= 400) {
            workspace.style.setProperty('--sidebar-expanded-width', `${savedWidth}px`);
        }
    } catch {}
    function resizeTo(width: number) {
        const nextWidth = Math.max(minimumWidth, Math.min(400, innerWidth - 320, width));
        present(workspace).style.setProperty('--sidebar-expanded-width', `${nextWidth}px`);
        try { localStorage.setItem(widthStorageKey, String(nextWidth)); } catch {}
        window.dispatchEvent(new Event('resize'));
    }
    let drag: {pointer: number; x: number; width: number} | null = null;
    function stopResize() {
        if (!drag) return;
        const pointer = drag.pointer;
        drag = null;
        present(workspace).classList.remove('is-sidebar-resizing');
        if (resize.hasPointerCapture(pointer)) resize.releasePointerCapture(pointer);
    }
    scope.cleanup(() => { stopResize(); resize.remove(); });
    resize.addEventListener('pointerdown', event => {
        if (event.button !== 0 || smallScreen.matches) return;
        event.preventDefault();
        drag = {pointer:event.pointerId, x:event.clientX, width:sidebar.getBoundingClientRect().width};
        resize.setPointerCapture(event.pointerId);
        workspace.classList.add('is-sidebar-resizing');
    }, {signal: scope.signal});
    resize.addEventListener('pointermove', event => {
        if (!drag || drag.pointer !== event.pointerId) return;
        const width = drag.width + event.clientX - drag.x;
        if (width < minimumWidth - 80) {
            resizeTo(minimumWidth);
            stopResize();
            setCollapsed(true);
            toggle.focus();
        } else resizeTo(width);
    }, {signal: scope.signal});
    resize.addEventListener('pointerup', stopResize, {signal: scope.signal});
    resize.addEventListener('pointercancel', stopResize, {signal: scope.signal});
    resize.addEventListener('lostpointercapture', stopResize, {signal: scope.signal});
    resize.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        resizeTo(sidebar.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -20 : 20));
    }, {signal: scope.signal});

    setCollapsed(initialCollapsed);
    requestAnimationFrame(() => requestAnimationFrame(() => workspace.classList.add("sidebar-ready")));
    if (smallScreen.matches && !initialCollapsed) toggle.focus();
    smallScreen.addEventListener("change", (event) => {
        const focusWasInSidebar = sidebar.contains(document.activeElement);
        setCollapsed(event.matches);
        if (event.matches && focusWasInSidebar) mobileToggle()?.focus();
    }, {signal: scope.signal});

    function closeMobileMenu() {
        setCollapsed(true);
        mobileToggle()?.focus();
    }

    document.addEventListener("click", event => {
        if (!eventElement(event.target)?.closest('.workspace__menu-toggle')) return;
        setCollapsed(false); toggle.focus();
    }, {signal: scope.signal});
    window.addEventListener('workspace:before-mount', () => {
        setCollapsed(smallScreen.matches || workspace.classList.contains('is-sidebar-collapsed'));
    }, {signal: scope.signal});
    backdrop.addEventListener("click", closeMobileMenu, {signal: scope.signal});

    toggle.addEventListener("click", () => {
        setCollapsed(!workspace.classList.contains("is-sidebar-collapsed"));
        if (smallScreen.matches) mobileToggle()?.focus();
    }, {signal: scope.signal});

    sidebar.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setCollapsed(true);
            (smallScreen.matches ? mobileToggle() : toggle)?.focus();
        }
        if (event.key === "Tab" && smallScreen.matches) {
            const buttons = [...elementList(sidebar, "button, a[href]", HTMLAnchorElement)].filter(button => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden");
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }, {signal: scope.signal});
}
