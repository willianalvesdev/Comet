(() => {
    const root = document.documentElement;
    const storageKey = "ascensao-theme";
    const system = matchMedia("(prefers-color-scheme: dark)");
    let preference = "system";
    try {
        const saved = window.CometStorage.getItem(storageKey);
        if (["light", "dark", "system"].includes(saved ?? '')) preference = saved ?? 'system';
    } catch {}
    let responseFont = 'serif';
    try {
        const saved = window.CometStorage.getItem('ascensao-response-font');
        if (['serif', 'sans'].includes(saved ?? '')) responseFont = saved ?? 'serif';
    } catch {}
    function applyFont() {
        root.style.setProperty('--font-prose', responseFont === 'sans' ? 'var(--font-body)' : 'var(--font-heading)');
        elementList(document, '[data-response-font]', HTMLElement).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.responseFont === responseFont)));
    }
    applyFont();
    function applyTheme() {
        const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
        root.dataset.theme = theme;
        const favicon = optionalElement(document, 'link[rel="icon"]', HTMLLinkElement);
        if (favicon) { favicon.type = "image/png"; favicon.href = theme === "light" ? "/static/img/icons/widget-light.png" : "/static/img/icons/widget-dark.png"; }
        const scheme = optionalElement(document, 'meta[name="color-scheme"]', HTMLMetaElement);
        if (scheme) scheme.content = theme;
        const color = optionalElement(document, 'meta[name="theme-color"]', HTMLMetaElement);
        if (color) color.content = theme === "light" ? "#fdfbfa" : "#171615";
        elementList(document, "[data-theme-choice]", HTMLButtonElement).forEach(button => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference)));
        const label = optionalElement(document, "[data-theme-label]", HTMLElement);
        const name = theme === "light" ? "Claro" : "Escuro";
        if (label) label.textContent = preference === "system" ? "Sistema (" + name + ")" : name;
    }
    applyTheme();
    system.addEventListener("change", () => { if (preference === "system") applyTheme(); });
    document.addEventListener("DOMContentLoaded", () => {
        applyTheme();
        applyFont();
        elementList(document, '[data-response-font]', HTMLElement).forEach(button => button.addEventListener('click', () => {
            responseFont = button.dataset.responseFont ?? 'serif';
            try { window.CometStorage.setItem('ascensao-response-font', responseFont); } catch {}
            applyFont();
        }));
        elementList(document, "[data-theme-choice]", HTMLButtonElement).forEach(button => button.addEventListener("click", () => {
            preference = button.dataset.themeChoice ?? 'system';
            try { window.CometStorage.setItem(storageKey, preference); } catch {}
            applyTheme();
        }));
    });
})();
