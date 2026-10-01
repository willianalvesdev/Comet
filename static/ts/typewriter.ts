(() => {
    const text = optionalElement(document, "[data-typewriter]", HTMLElement);
    if (!text) return;

    const phrases = [
        "Gastei R$ 67 no mercado hoje.",
        "Recebi R$ 3.500 de salário.",
        "Paguei R$ 120 de internet.",
        "Guardei R$ 200 para minha viagem.",
        "Gastei R$ 35 no almoço.",
        "Recebi R$ 450 de um freelance."
    ];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let phraseIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let timer = 0;

    function tick() {
        const phrase = phrases[phraseIndex];
        characterIndex += deleting ? -1 : 1;
        present(text).textContent = phrase.slice(0, characterIndex);

        let delay = deleting ? 30 : 65;
        if (!deleting && characterIndex === phrase.length) {
            deleting = true;
            delay = 1800;
        } else if (deleting && characterIndex === 0) {
            deleting = false;
            phraseIndex = (phraseIndex + 1) % phrases.length;
            delay = 400;
        }
        timer = window.setTimeout(tick, delay);
    }

    function synchronize() {
        window.clearTimeout(timer);
        if (reducedMotion.matches) {
            present(text).classList.remove("is-typing");
            present(text).textContent = phrases[0];
            phraseIndex = 0;
            characterIndex = 0;
            deleting = false;
            return;
        }
        if (document.hidden) return;

        present(text).classList.add("is-typing");
        present(text).textContent = phrases[phraseIndex].slice(0, characterIndex);
        timer = window.setTimeout(tick, 500);
    }

    reducedMotion.addEventListener("change", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    synchronize();
})();
