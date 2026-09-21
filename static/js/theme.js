(() => {
    const root = document.documentElement;
    const storageKey = "ascensao-theme";
    let theme = "dark";

    try {
        if (localStorage.getItem(storageKey) === "light") theme = "light";
    } catch {
        // Theme switching still works when browser storage is unavailable.
    }

    function applyTheme(value) {
        theme = value;
        root.dataset.theme = theme;
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) {
            favicon.setAttribute("href", theme === "light"
                ? "./static/img/icons/favicon-light.svg"
                : "./static/img/icons/favicon.svg");
        }
        document.querySelector('meta[name="color-scheme"]').content = theme;
        const themeColor = document.querySelector('meta[name="theme-color"]');
        themeColor.content = theme === "light" ? "#fdfbfa" : "#171615";
        const button = document.querySelector("[data-theme-toggle]");
        if (button) {
            const label = theme === "light" ? "Ativar modo escuro" : "Ativar modo claro";
            button.setAttribute("aria-label", label);
            button.title = label;
        }
    }

    applyTheme(theme);
    document.addEventListener("DOMContentLoaded", () => {
        applyTheme(theme);
        document.querySelector("[data-theme-toggle]").addEventListener("click", () => {
            applyTheme(theme === "dark" ? "light" : "dark");
            try {
                localStorage.setItem(storageKey, theme);
            } catch {
                // Keep the selected theme for this page even without storage.
            }
        });
    });
})();
