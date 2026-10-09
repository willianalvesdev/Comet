import { optionalElement, isRecord, present, requiredElement, eventElement } from './dom';
import { isLocalModel, record, arrayValue, stringValue, booleanValue } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const gemini = optionalElement(document, '.model-picker', HTMLButtonElement), computer = optionalElement(document, '.computer-provider', HTMLButtonElement);
    const trigger = optionalElement(document, '.local-model-picker', HTMLButtonElement), menu = optionalElement(document, '.model-menu', HTMLElement);
    if (!gemini || !computer || !trigger || !menu) return;
    const labels: Record<string,string> = {};
    let options: HTMLButtonElement[] = [];
    let selected: ModelProvider = 'gemini', local: LocalModel = '', availability: Record<string,boolean> | undefined;
    let localError = 'Carregando os modelos do Ollama…', loading: Promise<void> | null = null;
    const preferenceKey = 'ascenda-model-preference-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
        const preference = isRecord(saved) ? saved : {};
        if (isLocalModel(preference.local)) local = preference.local;
        if (preference.provider === 'computer') selected = local;
    } catch {}
    function savePreference() {
        try { localStorage.setItem(preferenceKey, JSON.stringify({provider:selected === 'gemini' ? 'gemini' : 'computer', local})); } catch {}
    }
    function update() {
        present(gemini).setAttribute('aria-pressed', String(selected === 'gemini'));
        present(computer).setAttribute('aria-pressed', String(selected !== 'gemini'));
        present(trigger).hidden = selected === 'gemini';
        requiredElement(present(trigger), '.local-model-name', HTMLElement).textContent = labels[local] || local || 'Ollama';
        present(trigger).setAttribute('aria-label', 'Modelo local: ' + (labels[local] || local || 'Ollama'));
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
    function refreshModels(): Promise<void> {
        if (loading) return loading;
        loading = new window.ComputerService().get('/api/ai/models').then(raw => {
            if (!scope.active) return;
            const result = record(raw);
            const models = arrayValue(result.models, value => {const m=record(value);return {id:stringValue(m.id),configured:booleanValue(m.configured)};});
            availability = Object.fromEntries(models.map(m=>[m.id,m.configured]));
            options = models.filter(m=>isLocalModel(m.id) && m.configured).map(m=>{
                labels[m.id] = m.id === 'qwen-turbo1.7:latest' ? '1.7b turbo' : m.id.replace(/^qwen3:/, '').replace(/:latest$/, '');
                const option=document.createElement('button'); option.type='button';option.dataset.provider=m.id;
                option.setAttribute('role','menuitemradio');
                const label=document.createElement('span');label.textContent=labels[m.id];
                const check=document.createElement('i');check.className='model-check';check.setAttribute('aria-hidden','true');
                option.append(label,check);return option;
            });
            localError = typeof result.local_error==='string' ? result.local_error : options.length ? '' : 'Nenhum modelo instalado no Ollama.';
            if (!options.some(o=>o.dataset.provider===local)) {
                local = options.find(o=>o.dataset.provider===result.default_model)?.dataset.provider || options[0]?.dataset.provider || '';
                if (selected!=='gemini') selected=local;
            }
            present(menu).replaceChildren(...options);
            if (!options.length) {const message=document.createElement('p');message.textContent=localError;present(menu).append(message);}
            update();
        }).catch(()=>{localError='Não foi possível carregar os modelos. Tente novamente.';}).finally(()=>{loading=null;});
        return loading;
    }
    async function open() {
        await refreshModels();
        if (!scope.active || present(trigger).disabled || selected==='gemini') return;
        present(menu).showPopover(); position(); options.find(option=>option.dataset.provider===local)?.focus({preventScroll:true});
    }
    gemini.addEventListener('click',()=>{ selected='gemini'; savePreference(); update(); }, {signal: scope.signal});
    computer.addEventListener('click',()=>{ selected=local; savePreference(); update(); void refreshModels(); }, {signal: scope.signal});
    trigger.addEventListener('click',()=>menu.matches(':popover-open') ? menu.hidePopover() : open(), {signal: scope.signal});
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}}, {signal: scope.signal});
    menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))), {signal: scope.signal});
    menu.addEventListener('click',e=>{
        const option=eventElement(e.target)?.closest<HTMLButtonElement>('[data-provider]'); if(!option || !isLocalModel(option.dataset.provider))return;
        selected=local=option.dataset.provider;savePreference();update();menu.hidePopover();trigger.focus({preventScroll:true});
    }, {signal: scope.signal});
    menu.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();menu.hidePopover();trigger.focus();}
        if(e.key==='Tab')menu.hidePopover();
        if(options.length && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
            e.preventDefault();const i=options.findIndex(option=>option===document.activeElement);
            options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowUp'?-1:1)+options.length)%options.length].focus();
        }
    }, {signal: scope.signal});
    scope.listen(window, 'resize',()=>{if(menu.matches(':popover-open'))position();});
    scope.listen(window, 'scroll',()=>{if(menu.matches(':popover-open'))position();},true);
    window.ComputerModels={
        selected:()=>selected,
        select:value=>{if(value==='qwen')value=local;if((value==='gemini'||isLocalModel(value)) && (value==='gemini'||options.some(o=>o.dataset.provider===value))){selected=value;if(value!=='gemini')local=value;update();}},
        error:()=>selected!=='gemini' ? localError : availability&&!availability.gemini?'Configure a chave do Gemini no servidor para começar.':'',
        setBusy:value=>{[gemini,computer,trigger].forEach(b=>b.disabled=value);if(value&&menu.matches(':popover-open'))menu.hidePopover();}
    };
    update();
    void refreshModels();
}
