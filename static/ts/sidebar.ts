(() => {
    const workspace = optionalElement(document, ".workspace", HTMLElement);
    const toggle = optionalElement(document, ".sidebar__toggle", HTMLButtonElement);
    if (!workspace || !toggle) return;
    const sidebar = requiredElement(document, ".sidebar", HTMLElement);
    const mobileToggle = () => requiredElement(document, ".workspace__menu-toggle", HTMLButtonElement);
    const backdrop = requiredElement(document, ".sidebar-backdrop", HTMLElement);
    const content = () => requiredElement(document, ".workspace__content", HTMLElement);
    const nav = requiredElement(document, '.sidebar__nav', HTMLElement);
    nav.addEventListener('scroll', () => sidebar.classList.toggle('is-nav-scrolled', nav.scrollTop > 0), {passive:true});
    const smallScreen = window.matchMedia("(width < 640px)");
    const storageKey = "ascensao-sidebar-collapsed";
    let initialCollapsed = smallScreen.matches;

    try {
        const account = optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
        const layout = record(JSON.parse(sessionStorage.getItem('ascenda-sidebar-' + account) || '{}'));
        const savedState = typeof layout.collapsed === 'boolean' ? String(layout.collapsed) : window.AscendaStorage.getItem(storageKey);
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
            window.AscendaStorage.setItem(storageKey, String(collapsed));
        } catch {
        }
    }

    setCollapsed(initialCollapsed);
    requestAnimationFrame(() => requestAnimationFrame(() => workspace.classList.add("sidebar-ready")));
    if (smallScreen.matches && !initialCollapsed) toggle.focus();
    smallScreen.addEventListener("change", (event) => {
        const focusWasInSidebar = sidebar.contains(document.activeElement);
        setCollapsed(event.matches);
        if (event.matches && focusWasInSidebar) mobileToggle()?.focus();
    });

    function closeMobileMenu() {
        setCollapsed(true);
        mobileToggle()?.focus();
    }

    document.addEventListener("click", event => {
        if (!eventElement(event.target)?.closest('.workspace__menu-toggle')) return;
        setCollapsed(false); toggle.focus();
    });
    window.addEventListener('workspace:before-mount', () => {
        setCollapsed(smallScreen.matches || workspace.classList.contains('is-sidebar-collapsed'));
    });
    backdrop.addEventListener("click", closeMobileMenu);

    toggle.addEventListener("click", () => {
        setCollapsed(!workspace.classList.contains("is-sidebar-collapsed"));
        if (smallScreen.matches) mobileToggle()?.focus();
    });

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
    });
})();
