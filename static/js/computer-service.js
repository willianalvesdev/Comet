(() => {
    const connectionError = 'Não foi possível conectar à Computer. Confira se o Ascenda está aberto e tente novamente.';
    class ComputerService {
        async get(path) {
            const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' }).catch(() => { throw new Error(connectionError); });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || connectionError);
            return result;
        }
        list(offset = 0) { return this.get(`/api/ai/conversations?offset=${offset}`); }
        load(id, before = null) {
            return this.get(`/api/ai/conversations/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`);
        }
        async chat(payload, onDelta, signal, onThinking, onConversation) {
            const response = await fetch('/api/ai/chat', {
                method: 'POST', credentials: 'same-origin', signal,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson',
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
                body: JSON.stringify(payload),
            }).catch(error => {
                if (error.name === 'AbortError') throw error;
                throw new Error(connectionError);
            });
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || connectionError);
            }
            if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
                throw new Error(connectionError);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finished = false;
            function handle(line) {
                if (!line.trim()) return;
                let event;
                try { event = JSON.parse(line); }
                catch { throw new Error('A resposta foi interrompida. Tente novamente.'); }
                if (event.type === 'error') throw new Error(event.error || connectionError);
                if (event.type === 'done') { finished = true; return; }
                if (event.type === 'conversation') { onConversation(event); return; }
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
                    if (buffer.length > 131072) throw new Error('A resposta foi interrompida. Tente novamente.');
                    let end;
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
})();
