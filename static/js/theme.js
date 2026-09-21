(() => {
    const root = document.documentElement;
    const storageKey = "ascensao-theme";
    const system = matchMedia("(prefers-color-scheme: dark)");
    let preference = "system";
    try {
        const saved = localStorage.getItem(storageKey);
        if (["light", "dark", "system"].includes(saved)) preference = saved;
    } catch {}
    function applyTheme() {
        const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
        root.dataset.theme = theme;
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) favicon.href = theme === "light" ? "./static/img/icons/favicon-light.svg" : "./static/img/icons/favicon.svg";
        const scheme = document.querySelector('meta[name="color-scheme"]');
        if (scheme) scheme.content = theme;
        const color = document.querySelector('meta[name="theme-color"]');
        if (color) color.content = theme === "light" ? "#fdfbfa" : "#171615";
        document.querySelectorAll("[data-theme-choice]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference)));
        const label = document.querySelector("[data-theme-label]");
        const name = theme === "light" ? "Claro" : "Escuro";
        if (label) label.textContent = preference === "system" ? "Sistema (" + name + ")" : name;
    }
    applyTheme();
    system.addEventListener("change", () => { if (preference === "system") applyTheme(); });
    document.addEventListener("DOMContentLoaded", () => {
        applyTheme();
        document.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", () => {
            preference = button.dataset.themeChoice;
            try { localStorage.setItem(storageKey, preference); } catch {}
            applyTheme();
        }));
    });
})();
