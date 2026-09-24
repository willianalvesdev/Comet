(() => {
    const workspace = document.querySelector(".workspace");
    const toggle = document.querySelector(".sidebar__toggle");
    if (!workspace || !toggle) return;
    const sidebar = document.querySelector(".sidebar");
    const mobileToggle = document.querySelector(".workspace__menu-toggle");
    const backdrop = document.querySelector(".sidebar-backdrop");
    const content = document.querySelector(".workspace__content");
    const smallScreen = window.matchMedia("(width < 640px)");
    const storageKey = "ascensao-sidebar-collapsed";
    let initialCollapsed = smallScreen.matches;

    try {
        const savedState = window.AscendaStorage.getItem(storageKey);
        if (savedState === "true" || savedState === "false") {
            initialCollapsed = savedState === "true";
        }
    } catch {
        // Use the screen-size default if browser storage is unavailable.
    }

    function setCollapsed(collapsed) {
        workspace.classList.toggle("is-sidebar-collapsed", collapsed);
        toggle.setAttribute("aria-expanded", String(!collapsed));
        const label = collapsed ? "Expandir menu" : "Recolher menu";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        mobileToggle.setAttribute("aria-expanded", String(!collapsed));
        sidebar.inert = smallScreen.matches && collapsed;
        content.inert = smallScreen.matches && !collapsed;
        backdrop.hidden = !smallScreen.matches || collapsed;
        try {
            window.AscendaStorage.setItem(storageKey, String(collapsed));
        } catch {
            // The menu remains usable even when its state cannot be saved.
        }
    }

    setCollapsed(initialCollapsed);
    if (smallScreen.matches && !initialCollapsed) toggle.focus();
    smallScreen.addEventListener("change", (event) => {
        const focusWasInSidebar = sidebar.contains(document.activeElement);
        setCollapsed(event.matches);
        if (event.matches && focusWasInSidebar) mobileToggle.focus();
    });

    function closeMobileMenu() {
        setCollapsed(true);
        mobileToggle.focus();
    }

    mobileToggle.addEventListener("click", () => {
        setCollapsed(false);
        toggle.focus();
    });
    backdrop.addEventListener("click", closeMobileMenu);

    toggle.addEventListener("click", () => {
        setCollapsed(!workspace.classList.contains("is-sidebar-collapsed"));
        if (smallScreen.matches) mobileToggle.focus();
    });

    sidebar.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setCollapsed(true);
            (smallScreen.matches ? mobileToggle : toggle).focus();
        }
        if (event.key === "Tab" && smallScreen.matches) {
            const buttons = [...sidebar.querySelectorAll("button, a[href]")].filter(button => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden");
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
