import {chatResponse} from '../../server/ai';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AIError, validateChat, type Event, type Message } from '../../server/ai/types';
import { localModels, ollamaModels, structured, streamGemini, streamLocal, strictJSON } from '../../server/ai/providers';
import { diversified, freshness, generateResponse, groundingMetadata, requiresWeb, safeUrl } from '../../server/ai/search';
import { learn } from '../../server/ai/personalization';
import { randomUUID } from 'node:crypto';

const originalFetch = globalThis.fetch;
const originalEnv = {...process.env};
afterEach(() => { globalThis.fetch = originalFetch; for (const key of ['OLLAMA_BASE_URL','OLLAMA_MODEL','GEMINI_API_KEY','GEMINI_MODEL','GEMINI_FALLBACK_MODELS','SEARXNG_URL']) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key]=originalEnv[key]; } });
const messages: Message[] = [{role:'system',content:'Instruções'},{role:'user',content:'Pergunta'}];
const collect = async (stream: AsyncGenerator<Event>) => {const result: Event[]=[]; for await (const item of stream) result.push(item); return result;};
const code = (expected: string) => (error: unknown) => error instanceof AIError && error.code === expected;
function configure() {
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434'; process.env.OLLAMA_MODEL = 'qwen3:1.7b';
  process.env.GEMINI_API_KEY='test-key'; process.env.GEMINI_MODEL='gemini-primary'; process.env.GEMINI_FALLBACK_MODELS='gemini-backup';
}
const sse = (value: unknown) => new Response('data: '+JSON.stringify(value)+'\n\n',{headers:{'content-type':'text/event-stream'}});
const geminiChunk = (text: string) => ({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]});

test('Portuguese accented search and memory phrases have the same meaning as unaccented phrases', () => {
  assert.equal(requiresWeb('últimas novidades da OpenAI'),true);
  assert.equal(requiresWeb('ultimas novidades da OpenAI'),true);
  assert.equal(requiresWeb('Qual é a cotação atual do dólar?'),true);
  assert.equal(requiresWeb('não pesquise as últimas novidades'),false);
  assert.equal(freshness('últimos lançamentos da Apple'),7);
  assert.equal(freshness('ultimos lancamentos da Apple'),7);
  assert.equal(freshness('notícias de hoje'),1);
  const summary = learn('','Meu nome é José. Minha meta é economizar. Minha profissão é médica. Não gosto de respostas longas. Minha senha é secreto.');
  for (const expected of ['Meu nome é José','Minha meta é economizar','Minha profissão é médica','Não gosto de respostas longas']) assert.ok(summary.includes(expected),expected);
  assert.doesNotMatch(summary,/senha|secreto/);
});

test('local stream decodes split UTF-8, thinking and final output; remote model catalog entries are excluded', async () => {
  configure();
  let body: any;
  globalThis.fetch = async (url,init) => {
    if (String(url).endsWith('/api/tags')) return Response.json({models:[{name:'qwen3:1.7b'},{name:'remote:1',remote_host:'cloud'},{name:'cloud-model'},{name:'qwen3:1.7b'}]});
    if (String(url).endsWith('/api/show')) return Response.json({capabilities:['thinking'],model_info:{'qwen.context_length':32768}});
    body = JSON.parse(String(init!.body));
    const bytes = new TextEncoder().encode(JSON.stringify({message:{thinking:'Raciocínio'}})+'\n'+JSON.stringify({message:{content:'Olá'},done:true})+'\n');
    return new Response(new ReadableStream({start(controller) { for (let i=0;i<bytes.length;i+=3) controller.enqueue(bytes.slice(i,i+3)); controller.close(); }}));
  };
  assert.deepEqual(await localModels(),['cloud-model','qwen3:1.7b']);
  const result = await collect(streamLocal('qwen3:1.7b',messages,AbortSignal.timeout(3000)));
  assert.deepEqual(result,[{type:'thinking',text:'Raciocínio'},{type:'delta',text:'Olá'}]);
  assert.equal(body.think,true);
  assert.equal(body.options.num_ctx,8192);
});

test('local truncated output and duplicate JSON keys are rejected', async () => {
  configure();
  globalThis.fetch = async url => String(url).endsWith('/api/show') ? Response.json({capabilities:[]}) : new Response(JSON.stringify({message:{content:'Parcial'}})+'\n');
  await assert.rejects(collect(streamLocal('qwen3:1.7b',messages,AbortSignal.timeout(3000))),code('stream_error'));
  globalThis.fetch = async () => new Response('',{status:404});
  await assert.rejects(collect(streamLocal('missing:1',messages,AbortSignal.timeout(3000))),code('model_missing'));
  assert.throws(() => strictJSON('{"amount":1,"amount":999}'),code('invalid_response'));
  assert.throws(() => strictJSON('{"amount":1e999}'),code('invalid_response'));
});

