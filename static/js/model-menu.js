(() => {
    const gemini = document.querySelector('.model-picker'), computer = document.querySelector('.computer-provider');
    const trigger = document.querySelector('.local-model-picker'), menu = document.querySelector('.model-menu');
    if (!gemini || !computer || !trigger || !menu) return;
    const options = [...menu.querySelectorAll('[data-provider]')];
    let selected = 'gemini', local = 'qwen3:4b-instruct-2507-q4_K_M', availability;
    function update() {
        gemini.setAttribute('aria-pressed', String(selected === 'gemini'));
        computer.setAttribute('aria-pressed', String(selected !== 'gemini'));
        trigger.hidden = selected === 'gemini';
        trigger.querySelector('.local-model-name').textContent = local;
        trigger.setAttribute('aria-label', 'Modelo local: ' + local);
        gemini.removeAttribute('title'); gemini.removeAttribute('data-tooltip');
        gemini.setAttribute('aria-label', 'Usar Gemini');
        options.forEach(option => { option.setAttribute('aria-checked', String(option.dataset.provider === local)); option.title = option.dataset.provider; });
        if (selected === 'gemini' && menu.matches(':popover-open')) menu.hidePopover();
    }
    function position() {
        const rect = trigger.getBoundingClientRect(), width = Math.min(275, innerWidth-24);
        menu.style.width = width + 'px';
        menu.style.left = Math.max(12, Math.min(rect.right-width, innerWidth-width-12))+'px';
        menu.style.top = Math.max(12, rect.top-menu.offsetHeight-8)+'px';
    }
    function open() { menu.showPopover(); position(); options.find(option=>option.dataset.provider===local)?.focus({preventScroll:true}); }
    gemini.addEventListener('click',()=>{ selected='gemini'; update(); });
    computer.addEventListener('click',()=>{ selected=local; update(); });
    trigger.addEventListener('click',()=>menu.matches(':popover-open') ? menu.hidePopover() : open());
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
    menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
    menu.addEventListener('click',e=>{
        const option=e.target.closest('[data-provider]'); if(!option)return;
        selected=local=option.dataset.provider;update();menu.hidePopover();trigger.focus({preventScroll:true});
    });
    menu.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();menu.hidePopover();trigger.focus();}
        if(e.key==='Tab')menu.hidePopover();
        if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
            e.preventDefault();const i=options.indexOf(document.activeElement);
            options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowUp'?-1:1)+options.length)%options.length].focus();
        }
    });
    window.addEventListener('resize',()=>{if(menu.matches(':popover-open'))position();});
    window.addEventListener('scroll',()=>{if(menu.matches(':popover-open'))position();},true);
    window.ComputerModels={
        selected:()=>selected,
        select:value=>{if(value==='qwen')value=local;if(value==='gemini'||options.some(o=>o.dataset.provider===value)){selected=value;if(value!=='gemini')local=value;update();}},
        error:()=>selected==='gemini'&&availability&&!availability.gemini?'Configure a chave do Gemini no servidor para começar.':'',
        setBusy:value=>{[gemini,computer,trigger].forEach(b=>b.disabled=value);if(value&&menu.matches(':popover-open'))menu.hidePopover();}
    };
    update();
    new window.ComputerService().get('/api/ai/models').then(r=>{availability=Object.fromEntries(r.models.map(m=>[m.id,m.configured]));}).catch(()=>{});
})();
