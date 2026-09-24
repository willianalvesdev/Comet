(() => {
    const page = document.querySelector('.news-page');
    const feed = document.getElementById('news-feed');
    const status = document.querySelector('.news-status');
    const statusText = document.getElementById('news-status-text');
    const retry = document.getElementById('news-retry');
    const more = document.getElementById('news-more');
    const update = document.getElementById('news-update');
    const storageKey = 'ascenda-news-likes-' + page.dataset.userId;
    let likes = new Set();
    try {
        const stored = JSON.parse(window.AscendaStorage.getItem(storageKey) || '[]');
        if (Array.isArray(stored)) likes = new Set(stored.filter(id => typeof id === 'string').slice(-500));
    } catch {}
    const seen = new Set();
    let currentPage = 0, busy = false, generation = 0;
    let mode = 'for-you';
    function refreshFeed() {
        generation++;
        busy = false;
        seen.clear();
        currentPage = 0;
        feed.replaceChildren();
        update.textContent = '';
        more.hidden = true;
        document.querySelectorAll('[data-news-mode]').forEach(button => {
            if (button.dataset.newsMode === mode) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        load();
    }
    window.addEventListener('news-preferences-change', refreshFeed);
    document.querySelectorAll('[data-news-mode]').forEach(button => button.addEventListener('click', () => {
        mode = button.dataset.newsMode;
        refreshFeed();
    }));
    const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function link(url, text, className) {
        const node = element('a', className, text);
        node.href = url;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        return node;
    }
    function dateLabel(value) {
        const date = new Date(value);
        if (!value || !Number.isFinite(date.getTime())) return 'Data não informada';
        const seconds = Math.min(0, Math.round((date.getTime() - Date.now()) / 1000));
        if (seconds > -60) return 'Publicado agora';
        const unit = seconds > -3600 ? 'minute' : seconds > -86400 ? 'hour' : 'day';
        return 'Publicado ' + relative.format(Math.round(seconds / ({ minute: 60, hour: 3600, day: 86400 }[unit])), unit);
    }
    function loadCover(url) {
        if (!url) return Promise.resolve(null);
        return new Promise(resolve => {
            const image = new Image();
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            const finish = valid => {
                clearTimeout(timer);
                image.onload = image.onerror = null;
                if (!valid) image.removeAttribute('src');
                resolve(valid ? image : null);
            };
            const timer = setTimeout(() => finish(false), 12000);
            image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
            image.onerror = () => finish(false);
            image.src = url;
        });
    }
    function card(article, featured, image) {
        const node = element('article', 'news-card' + (featured ? ' news-card--featured' : ''));
        const media = link(article.url, '', 'news-card__media');
        media.setAttribute('aria-label', 'Ler: ' + article.title);
        media.append(image);
        const body = element('div', 'news-card__body');
        const heading = element('h2', 'news-card__title');
        heading.append(link(article.url, article.title));
        const time = element('time', 'news-card__time', dateLabel(article.published_at));
        if (article.published_at) { time.dateTime = article.published_at; time.title = new Date(article.published_at).toLocaleString('pt-BR'); }
        body.append(heading, time);
        if (featured && article.description) body.append(element('p', 'news-card__description', article.description));
        const footer = element('div', 'news-card__footer');
        const count = article.sources.length;
        const source = link(article.url, count > 1 ? count + ' fontes' : article.source, 'news-card__source');
        source.title = article.sources.map(item => item.name).join(', ');
        const like = element('button', 'news-icon-button');
        like.type = 'button';
        like.append(element('span', 'news-like-icon'));
        like.firstChild.setAttribute('aria-hidden', 'true');
        function updateLike() {
            like.setAttribute('aria-pressed', String(likes.has(article.id)));
            like.setAttribute('aria-label', likes.has(article.id) ? 'Descurtir notícia' : 'Curtir notícia');
        }
        updateLike();
        like.addEventListener('click', () => {
            if (likes.has(article.id)) likes.delete(article.id); else likes.add(article.id);
            updateLike();
            try { window.AscendaStorage.setItem(storageKey, JSON.stringify([...likes].slice(-500))); } catch {}
        });
        const details = element('details', 'news-options');
        const summary = element('summary', 'news-icon-button');
        summary.setAttribute('aria-label', 'Mais opções da notícia');
        summary.append(element('span', 'news-more-icon'));
        summary.firstChild.setAttribute('aria-hidden', 'true');
        const panel = element('div', 'news-options__panel');
        panel.append(link(article.url, 'Abrir notícia original'));
        const copy = element('button', '', 'Copiar link');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(article.url); update.textContent = 'Link copiado.'; }
            catch { update.textContent = 'Não foi possível copiar. Abra a notícia e copie o endereço.'; }
            details.open = false;
        });
        panel.append(copy);
        for (const item of article.sources.slice(1)) panel.append(link(item.url, item.name));
        details.append(summary, panel);
        details.addEventListener('toggle', () => {
            if (details.open) feed.querySelectorAll('details[open]').forEach(other => { if (other !== details) other.open = false; });
        });
        footer.append(source, like, details);
        body.append(footer);
        node.append(media, body);
        return node;
    }
    async function load() {
        if (busy) return;
        busy = true;
        const version = generation;
        feed.setAttribute('aria-busy', 'true');
        more.disabled = true;
        more.textContent = 'Carregando…';
        retry.hidden = true;
        if (!seen.size) { status.hidden = false; statusText.textContent = 'Buscando as últimas notícias…'; }
        const targetCount = seen.size + 12;
        let stale = false;
        try {
          for (let batch = 0; batch < 6; batch++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            let response, data;
            try {
                const preferences = window.AscendaNewsPreferences || { topics: ['business'], languages: 'pt-en' };
                const topics = preferences.topics.join(',');
                const query = new URLSearchParams({ page: currentPage + 1, topics, mode, languages: preferences.languages });
                response = await fetch('/api/news?' + query, { signal: controller.signal });
                data = await response.json();
            } finally {
                clearTimeout(timer);
            }
            if (version !== generation) return;
            if (response.status === 401) { location.assign('/?login=1'); return; }
            if (!response.ok) {
                const error = new Error(data.error || 'Não foi possível carregar as notícias.');
                error.code = data.code;
                throw error;
            }
            const candidates = data.articles.filter(article => !seen.has(article.id) && article.image);
            const covers = await Promise.all(candidates.map(article => loadCover(article.image)));
            if (version !== generation) return;
            candidates.forEach((article, index) => {
                if (!covers[index] || seen.has(article.id)) return;
                feed.append(card(article, seen.size % 4 === 0, covers[index]));
                seen.add(article.id);
            });
            currentPage = data.page;
            status.hidden = seen.size > 0;
            if (!seen.size) statusText.textContent = 'Nenhuma notícia com foto disponível no momento.';
            more.hidden = !data.has_more;
            stale = stale || data.stale;
            update.textContent = stale ? 'Mostrando a última atualização disponível.' : '';
            if (!data.has_more || seen.size >= targetCount) break;
          }
        } catch (error) {
            if (version !== generation) return;
            more.hidden = true;
            const message = error.name === 'AbortError' ? 'A conexão demorou mais que o esperado. Tente novamente.' : error.message;
            if (seen.size) { update.textContent = message; more.hidden = false; }
            else { status.hidden = false; statusText.textContent = message; retry.hidden = error.code === 'configuration'; }
        } finally {
            if (version !== generation) return;
            busy = false;
            feed.setAttribute('aria-busy', 'false');
            more.disabled = false;
            more.textContent = 'Carregar mais notícias';
        }
    }
    document.addEventListener('click', event => feed.querySelectorAll('details[open]').forEach(details => { if (!details.contains(event.target)) details.open = false; }));
    feed.addEventListener('keydown', event => { if (event.key === 'Escape') feed.querySelectorAll('details[open]').forEach(details => { details.open = false; details.querySelector('summary').focus(); }); });
    more.addEventListener('click', load);
    retry.addEventListener('click', load);
    load();
})();
