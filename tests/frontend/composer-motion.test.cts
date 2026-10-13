import assert = require('node:assert/strict');
import path = require('node:path');
import {after,before,test} from 'node:test';
import {chromium,type Browser} from 'playwright';
import {startNextServer} from './next-server.cjs';

let browser:Browser, server:Awaited<ReturnType<typeof startNextServer>>;
before(async()=>{server=await startNextServer(path.resolve(__dirname,'../..'));browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});});
after(async()=>{await browser?.close();await server?.stop();});
async function fixture(width=1280,reduced=false) {
    const context=await browser.newContext({viewport:{width,height:850},reducedMotion:reduced?'reduce':'no-preference'});
    await context.addInitScript(()=>{localStorage.setItem('ascenda-cookie-choice-v1','accepted');localStorage.setItem('ascensao-theme','dark');});
    await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/api/bootstrap')return route.fulfill({json:{page:url.searchParams.get('page')||'computer',user:{id:7,nome:'Teste',email:'teste@example.com'},csrfToken:'test-csrf',currentYear:2026}});
        if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true}],default_model:'qwen3:1.7b'}});
        if(url.pathname==='/api/ai/conversations')return route.fulfill({json:{conversations:[],next_offset:null}});
        if(url.pathname==='/api/ai/personalization')return route.fulfill({json:{}});
        if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
        if(url.origin===server.origin)return route.continue();
        return route.fulfill({status:404,body:''});
    });
    const page=await context.newPage(),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(server.origin+'/novo.html?new=1');
    await page.waitForFunction(()=>!!window.ComputerModels && !!window.ComputerAttachments && document.querySelector('.home__composer.has-inline-options'));
    await page.waitForTimeout(100);
    return {context,page,errors};
}

