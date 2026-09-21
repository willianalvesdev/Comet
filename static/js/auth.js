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

    // Visual prototype: never submit credentials or navigate on Enter.
    dialog.querySelectorAll("form").forEach((form) => {
        form.addEventListener("submit", (event) => event.preventDefault());
    });
})();
