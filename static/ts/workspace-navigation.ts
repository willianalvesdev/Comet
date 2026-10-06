(() => {
    const factories = new Map<string, PageFactory>(), disposers: (() => void)[] = [], scripts = new Map<string, Promise<void>>();
    const routes = new Set(['/computer.html', '/graficos.html', '/descobrir.html', '/aprender.html', '/recentes.html', '/principal.html']);
    let navigating = false, navigation: AbortController | null = null;
    function mount(factory: PageFactory) {
        const controller = new AbortController(), cleanups: (()=>void)[] = [], nodes: (HTMLElement | SVGElement)[] = [], timers = new Set<number>(), frames = new Set<number>();
        const scope: PageScope = {
            get active() { return !controller.signal.aborted; },
            cleanup(callback) { cleanups.push(callback); },
            listen<K extends keyof AppEvents>(target: EventTarget | null, type: K, callback: (event:AppEvents[K])=>void, options: boolean | AddEventListenerOptions = {}) {
                if (!target) return;
                const listener: EventListener = event => callback(event as AppEvents[K]);
                target.addEventListener(type, listener, {...(typeof options === 'boolean' ? {capture:options} : options), signal:controller.signal});
                if (target === window && type === 'pagehide') cleanups.push(() => listener(new Event('pagehide')));
            },
            append(...elements) { nodes.push(...elements); document.body.append(...elements); }
        };
        function timeout<A extends unknown[]>(callback: (...args: A) => void, delay?: number, ...args: A) {
            if (!scope.active) return 0;
            const id = window.setTimeout(() => { timers.delete(id); if (scope.active) callback(...args); }, delay);
            timers.add(id); return id;
        }
        function interval<A extends unknown[]>(callback: (...args: A) => void, delay?: number, ...args: A) {
            if (!scope.active) return 0;
            const id = window.setInterval(() => { if (scope.active) callback(...args); }, delay);
            timers.add(id); return id;
        }
        function frame(callback: FrameRequestCallback) {
            if (!scope.active) return 0;
            const id = window.requestAnimationFrame(time => { frames.delete(id); if (scope.active) callback(time); });
            frames.add(id); return id;
        }
        class ScopedResizeObserver extends ResizeObserver {
            constructor(callback: ResizeObserverCallback) { super((entries, observer) => { if (scope.active) callback(entries, observer); }); cleanups.push(() => this.disconnect()); }
        }
        class ScopedMutationObserver extends MutationObserver {
            constructor(callback: MutationCallback) { super((entries, observer) => { if (scope.active) callback(entries, observer); }); cleanups.push(() => this.disconnect()); }
        }
        disposers.push(() => {
            for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (error) { console.error(error); } }
            controller.abort(); timers.forEach(clearTimeout); timers.forEach(clearInterval); frames.forEach(cancelAnimationFrame);
            nodes.forEach(node => node.remove());
        });
        factory({scope, setTimeout:timeout, setInterval:interval, requestAnimationFrame:frame,
            ResizeObserver:ScopedResizeObserver, MutationObserver:ScopedMutationObserver,
            fetch:(url, options = {}) => fetch(url, {...options, signal:options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal})});
    }
    function loadScript(url: string) {
        if (!scripts.has(url)) scripts.set(url, new Promise<void>((resolve, reject) => {
            const script = document.createElement('script'); script.src = url;
            script.onload = () => resolve(); script.onerror = () => { scripts.delete(url); reject(new Error('Falha ao carregar a página.')); };
            document.head.append(script);
        }));
        return scripts.get(url);
    }
    async function go(destination: string | URL, replace = false) {
        const url = new URL(destination, location.href);
        if (url.origin !== location.origin || !routes.has(url.pathname)) { location.assign(url.href); return; }
        navigation?.abort(); const controller = new AbortController(); navigation = controller;
        try {
            const response = await fetch(url, {credentials:'same-origin', signal:controller.signal, headers:{'X-Workspace-Navigation':'1'}});
            if (!response.ok) throw new Error('Falha ao abrir a página.');
            const next = new DOMParser().parseFromString(await response.text(), 'text/html');
            const region = optionalElement(next, '#workspace-page', HTMLElement);
            if (!region || !optionalElement(next, '.sidebar', HTMLElement)) { location.assign(response.url || url.href); return; }
            const currentAccount = optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
            if (currentAccount !== optionalElement(next, '[data-user-id]', HTMLElement)?.dataset.userId) { location.assign(url.href); return; }
            const styles = [...elementList(next, 'link[rel="stylesheet"]', HTMLLinkElement)];
            await Promise.all(styles.map(link => {
                const href = new URL(link.getAttribute('href') ?? '', url).href;
                if ([...elementList(document, 'link[rel="stylesheet"]', HTMLLinkElement)].some(existing => existing.href === href)) return;
                return new Promise<void>((resolve, reject) => {
                    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = href; style.dataset.workspaceStyle = '';
                    style.onload = () => resolve(); style.onerror = reject; document.head.append(style);
                });
            }));
            if (controller.signal.aborted) return;
            navigating = true;
            const pageScripts = [...elementList(next, 'script[src]', HTMLScriptElement)].map(script => new URL(script.getAttribute('src') ?? '', url));
            for (const script of pageScripts) {
                if (factories.has(script.pathname) || [...document.scripts].some(existing => existing.src === script.href)) continue;
                await loadScript(script.href);
            }
            if (controller.signal.aborted) return;
            const desiredStyles = new Set(styles.map(link => new URL(link.getAttribute('href') ?? '', url).href));
            elementList(document, 'link[rel="stylesheet"]', HTMLLinkElement).forEach(link => {
                if (/\/(home|computer|graficos|news|recent-chats|aprender)\.css$/.test(new URL(link.href).pathname)) link.disabled = !desiredStyles.has(link.href);
            });
            while (disposers.length) disposers.pop()?.();
            await Promise.resolve();
            elementList(document, '[popover]', HTMLElement).forEach(node => { if (node.matches(':popover-open')) node.hidePopover(); });
            const collapsed = document.body.classList.contains('is-sidebar-collapsed');
            document.body.className = next.body.className;
            document.body.classList.toggle('is-sidebar-collapsed', collapsed);
            document.body.classList.add('sidebar-ready');
            elementList(region, 'script', HTMLScriptElement).forEach(script => script.remove());
            requiredElement(document, '#workspace-page', HTMLElement).replaceWith(document.importNode(region, true));
            const csrf = optionalElement(next, 'meta[name="csrf-token"]', HTMLMetaElement);
            if (csrf) {
                let current = optionalElement(document, 'meta[name="csrf-token"]', HTMLMetaElement);
                if (!current) { current = document.createElement('meta'); current.name = 'csrf-token'; document.head.append(current); }
                current.content = csrf.content;
            }
            if (!replace) history.pushState(null, '', url);
            document.title = next.title;
            elementList(document, '.sidebar__link', HTMLAnchorElement).forEach(link => {
                const active = next.querySelector(`.sidebar__link[href="${link.getAttribute('href')}"]`)?.hasAttribute('aria-current');
                if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
            });
            window.dispatchEvent(new Event('workspace:before-mount'));
            for (const script of pageScripts) { const factory = factories.get(script.pathname); if (factory) mount(factory); }
            requiredElement(document, '.workspace__content', HTMLElement).scrollTo({top:0, behavior:'instant'});
            window.dispatchEvent(new Event('workspace:navigated'));
        } catch (error) {
            if (!controller.signal.aborted) { console.error(error); location.assign(url.href); }
        } finally { if (navigation === controller) navigating = false; }
    }
    window.WorkspaceNavigation = {
        page(url, factory) { factories.set(url, factory); if (!navigating) mount(factory); }, go
    };
    document.addEventListener('click', event => {
        const link = eventElement(event.target)?.closest('a[href]');
        if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
        const url = new URL(link.href);
        if (!optionalElement(document, '#workspace-page', HTMLElement) || url.origin !== location.origin || !routes.has(url.pathname) || url.searchParams.has('panel')) return;
        event.preventDefault(); go(url);
    });
    window.addEventListener('popstate', () => { if (optionalElement(document, '#workspace-page', HTMLElement)) go(location.href, true); });
})();
