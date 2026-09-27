(() => {
    let sequence = 0;
    function icon(domain) {
        const image = document.createElement('img'); image.width = image.height = 16; image.alt = '';
        image.referrerPolicy = 'no-referrer'; image.loading = 'lazy';
        image.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32';
        image.addEventListener('error', () => image.remove(), {once:true});
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
    function research(article, value, completed = false) {
        article.querySelectorAll('.computer-research, .computer-sources, .computer-source-list, .computer-search-suggestions').forEach(e=>e.remove());
        if (!value) return;
        const sources = validSources(value.sources);
        const status = document.createElement('div'); status.className = 'computer-research';
        status.setAttribute('role','status');
        const running = !completed && ['searching','reading'].includes(value.state);
        status.classList.toggle('is-searching', running);
        const label = document.createElement('span');
        label.textContent = running ? (value.state === 'reading' ? 'Consultando fontes…' : 'Pesquisando na internet…')
            : value.state === 'failed' ? (value.error || 'Não foi possível pesquisar na internet.')
            : value.state === 'empty' ? 'A pesquisa não retornou fontes verificáveis.'
            : value.state === 'searching' ? 'Pesquisa interrompida' : 'Pesquisa na internet concluída';
        status.append(label);
        if (value.query) status.title = value.query;
        if (sources.length) {
            const found = document.createElement('span'); found.className = 'computer-research-sites';
            for (const source of sources.slice(0,3)) { found.append(icon(source.domain)); }
            const name = document.createElement('span');
            const domains = [...new Set(sources.map(s=>s.domain))];
            name.textContent = domains.slice(0,2).join(', ') + (domains.length > 2 ? ' e mais ' + (domains.length-2) : '');
            found.append(name); status.append(found);
        }
        article.prepend(status);
        if (!sources.length) return;
        const actions = article.querySelector('.computer-message__actions');
        const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'computer-sources';
        const logos = document.createElement('span'); logos.className = 'computer-source-icons';
        [...new Set(sources.map(s=>s.domain))].slice(0,3).forEach(domain=>logos.append(icon(domain)));
        const count = document.createElement('span'); count.textContent = sources.length + (sources.length === 1 ? ' fonte' : ' fontes');
        trigger.append(logos,count); trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-label','Ver ' + count.textContent);
        const popup = document.createElement('div'); popup.className = 'computer-source-list'; popup.id = 'response-sources-' + (++sequence);
        popup.setAttribute('popover','auto'); popup.setAttribute('aria-label','Fontes consultadas');
        const heading = document.createElement('strong'); heading.textContent = 'Fontes'; popup.append(heading);
        sources.forEach((source,index) => {
            const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            const text = document.createElement('span'); text.textContent = (index+1) + '. ' + source.title;
            if (source.published_at) {
                const date = new Date(source.published_at);
                if (!Number.isNaN(date.getTime())) text.textContent += ' · ' + (source.date_approximate ? 'aprox. ' : '') + date.toLocaleDateString('pt-BR');
            }
            link.append(icon(source.domain),text); popup.append(link);
        });
        trigger.setAttribute('aria-controls',popup.id);
        trigger.addEventListener('click',()=>{
            if (popup.matches(':popover-open')) {popup.hidePopover();return;}
            popup.showPopover(); const rect=trigger.getBoundingClientRect();
            popup.style.left=Math.max(12,Math.min(rect.left,innerWidth-popup.offsetWidth-12))+'px';
            popup.style.top=Math.max(12,rect.top-popup.offsetHeight-8)+'px';
        });
        popup.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
        actions.append(trigger); article.append(popup);
        if (value.suggestions) {
            // Provider HTML is isolated: no scripts, origin access, forms or top navigation.
            const widget = document.createElement('iframe'); widget.className='computer-search-suggestions';
            widget.title='Sugestões de pesquisa do Google'; widget.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');
            widget.referrerPolicy='no-referrer';
            widget.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"><base target="_blank">` + value.suggestions;
            article.append(widget);
        }
    }
    function timing(article, metadata) {
        article.querySelector('.computer-instant')?.remove();
        if (!metadata?.instant) return;
        const label=document.createElement('span');label.className='computer-instant';label.textContent='Instantâneo';
        article.insertBefore(label,article.querySelector('.computer-message__text'));
    }
    window.ComputerResponseDetails={research,timing};
})();
