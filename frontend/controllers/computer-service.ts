import { workspaceGet, clearWorkspaceCache } from './workspace-cache';
import { apiError, conversationsData, historyData, chatEventData } from './api-data';
import { present, requiredElement } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const connectionError = 'Não foi possível conectar à Computer. Confira se o Comet está aberto e tente novamente.';
    class ComputerService {
        async get(path: string, signal?: AbortSignal): Promise<unknown> {
            if (path === '/api/ai/models') return workspaceGet(path, 15000);
            if (path.startsWith('/api/ai/conversations?')) return workspaceGet(path, 10000);
            const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal }).catch(error => { if (error?.name === 'AbortError') throw error; throw new Error(connectionError); });
            const result: unknown = await response.json().catch(() => ({}));
            if (response.status === 401) clearWorkspaceCache(false);
            if (!response.ok) throw Object.assign(new Error(apiError(result, connectionError)), {status:response.status});
            return result;
        }
        list(offset: number | null = 0) { return this.get(`/api/ai/conversations?offset=${offset}`).then(conversationsData); }
        load(id:string, before:string|null = null, signal?: AbortSignal) {
            return this.get(`/api/ai/conversations/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`, signal).then(historyData);
        }
        async chat(payload:ChatRequest, onDelta:(text:string)=>void, signal:AbortSignal, onThinking?: (text:string)=>void, onConversation?:(event:ConversationEvent)=>void, onResearch?:(event:SearchEvent)=>void, onDone?:(metadata:ResponseMetadata)=>void,onArtifact?:(event:ArtifactEvent)=>void) {
            const regenerating = !!payload.regenerate && !payload.anonymous;
            const endpoint = regenerating ? `/api/ai/conversations/${encodeURIComponent(present(payload.conversation_id))}/messages/${encodeURIComponent(present(payload.regenerate))}/regenerate` : '/api/ai/chat';
            const body = regenerating ? {request_id:payload.request_id,provider:payload.provider,web_search:payload.web_search} : payload;
            const response = await fetch(endpoint, {
                method: 'POST', credentials: 'same-origin', signal,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson',
                    'X-CSRFToken': requiredElement(document, 'meta[name="csrf-token"]', HTMLMetaElement).content },
                body: JSON.stringify(body),
            }).catch((error: unknown) => {
                if ((error instanceof Error ? error.name : '') === 'AbortError') throw error;
                throw new Error(connectionError);
            });
            if (!response.ok) {
                const result: unknown = await response.json().catch(() => ({}));
                throw new Error(apiError(result, connectionError));
            }
            if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
                throw new Error(connectionError);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finished = false;
            function handle(line:string) {
                if (!line.trim()) return;
                let event:ChatEvent;
                try { event = chatEventData(JSON.parse(line)); }
                catch { throw new Error('A resposta foi interrompida. Tente novamente.'); }
                if (event.type === 'error') throw new Error(event.error || connectionError);
                if (event.type === 'done') { finished = true; onDone?.(event.metadata || {}); return; }
                if(event.type==='artifact'){onArtifact?.(event);return;}
                if (event.type === 'search') { onResearch?.(event); return; }
                if (event.type === 'conversation') { onConversation?.(event); return; }
                if (event.type === 'thinking') {
                    if (typeof event.text !== 'string') throw new Error('Não consegui ler o pensamento. Tente novamente.');
                    onThinking?.(event.text);
                    return;
                }
                if (event.type !== 'delta' || typeof event.text !== 'string') {
                    throw new Error('Não consegui ler a resposta. Tente novamente.');
                }
                onDelta(event.text);
            }
            try {
                while (!finished) {
                    const { value, done } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    if (buffer.length > 1048576) throw new Error('A resposta foi interrompida. Tente novamente.');
                    let end = 0;
                    while ((end = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, end);
                        buffer = buffer.slice(end + 1);
                        handle(line);
                        if (finished) break;
                    }
                    if (done) {
                        if (buffer.trim() && !finished) handle(buffer);
                        break;
                    }
                }
                if (!finished) throw new Error('A resposta foi interrompida. Tente novamente.');
            } catch (error) {
                if (error instanceof TypeError) throw new Error(connectionError);
                throw error;
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        }
    }
    window.ComputerService = ComputerService;
}
