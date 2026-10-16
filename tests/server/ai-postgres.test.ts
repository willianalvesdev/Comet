import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { closeDatabase, query } from '../../server/db';
import { AIError, validateChat, packResponse, type ChatPayload } from '../../server/ai/types';
import { getConversationExport, beginTurn, changeConversation, getConversation, listConversations, previewConversation, saveTurn, truncateConversation } from '../../server/ai/conversations';
import { getPersonalization, personalizationContext, remember, updatePersonalization } from '../../server/ai/personalization';
import { attachmentMessage, extractAttachment, readAttachment, uploadAttachment } from '../../server/ai/attachments';
import { chatResponse, handleAI } from '../../server/ai';

const users: number[] = [];
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(['OPENROUTER_API_KEY','GEMINI_API_KEY','GEMINI_MODEL','GEMINI_FALLBACK_MODELS','OLLAMA_BASE_URL','OLLAMA_MODEL','ATTACHMENTS_DIR'].map(key => [key,process.env[key]]));
let attachmentRoot: string;
const errorCode = (code: string) => (error: unknown) => error instanceof AIError && error.code === code;
const payload = (message = 'Mensagem', conversation_id: string | null = null, extra: Partial<ChatPayload> = {}) => validateChat({message, conversation_id, request_id:randomUUID(),provider:'gemini',web_search:false,...extra});
const request = () => new Request('http://localhost/api/ai/chat',{method:'POST'});
const events = async (response: Response): Promise<Record<string,any>[]> => (await response.text()).trim().split('\n').map(line => JSON.parse(line));
function mockGemini(answer: string, finish = true, thinking = '') {
  globalThis.fetch = async () => new Response('data: '+JSON.stringify({candidates:[{content:{parts:[...(thinking ? [{text:thinking,thought:true}] : []),{text:answer}]},...(finish ? {finishReason:'STOP'} : {})}]})+'\n\n',{headers:{'content-type':'text/event-stream'}});
}
before(async () => {
  attachmentRoot = await mkdtemp(path.join(tmpdir(),'comet-ai-tests-'));
  process.env.ATTACHMENTS_DIR = attachmentRoot;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-test';
  process.env.GEMINI_FALLBACK_MODELS = '';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL = 'qwen3:1.7b';
  for (let index=0;index<3;index++) {
    const [row] = await query<{id:string}>('INSERT INTO usuarios (nome,email,senha,idade) VALUES ($1,$2,$3,30) RETURNING id',['AI Test '+index,`ai-${randomUUID()}@example.com`,'test-only']);
    users.push(Number(row.id));
  }
});
afterEach(() => { globalThis.fetch = originalFetch; });
after(async () => {
  globalThis.fetch = originalFetch;
  await query('DELETE FROM usuarios WHERE id=ANY($1::bigint[])',[users]);
  await closeDatabase();
  if (attachmentRoot) await rm(attachmentRoot,{recursive:true,force:true});
  for (const [key,value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('saved chats retain answers, thinking, metadata and only expose the owner data', async () => {
  const turn = await beginTurn(users[0],payload('Meu nome é Lia'));
  turn.response_meta = {research:{sources:[{url:'https://example.com/fonte',title:'Fonte',domain:'example.com'}]},provider:'gemini',elapsed_seconds:2};
  await saveTurn(users[0],turn,'Olá, Lia!','Pensamento privado','completed');
  const restored = await getConversation(users[0],turn.conversation_id!,null);
  assert.equal(restored.active,false);
  assert.equal(restored.turns[0].answer,'Olá, Lia!');
  assert.equal(restored.turns[0].thinking,'Pensamento privado');
  assert.deepEqual(restored.turns[0].metadata,turn.response_meta);
  const next = await beginTurn(users[0],payload('Qual é meu nome?',turn.conversation_id));
  assert.deepEqual(next.messages.map(item => item.content),['Meu nome é Lia','Olá, Lia!','Qual é meu nome?']);
  await saveTurn(users[0],next,'Lia','','completed');
  assert.equal((await previewConversation(users[0],turn.conversation_id!)).answer,'Olá, Lia!');
  assert.equal((await previewConversation(users[0],turn.conversation_id!)).has_search,true);
  await query('UPDATE computer_mensagens SET pensamento=$1 WHERE id=$2',[packResponse('Pensamento privado',{}),turn.turn_id]);
  assert.equal((await previewConversation(users[0],turn.conversation_id!)).has_search,false);
  turn.response_meta.research = {state:'complete',sources:[],query:'consulta'};
  await query('UPDATE computer_mensagens SET pensamento=$1 WHERE id=$2',[packResponse('Pensamento privado',turn.response_meta),turn.turn_id]);
  assert.equal((await previewConversation(users[0],turn.conversation_id!)).has_search,true);
  await assert.rejects(getConversation(users[1],turn.conversation_id!,null),errorCode('conversation_missing'));
  await assert.rejects(beginTurn(users[1],payload('Ataque',turn.conversation_id)),errorCode('conversation_missing'));
  await assert.rejects(previewConversation(users[1],turn.conversation_id!),errorCode('conversation_missing'));
  await assert.rejects(changeConversation(users[1],turn.conversation_id!,'Roubar',false),errorCode('conversation_missing'));
});

test('duplicate requests, concurrent messages and expired leases cannot overwrite a newer answer', async () => {
  const initial = payload('Primeira'), turn = await beginTurn(users[0],initial);
  await assert.rejects(beginTurn(users[0],initial),errorCode('duplicate_request'));
  await assert.rejects(beginTurn(users[0],payload('Segunda',turn.conversation_id)),errorCode('busy'));
  await assert.rejects(changeConversation(users[0],turn.conversation_id!,null,true),errorCode('busy'));
  await saveTurn(users[0],turn,'Parcial','Raciocínio','running');
  await query("UPDATE computer_conversas SET ativa_ate=NOW()-INTERVAL '1 second' WHERE id=$1",[turn.conversation_id]);
  assert.equal((await getConversation(users[0],turn.conversation_id!,null)).turns[0].status,'interrupted');
  const next = await beginTurn(users[0],payload('Nova',turn.conversation_id));
  assert.deepEqual(next.messages,[{role:'user',content:'Nova'}]);
  await assert.rejects(saveTurn(users[0],turn,'Tardia','','completed'),errorCode('stale_conversation'));
  await saveTurn(users[0],next,'Atual','','completed');
  const restored = await getConversation(users[0],turn.conversation_id!,null);
  assert.deepEqual(restored.turns.map(item => item.status),['interrupted','completed']);
  assert.equal(restored.turns[0].answer,'Parcial');
});

test('regeneration preserves versions and later messages; failure restores original content', async () => {
  const first = await beginTurn(users[0],payload('Primeira pergunta'));
  await saveTurn(users[0],first,'Original','Pensamento original','completed');
  const later = await beginTurn(users[0],payload('Próxima pergunta',first.conversation_id));
  await saveTurn(users[0],later,'Próxima','','completed');
  const renewed = await beginTurn(users[0],payload('Reescrever',first.conversation_id,{regenerate:first.turn_id}));
  assert.deepEqual(renewed.messages,[{role:'user',content:'Primeira pergunta'}]);
  await saveTurn(users[0],renewed,'Nova','Pensamento novo','completed');
  let restored = await getConversation(users[0],first.conversation_id!,null);
  assert.deepEqual(restored.turns.map(item => item.answer),['Nova','Próxima']);
  assert.equal((restored.turns[0].metadata.versions as any[])[0].answer,'Original');
  const failed = await beginTurn(users[0],payload('Reescrever',first.conversation_id,{regenerate:first.turn_id}));
  await saveTurn(users[0],failed,'Incompleta','Parcial','running');
  await saveTurn(users[0],failed,'Incompleta','Parcial','failed');
  restored = await getConversation(users[0],first.conversation_id!,null);
  assert.equal(restored.turns[0].answer,'Nova');
  assert.equal(restored.turns[0].thinking,'Pensamento novo');
  assert.equal(restored.turns[0].status,'completed');
  assert.equal(restored.active,false);
  await truncateConversation(users[0],first.conversation_id!,later.turn_id);
  assert.equal((await getConversation(users[0],first.conversation_id!,null)).turns.length,1);
});

test('conversation pagination does not overlap and search treats SQL wildcard characters literally', async () => {
  await query("INSERT INTO computer_conversas (usuario_id,titulo) SELECT $1, 'Conversa ' || n FROM generate_series(1,51) n",[users[1]]);
  await query("INSERT INTO computer_conversas (usuario_id,titulo) VALUES ($1,'Meta 10%_!')",[users[1]]);
  const first = await listConversations(users[1],0,'');
  const second = await listConversations(users[1],first.next_offset!,'');
  assert.equal(first.conversations.length,50);
  assert.equal(second.conversations.length,2);
  assert.equal(second.next_offset,null);
  assert.equal(new Set([...first.conversations,...second.conversations].map(row => row.id)).size,52);
  assert.deepEqual((await listConversations(users[1],0,'10%_!')).conversations.map(row => row.title),['Meta 10%_!']);
  await assert.rejects(listConversations(users[1],-1,''),errorCode('invalid_request'));
  const [conversation] = await query<{id:string}>("INSERT INTO computer_conversas (usuario_id,titulo) VALUES ($1,'Muitas mensagens') RETURNING id",[users[1]]);
  await query("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado) SELECT $1,gen_random_uuid(),'P','R','','completed' FROM generate_series(1,31)",[conversation.id]);
  const newest = await getConversation(users[1],conversation.id,null);
  const older = await getConversation(users[1],conversation.id,newest.before);
  assert.equal(newest.turns.length,30);
  assert.equal(older.turns.length,1);
  assert.equal(new Set([...newest.turns,...older.turns].map(row => row.id)).size,31);
});

test('successful chat sends NDJSON and saves response before reporting done', async () => {
  mockGemini('Resposta completa',true,'Resumo do raciocínio');
  const response = await chatResponse(request(),users[0],payload('Olá'));
  assert.match(response.headers.get('content-type')!,/application\/x-ndjson/);
  const output = await events(response);
  assert.deepEqual(output.map(item => item.type),['conversation','thinking','delta','done']);
  assert.equal(output.at(-1)!.metadata.instant,false);
  const saved = await getConversation(users[0],output[0].conversation_id,null);
  assert.equal(saved.turns[0].status,'completed');
  assert.equal(saved.turns[0].answer,output[2].text);
  assert.deepEqual(saved.turns[0].metadata,output.at(-1)!.metadata);
});

test('provider interruption persists partial content and produces error without done', async () => {
  mockGemini('Parcial',false,'Pensamento');
  const output = await events(await chatResponse(request(),users[0],payload('Falhar')));
  assert.equal(output.at(-1)!.type,'error');
  assert.equal(output.some(item => item.type === 'done'),false);
  const saved = await getConversation(users[0],output[0].conversation_id,null);
  assert.equal(saved.turns[0].status,'failed');
  assert.equal(saved.turns[0].answer,'Parcial');
  assert.equal(saved.active,false);
});

test('saved response survives disconnect and explicit stop is owner scoped', async () => {
  let finish:()=>void=()=>{}, began:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{began=resolve;});
  let generationSignal:AbortSignal|null=null;
  globalThis.fetch=async (_url,options)=>{
    generationSignal=options?.signal as AbortSignal;
    return new Response(new ReadableStream({start(controller){
      const send=(text:string,done=false)=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text}]},...(done?{finishReason:'STOP'}:{})}]})+'\n\n'));
      send('Parte inicial. ');finish=()=>{send('Resposta completa.',true);controller.close();};began();
      generationSignal!.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
    }}),{headers:{'content-type':'text/event-stream'}});
  };
  const navigation=new AbortController();
  const work=payload('Continuar ao navegar');
  const response=await chatResponse(new Request('http://localhost/api/ai/chat',{signal:navigation.signal}),users[0],work);
  const reader=response.body!.getReader();
  const first=JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
  await started;await reader.cancel();navigation.abort();
  assert.equal((generationSignal as AbortSignal|null)?.aborted,false);
  finish();
  let saved=await getConversation(users[0],first.conversation_id,null);
  for(let i=0;i<100&&saved.active;i++){await new Promise(r=>setTimeout(r,20));saved=await getConversation(users[0],first.conversation_id,null);}
  assert.equal(saved.turns[0].status,'completed');assert.equal(saved.turns[0].answer,'Parte inicial. Resposta completa.');
  await new Promise(r=>setTimeout(r,50));
  globalThis.fetch=async (_url,options)=>new Response(new ReadableStream({start(controller){options?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
  const stopping=payload('Parar explicitamente');
  const running=await chatResponse(request(),users[0],stopping);
  const cancel=()=>new Request('http://localhost/api/ai/chat/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:stopping.request_id})});
  assert.deepEqual(await (await handleAI(cancel(),{id:users[1]},['chat','cancel']))!.json(),{stopped:false});
  assert.deepEqual(await (await handleAI(cancel(),{id:users[0]},['chat','cancel']))!.json(),{stopped:true});
  await running.text();
  const latest=await listConversations(users[0],0,'Parar explicitamente');
  assert.equal((await getConversation(users[0],latest.conversations[0].id,null)).turns[0].status,'interrupted');
  mockGemini('Pode continuar');assert.equal((await events(await chatResponse(request(),users[0],payload()))).at(-1)!.type,'done');
});

test('anonymous chat never creates history, profile or cross-chat memories', async () => {
  mockGemini('Olá');
  const output = await events(await chatResponse(request(),users[2],payload('Meu nome é Privado',null,{anonymous:true})));
  assert.equal(output[0].conversation_id,null);
  assert.equal(output.at(-1)!.type,'done');
  assert.equal((await query('SELECT id FROM computer_conversas WHERE usuario_id=$1',[users[2]])).length,0);
  assert.equal((await query('SELECT usuario_id FROM computer_personalizacao WHERE usuario_id=$1',[users[2]])).length,0);
});

test('personalization is isolated, versioned and does not remember passwords or disabled memory', async () => {
  const initial = await getPersonalization(users[0]);
  const data = {name:'Lia',occupation:'Engenheira',about:'Gosta de livros',summary:'',memory_enabled:true,version:initial.version,full_name:'Lia Silva',location:'Brasil'};
  const saved = await updatePersonalization(users[0],data);
  assert.equal(saved.full_name,'Lia Silva');
  assert.equal(saved.version,initial.version+1);
  await assert.rejects(updatePersonalization(users[0],data),errorCode('personalization_changed'));
  await remember(users[0],'Moro em Recife. Minha senha é segredo. Prefiro respostas curtas.');
  const learned = await getPersonalization(users[0]);
  assert.match(learned.summary,/Recife/);
  assert.doesNotMatch(learned.summary,/senha|segredo/);
  assert.equal((await getPersonalization(users[1])).summary,'');
  await updatePersonalization(users[0],{...data,summary:learned.summary,memory_enabled:false,version:learned.version});
  await remember(users[0],'Moro em Manaus');
  assert.doesNotMatch((await getPersonalization(users[0])).summary,/Manaus/);
  assert.doesNotMatch(await personalizationContext(users[0]),/memorias_de_outras_conversas/);
});

test('attachments are normalized, private and rejected if unsupported, malformed or too large', async () => {
  const raw = await sharp({create:{width:20,height:20,channels:3,background:'#f00'}}).png().toBuffer();
  const image = await uploadAttachment(users[0],new File([new Uint8Array(raw)],'imagem.png'));
  assert.equal(image.kind,'image');
  assert.equal('image' in image,false);
  const preview = await handleAI(new Request('http://localhost'),{id:users[0]},['attachments',image.id,'preview']);
  assert.equal(preview!.headers.get('content-type'),'image/jpeg');
  assert.equal((await sharp(Buffer.from(await preview!.arrayBuffer())).metadata()).format,'jpeg');
  await assert.rejects(readAttachment(users[1],image.id),errorCode('attachment_missing'));
  await assert.rejects(readAttachment(users[0],'../secrets'),errorCode('attachment_missing'));
  for (const [name,raw,code] of [['fake.png','fake','attachment_content'],['file.exe','text','attachment_type'],['big.txt','x'.repeat(20001),'attachment_content']] as const) await assert.rejects(extractAttachment(Buffer.from(raw),name),errorCode(code));
  const doc = await uploadAttachment(users[0],new File(['Receita: 3500. Despesas: 2100.'],'../../contas.txt'));
  assert.equal(doc.name,'contas.txt');
  assert.match((await attachmentMessage(users[0],'Analise',[doc.id])).message.content,/Receita: 3500/);
  await assert.rejects(handleAI(new Request('http://localhost'),{id:users[0]},['attachments',doc.id,'preview']),errorCode('attachment_missing'));
  let body: any;
  globalThis.fetch = async (_url,init) => { body = JSON.parse(String(init!.body)); return new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Saldo 1400'}]},finishReason:'STOP'}]})+'\n\n',{headers:{'content-type':'text/event-stream'}}); };
  const output = await events(await chatResponse(request(),users[0],payload('Analise',null,{provider:'qwen',attachments:[doc.id,image.id]})));
  assert.equal(output[0].provider,'gemini');
  assert.match(body.contents[0].parts[0].text,/Receita: 3500/);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
  await changeConversation(users[0],output[0].conversation_id,null,true);
  await assert.rejects(readAttachment(users[0],doc.id),errorCode('attachment_missing'));
  await assert.rejects(readAttachment(users[0],image.id),errorCode('attachment_missing'));
});

test('editing retains attachments from the edited message but removes unused later uploads', async () => {
  const firstFile = await uploadAttachment(users[0],new File(['Primeiro'],'first.txt'));
  const laterFile = await uploadAttachment(users[0],new File(['Segundo'],'second.txt'));
  const first = await beginTurn(users[0],payload('Primeiro',null,{attachments:[firstFile.id]}));
  await saveTurn(users[0],first,'Ok','','completed');
  const later = await beginTurn(users[0],payload('Segundo',first.conversation_id,{attachments:[laterFile.id]}));
  await saveTurn(users[0],later,'Ok','','completed');
  await truncateConversation(users[0],first.conversation_id!,first.turn_id);
  assert.equal((await readAttachment(users[0],firstFile.id)).name,'first.txt');
  await assert.rejects(readAttachment(users[0],laterFile.id),errorCode('attachment_missing'));
});


test('export: conversa inteira inclui mais de 30 turnos e exige o proprietário',async()=>{
  const turn=await beginTurn(users[0],payload('Pergunta exportada'));
  await saveTurn(users[0],turn,'Resposta inicial','Pensamento privado','completed');
  for(let i=2;i<=35;i++)await query("INSERT INTO computer_mensagens (conversa_id,requisicao_id,pergunta,resposta,pensamento,estado,criado_em) VALUES ($1,$2,$3,$4,$5,'completed',NOW())",[turn.conversation_id,randomUUID(),'Pergunta '+i,'Resposta '+i,'Pensamento secreto']);
  const data=await getConversationExport(users[0],turn.conversation_id!);
  assert.equal(data.turns.length,35);assert.equal(data.turns[34].answer,'Resposta 35');
  assert.equal(JSON.stringify(data).includes('Pensamento'),false);
  await assert.rejects(getConversationExport(users[1],turn.conversation_id!),errorCode('conversation_missing'));
});


test('OpenRouter persists the selected free model and documents without switching to Gemini',async()=>{
 process.env.OPENROUTER_API_KEY='test-only-key';
 const provider='openrouter:nvidia/nemotron-3.5-lightning:free';
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'nvidia/nemotron-3.5-lightning:free',name:'Saved model',context_length:32768,pricing:{prompt:'0',completion:'0'},architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:[]}]});
  assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');const sent=JSON.parse(String(init?.body));assert.equal(sent.model,'nvidia/nemotron-3.5-lightning:free');assert.ok(JSON.stringify(sent.messages).includes('Conteúdo do documento'));
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Resposta preservada'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const file=await uploadAttachment(users[0],new File(['Conteúdo do documento'],'nota.txt',{type:'text/plain'}));
 const result=await events(await chatResponse(request(),users[0],payload('Analise o documento',null,{provider,attachments:[file.id]})));
 assert.equal(result.at(-1)?.type,'done');const cid=String(result[0].conversation_id);
 const restored=await getConversation(users[0],cid,null);assert.equal(restored.turns[0].metadata.provider,provider);assert.equal(restored.turns[0].answer,'Resposta preservada');assert.equal(restored.turns[0].attachments[0].name,'nota.txt');
});


test('provider authentication failure is retained when reopening an empty failed reply',async()=>{
 globalThis.fetch=async()=>new Response('',{status:401});
 const output=await events(await chatResponse(request(),users[0],payload('Autenticação')));
 assert.equal(output.at(-1)?.code,'provider_auth');
 const saved=await getConversation(users[0],String(output[0].conversation_id),null);
 assert.equal(saved.turns[0].status,'failed');assert.equal(saved.turns[0].answer,'');
 assert.equal(saved.turns[0].metadata.error_code,'provider_auth');assert.equal(saved.turns[0].metadata.error,output.at(-1)?.error);
});
