(() => {
    const trigger = document.querySelector('.model-picker');
    const menu = document.querySelector('.model-menu');
    if (!trigger || !menu) return;
    const options = [...menu.querySelectorAll('[data-provider]')];
    let selected = 'qwen';
    let availability = null;
    function update() {
        for (const option of options) {
            option.setAttribute('aria-checked', String(option.dataset.provider === selected));
            option.querySelector('small').textContent = option.dataset.provider === 'qwen' ? 'Local' : availability && !availability.gemini ? 'Configurar' : '';
        }
        const label = selected === 'qwen' ? 'Qwen' : 'Gemini';
        trigger.title = `Escolher modelo (${label} selecionado)`;
        trigger.setAttribute('aria-label', trigger.title);
        trigger.querySelector('span').textContent = label;
    }
    function position() {
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(260, innerWidth - 24), height = menu.offsetHeight;
        menu.style.width = width + 'px';
        menu.style.left = Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)) + 'px';
        menu.style.top = Math.max(12, rect.top >= height + 20 ? rect.top - height - 8 : Math.min(rect.bottom + 8, innerHeight - height - 12)) + 'px';
    }
    function open() {
        menu.showPopover(); position();
        options.find(option => option.dataset.provider === selected).focus({preventScroll:true});
    }
    trigger.addEventListener('click', () => menu.matches(':popover-open') ? menu.hidePopover() : open());
    trigger.addEventListener('keydown', event => {
        if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
    menu.addEventListener('click', event => {
        const option = event.target.closest('[data-provider]'); if (!option) return;
        selected = option.dataset.provider;
        update(); menu.hidePopover(); trigger.focus({preventScroll:true});
    });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); trigger.focus({preventScroll:true}); }
        if (event.key === 'Tab') menu.hidePopover();
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();
            const index = options.indexOf(document.activeElement);
            options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length].focus({preventScroll:true});
        }
    });
    window.addEventListener('resize', () => { if (menu.matches(':popover-open')) position(); });
    window.addEventListener('scroll', () => { if (menu.matches(':popover-open')) position(); }, true);
    window.ComputerModels = {
        selected: () => selected,
        error: () => selected === 'gemini' && availability && !availability.gemini ? 'Configure a chave do Gemini no servidor para começar.' : '',
        setBusy: value => { trigger.disabled = value; if (value && menu.matches(':popover-open')) menu.hidePopover(); }
    };
    update();
    new window.ComputerService().get('/api/ai/models').then(result => {
        availability = Object.fromEntries(result.models.map(model => [model.id, model.configured])); update();
    }).catch(() => { /* The chat endpoint still validates configuration and authentication. */ });
})();
