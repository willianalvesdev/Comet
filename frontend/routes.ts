import type { PageName } from './types';
export const routes: Record<string, PageName> = {'/':'index', '/index.html':'index', '/principal.html':'computer', '/novo.html':'computer', '/recentes.html':'recentes', '/descobrir.html':'descobrir', '/academico.html':'aprender', '/financas.html':'graficos'};
export const titles: Record<PageName, string> = {index:'Comet', computer:'Novo chat', recentes:'Recentes', descobrir:'Descobrir', aprender:'Acadêmico — Comet', graficos:'Finanças'};
