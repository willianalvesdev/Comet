import { optionalElement, present } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const button = optionalElement(document, ".home__microphone", HTMLButtonElement);
    const input = optionalElement(document, ".home__input", HTMLTextAreaElement);
    const status = optionalElement(document, "#dictation-status", HTMLElement);
    if (!button || !input || !status) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const composer = button.closest('.home__composer');
    let originalPlaceholder = input.placeholder;
    const send = optionalElement(present(button.closest("form")), ".home__send", HTMLButtonElement);
    const sendLabel = send?.getAttribute("aria-label") || "Enviar mensagem";
    const toolbar = button.closest(".home__toolbar");
    let session: SpeechRecognitionSession | null = null;
    let stopping = false;
    function indicate(active: boolean, message: string) {
        present(button).setAttribute("aria-pressed", String(active));
        present(button).setAttribute("aria-label", active ? "Parar ditado" : "Ditar mensagem");
        present(button).title = active ? "Parar ditado" : "Ditar mensagem";
        if (active && !present(composer).classList.contains('is-dictating')) originalPlaceholder = present(input).placeholder;
        present(composer).classList.toggle('is-dictating', active);
        present(input).placeholder = active ? 'Ouvindo...' : originalPlaceholder;
        send?.setAttribute("aria-label", active ? "Concluir ditado" : sendLabel);
        toolbar?.classList.toggle("is-dictating", active);

        const routine = /^(Ativando|Ouvindo|Finalizando|Ditado|Nenhuma fala)/.test(message);
        present(status).textContent = routine ? '' : message;
        if (!active && !routine) present(button).title = message;
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

        session.stop();
    }
    send?.addEventListener("click", event => {
        if (!session) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        stop();
    }, {capture:true, signal: scope.signal});
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
        let recognition: SpeechRecognitionSession;
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
            const messages: Record<string,string> = {
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
    }, {signal: scope.signal});
    input.addEventListener("beforeinput", cancel, {signal: scope.signal});
    scope.listen(document, "visibilitychange", () => { if (document.hidden) cancel(); });
    scope.listen(window, "pagehide", cancel);
}
