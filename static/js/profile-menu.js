(() => {
    const menu = document.querySelector(".profile-menu");
    const trigger = document.querySelector(".sidebar__profile");
    const triggers = [...menu.querySelectorAll("[data-profile-submenu]")];
    const preferenceKey = 'ascenda-news-preferences-v2-' + menu.dataset.userId;
    const topicButtons = [...menu.querySelectorAll('[data-news-topic]')];
    let preferences = { topics: ['business'], languages: 'pt-en' };
    try {
        const saved = JSON.parse(window.AscendaStorage.getItem(preferenceKey));
        const topics = saved?.topics?.filter(topic => topicButtons.some(button => button.dataset.newsTopic === topic));
        if (topics?.length) preferences.topics = topics;
        if (saved?.languages === 'all') preferences.languages = 'all';
    } catch {}
    function updatePreferences(save = false) {
        topicButtons.forEach(button => button.setAttribute('aria-pressed', String(preferences.topics.includes(button.dataset.newsTopic))));
        menu.querySelectorAll('[data-news-languages]').forEach(button => button.setAttribute('aria-pressed', String(preferences.languages === button.dataset.newsLanguages)));
        menu.querySelector('[data-news-preference-label]').textContent = (preferences.topics.length === 1 ? topicButtons.find(button => button.dataset.newsTopic === preferences.topics[0]).querySelector('span').textContent : preferences.topics.length + ' assuntos') + ' · ' + (preferences.languages === 'all' ? 'Todos os idiomas' : 'PT / EN');
        window.AscendaNewsPreferences = { topics: [...preferences.topics], languages: preferences.languages };
        if (save) {
            try { window.AscendaStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch {}
            window.dispatchEvent(new Event('news-preferences-change'));
        }
    }
    topicButtons.forEach(button => button.addEventListener('click', () => {
        const topic = button.dataset.newsTopic;
        if (preferences.topics.includes(topic)) {
            if (preferences.topics.length === 1) return;
            preferences.topics = preferences.topics.filter(value => value !== topic);
        } else preferences.topics.push(topic);
        updatePreferences(true);
    }));
    menu.querySelectorAll('[data-news-languages]').forEach(button => button.addEventListener('click', () => {
        preferences.languages = button.dataset.newsLanguages;
        updatePreferences(true);
    }));
    updatePreferences();
    let active = null;
    function closeSubmenu(focus = false) {
        menu.querySelectorAll(".profile-menu__submenu").forEach(panel => panel.hidden = true);
        triggers.forEach(button => button.setAttribute("aria-expanded", "false"));
        menu.classList.remove("has-submenu");
        if (focus && active) active.focus();
        active = null;
    }
    const hover = matchMedia("(min-width: 640px) and (hover: hover) and (pointer: fine)");
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
            if (hover.matches && event.pointerType === "mouse" && menu.matches(":popover-open")) openSubmenu(button);
        });
        button.addEventListener("click", () => {
            if (active === button && !hover.matches) closeSubmenu();
            else openSubmenu(button, true);
        });
    });
    menu.querySelectorAll(".profile-menu__back").forEach(button => button.addEventListener("click", () => closeSubmenu(true)));
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
    }).observe(document.querySelector(".workspace"), {attributes:true, attributeFilter:["class"]});
})();
