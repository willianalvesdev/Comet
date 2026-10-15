import { requiredElement, optionalElement, present, elementList, eventElement } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const scroller = requiredElement(document, '.workspace__content', HTMLElement);
    function icon(domain: string) {
        const image = document.createElement('img'); image.width = image.height = 16; image.alt = '';
        image.referrerPolicy = 'no-referrer'; image.loading = 'lazy';
        image.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32';
        image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, {...{once:true}, signal: scope.signal});
        return image;
    }
    function validSources(items: ResearchSource[] | undefined) {
        const seen = new Set<string>();
        return (Array.isArray(items) ? items : []).filter(source => {
            try {
                const url = new URL(source.url);
                if(url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) return false;
                seen.add(url.href); return true;
            } catch { return false; }
        }).slice(0,24);
    }
    const workspace = requiredElement(document, '.workspace', HTMLElement);
    const chatPage=requiredElement(document, '.computer-page', HTMLElement), header=requiredElement(document, '.computer-header', HTMLElement);
    let tabs=optionalElement(document, '.chat-tabs', HTMLElement), linksPage=optionalElement(document, '.chat-links', HTMLElement);
    if(!tabs){tabs=document.createElement('nav');tabs.className='chat-tabs';tabs.hidden=true;tabs.setAttribute('aria-label','Visualização da resposta');tabs.innerHTML='<button type="button" data-chat-view="answer" aria-current="page"><i class="chat-tab-logo" aria-hidden="true"></i>Resposta</button><button type="button" data-chat-view="links" hidden><i class="chat-tab-links" aria-hidden="true"></i>Links</button>';header.append(tabs);}
    if(!linksPage){linksPage=document.createElement('section');linksPage.className='chat-links';linksPage.hidden=true;linksPage.setAttribute('aria-label','Links pesquisados');chatPage.after(linksPage);}
    let answerScroll=0, activeResearch: Research | null=null;
    function renderLinks(value: Research | null){
        activeResearch=value;present(linksPage).replaceChildren();
        const title=document.createElement('p');title.className='chat-links__query';title.textContent=value?.query?'Resultados da pesquisa para: '+value.query:'Links consultados nesta resposta';present(linksPage).append(title);
        const sources=validSources(value?.sources);
        requiredElement(present(tabs), '[data-chat-view="links"]', HTMLButtonElement).hidden = !sources.length;
        if (!sources.length && workspace.classList.contains('showing-chat-links')) view('answer');
        if(!sources.length){const empty=document.createElement('p');empty.textContent='Esta resposta não tem links de pesquisa.';present(linksPage).append(empty);return;}
        for(const source of sources){
            const result=document.createElement('article');result.className='chat-links__result';
            const publisher=document.createElement('a');publisher.className='chat-links__publisher';publisher.href=source.url;publisher.target='_blank';publisher.rel='noopener noreferrer';
            const identity=document.createElement('span'),domain=document.createElement('span'),url=document.createElement('span');
            domain.textContent=source.domain;url.className='chat-links__url';url.textContent=source.url;identity.append(domain,url);publisher.append(icon(source.domain),identity);
            const title=document.createElement('a');title.className='chat-links__title';title.textContent=source.title;title.href=source.url;title.target='_blank';title.rel='noopener noreferrer';result.append(publisher,title);
            if(source.excerpt){const excerpt=document.createElement('p');excerpt.textContent=source.excerpt;result.append(excerpt);}
            const evidence=document.createElement('small');
            evidence.textContent=source.evidence_type==='page'?'Página consultada':source.evidence_type==='grounding'?'Evidência do Google':'Resumo da busca';
            if(source.read_status==='unavailable')evidence.textContent+=' · não foi possível ler a página';
            result.append(evidence);
            present(linksPage).append(result);
        }
    }
    function view(name: string | undefined){
        const links=name==='links' && validSources(activeResearch?.sources).length > 0;
        if (!links) name='answer';
        if(links){answerScroll=scroller.scrollTop;renderLinks(activeResearch);}
        chatPage.hidden=links;present(linksPage).hidden=!links;workspace.classList.toggle('showing-chat-links',links);
        elementList(present(tabs), 'button', HTMLButtonElement).forEach(button=>{if(button.dataset.chatView===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
        scroller.scrollTo({top:links?0:answerScroll,behavior:'instant'});
    }
    tabs.addEventListener('click',event=>{const button=eventElement(event.target)?.closest<HTMLElement>('[data-chat-view]');if(button)view(button.dataset.chatView);}, {signal: scope.signal});
    renderLinks(null);
    const panel=document.createElement('aside');panel.className='computer-sources-panel';panel.id='computer-sources-menu';panel.setAttribute('popover','auto');panel.setAttribute('aria-label','Fontes da resposta');scope.append(panel);
    const collapse=document.createElement('button');collapse.type='button';collapse.className='workspace__header-button sources-menu-toggle';collapse.hidden=true;
    collapse.setAttribute('aria-label','Abrir fontes');collapse.setAttribute('aria-expanded','false');collapse.setAttribute('aria-controls',panel.id);collapse.innerHTML='<i aria-hidden="true"></i>';
    const options=optionalElement(header,'.chat-options-toggle',HTMLElement);if(options)options.after(collapse);else header.append(collapse);
    let latestArticle:HTMLElement|null=null,panelVisible=false,cardOpen=true;
    function positionPanel() {
        if(!panelVisible)return;
        const r=collapse.getBoundingClientRect();
        const top=Math.min(r.bottom+8,innerHeight-160);
        panel.style.setProperty('--sources-menu-top',Math.max(8,top)+'px');
        panel.style.top=Math.max(8,top)+'px';
        panel.style.left=Math.max(8,Math.min(r.right-panel.getBoundingClientRect().width,innerWidth-panel.getBoundingClientRect().width-8))+'px';
    }
    function updateSourcesFade() {
        const list=optionalElement(panel,'.sources-card__list',HTMLElement);if(!list)return;
        list.classList.toggle('is-scrolled',list.scrollTop>1);
        list.classList.toggle('has-overflow',list.scrollHeight-list.clientHeight-list.scrollTop>1);
    }
    new ResizeObserver(()=>{positionPanel();updateSourcesFade();}).observe(panel);
    function setPanelVisible(value:boolean) {
        panelVisible=value;
        if(value&&!panel.matches(':popover-open'))panel.showPopover();
        if(!value&&panel.matches(':popover-open'))panel.hidePopover();
        collapse.setAttribute('aria-expanded',String(value));collapse.setAttribute('aria-label',value?'Fechar fontes':'Abrir fontes');
        positionPanel();updateSourcesFade();
    }
    panel.addEventListener('toggle',()=>{panelVisible=panel.matches(':popover-open');collapse.setAttribute('aria-expanded',String(panelVisible));positionPanel();updateSourcesFade();},{signal:scope.signal});
    collapse.addEventListener('click',()=>setPanelVisible(!panelVisible),{signal:scope.signal});
    scope.listen(window,'resize',positionPanel);
    function reset() {
        latestArticle=null;showSources(null,{},false);collapse.hidden=true;view('answer');
    }
    function showSources(article: HTMLElement | null,value: Research,visible=false) {
        renderLinks(value);
        const sources=validSources(value.sources);
        const card=document.createElement('details');card.className='sources-card';card.open=cardOpen;
        card.classList.toggle('sources-card--empty',!sources.length);
        card.addEventListener('toggle',()=>{
            if (!card.isConnected || !scope.active) return;
            cardOpen=card.open;requestAnimationFrame(updateSourcesFade);
        }, {signal: scope.signal});
        const heading=document.createElement('summary');
        const label=document.createElement('span');label.textContent='Fontes';
        const compact=document.createElement('span');compact.className='sources-card__compact';
        [...new Set(sources.map(s=>s.domain))].slice(0,3).forEach(domain=>compact.append(icon(domain)));
        const total=document.createElement('span');total.textContent=String(sources.length);compact.append(total);
        const arrow=document.createElement('i');arrow.className='ui-arrow';arrow.setAttribute('aria-hidden','true');
        heading.append(label);if(sources.length)heading.append(compact);heading.append(arrow);card.append(heading);
        const query=document.createElement('p');query.className='sources-card__query';query.textContent='Resultados para "'+(value.query || article?.previousElementSibling?.querySelector('.computer-message__text')?.textContent || '')+'"';card.append(query);
        const list=document.createElement('div');list.className='sources-card__list';
        list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Fontes pesquisadas');
        list.addEventListener('scroll',updateSourcesFade,{...{passive:true}, signal: scope.signal});
        for (const source of sources) {
            const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.className='sources-card__source';
            const content=document.createElement('div');
            const publisher=document.createElement('span');publisher.className='sources-card__publisher';publisher.textContent=source.domain.replace(/^www\./,'');
            const title=document.createElement('span');title.className='sources-card__title';title.textContent=source.title;
            content.append(publisher,title);
            if(source.excerpt){const excerpt=document.createElement('span');excerpt.className='sources-card__excerpt';excerpt.textContent=source.excerpt;content.append(excerpt);}
            link.append(icon(source.domain),content);list.append(link);
        }
        if (!sources.length) { const empty=document.createElement('p');empty.textContent='As fontes citadas da pesquisa aparecerão aqui.';list.append(empty); }
        card.append(list);panel.replaceChildren(card);setPanelVisible(visible);
    }
    function research(article: HTMLElement,value: Research | undefined,completed=false) {
        elementList(article, '.computer-research,.computer-sources,.computer-source-list,.computer-search-suggestions', HTMLElement).forEach(e=>e.remove());
        if(!value)return;
        const sources=validSources(value.sources);
        const thinking=optionalElement(article, '.computer-thinking', HTMLElement);
        const content=optionalElement(article, '.computer-thinking__content', HTMLElement);
        if(thinking && content) {
            thinking.hidden=false;
            if(!completed) {thinking.classList.add('is-thinking');requiredElement(thinking,'summary > span',HTMLElement).textContent='Pensando';}
            const previous=optionalElement(content,'.computer-research-step',HTMLDetailsElement);
            const step=document.createElement('details');step.className='computer-research-step';step.open=previous?.open ?? true;
            const pending=!completed && ['searching','reading'].includes(value.state || '');step.classList.toggle('is-searching',pending);
            const summary=document.createElement('summary');
            const label=document.createElement('span');label.textContent='Pesquisando'+(value.seconds!=null?' '+Math.round(value.seconds)+' s':'');summary.append(label);
            const list=document.createElement('ul');
            for(const query of value.queries || (value.query?[value.query]:[])) {const item=document.createElement('li');item.className='computer-research-query';item.textContent=query;list.append(item);}
            const sourceItems=sources.map(source=>{
                const item=document.createElement('li'),link=document.createElement('a'),title=document.createElement('span'),domain=document.createElement('span');
                item.className='computer-research-source';link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
                title.className='computer-research-source__title';title.textContent=source.title;
                domain.className='computer-research-source__domain';domain.textContent=source.domain;
                link.append(icon(source.domain),title,domain);item.append(link);list.append(item);return item;
            });
            if(sources.length>3){
                const item=document.createElement('li'),more=document.createElement('button');more.type='button';more.className='computer-research-more';
                let expanded=previous?.dataset.expanded==='true';
                const update=()=>{step.dataset.expanded=String(expanded);sourceItems.forEach((source,index)=>source.hidden=index>=3&&!expanded);more.textContent=expanded?'Mostrar menos':'+'+(sources.length-3)+' mais';more.setAttribute('aria-expanded',String(expanded));};
                more.addEventListener('click',()=>{expanded=!expanded;update();},{signal:scope.signal});update();item.append(more);list.append(item);
            }
            if(value.state==='failed'||value.state==='empty'){const item=document.createElement('li');item.textContent=value.error||'A pesquisa não retornou fontes verificáveis.';list.append(item);}
            step.append(summary,list);if(previous)previous.replaceWith(step);else content.prepend(step);
        }
        if(sources.length){
            const actions=optionalElement(article, '.computer-message__actions', HTMLElement);
            const trigger=document.createElement('button');trigger.type='button';trigger.className='computer-sources';
            const logos=document.createElement('span');logos.className='computer-source-icons';
            [...new Set(sources.map(s=>s.domain))].slice(0,3).forEach(domain=>logos.append(icon(domain)));
            const count=document.createElement('span');count.textContent=sources.length+(sources.length===1?' fonte':' fontes');
            trigger.append(logos,count);trigger.setAttribute('aria-label','Abrir '+count.textContent);
            trigger.addEventListener('click',()=>{cardOpen=true;collapse.hidden=false;showSources(article,value,true);}, {signal: scope.signal});actions?.append(trigger);
        }
        if (sources.length && (!latestArticle?.isConnected || latestArticle===article || (latestArticle.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING))) {
            latestArticle=article;
            collapse.hidden=false;
            showSources(article,value,panelVisible);
        }
        if(value.suggestions){
            const widget=document.createElement('iframe');widget.className='computer-search-suggestions';widget.title='Sugestões de pesquisa do Google';
            widget.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');widget.referrerPolicy='no-referrer';
            widget.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"><base target="_blank">`+value.suggestions;
            article.append(widget);
        }
    }
    window.ComputerResponseDetails={research,reset};
    reset();
}