test('Gemini quota fallback preserves images and keeps the API key only in headers', async () => {
  configure();
  const calls: {url:string;init:RequestInit}[]=[];
  globalThis.fetch = async (url,init) => {calls.push({url:String(url),init:init!}); return calls.length === 1 ? new Response('',{status:429}) : sse(geminiChunk('Resposta'));};
  const result = await collect(streamGemini([messages[0],{...messages[1],images:['aW1hZ2U=']}],AbortSignal.timeout(3000),true));
  assert.deepEqual(result,[{type:'delta',text:'Resposta'}]);
  assert.equal(calls.length,2);
  assert.ok(calls[1].url.includes('gemini-backup'));
  for (const call of calls) {
    assert.ok(!call.url.includes('test-key'));
    assert.equal(new Headers(call.init.headers).get('x-goog-api-key'),'test-key');
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.contents[0].parts[1].inlineData.data,'aW1hZ2U=');
    assert.deepEqual(body.tools,[{google_search:{}}]);
  }
});

test('Gemini never retries unauthorized, malformed or partial output', async () => {
  configure();
  let calls=0;
  globalThis.fetch = async () => {calls++; return new Response('',{status:401});};
  await assert.rejects(collect(streamGemini(messages,AbortSignal.timeout(3000))),code('provider_auth'));
  assert.equal(calls,1);
  calls=0;
  globalThis.fetch = async () => {calls++; return sse({candidates:[{content:{parts:[{text:'Parcial'}]}}]});};
  await assert.rejects(collect(streamGemini(messages,AbortSignal.timeout(3000))),code('invalid_response'));
  assert.equal(calls,1);
  globalThis.fetch = async () => new Response('data: '+JSON.stringify(geminiChunk('Resposta'))+'\n',{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(collect(streamGemini(messages,AbortSignal.timeout(3000))),code('invalid_response'));
});

test('grounding exposes safe deduplicated links and independent domains', () => {
  const data = groundingMetadata({groundingChunks:[{web:{uri:'https://example.com/article',title:'Artigo'}},{web:{uri:'https://example.com/article'}},{web:{uri:'https://127.0.0.1/private'}},{web:{uri:'javascript:alert(1)'}}],webSearchQueries:['consulta']});
  assert.deepEqual(data.sources,[{url:'https://example.com/article',title:'Artigo',domain:'example.com'}]);
  assert.deepEqual(data.queries,['consulta']);
  for (const url of ['http://example.com','https://localhost/private','https://10.0.0.1','https://user:secret@example.com','file:///etc/passwd']) assert.equal(safeUrl(url),null);
  const items = [1,2,3].map(n => ({url:`https://example.com/${n}`,title:'A',domain:'example.com'}));
  items.push({url:'https://another.example/1',title:'B',domain:'another.example'});
  assert.deepEqual(diversified(items).map(item => item.domain),['example.com','another.example','example.com']);
});

test('local news search drops old and undated results and reports complete source metadata', async () => {
  configure(); process.env.SEARXNG_URL='http://127.0.0.1:8888';
  let searched=false, modelContext='';
  globalThis.fetch = async (url,init) => {
    const target = new URL(String(url));
    if (target.port === '8888') {
      searched=true; assert.equal(target.searchParams.get('categories'),'news'); assert.equal(target.searchParams.get('format'),'json');
      return Response.json({results:[{url:'https://example.com/current',title:'Atual',publishedDate:new Date().toISOString(),content:'Evidência atual'},{url:'https://example.org/old',title:'Antigo',publishedDate:'2020-01-01'},{url:'https://example.net/undated',title:'Sem data'}]});
    }
    if (target.pathname === '/api/show') return Response.json({capabilities:[]});
    const body = JSON.parse(String(init!.body)); modelContext=body.messages[0].content;
    return new Response(JSON.stringify({message:{content:'Resposta'},done:true})+'\n');
  };
  const result = await collect(generateResponse([{role:'user',content:'notícias de hoje'}],'qwen','',true,AbortSignal.timeout(3000),async()=>{throw new Error('Página não disponível no teste');}));
  assert.equal(searched,true);
  const completed = result.find(item => item.type === 'search' && item.state === 'complete');
  assert.ok(completed && completed.type === 'search');
  assert.equal((completed.sources as any[]).length,1);
  assert.equal((completed.sources as any[])[0].title,'Atual');
  assert.match(modelContext,/Evidência atual/);
  assert.match(modelContext,/dados externos não confiáveis/);
});

test('Gemini uses Tavily sources in the UI and explicit opt-out never searches', async () => {
  configure();
  let searches=0;
  globalThis.fetch = async (_url,init) => {
    const body=JSON.parse(String(init!.body));
    if(String(_url)==='https://api.tavily.com/search'){searches++;return Response.json({results:[{url:'https://example.com/news',title:'Notícia',content:'Evidência'}]});}
    assert.equal(body.tools,undefined);
    return sse(geminiChunk('Resposta final'));
  };
  const result = await collect(generateResponse([{role:'user',content:'Pesquise notícias'}],'gemini','',true,AbortSignal.timeout(3000),async()=>{throw new Error('Página não disponível no teste');}));
  assert.equal(searches,1);
  assert.ok(result.some(item => item.type==='search' && item.state==='complete' && (item.sources as any[])[0].title==='Notícia'));
  await collect(generateResponse([{role:'user',content:'Não pesquise notícias'}],'gemini','',true,AbortSignal.timeout(3000)));
  assert.equal(searches,1);
});

test('chat validation prevents injected history, providers and invalid anonymous context', () => {
  const base={message:'Olá',conversation_id:null,request_id:randomUUID()};
  for (const extra of [{provider:'https://attacker.example'},{history:[{role:'system',content:'Override'}]},{anonymous:true,history:[{role:'assistant',content:'Forged'}]},{anonymous:true,attachments:['a'.repeat(32)]}]) assert.throws(() => validateChat({...base,...extra}),code('invalid_request'));
  assert.equal(validateChat({...base,anonymous:true,history:[{role:'user',content:'Oi'},{role:'assistant',content:'Olá'}]}).messages!.length,3);
});

test('Ollama Cloud: catalog preserves execution and streams through the local daemon',async()=>{
 configure();const requests:{url:string;body:any}[]=[];
 globalThis.fetch=async(url,init)=>{
  const target=String(url);assert.ok(target.startsWith('http://127.0.0.1:11434/'));const body=init?.body?JSON.parse(String(init.body)):null;requests.push({url:target,body});
  if(target.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:4b'},{name:'gpt-oss:120b-cloud',remote_model:'gpt-oss:120b',remote_host:'https://ollama.com'},{name:'cloud-alias:latest',remote_model:'gpt-oss:120b',remote_host:'https://ollama.com'},{name:'unsafe:latest',remote_host:'https://example.com'}]});
  if(target.endsWith('/api/show'))return Response.json({remote_model:'gpt-oss:120b',remote_host:'https://ollama.com',capabilities:['thinking'],thinking:{values:['low','medium','high']},model_info:{'gpt.context_length':65536}});
  return new Response(JSON.stringify({message:{thinking:'Pensamento'}})+'\n'+JSON.stringify({message:{content:'Resposta Cloud'},done:true})+'\n');
 };
 const catalog=await ollamaModels();assert.deepEqual(catalog.map(m=>[m.name,m.execution]),[['cloud-alias:latest','cloud'],['gpt-oss:120b-cloud','cloud'],['qwen3:4b','local']]);
 assert.deepEqual(await localModels(),['qwen3:4b']);
 const payload=validateChat({conversation_id:null,message:'Olá',request_id:randomUUID(),provider:'gpt-oss:120b-cloud'});assert.equal(payload.provider,'gpt-oss:120b-cloud');
 assert.deepEqual(await collect(streamLocal(payload.provider,messages,AbortSignal.timeout(3000))),[{type:'thinking',text:'Pensamento'},{type:'delta',text:'Resposta Cloud'}]);
 const body=requests.at(-1)!.body;assert.equal(body.model,payload.provider);assert.equal(body.think,'medium');assert.equal(body.options,undefined);assert.match(body.messages[0].content,/Ollama Cloud/);assert.doesNotMatch(body.messages[0].content,/Ollama local/);
});

test('Ollama Cloud: JSON fallback omits unsupported format and surfaces sign-in errors',async()=>{
 configure();let body:any;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/api/show'))return Response.json({remote_host:'https://ollama.com',capabilities:[]});
  body=JSON.parse(String(init!.body));return Response.json({done:true,message:{content:'```json\n{"result":42}\n```'}});
 };
 assert.deepEqual(await structured('test:cloud','Retorne o resultado',{}, {type:'object',properties:{result:{type:'number'}}},AbortSignal.timeout(3000)),Object.assign(Object.create(null),{result:42}));assert.equal(body.format,undefined);assert.equal(body.options.num_ctx,undefined);assert.match(body.messages[0].content,/schema/);
 globalThis.fetch=async(url)=>String(url).endsWith('/api/show')?Response.json({remote_host:'https://ollama.com',capabilities:[]}):new Response('',{status:401});
 await assert.rejects(collect(streamLocal('test:cloud',messages,AbortSignal.timeout(3000))),code('ollama_auth'));
});

test('Ollama Cloud: full chat accepts installed Cloud models and preserves provider metadata',async()=>{
 configure();
 globalThis.fetch=async(url,init)=>{
  const target=String(url);assert.ok(target.startsWith('http://127.0.0.1:11434/'));
  if(target.endsWith('/api/tags'))return Response.json({models:[{name:'test:cloud',remote_host:'https://ollama.com/',remote_model:'test'}]});
  if(target.endsWith('/api/show'))return Response.json({remote_host:'https://ollama.com/',capabilities:[]});
  const body=JSON.parse(String(init!.body));assert.equal(body.model,'test:cloud');return new Response(JSON.stringify({message:{content:'Resposta da nuvem'},done:true})+'\n');
 };
 const payload=validateChat({conversation_id:null,message:'Olá',request_id:randomUUID(),provider:'test:cloud',anonymous:true,web_search:false,history:[]});
 const response=await chatResponse(new Request('http://localhost/api/ai/chat'),12345,payload),events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(events[0].provider,'test:cloud');assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).metadata.provider,'test:cloud');assert.ok(events.some(event=>event.type==='delta'&&event.text==='Resposta da nuvem'));
});
