import {citationPreviews} from './citations';
import {chatArtifacts} from './chat-artifacts';
import {positionTableHeaders} from './answer-content';
import {chatImages} from './chat-images';
import { requiredElement, optionalElement, present, elementList, eventElement } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const citations=citationPreviews({scope,setTimeout,MutationObserver});
    const scroller = requiredElement(document, '.workspace__content', HTMLElement);
    let tableFrame=false;
    const updateTables=()=>{if(tableFrame)return;tableFrame=true;requestAnimationFrame(()=>{tableFrame=false;positionTableHeaders(scroller);});};
    scope.listen(scroller,'scroll',updateTables,{passive:true});
    new ResizeObserver(updateTables).observe(scroller);
    new MutationObserver(updateTables).observe(scroller,{childList:true,subtree:true,characterData:true});
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
    if(!tabs){tabs=document.createElement('nav');tabs.className='chat-tabs';tabs.hidden=true;tabs.setAttribute('aria-label','Visualização da resposta');tabs.innerHTML='<button type="button" data-chat-view="answer" aria-current="page"><i class="chat-tab-logo" aria-hidden="true"></i>Resposta</button><button type="button" data-chat-view="images" hidden><i class="chat-tab-images" aria-hidden="true"></i>Imagens</button><button type="button" data-chat-view="links" hidden><i class="chat-tab-links" aria-hidden="true"></i>Links</button>';header.append(tabs);}
    if(!linksPage){linksPage=document.createElement('section');linksPage.className='chat-links';linksPage.hidden=true;linksPage.setAttribute('aria-label','Links pesquisados');chatPage.after(linksPage);}
    let imagesPage=optionalElement(document,'.chat-images',HTMLElement);
    if(!imagesPage){imagesPage=document.createElement('section');imagesPage.className='chat-images';imagesPage.hidden=true;imagesPage.setAttribute('aria-label','Imagens pesquisadas');chatPage.after(imagesPage);}
    if(!tabs.querySelector('[data-chat-view="images"]')){const button=document.createElement('button');button.type='button';button.dataset.chatView='images';button.hidden=true;button.innerHTML='<i class="chat-tab-images" aria-hidden="true"></i>Imagens';tabs.querySelector('[data-chat-view="links"]')?.before(button);}
    const images=chatImages(imagesPage,{scope,fetch});
    scope.cleanup(()=>{images.reset();workspace.classList.remove('showing-chat-links','showing-chat-images');});
    const researchQuery=(value:Research|null)=>(value?.query||value?.queries?.at(-1)||'').trim().slice(0,350);
    let answerScroll=0, activeResearch: Research | null=null,activeView='answer';
    function renderLinks(value: Research | null){
        const queryChanged=researchQuery(activeResearch)!==researchQuery(value)||activeResearch?.engine!==value?.engine;
        activeResearch=value;present(linksPage).replaceChildren();
        const query=researchQuery(value);requiredElement(present(tabs),'[data-chat-view="images"]',HTMLButtonElement).hidden=!query;
        if(queryChanged){images.reset();if(activeView==='images'){if(query)void images.show(query,value?.engine==='Tavily'?'tavily':'searxng');else view('answer');}}
        const title=document.createElement('p');title.className='chat-links__query';title.textContent=value?.query?'Resultados da pesquisa para: '+value.query:'Links consultados nesta resposta';present(linksPage).append(title);
        const sources=validSources(value?.sources);
        requiredElement(present(tabs), '[data-chat-view="links"]', HTMLButtonElement).hidden = !sources.length;
        if (!sources.length && workspace.classList.contains('showing-chat-links')) view('answer');
        if(!sources.length){const empty=document.createElement('p');empty.textContent='Esta resposta não tem links de pesquisa.';present(linksPage).append(empty);return;}
        for(const source of sources){
            const result=document.createElement('a');result.className='chat-links__result';result.href=source.url;result.target='_blank';result.rel='noopener noreferrer';
            const publisher=document.createElement('span');publisher.className='chat-links__publisher';
            const identity=document.createElement('span'),domain=document.createElement('span'),url=document.createElement('span');
            domain.textContent=source.domain;url.className='chat-links__url';url.textContent=source.url;identity.append(domain,url);publisher.append(icon(source.domain),identity);
            const title=document.createElement('span');title.className='chat-links__title';title.textContent=source.title;result.append(publisher,title);
            if(source.excerpt){const excerpt=document.createElement('p');excerpt.textContent=source.excerpt;result.append(excerpt);}
            const evidence=document.createElement('small');
            evidence.textContent=source.evidence_type==='page'?'Página consultada':source.evidence_type==='grounding'?'Evidência do Google':'Resumo da busca';
            if(source.read_status==='unavailable')evidence.textContent+=' · não foi possível ler a página';
            result.append(evidence);
            present(linksPage).append(result);
        }
    }
    function view(name: string | undefined){
        if(name==='links'&&!validSources(activeResearch?.sources).length||name==='images'&&!researchQuery(activeResearch)||!['answer','links','images'].includes(name||''))name='answer';
        if(name===activeView)return;
        if(activeView==='answer')answerScroll=scroller.scrollTop;
        activeView=name!;
        chatPage.hidden=name!=='answer';present(linksPage).hidden=name!=='links';present(imagesPage).hidden=name!=='images';
        workspace.classList.toggle('showing-chat-links',name==='links');workspace.classList.toggle('showing-chat-images',name==='images');
        elementList(present(tabs),'button',HTMLButtonElement).forEach(button=>{if(button.dataset.chatView===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
        if(name==='images')void images.show(researchQuery(activeResearch),activeResearch?.engine==='Tavily'?'tavily':'searxng');
        scroller.scrollTo({top:name==='answer'?answerScroll:0,behavior:'instant'});
    }
    tabs.addEventListener('click',event=>{const button=eventElement(event.target)?.closest<HTMLElement>('[data-chat-view]');if(button)view(button.dataset.chatView);}, {signal: scope.signal});
    renderLinks(null);
    const panel=document.createElement('aside');panel.className='computer-sources-panel';panel.id='computer-sources-menu';panel.setAttribute('popover','auto');panel.setAttribute('aria-label','Fontes da resposta');scope.append(panel);
    const sideClose=document.createElement('button');sideClose.type='button';sideClose.className='sources-side-close';sideClose.hidden=true;sideClose.setAttribute('aria-label','Recolher fontes');sideClose.innerHTML='<i aria-hidden="true"></i>';scope.append(sideClose);
    sideClose.addEventListener('click',()=>setPanelVisible(!panel.matches(':popover-open'),true),{signal:scope.signal});
    scope.cleanup(()=>workspace.classList.remove('has-source-panel'));
    const collapse=document.createElement('button');collapse.type='button';collapse.className='workspace__header-button sources-menu-toggle';collapse.hidden=true;
    collapse.setAttribute('aria-label','Abrir fontes');collapse.setAttribute('aria-expanded','false');collapse.setAttribute('aria-controls',panel.id);collapse.innerHTML='<i aria-hidden="true"></i>';
    const options=optionalElement(header,'.chat-options-toggle',HTMLElement);if(options)options.after(collapse);else header.append(collapse);
    let latestArticle:HTMLElement|null=null,panelVisible=false,cardOpen=true,preferenceApplied=false;
    const preferenceKey='comet-sources-panel-open';
    let preferredOpen=false;try{preferredOpen=localStorage.getItem(preferenceKey)==='true';}catch{}
    const uploaded=new Map<HTMLElement,Attachment[]>();
    const hasUploads=()=>[...uploaded].some(([article,files])=>article.isConnected&&files.length);
    const hasDetails=()=>artifacts.hasFiles()||!!validSources(activeResearch?.sources).length||hasUploads();
    function updateTrigger(){collapse.hidden=panel.classList.contains('is-docked')||!hasDetails();}
    const sourceHost=document.createElement('div');
    const artifacts=chatArtifacts({scope,fetch,ResizeObserver,requestAnimationFrame},()=>{updateTrigger();collapse.setAttribute('aria-label',artifacts.hasFiles()?'Abrir artefatos e fontes':'Abrir fontes');positionPanel();});
    panel.append(artifacts.section,sourceHost);
    function positionPanel() {
        panelVisible=panel.matches(':popover-open');
        const sidebar=requiredElement(document,'.sidebar',HTMLElement);
        const artifactWidth=workspace.classList.contains('has-artifact-preview')?parseFloat(getComputedStyle(workspace).getPropertyValue('--artifact-panel-width'))||0:0;
        const wide=innerWidth-sidebar.getBoundingClientRect().width-artifactWidth>=1024;
        const mode=wide?'manual':'auto';
        if(panel.getAttribute('popover')!==mode){const opened=panelVisible;panel.setAttribute('popover',mode);if(opened)panel.showPopover();}
        panel.classList.toggle('is-docked',wide);
        if(wide&&hasDetails()&&!preferenceApplied){preferenceApplied=true;if(preferredOpen){panel.showPopover();panelVisible=true;}}
        const sideTop=header.getBoundingClientRect().bottom+16;
        sideClose.style.top=(sideTop-4)+'px';
        sideClose.classList.toggle('is-collapsed',!panelVisible);
        sideClose.setAttribute('aria-label',panelVisible?'Recolher fontes':'Expandir fontes');
        sideClose.setAttribute('aria-expanded',String(panelVisible));
        workspace.classList.toggle('has-source-panel',wide&&panelVisible);
        sideClose.hidden=!wide||!hasDetails();updateTrigger();
        if(!panelVisible)return;
        if(wide){const top=header.getBoundingClientRect().bottom+16;panel.style.setProperty('--sources-menu-top',top+'px');panel.style.top=top+'px';panel.style.left=(innerWidth-336)+'px';sideClose.style.top=(top-4)+'px';return;}
        const r=collapse.getBoundingClientRect();
        const top=Math.min(r.bottom+8,innerHeight-160);
        panel.style.setProperty('--sources-menu-top',Math.max(8,top)+'px');
        panel.style.top=Math.max(8,top)+'px';
        panel.style.left=Math.max(8,Math.min(r.right-panel.offsetWidth,innerWidth-panel.offsetWidth-8))+'px';
    }
    function updateSourcesFade() {
        const list=optionalElement(panel,'.sources-card__list',HTMLElement);if(!list)return;
        list.classList.toggle('is-scrolled',list.scrollTop>1);
        list.classList.toggle('has-overflow',list.scrollHeight-list.clientHeight-list.scrollTop>1);
    }
    new ResizeObserver(()=>{positionPanel();updateSourcesFade();}).observe(panel);
    new ResizeObserver(positionPanel).observe(requiredElement(document,'.sidebar',HTMLElement));
    new ResizeObserver(positionPanel).observe(scroller);
    function setPanelVisible(value:boolean,remember=false) {
        if(remember){preferredOpen=value;preferenceApplied=true;try{localStorage.setItem(preferenceKey,String(value));}catch{}}
        panelVisible=value;
        if(value&&!panel.matches(':popover-open'))panel.showPopover();
        if(!value&&panel.matches(':popover-open'))panel.hidePopover();
        collapse.setAttribute('aria-expanded',String(value));collapse.setAttribute('aria-label',value?'Fechar fontes':'Abrir fontes');
        positionPanel();updateSourcesFade();
    }
    panel.addEventListener('toggle',()=>{panelVisible=panel.matches(':popover-open');collapse.setAttribute('aria-expanded',String(panelVisible));positionPanel();updateSourcesFade();},{signal:scope.signal});
    collapse.popoverTargetElement=panel;
    collapse.addEventListener('click',event=>{event.preventDefault();setPanelVisible(!panel.matches(':popover-open'),true);},{signal:scope.signal});
    scope.listen(window,'resize',positionPanel);
    function reset() {
        citations.reset();images.reset();uploaded.clear();artifacts.reset();latestArticle=null;showSources(null,{},false);collapse.hidden=true;view('answer');preferenceApplied=false;
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
        const groups=document.createElement('div');groups.className='sources-card__groups';
        const web=document.createElement('details');web.className='sources-group';
        const webHeading=document.createElement('summary');webHeading.innerHTML='<i class="sources-group__web" aria-hidden="true"></i><span>Web</span>';
        webHeading.querySelector('i')!.className='chat-tab-links';
        const webCount=document.createElement('span');webCount.textContent=String(sources.length);webHeading.append(webCount,arrow.cloneNode());web.append(webHeading);if(sources.length)groups.append(web);
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
        web.append(list);
        const files=new Map<string,{file:Attachment;article:HTMLElement}>();
        for(const [owner,items] of uploaded){if(!owner.isConnected){uploaded.delete(owner);continue;}for(const file of items)files.set(file.id,{file,article:owner});}
        if(files.size){
            const group=document.createElement('details');group.className='sources-group sources-uploaded';
            const summary=document.createElement('summary');summary.innerHTML='<i class="artifact-file-icon" aria-hidden="true"></i><span>Arquivos</span>';
            const count=document.createElement('span');count.textContent=String(files.size);summary.append(count,arrow.cloneNode());group.append(summary);
            const rows=document.createElement('div');rows.className='sources-uploaded__list';
            for(const {file,article:owner} of files.values()){
                const button=document.createElement('button');button.type='button';button.className='sources-uploaded__file';button.innerHTML='<i class="artifact-file-icon" aria-hidden="true"></i>';
                const name=document.createElement('span');name.textContent=file.name;button.append(name);
                button.addEventListener('click',()=>{setPanelVisible(false);view('answer');owner.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},{signal:scope.signal});rows.append(button);
            }
            group.append(rows);groups.append(group);
        }
        if(!files.size)groups.replaceChildren(list);
        card.append(groups);sourceHost.replaceChildren(card);card.hidden=!sources.length&&!files.size&&artifacts.hasFiles();setPanelVisible(visible);updateTrigger();
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
        if ((sources.length || researchQuery(value)) && (!latestArticle?.isConnected || latestArticle===article || (latestArticle.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING))) {
            latestArticle=article;
            updateTrigger();
            showSources(article,value,panelVisible);
        }
        if(value.suggestions){
            const widget=document.createElement('iframe');widget.className='computer-search-suggestions';widget.title='Sugestões de pesquisa do Google';
            widget.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');widget.referrerPolicy='no-referrer';
            widget.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"><base target="_blank">`+value.suggestions;
            article.append(widget);
        }
    }
    window.ComputerResponseDetails={research,reset,artifacts:artifacts.register,files(article,files){if(!files.length&&!uploaded.has(article))return;uploaded.set(article,files);showSources(latestArticle,activeResearch||{},panelVisible);}};
    reset();
}
