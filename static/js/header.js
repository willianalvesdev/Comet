(() => {
    const header = document.querySelector(".site-header");
    if (!header) return;

    function updateHeader() {
        header.classList.toggle("is-scrolled", window.scrollY > 0);
    }

    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("pageshow", updateHeader);
    updateHeader();
})();
