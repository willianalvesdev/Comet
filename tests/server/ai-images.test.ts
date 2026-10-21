import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {searxImages} from '../../server/ai/research';
import {handleAI} from '../../server/ai/index';
const originalFetch=globalThis.fetch,originalSearx=process.env.SEARXNG_URL;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalSearx===undefined)delete process.env.SEARXNG_URL;else process.env.SEARXNG_URL=originalSearx;});
test('image search uses configured category and validates, deduplicates and bounds remote media',async()=>{
 process.env.SEARXNG_URL='http://127.0.0.1:8888';
 globalThis.fetch=async input=>{
  const url=new URL(String(input));assert.equal(url.searchParams.get('categories'),'images');assert.equal(url.searchParams.get('format'),'json');assert.equal(url.searchParams.get('q'),'Saturno');
  return Response.json({results:[{url:'https://example.com/article',img_src:'https://images.example.com/1.jpg',thumbnail_src:'https://images.example.com/thumb.jpg',title:'<b>Saturno</b>',resolution:'1920 x 1080'},{url:'https://example.com/other',img_src:'https://images.example.com/1.jpg'},...['http://images.example.com/a','https://127.0.0.1/a','data:image/svg+xml,abc','https://user:pass@example.com/a'].map(img_src=>({url:'https://example.com/a',img_src})),...Array.from({length:60},(_,i)=>({url:'https://example.com/'+i,img_src:'https://images.example.com/'+i+'.png'}))]});
 };
 const images=await searxImages('Saturno',AbortSignal.timeout(1000));assert.equal(images.length,40);assert.deepEqual(images[0],{url:'https://example.com/article',image:'https://images.example.com/1.jpg',thumbnail:'https://images.example.com/thumb.jpg',title:'Saturno',domain:'example.com',width:1920,height:1080});
});
test('image endpoint validates queries, redacts private material and reports provider failure',async()=>{
 process.env.SEARXNG_URL='http://127.0.0.1:8888';let calls=0;
 globalThis.fetch=async input=>{calls++;assert.doesNotMatch(String(input),/private%40example|secretvalue/);return Response.json({results:[]});};
 for(const q of ['', 'a'.repeat(351)])await assert.rejects(handleAI(new Request('https://comet.example/api/ai/images?'+new URLSearchParams({q})),{id:1},['images']));assert.equal(calls,0);
 const response=await handleAI(new Request('https://comet.example/api/ai/images?'+new URLSearchParams({q:'Saturno private@example.com senha=secretvalue'})),{id:1},['images']);assert(response);const data=await response.json();assert.deepEqual(data.images,[]);assert.doesNotMatch(data.query,/private@example|secretvalue/);
 globalThis.fetch=async()=>new Response('Unavailable',{status:503});await assert.rejects(handleAI(new Request('https://comet.example/api/ai/images?q=Saturno'),{id:1},['images']),/Não foi possível buscar imagens/);
});
