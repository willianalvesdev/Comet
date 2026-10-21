import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {tavilySearch,tavilyImages} from '../../server/ai/tavily';
import {generateResponse,searchEngine} from '../../server/ai/search';
import {handleAI} from '../../server/ai/index';
import {AIError,type Event} from '../../server/ai/types';
const originalFetch=globalThis.fetch,originalKey=process.env.TAVILY_API_KEY;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=originalKey;});

test('Tavily keyless search bounds requests and validates sources without trusting returned HTML',async()=>{
 delete process.env.TAVILY_API_KEY;
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,'https://api.tavily.com/search');assert.equal(init?.redirect,'error');
  const headers=new Headers(init?.headers);assert.equal(headers.get('X-Tavily-Access-Mode'),'keyless');assert.equal(headers.has('Authorization'),false);
  const body=JSON.parse(String(init?.body));assert.equal(body.query,'notícias de hoje');assert.equal(body.time_range,'day');assert.equal(body.topic,'news');assert.equal(body.max_results,8);assert.equal(body.search_depth,'basic');assert.equal(body.auto_parameters,false);assert.equal(body.include_raw_content,false);
  return Response.json({results:[{url:'https://example.com/a',title:'Fonte',content:'<b>Trecho</b>',published_date:'2026-10-20T10:00:00Z'},{url:'https://example.com/a#repeated'},...['javascript:alert(1)','https://127.0.0.1/a','https://user:pass@example.com'].map(url=>({url}))]});
 };
 const result=await tavilySearch('notícias de hoje',AbortSignal.timeout(2000));assert.equal(result.engine,'Tavily');assert.equal(result.sources.length,1);assert.equal(result.sources[0].excerpt,'Trecho');assert.equal(result.sources[0].evidence_type,'snippet');assert.equal(result.sources[0].published_at,'2026-10-20T10:00:00.000Z');
});
test('Tavily honors configured secrets, reports quota/auth failures and never exposes provider bodies',async()=>{
 process.env.TAVILY_API_KEY='test-secret';
 for(const [status,code] of [[401,'tavily_auth'],[429,'tavily_quota'],[500,'tavily_unavailable']] as const){
  let calls=0;globalThis.fetch=async(_,init)=>{calls++;const headers=new Headers(init?.headers);assert.equal(headers.get('Authorization'),'Bearer test-secret');assert.equal(headers.has('X-Tavily-Access-Mode'),false);assert.doesNotMatch(String(init?.body),/test-secret/);return new Response('private upstream diagnostic',{status});};
  await assert.rejects(tavilySearch('teste',AbortSignal.timeout(2000)),e=>e instanceof AIError&&e.code===code&&!e.message.includes('private'));assert.equal(calls,1);
 }
 globalThis.fetch=async()=>Response.json({results:null});await assert.rejects(tavilySearch('teste',AbortSignal.timeout(2000)));
});
test('Pesquisar routes Gemini and remote models to Tavily, Computer stays SearXNG, opt-out makes no search',async()=>{
 assert.equal(searchEngine('gemini'),'Tavily');assert.equal(searchEngine('openrouter:vendor/model:free'),'Tavily');assert.equal(searchEngine('qwen3:1.7b'),'SearXNG');assert.equal(searchEngine('qwen'),'SearXNG');
 delete process.env.TAVILY_API_KEY;let searches=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url)==='https://api.tavily.com/search'){searches++;assert.doesNotMatch(String(init?.body),/private@example|secret-value/);return Response.json({results:[{url:'https://example.com/a',title:'Tavily source',content:'Evidence'}]});}
  if(String(url).endsWith('/api/show'))return Response.json({capabilities:[]});
  return new Response(JSON.stringify({message:{content:'Resposta [1].'},done:true})+'\n');
 };
 const events:Event[]=[];
 for await(const e of generateResponse([{role:'user',content:'Pesquise novidades private@example.com senha=secret-value'}],'qwen','',true,AbortSignal.timeout(2000),async()=>{throw Error('unread');},'Tavily'))events.push(e);
 assert.equal(searches,1);assert(events.some(e=>e.type==='search'&&e.engine==='Tavily'&&e.state==='complete'));assert.equal(events.map(e=>e.type==='delta'?e.text:'').join(''),'Resposta [1].');
 for await(const _ of generateResponse([{role:'user',content:'Pesquise notícias'}],'qwen','',false,AbortSignal.timeout(2000),undefined,'Tavily')){}assert.equal(searches,1);
 globalThis.fetch=async()=>new Response('rate limited',{status:429});
 const stream=generateResponse([{role:'user',content:'Pesquise novidades'}],'gemini','',true,AbortSignal.timeout(2000));await stream.next();const failure=await stream.next();assert(failure.value?.type==='search'&&failure.value.state==='failed');assert.match(String(failure.value?.error),/limite.*Tavily/);await stream.return(undefined);
});
test('image routing keeps engines separate, validates URLs and redacts the query',async()=>{
 delete process.env.TAVILY_API_KEY;let calls=0;
 globalThis.fetch=async(url,init)=>{
  calls++;assert.equal(url,'https://api.tavily.com/search');const body=JSON.parse(String(init?.body));assert.equal(body.include_images,true);assert.doesNotMatch(body.query,/private@example|secret-value/);
  return Response.json({results:[],images:[{url:'https://images.example.com/a.png',description:'<b>Imagem</b>'},'https://images.example.com/a.png','https://127.0.0.1/private','data:image/png,x']});
 };
 const reply=await handleAI(new Request('https://comet.example/api/ai/images?'+new URLSearchParams({q:'Saturno private@example.com senha=secret-value',engine:'tavily'})),{id:999},['images']);
 const data=await reply!.json();assert.equal(data.images.length,1);assert.equal(data.images[0].title,'Imagem');assert.equal(data.images[0].domain,'images.example.com');assert.equal(calls,1);
 await assert.rejects(handleAI(new Request('https://comet.example/api/ai/images?q=Saturno&engine=invalid'),{id:999},['images']));assert.equal(calls,1);
 const controller=new AbortController();controller.abort();globalThis.fetch=async(_,init)=>{init?.signal?.throwIfAborted();throw Error('unexpected');};await assert.rejects(tavilyImages('Saturno',controller.signal));
});
