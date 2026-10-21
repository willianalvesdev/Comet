export const dynamicParams = false;
export function generateStaticParams() {
    return ['new', 'recent', 'discover', 'academic', 'finance', 'privacy'].map(page => ({page}));
}
export default function WorkspacePage() { return null; }
