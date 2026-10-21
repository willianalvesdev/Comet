import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {unzipSync,strFromU8} from 'fflate';
import {XMLValidator} from 'fast-xml-parser';
import sharp from 'sharp';
import {artifactSpec,artifactData,csvText,chartSVG} from '../../shared/artifacts';
import {createArtifact,renderArtifact,artifactDownload} from '../../server/ai/artifacts';
import {generateResponse} from '../../server/ai/search';
import type {Event} from '../../server/ai/types';
const originalFetch=globalThis.fetch;afterEach(()=>globalThis.fetch=originalFetch);
const sample={kind:'spreadsheet',name:'Passos',sheets:[{name:'Semana',columns:['Dia','Passos','Ativo'],rows:[['Segunda',6500,true],['Terça',8200,false],['=HYPERLINK("https://example.com")',-4,null]]},{name:'Resumo',columns:['Total'],rows:[[14700]]}]};
test('artifacts: real XLSX, CSV, text, document and chart outputs',async()=>{
 const artifact=await createArtifact(sample);assert.equal(artifact.files.length,2);assert.deepEqual(artifactData(artifact),artifact);
 const xlsx=await renderArtifact(artifact.spec,'xlsx'),zip=unzipSync(xlsx);
 for(const [name,content] of Object.entries(zip))assert.equal(XMLValidator.validate(strFromU8(content)),true,name);
 const xml=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.match(xml,/<v>6500<\/v>/);assert.match(xml,/inlineStr.*HYPERLINK/);assert(!xml.includes('<f>'));assert(zip['xl/worksheets/sheet2.xml']);
 const csv=(await renderArtifact(artifact.spec,'csv')).toString();assert.match(csv,/'=HYPERLINK/);assert.match(csv,/"-4"/);
 for(const [kind,props,formats] of [['text',{extension:'json',content:'{"ok":true}'},['json']],['document',{content:'# Título\n\nUma tabela:\n\n| Nome | Valor |\n| --- | --- |\n| Café | 2 |'},['pdf','docx','md']],['chart',{chart:'bar',labels:['Seg','Ter'],series:[{name:'Passos',values:[3,5]}]},['png','svg']]] as const){
   const generated=await createArtifact({kind,name:'Exemplo',...props});assert.deepEqual(generated.files.map(f=>f.format),formats);
   const bytes=await renderArtifact(generated.spec,formats[0]);if(kind==='document')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');if(kind==='chart')assert.equal((await sharp(bytes).metadata()).width,960);
 }
 const download=await artifactDownload(artifact,'xlsx');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/attachment;/);assert.match(download.headers.get('cache-control')!,/no-store/);
 await assert.rejects(artifactDownload({...artifact,expires_at:'2000-01-01T00:00:00Z'},'csv'),/expirou/);
});
test('artifacts: bounded schemas, filenames, formulas and hostile content',async()=>{
 for(const invalid of [{...sample,sheets:[]},{...sample,sheets:[{name:'Dados',columns:['a'],rows:[[1,2]]}]},{...sample,name:'../'}, {kind:'text',name:'x',extension:'exe',content:'x'},{kind:'text',name:'x',extension:'json',content:'not json'},{kind:'chart',name:'x',chart:'pie',labels:['x'],series:[{name:'x',values:[-2]}]},{kind:'document',name:'x',content:'x'.repeat(60001)}])assert.throws(()=>artifactSpec(invalid));
 assert.match(csvText({name:'x',columns:['x'],rows:[[' \t=cmd()'],['+cmd()'],['@evil'],[-3]]}),/"' \t=cmd\(\)"/);
 const chart=artifactSpec({kind:'chart',name:'<script>alert(1)</script>',chart:'line',labels:['<img>'],series:[{name:'<svg>',values:[0]}]});assert(chart.kind==='chart');assert(!chartSVG(chart).includes('<script>'));assert.match(chartSVG(chart),/&lt;img&gt;/);
 await assert.rejects(renderArtifact(artifactSpec(sample),'html'));
});
test('artifacts: model tool creates files before reply, hides JSON and works with web disabled',async()=>{
 let generations=0;const prompts:string[]=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/api/show'))return Response.json({capabilities:[],model_info:{'qwen.context_length':32768}});
  prompts.push(JSON.parse(String(init?.body)).messages[0].content);
  const text=++generations===1?'<create_artifact>'+JSON.stringify(sample)+'</create_artifact>':'Criei a planilha e o CSV.';
  return new Response(JSON.stringify({message:{content:text},done:true})+'\n');
 };
 const events:Event[]=[];for await(const event of generateResponse([{role:'user',content:'Organize os dados de passos'}],'qwen','',false,AbortSignal.timeout(10000)))events.push(event);
 assert(events.some(e=>e.type==='artifact'&&e.state==='creating'));assert(events.some(e=>e.type==='artifact'&&e.artifact?.files[0].format==='xlsx'));
 assert.equal(events.map(e=>e.type==='delta'?e.text:'').join(''),'Criei a planilha e o CSV.');assert.match(prompts[1],/Arquivo criado com sucesso/);assert.equal(generations,2);
});
test('artifacts: malformed tool output can recover, aborted generation creates no completion event',async()=>{
 let n=0;globalThis.fetch=async url=>String(url).endsWith('/api/show')?Response.json({capabilities:[]}):new Response(JSON.stringify({message:{content:++n===1?'<create_artifact>{"kind":"spreadsheet","name":"x","sheets":[]}</create_artifact>':'Não consegui criar o arquivo.'},done:true})+'\n');
 const events:Event[]=[];for await(const event of generateResponse([{role:'user',content:'Organize estes dados'}],'qwen','',false,AbortSignal.timeout(10000)))events.push(event);
 assert(events.some(e=>e.type==='artifact'&&e.state==='failed'));assert(!events.some(e=>e.type==='artifact'&&e.artifact));
 const abort=new AbortController();abort.abort();await assert.rejects(async()=>{for await(const _ of generateResponse([{role:'user',content:'Organize estes dados'}],'qwen','',false,abort.signal)){};});
});

