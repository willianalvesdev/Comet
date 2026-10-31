"use client";

import LoadingIndicator from './components/LoadingIndicator';

import { loadPage, type PageModule } from './runtime/pages';
import PageRecovery from './components/PageRecovery';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BootstrapData } from './types';
import { pageForPath, conversationIdFromURL, conversationPath, titles, isPublicPage } from './routes';

const App = dynamic(() => import('./App'), {ssr: false, loading: () => <div role="status" className="tw:grid tw:min-h-screen tw:place-items-center"><LoadingIndicator label="Carregando página"/></div>});

const SharedConversation = dynamic(() => import('./components/SharedConversation'));

export default function NextApplication() {
    const pathname = usePathname(), search = useSearchParams().toString(), router = useRouter();
    const [view, setView] = useState<{bootstrap: BootstrapData; revision: number; pageModule:PageModule} | null>(null);
    const [reload, setReload] = useState(0), [error, setError] = useState('');
    const [guestId,setGuestId]=useState<string|null>(null);
    const silentURL = useRef(''), navigating = useRef(false);
    const currentRoute = useRef(pathname + (search ? '?' + search : ''));
    currentRoute.current = pathname + (search ? '?' + search : '');
    const pending = useRef<Array<() => void>>([]);
    const ready = useCallback(() => {
        navigating.current = false;
        document.querySelector('.workspace__content')?.scrollTo({top:0, behavior:'instant'});
        window.dispatchEvent(new Event('workspace:navigated'));
        pending.current.splice(0).forEach(resolve => resolve());
    }, []);

    useEffect(() => {
        const resolvedPage = pageForPath(pathname);
        const routeURL = pathname + (search ? '?' + search : '');
        if (silentURL.current === routeURL) { silentURL.current = ''; return; }
        if (!resolvedPage) return;
        const page = resolvedPage;
        const controller = new AbortController();
        setGuestId(null);
        async function load() {
            try {
                const [data, pageModule] = await Promise.all([
                    fetch('/api/bootstrap?page=' + page, {credentials:'same-origin', cache:'no-store', signal:controller.signal}).then(response => {
                        if (response.status === 401) { if(/^\/chat\/[1-9]\d{0,19}$/.test(pathname)){setGuestId(pathname.split('/')[2]);setError('');ready();}else location.assign('/?login=1');return null; }
                        if (!response.ok) throw new Error('Não foi possível abrir esta página. Tente novamente.');
                        return response.json() as Promise<BootstrapData>;
                    }),
                    loadPage(page),
                    import('./App'),
                ]);
                if (!data) return;
                if (controller.signal.aborted) return;
                if(data.user){try{const destination=sessionStorage.getItem('comet-login-return');if(destination&&/^\/chat\/[1-9]\d{0,19}$/.test(destination)){sessionStorage.removeItem('comet-login-return');if(pathname!==destination){location.assign(destination);return;}}}catch{}}
                if (page === 'index' && data.user) { location.assign('/principal.html'); return; }
                if (!isPublicPage(page) && !data.user) { location.assign('/?login=1'); return; }
                let meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
                if (!meta) { meta = document.createElement('meta'); meta.name = 'csrf-token'; document.head.append(meta); }
                meta.content = data.csrfToken;
                document.title = titles[page];
                window.dispatchEvent(new Event('workspace:before-mount'));
                setError('');
                setView(previous => ({bootstrap:{...data, page, activePage:page, conversationId:conversationIdFromURL(new URL(routeURL, location.origin))}, revision:(previous?.revision ?? 0) + 1, pageModule}));
            } catch (failure) {
                if (!controller.signal.aborted) {
                    navigating.current = false;
                    setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a página.');
                    pending.current.splice(0).forEach(resolve => resolve());
                }
            }
        }
        void load();
        return () => controller.abort();
    }, [pathname, search, reload]);

    useEffect(() => {
        const controller = new AbortController();
        async function go(destination: string | URL, replace = false) {
            const url = new URL(destination, location.href);
            if (url.pathname === '/computer.html') url.pathname = '/new';
            if (url.pathname === '/graficos.html') url.pathname = '/finance';
            if (url.pathname === '/aprender.html') url.pathname = '/academic';
            if (url.pathname === '/principal.html') { url.pathname = '/new'; url.searchParams.set('new', '1'); }
            if (url.origin !== location.origin || !pageForPath(url.pathname) || pageForPath(url.pathname) === 'index' || pageForPath(location.pathname) === 'index') { location.assign(url.href); return; }
            const id = conversationIdFromURL(url);
            if (pageForPath(url.pathname) === 'computer' && id) { url.pathname = conversationPath(id); url.searchParams.delete('conversation'); }
            silentURL.current = '';
            navigating.current = true;
            const finished = new Promise<void>(resolve => pending.current.push(resolve));
            if (url.pathname === location.pathname && url.search === location.search) setReload(value => value + 1);
            else if (replace) router.replace(url.pathname + url.search + url.hash, {scroll:false});
            else router.push(url.pathname + url.search + url.hash, {scroll:false});
            return finished;
        }
        window.addEventListener('popstate', () => { if (location.pathname + location.search === currentRoute.current) return; navigating.current = true; silentURL.current = ''; }, {signal:controller.signal});
        window.WorkspaceNavigation = {go, replaceURL(url) {
            if (navigating.current) return;
            const target = new URL(url, location.href);
            if (target.href === location.href) return;
            const query = target.searchParams.toString();
            silentURL.current = target.pathname + (query ? '?' + query : '');
            history.replaceState(null, '', target);
        }};
        document.addEventListener('click', event => {
            const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
            if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
            const url = new URL(link.href);
            if (url.origin !== location.origin || !pageForPath(url.pathname) || pageForPath(location.pathname) === 'index' || url.searchParams.has('panel') || (url.hash && url.pathname === location.pathname)) return;
            event.preventDefault(); void go(url);
        }, {signal:controller.signal});
        return () => { controller.abort(); pending.current.splice(0).forEach(resolve => resolve()); };
    }, [router]);

    if(guestId)return <SharedConversation key={guestId} id={guestId} />;
    if (error) return <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-xl tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8" role="alert"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></main>;
    if (!view) return <div role="status" className="tw:grid tw:min-h-screen tw:place-items-center"><LoadingIndicator/></div>;
    const {bootstrap, revision, pageModule} = view;
    return <PageRecovery revision={revision} onRetry={() => setReload(value => value + 1)} onFailure={ready}><App key={`${isPublicPage(bootstrap.page) ? 'landing' : 'workspace'}-${bootstrap.user?.id ?? 'guest'}`} bootstrap={bootstrap} revision={revision} onReady={ready} pageModule={pageModule} /></PageRecovery>;
}
