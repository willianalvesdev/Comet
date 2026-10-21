import { showLoading } from './loading-indicator';
import { requiredElement, elementList, present, optionalElement, eventElement, isRecord, errorMessage } from './dom';
import { NewsArticle, apiError, newsData } from './api-data';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const page = requiredElement(document, '.news-page', HTMLElement);
    const feed = requiredElement(document, "#news-feed", HTMLElement);
    const status = requiredElement(document, '.news-status', HTMLElement);
    const statusText = requiredElement(document, "#news-status-text", HTMLElement);
    const retry = requiredElement(document, "#news-retry", HTMLElement);
    const more = requiredElement(document, "#news-more", HTMLButtonElement);
    const update = requiredElement(document, "#news-update", HTMLElement);
    const storageKey = 'ascenda-news-likes-' + page.dataset.userId;
    let likes = new Set<string>();
    try {
        const stored: unknown = JSON.parse(window.CometStorage.getItem(storageKey) || '[]');
        if (Array.isArray(stored)) likes = new Set(stored.filter((id:unknown):id is string => typeof id === 'string').slice(-500));
    } catch {}
    const seen = new Set<string>();
    let currentPage = 0, busy = false, generation = 0;
    let mode = 'for-you', topic: string | null | undefined = null;
    elementList(document, '[data-discovery-topic]', HTMLButtonElement).forEach(button => button.addEventListener('click', () => {
        topic = button.dataset.discoveryTopic; mode = 'topic';
        present(button.closest('details')).open = false; refreshFeed();
    }, {signal: scope.signal}));
    function refreshFeed() {
        const topicsMenu = requiredElement(document, '.discovery-topics', HTMLDetailsElement);
        topicsMenu.classList.toggle('is-active', mode === 'topic');
        elementList(document, '[data-discovery-topic]', HTMLButtonElement).forEach(button => {
            const selected = mode === 'topic' && button.dataset.discoveryTopic === topic;
            button.setAttribute('aria-pressed', String(selected));
            if (selected) requiredElement(document, "#topic-label", HTMLElement).textContent = requiredElement(button, 'span', HTMLElement).textContent;
        });
        if (mode !== 'topic') requiredElement(document, "#topic-label", HTMLElement).textContent = 'Tópicos';
        generation++;
        busy = false;
        seen.clear();
        currentPage = 0;
        feed.replaceChildren();
        update.textContent = '';
        more.hidden = true;
        elementList(document, '[data-news-mode]', HTMLButtonElement).forEach(button => {
            if (button.dataset.newsMode === mode) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        load();
    }
    scope.listen(window, 'news-preferences-change', refreshFeed);
    elementList(document, '[data-news-mode]', HTMLButtonElement).forEach(button => button.addEventListener('click', () => {
        topic = null; mode = button.dataset.newsMode || 'for-you';
        refreshFeed();
    }, {signal: scope.signal}));
    scope.listen(document, 'click', event => {
        const details = optionalElement(document, '.discovery-topics', HTMLDetailsElement);
        if (!present(details).contains(event.target instanceof Node ? event.target : null)) present(details).open = false;
    });
    requiredElement(document, '.discovery-topics', HTMLDetailsElement).addEventListener('keydown', event => {
        if (event.key === 'Escape') { requiredElement(document, '.discovery-topics', HTMLDetailsElement).open = false; requiredElement(present(eventElement(event.currentTarget)), 'summary', HTMLElement).focus(); }
    }, {signal: scope.signal});
    const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function link(url: string, text: string, className?: string) {
        const node = element('a', className, text);
        node.href = url;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        return node;
    }
    function dateLabel(value: string) {
        const date = new Date(value);
        if (!value || !Number.isFinite(date.getTime())) return 'Data não informada';
        const seconds = Math.min(0, Math.round((date.getTime() - Date.now()) / 1000));
        if (seconds > -60) return 'Publicado agora';
        const unit = seconds > -3600 ? 'minute' : seconds > -86400 ? 'hour' : 'day';
        return 'Publicado ' + relative.format(Math.round(seconds / ({ minute: 60, hour: 3600, day: 86400 }[unit])), unit);
    }
    function loadCover(url: string):Promise<HTMLImageElement|null> {
        if (!url) return Promise.resolve(null);
        return new Promise<HTMLImageElement|null>(resolve => {
            const image = new Image();
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            const finish = (valid: boolean) => {
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
    function card(article: NewsArticle, featured: boolean, image: HTMLImageElement) {
        const node = element('article', 'news-card' + (featured ? ' news-card--featured' : ''));
        const media = link(article.url, '', 'news-card__media');
        media.setAttribute('aria-label', 'Ler: ' + article.title);
        media.append(image);
        const body = element('div', 'news-card__body');
        const heading = element('h2', 'news-card__title');
        heading.append(link(article.url, article.title));
        body.append(heading);
        if (featured) {
            const time = element('time', 'news-card__time', dateLabel(article.published_at));
            if (article.published_at) { time.dateTime = article.published_at; time.title = new Date(article.published_at).toLocaleString('pt-BR'); }
            const clock = element('span', 'news-time-icon');
            clock.setAttribute('aria-hidden', 'true');
            time.prepend(clock);
            body.append(time);
        }
        if (featured && article.description) body.append(element('p', 'news-card__description', article.description));
        const footer = element('div', 'news-card__footer');
        const count = article.sources.length;
        const source = link(article.url, count > 1 ? count + ' fontes' : article.source, 'news-card__source');
        source.title = article.sources.map(item => item.name).join(', ');
        const like = element('button', 'news-icon-button');
        like.type = 'button';
        like.append(element('span', 'news-like-icon'));
        present(like.firstElementChild).setAttribute('aria-hidden', 'true');
        function updateLike() {
            like.setAttribute('aria-pressed', String(likes.has(article.id)));
            like.setAttribute('aria-label', likes.has(article.id) ? 'Descurtir notícia' : 'Curtir notícia');
        }
        updateLike();
        like.addEventListener('click', () => {
            if (likes.has(article.id)) likes.delete(article.id); else likes.add(article.id);
            updateLike();
            try { window.CometStorage.setItem(storageKey, JSON.stringify([...likes].slice(-500))); } catch {}
        }, {signal: scope.signal});
        const details = element('details', 'news-options');
        const summary = element('summary', 'news-icon-button');
        summary.setAttribute('aria-label', 'Mais opções da notícia');
        summary.append(element('span', 'news-more-icon'));
        present(summary.firstElementChild).setAttribute('aria-hidden', 'true');
        const panel = element('div', 'news-options__panel');
        panel.append(link(article.url, 'Abrir notícia original'));
        const copy = element('button', '', 'Copiar link');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(article.url); update.textContent = 'Link copiado.'; }
            catch { update.textContent = 'Não foi possível copiar. Abra a notícia e copie o endereço.'; }
            details.open = false;
        }, {signal: scope.signal});
        panel.append(copy);
        for (const item of article.sources.slice(1)) panel.append(link(item.url, item.name));
        details.append(summary, panel);
        details.addEventListener('toggle', () => {
            if (details.open) elementList(feed, 'details[open]', HTMLDetailsElement).forEach(other => { if (other !== details) other.open = false; });
        }, {signal: scope.signal});
        footer.append(source, like, details);
        body.append(footer);
        node.append(media, body);
        return node;
    }
    function clearSkeletons() { elementList(feed, '.news-skeleton', HTMLElement).forEach(node=>node.remove()); }
    function showSkeletons() {
        clearSkeletons();
        for (let index=0; index<6; index++) {
            const card=document.createElement('div');
            card.className='news-card news-skeleton' + (index===0?' news-card--featured':'');
            card.setAttribute('aria-hidden','true');
            card.innerHTML='<div class="news-card__media skeleton-block"></div><div class="news-card__body"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-line--short"></div></div>';
            feed.append(card);
        }
        status.hidden=true;
        feed.setAttribute('aria-label','Carregando notícias');
    }
    async function load() {
        if (busy) return;
        busy = true;
        const version = generation;
        feed.setAttribute('aria-busy', 'true');
        more.disabled = true;
        showLoading(more, 'Carregando notícias');
        retry.hidden = true;
        if (!seen.size) showSkeletons();
        const targetCount = seen.size + 12;
        let stale = false;
        try {
          for (let batch = 0; batch < 6; batch++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            let response: Response, raw: unknown;
            try {
                const preferences = window.CometNewsPreferences || { topics: ['business'], languages: 'pt-en' };
                const topics = topic || preferences.topics.join(',');
                const query = new URLSearchParams({ page: String(currentPage + 1), topics, mode: mode === 'topic' ? 'for-you' : mode, languages: preferences.languages });
                response = await fetch('/api/news?' + query, { signal: controller.signal });
                raw = await response.json();
            } finally {
                clearTimeout(timer);
            }
            if (version !== generation) return;
            if (response.status === 401) { location.assign('/?login=1'); return; }
            if (!response.ok) {
                const error = new Error(apiError(raw,'Não foi possível carregar as notícias.'));
                Object.assign(error,{code:isRecord(raw) ? raw.code : undefined});
                throw error;
            }
            const data = newsData(raw);
            const candidates = data.articles.filter(article => !seen.has(article.id) && article.image);
            const covers = await Promise.all(candidates.map(article => loadCover(article.image)));
            if (version !== generation) return;
            if (covers.some(Boolean)) clearSkeletons();
            candidates.forEach((article, index) => {
                if (!covers[index] || seen.has(article.id)) return;
                feed.append(card(article, seen.size % 4 === 0, present(covers[index])));
                seen.add(article.id);
            });
            currentPage = data.page;
            status.hidden = true;
            if (!seen.size) statusText.textContent = 'Nenhuma notícia com foto disponível no momento.';
            more.hidden = !data.has_more;
            stale = stale || data.stale;
            update.textContent = stale ? 'Mostrando a última atualização disponível.' : '';
            if (!data.has_more || seen.size >= targetCount) break;
          }
        } catch (error) {
            if (version !== generation) return;
            more.hidden = true;
            const message = (error instanceof Error ? error.name : '') === 'AbortError' ? 'A conexão demorou mais que o esperado. Tente novamente.' : errorMessage(error);
            if (seen.size) { update.textContent = message; more.hidden = false; }
            else { status.hidden = false; statusText.textContent = message; retry.hidden = error instanceof Error && 'code' in error && error.code === 'configuration'; }
        } finally {
            if (version !== generation) return;
            clearSkeletons();
            status.hidden = seen.size > 0;
            feed.removeAttribute('aria-label');
            busy = false;
            feed.setAttribute('aria-busy', 'false');
            more.disabled = false;
            more.textContent = 'Carregar mais notícias';
        }
    }
    scope.listen(document, 'click', event => elementList(feed, 'details[open]', HTMLDetailsElement).forEach(details => { if (!details.contains(event.target instanceof Node ? event.target : null)) details.open = false; }));
    feed.addEventListener('keydown', event => { if (event.key === 'Escape') elementList(feed, 'details[open]', HTMLDetailsElement).forEach(details => { details.open = false; requiredElement(details, 'summary', HTMLElement).focus(); }); }, {signal: scope.signal});
    more.addEventListener('click', load, {signal: scope.signal});
    retry.addEventListener('click', load, {signal: scope.signal});
    load();
}
