export const dynamicParams = false;
export function generateStaticParams() {
    return ['novo', 'recentes', 'descobrir', 'academico', 'financas', 'privacidade'].map(page => ({page: page + '.html'}));
}
export default function WorkspacePage() { return null; }
