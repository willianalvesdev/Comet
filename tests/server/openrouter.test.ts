import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {curatedModels,parseFreeModels,freeModels,streamOpenRouter,structuredOpenRouter} from '../../server/ai/openrouter';
import {AIError,isOllamaModel,validateChat,type Event} from '../../server/ai/types';
import {chatResponse} from '../../server/ai';
const originalFetch=globalThis.fetch, originalKey=process.env.OPENROUTER_API_KEY;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;});
const model=(id='nvidia/nemotron-3.5-super-vl:free',pricing:Record<string,string>={prompt:'0',completion:'0'},images=true)=>({id,name:id,pricing,context_length:32768,architecture:{input_modalities:images?['text','image']:['text'],output_modalities:['text']},supported_parameters:['structured_outputs']});
const catalog={data:[model(),model('nvidia/nemotron-3.5-lightning:free',undefined,false),model('test/unlisted:free'),model('test/paid',{prompt:'1',completion:'2'}),model('nvidia/nemotron-3.5-content-safety:free',{prompt:'0',completion:'0',request:'0.01'})]};
const messages=[{role:'system' as const,content:'Instruções'},{role:'user' as const,content:'Olá'}];
const code=(expected:string)=>(error:unknown)=>error instanceof AIError&&error.code===expected;
async function collect(stream:AsyncGenerator<Event>){const events:Event[]=[];for await(const event of stream)events.push(event);return events;}
function frame(content:string,finish:string|null=null){return {choices:[{delta:{content},finish_reason:finish}]};}
function stream(chunks:unknown[],done=true){const bytes=new TextEncoder().encode(': OPENROUTER PROCESSING\n\n'+chunks.map(value=>'data: '+JSON.stringify(value)+'\n\n').join('')+(done?'data: [DONE]\n\n':''));return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
function setup(completion:(init:RequestInit)=>Response=()=>stream([frame('Olá','stop')])){process.env.OPENROUTER_API_KEY='test-only-key';globalThis.fetch=async(url,init)=>String(url).endsWith('/models')?Response.json(catalog):completion(init!);}
test('curated catalog contains exactly the selected 11 models in company order',()=>{
 const result=parseFreeModels({data:[...curatedModels].reverse().map(([id])=>model(id))});
 assert.equal(result.length,11);assert.deepEqual(result.map(m=>m.id),curatedModels.map(([id])=>'openrouter:'+id));
 assert.deepEqual(result.map(m=>m.name),curatedModels.map(([,name])=>name));
});
test('catalog only exposes free text models; excludes hidden charges and rejects local confusion',async()=>{
 setup();assert.deepEqual(parseFreeModels(catalog).map(m=>m.id),['openrouter:nvidia/nemotron-3.5-super-vl:free','openrouter:nvidia/nemotron-3.5-lightning:free']);
 assert.equal((await freeModels()).length,2);assert.equal(isOllamaModel('openrouter:nvidia/nemotron-3.5-super-vl:free'),false);
 assert.throws(()=>validateChat({conversation_id:null,message:'Oi',request_id:randomUUID(),provider:'openrouter:test/paid'}),code('invalid_request'));
 const payload=validateChat({conversation_id:null,message:'Imagem',request_id:randomUUID(),provider:'openrouter:nvidia/nemotron-3.5-super-vl:free',attachments:['a'.repeat(32)]});assert.equal(payload.provider,'openrouter:nvidia/nemotron-3.5-super-vl:free');
});
test('stream handles UTF-8, reasoning, comments and repeated usage finish while protecting key and price',async()=>{
 setup(init=>{const payload=JSON.parse(String(init.body));assert.equal(new Headers(init.headers).get('Authorization'),'Bearer test-only-key');assert.equal(payload.model,'nvidia/nemotron-3.5-super-vl:free');assert.deepEqual(payload.provider.max_price,{prompt:0,completion:0,request:0,image:0});assert.equal(payload.plugins,undefined);assert.equal(payload.tools,undefined);assert.equal(payload.messages[1].content[1].image_url.url,'data:image/jpeg;base64,aW1hZ2U=');assert.ok(!String(init.body).includes('test-only-key'));return stream([{choices:[{delta:{reasoning:'Análise'},finish_reason:null}]},frame('Olá','stop'),{...frame('','stop'),usage:{total_tokens:3}}]);});
 assert.deepEqual(await collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-super-vl:free',[messages[0],{...messages[1],images:['aW1hZ2U=']}],AbortSignal.timeout(2000))),[{type:'thinking',text:'Análise'},{type:'delta',text:'Olá'}]);
});
test('missing key, unknown model and incompatible images fail before completion',async()=>{
 setup(()=>{throw Error('must not call completions');});delete process.env.OPENROUTER_API_KEY;await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-super-vl:free',messages,AbortSignal.timeout(2000))),code('openrouter_missing'));
 process.env.OPENROUTER_API_KEY='test-only-key';await assert.rejects(collect(streamOpenRouter('openrouter:unknown/model:free',messages,AbortSignal.timeout(2000))),code('provider_model'));
 await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free',[{...messages[1],images:['x']}],AbortSignal.timeout(2000))),code('model_images'));
});
test('quota/auth errors and truncated streams never retry or silently succeed',async()=>{
 for(const [status,expected] of [[401,'provider_auth'],[429,'provider_quota'],[503,'provider_unavailable']] as const){let calls=0;setup(()=>{calls++;return new Response('',{status});});await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free',messages,AbortSignal.timeout(2000))),code(expected));assert.equal(calls,1);}
 for(const chunks of [[frame('partial')],[frame('partial','length')],[frame('partial'),{error:{code:429,message:'provider secret'}}]]){setup(()=>stream(chunks));await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free',messages,AbortSignal.timeout(2000))),error=>error instanceof AIError&&!error.message.includes('provider secret'));}
 setup(()=>stream([frame('partial','stop')],false));await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free',messages,AbortSignal.timeout(2000))),code('stream_error'));
});
test('structured results preserve schema and anonymous chat uses chosen provider with no database',async()=>{
 setup(init=>{const payload=JSON.parse(String(init.body));assert.equal(payload.response_format.type,'json_schema');return stream([frame('{"amount":12}','stop')]);});
 assert.equal(JSON.stringify(await structuredOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free','JSON',{}, {type:'object'},AbortSignal.timeout(2000))),'{"amount":12}');
 setup();const payload=validateChat({conversation_id:null,message:'Olá',request_id:randomUUID(),provider:'openrouter:nvidia/nemotron-3.5-lightning:free',anonymous:true,web_search:false,history:[]});
 const response=await chatResponse(new Request('http://localhost/api/ai/chat'),12345,payload);const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(events[0].provider,'openrouter:nvidia/nemotron-3.5-lightning:free');assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).metadata.provider,'openrouter:nvidia/nemotron-3.5-lightning:free');assert.ok(events.some(event=>event.type==='delta'&&event.text==='Olá'));
});
test('aborted requests do not start completion',async()=>{setup(()=>{throw Error('unexpected');});const controller=new AbortController();controller.abort();await assert.rejects(collect(streamOpenRouter('openrouter:nvidia/nemotron-3.5-lightning:free',messages,controller.signal)),error=>error instanceof DOMException&&error.name==='AbortError');});
