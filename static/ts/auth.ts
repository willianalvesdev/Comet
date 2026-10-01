(() => {
    const dialog = optionalElement(document, ".auth", HTMLDialogElement);
    if (!dialog) return;

    function setPanel(name: string | undefined) {
        elementList(present(dialog), "[data-auth-panel]", HTMLElement).forEach((panel) => {
            panel.hidden = panel.dataset.authPanel !== name;
        });
        present(dialog).setAttribute("aria-labelledby", `auth-${name}-title`);
        present(dialog).setAttribute("aria-describedby", `auth-${name}-policy`);
        present(dialog).scrollTop = 0;
    }

    elementList(document, "[data-auth-open]", HTMLElement).forEach((button) => {
        button.addEventListener("click", () => {
            setPanel(button.dataset.authOpen);
            dialog.showModal();
            requiredElement(dialog, ".auth__panel:not([hidden]) h2", HTMLElement).focus();
        });
    });

    elementList(dialog, "[data-auth-switch]", HTMLElement).forEach((button) => {
        button.addEventListener("click", () => {
            setPanel(button.dataset.authSwitch);
            requiredElement(dialog, ".auth__panel:not([hidden]) h2", HTMLElement).focus();
        });
    });

    requiredElement(dialog, ".auth__close", HTMLElement).addEventListener("click", () => dialog.close());

    if (new URLSearchParams(location.search).has("login")) {
        setPanel("login");
        dialog.showModal();
        requiredElement(dialog, ".auth__panel:not([hidden]) h2", HTMLElement).focus();
    }

    elementList(dialog, "form", HTMLFormElement).forEach((form) => {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = requiredElement(form, ".auth__submit", HTMLButtonElement);
            if (button.disabled) return;
            const message = requiredElement(form, ".auth__message", HTMLElement);
            const password = requiredElement(form, '[name="password"]', HTMLInputElement);
            const confirmation = optionalElement(form, '[name="confirmation"]', HTMLInputElement);
            message.textContent = "";
            if (confirmation && confirmation.value !== password.value) {
                message.textContent = "As senhas não coincidem.";
                confirmation.focus();
                return;
            }
            const label = button.textContent;
            button.disabled = true;
            button.textContent = "Aguarde…";
            try {
                const response = await fetch(form.action, {
                    method: "POST", body: new FormData(form),
                    headers: { "Accept": "application/json" },
                });
                const result: unknown = await response.json();
                if (!response.ok) {
                    message.textContent = apiError(result,"Não foi possível continuar. Tente novamente.");
                    return;
                }
                window.location.assign("/principal.html");
            } catch {
                message.textContent = "Não foi possível conectar ao site. Confira a conexão e tente novamente.";
            } finally {
                button.disabled = false;
                button.textContent = label;
            }
        });
    });
})();
