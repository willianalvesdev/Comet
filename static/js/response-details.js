(() => {
    function icon(domain) {
        const image = document.createElement('img'); image.width = image.height = 16; image.alt = '';
        image.referrerPolicy = 'no-referrer'; image.loading = 'lazy';
        image.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32';
        image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, {once:true});
        return image;
    }
    function validSources(items) {
        const seen = new Set();
        return (Array.isArray(items) ? items : []).filter(source => {
            try {
                const url = new URL(source.url);
                if(url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) return false;
                seen.add(url.href); return true;
            } catch { return false; }
        }).slice(0,24);
    }
    const workspace = document.querySelector('.workspace');
    const chatPage=document.querySelector('.computer-page'), header=document.querySelector('.computer-header');
    let tabs=document.querySelector('.chat-tabs'), linksPage=document.querySelector('.chat-links');
    if(!tabs){tabs=document.createElement('nav');tabs.className='chat-tabs';tabs.hidden=true;tabs.setAttribute('aria-label','Visualização da resposta');tabs.innerHTML='<button type="button" data-chat-view="answer" aria-current="page"><i class="chat-tab-logo" aria-hidden="true"></i>Resposta</button><button type="button" data-chat-view="links"><i class="chat-tab-links" aria-hidden="true"></i>Links</button>';header.append(tabs);}
    if(!linksPage){linksPage=document.createElement('section');linksPage.className='chat-links';linksPage.hidden=true;linksPage.setAttribute('aria-label','Links pesquisados');chatPage.after(linksPage);}
    let answerScroll=0, activeResearch=null;
    function renderLinks(value){
        activeResearch=value;linksPage.replaceChildren();
        const title=document.createElement('p');title.className='chat-links__query';title.textContent=value?.query?'Resultados da pesquisa para: '+value.query:'Links consultados nesta resposta';linksPage.append(title);
        const sources=validSources(value?.sources);
        if(!sources.length){const empty=document.createElement('p');empty.textContent='Esta resposta não tem links de pesquisa.';linksPage.append(empty);return;}
        for(const source of sources){
            const result=document.createElement('article');result.className='chat-links__result';
            const publisher=document.createElement('a');publisher.className='chat-links__publisher';publisher.href=source.url;publisher.target='_blank';publisher.rel='noopener noreferrer';
            const identity=document.createElement('span'),domain=document.createElement('span'),url=document.createElement('span');
            domain.textContent=source.domain;url.className='chat-links__url';url.textContent=source.url;identity.append(domain,url);publisher.append(icon(source.domain),identity);
            const title=document.createElement('a');title.className='chat-links__title';title.textContent=source.title;title.href=source.url;title.target='_blank';title.rel='noopener noreferrer';result.append(publisher,title);
            if(source.excerpt){const excerpt=document.createElement('p');excerpt.textContent=source.excerpt;result.append(excerpt);}
            linksPage.append(result);
        }
    }
    function view(name){
        const links=name==='links';
        if(links){answerScroll=scrollY;renderLinks(activeResearch);}
        chatPage.hidden=links;linksPage.hidden=!links;workspace.classList.toggle('showing-chat-links',links);
        tabs.querySelectorAll('button').forEach(button=>{if(button.dataset.chatView===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
        window.scrollTo({top:links?0:answerScroll,behavior:'instant'});
    }
    tabs.addEventListener('click',event=>{const button=event.target.closest('[data-chat-view]');if(button)view(button.dataset.chatView);});
    renderLinks(null);
    const panel = document.createElement('aside'); panel.className='computer-sources-panel'; panel.hidden=true;
    panel.setAttribute('aria-label','Fontes da resposta');
    const collapse = document.createElement('button'); collapse.className='sources-panel-toggle'; collapse.type='button'; collapse.hidden=true;
    collapse.setAttribute('aria-label','Recolher painel de fontes');
    collapse.innerHTML='<img src="/static/img/icons/collapse-panel.svg" alt="">';
    document.body.append(panel,collapse);
    let selectedArticle=null, panelVisible=false;
    function setPanelVisible(value) {
        panelVisible=value; panel.hidden=!value;
        workspace.classList.toggle('has-source-panel',value);
        collapse.classList.toggle('is-collapsed',!value);
        collapse.setAttribute('aria-label',value?'Recolher painel de fontes':'Expandir painel de fontes');
        collapse.setAttribute('aria-expanded',String(value));
        window.dispatchEvent(new Event('resize'));
    }
    collapse.addEventListener('click',()=>setPanelVisible(!panelVisible));
    function reset() {
        selectedArticle=null;panel.replaceChildren();collapse.hidden=true;setPanelVisible(false);renderLinks(null);view('answer');
    }
    function showSources(article,value) {
        selectedArticle=article;renderLinks(value);
        const sources=validSources(value.sources);
        const card=document.createElement('details');card.className='sources-card';card.open=true;
        const heading=document.createElement('summary');
        const label=document.createElement('span');label.textContent='Fontes';
        const compact=document.createElement('span');compact.className='sources-card__compact';
        [...new Set(sources.map(s=>s.domain))].slice(0,3).forEach(domain=>compact.append(icon(domain)));
        const total=document.createElement('span');total.textContent=String(sources.length);compact.append(total);
        const arrow=document.createElement('i');arrow.className='ui-arrow';arrow.setAttribute('aria-hidden','true');
        heading.append(label,compact,arrow);card.append(heading);
        const list=document.createElement('div');list.className='sources-card__list';
        for (const source of sources) {
            const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.className='sources-card__source';
            const content=document.createElement('div');
            const publisher=document.createElement('span');publisher.className='sources-card__publisher';publisher.textContent=source.domain.replace(/^www\./,'');
            const title=document.createElement('span');title.className='sources-card__title';title.textContent=source.title;
            content.append(publisher,title);
            if(source.excerpt){const excerpt=document.createElement('p');excerpt.textContent=source.excerpt;content.append(excerpt);}
            if(source.published_at){
                const date=new Date(source.published_at);
                if(!Number.isNaN(date.getTime())){const stamp=document.createElement('small');stamp.textContent=(source.date_approximate?'aprox. ':'')+date.toLocaleDateString('pt-BR');content.append(stamp);}
            }
            link.append(icon(source.domain),content);list.append(link);
        }
        card.append(list);panel.replaceChildren(card);collapse.hidden=false;setPanelVisible(true);
    }
    function research(article,value,completed=false) {
        article.querySelectorAll('.computer-research,.computer-sources,.computer-source-list,.computer-search-suggestions').forEach(e=>e.remove());
        if(!value)return;
        renderLinks(value);
        const sources=validSources(value.sources);
        if(!completed) {
            const thinking=article.querySelector('.computer-thinking');
            if(thinking){thinking.hidden=false;thinking.classList.add('is-thinking');thinking.querySelector('summary > span').textContent=['searching','reading'].includes(value.state)?'Pesquisando':'Pensando';}
        }
        if(value.state==='failed'||value.state==='empty'){
            const warning=document.createElement('p');warning.className='computer-research';warning.textContent=value.error||'A pesquisa não retornou fontes verificáveis.';article.prepend(warning);
        }
        if(sources.length){
            const actions=article.querySelector('.computer-message__actions');
            const trigger=document.createElement('button');trigger.type='button';trigger.className='computer-sources';
            const logos=document.createElement('span');logos.className='computer-source-icons';
            [...new Set(sources.map(s=>s.domain))].slice(0,3).forEach(domain=>logos.append(icon(domain)));
            const count=document.createElement('span');count.textContent=sources.length+(sources.length===1?' fonte':' fontes');
            trigger.append(logos,count);trigger.setAttribute('aria-label','Abrir '+count.textContent);
            trigger.addEventListener('click',()=>showSources(article,value));actions?.append(trigger);
            if(selectedArticle===article && panelVisible)showSources(article,value);
        }
        if(value.suggestions){
            const widget=document.createElement('iframe');widget.className='computer-search-suggestions';widget.title='Sugestões de pesquisa do Google';
            widget.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');widget.referrerPolicy='no-referrer';
            widget.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"><base target="_blank">`+value.suggestions;
            article.append(widget);
        }
    }
    function timing(article, metadata) {
        article.querySelector('.computer-instant')?.remove();
        if (!metadata?.instant) return;
        const label=document.createElement('span');label.className='computer-instant';label.textContent='Instantâneo';
        article.insertBefore(label,article.querySelector('.computer-message__text'));
    }
    window.ComputerResponseDetails={research,timing,reset};
})();
