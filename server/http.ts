export class ApiError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
}
export function json(data: unknown, status = 200): Response {
    return Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Envie os dados como JSON.');
    let value: unknown;
    try { value = await request.json(); } catch { throw new ApiError(400, 'JSON inválido.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Dados inválidos.');
    return value as Record<string, unknown>;
}
export async function boundedRequest(request: Request, maximum: number): Promise<Request> {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maximum) throw new ApiError(413, 'Arquivo ou mensagem muito grande.');
    if (!request.body) return request;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) { await reader.cancel(); throw new ApiError(413, 'Arquivo ou mensagem muito grande.'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return new Request(request.url, {method:request.method, headers:request.headers, body:data, signal:request.signal});
}
export function errorResponse(error: unknown): Response {
    if (error instanceof ApiError) return json({error:error.message, ...(error.code ? {code:error.code} : {})}, error.status);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal';
    console.error('Falha na API:', code);
    return json({error:'Não foi possível atender esta solicitação. Tente novamente em instantes.'}, 503);
}
