export const dynamicParams = false;
export function generateStaticParams() {
    return ['computer', 'recentes', 'descobrir', 'aprender', 'graficos'].map(page => ({page: page + '.html'}));
}
export default function WorkspacePage() { return null; }
