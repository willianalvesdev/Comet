(() => {
    const home = document.querySelector(".home");
    const input = home.querySelector("textarea");
    const modes = [...home.querySelectorAll("[data-composer-mode]")];
    function setMode(mode) {
        const computer = mode === "computer";
        home.classList.toggle("is-computer", computer);
        document.getElementById("home-mode").textContent = computer ? "Computer" : "Busca";
        document.getElementById("home-title").textContent = computer ? "No que vamos trabalhar?" : "O que você quer saber?";
        input.placeholder = computer ? "Faça qualquer coisa..." : "Digite sua pergunta...";
        modes.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.composerMode === mode)));
    }
    modes.forEach(button => button.addEventListener("click", () => setMode(button.dataset.composerMode)));
    // Sending will be connected when message handling is implemented.
    home.querySelector("form").addEventListener("submit", event => event.preventDefault());
    setMode("default");
})();
