import { ApiError } from '../http';

const messages = {
  tavily_auth: 'Não foi possível autenticar a pesquisa Tavily. Confira a configuração da pesquisa.',
  tavily_quota: 'O limite da pesquisa Tavily foi atingido. Tente novamente mais tarde.',
  tavily_unavailable: 'A pesquisa Tavily está indisponível. Tente novamente em instantes.',
  context_size: 'Esta conversa excedeu o contexto disponível do modelo. Abra um novo chat ou escolha um modelo com maior capacidade.',
  attachment_size: 'Cada arquivo pode ter até 8 MB.',
  attachment_type: 'Envie PNG, JPG, WebP, PDF, DOCX ou arquivos de texto.',
  attachment_content: 'Não foi possível ler o arquivo. Use um documento com texto selecionável, até 40 páginas e 20 mil caracteres, ou envie uma imagem.',
  attachment_missing: 'Este anexo não está disponível na sua conta. Envie o arquivo novamente.',
  attachment_total: 'Os arquivos juntos devem ter até 30 mil caracteres de texto. Envie menos arquivos.',
  invalid_personalization: 'Confira os campos e os limites de tamanho da personalização.',
  personalization_changed: 'A memória mudou desde que você abriu esta página. Recarregue para ver a versão atual antes de salvar.',
  openrouter_missing: 'Configure OPENROUTER_API_KEY no servidor para usar os modelos gratuitos.',
  model_images: 'Este modelo não aceita imagens. Escolha um modelo com suporte a imagens.',
  provider_missing: 'Configure a chave do modelo escolhido no servidor para começar.',
  provider_auth: 'A chave deste modelo não foi aceita. Confira a configuração da API.',
  provider_quota: 'O limite de uso ou os créditos deste modelo acabaram. Tente mais tarde ou escolha outro modelo.',
  provider_unavailable: 'O serviço do modelo está indisponível. Tente novamente em instantes.',
  provider_model: 'Este modelo não está disponível para a chave configurada. Confira o modelo no servidor.',
  provider_blocked: 'O provedor não conseguiu responder a esta solicitação. Reformule sua mensagem.',
  invalid_title: 'Use um nome com 1 a 100 caracteres, sem quebras de linha.',
  conversation_missing: 'Essa conversa não está disponível na sua conta.',
  duplicate_request: 'Esta mensagem já foi recebida. Reabra a conversa para conferir a resposta.',
  stale_conversation: 'A conversa mudou em outra aba. Reabra-a antes de continuar.',
  history_unavailable: 'Não foi possível salvar a conversa. Confira a conexão com o banco e tente novamente.',
  unavailable: 'Não consegui me conectar ao meu modelo local. Verifique se o serviço local está em execução e tente novamente.',
  ollama_auth: 'Entre na sua conta no aplicativo Ollama para usar os modelos Cloud.',
  model_missing: 'Este modelo não está disponível no Ollama. Adicione-o no aplicativo e tente novamente.',
  timeout: 'A resposta demorou mais que o esperado. Tente novamente em instantes.',
  invalid_response: 'Recebi uma resposta incompleta. Tente enviar a mensagem novamente.',
  stream_error: 'A resposta foi interrompida. Você pode tentar novamente.',
  incompatible: 'Meu modelo local precisa de um ajuste antes de continuar. Peça ao responsável pelo Comet para verificar a configuração.',
  busy: 'Já estou respondendo. Aguarde um instante e tente novamente.',
  invalid_request: 'Revise a mensagem e tente novamente. Cada mensagem pode ter até 8.000 caracteres.',
};
export class AIError extends ApiError {
  constructor(public code: keyof typeof messages, status = 502) { super(status, messages[code]); }
}
export type Message = { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] };
export type Event = {type:'artifact';state:'creating'|'complete'|'failed';artifact?:import('../../shared/artifacts').Artifact;message?:string} | { type: 'delta' | 'thinking'; text: string } | { type: 'grounding'; data: Record<string, unknown> } | { type: 'search'; state: string; [key: string]: unknown };
export type Metadata = Record<string, unknown>;
export type ChatPayload = {
  conversation_id: string | null; message: string; request_id: string; provider: string;
  attachments: string[]; regenerate?: string; web_search?: boolean; anonymous?: true; messages?: Message[];
};
export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value) || BigInt(value) < 1n || BigInt(value) > 9223372036854775807n) throw new AIError('invalid_request', 422);
  return value;
}
export function isOpenRouterModel(value: unknown): value is string { return typeof value === 'string' && /^openrouter:[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*:free$/.test(value) && value.length <= 200; }
export function isOllamaModel(value: unknown): value is string {
  return typeof value === 'string' && !['gemini', 'qwen'].includes(value) && !value.startsWith('openrouter:') && value.length <= 200 && !value.includes('://') && /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value);
}
export const isProvider = (value: unknown): value is string => value === 'gemini' || value === 'qwen' || isOpenRouterModel(value) || isOllamaModel(value);
export function validateChat(raw: Record<string, unknown>): ChatPayload {
  const allowed = ['conversation_id', 'message', 'request_id', 'provider', 'attachments', 'regenerate', 'web_search', 'anonymous', 'history'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || !['conversation_id', 'message', 'request_id'].every(key => key in raw)) throw new AIError('invalid_request', 422);
  if (raw.web_search !== undefined && typeof raw.web_search !== 'boolean') throw new AIError('invalid_request', 422);
  if (raw.anonymous !== undefined && raw.anonymous !== true || raw.history !== undefined && raw.anonymous !== true) throw new AIError('invalid_request', 422);
  const provider = raw.provider ?? 'qwen';
  const tokens = raw.attachments ?? [];
  if (!isProvider(provider) || !Array.isArray(tokens) || tokens.length > 4 || tokens.some(token => typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) || new Set(tokens).size !== tokens.length) throw new AIError('invalid_request', 422);
  const cid = raw.conversation_id === null ? null : id(raw.conversation_id);
  if (typeof raw.message !== 'string' || !raw.message.trim() || raw.message.length > 8000 || raw.message.includes('\0') || typeof raw.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw.request_id)) throw new AIError('invalid_request', 422);
  const result: ChatPayload = { conversation_id: cid, message: raw.message.trim(), request_id: raw.request_id, provider: tokens.length && !isOpenRouterModel(provider) ? 'gemini' : provider, attachments: tokens };
  if (raw.web_search !== undefined) result.web_search = raw.web_search as boolean;
  if (raw.regenerate !== undefined) {
    if (!cid) throw new AIError('invalid_request', 422);
    result.regenerate = id(raw.regenerate);
  }
  if (raw.anonymous) {
    if (cid || tokens.length || result.regenerate || !Array.isArray(raw.history ?? [])) throw new AIError('invalid_request', 422);
    const history = [...(raw.history as unknown[] ?? []), { role: 'user', content: result.message }];
    if (history.length > 39 || history.length % 2 !== 1 || history.some((message, index) => !isObject(message) || Object.keys(message).length !== 2 || message.role !== (index % 2 ? 'assistant' : 'user') || typeof message.content !== 'string' || !message.content.trim() || message.content.includes('\0') || message.content.length > (index % 2 ? 16000 : 8000))) throw new AIError('invalid_request', 422);
    result.messages = history as Message[];
    if (result.messages.reduce((n, message) => n + message.content.length, 0) > 48000) throw new AIError('invalid_request', 422);
    result.anonymous = true;
  }
  return result;
}
export function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const attachmentMarker = 'ASCENDA_ATTACHMENT_V1\n';
const responseMarker = '\x1eascenda-response-v1:';
export function packMessage(message: string, attachments: string[]) { return attachments.length || message.startsWith(attachmentMarker) ? attachmentMarker + JSON.stringify({ message, attachments }) : message; }
export function unpackMessage(value: string): [string, string[]] {
  if (value.startsWith(attachmentMarker)) try {
    const data: unknown = JSON.parse(value.slice(attachmentMarker.length));
    if (isObject(data) && typeof data.message === 'string' && Array.isArray(data.attachments) && data.attachments.every(t => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t))) return [data.message, data.attachments];
  } catch {}
  return [value, []];
}
export function packResponse(thinking: string, metadata: Metadata) { return Object.keys(metadata).length ? responseMarker + JSON.stringify({ thinking, metadata }) : thinking; }
export function unpackResponse(value: string): [string, Metadata] {
  if (value.startsWith(responseMarker)) try {
    const data: unknown = JSON.parse(value.slice(responseMarker.length));
    if (isObject(data) && typeof data.thinking === 'string' && isObject(data.metadata)) return [data.thinking, data.metadata];
  } catch {}
  return [value, {}];
}
