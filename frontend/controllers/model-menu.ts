import { workspaceGet } from './workspace-cache';
import { appendSheetClose, optionalElement, isRecord, present, requiredElement, eventElement } from './dom';
import { isOpenRouterModel, isOllamaModel, record, arrayValue, stringValue, booleanValue } from './api-data';
import { composerState } from '../components/composer-state';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const gemini = optionalElement(document, '.model-picker', HTMLButtonElement), computer = optionalElement(document, '.computer-provider', HTMLButtonElement);
    const trigger = optionalElement(document, '.local-model-picker', HTMLButtonElement), menu = optionalElement(document, '.model-menu', HTMLElement);
    if (!gemini || !computer || !trigger || !menu) return;
    const compactLabel=document.createElement('span');compactLabel.className='local-model-compact-label';compactLabel.textContent='Modelo';trigger.append(compactLabel);
    scope.cleanup(()=>compactLabel.remove());
    composerState.update({busy:false});
    trigger.popoverTargetElement = menu;
    const companies: Record<string,string> = {nvidia:'NVIDIA',thinkingmachines:'Thinking Machines',cohere:'Cohere',google:'Google'};
    const labels: Record<string,string> = {};
    const executions: Record<string,'local'|'cloud'> = {};
    let options: HTMLButtonElement[] = [];
    const geminiOption = document.createElement('button');
    geminiOption.type = 'button'; geminiOption.dataset.provider = 'gemini';
    geminiOption.setAttribute('role', 'menuitemradio');
    geminiOption.innerHTML = '<i class="model-icon model-icon--gemini" aria-hidden="true"></i><span>Gemini</span><i class="model-check" aria-hidden="true"></i>';
    let remoteOptions: HTMLButtonElement[]=[geminiOption], remote='gemini', remoteError='', remoteEnabled=false;
    function visibleOptions() { return isOllamaModel(selected)||!selected ? options : remoteOptions; }
    let selected: ModelProvider = 'gemini', local: LocalModel = '', availability: Record<string,boolean> | undefined;
    let localError = 'Carregando os modelos do Ollama…', loading: Promise<void> | null = null;
    const preferenceKey = 'ascenda-model-preference-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
        const preference = isRecord(saved) ? saved : {};
        if (isOllamaModel(preference.local)) local = preference.local;
        if (preference.provider === 'computer') selected = local;
        else if(isOpenRouterModel(preference.remote)) selected=remote=preference.remote;
    } catch {}
    function savePreference() {
        try { localStorage.setItem(preferenceKey, JSON.stringify({provider:isOllamaModel(selected)||!selected ? 'computer' : 'online', remote, local})); } catch {}
    }
    function update() {
        const computerMode=isOllamaModel(selected)||!selected;
        composerState.update({ computer: computerMode });
        const localExecution=computerMode && executions[selected]==='local';
        document.querySelector('.computer-page')?.classList.toggle('is-local-model',localExecution);
        present(trigger).hidden = false;
        const name = selected === 'gemini' ? 'Gemini' : labels[selected] || (isOpenRouterModel(selected)?'Escolher modelo':local || 'Ollama');
        present(menu).setAttribute('aria-label', computerMode ? 'Modelos do Ollama' : 'Modelos gratuitos');
        present(menu).replaceChildren();
        let company = '', execution = '';
        if(computerMode&&!options.length&&localError){const message=document.createElement('p');message.textContent=localError;present(menu).append(message);}
        for (const option of visibleOptions()) {
            if(computerMode && option.dataset.execution!==execution){
                execution=option.dataset.execution||'local';const heading=document.createElement('div');heading.className='model-company'+(execution==='cloud'?' model-company--cloud':'');heading.textContent=execution==='cloud'?'Nuvem · Ollama':'No seu computador';present(menu).append(heading);
            }
            const vendor = option.dataset.company || '';
            if (vendor && vendor !== company) {
                const heading = document.createElement('div'); heading.className = 'model-company'; heading.textContent = companies[vendor];
                present(menu).append(heading); company = vendor;
            }
            present(menu).append(option);
        }

        if(computerMode && options.length && !options.some(option=>option.dataset.execution==='cloud')) {
            const heading=document.createElement('div');heading.className='model-company model-company--cloud';heading.textContent='Nuvem · Ollama';const note=document.createElement('p');note.textContent='Os modelos Cloud adicionados no Ollama aparecerão aqui.';present(menu).append(heading,note);
        }
        if(!computerMode&&remoteError){const message=document.createElement('p');message.textContent=remoteError;present(menu).append(message);}
        appendSheetClose(present(menu),'Fechar modelos');
        geminiOption.setAttribute('aria-checked', String(selected === 'gemini'));
        requiredElement(present(trigger), '.local-model-name', HTMLElement).textContent = name;
        present(trigger).querySelector('.selected-model-icon')?.remove();
        const selectedOption=[...options,...remoteOptions,geminiOption].find(option=>option.dataset.provider===selected);
        const logo=selectedOption?.querySelector('.model-icon')?.cloneNode(true) as HTMLElement|undefined;
        const selectedLogo=logo||document.createElement('i');selectedLogo.classList.add('model-icon','selected-model-icon');if(!logo)selectedLogo.classList.add('model-icon--cpu');selectedLogo.setAttribute('aria-hidden','true');present(trigger).prepend(selectedLogo);
        present(trigger).setAttribute('aria-label', 'Modelo: ' + name);
        present(gemini).removeAttribute('title'); present(gemini).removeAttribute('data-tooltip');
        present(gemini).setAttribute('aria-label', 'Usar Pesquisar');
        [...options,...remoteOptions].forEach(option => { option.setAttribute('aria-checked', String(option.dataset.provider === selected)); option.title = labels[option.dataset.provider || ''] || option.dataset.provider || ''; });

    }
    function position() {
        const rect = present(trigger).getBoundingClientRect(), width = Math.min(280, innerWidth-24);
        present(menu).style.width = width + 'px';
        present(menu).style.maxHeight = Math.max(0,Math.min(350,rect.top-20))+'px';
        present(menu).style.left = Math.max(12, Math.min(rect.right-width, innerWidth-width-12))+'px';
        present(menu).style.top = Math.max(12, rect.top-present(menu).offsetHeight-8)+'px';
    }
    function refreshModels(force = false): Promise<void> {
        if (loading) return loading;
        loading = workspaceGet('/api/ai/models', 15000, force).then(raw => {
            if (!scope.active) return;
            const result = record(raw);
            const models = arrayValue(result.models, value => {const m=record(value);return {id:stringValue(m.id),name:typeof m.name==='string'?m.name:stringValue(m.id),configured:booleanValue(m.configured),execution:m.execution==='cloud'?'cloud' as const:'local' as const};});
            availability = Object.fromEntries(models.map(m=>[m.id,m.configured]));
            remoteEnabled=result.openrouter_configured===true;
            remoteError=typeof result.openrouter_error==='string'?result.openrouter_error:'';
            remoteOptions=remoteEnabled ? models.filter(m=>isOpenRouterModel(m.id)&&m.configured).map(m=>{
                labels[m.id]=m.name;const option=document.createElement('button');option.type='button';option.dataset.provider=m.id;option.setAttribute('role','menuitemradio');
                const label=document.createElement('span');label.textContent=m.name;const check=document.createElement('i');check.className='model-check';check.setAttribute('aria-hidden','true');const vendor=m.id.slice('openrouter:'.length).split('/')[0];
                if(companies[vendor]) { option.dataset.company=vendor; const icon=document.createElement('i');icon.className='model-icon model-icon--'+(vendor==='google'?'gemini':vendor);icon.setAttribute('aria-hidden','true');option.append(icon); }
                option.append(label,check);return option;
            }) : [geminiOption];
            if(!remoteOptions.some(o=>o.dataset.provider===remote))remote=remoteOptions.find(o=>o.dataset.provider===result.default_remote_model)?.dataset.provider || remoteOptions[0]?.dataset.provider || 'openrouter:unavailable/model:free';
            if(!isOllamaModel(selected)&&selected)selected=remote;
            options = models.filter(m=>isOllamaModel(m.id) && m.configured).sort((a,b)=>Number(a.execution==='cloud')-Number(b.execution==='cloud')).map(m=>{
                executions[m.id]=m.execution;
                labels[m.id] = m.id === 'qwen-turbo1.7:latest' ? '1.7b turbo' : m.id.replace(/^qwen3:/, '').replace(/:latest$/, '');
                const option=document.createElement('button'); option.type='button';option.dataset.provider=m.id;option.dataset.execution=m.execution;
                const brand = m.execution==='local' ? 'cpu' : '';
                if(brand){const icon=document.createElement('i');icon.className='model-icon model-icon--'+brand;icon.setAttribute('aria-hidden','true');option.append(icon);}
                option.setAttribute('role','menuitemradio');
                const label=document.createElement('span');label.textContent=labels[m.id];
                const check=document.createElement('i');check.className='model-check';check.setAttribute('aria-hidden','true');
                option.append(label,check);return option;
            });
            localError = typeof result.local_error==='string' ? result.local_error : options.length ? '' : 'Nenhum modelo instalado no Ollama.';
            if (!options.some(o=>o.dataset.provider===local)) {
                local = options.find(o=>o.dataset.provider===result.default_model)?.dataset.provider || options[0]?.dataset.provider || '';
                if (isOllamaModel(selected)||!selected) selected=local;
            }
            update();
        }).catch(()=>{if(!scope.active)return;remoteError=localError='Não foi possível carregar os modelos. Tente novamente.';update();}).finally(()=>{loading=null;});
        return loading;
    }
    async function open() {
        if (!scope.active || present(trigger).disabled) return;
        if(!availability || isOllamaModel(selected) || !selected || (remoteEnabled && remoteError)) await refreshModels(true);
        if(!scope.active||present(trigger).disabled)return;update();
        present(menu).showPopover(); position(); visibleOptions().find(option=>option.dataset.provider===selected)?.focus({preventScroll:true});
    }
    gemini.addEventListener('click',()=>{ selected=remote; savePreference(); update(); }, {signal: scope.signal});
    computer.addEventListener('click',()=>{ selected=local; savePreference(); update(); void refreshModels(true); }, {signal: scope.signal});
    trigger.addEventListener('click',event=>{event.preventDefault();if(menu.matches(':popover-open')) menu.hidePopover(); else void open();}, {signal: scope.signal});
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}}, {signal: scope.signal});
    menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))), {signal: scope.signal});
    menu.addEventListener('click',e=>{
        const option=eventElement(e.target)?.closest<HTMLButtonElement>('[data-provider]'); if(!option || (option.dataset.provider !== 'gemini' && !isOpenRouterModel(option.dataset.provider) && !isOllamaModel(option.dataset.provider)))return;
        selected=option.dataset.provider!; if(isOllamaModel(selected)) local=selected;else remote=selected;savePreference();update();menu.hidePopover();trigger.focus({preventScroll:true});
    }, {signal: scope.signal});
    menu.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();menu.hidePopover();trigger.focus();}
        if(e.key==='Tab')menu.hidePopover();
        const options = visibleOptions();
        if(options.length && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
            e.preventDefault();const i=options.findIndex(option=>option===document.activeElement);
            options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowUp'?-1:1)+options.length)%options.length].focus();
        }
    }, {signal: scope.signal});
    new ResizeObserver(()=>{if(menu.matches(':popover-open'))position();}).observe(menu);
    scope.listen(window, 'resize',()=>{if(menu.matches(':popover-open'))position();});
    scope.listen(window, 'scroll',()=>{if(menu.matches(':popover-open'))position();},true);
    window.ComputerModels={
        whenReady:()=>loading || refreshModels(),
        selected:()=>selected,
        select:value=>{if(value==='qwen')value=local;if(value==='gemini'&&remoteEnabled)value=remote;if(value==='gemini'||[...options,...remoteOptions].some(o=>o.dataset.provider===value)){selected=value;if(isOllamaModel(value))local=value;else remote=value;update();}},
        error:()=>!availability?remoteError || 'Carregando modelos. Aguarde um instante.':isOllamaModel(selected)||!selected ? localError : isOpenRouterModel(selected) ? remoteError || (!availability?.[selected]?'Este modelo está indisponível. Escolha outro modelo.':'') : availability&&!availability.gemini?'Configure a chave do Gemini no servidor para começar.':'',
        setBusy:value=>{composerState.update({busy:value});trigger.disabled=value;if(value&&menu.matches(':popover-open'))menu.hidePopover();}
    };
    update();
    void refreshModels();
}
