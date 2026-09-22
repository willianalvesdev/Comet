(() => {
    const dialog = document.querySelector(".auth");
    if (!dialog) return;

    function setPanel(name) {
        dialog.querySelectorAll("[data-auth-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.authPanel !== name;
        });
        dialog.setAttribute("aria-labelledby", `auth-${name}-title`);
        dialog.setAttribute("aria-describedby", `auth-${name}-policy`);
        dialog.scrollTop = 0;
    }

    document.querySelectorAll("[data-auth-open]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanel(button.dataset.authOpen);
            dialog.showModal();
            dialog.querySelector(".auth__panel:not([hidden]) h2").focus();
        });
    });

    dialog.querySelectorAll("[data-auth-switch]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanel(button.dataset.authSwitch);
            dialog.querySelector(".auth__panel:not([hidden]) h2").focus();
        });
    });

    dialog.querySelector(".auth__close").addEventListener("click", () => dialog.close());

    if (new URLSearchParams(location.search).has("login")) {
        setPanel("login");
        dialog.showModal();
        dialog.querySelector(".auth__panel:not([hidden]) h2").focus();
    }

    dialog.querySelectorAll("form").forEach((form) => {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = form.querySelector(".auth__submit");
            if (button.disabled) return;
            const message = form.querySelector(".auth__message");
            const password = form.querySelector('[name="password"]');
            const confirmation = form.querySelector('[name="confirmation"]');
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
                const result = await response.json();
                if (!response.ok) {
                    message.textContent = result.error || "Não foi possível continuar. Tente novamente.";
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
