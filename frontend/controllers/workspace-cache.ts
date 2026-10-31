import { apiError } from './api-data';

// Private to this workspace in memory; never persisted in browser storage.
const resources = new Map<string, {value?: unknown; expires: number; pending?: Promise<unknown>; controller?: AbortController}>();
const histories = new Map<string, {value: ConversationHistory; checked: number; size: number}>();
export interface ChatViewState { draft: string; attachments: Attachment[]; scrollTop: number; following: boolean; }
const views = new Map<string, ChatViewState>();
let enabled = true;

export function clearWorkspaceCache(allowWrites = true) {
    enabled = allowWrites;
    for (const entry of resources.values()) entry.controller?.abort();
    resources.clear(); histories.clear(); views.clear();
}
export function invalidateWorkspaceResource(prefix: string) {
    for (const [key, entry] of resources) if (key.startsWith(prefix)) {
        entry.controller?.abort(); resources.delete(key);
    }
}
export async function workspaceGet(path: string, maxAge: number, force = false): Promise<unknown> {
    if (!enabled) throw new DOMException('Sessão encerrada.', 'AbortError');
    const cached = resources.get(path);
    if (cached?.pending) return cached.pending;
    if (!force && cached && cached.expires > Date.now()) return cached.value;
    const controller = new AbortController();
    const entry: {value?: unknown; expires: number; pending?: Promise<unknown>; controller?: AbortController} = {expires:0, controller};
    resources.set(path, entry);
    entry.pending = (async () => {
        const response = await fetch(path, {credentials:'same-origin', cache:'no-store', signal:controller.signal});
        const value: unknown = await response.json();
        if (response.status === 401) clearWorkspaceCache(false);
        if (!response.ok) throw new Error(apiError(value, 'Não foi possível carregar os dados. Tente novamente.'));
        controller.signal.throwIfAborted();
        entry.value = value; entry.expires = Date.now() + maxAge;
        return value;
    })();
    try { return await entry.pending; }
    catch (error) { if (resources.get(path) === entry) resources.delete(path); throw error; }
    finally {
        entry.pending = undefined; entry.controller = undefined;
        while (resources.size > 40) {
            const oldest = [...resources].find(([, value]) => !value.pending);
            if (!oldest) break;
            resources.delete(oldest[0]);
        }
    }
}
export function cachedConversation(id: string) {
    const entry = histories.get(id);
    if (entry) { histories.delete(id); histories.set(id, entry); }
    return entry;
}
export function cacheConversation(value: ConversationHistory, checked = Date.now()) {
    if (!enabled || value.conversation.is_owner === false) return;
    const snapshot = structuredClone(value), size = JSON.stringify(snapshot).length;
    histories.delete(value.conversation.id);
    if (size > 4_000_000) return;
    histories.set(value.conversation.id, {value:snapshot, checked, size});
    let total = [...histories.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (histories.size > 20 || total > 4_000_000) {
        const [id, entry] = histories.entries().next().value!;
        total -= entry.size; histories.delete(id);
    }
}
export function invalidateConversation(id: string, deleted = false) {
    histories.delete(id);
    if (deleted) views.delete(id);
    invalidateWorkspaceResource('/api/ai/conversations?');
}
export function saveChatView(id: string | null, value: ChatViewState) {
    if (!enabled) return;
    const key = id ?? 'new';
    views.delete(key); views.set(key, structuredClone(value));
    while (views.size > 30) views.delete(views.keys().next().value!);
}
export function chatView(id: string | null) { return views.get(id ?? 'new'); }
export function clearChatView(id: string | null) { views.delete(id ?? 'new'); }

let channel: BroadcastChannel | undefined;
export function publishConversationChange(id: string) { channel?.postMessage({id}); }
export function mountWorkspaceCache(account: number | undefined) {
    clearWorkspaceCache();
    if (account === undefined) return () => clearWorkspaceCache(false);
    channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('comet-workspace-' + account);
    const connection = channel;
    let receiving = false;
    const changed = (event: AppEvents['sessions:changed']) => {
        if (event.detail.id.startsWith('anonymous-')) return;
        invalidateConversation(event.detail.id, event.detail.deleted);
        if (!receiving) connection?.postMessage(event.detail);
    };
    if (connection) connection.onmessage = ({data}: MessageEvent<unknown>) => {
        if (!data || typeof data !== 'object') return;
        if ('logout' in data && data.logout === true) { clearWorkspaceCache(false); location.assign('/?login=1'); return; }
        if (!('id' in data) || typeof data.id !== 'string') return;
        const detail = {id:data.id, deleted:'deleted' in data && data.deleted === true,
            title:'title' in data && typeof data.title === 'string' ? data.title : undefined};
        receiving = true;
        try { window.dispatchEvent(new CustomEvent('sessions:changed', {detail})); }
        finally { receiving = false; }
    };
    const logout = (event: Event) => {
        if (event.target instanceof HTMLFormElement && new URL(event.target.action, location.href).pathname === '/logout') {
            connection?.postMessage({logout:true}); clearWorkspaceCache(false);
        }
    };
    window.addEventListener('sessions:changed', changed);
    document.addEventListener('submit', logout);
    return () => {
        window.removeEventListener('sessions:changed', changed); document.removeEventListener('submit', logout);
        connection?.close(); if (channel === connection) channel = undefined;
        clearWorkspaceCache(false);
    };
}
