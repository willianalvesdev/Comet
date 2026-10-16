import { AIError, isObject, isOpenRouterModel, type Event, type Message } from './types';
import { fetchAI, readText, sse, strictJSON, fitMessages } from './providers';

export const curatedModels = [
  [
    "nvidia/nemotron-3.5-super-vl:free",
    "Nemotron 3.5 Super VL"
  ],
  [
    "nvidia/nemotron-3.5-lightning:free",
    "Nemotron 3.5 Lightning"
  ],
  [
    "nvidia/nemotron-3.5-content-safety:free",
    "Nemotron 3.5 Content Safety"
  ],
  [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "Nemotron 3 Ultra 550B A55B"
  ],
  [
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "Nemotron 3 Nano Omni 30B A3B Reasoning"
  ],
  [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "Nemotron 3 Super 120B A12B"
  ],
  [
    "thinkingmachines/inkling-small:free",
    "Inkling Small"
  ],
  [
    "thinkingmachines/inkling:free",
    "Inkling"
  ],
  [
    "cohere/north-mini-code:free",
    "North Mini Code"
  ],
  [
    "google/gemma-4-26b-a4b-it:free",
    "Gemma 4 26B A4B"
  ],
  [
    "google/gemma-4-31b-it:free",
    "Gemma 4 31B"
  ]
] as const;
const endpoint = 'https://openrouter.ai/api/v1';
export type OpenRouterModel = { id: string; name: string; configured: boolean; context_length: number; images: boolean; parameters: string[] };
let cache: { expires: number; models: OpenRouterModel[] } | undefined;
let pending: Promise<OpenRouterModel[]> | undefined;
export function openRouterConfigured() { return Boolean(process.env.OPENROUTER_API_KEY?.trim()); }
export function parseFreeModels(raw: unknown): OpenRouterModel[] {
  if (!isObject(raw) || !Array.isArray(raw.data)) throw new AIError('invalid_response');
  const models = new Map<string, OpenRouterModel>();
  for (const item of raw.data) {
    if (!isObject(item) || typeof item.id !== 'string' || !isOpenRouterModel('openrouter:' + item.id) || !isObject(item.pricing) || !isObject(item.architecture)) continue;
    const curated = curatedModels.find(([id])=>id===item.id);
    if (!curated) continue;
    const prices = item.pricing;
    if (!['prompt','completion'].every(key => typeof prices[key] === 'string' && prices[key]!.trim() !== '' && Number(prices[key]) === 0) || Object.values(prices).some(value => !Number.isFinite(Number(value)) || Number(value) !== 0)) continue;
    const inputs = item.architecture.input_modalities, outputs = item.architecture.output_modalities;
    if (!Array.isArray(inputs) || !inputs.includes('text') || !Array.isArray(outputs) || !outputs.includes('text')) continue;
    if (!Number.isInteger(item.context_length) || Number(item.context_length) < 4096) continue;
    const id = 'openrouter:' + item.id;
    models.set(id, {id, name: curated[1], configured:openRouterConfigured(), context_length:Number(item.context_length), images:inputs.includes('image'), parameters:Array.isArray(item.supported_parameters) ? item.supported_parameters.filter((v):v is string=>typeof v==='string') : []});
  }
  return curatedModels.flatMap(([id])=>models.get('openrouter:'+id) ?? []);
}
export async function freeModels(): Promise<OpenRouterModel[]> {
  if (cache && cache.expires > Date.now()) return cache.models.map(model=>({...model,configured:openRouterConfigured()}));
  if (!pending) pending = (async()=>{
    const signal = AbortSignal.timeout(10000);
    const response = await fetchAI(endpoint+'/models',{headers:{Accept:'application/json'}},signal,10000);
    if (!response.ok) { await response.body?.cancel(); throw new AIError('provider_unavailable',503); }
    const models = parseFreeModels(strictJSON(await readText(response,signal,8*1024*1024)));
    cache = {models,expires:Date.now()+300000}; return models;
  })().finally(()=>{pending=undefined;});
  return pending;
}
export async function requireFreeModel(provider: string) {
  if (!isOpenRouterModel(provider)) throw new AIError('provider_model',422);
  if (!openRouterConfigured()) throw new AIError('openrouter_missing',503);
  const model = (await freeModels()).find(model=>model.id===provider);
  if (!model) throw new AIError('provider_model',422);
  return model;
}
export function defaultFreeModel(models: OpenRouterModel[]) {
  const configured = process.env.OPENROUTER_DEFAULT_MODEL?.trim();
  return models.find(model=>model.id === 'openrouter:'+configured)?.id ?? models.find(model=>model.images)?.id ?? models[0]?.id ?? null;
}
function providerError(status: number): never {
  throw new AIError([401,403].includes(status)?'provider_auth':[402,429].includes(status)?'provider_quota':[400,404,422].includes(status)?'provider_model':'provider_unavailable', status===429?429:502);
}
export async function* streamOpenRouter(provider: string, messages: Message[], signal: AbortSignal, schema?: unknown): AsyncGenerator<Event> {
  signal.throwIfAborted();
  const model = await requireFreeModel(provider);
  signal.throwIfAborted();
  if (!model.images && messages.some(message=>message.images?.length)) throw new AIError('model_images',422);
  const budget = Math.min(96000,(model.context_length-2048)*2);
  if (schema && messages.reduce((total,message)=>total+Buffer.byteLength(message.content)+80,0)>budget) throw new AIError('context_size',422);
  const fitted = schema ? messages : fitMessages(messages,budget);
  const payload = {
    model:provider.slice('openrouter:'.length), stream:true, max_tokens:Math.min(8192,Math.floor(model.context_length/2)),
    provider:{max_price:{prompt:0,completion:0,request:0,image:0}},
    ...(schema && model.parameters.includes('structured_outputs') ? {response_format:{type:'json_schema',json_schema:{name:'result',strict:true,schema}}} : {}),
    messages:fitted.map(message=>({role:message.role,content:message.images?.length ? [{type:'text',text:message.content},...message.images.map(image=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+image}}))] : message.content})),
  };
  try {
    const response = await fetchAI(endpoint+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY!.trim(),'Content-Type':'application/json',Accept:'text/event-stream','X-OpenRouter-Title':'Comet'},body:JSON.stringify(payload)},signal);
    if (!response.ok) { await response.body?.cancel(); providerError(response.status); }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new AIError('invalid_response'); }
    let answer=0,thought=0,finished=false;
    for await (const raw of sse(response,signal)) {
      signal.throwIfAborted();
      if (raw==='[DONE]') { if(!finished||!answer)throw new AIError('stream_error'); return; }
      const chunk=strictJSON(raw);
      if(!isObject(chunk))throw new AIError('invalid_response');
      if(chunk.error) { if(isObject(chunk.error)&&Number.isInteger(chunk.error.code))providerError(Number(chunk.error.code));throw new AIError('stream_error'); }
      if(!Array.isArray(chunk.choices))throw new AIError('invalid_response');
      if(!chunk.choices.length && chunk.usage)continue;
      if(chunk.choices.length!==1||!isObject(chunk.choices[0]))throw new AIError('invalid_response');
      const choice=chunk.choices[0],delta=choice.delta;
      if(!isObject(delta)||delta.tool_calls||delta.function_call)throw new AIError('invalid_response');
      if(delta.content!=null&&typeof delta.content!=='string'||delta.reasoning!=null&&typeof delta.reasoning!=='string')throw new AIError('invalid_response');
      if(delta.reasoning){thought+=String(delta.reasoning).length;if(thought>48000||finished)throw new AIError('invalid_response');yield {type:'thinking',text:String(delta.reasoning)};}
      if(delta.content){answer+=String(delta.content).length;if(answer>16000||finished)throw new AIError('invalid_response');yield {type:'delta',text:String(delta.content)};}
      if(choice.finish_reason!=null){if(choice.finish_reason!=='stop')throw new AIError(choice.finish_reason==='content_filter'?'provider_blocked':'stream_error');finished=true;}
    }
    throw new AIError('stream_error');
  } catch(error) { if(signal.aborted)throw signal.reason; if(error instanceof AIError)throw error; throw new AIError('provider_unavailable',503); }
}
export async function structuredOpenRouter(provider: string, system: string, data: unknown, schema: unknown, signal: AbortSignal) {
  let answer='';
  for await(const event of streamOpenRouter(provider,[{role:'system',content:system+'\nResponda somente JSON válido conforme este schema: '+JSON.stringify(schema)},{role:'user',content:JSON.stringify(data)}],signal,schema)) if(event.type==='delta')answer+=event.text;
  return strictJSON(answer);
}
