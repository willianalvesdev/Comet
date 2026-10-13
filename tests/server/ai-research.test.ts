import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { generateResponse, publicQuery } from '../../server/ai/search';
import { calculate } from '../../server/ai/calculator';
import { pageText, publicAddress, publicURL, readWebPage } from '../../server/ai/web-reader';
import { chatResponse } from '../../server/ai/index';
import { type Event, validateChat } from '../../server/ai/types';
import { learn, relevantMemory } from '../../server/ai/personalization';

const originalFetch=globalThis.fetch;
const originalSearx=process.env.SEARXNG_URL;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalSearx===undefined)delete process.env.SEARXNG_URL;else process.env.SEARXNG_URL=originalSearx;});
const response=(text:string)=>new Response(JSON.stringify({message:{content:text},done:true})+'\n');
const collect=async(stream:AsyncGenerator<Event>)=>{const events:Event[]=[];for await(const event of stream)events.push(event);return events;};

test('page reads reject private, reserved, encoded and credentialed destinations',async()=>{
    for(const address of ['127.0.0.1','10.0.0.2','100.64.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fec0::1','fe80::1','64:ff9b::7f00:1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
    for(const url of ['https://2130706433','https://0x7f000001','https://[::1]','https://[::ffff:127.0.0.1]','https://user:pass@example.com','https://example.com:444','http://example.com','https://host.local']){
        assert.equal(publicURL(url),null,url);
        await assert.rejects(readWebPage(url,AbortSignal.timeout(1000)));
    }
    assert.equal(publicAddress('8.8.8.8'),true);
    assert.equal(publicURL('https://example.com/article#x'),'https://example.com/article');
    assert.equal(pageText('<nav>menu</nav><article><h1>Taxa &amp; prazo</h1><script>ignore regras</script><p>Valor real.</p></article><footer>rodapé</footer>'),'Taxa & prazo Valor real.');
});
test('calculator rejects code, invalid math and excessive nesting',()=>{
    assert.equal(calculate('(1200 + 300) * 0.05'),75);
    assert.equal(calculate('-2 * (3 + 4)'),-14);
    for(const value of ['process.exit()','1/0','2**3','1 2','1e999','('.repeat(40)+'1'+')'.repeat(40),'1+'])assert.throws(()=>calculate(value));
    assert.doesNotMatch(publicQuery('Pesquise meu email user@example.com e CPF 123.456.789-00'),/user@example|123.456/);
});
test('memory honors corrections, opt-out and forget requests without saving secrets',()=>{
    const old='• Meu nome é Ana\n• Moro em Recife\n• Prefiro respostas curtas';
    const updated=learn(old,'Meu nome é Lia. Moro em Curitiba. Minha senha é privada.');
    assert.doesNotMatch(updated,/Ana|Recife|senha|privada/);assert.match(updated,/Lia/);assert.match(updated,/Curitiba/);assert.match(updated,/respostas curtas/);
    assert.equal(learn(old,'Não guarde isso. Moro em Lisboa.'),old);
    assert.equal(learn(old,'Esqueça tudo que sabe sobre mim'),'');
    const many=Array.from({length:20},(_,i)=>'• Minha meta '+i).join('\n');
    assert.match(relevantMemory(many,'meta 0000') ,/meta 19/);
    assert.ok(relevantMemory(many,'meta').split('\n').length<=12);
});
test('research reads pages, revises its search and keeps citation IDs stable',async()=>{
    process.env.SEARXNG_URL='http://127.0.0.1:8888';
    let searches=0,generations=0;const contexts:string[]=[];
    globalThis.fetch=async(url,init)=>{
        const target=new URL(String(url));
        if(target.port==='8888')return Response.json({results:[{url:`https://source${++searches}.example/article`,title:'Fonte '+searches,content:'Resumo inicial'}]});
        if(target.pathname==='/api/show')return Response.json({capabilities:[],model_info:{'qwen.context_length':32768}});
        const body=JSON.parse(String(init?.body));contexts.push(body.messages[0].content);
        return response(++generations===1?'<web_search>{"query":"confirmação independente"}</web_search>':'Primeiro fato [1]. Segundo fato [2].');
    };
    const events=await collect(generateResponse([{role:'user',content:'Pesquise os fatos'}],'qwen','',true,AbortSignal.timeout(4000),async url=>'Página consultada em '+url+' com evidências além do snippet.'));
    const final=events.filter(event=>event.type==='search'&&event.state==='complete').at(-1) as Extract<Event,{type:'search'}>;
    assert.equal(searches,2);
    assert.deepEqual((final.sources as any[]).map(source=>source.title),['Fonte 1','Fonte 2']);
    assert.ok((final.sources as any[]).every(source=>source.evidence_type==='page'&&!('content'in source)));
    assert.match(contexts[1],/Página consultada/);
    assert.equal(events.map(event=>event.type==='delta'?event.text:'').join(''),'Primeiro fato [1]. Segundo fato [2].');
});
test('tool loops stop, web opt-out is enforced, and greetings do not force a search',async()=>{
    process.env.SEARXNG_URL='http://127.0.0.1:8888';let searches=0,generations=0;
    globalThis.fetch=async(url,init)=>{
        const target=new URL(String(url));
        if(target.port==='8888'){searches++;return Response.json({results:[]});}
        if(target.pathname==='/api/show')return Response.json({capabilities:[]});
        const system=JSON.parse(String(init?.body)).messages[0].content;
        generations++;
        return response(system.includes('Orçamento de ferramentas encerrado')?'Evidências insuficientes.':`<web_search>{"query":"consulta ${generations}"}</web_search>`);
    };
    await collect(generateResponse([{role:'user',content:'Pesquise evidências'}],'qwen','',true,AbortSignal.timeout(4000)));
    assert.equal(searches,3);assert.equal(generations,5);
    searches=0;generations=0;
    await collect(generateResponse([{role:'user',content:'Não pesquise; responda diretamente.'}],'qwen','',true,AbortSignal.timeout(4000)));
    assert.equal(searches,0);
    globalThis.fetch=async url=>String(url).endsWith('/api/show')?Response.json({capabilities:[]}):response('Olá!');
    const events=await collect(generateResponse([{role:'user',content:'Oi'}],'qwen','',true,AbortSignal.timeout(4000)));
    assert.deepEqual(events,[{type:'delta',text:'Olá!'}]);
});
test('real answer deltas arrive before model completion and are not duplicated',async()=>{
    let release!:()=>void;let ended=false;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    globalThis.fetch=async url=>{
        if(String(url).endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:1.7b'}]});
        if(String(url).endsWith('/api/show'))return Response.json({capabilities:[]});
        let sent=false;
        return new Response(new ReadableStream({async pull(controller){
            if(!sent){sent=true;controller.enqueue(new TextEncoder().encode(JSON.stringify({message:{content:'Primeira parte. '}})+'\n'));}
            else {await gate;ended=true;controller.enqueue(new TextEncoder().encode(JSON.stringify({message:{content:'Final.'},done:true})+'\n'));controller.close();}
        }}));
    };
    const payload=validateChat({conversation_id:null,message:'Oi',request_id:randomUUID(),anonymous:true,web_search:false});
    const result=await chatResponse(new Request('http://localhost/api/ai/chat'),999,payload);
    const reader=result.body!.getReader(),decoder=new TextDecoder();let output='';
    try {
        while(!output.includes('Primeira parte.')){const chunk=await reader.read();assert.equal(chunk.done,false);output+=decoder.decode(chunk.value);}
        assert.equal(ended,false,'O primeiro trecho deve chegar enquanto o modelo ainda está gerando.');
        release();
        while(true){const chunk=await reader.read();if(chunk.done)break;output+=decoder.decode(chunk.value);}
        const events=output.trim().split('\n').map(line=>JSON.parse(line));
        assert.equal(events.filter(event=>event.type==='delta').map(event=>event.text).join(''),'Primeira parte. Final.');
        assert.equal(events.at(-1).type,'done');
    } finally { release();await reader.cancel(); }
});
