import { AIError, isOllamaModel, isObject, type Event, type Message } from './types';

export function aiConfig() {
  const base = new URL(process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
  const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
  const timeout = Number(process.env.OLLAMA_TIMEOUT_SECONDS || 120) * 1000;
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !isOllamaModel(model) || !Number.isFinite(timeout) || timeout < 1000 || timeout > 300000) throw new AIError('incompatible', 503);
  if (base.hostname === 'localhost') base.hostname = '127.0.0.1';
  return { base: base.origin, model, timeout };
}
function geminiModels() {
  const models = [...new Set([process.env.GEMINI_MODEL || 'gemini-3.8-flash', ...(process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-2.5-flash,gemini-2.5-flash-lite').split(',').map(value => value.trim()).filter(Boolean)])];
  if (models.length > 6 || models.some(model => !/^[A-Za-z0-9._-]{1,100}$/.test(model))) throw new AIError('provider_model', 503);
  return models;
}
function networkError(error: unknown, signal: AbortSignal, local = false): never {
  if (error instanceof AIError) throw error;
  if (signal.aborted) {
    if (signal.reason?.name === 'TimeoutError') throw new AIError('timeout', 504);
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
  if ((error as Error)?.name === 'TimeoutError') throw new AIError('timeout', 504);
  throw new AIError(local ? 'unavailable' : 'provider_unavailable', 503);
}
export async function fetchAI(url: string, init: RequestInit, signal: AbortSignal, timeout = aiConfig().timeout) {
  const connect = new AbortController();
  const timer = setTimeout(() => connect.abort(new DOMException('Timeout', 'TimeoutError')), timeout);
  try { return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, connect.signal]) }); }
  catch (error) { networkError(error, connect.signal.aborted ? connect.signal : signal, url.startsWith(aiConfig().base)); }
  finally { clearTimeout(timer); }
}
async function* chunks(response: Response, signal: AbortSignal, maxBytes: number, idleMs = aiConfig().timeout) {
  if (!response.body) throw new AIError('invalid_response');
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new AIError('timeout', 504)); }, idleMs); }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) throw new AIError('invalid_response');
      yield result.value;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function readText(response: Response, signal: AbortSignal, maxBytes: number) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let value = '';
  try { for await (const chunk of chunks(response, signal, maxBytes)) value += decoder.decode(chunk, { stream: true }); return value + decoder.decode(); }
  catch (error) { if (error instanceof TypeError) throw new AIError('invalid_response'); throw error; }
}
export async function* lines(response: Response, signal: AbortSignal, maxLine = 65536) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  try {
    for await (const chunk of chunks(response, signal, 8388608)) {
      pending += decoder.decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary).replace(/\r$/, '');
        pending = pending.slice(boundary + 1);
        if (Buffer.byteLength(line) > maxLine) throw new AIError('invalid_response');
        yield line;
      }
      if (Buffer.byteLength(pending) > maxLine) throw new AIError('invalid_response');
    }
    pending += decoder.decode();
    if (pending) yield pending;
  } catch (error) { if (error instanceof TypeError) throw new AIError('invalid_response'); throw error; }
}
export async function* sse(response: Response, signal: AbortSignal) {
  let parts: string[] = [], size = 0;
  for await (const line of lines(response, signal, 1048576)) {
    if (!line) { if (parts.length) yield parts.join('\n'); parts = []; size = 0; }
    else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, '');
      size += value.length;
      if (size > 1048576) throw new AIError('invalid_response');
      parts.push(value);
    }
  }
  if (parts.length) throw new AIError('invalid_response');
}
export function strictJSON(raw: string): unknown {
  let index = 0;
  const fail = (): never => { throw new AIError('invalid_response'); };
  const space = () => { while (/[\t\n\r ]/.test(raw[index] || 'x')) index++; };
  const string = (): string => {
    const start = index++;
    for (; index < raw.length; index++) {
      if (raw[index] === '\\') index++;
      else if (raw[index] === '"') { index++; try { return JSON.parse(raw.slice(start, index)) as string; } catch { fail(); } }
    }
    return fail();
  };
  const parse = (depth: number): unknown => {
    if (depth > 100) return fail();
    space();
    if (raw[index] === '"') return string();
    if (raw[index] === '{') {
      index++; space(); const value: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (raw[index] === '}') { index++; return value; }
      for (;;) {
        space(); if (raw[index] !== '"') return fail();
        const key = string(); if (keys.has(key)) return fail(); keys.add(key);
        space(); if (raw[index++] !== ':') return fail();
        value[key] = parse(depth + 1); space();
        if (raw[index] === '}') { index++; return value; }
        if (raw[index++] !== ',') return fail();
      }
    }
    if (raw[index] === '[') {
      index++; space(); const value: unknown[] = [];
      if (raw[index] === ']') { index++; return value; }
      for (;;) { value.push(parse(depth + 1)); space(); if (raw[index] === ']') { index++; return value; } if (raw[index++] !== ',') return fail(); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(index));
    if (!match) return fail();
    index += match[0].length;
    const value: unknown = JSON.parse(match[0]);
    if (typeof value === 'number' && !Number.isFinite(value)) return fail();
    return value;
  };
  const value = parse(0); space(); if (index !== raw.length) return fail(); return value;
}
async function objectResponse(response: Response, signal: AbortSignal, maxBytes = 2 * 1024 * 1024) {
  const value = strictJSON(await readText(response, signal, maxBytes));
  if (!isObject(value)) throw new AIError('invalid_response');
  return value;
}
function ollamaExecution(info: Record<string, unknown>, name: string): 'local' | 'cloud' {
  if (info.remote_host) {
    let host: URL;
    try { host=new URL(String(info.remote_host)); } catch { throw new AIError('incompatible',503); }
    if (host.origin!=='https://ollama.com' || host.pathname!=='/' || host.username || host.password || host.search || host.hash) throw new AIError('incompatible',503);
  }
  return info.remote_model || info.remote_host || /[:-]cloud(?::latest)?$/i.test(name) ? 'cloud' : 'local';
}
export async function ollamaModels(signal = AbortSignal.timeout(3000)): Promise<{name:string;execution:'local'|'cloud'}[]> {
  const config = aiConfig();
  try {
    const response = await fetchAI(config.base + '/api/tags', { headers: { Accept: 'application/json' } }, signal, 3000);
    if (!response.ok) { await response.body?.cancel(); throw new AIError('unavailable', 503); }
    const data = await objectResponse(response, signal);
    if (!Array.isArray(data.models)) throw new AIError('invalid_response');
    const models = new Map<string,{name:string;execution:'local'|'cloud'}>();
    for (const item of data.models.filter(isObject)) {
      if (!isOllamaModel(item.name)) continue;
      try { models.set(item.name,{name:item.name,execution:ollamaExecution(item,item.name)}); } catch { continue; }
    }
    return [...models.values()].sort((a,b)=>a.name.localeCompare(b.name));
  } catch (error) { networkError(error, signal, true); }
}
export async function localModels(signal = AbortSignal.timeout(3000)): Promise<string[]> {
  return (await ollamaModels(signal)).filter(model=>model.execution==='local').map(model=>model.name);
}
class ContextError extends AIError { constructor(public required: number) { super('context_size', 422); } }
async function localPost(path: string, payload: unknown, signal: AbortSignal) {
  const response = await fetchAI(aiConfig().base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) }, signal);
  if (response.ok) return response;
  if (response.status === 400) {
    try {
      const raw = await objectResponse(response, signal, 16384);
      const detail = typeof raw.error === 'string' ? strictJSON(raw.error) : { error: raw.error };
      if (isObject(detail) && isObject(detail.error) && detail.error.type === 'exceed_context_size_error' && Number.isInteger(detail.error.n_prompt_tokens) && Number(detail.error.n_prompt_tokens) > 0 && Number(detail.error.n_prompt_tokens) < 1048576) throw new ContextError(Number(detail.error.n_prompt_tokens));
    } catch (error) { if (error instanceof ContextError) throw error; }
  }
  await response.body?.cancel().catch(() => {});
  throw new AIError([401,403].includes(response.status) ? 'ollama_auth' : response.status === 429 ? 'provider_quota' : response.status === 404 ? 'model_missing' : [400, 422].includes(response.status) ? 'incompatible' : 'unavailable', 503);
}
async function modelInfo(model: string, signal: AbortSignal) {
  const info = await objectResponse(await localPost('/api/show', { model }, signal), signal);
  const cloud = ollamaExecution(info,model) === 'cloud';
  const limits = isObject(info.model_info) ? Object.entries(info.model_info).filter(([key, value]) => key.endsWith('.context_length') && Number.isInteger(value) && Number(value) > 0).map(([, value]) => Number(value)) : [];
  const thinking = Array.isArray(info.capabilities) ? info.capabilities.includes('thinking') : !model.startsWith('gemma3:') && !model.includes('-instruct-');
  return { context: Math.min(...(limits.length ? limits : [cloud ? 32768 : 4096])), thinking, info, cloud };
}
function clipped(text: string, budget: number) {
  const raw = Buffer.from(text);
  if (raw.length <= budget) return text;
  const marker = '\n[trecho intermediário omitido para caber no contexto]\n';
  const rest = Math.max(0, budget - Buffer.byteLength(marker));
  if (!rest) return '';
  const decode = (buffer: Buffer) => buffer.toString('utf8').replace(/\uFFFD/g, '');
  return decode(raw.subarray(0, Math.floor(rest / 2))) + marker + decode(raw.subarray(raw.length - Math.ceil(rest / 2)));
}
export function fitMessages(messages: Message[], budget: number): Message[] {
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const history = system ? messages.slice(1) : messages;
  const result: Message[] = [];
  if (system) {
    const content = clipped(system.content, Math.max(256, budget - Math.min(2048, Math.max(512, Buffer.byteLength(history.at(-1)?.content || '')))));
    result.push({ role: 'system', content }); budget -= Buffer.byteLength(content) + 80;
  }
  if (!history.length) return result;
  const latest: Message = { ...history.at(-1)!, content: clipped(history.at(-1)!.content, Math.max(100, budget - 80)) };
  budget -= Buffer.byteLength(latest.content) + 80;
  const recent: Message[] = [];
  for (let index = history.length - 3; index >= 0; index -= 2) {
    const pair = history.slice(index, index + 2);
    const cost = pair.reduce((n, m) => n + Buffer.byteLength(m.content) + 80, 0);
    if (cost > budget) break;
    recent.unshift(...pair); budget -= cost;
  }
  if (recent.length < history.length - 1 && result.length) result[0].content += '\nParte do histórico foi omitida. Não invente o conteúdo ausente; peça esclarecimento se necessário.';
  return [...result, ...recent, latest];
}
export async function* streamLocal(model: string, messages: Message[], signal: AbortSignal): AsyncGenerator<Event> {
  try {
    const { context, thinking, info, cloud } = await modelInfo(model, signal);
    const values = isObject(info.thinking) && Array.isArray(info.thinking.values) ? info.thinking.values : [];
    const think = values.length && !values.includes(true) ? values.find(value=>value==='medium') ?? values.find(value=>['low','high'].includes(String(value))) : true;
    if (thinking && think === undefined) throw new AIError('incompatible', 503);
    const local = messages.map((message, index) => index ? message : { ...message, content: message.content + `\nModelo desta resposta: ${model}. Provedor: ${cloud ? 'Ollama Cloud. O processamento acontece na nuvem do Ollama' : 'Ollama local. O processamento acontece no computador que hospeda o Comet'}.` });
    const configured = Number(process.env.OLLAMA_CONTEXT_LENGTH || 8192);
    if (!Number.isInteger(configured) || configured < 4096 || configured > 32768) throw new AIError('incompatible', 503);
    const limit = cloud ? context : Math.min(context, configured), budget = Math.max(512, (limit - 1024) * 2);
    const payload = { model, messages: fitMessages(local, budget), stream: true, ...(thinking ? { think } : {}), ...(!cloud ? {options:{num_ctx:limit}} : {}) };
    let response: Response;
    try { response = await localPost('/api/chat', payload, signal); }
    catch (error) {
      if (!(error instanceof ContextError)) throw error;
      payload.messages = fitMessages(local, Math.max(512, Math.floor(budget * Math.min(0.7, Math.max(0.1, (limit - 1024) / error.required)))));
      response = await localPost('/api/chat', payload, signal);
    }
    let answer = 0, thought = 0;
    for await (const raw of lines(response, signal)) {
      if (!raw.trim()) continue;
      const chunk = strictJSON(raw);
      if (!isObject(chunk)) throw new AIError('invalid_response');
      if (chunk.error) throw new AIError('stream_error');
      const message = chunk.message ?? {};
      if (!isObject(message) || typeof (message.content ?? '') !== 'string' || typeof (message.thinking ?? '') !== 'string') throw new AIError('invalid_response');
      if (message.tool_calls) throw new AIError('incompatible', 503);
      if (message.thinking) {
        thought += String(message.thinking).length;
        if (answer || thought > 48000) throw new AIError('invalid_response');
        yield { type: 'thinking', text: String(message.thinking) };
      }
      if (message.content) {
        answer += String(message.content).length;
        if (answer > 16000) throw new AIError('invalid_response');
        yield { type: 'delta', text: String(message.content) };
      }
      if (chunk.done === true) { if (!answer) throw new AIError('invalid_response'); return; }
    }
    throw new AIError('stream_error');
  } catch (error) { networkError(error, signal, true); }
}
function geminiPayload(model: string, messages: Message[], search: boolean) {
  return {
    systemInstruction: { parts: [{ text: messages[0].content + `\nModelo desta resposta: ${model}. Provedor: Gemini. Processamento via API externa.` }] },
    contents: messages.slice(1).map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }, ...(message.role === 'user' ? (message.images || []).map(data => ({ inlineData: { mimeType: 'image/jpeg', data } })) : [])] })),
    generationConfig: { maxOutputTokens: 8192, thinkingConfig: { includeThoughts: true } },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
}
async function geminiPost(model: string, operation: string, payload: unknown, signal: AbortSignal) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AIError('provider_missing', 503);
  const response = await fetchAI(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: operation.includes('stream') ? 'text/event-stream' : 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload) }, signal);
  if (!response.ok) {
    await response.body?.cancel();
    const code = [401, 403].includes(response.status) ? 'provider_auth' : [402, 429].includes(response.status) ? 'provider_quota' : [400, 404].includes(response.status) ? 'provider_model' : 'provider_unavailable';
    throw new AIError(code, response.status === 429 ? 429 : 502);
  }
  return response;
}
export async function* streamGemini(messages: Message[], signal: AbortSignal, search = false): AsyncGenerator<Event> {
  const models = geminiModels();
  for (let index = 0; index < models.length; index++) {
    let emitted = false;
    try {
      const response = await geminiPost(models[index], 'streamGenerateContent?alt=sse', geminiPayload(models[index], messages, search), signal);
      if (!response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new AIError('invalid_response'); }
      let answer = 0, thought = 0, complete = false;
      for await (const raw of sse(response, signal)) {
        if (raw === '[DONE]') break;
        const chunk = strictJSON(raw);
        if (!isObject(chunk)) throw new AIError('invalid_response');
        if (chunk.error) throw new AIError('provider_unavailable');
        if (isObject(chunk.promptFeedback) && chunk.promptFeedback.blockReason) throw new AIError('provider_blocked');
        const candidates = chunk.candidates ?? [];
        if (!Array.isArray(candidates)) throw new AIError('invalid_response');
        if (!candidates.length) continue;
        const candidate = candidates[0];
        if (!isObject(candidate)) throw new AIError('invalid_response');
        if (search && isObject(candidate.groundingMetadata)) { emitted = true; yield { type: 'grounding', data: candidate.groundingMetadata }; }
        const parts = isObject(candidate.content) ? candidate.content.parts ?? [] : [];
        if (!Array.isArray(parts)) throw new AIError('invalid_response');
        if (candidate.finishReason) {
          if (candidate.finishReason !== 'STOP') throw new AIError(candidate.finishReason === 'MAX_TOKENS' ? 'invalid_response' : 'provider_blocked');
          complete = true;
        }
        for (const part of parts) {
          if (!isObject(part)) throw new AIError('invalid_response');
          if (!('text' in part)) continue;
          if (typeof part.text !== 'string') throw new AIError('invalid_response');
          if (part.thought) thought += part.text.length; else answer += part.text.length;
          if (thought > 48000 || answer > 16000) throw new AIError('invalid_response');
          if (part.text) { emitted = true; yield { type: part.thought ? 'thinking' : 'delta', text: part.text }; }
        }
        if (complete) break;
      }
      if (!complete || !answer) throw new AIError('invalid_response');
      return;
    } catch (error) {
      if (!emitted && error instanceof AIError && error.code === 'provider_quota' && error.status === 429 && index < models.length - 1) continue;
      networkError(error, signal);
    }
  }
}
export async function structured(provider: string, system: string, data: unknown, schema: unknown, signal: AbortSignal): Promise<unknown> {
  if (provider !== 'gemini') {
    const model = provider === 'qwen' ? aiConfig().model : provider;
    const { context, thinking, cloud, info } = await modelInfo(model, signal);
    const limit = Math.min(context, 16384), messages: Message[] = [{ role: 'system', content: cloud ? system + '\nRetorne apenas JSON válido que corresponda a este schema: ' + JSON.stringify(schema) : system }, { role: 'user', content: JSON.stringify(data) }];
    if (messages.reduce((n, m) => n + m.content.length, 0) > Math.max(512, (limit - 1024) * 2)) throw new AIError('context_size', 422);
    const levels = isObject(info.thinking) && Array.isArray(info.thinking.values) ? info.thinking.values : [];
    const think = levels.length && !levels.includes(false) ? levels.find(value=>value==='low') ?? levels.find(value=>value==='medium') ?? false : false;
    const payload = { model, messages, stream: false, ...(!cloud ? {format:schema} : {}), options: { temperature: 0, ...(!cloud ? {num_ctx:limit,num_predict:8192} : {}) }, ...(thinking ? { think } : {}) };
    const response = await objectResponse(await localPost('/api/chat', payload, signal), signal, 131072);
    if (response.done !== true || response.error || response.done_reason && response.done_reason !== 'stop' || !isObject(response.message) || response.message.tool_calls || typeof response.message.content !== 'string') throw new AIError('invalid_response');
    return strictJSON(cloud ? response.message.content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1') : response.message.content);
  }
  const models = geminiModels();
  for (let index = 0; index < models.length; index++) {
    try {
      const payload = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(data) }] }], generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json', responseJsonSchema: schema } };
      const result = await objectResponse(await geminiPost(models[index], 'generateContent', payload, signal), signal, 131072);
      if (result.error) throw new AIError('invalid_response');
      if (isObject(result.promptFeedback) && result.promptFeedback.blockReason) throw new AIError('provider_blocked');
      if (!Array.isArray(result.candidates) || result.candidates.length !== 1 || !isObject(result.candidates[0])) throw new AIError('invalid_response');
      const candidate = result.candidates[0];
      if (candidate.finishReason !== 'STOP' || !isObject(candidate.content) || !Array.isArray(candidate.content.parts) || !candidate.content.parts.length) throw new AIError('invalid_response');
      if (candidate.content.parts.some(part => !isObject(part) || Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature'].includes(key)) || typeof part.text !== 'string')) throw new AIError('invalid_response');
      return strictJSON(candidate.content.parts.filter(part => !part.thought).map(part => part.text).join(''));
    } catch (error) {
      if (error instanceof AIError && error.code === 'provider_quota' && error.status === 429 && index < models.length - 1) continue;
      networkError(error, signal);
    }
  }
  throw new AIError('provider_unavailable');
}
