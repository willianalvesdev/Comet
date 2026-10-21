import type { PageName } from './types';
export const routes: Record<string, PageName> = {'/':'index', '/privacy':'privacidade', '/index.html':'index', '/principal.html':'computer', '/new':'computer', '/recent':'recentes', '/discover':'descobrir', '/academic':'aprender', '/finance':'graficos', '/finance/crypto':'cripto'};
export const titles: Record<PageName, string> = {index:'Comet', privacidade:'Política de Privacidade — Comet', computer:'Novo chat', recentes:'Recentes', descobrir:'Descobrir', aprender:'Acadêmico — Comet', graficos:'Finanças', cripto:'Cripto — Comet'};

export const isPublicPage = (page: PageName) => page === 'index' || page === 'privacidade';

export const conversationPath = (id: string) => '/chat/' + encodeURIComponent(id);
export const pageForPath = (path: string): PageName | undefined => /^\/chat\/[^/]+$/.test(path) ? 'computer' : /^\/finance\/crypto\/[a-z0-9][a-z0-9-]{0,99}$/.test(path) ? 'cripto' : routes[path];
export function conversationIdFromURL(url: URL): string | null {
    const match = url.pathname.match(/^\/chat\/([^/]+)$/);
    if (match) { try { return decodeURIComponent(match[1]); } catch { return null; } }
    return url.searchParams.has('new') ? null : url.searchParams.get('conversation');
}

routes['/novo.html'] = routes['/new'];
routes['/recentes.html'] = routes['/recent'];
routes['/descobrir.html'] = routes['/discover'];
routes['/academico.html'] = routes['/academic'];
routes['/financas.html'] = routes['/finance'];
routes['/privacidade.html'] = routes['/privacy'];
