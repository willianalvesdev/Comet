import { redirect } from 'next/navigation';
export default async function LegacyConversationPage({params}: {params: Promise<{id: string}>}) {
    const {id} = await params;
    redirect('/chat/' + encodeURIComponent(id));
}
