(() => {
    const button = document.querySelector(".home__microphone");
    const input = document.querySelector(".home__input");
    const status = document.getElementById("dictation-status");
    if (!button || !input || !status) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let session = null;
    let stopping = false;
    function indicate(active, message) {
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-label", active ? "Parar ditado" : "Ditar mensagem");
        button.title = active ? "Parar ditado" : "Ditar mensagem";
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
    button.addEventListener("click", () => {
        if (session) {
            if (!stopping) {
                stopping = true;
                indicate(true, "Finalizando ditado…");
                session.stop();
            }
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
            if (session === recognition && !stopping) indicate(true, "Ouvindo… Toque no microfone para parar.");
        };
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
