(() => {
    const home = document.querySelector(".home");
    const input = home.querySelector("textarea");
    const modes = [...home.querySelectorAll("[data-composer-mode]")];
    const computerLink = document.querySelector('.sidebar__link[aria-label="Computer"]');
    function setMode(mode) {
        const computer = mode === "computer";
        home.classList.toggle("is-computer", computer);
        document.getElementById("home-mode").textContent = computer ? "Computer" : "Busca";
        document.getElementById("home-title").textContent = computer ? "No que vamos trabalhar?" : "O que você quer saber?";
        input.placeholder = computer ? "Faça qualquer coisa..." : "Digite sua pergunta...";
        modes.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.composerMode === mode)));
        if (computer) computerLink.setAttribute("aria-current", "page");
        else computerLink.removeAttribute("aria-current");
    }
    modes.forEach(button => button.addEventListener("click", () => setMode(button.dataset.composerMode)));
    computerLink.addEventListener("click", () => {
        setMode("computer");
        if (matchMedia("(width < 640px)").matches && !document.body.classList.contains("is-sidebar-collapsed")) document.querySelector(".sidebar__toggle").click();
        input.focus();
    });
    // Sending will be connected when message handling is implemented.
    home.querySelector("form").addEventListener("submit", event => event.preventDefault());
    setMode(new URLSearchParams(location.search).get("mode") === "computer" ? "computer" : "default");
})();
