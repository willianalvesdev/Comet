(() => {
    const menu = requiredElement(document, ".profile-menu", HTMLElement);
    const trigger = requiredElement(document, ".sidebar__profile", HTMLButtonElement);
    elementList(menu, '[data-profile-submenu="news"], [aria-controls="profile-news"], #profile-news', HTMLElement).forEach(element => element.remove());
    const triggers = [...elementList(menu, "[data-profile-submenu]", HTMLElement)];
    window.AscendaNewsPreferences = {topics:['business'], languages:'pt-en'};
    let active: HTMLElement | null = null;
    function closeSubmenu(focus = false) {
        elementList(menu, ".profile-menu__submenu", HTMLElement).forEach(panel => panel.hidden = true);
        triggers.forEach(button => button.setAttribute("aria-expanded", "false"));
        menu.classList.remove("has-submenu");
        if (focus && active) active.focus();
        active = null;
    }
    const hover = matchMedia("(min-width: 640px) and (hover: hover) and (pointer: fine)");
    function openSubmenu(button: HTMLElement, focus = false) {
        closeSubmenu();
        active = button;
        const panel = document.getElementById(button.getAttribute("aria-controls") || "");
        present(panel).hidden = false;
        button.setAttribute("aria-expanded", "true");
        menu.classList.add("has-submenu");
        if (focus) requiredElement(present(panel), "button:not(.profile-menu__back)", HTMLButtonElement).focus();
    }
    triggers.forEach(button => {
        button.addEventListener("pointerenter", event => {
            if (hover.matches && event.pointerType === "mouse" && menu.matches(":popover-open")) openSubmenu(button);
        });
        button.addEventListener("click", () => {
            if (active === button && !hover.matches) closeSubmenu();
            else openSubmenu(button, true);
        });
    });
    elementList(menu, ".profile-menu__back", HTMLElement).forEach(button => button.addEventListener("click", () => closeSubmenu(true)));
    menu.addEventListener("beforetoggle", () => closeSubmenu());
    hover.addEventListener("change", () => closeSubmenu());
    menu.addEventListener("toggle", event => {
        trigger.setAttribute("aria-expanded", String(event.newState === "open"));
        if (event.newState === "closed") closeSubmenu();
    });
    menu.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (active) closeSubmenu(true);
            else { menu.hidePopover(); trigger.focus(); }
        }
    });
    new MutationObserver(() => {
        if (menu.matches(":popover-open")) menu.hidePopover();
    }).observe(requiredElement(document, ".workspace", HTMLElement), {attributes:true, attributeFilter:["class"]});
})();
