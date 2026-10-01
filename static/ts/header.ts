(() => {
    const header = optionalElement(document, ".site-header", HTMLElement);
    if (!header) return;

    function updateHeader() {
        present(header).classList.toggle("is-scrolled", window.scrollY > 0);
    }

    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("pageshow", updateHeader);
    updateHeader();
})();
