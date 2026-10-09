import type { PageName } from './types';
export const routes: Record<string, PageName> = {'/':'index', '/index.html':'index', '/principal.html':'computer', '/computer.html':'computer', '/recentes.html':'recentes', '/descobrir.html':'descobrir', '/aprender.html':'aprender', '/graficos.html':'graficos'};
export const titles: Record<PageName, string> = {index:'Comet', computer:'Novo chat', recentes:'Recentes', descobrir:'Descobrir', aprender:'Aprender — Comet', graficos:'Finanças'};
