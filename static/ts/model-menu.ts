window.WorkspaceNavigation.page('/static/js/model-menu.js', ({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}) => {
    const gemini = optionalElement(document, '.model-picker', HTMLButtonElement), computer = optionalElement(document, '.computer-provider', HTMLButtonElement);
    const trigger = optionalElement(document, '.local-model-picker', HTMLButtonElement), menu = optionalElement(document, '.model-menu', HTMLElement);
    if (!gemini || !computer || !trigger || !menu) return;
    const labels: Record<string,string> = {'qwen3:4b-instruct-2507-q4_K_M':'4b no-think','qwen3:1.7b':'1.7b','qwen3:4b':'4b','qwen3:8b':'8b'};
    elementList(menu, '[data-provider]', HTMLButtonElement).forEach(option => {
        const label = labels[option.dataset.provider || ''];
        if (!label) { option.remove(); return; }
        requiredElement(option, 'span', HTMLElement).textContent = label;
    });
    const options = [...elementList(menu, '[data-provider]', HTMLButtonElement)];
    let selected: ModelProvider = 'gemini', local: LocalModel = 'qwen3:1.7b', availability: Record<string,boolean> | undefined;
    const preferenceKey = 'ascenda-model-preference-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
        const preference = isRecord(saved) ? saved : {};
        if (isLocalModel(preference.local) && options.some(option => option.dataset.provider === preference.local)) local = preference.local;
        if (preference.provider === 'computer') selected = local;
    } catch {}
    function savePreference() {
        try { localStorage.setItem(preferenceKey, JSON.stringify({provider:selected === 'gemini' ? 'gemini' : 'computer', local})); } catch {}
    }
    function update() {
        present(gemini).setAttribute('aria-pressed', String(selected === 'gemini'));
        present(computer).setAttribute('aria-pressed', String(selected !== 'gemini'));
        present(trigger).hidden = selected === 'gemini';
        requiredElement(present(trigger), '.local-model-name', HTMLElement).textContent = labels[local] || local;
        present(trigger).setAttribute('aria-label', 'Modelo local: ' + (labels[local] || local));
        present(gemini).removeAttribute('title'); present(gemini).removeAttribute('data-tooltip');
        present(gemini).setAttribute('aria-label', 'Usar Gemini');
        options.forEach(option => { option.setAttribute('aria-checked', String(option.dataset.provider === local)); option.title = labels[option.dataset.provider || ''] || option.dataset.provider || ''; });
        if (selected === 'gemini' && present(menu).matches(':popover-open')) present(menu).hidePopover();
    }
    function position() {
        const rect = present(trigger).getBoundingClientRect(), width = Math.min(275, innerWidth-24);
        present(menu).style.width = width + 'px';
        present(menu).style.left = Math.max(12, Math.min(rect.right-width, innerWidth-width-12))+'px';
        present(menu).style.top = Math.max(12, rect.top-present(menu).offsetHeight-8)+'px';
    }
    function open() { present(menu).showPopover(); position(); options.find(option=>option.dataset.provider===local)?.focus({preventScroll:true}); }
    gemini.addEventListener('click',()=>{ selected='gemini'; savePreference(); update(); });
    computer.addEventListener('click',()=>{ selected=local; savePreference(); update(); });
    trigger.addEventListener('click',()=>menu.matches(':popover-open') ? menu.hidePopover() : open());
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
    menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
    menu.addEventListener('click',e=>{
        const option=eventElement(e.target)?.closest<HTMLButtonElement>('[data-provider]'); if(!option || !isLocalModel(option.dataset.provider))return;
        selected=local=option.dataset.provider;savePreference();update();menu.hidePopover();trigger.focus({preventScroll:true});
    });
    menu.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();menu.hidePopover();trigger.focus();}
        if(e.key==='Tab')menu.hidePopover();
        if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
            e.preventDefault();const i=options.findIndex(option=>option===document.activeElement);
            options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowUp'?-1:1)+options.length)%options.length].focus();
        }
    });
    scope.listen(window, 'resize',()=>{if(menu.matches(':popover-open'))position();});
    scope.listen(window, 'scroll',()=>{if(menu.matches(':popover-open'))position();},true);
    window.ComputerModels={
        selected:()=>selected,
        select:value=>{if(value==='qwen')value=local;if((value==='gemini'||isLocalModel(value)) && (value==='gemini'||options.some(o=>o.dataset.provider===value))){selected=value;if(value!=='gemini')local=value;update();}},
        error:()=>selected==='gemini'&&availability&&!availability.gemini?'Configure a chave do Gemini no servidor para começar.':'',
        setBusy:value=>{[gemini,computer,trigger].forEach(b=>b.disabled=value);if(value&&menu.matches(':popover-open'))menu.hidePopover();}
    };
    update();
    new window.ComputerService().get('/api/ai/models').then(r=>{availability=Object.fromEntries(arrayValue(record(r).models,value=>{const m=record(value);return [stringValue(m.id),booleanValue(m.configured)] satisfies [string,boolean];}));}).catch(()=>{});
});