test('seletor interpola largura e cápsula, tolera cliques rápidos e menus fecham pelo próprio botão',async()=>{
    const {context,page:p,errors}=await fixture();
    try {
        const samples=await p.evaluate(async()=>{
            const group=document.querySelector<HTMLElement>('.provider-toggle')!,button=group.querySelector<HTMLButtonElement>('.computer-provider')!;
            const a:number[]=[];button.click();
            await new Promise<void>(resolve=>{const start=performance.now();function frame(){a.push(button.getBoundingClientRect().width);if(performance.now()-start<550)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
            return a;
        });
        assert.ok(new Set(samples.map(value=>Math.round(value))).size>3,'Deve haver larguras intermediárias, não só uma troca instantânea.');
        assert.ok(samples.at(-1)!>samples[0]+20);
        await p.locator('.model-picker').click();await p.locator('.computer-provider').click();
        await p.waitForTimeout(500);
        assert.equal(await p.locator('.computer-provider').getAttribute('aria-pressed'),'true');
        await p.locator('.local-model-picker').click();
        await p.waitForFunction(()=>document.querySelector('#computer-model-menu')?.matches(':popover-open'));
        assert.equal(await p.locator('#computer-model-menu .model-icon--ollama').count(),1);
        const duration=await p.locator('#computer-model-menu').evaluate(e=>getComputedStyle(e).transitionDuration);
        assert.match(duration,/0.15s/);
        await p.locator('.local-model-picker').click();
        assert.equal(await p.locator('#computer-model-menu').evaluate(e=>e.matches(':popover-open')),false);
        await p.locator('.attachment-toggle').click();
        await p.waitForTimeout(260);
        assert.equal(await p.locator('.attachment-toggle').getAttribute('aria-expanded'),'true');
        assert.equal(await p.locator('#attachment-menu').evaluate(e=>getComputedStyle(e).opacity),'1');
        if(process.env.QA_COMPOSER)await p.screenshot({path:process.env.QA_COMPOSER});
        await p.locator('.attachment-toggle').click();
        await p.waitForTimeout(260);
        assert.equal(await p.locator('#attachment-menu').evaluate(e=>(e as HTMLElement).hidden),true);
        assert.deepEqual(errors,[]);
    } finally {await context.close();}
});
test('mobile e movimento reduzido preservam geometria, texto ativo e seleção por teclado',async()=>{
    const {context,page:p,errors}=await fixture(390,true);
    try {
        await p.locator('.computer-provider').focus();await p.keyboard.press('Enter');
        await p.waitForFunction(()=>document.querySelector('.computer-provider')?.getAttribute('aria-pressed')==='true');
        const geometry=await p.locator('.provider-toggle').evaluate(group=>{
            const gemini=group.querySelector<HTMLElement>('.model-picker')!,computer=group.querySelector<HTMLElement>('.computer-provider')!,indicator=group.querySelector<HTMLElement>('.provider-toggle__indicator')!;
            return {small:gemini.getBoundingClientRect().width,active:computer.getBoundingClientRect().width,indicator:indicator.getBoundingClientRect().width,right:group.getBoundingClientRect().right,viewport:innerWidth};
        });
        assert.equal(geometry.small,36);assert.ok(geometry.active>70);assert.ok(Math.abs(geometry.active-geometry.indicator)<2);assert.ok(geometry.right<geometry.viewport);
        await p.locator('.attachment-toggle').click();await p.keyboard.press('Escape');
        assert.equal(await p.locator('#attachment-menu').evaluate(e=>(e as HTMLElement).hidden),true);
        assert.deepEqual(errors,[]);
    } finally {await context.close();}
});
test('texto aparece antes do fim da resposta e citações abrem somente fontes válidas',async()=>{
    const {context,page:p,errors}=await fixture(1280,true);
    try {
        await p.evaluate(()=>{
            const original=window.fetch.bind(window);
            window.fetch=async(input,init)=>{
                if(!String(input).includes('/api/ai/chat'))return original(input,init);
                const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)+'\n');
                return new Response(new ReadableStream({start(controller){
                    controller.enqueue(encode({type:'conversation',conversation_id:'1',turn_id:'1',created_at:new Date().toISOString(),attachments:[]}));
                    controller.enqueue(encode({type:'search',state:'complete',sources:[{url:'https://example.com/article',title:'Fonte segura',domain:'example.com'}]}));
                    controller.enqueue(encode({type:'delta',text:'Primeiro trecho [1]. '}));
                    Object.defineProperty(window,'finishTestAnswer',{configurable:true,value:()=>{
                        controller.enqueue(encode({type:'delta',text:'Final [99]. <script>literal</script>'}));
                        controller.enqueue(encode({type:'done',metadata:{research:{sources:[{url:'https://example.com/article',title:'Fonte segura',domain:'example.com'}]}}}));controller.close();
                    }});
                }}),{headers:{'Content-Type':'application/x-ndjson'}});
            };
        });
        await p.locator('textarea.home__input').fill('Teste de transmissão');await p.locator('.home__send').click();
        await p.waitForFunction(()=>document.querySelector('.computer-message--assistant')?.textContent?.includes('Primeiro trecho'));
        assert.equal(await p.locator('.computer-message--assistant').getByText('Final',{exact:true}).count(),0);
        await p.evaluate(()=>{const finish=Reflect.get(window,'finishTestAnswer');if(typeof finish==='function')finish();});
        await p.waitForFunction(()=>!!document.querySelector('.computer-citation'));
        assert.equal(await p.locator('.computer-citation').count(),1);
        assert.equal(await p.locator('.computer-citation').getAttribute('href'),'https://example.com/article');
        assert.equal(await p.locator('.computer-message--assistant script').count(),0);
        assert.deepEqual(errors,[]);
    } finally {await context.close();}
});

for (const width of [1280, 390]) test(`pesquisa, fontes e caixa fechada est�vel em ${width}px`, async () => {
    const {context,page:p,errors} = await fixture(width);
    try {
        await p.evaluate(() => document.fonts.ready);
        const fonts = await p.evaluate(() => ({saans: document.fonts.check('14px Saans'), kalice: document.fonts.check('24px Kalice'), input: getComputedStyle(document.querySelector('.home__input')!).fontFamily}));
        assert.equal(fonts.saans, true); assert.equal(fonts.kalice, true); assert.match(fonts.input, /Saans/);
        assert.equal(await p.locator('.model-picker').innerText(), 'Pesquisar');
        await p.locator('.local-model-picker').click();
        assert.equal(await p.locator('#computer-model-menu button').count(), 1);
        assert.equal(await p.locator('#computer-model-menu button').innerText(), 'Gemini');
        await p.locator('#computer-model-menu button').click();
        assert.equal(await p.locator('#computer-model-menu').evaluate(e => e.matches(':popover-open')), false);
        const heights = await p.evaluate(async () => {
            const composer = document.querySelector('.home__composer')!;
            const values = [composer.getBoundingClientRect().height];
            document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
            await new Promise<void>(resolve => {const start=performance.now();function frame(){values.push(composer.getBoundingClientRect().height);if(performance.now()-start<300)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
            return values;
        });
        assert.ok(Math.max(...heights)-Math.min(...heights)<1, 'Clique fora n�o deve abrir a caixa fechada');
        await p.locator('.model-picker').hover();
        assert.equal(await p.locator('.model-picker').evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
        assert.deepEqual(errors, []);
    } finally {await context.close();}
});