test('artifacts: explicit file requests use structured generation, never a claimed fake download',async()=>{
 let structuredCall=false;
 globalThis.fetch=async(url,init)=>{
   if(String(url).endsWith('/api/show'))return Response.json({capabilities:[],model_info:{'qwen.context_length':32768}});
   const body=JSON.parse(String(init?.body));structuredCall=body.stream===false&&Boolean(body.format);
   return Response.json({message:{content:JSON.stringify({artifacts:[sample,{kind:'text',name:'notas',extension:'txt',content:'Dados fictícios'}]})},done:true});
 };
 const events:Event[]=[];for await(const event of generateResponse([{role:'user',content:'Crie uma planilha Excel para baixar'}],'qwen','',false,AbortSignal.timeout(10000)))events.push(event);
 assert(structuredCall);assert.equal(events.filter(e=>e.type==='artifact'&&e.artifact).length,2);assert(events.some(e=>e.type==='artifact'&&e.artifact?.files.length===2));assert.match(events.map(e=>e.type==='delta'?e.text:'').join(''),/\| Dia \| Passos/);
});

test('artifacts: file requests can refine research before structured generation',async()=>{
 const oldSearx=process.env.SEARXNG_URL;process.env.SEARXNG_URL='http://127.0.0.1:8888';let searches=0,generations=0;const contexts:string[]=[];
 try{
  globalThis.fetch=async(url,init)=>{
   const target=new URL(String(url));if(target.port==='8888'){searches++;return Response.json({results:[{url:`https://source${searches}.org`,title:'Fonte '+searches,content:'Dados verificados.'}]});}
   if(target.pathname==='/api/show')return Response.json({capabilities:[],model_info:{'qwen.context_length':32768}});
   const body=JSON.parse(String(init?.body));
   if(body.stream===false){contexts.push(body.messages.at(-1).content);return Response.json({message:{content:JSON.stringify({artifacts:[sample]})},done:true});}
   return new Response(JSON.stringify({message:{content:++generations<=5?`<web_search>{"query":"verificação ${generations}"}</web_search>`:'Já tenho evidências suficientes.'},done:true})+'\n');
  };
  const events:Event[]=[];for await(const event of generateResponse([{role:'user',content:'Pesquise e crie uma planilha Excel para baixar'}],'qwen','',true,AbortSignal.timeout(10000),async()=> 'Dados da página.'))events.push(event);
  assert.equal(searches,6);assert.equal(generations,6);assert.match(contexts[0],/Fonte 6/);assert.equal(events.filter(e=>e.type==='artifact'&&e.artifact).length,1);
  assert.doesNotMatch(events.map(e=>e.type==='delta'?e.text:'').join(''),/Já tenho/);
 }finally{if(oldSearx===undefined)delete process.env.SEARXNG_URL;else process.env.SEARXNG_URL=oldSearx;}
});
