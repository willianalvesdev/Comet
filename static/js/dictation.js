(() => {
    const button = document.querySelector(".home__microphone");
    const input = document.querySelector(".home__input");
    const status = document.getElementById("dictation-status");
    if (!button || !input || !status) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const indicator = document.createElement("span");
    indicator.className = "dictation-equalizer";
    indicator.hidden = true;
    indicator.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 27; i++) {
        const dot = document.createElement("i");
        indicator.append(dot);
    }
    button.before(indicator);
    const send = button.closest("form").querySelector(".home__send");
    const sendLabel = send?.getAttribute("aria-label") || "Enviar mensagem";
    const toolbar = button.closest(".home__toolbar");
    let animationTimer = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function speech(active) {
        clearTimeout(animationTimer);
        indicator.classList.toggle("is-speaking", active);
        function update() {
            for (const dot of indicator.children) {
                dot.style.opacity = active ? (Math.random() < .45 ? '1' : '.22') : '.22';
            }
            if (active && !reducedMotion.matches) animationTimer = setTimeout(update, 350 + Math.random() * 300);
        }
        update();
    }
    let session = null;
    let stopping = false;
    function indicate(active, message) {
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-label", active ? "Parar ditado" : "Ditar mensagem");
        button.title = active ? "Parar ditado" : "Ditar mensagem";
        indicator.hidden = !active;
        send?.setAttribute("aria-label", active ? "Concluir ditado" : sendLabel);
        toolbar?.classList.toggle("is-dictating", active);
        if (!active) speech(false);
        status.textContent = message;
    }
    function cancel() {
        if (!session) return;
        const previous = session;
        session = null;
        stopping = false;
        previous.abort();
        indicate(false, "Ditado encerrado.");
    }
    function stop() {
        if (!session || stopping) return;
        stopping = true;
        indicate(true, "Finalizando ditado…");
        speech(false);
        session.stop();
    }
    send?.addEventListener("click", event => {
        if (!session) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        stop();
    }, true);
    button.addEventListener("click", () => {
        if (session) {
            stop();
            return;
        }
        if (!Recognition) {
            indicate(false, "Este navegador não oferece ditado por voz.");
            return;
        }
        if (!window.isSecureContext) {
            indicate(false, "Abra o site por HTTPS para usar o microfone.");
            return;
        }
        let recognition;
        try { recognition = new Recognition(); }
        catch { indicate(false, "Não foi possível iniciar o ditado neste navegador."); return; }
        const original = input.value;
        const prefix = original && !/\s$/.test(original) ? original + " " : original;
        let failed = false;
        let received = false;
        recognition.lang = "pt-BR";
        recognition.continuous = true;
        recognition.interimResults = true;
        session = recognition;
        stopping = false;
        indicate(true, "Ativando microfone…");
        recognition.onstart = () => {
            if (session === recognition && !stopping) indicate(true, "Ouvindo… Toque no quadrado para parar.");
        };
        recognition.onspeechstart = () => { if (session === recognition && !stopping) speech(true); };
        recognition.onspeechend = () => { if (session === recognition) speech(false); };
        recognition.onresult = event => {
            if (session !== recognition) return;
            const transcript = Array.from(event.results, result => result[0].transcript.trim()).filter(Boolean).join(" ");
            received = received || Boolean(transcript);
            input.value = transcript ? prefix + transcript : original;
            input.scrollTop = input.scrollHeight;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        recognition.onerror = event => {
            if (session !== recognition) return;
            failed = true;
            const messages = {
                "not-allowed": "Permita o uso do microfone nas configurações do navegador e tente novamente.",
                "service-not-allowed": "O serviço de ditado não está disponível neste navegador.",
                "audio-capture": "Não foi possível acessar o microfone. Confira se ele está conectado e disponível.",
                "network": "Não foi possível conectar ao serviço de ditado. Confira sua conexão e tente novamente.",
                "no-speech": "Não ouvi nenhuma fala. Toque no microfone para tentar novamente.",
                "language-not-supported": "Este navegador não oferece ditado em português.",
                "aborted": "Ditado encerrado."
            };
            indicate(false, messages[event.error] || "Não foi possível transcrever. Tente novamente.");
        };
        recognition.onend = () => {
            if (session !== recognition) return;
            session = null;
            stopping = false;
            if (!failed) indicate(false, received ? "Ditado concluído. Você pode editar o texto." : "Nenhuma fala detectada. Toque para tentar novamente.");
        };
        try { recognition.start(); }
        catch {
            session = null;
            indicate(false, "Não foi possível iniciar o microfone. Tente novamente.");
        }
    });
    // End dictation before manual edits so late results cannot overwrite them.
    input.addEventListener("beforeinput", cancel);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
    window.addEventListener("pagehide", cancel);
})();
