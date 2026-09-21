(() => {
    const menu = document.querySelector(".profile-menu");
    const trigger = document.querySelector(".sidebar__profile");
    const triggers = [...menu.querySelectorAll("[data-profile-submenu]")];
    let active = null;
    function closeSubmenu(focus = false) {
        menu.querySelectorAll(".profile-menu__submenu").forEach(panel => panel.hidden = true);
        triggers.forEach(button => button.setAttribute("aria-expanded", "false"));
        menu.classList.remove("has-submenu");
        if (focus && active) active.focus();
        active = null;
    }
    const hover = matchMedia("(hover: hover) and (pointer: fine)");
    function openSubmenu(button, focus = false) {
        closeSubmenu();
        active = button;
        const panel = document.getElementById(button.getAttribute("aria-controls"));
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        menu.classList.add("has-submenu");
        if (focus) panel.querySelector("button:not(.profile-menu__back)").focus();
    }
    triggers.forEach(button => {
        button.addEventListener("pointerenter", event => {
            if (hover.matches && event.pointerType !== "touch") openSubmenu(button);
        });
        button.addEventListener("click", () => {
            if (active === button && !hover.matches) closeSubmenu();
            else openSubmenu(button, true);
        });
    });
    menu.querySelectorAll(".profile-menu__back").forEach(button => button.addEventListener("click", () => closeSubmenu(true)));
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
    }).observe(document.querySelector(".workspace"), {attributes:true, attributeFilter:["class"]});
})();
