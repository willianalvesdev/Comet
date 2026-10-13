"use client";

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BootstrapData } from './types';
import { routes, titles } from './routes';

const App = dynamic(() => import('./App'), {ssr: false});

export default function NextApplication() {
    const pathname = usePathname(), search = useSearchParams().toString(), router = useRouter();
    const [view, setView] = useState<{bootstrap: BootstrapData; revision: number} | null>(null);
    const [reload, setReload] = useState(0), [error, setError] = useState('');
    const silentURL = useRef(''), navigating = useRef(false);
    const pending = useRef<Array<() => void>>([]);
    const ready = useCallback(() => {
        navigating.current = false;
        document.querySelector('.workspace__content')?.scrollTo({top:0, behavior:'instant'});
        window.dispatchEvent(new Event('workspace:navigated'));
        pending.current.splice(0).forEach(resolve => resolve());
    }, []);

    useEffect(() => {
        const page = routes[pathname];
        const routeURL = pathname + (search ? '?' + search : '');
        if (silentURL.current === routeURL) { silentURL.current = ''; return; }
        if (!page) return;
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch('/api/bootstrap?page=' + page, {credentials:'same-origin', cache:'no-store', signal:controller.signal});
                if (response.status === 401) { location.assign('/?login=1'); return; }
                if (!response.ok) throw new Error('Não foi possível abrir esta página. Tente novamente.');
                const data = await response.json() as BootstrapData;
                if (controller.signal.aborted) return;
                if (page === 'index' && data.user) { location.assign('/principal.html'); return; }
                if (page !== 'index' && !data.user) { location.assign('/?login=1'); return; }
                let meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
                if (!meta) { meta = document.createElement('meta'); meta.name = 'csrf-token'; document.head.append(meta); }
                meta.content = data.csrfToken;
                document.title = titles[page];
                window.dispatchEvent(new Event('workspace:before-mount'));
                setError('');
                setView(previous => ({bootstrap:{...data, page, activePage:page}, revision:(previous?.revision ?? 0) + 1}));
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
            if (url.pathname === '/computer.html') url.pathname = '/novo.html';
            if (url.pathname === '/graficos.html') url.pathname = '/financas.html';
            if (url.pathname === '/aprender.html') url.pathname = '/academico.html';
            if (url.pathname === '/principal.html') { url.pathname = '/novo.html'; url.searchParams.set('new', '1'); }
            if (url.origin !== location.origin || !routes[url.pathname] || routes[url.pathname] === 'index' || routes[location.pathname] === 'index') { location.assign(url.href); return; }
            silentURL.current = '';
            navigating.current = true;
            const finished = new Promise<void>(resolve => pending.current.push(resolve));
            if (url.pathname === location.pathname && url.search === location.search) setReload(value => value + 1);
            else if (replace) router.replace(url.pathname + url.search + url.hash, {scroll:false});
            else router.push(url.pathname + url.search + url.hash, {scroll:false});
            return finished;
        }
        window.addEventListener('popstate', () => { navigating.current = true; silentURL.current = ''; }, {signal:controller.signal});
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
            if (url.origin !== location.origin || !routes[url.pathname] || routes[location.pathname] === 'index' || url.searchParams.has('panel') || (url.hash && url.pathname === location.pathname)) return;
            event.preventDefault(); void go(url);
        }, {signal:controller.signal});
        return () => { controller.abort(); pending.current.splice(0).forEach(resolve => resolve()); };
    }, [router]);

    if (error) return <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-xl tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8" role="alert"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></main>;
    if (!view) return <div role="status" className="tw:grid tw:min-h-screen tw:place-items-center">Carregando…</div>;
    const {bootstrap, revision} = view;
    return <App key={`${bootstrap.page === 'index' ? 'landing' : 'workspace'}-${bootstrap.user?.id ?? 'guest'}`} bootstrap={bootstrap} revision={revision} onReady={ready} />;
}
