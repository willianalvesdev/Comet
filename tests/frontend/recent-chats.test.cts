import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {startNextServer} from './next-server.cjs';
import {test,before,after} from 'node:test';
import {chromium,type Browser} from 'playwright';
const root = path.resolve(__dirname, '../..');
function testObject(value:unknown):Record<string,unknown> {
 if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Invalid test data');
 return value as Record<string,unknown>;
}
let browser: Browser;
let nextServer: Awaited<ReturnType<typeof startNextServer>>;
before(async () => {
    nextServer = await startNextServer(root);
    browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
});
after(async () => {await browser?.close(); await nextServer?.stop();});
async function fixture(width = 1280) {
    const context = await browser.newContext({viewport:{width,height:800}, reducedMotion:'reduce'});
    const close = context.close.bind(context);
    context.close = async (...args) => {
        for (const page of context.pages()) await page.unrouteAll({behavior:'wait'});
        await context.unrouteAll({behavior:'wait'});
        await close(...args);
    };
    await context.addInitScript({content:fs.readFileSync(path.join(root,'artifacts/test-runtime/dom.js'),'utf8')+';Object.assign(window,{requiredElement,optionalElement,elementList,eventElement,errorMessage,isRecord,present,formField});'});
    await context.addInitScript({path:path.join(root,'artifacts/test-runtime/api-data.js')});
    await context.addInitScript(() => {localStorage.setItem('ascenda-cookie-choice-v1','accepted');if(!localStorage.getItem('ascensao-theme'))localStorage.setItem('ascensao-theme','dark');});
    let chats = [
        {id:'1',title:'Primeira conversa',updated_at:'2026-09-28T12:00:00Z'},
        {id:'2',title:'Outra conversa',updated_at:'2026-09-29T12:00:00Z'},
        {id:'3',title:'Conversa antiga',updated_at:'2026-09-20T12:00:00Z'}
    ];
    const errors:string[]=[], requests:{id:string;csrf:string}[]=[]; let failDelete = false;
    await context.route('**/*', async route => {
        const request=route.request(), url=new URL(request.url());
        if(url.pathname === '/api/bootstrap') return route.fulfill({json:{page:url.searchParams.get('page')||'computer',user:url.searchParams.get('page')==='index'?null:{id:7,nome:'Teste',email:'teste@example.com'},csrfToken:'test-csrf',currentYear:2026}});
        if(url.pathname === '/api/ai/conversations') {
            const offset=Number(url.searchParams.get('offset') || 0);
            return route.fulfill({json:{conversations:chats.slice(offset,offset+2),next_offset:offset+2<chats.length?offset+2:null}});
        }
        const match=url.pathname.match(/^\/api\/ai\/conversations\/(\d+)$/);
        if(match && request.method()==='DELETE') {
            requests.push({id:match[1],csrf:request.headers()['x-csrftoken']});
            if(failDelete && match[1]==='2')return route.fulfill({status:409,json:{error:'Conversa em andamento.'}});
            chats=chats.filter(chat=>chat.id!==match[1]);
            return route.fulfill({json:{deleted:true}});
        }
        if(match && request.method()==='PATCH') {
            const title=testObject(request.postDataJSON()).title;const chat=chats.find(chat=>chat.id===match[1]);assert.ok(chat);assert.equal(typeof title,'string');if(typeof title!=='string')throw new Error('Invalid title');chat.title=title;
            return route.fulfill({json:{title}});
        }
        if(url.pathname==='/api/finance/chart') return route.fulfill({json:{currency:'BRL',asOf:'2026-10-13',start:'2026-09-01',end:'2026-10-13',interval:'day',summary:Object.fromEntries(['balance','income','expense'].map(key=>[key,{amount:key==='expense'?'20.00':'100.00',difference:'10.00',percentage:'10.00',series:[0,50,100]}])),series:Object.fromEntries(['balance','income','expense'].map(key=>[key,{label:key,baseline:0,points:[{date:'2026-09-01',clock:null,open:0,high:100,low:0,close:100,volume:100},{date:'2026-10-13',clock:null,open:100,high:120,low:100,close:120,volume:20}]}]))}});
        if(url.pathname==='/api/finance/transactions')return route.fulfill({json:{transactions:[{id:'1',description:'Salário real',kind:'income',amount:'100.00',occurred_on:'2026-09-01',category:'Trabalho'},{id:'2',description:'Mercado',kind:'expense',amount:'20.00',occurred_on:'2026-09-02',category:'Alimentação'}],next_cursor:null}});
        if(url.pathname==='/api/news')return route.fulfill({json:{articles:[],has_more:false,page:1}});
        if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true},{id:'qwen3:4b',configured:true},{id:'qwen3:8b',configured:true},{id:'qwen3:4b-instruct-2507-q4_K_M',configured:true}]}});
        if(url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
        if (url.origin === nextServer.origin) return route.continue();
        return route.fulfill({status:404,body:''});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const goto=page.goto.bind(page), reload=page.reload.bind(page);
    const mounted=()=>page.waitForFunction(()=>document.querySelector('#workspace-page, .auth'));
    page.goto=async (...args)=>{const response=await goto(...args);await mounted();return response;};
    page.reload=async (...args)=>{const response=await reload(...args);await mounted();return response;};
    await page.goto(nextServer.origin + '/recentes.html');
    await page.waitForFunction(()=>requiredElement(document, ".recent-chats__list", HTMLElement).getAttribute('aria-busy')==='false');
    return {page,context,errors,requests,failDeletion:()=>{failDelete=true;},allowDeletion:()=>{failDelete=false;}};
}
test('recentes: cabeçalho recolhe, atalho navega e seleção usa os SVGs corretos',async()=>{
    const f=await fixture();const p=f.page;
    try {
        assert.equal(await p.locator('.recent-chats__row').count(),3);
        for (const [trigger, menu] of [['[aria-label="Ordenar recentes"]', '#sessions-sort'], ['.sidebar__profile', '#profile-menu'], ['#recent-chats .sessions__row button', '#sessions-menu']]) {
            const button = p.locator(trigger).first();
            if (trigger.includes('Ordenar recentes')) await p.locator('.sessions').filter({has:p.locator('#recent-chats')}).locator('summary').hover();
            await button.click();
            assert.equal(await p.locator(menu).evaluate(e => e.matches(':popover-open')), true, trigger);
            await button.click();
            assert.equal(await p.locator(menu).evaluate(e => e.matches(':popover-open')), false, trigger);
        }

        if(process.env.QA_DESKTOP)await p.screenshot({path:process.env.QA_DESKTOP});
        await p.locator('.sessions__heading[aria-controls="recent-chats"]').click();
        await p.waitForFunction(()=>requiredElement(document, ".sessions__heading[aria-controls=\"recent-chats\"]", HTMLButtonElement).getAttribute('aria-expanded')==='false');
        assert.equal(await p.locator('.sessions__heading[aria-controls="recent-chats"]').getAttribute('aria-expanded'),'false');
        assert.equal(await p.locator('a.sessions__title').getAttribute('href'),'/recentes.html');
        await p.locator('a.sessions__title').click();
        await p.waitForFunction(()=>optionalElement(document, ".recent-chats__row", HTMLElement));
        await p.locator('.recent-chats__row input').first().check();
        assert(await p.locator('#select-all-chats').evaluate(e=>e instanceof HTMLInputElement && e.indeterminate));
        assert.match(await p.locator('#select-all-chats').evaluate(e=>getComputedStyle(e,'::before').maskImage),/selected-partial(?:\.[\w-]+)?\.svg/);
        await p.locator('#select-all-chats').check();
        assert.equal(await p.locator('#recent-chats-title').textContent(),'3 selecionado(s)');
        assert.match(await p.locator('#select-all-chats').evaluate(e=>getComputedStyle(e,'::before').maskImage),/check(?:\.[\w-]+)?\.svg/);
        await p.locator('.recent-chats__cancel').click();
        await p.locator('[popovertarget="chat-selection-menu"]').click();
        await p.locator('[data-select="all"]').click();
        assert.equal(await p.locator('.recent-chats__row input:checked').count(),3);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});
test('recentes: busca, ordenação e opções existentes',async()=>{
    const f=await fixture();const p=f.page;
    try {
        assert.equal(await p.locator('.recent-chats__name').first().textContent(),'Outra conversa');
        await p.locator('.recent-chats__sort').click();
        await p.locator('#chat-sort-menu [data-sort=oldest]').click();
        assert.equal(await p.locator('.recent-chats__name').first().textContent(),'Conversa antiga');
        await p.locator('.recent-chats__search-toggle').click();await p.locator('#recent-chats-search').fill('Primeira');
        assert.equal(await p.locator('.recent-chats__row').count(),1);
        await p.locator('.recent-chats__row').hover();await p.locator('.recent-chats__more').click();await p.locator('#sessions-menu [data-action="pin"]').click();
        assert.equal(await p.locator('.recent-chats__filter').count(),0);
        await p.mouse.move(800,400);
        assert.equal(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).opacity),'1');
        assert.match(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).maskImage),/pinned-filled(?:\.[\w-]+)?\.svg/);
        assert.equal(await p.locator('.recent-chats__row').count(),1);
        await p.locator('.recent-chats__row').hover();
        assert.equal(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).opacity),'0');
        await p.locator('.recent-chats__more').click();await p.locator('#sessions-menu [data-action="rename"]').click();
        await p.locator('.sessions-rename').fill('Novo nome');await p.locator('.sessions-rename').press('Enter');
        await p.waitForFunction(()=>!document.querySelector('.sessions-rename'));
        await p.locator('#recent-chats-search').fill('Novo nome');
        await p.waitForFunction(()=>requiredElement(document, ".recent-chats__name", HTMLElement)?.textContent==='Novo nome');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});
test('recentes: exclusão em lote mantém selecionadas as falhas e permite repetir',async()=>{
    const f=await fixture();const p=f.page;
    try {
        f.failDeletion();await p.locator('#select-all-chats').check();await p.locator('.recent-chats__delete').click();
        await p.locator('.recent-chats__confirm [type="submit"]').click();
        await p.waitForFunction(()=>requiredElement(document, ".recent-chats__confirm [role=\"alert\"]", HTMLElement).textContent.includes('não foram excluídas'));
        assert.equal(await p.locator('.recent-chats__row').count(),1);assert.equal(await p.locator('.recent-chats__row input:checked').count(),1);
        assert(f.requests.every(request=>request.csrf==='test-csrf'));
        f.allowDeletion();await p.locator('.recent-chats__confirm [type="submit"]').click();
        await p.waitForFunction(()=>!requiredElement(document, ".recent-chats__confirm", HTMLDialogElement).open);
        assert.equal(await p.locator('.recent-chats__row').count(),0);assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});
test('recentes: celular sem transbordamento, busca e seleção utilizáveis',async()=>{
    const f=await fixture(390);const p=f.page;
    try {
        await p.locator('.recent-chats__search-toggle').click();await p.locator('#recent-chats-search').fill('conversa');
        assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await p.locator('#select-all-chats').check();
        assert(await p.locator('.recent-chats__delete').isVisible());
        assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        if(process.env.QA_SCREENSHOT)await p.screenshot({path:process.env.QA_SCREENSHOT});
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('fixados: cabeçalho recolhe e navegação preserva o estado da lateral', async () => {
    const f = await fixture(); const p = f.page;
    try {
        await p.locator('.recent-chats__row').first().hover();
        await p.locator('.recent-chats__more').first().click();
        await p.locator('#sessions-menu [data-action="pin"]').click();
        const pinned = p.locator('.sessions').filter({has:p.locator('#pinned-chats')});
        assert(await pinned.evaluate(e=>e instanceof HTMLDetailsElement && e.open));
        await pinned.locator('.sessions__heading').click();
        assert(!await pinned.evaluate(e=>e instanceof HTMLDetailsElement && e.open));
        await p.locator('.sessions__heading[aria-controls="recent-chats"]').click();
        await p.locator('.sidebar__toggle').click();
        await p.goto(nextServer.origin + '/recentes.html?return=1');
        await p.waitForFunction(()=>window.ComputerSessions);
        assert(await p.locator('body').evaluate(e=>e.classList.contains('is-sidebar-collapsed')));
        assert(!await p.locator('#pinned-chats').evaluate(e=>present(e.closest('details')).open));
        assert(!await p.locator('#recent-chats').evaluate(e=>present(e.closest('details')).open));
        assert.deepEqual(f.errors,[]);
    } finally { await f.context.close(); }
});

test('navegação mantém o mesmo documento e lateral entre todas as telas', async () => {
    const f=await fixture(); const p=f.page;
    try {
        await p.evaluate(()=>{window.originalSidebar=optionalElement(document, ".sidebar", HTMLElement);window.originalDocument=document;});
        for (const [href, selector] of [['/novo.html?new=1','.computer-page'],['/financas.html','#market-chart'],['/descobrir.html','.news-page'],['/recentes.html','.recent-chats'],['/novo.html?new=1','.computer-page']]) {
            await p.evaluate(href=>window.WorkspaceNavigation.go(href),href);
            assert(await p.locator(selector).isVisible());
            assert(await p.evaluate(()=>window.originalSidebar===optionalElement(document, ".sidebar", HTMLElement) && window.originalDocument===document));
        }
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        assert(!await p.locator('.sources-panel-toggle').isVisible());
        assert.equal(await p.locator('.sidebar__new-chat .sidebar__link').first().evaluate(e=>e.getBoundingClientRect().height),40);
        assert.equal(await p.locator('.computer-intro h1').evaluate(e=>getComputedStyle(e).flexDirection),'column');
        await p.locator('.anonymous-toggle').click();
        assert.equal(await p.locator('.home__composer').evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
        assert(await p.locator('.workspace__content').evaluate(e=>e.scrollHeight<=e.clientHeight));
        await p.locator('.anonymous-toggle').click();
        assert.equal(await p.locator('.computer-chat-title').count(),0);
        if(process.env.QA_CHAT_SCREENSHOT)await p.screenshot({path:process.env.QA_CHAT_SCREENSHOT});
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('menu móvel fecha após navegar e Voltar preserva a lateral', async () => {
    const f=await fixture(390); const p=f.page;
    try {
        await p.evaluate(()=>window.originalSidebar=optionalElement(document, ".sidebar", HTMLElement));
        await p.locator('.workspace__menu-toggle').click();
        await p.locator('.sidebar a[href="./financas.html"]').click();
        await p.waitForSelector('#market-chart');
        assert(await p.locator('body').evaluate(e=>e.classList.contains('is-sidebar-collapsed')));
        await p.goBack();
        await p.waitForSelector('.recent-chats');
        assert(await p.evaluate(()=>window.originalSidebar===optionalElement(document, ".sidebar", HTMLElement)));
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('resposta acompanha o final e respeita quem rolou para cima', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.emulateMedia({reducedMotion:'no-preference'});
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        await p.evaluate(()=>{
            const original=window.fetch.bind(window);
            window.fetch=async(input,init)=>{
                if(!String(input).includes('/api/ai/chat'))return original(input,init);
                return new Response(new ReadableStream({start(controller){
                    const send=(value:unknown)=>controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
                    send({type:'delta',text:'Uma resposta longa para verificar a rolagem. '.repeat(100)});
                    Reflect.set(window,'continueScrollResponse',()=>send({type:'delta',text:'Novos trechos recebidos do modelo. '.repeat(100)}));
                    Reflect.set(window,'finishScrollResponse',()=>{send({type:'done',metadata:{}});controller.close();});
                }}),{headers:{'Content-Type':'application/x-ndjson'}});
            };
        });
        await p.locator('.home__input').fill('Teste de rolagem');
        await p.locator('.home__send').click();
        await p.waitForFunction(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTop>300);
        assert(!await p.locator('.computer-message__actions').last().isVisible());
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollHeight-requiredElement(document, ".workspace__content", HTMLElement).scrollTop-requiredElement(document, ".workspace__content", HTMLElement).clientHeight<10));
        await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTo({top:100,behavior:'instant'}));
        await p.waitForTimeout(50);
        const length=await p.locator('.computer-message--assistant').evaluate(node=>node.textContent.length);
        await p.evaluate(()=>{const next=Reflect.get(window,'continueScrollResponse');if(typeof next==='function')next();});
        await p.waitForFunction(length=>(document.querySelector('.computer-message--assistant')?.textContent?.length||0)>length+2000,length);
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTop<120));
        await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTo({top:requiredElement(document, ".workspace__content", HTMLElement).scrollHeight,behavior:'instant'}));
        await p.evaluate(()=>{const finish=Reflect.get(window,'finishScrollResponse');if(typeof finish==='function')finish();});
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        assert(await p.locator('.computer-message__actions').last().isVisible());
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollHeight-requiredElement(document, ".workspace__content", HTMLElement).scrollTop-requiredElement(document, ".workspace__content", HTMLElement).clientHeight<10));
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('preferência de provedor e modelo persiste entre páginas e recargas', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        await p.waitForFunction(()=>!requiredElement(document, ".computer-provider", HTMLButtonElement).disabled);
        await p.locator('.computer-provider').click();
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'qwen3:1.7b');
        assert.equal(await p.locator('.model-menu [data-provider]').last().getAttribute('data-provider'),'qwen3:4b-instruct-2507-q4_K_M');
        await p.locator('.local-model-picker').click();
        await p.locator('.model-menu [data-provider="qwen3:8b"]').click();
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recentes.html'));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'qwen3:8b');
        await p.waitForFunction(()=>!requiredElement(document, ".model-picker", HTMLButtonElement).disabled);
        await p.locator('.model-picker').click();
        await p.reload();
        await p.waitForFunction(()=>window.ComputerModels && !requiredElement(document, ".computer-provider", HTMLButtonElement).disabled);
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'gemini');
        await p.locator('.computer-provider').click();
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'qwen3:8b');
        await p.evaluate(()=>window.ComputerModels.select('gemini'));
        await p.reload();
        await p.waitForFunction(()=>window.ComputerModels);
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'qwen3:8b');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('rolagem nativa funciona na página e lateral sem atravessar a header', async () => {
    for (const width of [1280,390]) {
        const f=await fixture(width);const p=f.page;
        try {
            assert.equal(await p.locator('.overlay-scrollbar, [data-overlay-scroll]').count(),0);
            await p.locator('.workspace__content').evaluate(e=>{
                const spacer=document.createElement('div');spacer.id='scroll-test';spacer.style.height='3000px';e.append(spacer);
                e.setAttribute('tabindex','0');
            });
            const content=p.locator('.workspace__content');
            assert.equal(await content.evaluate(e=>getComputedStyle(e).overflowY),'auto');
            assert.notEqual(await content.evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');
            assert.equal(await content.evaluate(e=>getComputedStyle(e).scrollbarGutter),'auto');
            assert(await p.evaluate(()=>requiredElement(document, '.workspace__content', HTMLElement).getBoundingClientRect().top>=requiredElement(document, '.workspace__header', HTMLElement).getBoundingClientRect().bottom));
            async function scroll(action:()=>Promise<void>) {
                const finished=p.evaluate(()=>new Promise<void>(resolve=>requiredElement(document, '.workspace__content', HTMLElement).addEventListener('scrollend',()=>resolve(),{once:true})));
                await action();await finished;
            }
            await p.mouse.move(width-30,400);await scroll(()=>p.mouse.wheel(0,500));
            await p.waitForFunction(()=>requiredElement(document, '.workspace__content', HTMLElement).scrollTop>0);
            await content.focus();await scroll(()=>p.keyboard.press('Control+End'));
            await p.waitForFunction(()=>{const e=requiredElement(document, '.workspace__content', HTMLElement);return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
            await scroll(()=>p.keyboard.press('Control+Home'));
            await p.waitForFunction(()=>requiredElement(document, '.workspace__content', HTMLElement).scrollTop===0);
            const bar=await content.evaluate(e=>{if(!(e instanceof HTMLElement))throw new Error('Invalid scroll container');const r=e.getBoundingClientRect();return {x:r.right-(e.offsetWidth-e.clientWidth)/2,y:r.top+20,width:e.offsetWidth-e.clientWidth};});
            assert(bar.width>0);
            await p.mouse.move(bar.x,bar.y);await p.mouse.down();await p.mouse.move(bar.x,bar.y+100,{steps:5});await p.mouse.up();
            assert(await content.evaluate(e=>e.scrollTop>0));
            await content.focus();await scroll(()=>p.keyboard.press('Control+Home'));
            await p.waitForFunction(()=>requiredElement(document, '.workspace__content', HTMLElement).scrollTop===0);
            if(width===390)await p.locator('.workspace__menu-toggle').click();
            await p.locator('.sidebar__nav').evaluate(e=>{
                const spacer=document.createElement('div');spacer.style.cssText='height:3000px;flex-shrink:0';e.append(spacer);
            });
            assert.notEqual(await p.locator('.sidebar__nav').evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');
            const top=await p.locator('.sidebar__new-chat').boundingBox();
            await p.mouse.move(120,400);await p.mouse.wheel(0,500);
            await p.waitForFunction(()=>requiredElement(document, '.sidebar__nav', HTMLElement).scrollTop>0);
            assert.deepEqual(await p.locator('.sidebar__new-chat').boundingBox(),top);
            assert.equal(await content.evaluate(e=>e.scrollTop),0);
            assert.equal(await p.evaluate(()=>document.scrollingElement?.scrollTop),0);
            await p.locator('#scroll-test').evaluate(e=>e.remove());
            assert(await content.evaluate(e=>e.scrollHeight<=e.clientHeight));
            assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            assert.deepEqual(f.errors,[]);
        } finally {await f.context.close();}
    }
});


test('lista pendente não bloqueia os controles do novo chat', async () => {
    const f=await fixture();const p=f.page;
    let release:()=>void=()=>{throw new Error("Uninitialized resolver");};
    const pending=new Promise<void>(resolve=>release=resolve);
    try {
        await p.clock.install(); await p.clock.fastForward(10001);
        await p.route('**/api/ai/conversations?offset=0',async route=>{await pending;await route.fulfill({json:{conversations:[],next_offset:null}});});
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        assert(!await p.locator('.model-picker').isDisabled());
        for(const selector of ['.model-picker','.home__microphone']) {
            assert.equal(await p.locator(selector).first().evaluate(e=>getComputedStyle(e).opacity),'1');
        }
        release();
        await p.waitForFunction(()=>!requiredElement(document, ".model-picker", HTMLButtonElement).disabled);
        assert.equal(await p.locator('.model-picker').evaluate(e=>getComputedStyle(e).opacity),'1');
        assert.deepEqual(f.errors,[]);
    } finally {release();await f.context.close();}
});


test('saudação permanece igual após recarregar e navegar', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        const greeting=await p.locator('[data-chat-greeting]').textContent();
        await p.reload();
        await p.waitForFunction(()=>window.ComputerModels);
        assert.equal(await p.locator('[data-chat-greeting]').textContent(),greeting);
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recentes.html'));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        assert.equal(await p.locator('[data-chat-greeting]').textContent(),greeting);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('lateral usa scroll nativo e oculta notificações ao recolher', async () => {
    const f=await fixture();const p=f.page;
    try {
        assert(await p.locator('.sidebar__top .sidebar__notification').isVisible());
        await p.locator('.sidebar__nav').evaluate(e=>{const spacer=document.createElement('div');spacer.style.cssText='height:2000px;flex-shrink:0';e.append(spacer);});
        assert.equal(await p.locator('.sidebar__nav').evaluate(e=>getComputedStyle(e).overflowY),'auto');
        assert.equal(await p.locator('.sessions__row').first().evaluate(e=>e.getBoundingClientRect().height),32);
        await p.locator('.sidebar__notification').click();
        assert(await p.locator('#notifications-panel').isVisible());
        assert(await p.evaluate(()=>requiredElement(document, "#notifications-panel", HTMLElement).getBoundingClientRect().left>requiredElement(document, ".sidebar", HTMLElement).getBoundingClientRect().right));
        assert(await p.evaluate(()=>{
            const panel=requiredElement(document, '#notifications-panel', HTMLElement);
            panel.hidePopover();
            requiredElement(document, '.sidebar__notification', HTMLButtonElement).click();
            return panel.getBoundingClientRect().left>requiredElement(document, '.sidebar', HTMLElement).getBoundingClientRect().right;
        }));
        await p.locator('.sidebar__toggle').click();
        assert(!await p.locator('.sidebar__notification').isVisible());
        assert(!await p.locator('#notifications-panel').isVisible());
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('finanças pagina transações e mostra erro quando o banco está indisponível', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.route('**/api/finance/transactions*',route=>{
            const next=new URL(route.request().url()).searchParams.has('before');
            return route.fulfill({json:{transactions:[{id:next?'2':'1',description:next?'Mercado':'Salário',kind:next?'expense':'income',amount:'20.00',occurred_on:'2026-09-01',category:''}],next_cursor:next?null:'2026-09-01:1'}});
        });
        await p.evaluate(()=>window.WorkspaceNavigation.go('/financas.html'));
        await p.waitForFunction(()=>requiredElement(document, ".finance-page", HTMLElement).getAttribute('aria-busy')==='false');
        await p.locator('.transfer-more').click();
        await p.waitForFunction(()=>elementList(document, ".transfer-row", HTMLElement).length===2);
        assert.match(await p.locator('.transfer-row').last().textContent() ?? '',/Mercado/);
        assert(!await p.locator('.transfer-more').isVisible());
        await p.route('**/api/finance/chart*',route=>route.fulfill({status:503,json:{error:'Banco indisponível'}}));
        await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));
        await p.waitForFunction(()=>document.querySelector('.finance-chart-error')?.textContent?.includes('Banco indisponível'));
        assert.match(await p.locator('[data-finance-total="balance"] .finance-total__values span:first-child').textContent() ?? '',/100,00/);
        assert.match(await p.locator('.finance-chart-error').innerText(),/Banco indisponível/);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('preferências aplica tema e fonte e mantém após recarregar', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.locator('[data-open-settings]').evaluate(e=>{if(!(e instanceof HTMLElement))throw new Error('Invalid button');e.click();});
        await p.locator('[data-settings-tab="preferences"]').click();
        const panel=p.locator('[data-settings-panel="preferences"]');
        assert(await panel.isVisible());
        await panel.locator('[data-theme-choice="light"]').click();
        assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
        await panel.locator('[data-response-font="sans"]').click();
        assert.equal(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--font-prose')),'var(--font-body)');
        await p.reload();
        assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
        assert.equal(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--font-prose')),'var(--font-body)');
        await p.locator('[data-open-settings]').evaluate(e=>{if(!(e instanceof HTMLElement))throw new Error('Invalid button');e.click();});
        await p.locator('[data-settings-tab="preferences"]').click();
        await panel.locator('[data-theme-choice="system"]').click();
        await p.emulateMedia({colorScheme:'dark'});
        await p.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
        assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
        await panel.locator('[data-response-font="serif"]').click();
        assert.equal(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--font-prose')),'var(--font-heading)');
    } finally {await f.context.close();}
});


test('chat financeiro usa IA só no fallback, valida lotes e preserva execução idempotente', async () => {
    const f=await fixture();const p=f.page;
    try {
        let rows:StoredTransaction[]=[], nextId=100, loseResponse=true, failRefreshAfterWrite=false, refreshFailed=false;
        const committed=new Map<string,{operation_id:string;operations:{type:string;transaction_ids:string[]}[]}>();
        const requests:{id:string;types:string[]}[]=[], otherWrites:string[]=[], interpretations:string[]=[], sources:string[]=[];
        p.on('console',message=>{if(message.text().startsWith('financial-test-source:'))sources.push(message.text().slice('financial-test-source:'.length));});
        await p.evaluate(()=>window.addEventListener('finance:interpreted',event=>console.debug('financial-test-source:'+event.detail.parserSource)));
        let aiMode:'question'|'ready'|'invalid'='question';
        const text=(value:unknown):string=>{if(typeof value!=='string')throw new Error('Expected string');return value;};
        p.on('request',request=>{if(request.method()==='POST'&&!/\/api\/finance\/(?:actions|interpret)$/.test(request.url()))otherWrites.push(request.url());});
        await p.route('**/api/finance/transactions*',route=>{
            if(refreshFailed){refreshFailed=false;return route.fulfill({status:503,json:{error:'Temporariamente indisponível'}});}
            const params=new URL(route.request().url()).searchParams;
            const deleted=params.get('state')==='deleted', offset=Number(params.get('before')??0);
            const filtered=rows.filter(row=>(row.deleted_at!==null)===deleted);
            return route.fulfill({json:{transactions:filtered.slice(offset,offset+100),next_cursor:offset+100<filtered.length?String(offset+100):null}});
        });
        await p.route('**/api/finance/interpret',route=>{
            const body=testObject(route.request().postDataJSON());
            interpretations.push(text(body.input));
            assert.equal(route.request().headers()['x-csrftoken'],'test-csrf');
            assert.deepEqual(Object.keys(body).sort(),['conversation_context','input','pending_clarification','provider']);
            assert.equal(typeof body.provider,'string');
            const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
            const action={type:'create',transactionId:null,fields:{kind:'expense',amount:'60.00',description:'Mercado',category:null,occurred_on:today}};
            const interpretation=aiMode==='question' ? {status:'needs_clarification',actions:[],clarification:'Qual foi o valor final pago em reais?'} :
                {status:'ready',actions:aiMode==='invalid'?[action,{...action,transactionId:'999999'}]:[action],clarification:null};
            return route.fulfill({json:{interpretation,context:{currentDate:today,currentTime:new Date().toISOString(),timezone:'America/Sao_Paulo',availableCategories:[],recentTransactions:rows.filter(row=>row.deleted_at===null),recentDeletedTransactions:rows.filter(row=>row.deleted_at!==null)}}});
        });
        await p.route('**/api/finance/actions',async route=>{
            const body=testObject(route.request().postDataJSON()), id=text(body.operation_id), actions=body.actions;
            assert(Array.isArray(actions));assert.equal(route.request().headers()['x-csrftoken'],'test-csrf');
            requests.push({id,types:actions.map(action=>text(testObject(action).type))});
            const existing=committed.get(id);if(existing)return route.fulfill({json:existing});
            const operations:{type:string;transaction_ids:string[]}[]=[];
            for(const entry of actions){
                const action=testObject(entry), type=text(action.type);
                let ids:string[]=[];
                if(type==='create'){
                    const transaction=testObject(action.transaction),kind=transaction.kind;
                    assert(kind==='expense'||kind==='income');
                    const row:StoredTransaction={id:String(nextId++),kind,amount:text(transaction.amount),description:text(transaction.description),category:text(transaction.category),occurred_on:text(transaction.occurred_on),currency:'BRL',deleted_at:null};
                    rows.push(row);ids=[row.id];
                }else{
                    assert(Array.isArray(action.transaction_ids));ids=action.transaction_ids.map(text);
                    for(const identifier of ids){
                        const row=rows.find(row=>row.id===identifier);assert(row);
                        if(type==='update'){
                            assert.equal(row.deleted_at,null);const changes=testObject(action.changes);
                            if(changes.amount!==undefined)row.amount=text(changes.amount);
                            if(changes.kind!==undefined){assert(changes.kind==='expense'||changes.kind==='income');row.kind=changes.kind;}
                            if(changes.occurred_on!==undefined)row.occurred_on=text(changes.occurred_on);
                        }else if(type==='delete')row.deleted_at=new Date().toISOString();
                        else if(type==='restore'){assert(row.deleted_at);row.deleted_at=null;}
                        else if(type==='permanent_delete'){assert.equal(action.confirmation,'explicit_permanent_delete');assert(row.deleted_at);rows=rows.filter(item=>item.id!==identifier);}
                        else throw new Error('Unknown operation');
                    }
                }
                operations.push({type,transaction_ids:ids});
            }
            const result={operation_id:id,operations};committed.set(id,result);
            if(failRefreshAfterWrite){failRefreshAfterWrite=false;refreshFailed=true;}
            if(loseResponse){loseResponse=false;return route.abort('failed');}
            return route.fulfill({json:result});
        });
        await p.evaluate(()=>window.WorkspaceNavigation.go('/financas.html'));
        const input=p.locator('.finance-composer textarea');
        async function submit(value:string){await input.fill(value);await input.press('Enter');await p.waitForFunction(()=>!requiredElement(document,'.finance-composer textarea',HTMLTextAreaElement).readOnly);}
        await submit('Gastei 67 no mercado ontem');
        assert.equal(rows.length,1);assert.equal(await input.inputValue(),'Gastei 67 no mercado ontem');
        await input.press('Enter');await p.waitForFunction(()=>!requiredElement(document,'.finance-composer textarea',HTMLTextAreaElement).readOnly);
        assert.equal(await input.inputValue(),'');assert.equal(rows.length,1);assert.equal(requests[0].id,requests[1].id);
        const feedback=()=>p.locator('.finance-entry-status').textContent();
        assert.equal(await feedback(),'Adicionei R$ 67,00 — Mercado — ontem.');
        const id=rows[0].id;
        await submit('Na verdade foram 75');assert.equal(rows[0].amount,'75.00');
        assert.equal(await feedback(),'Transação atualizada.');
        await submit('Apaga a compra do mercado de ontem');assert(rows[0].deleted_at);
        assert.equal(await feedback(),'Transação removida.');
        await submit('Restaura aquela compra');assert.equal(rows[0].deleted_at,null);assert.equal(rows[0].id,id);
        assert.equal(await feedback(),'Transação restaurada.');
        const previousDate=rows[0].occurred_on;
        await submit('E foi anteontem');assert.notEqual(rows[0].occurred_on,previousDate);
        await submit('Apaga ela');assert(rows[0].deleted_at);
        await submit('Desfaz');assert.equal(rows[0].deleted_at,null);assert.equal(rows[0].id,id);
        await submit('Apaga ela');await submit('Apague definitivamente ela');assert.equal(rows.length,0);
        for(const [phrase,amount,kind] of [['Recebi 1500 dia 5','1500.00','income'],['Perdi 200 em aposta e recebi 50 de volta','150.00','expense'],['Paguei 500 com 10% de juros','550.00','expense']]) {
            await submit(phrase);assert.equal(rows.length,1);assert.equal(rows[0].amount,amount);assert.equal(rows[0].kind,kind);
            assert.match(await feedback()??'',/^Adicionei R\$/);
            await submit('Apaga ela');await submit('Apague definitivamente ela');assert.equal(rows.length,0);
        }
        await submit('Gastei 30 no almoço e 20 no ônibus');assert.equal(rows.length,2);
        assert.equal(await feedback(),'Adicionei 2 transações.');
        await submit('Apaga os dois');assert(rows.every(row=>row.deleted_at));
        await submit('Desfaz');assert(rows.every(row=>row.deleted_at===null));
        await submit('Gastei 50 no mercado ontem e 80 no mercado ontem');
        const writesBefore=requests.length;
        await submit('Apaga a compra do mercado de ontem');assert.equal(requests.length,writesBefore);
        assert.equal(await feedback(),'Encontrei duas compras de Mercado ontem: R$ 50,00 e R$ 80,00. Qual delas você quer apagar?');
        await submit('A de 80');assert.equal(rows.find(row=>row.description==='Mercado'&&row.amount==='80.00')?.deleted_at!==null,true);
        assert.equal(rows.find(row=>row.description==='Mercado'&&row.amount==='50.00')?.deleted_at,null);
        const writesAfter=requests.length;
        assert.deepEqual(interpretations,[]);assert(sources.length>0&&sources.every(source=>source==='local'));
        await submit('Talvez apague definitivamente ela');assert.equal(requests.length,writesAfter);assert.equal(interpretations.length,0);
        await submit('Gastei 50 no mercado usando metade do vale');assert.equal(requests.length,writesAfter);
        assert.match(await p.locator('.finance-entry-status').textContent()??'',/valor final pago/);
        assert.equal(await input.inputValue(),'');
        aiMode='ready';
        await submit('Gastei sessenta reais no mercado');
        assert.equal(requests.length,writesAfter+1);assert.equal(rows.at(-1)?.amount,'60.00');
        assert.equal(await input.inputValue(),'');assert.equal(interpretations.length,2);
        assert.equal(sources.at(-1),'ai');assert.equal(await feedback(),'Adicionei R$ 60,00 — Mercado — hoje.');
        assert(!/parserSource|confidence|deletedAt|operation_id|transaction_id/.test(await feedback()??''));
        aiMode='invalid';
        const rowsBeforeInvalid=JSON.stringify(rows);
        await submit('Gastei sessenta reais no mercado');
        assert.equal(requests.length,writesAfter+1);assert.equal(JSON.stringify(rows),rowsBeforeInvalid);
        assert.match(await p.locator('.finance-entry-status').textContent()??'',/validar a interpretação completa/);
        const beforeLostResponse=requests.length, beforeRecoveryRows=rows.length;
        loseResponse=true;
        await submit('Gastei 42 na farmácia');
        assert.equal(rows.length,beforeRecoveryRows+1);
        await submit('Na verdade foram 45');
        assert.equal(rows.length,beforeRecoveryRows+1);assert.equal(rows.at(-1)?.amount,'45.00');
        assert.equal(requests[beforeLostResponse].id,requests[beforeLostResponse+1].id);
        assert.deepEqual(requests[beforeLostResponse+2].types,['update']);
        assert.equal(await feedback(),'Transação atualizada.');
        failRefreshAfterWrite=true;
        const beforeRefreshFailure=requests.length;
        await submit('Gastei 15 no café');
        const savedId=rows.at(-1)?.id;
        assert.match(await feedback()??'',/Não consegui confirmar/);
        await submit('Apaga ela');
        assert.equal(requests.length,beforeRefreshFailure+2);
        assert.equal(rows.find(row=>row.id===savedId)?.deleted_at!==null,true);
        assert.equal(await feedback(),'Transação removida.');
        for(let index=0;index<151;index++) rows.push({id:String(nextId++),kind:index%2?'income':'expense',amount:'10.00',description:'Registro '+index,category:'',occurred_on:'2025-01-01',currency:'BRL',deleted_at:null});
        const activeIds=rows.filter(row=>row.deleted_at===null).map(row=>row.id);
        const oldTrash=rows.filter(row=>row.deleted_at!==null).map(row=>({...row}));
        const bulkStart=requests.length, aiBeforeBulk=interpretations.length;
        await submit('apague todas as transações');
        assert.equal(requests.length,bulkStart+1);assert.deepEqual(requests.at(-1)?.types,['delete']);
        assert(rows.every(row=>row.deleted_at!==null));
        assert.equal(await feedback(),`${activeIds.length} transações removidas.`);
        assert.deepEqual(rows.filter(row=>oldTrash.some(old=>old.id===row.id)),oldTrash);
        await submit('apague todas as transações');
        assert.equal(requests.length,bulkStart+1);assert.equal(await feedback(),'Não há transações ativas para apagar.');
        await submit('Desfaz');
        assert.equal(requests.length,bulkStart+2);assert.deepEqual(requests.at(-1)?.types,['restore']);
        assert.deepEqual(rows.filter(row=>row.deleted_at===null).map(row=>row.id),activeIds);
        assert.deepEqual(rows.filter(row=>row.deleted_at!==null),oldTrash);
        assert.equal(await feedback(),`${activeIds.length} transações restauradas.`);
        assert.equal(interpretations.length,aiBeforeBulk);assert.equal(sources.at(-1),'local');
        const beforeSnack=rows.length;
        await submit('Comprei um salgado de 10 reais hoje');
        assert.equal(rows.length,beforeSnack+1);assert.equal(rows.at(-1)?.amount,'10.00');assert.equal(rows.at(-1)?.description,'Salgado');
        const snackId=rows.at(-1)?.id, snackDate=rows.at(-1)?.occurred_on;
        await submit('Na verdade eu lucrei 12');
        assert.equal(rows.length,beforeSnack+1);assert.equal(rows.at(-1)?.kind,'income');assert.equal(rows.at(-1)?.amount,'12.00');
        await submit('Na verdade eu gastei');
        assert.equal(rows.at(-1)?.kind,'expense');assert.equal(rows.at(-1)?.amount,'12.00');
        const beforeDateQuestion=requests.length;
        await submit('Na verdade foi semana passada');
        assert.equal(requests.length,beforeDateQuestion);assert.match(await feedback()??'',/qual dia da semana passada/i);
        await submit('quinta');
        assert.equal(rows.at(-1)?.id,snackId);assert.notEqual(rows.at(-1)?.occurred_on,snackDate);
        await submit('Na verdade foi de graça');assert(rows.at(-1)?.deleted_at);assert.equal(await feedback(),'Transação removida.');
        await submit('Desfaz');assert.equal(rows.at(-1)?.deleted_at,null);assert.equal(rows.at(-1)?.id,snackId);
        assert.equal(rows.length,beforeSnack+1);assert.equal(interpretations.length,aiBeforeBulk);
        assert.deepEqual(otherWrites,[]);assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('chat preserva streaming anonimo com ID nulo e metadados',async()=>{
    const f=await fixture();const p=f.page;
    try {
        await p.route('**/api/ai/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[
            {type:'conversation',conversation_id:null,turn_id:'private-turn',provider:'qwen3:1.7b',created_at:'2026-10-01T12:00:00Z'},
            {type:'thinking',text:'Raciocinio'},
            {type:'delta',text:'Resposta privada'},
            {type:'done',metadata:{thinking_seconds:null,elapsed_seconds:1,instant:false}}
        ].map(value=>JSON.stringify(value)).join('\n')+'\n'}));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
        await p.waitForFunction(()=>!requiredElement(document,'.home__input',HTMLTextAreaElement).readOnly);
        await p.locator('.anonymous-toggle').click();
        await p.locator('.home__input').fill('Mensagem privada');await p.locator('.home__send').click();
        await p.waitForFunction(()=>!requiredElement(document,'.home__input',HTMLTextAreaElement).readOnly);
        assert.equal(await p.locator('.computer-message--assistant .computer-message__text').textContent(),'Resposta privada');
        assert(await p.locator('.computer-message__actions').isVisible());
        assert(!new URL(p.url()).searchParams.has('conversation'));
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('chat restaura anexos e fontes com os campos da API',async()=>{
    const f=await fixture();const p=f.page;
    try {
        const research={state:'complete',query:'consulta',queries:['consulta'],sources:[{title:'Fonte de teste',url:'https://example.com/report',domain:'example.com',excerpt:'Trecho da fonte',published_at:'2026-09-30',date_approximate:true}]};
        await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Historico',created_at:'2026-09-30',updated_at:'2026-09-30'},active:false,before:null,turns:[{id:'turn-1',message:'Analise',answer:'Resposta salva',thinking:'Raciocinio salvo',created_at:'2026-09-30T12:00:00Z',status:'completed',attachments:[{id:'file-1',name:'documento.txt',kind:'file',size:20}],metadata:{research,thinking_seconds:2}}]}}));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?conversation=1'));
        await p.waitForFunction(()=>!requiredElement(document,'.home__input',HTMLTextAreaElement).readOnly);
        assert.equal(await p.locator('.attachment-chip__name').textContent(),'documento.txt');
        assert.equal(await p.locator('.computer-message--assistant .computer-message__text').textContent(),'Resposta salva');
        await p.locator('.computer-sources').click();
        assert.equal(await p.locator('.sources-card__title').textContent(),'Fonte de teste');
        assert.equal(await p.locator('.sources-card__source p, .sources-card__source small').count(),0);
        const source=p.locator('.sources-card__source');
        assert.ok(await source.evaluate(e=>e.getBoundingClientRect().height)>=52);
        assert.equal(await source.locator('.sources-card__excerpt').textContent(),'Trecho da fonte');
        assert.equal(await source.evaluate(e=>getComputedStyle(e).padding),'8px');
        assert.equal(await p.locator('.sources-card__list').evaluate(e=>getComputedStyle(e).gap),'4px');
        await source.hover();
        assert.equal(await p.locator('.sources-card__title').evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
        await p.route('**/api/ai/attachments',route=>route.fulfill({json:{id:'file-2',name:'novo.txt',kind:'file',size:5}}));
        await p.locator('#attachment-input').setInputFiles({name:'novo.txt',mimeType:'text/plain',buffer:Buffer.from('anexo')});
        await p.waitForFunction(()=>window.ComputerAttachments.files().length===1);
        assert.equal(await p.locator('.home__composer .attachment-chip__name').textContent(),'novo.txt');
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'gemini');
        await p.locator('.home__composer .attachment-chip__remove').click();
        assert.equal(await p.evaluate(()=>window.ComputerAttachments.files().length),0);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('respostas: versões preservam texto, fontes e horário ao recarregar', async () => {
    const f = await fixture(), p = f.page;
    try {
        const research = {sources:[{url:'https://example.com/source', domain:'example.com', title:'Fonte antiga'}]};
        await p.route('**/api/ai/conversations/1', route => route.fulfill({json:{conversation:{id:'1',title:'Versões',created_at:'2026-10-01',updated_at:'2026-10-04'},active:false,before:null,turns:[{id:'10',message:'Pergunta',answer:'Resposta nova',thinking:'',status:'completed',created_at:'2026-10-01T12:00:00Z',metadata:{answered_at:'2026-10-04T12:00:00Z',versions:[{answer:'Resposta antiga',thinking:'Pensamento anterior',metadata:{answered_at:'2026-10-01T12:00:00Z',research}}]}}]}}));
        await p.goto(nextServer.origin + '/novo.html?conversation=1');
        const answer = p.locator('.computer-message--assistant .computer-message__text');
        await p.waitForFunction(() => document.querySelector('.response-versions') !== null);
        assert.equal(await answer.textContent(), 'Resposta nova');
        await p.getByRole('button', {name:'Resposta anterior',exact:true}).click();
        assert.equal(await answer.textContent(), 'Resposta antiga');
        assert.equal(await p.locator('.response-time').getAttribute('datetime'), '2026-10-01T12:00:00.000Z');
        assert(await p.locator('.computer-sources').isVisible());
        await p.getByRole('button', {name:'Próxima resposta',exact:true}).click();
        assert.equal(await answer.textContent(), 'Resposta nova');
        await p.reload();
        await p.waitForFunction(() => document.querySelector('.response-versions') !== null);
        assert.equal(await p.locator('.response-versions > span').textContent(), '2 / 2');
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});


test('Comet: pesquisa web, fontes e painel financeiro sempre visível', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.goto(nextServer.origin + '/novo.html');
        await p.waitForFunction(() => !requiredElement(document, '.home__input', HTMLTextAreaElement).readOnly);
        await p.locator('.attachment-toggle').click();
        const web = p.locator('.web-search-toggle');
        assert.equal(await web.getAttribute('aria-pressed'), 'true');
        await web.click(); assert.equal(await web.getAttribute('aria-pressed'), 'false');
        assert.equal(await p.locator('.attachment-menu p').count(), 0);
        assert.match(await web.locator('i').evaluate(e => getComputedStyle(e).maskImage), /settings-settings-search(?:\.[\w-]+)?\.svg/);
        assert(!await p.evaluate(() => [...document.fonts].some(font => /Serrif|Geist/i.test(font.family))));
        await p.goto(nextServer.origin + '/financas.html');
        const history = p.locator('#finance-history-panel');
        assert.equal(await p.locator('.finance-panel-toggle').count(),0);
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.locator('[data-range="max"]').click();
        await p.waitForSelector('.finance-chart-column[aria-busy="false"]');
        assert.equal(await p.locator('.chart-statistics dd').count(), 6);
        assert.match(await p.locator('.chart-statistics dd').nth(3).ariaSnapshot(), /120,00/);
        assert.match(await p.locator('.chart-statistics dd').nth(1).ariaSnapshot(), /120,00/);
        await p.locator('.chart-toolbar').hover();
        assert(!(await p.locator('#chart-tooltip').isVisible()));
        assert.equal(await p.locator('.transfer-change').count(),0);
        assert.equal(await p.locator('.transfer-values').count(),2);
        assert.equal(await p.locator('[data-kind=income] .transfer-values').evaluate(el=>getComputedStyle(el).color),'rgb(64, 201, 119)');
        assert.equal(await p.locator('[data-kind=expense] .transfer-values').evaluate(el=>getComputedStyle(el).color),'rgb(255, 133, 131)');
        assert(!/Despesa|Receita/.test(await history.innerText()));
        assert(await p.locator('.transfer-avatar').first().textContent());await p.screenshot({path:path.join(root,'artifacts/finance-recent-style.png'),fullPage:true});
        await p.route('**/api/finance/transactions', route => route.fulfill({json:{transactions:[],next_cursor:null}}));
        await p.reload();
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        assert(await history.isVisible());
        await p.unroute('**/api/finance/transactions');
        await p.evaluate(() => window.dispatchEvent(new CustomEvent('finance:changed')));
        await p.waitForFunction(() => {
            const history = document.querySelector<HTMLElement>('#finance-history-panel');
            const chart = document.querySelector('.finance-chart-column')?.getBoundingClientRect();
            const composer = document.querySelector('.finance-composer')?.getBoundingClientRect();
            return history && !history.hidden && chart && composer && Math.abs(chart.left - composer.left) < 1 && Math.abs(chart.width - composer.width) < 1;
        });
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

for (const width of [1920, 1280, 390]) test(`aprender: lista e envio com pesquisa e anexo (${width})`, async () => {
    const f = await fixture(width), p = f.page;
    try {
        await p.goto(nextServer.origin + '/academico.html');
        await p.waitForFunction(() => !!window.ComputerAttachments);
        if (width < 640) {
            await p.evaluate(() => document.body.classList.add('is-sidebar-collapsed'));
            await p.waitForTimeout(500);
        }
        assert.equal(await p.locator('.study-title').innerText(), 'acadêmico');
        assert.equal(await p.locator('.study-page .web-search-toggle, .study-topic-list img').count(), 0);
        assert.equal(await p.locator('.study-topic-list li').count(), 6);
        assert.equal(await p.locator('.study-page .home__microphone').isVisible(), true);
        assert.equal(await p.locator('.study-page .model-picker').isVisible(), true);
        await p.locator('.study-page .computer-provider').click();
        assert.equal(await p.locator('.study-page .local-model-picker').isVisible(), true);
        if (width === 1920) {
            const composer = await p.locator('.study-composer').boundingBox();
            assert.ok(composer && Math.abs(composer.width - 1200) < 2 && composer.height >= 100 && composer.height <= 155, JSON.stringify(composer));
        }
        await p.locator('[data-topic-direction="1"]').click();
        await p.waitForFunction(() => requiredElement(document, '.study-topic-list', HTMLElement).scrollLeft > 10);
        await p.waitForFunction(() => !requiredElement(document, '[data-topic-direction="-1"]', HTMLButtonElement).disabled);
        await p.screenshot({path:`artifacts/aprender-${width}.png`});
        assert.equal(await p.evaluate(() => {
            const list = requiredElement(document, '.study-topic-list', HTMLElement).getBoundingClientRect();
            return elementList(document, '[data-topic-direction]', HTMLButtonElement).every(button => {
                const rect = button.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth && Math.abs(rect.top + rect.height / 2 - (list.top + list.height / 2)) < 1;
            });
        }), true);
        await p.route('**/api/ai/attachments', route => route.fulfill({json:{id:'study-file', name:'aula.txt', size:12, kind:'file'}}));
        await p.locator('#attachment-input').setInputFiles({name:'aula.txt', mimeType:'text/plain', buffer:Buffer.from('Notas de aula')});
        await p.waitForFunction(() => window.ComputerAttachments.files().length === 1 && !window.ComputerAttachments.busy());
        const requests: Record<string,unknown>[] = [];
        await p.route('**/api/ai/chat', route => {
            requests.push(testObject(route.request().postDataJSON()));
            return route.fulfill({contentType:'application/x-ndjson', body:[{type:'delta',text:'Resposta de estudo.'},{type:'done',metadata:{}}].map(value => JSON.stringify(value)).join('\n')+'\n'});
        });
        await p.locator('.study-composer textarea').fill('Como funciona a fotossíntese?');
        await p.locator('.study-composer textarea').press('Enter');
        await p.waitForFunction(() => document.querySelector('.computer-message--assistant')?.textContent?.includes('Resposta de estudo.'));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].conversation_id, null);
        assert.equal(requests[0].message, 'Como funciona a fotossíntese?');
        assert.equal(requests[0].web_search, true);
        assert.deepEqual(requests[0].attachments, ['study-file']);
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('aprender: modelo Computer é mantido no novo chat', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.locator('.sidebar__link[href="./academico.html"]').click();
        await p.locator('.computer-provider').click();
        await p.locator('.local-model-picker').click();
        await p.locator('[data-provider="qwen3:4b"]').click();
        const request = p.waitForRequest('**/api/ai/chat');
        await p.route('**/api/ai/chat', route => route.fulfill({contentType:'application/x-ndjson',body:'{"type":"delta","text":"Estudo"}\n{"type":"done","metadata":{}}\n'}));
        await p.locator('.study-composer textarea').fill('Explique a gravidade');
        await p.locator('.study-composer textarea').press('Enter');
        const payload = testObject((await request).postDataJSON());
        await p.waitForFunction(() => document.querySelector('.computer-message--assistant')?.textContent?.includes('Estudo'));
        assert.equal(payload.provider, 'qwen3:4b');
        assert.equal(payload.web_search, true);
        assert.equal(payload.conversation_id, null);
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

for (const viewport of [{width:1920,height:925},{width:1536,height:738},{width:1280,height:720},{width:1366,height:768}]) test(`aprender: proporções sem corte ${viewport.width}x${viewport.height}`, async () => {
    const f = await fixture(viewport.width), p = f.page;
    try {
        await p.setViewportSize(viewport);
        await p.goto(nextServer.origin + '/academico.html');
        await p.waitForFunction(() => !!window.ComputerAttachments);
        await p.evaluate(() => document.fonts.ready);
        const bounds = await p.evaluate(() => {
            const main = requiredElement(document, '.workspace__content', HTMLElement);
            const content = requiredElement(document, '.study-page', HTMLElement).getBoundingClientRect();
            const container = main.getBoundingClientRect();
            const list = requiredElement(document, '.study-topic-list', HTMLElement).getBoundingClientRect();
            return {overflow:main.scrollHeight-main.clientHeight, ratio:content.width/container.width, left:content.left-container.left, right:container.right-content.right, bottom:list.bottom, height:innerHeight};
        });
        assert.ok(bounds.overflow <= 1, JSON.stringify(bounds));
        assert.ok(bounds.ratio <= .76 && bounds.ratio >= .69, JSON.stringify(bounds));
        assert.ok(Math.abs(bounds.left-bounds.right) < 2, JSON.stringify(bounds));
        assert.ok(bounds.bottom <= bounds.height - 12, JSON.stringify(bounds));
        await p.screenshot({path:`artifacts/aprender-fit-${viewport.width}.png`});
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('respostas não lidas: indicador, menu, persistência e nova resposta', async () => {
    const f = await fixture(), p = f.page;
    let stamp = '2026-10-06T12:00:00.000000Z';
    try {
        await p.route('**/api/ai/conversations?*', route => route.fulfill({json:{conversations:[{id:'1',title:'Resposta nova',updated_at:'2026-10-06T12:00:00Z',last_response_at:stamp}],next_offset:null}}));
        await p.reload();
        await p.waitForSelector('.sessions__unread');
        assert.equal(await p.locator('.recent-chats__row.is-unread').count(),1);
        await p.locator('.recent-chats__more').click();
        await p.locator('[data-action="read"]').click();
        assert.equal(await p.locator('.sessions__unread').count(),0);
        assert.equal(await p.locator('.recent-chats__row.is-unread').count(),0);
        await p.reload();
        await p.waitForFunction(() => document.querySelector('.recent-chats__list')?.getAttribute('aria-busy') === 'false');
        assert.equal(await p.locator('.recent-chats__row.is-unread').count(),0);
        stamp = '2026-10-06T13:00:00.000000Z';
        await p.reload();
        await p.waitForSelector('.sessions__unread');
        assert.equal(await p.locator('.recent-chats__row.is-unread').count(),1);
        await p.route('**/api/ai/conversations/1', route => route.fulfill({json:{conversation:{id:'1',title:'Resposta nova',updated_at:stamp,last_response_at:stamp},turns:[{id:'1',message:'Olá',answer:'Resposta',thinking:'',status:'completed',created_at:stamp}],active:false,before:null}}));
        await p.locator('.recent-chats__link').click();
        await p.waitForFunction(() => !document.querySelector('.sessions__unread'));
        assert.deepEqual(f.errors,[]);
    } finally { await f.context.close(); }
});

 test('Ollama: catálogo instalado atualiza sem lista fixa', async () => {
    const f = await fixture();
    try {
        let models = ['qwen3:1.7b-turbo', 'qwen3:4b'];
        await f.context.route('**/api/ai/models', route => route.fulfill({json:{models:[{id:'gemini',configured:true}, ...models.map(id=>({id,configured:true}))]}}));
        await f.page.goto(nextServer.origin + '/academico.html');
        await f.page.locator('.computer-provider').click();
        await f.page.locator('.local-model-picker').click();
        assert.deepEqual(await f.page.locator('.model-menu [data-provider]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.provider)), models);
        await f.page.locator('[data-provider="qwen3:1.7b-turbo"]').click();
        models = ['qwen3:4b'];
        await f.page.locator('.local-model-picker').click();
        await f.page.waitForFunction(()=>document.querySelectorAll('.model-menu [data-provider]').length===1);
        assert.equal(await f.page.locator('.local-model-name').textContent(), '4b');
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('ordenar: teclado compartilhado e alinhamento do chat', async () => {
    const f = await fixture(1600);
    try {
        const p = f.page;
        await p.locator('.recent-chats__sort').click();
        await p.waitForFunction(()=>document.activeElement?.getAttribute('data-sort')==='recent');
        await p.keyboard.press('ArrowDown');
        assert.equal(await p.locator(':focus').getAttribute('data-sort'), 'oldest');
        await p.keyboard.press('Escape');
        await p.waitForFunction(()=>document.querySelector('.recent-chats__sort')?.getAttribute('aria-expanded')==='false');
        await p.locator('.sidebar').hover();
        await p.locator('[aria-label="Ordenar recentes"]').click();
        await p.waitForFunction(()=>document.activeElement?.hasAttribute('data-order'));
        await p.keyboard.press('End');
        assert.equal(await p.locator(':focus').getAttribute('data-order'), 'activity');
        await p.keyboard.press('Escape');
        await p.goto(nextServer.origin + '/novo.html');
        await p.addStyleTag({content:'*,*::before,*::after {transition:none!important;animation:none!important}'});
        await p.locator('.computer-page').evaluate(el=>el.classList.add('has-conversation'));
        await p.waitForFunction(()=>document.querySelector('.computer-composer')?.getBoundingClientRect().width===680);
        const layout=await p.evaluate(()=>{
            const page=requiredElement(document,'.computer-page',HTMLElement), box=page.getBoundingClientRect(), style=getComputedStyle(page);
            const composer=requiredElement(document,'.computer-composer',HTMLElement).getBoundingClientRect();
            return {width:box.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),left:box.left+parseFloat(style.paddingLeft),composerLeft:composer.left};
        });
        assert.equal(layout.width,680);
        assert.ok(Math.abs(layout.left-layout.composerLeft)<1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

 test('saudação respeita o tamanho definido no CSS', async () => {
    const f=await fixture(1600);const p=f.page;
    try {
        await p.goto(nextServer.origin + '/novo.html?new=1');
        await p.waitForFunction(()=>!!document.querySelector<HTMLElement>('[data-chat-greeting]')?.style.fontSize);
        for (const width of [1600, 1100, 390]) {
            await p.setViewportSize({width,height:900});
            await p.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
            const sizes=await p.locator('[data-chat-greeting]').evaluate(label=>({text:parseFloat(getComputedStyle(label).fontSize),heading:parseFloat(getComputedStyle(label.parentElement!).fontSize)}));
            assert(sizes.text<=sizes.heading,JSON.stringify({width,...sizes}));
        }
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('site: páginas principais cabem no celular e desktop nos dois temas', async () => {
    const f=await fixture();const p=f.page;
    try {
        for (const theme of ['dark','light']) {
            await p.evaluate(theme=>localStorage.setItem('ascensao-theme',theme),theme);
            for (const width of [390,1280]) {
                await p.setViewportSize({width,height:900});
                for (const name of ['index','computer','aprender','descobrir','recentes','graficos']) {
                    await p.goto(nextServer.origin + '/'+name+'.html');
                    await p.evaluate(()=>document.fonts.ready);
                    const overflow=await p.evaluate(()=>{
                        const main=document.querySelector<HTMLElement>('.workspace__content');
                        return {page:document.documentElement.scrollWidth-innerWidth,main:main ? main.scrollWidth-main.clientWidth : 0};
                    });
                    assert(overflow.page<=1 && overflow.main<=1,JSON.stringify({theme,width,name,overflow}));
                }
            }
        }
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('descobrir: cards responsivos, clima noturno e unidades persistentes', async () => {
    const f=await fixture(1920);const p=f.page;let weatherRequests=0;
    const data={current:{temperature_2m:20,weather_code:0},daily:{time:['2026-10-08','2026-10-09','2026-10-10','2026-10-11','2026-10-12'],weather_code:[0,2,3,61,95],temperature_2m_max:[24,25,26,27,28],temperature_2m_min:[15,16,17,18,19]}};
    try {
        await p.evaluate(data=>localStorage.setItem('ascenda-weather-7',JSON.stringify({city:{name:'Monte Mor',latitude:-22.9,longitude:-47.3},data,saved:Date.now()})),data);
        await f.context.route('https://api.open-meteo.com/**',route=>{weatherRequests++;return route.fulfill({json:{...data,current:{...data.current,is_day:0}}});});
        await f.context.route('**/audit-cover.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#22808c"/></svg>'}));
        await f.context.route('**/api/news?*',route=>route.fulfill({json:{page:1,has_more:false,articles:Array.from({length:4},(_,i)=>({id:String(i),title:'Águias e grandes projetos: notícias de tecnologia e ciência',description:'Pesquisas e descobertas para entender o mundo.',url:'https://example.com/'+i,image:nextServer.origin + '/audit-cover.svg',published_at:'2026-10-08T10:00:00Z',source:'Exemplo',sources:[{name:'Exemplo',url:'https://example.com'}]}))}}));
        await p.goto(nextServer.origin + '/descobrir.html');
        await p.waitForFunction(()=>document.querySelectorAll('.news-card:not(.news-skeleton)').length===4 && document.querySelector('.weather-temp .icon-night'));
        const weatherPadding=await p.locator('.weather-panel').evaluate(e=>{
            const style=getComputedStyle(e);
            return [style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft];
        });
        assert.deepEqual(weatherPadding,['20px','20px','20px','20px']);
        await p.locator('.weather-panel').screenshot({path:path.join(root,'artifacts/weather-padding-fixed.png')});
        assert.equal(weatherRequests,1);
        assert.equal(await p.locator('.news-card__time').count(),1);
        await p.getByRole('button',{name:'Fahrenheit',exact:true}).click();
        assert.match(await p.locator('.weather-temp').textContent() || '',/68°/);
        for (const width of [1920,1280,1279,768,767,390]) {
            await p.setViewportSize({width,height:900});
            const layout=await p.evaluate(()=>{
                const css=(selector:string)=>getComputedStyle(requiredElement(document,selector,HTMLElement));
                const like=requiredElement(document,'.news-card:not(.news-card--featured) .news-icon-button',HTMLElement).getBoundingClientRect();
                const more=requiredElement(document,'.news-card:not(.news-card--featured) .news-options',HTMLElement).getBoundingClientRect();
                return {columns:css('.news-feed').gridTemplateColumns.split(' ').length,weather:css('.discovery-widgets').display,smallBorder:css('.news-card:not(.news-card--featured)').borderTopWidth,bigBorder:css('.news-card--featured').borderTopWidth,gap:more.left-like.right,width:requiredElement(document,'.discovery-layout',HTMLElement).getBoundingClientRect().width};
            });
            assert.equal(layout.columns,width<768?1:3);
            assert.equal(layout.weather==='none',width<1280);
            assert.equal(layout.smallBorder,width<768?'0px':'1px');
            assert.equal(layout.bigBorder,'0px');assert(Math.abs(layout.gap)<1);assert(layout.width<=1080);
            if(width===1920 || width===390)await p.screenshot({path:'artifacts/audit-discover-'+width+'.png'});
        }
        await p.reload();
        await p.waitForFunction(()=>document.querySelector('.weather-temp')?.textContent?.includes('68°'));
        assert.equal(weatherRequests,1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('fontes: menu da header sem deslocar chat, resultados e fades nos dois extremos',async()=>{
 const f=await fixture(1280),p=f.page;
 try {
  const research={state:'complete',query:'Consulta de teste',sources:Array.from({length:20},(_,i)=>({title:'Fonte de pesquisa '+i,url:'https://example.com/report/'+i,domain:'example.com',excerpt:'Trecho detalhado da fonte usada para responder à pesquisa.'}))};
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Histórico'},active:false,before:null,turns:[{id:'turn-1',message:'Analise',answer:'Resposta salva',thinking:'',created_at:'2026-09-30T12:00:00Z',status:'completed',metadata:{research}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  const toggle=p.locator('.sources-menu-toggle'),panel=p.locator('.computer-sources-panel'),list=p.locator('.sources-card__list');
  await toggle.waitFor();assert.equal(await p.locator('.sources-panel-toggle').count(),0);assert.equal(await panel.isVisible(),false);
  for(const width of [1280,390]) {
   await p.setViewportSize({width,height:844});
   const gap=await toggle.evaluate(e=>{const previous=e.previousElementSibling!.getBoundingClientRect();return e.getBoundingClientRect().left-previous.right;});
   assert.equal(gap,8,'header buttons must use spacing-2');
   const before=await p.locator('.computer-composer').boundingBox();await toggle.click();
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await panel.isVisible(),true);
   const after=await p.locator('.computer-composer').boundingBox();assert.deepEqual(after,before);
   const bounds=await panel.boundingBox();assert.ok(bounds&&bounds.x>=8&&bounds.x+bounds.width<=width-8&&bounds.y+bounds.height<=844);
   assert.equal(await p.locator('.sources-card__query').textContent(),'Resultados para "Consulta de teste"');
   assert.ok(await list.evaluate(e=>e.scrollHeight>e.clientHeight));
   await list.evaluate(e=>e.scrollTop=0);await p.waitForFunction(()=>document.querySelector('.sources-card__list')?.classList.contains('has-overflow'));
   await list.evaluate(e=>e.scrollTop=200);await p.waitForFunction(()=>document.querySelector('.sources-card__list')?.classList.contains('is-scrolled'));
   assert.notEqual(await list.evaluate(e=>getComputedStyle(e).maskImage),'none');
   await list.evaluate(e=>e.scrollTop=e.scrollHeight);await p.waitForFunction(()=>!document.querySelector('.sources-card__list')?.classList.contains('has-overflow'));
   assert.equal(await list.evaluate(e=>getComputedStyle(e).backdropFilter),'none');
   await p.screenshot({path:'artifacts/ui-current/sources-header-'+width+'.png'});
   await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('.sources-menu-toggle')?.getAttribute('aria-expanded')==='false');
  }
  await p.goto(nextServer.origin+'/novo.html?new=1');assert.equal(await p.locator('.sources-menu-toggle').isVisible(),false);
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('aprender: altura acompanha largura e fontes sem precisar digitar', async () => {
    const f=await fixture(1600),p=f.page;
    try {
        await p.goto(nextServer.origin + '/academico.html');
        const input=p.locator('.study-page textarea');
        await input.fill('Uma pergunta de estudo com várias palavras para verificar a quebra de linha. '.repeat(4));
        await p.setViewportSize({width:950,height:900});
        await p.waitForTimeout(350);
        const before=await input.evaluate(e=>e.getBoundingClientRect().height);
        await input.dispatchEvent('input');
        assert.equal(await input.evaluate(e=>e.getBoundingClientRect().height),before);
        await p.evaluate(()=>{
            const input=requiredElement(document,'.study-page textarea',HTMLTextAreaElement);
            input.style.height='1px';
            document.fonts.dispatchEvent(new Event('loadingdone'));
        });
        assert.equal(await input.evaluate(e=>e.getBoundingClientRect().height),before);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('Next: navegação usa o build de produção e descarta eventos da página anterior', async () => {
    const f=await fixture(1280),p=f.page;
    try {
        const scripts=await p.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('src')));
        assert(scripts.some(src=>src?.startsWith('/_next/')));
        assert(!scripts.some(src=>src?.startsWith('/static/js/')));
        await p.locator('.sidebar').evaluate(e=>{(e as HTMLElement).dataset.navigationMarker='preserved';});
        for(let i=0;i<3;i++) {
            await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
            assert.equal(await p.locator('.sources-panel-toggle').count(),1);
            await p.evaluate(()=>window.WorkspaceNavigation.go('/academico.html'));
            assert.equal(await p.locator('.sources-panel-toggle').count(),0);
            assert.equal(await p.locator('.sidebar').getAttribute('data-navigation-marker'),'preserved');
        }
        let sent=0;
        await p.route('**/api/ai/chat',route=>{sent++;return route.fulfill({contentType:'application/x-ndjson',body:'{"type":"delta","text":"Resposta"}\n{"type":"done","metadata":{}}\n'});});
        await p.locator('.study-composer textarea').fill('Uma pergunta de teste');
        await p.locator('.study-composer textarea').press('Enter');
        await p.waitForFunction(()=>document.querySelector('.computer-message--assistant .computer-message__text')?.textContent==='Resposta');
        assert.equal(sent,1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

for (const width of [375,1280]) test(`auth: e-mail com código, provedores e layout ${width}px`,async()=>{
    const f=await fixture(width),p=f.page;
    let sends=0, submitted='', provider='';
    try {
        await p.route('**/api/auth/email/request',route=>{
            assert.equal(route.request().headers()['x-csrftoken'],'test-csrf');
            assert.equal(testObject(route.request().postDataJSON()).email,'pessoa@example.com');
            sends++;return route.fulfill({json:{ok:true,retryAfter:60}});
        });
        await p.route('**/api/auth/email/verify',route=>{
            submitted=String(testObject(route.request().postDataJSON()).code);
            return route.fulfill(submitted==='123456'?{json:{ok:true}}:{status:422,json:{error:'Código inválido ou expirado.'}});
        });
        await p.route('**/api/auth/*/start',route=>{
            provider=new URL(route.request().url()).pathname;
            assert.equal(route.request().method(),'POST');
            return route.fulfill({status:503,json:{error:'Este acesso ainda não foi configurado.'}});
        });
        await p.goto(nextServer.origin+'/index.html');
        await p.locator('.hero__signup').click();
        assert.equal(await p.locator('.auth [name="age"], .auth [type="password"]').count(),0);
        assert.equal(await p.locator('[data-auth-provider]').count(),2);
        assert.equal(await p.locator('[data-auth-email] [name="csrf_token"]').inputValue(),'test-csrf');
        await p.locator('[data-auth-provider=github]').click();
        await p.waitForFunction(()=>document.querySelector('[data-auth-entry-message]')?.textContent?.includes('não foi configurado'));
        assert.equal(provider,'/api/auth/github/start');
        assert(await p.locator('[data-auth-email] button').isDisabled());
        await p.locator('#auth-email').fill('p');
        assert(await p.locator('[data-auth-email] button').isDisabled());
        const buttonColors = (e: Element) => { const style = getComputedStyle(e); return [style.backgroundColor, style.color, style.opacity]; };
        assert.deepEqual(await p.locator('[data-auth-email] button').evaluate(buttonColors), await p.locator('[data-auth-provider=google]').evaluate(buttonColors));
        await p.locator('#auth-email').fill('');
        assert.notDeepEqual(await p.locator('[data-auth-email] button').evaluate(buttonColors), await p.locator('[data-auth-provider=google]').evaluate(buttonColors));
        await p.locator('#auth-email').fill('pessoa@example.com');
        assert(!await p.locator('[data-auth-email] button').isDisabled());
        await p.screenshot({path:path.join(root,`artifacts/auth-entry-${width}.png`)});
        await p.locator('[data-auth-email] button').click();
        await p.locator('[data-auth-panel=verify]').waitFor();
        assert.equal(sends,1);
        assert.equal(await p.locator('[data-auth-destination]').textContent(),'pessoa@example.com');
        assert(await p.locator('[data-auth-resend]').isDisabled());
        await p.locator('[data-auth-digit="0"]').fill('654321');
        assert.deepEqual(await p.locator('[data-auth-digit]').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value)),['6','5','4','3','2','1']);
        await p.locator('[data-auth-verify] button').click();
        await p.waitForFunction(()=>document.querySelector('[data-auth-verify-message]')?.textContent==='Código inválido ou expirado.');
        assert.equal(submitted,'654321');
        assert(!await p.locator('[data-auth-verify] button').isDisabled());
        await p.locator('[data-auth-digit="5"]').fill('');
        await p.locator('[data-auth-digit="5"]').press('Backspace');
        assert.equal(await p.locator('[data-auth-digit="4"]').inputValue(),'');
        assert(await p.locator('[data-auth-verify] button').isDisabled());
        await p.locator('[data-auth-digit="0"]').fill('123456');
        assert.equal(await p.locator('.auth').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
        await p.screenshot({path:path.join(root,`artifacts/auth-code-${width}.png`)});
        await p.locator('[data-auth-verify] button').click();
        await p.waitForURL(url => url.pathname === '/new');
        await p.locator('.computer-page').waitFor();
        assert.equal(submitted,'123456');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('auth: fechar durante o envio não reabre o diálogo',async()=>{
    const f=await fixture(),p=f.page;
    try {
        let respond!:()=>Promise<void>;
        await p.route('**/api/auth/email/request',route=>new Promise<void>(resolve=>{
            respond=async()=>{await route.fulfill({json:{ok:true,retryAfter:60}});resolve();};
        }));
        await p.goto(nextServer.origin+'/?login=1');
        await p.locator('#auth-email').fill('pessoa@example.com');
        const waiting=p.waitForRequest('**/api/auth/email/request');
        await p.locator('[data-auth-email] button').click();await waiting;
        await p.locator('.auth__close').click();await respond();
        await p.waitForFunction(()=>document.querySelector('.auth')?.getAttribute('aria-busy')==='false');
        assert(!await p.locator('.auth').isVisible());
        await p.locator('.site-header__login').click();
        assert(await p.locator('[data-auth-panel=entry]').isVisible());
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('Next: logo e novo chat repetido preservam navegação e sessão', async () => {
    const f=await fixture(),p=f.page;
    try {
        await p.locator('.sidebar').evaluate(e=>{(e as HTMLElement).dataset.navigationMarker='preserved';});
        await p.locator('.sidebar__logo').click();
        await p.waitForFunction(()=>document.querySelector('.computer-page') && !document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        assert.equal(new URL(p.url()).pathname,'/novo.html');
        for(let i=0;i<2;i++) {
            await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));
            await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        }
        await p.evaluate(()=>window.WorkspaceNavigation.go('/academico.html'));
        await p.goBack();
        await p.locator('.computer-page').waitFor();
        assert.equal(await p.locator('.sidebar').getAttribute('data-navigation-marker'),'preserved');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

for (const width of [1280, 390]) test(`novo chat: opções abrem abaixo sem expandir a caixa (${width}px)`, async () => {
    const f = await fixture(width); const p = f.page;
    try {
        await p.goto(nextServer.origin+'/novo.html?new=1');
        await p.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        const composer = p.locator('.home__composer'), toggle = p.locator('.attachment-toggle');
        const before = await composer.boundingBox(); assert.ok(before);
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await p.locator('#attachment-menu').isVisible(), true);
        const expanded = await composer.boundingBox(); assert.ok(expanded && Math.abs(expanded.height-before.height)<1);
        const menuBounds=await p.locator('#attachment-menu').boundingBox();assert.ok(menuBounds && menuBounds.y>=before.y+before.height && menuBounds.y+menuBounds.height<=844);
        assert.equal(await p.locator('#attachment-menu').evaluate(el => getComputedStyle(el).position), 'fixed');
        await p.locator('.web-search-toggle').click();
        assert.equal(await p.locator('.web-search-toggle').getAttribute('aria-pressed'), 'false');
        await p.screenshot({path:path.join(root,'artifacts/composer-expanded-'+width+'.png')});
        await toggle.click();
        assert.equal(await p.locator('#attachment-menu').isVisible(), false);
        await toggle.click(); await p.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('anexos: menu flutuante em conversas e Acadêmico, menu abaixo no novo chat', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.route('**/api/ai/conversations/1', route => route.fulfill({json:{conversation:{id:'1',title:'Conversa'},active:false,before:null,turns:[{id:'1',created_at:'2026-10-01T12:00:00Z',message:'Olá',answer:'Olá, como posso ajudar?',thinking:'',status:'completed',metadata:{}}]}}));
        for (const url of ['/novo.html?conversation=1', '/academico.html']) {
            await p.goto(nextServer.origin + url);
            if (url.includes('conversation')) await p.locator('.computer-page.has-conversation').waitFor();
            const menu = p.locator('#attachment-menu'), toggle = p.locator('.attachment-toggle');
            await toggle.click();
            assert.equal(await menu.evaluate(el => el.matches(':popover-open')), true);
            assert.equal(await menu.evaluate(el => getComputedStyle(el).position), 'fixed');
            await toggle.click();
            assert.equal(await menu.evaluate(el => el.matches(':popover-open')), false);
        }
        await p.goto(nextServer.origin + '/novo.html?new=1');
        await p.locator('.attachment-toggle').click();
        assert.equal(await p.locator('#attachment-menu').getAttribute('popover'), 'auto');
        assert.equal(await p.locator('[data-upload-files]').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('finanças: navegar com opções abertas não deixa eventos nem menus do chat', async () => {
 const f=await fixture(), p=f.page;
 try {
  await p.goto(nextServer.origin+'/novo.html?new=1');
  await p.locator('.attachment-toggle').click();
  await p.locator('.sidebar a[href="./financas.html"]').click();
  await p.locator('#market-chart').waitFor();
  await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await p.locator('#attachment-menu').count(),0);
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});

test('páginas: nomes do menu e redirecionamentos antigos', async () => {
 const f=await fixture(), p=f.page;
 try {
  for(const [oldPath,newPath,selector] of [['graficos','financas','.finance-page'],['aprender','academico','.study-page']]) {
   await p.goto(nextServer.origin+'/'+oldPath+'.html');
   assert.equal(new URL(p.url()).pathname,'/'+newPath+'.html');
   await p.locator(selector).waitFor();
   assert.equal(await p.locator('.sidebar__link[aria-current="page"]').getAttribute('href'),'./'+newPath+'.html');
  }
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('prévia: Busca, link clicável, hover contínuo e opções fixas no chat selecionado',async()=>{
    const f=await fixture(1600),p=f.page;
    try {
        await p.route('**/api/ai/conversations/2',route=>route.fulfill({json:{conversation:{id:'2',title:'Outra conversa',created_at:'2026-09-29',updated_at:'2026-09-29'},active:false,before:null,turns:[]}}));
        await p.route('**/api/ai/conversations/2/preview',route=>route.fulfill({json:{message:'Consulta de teste',answer:'Resposta pesquisada.',created_at:'2026-09-29T12:00:00Z',has_search:false}}));
        await p.locator('#recent-chats [data-id="2"] .sessions__link').hover();
        const preview=p.locator('.chat-preview');
        await preview.waitFor({state:'visible'});
        await preview.hover();await p.waitForTimeout(300);
        assert(await preview.isVisible());assert(await preview.locator('.chat-preview__search').isVisible());assert((await preview.locator('.chat-preview__search i').evaluate(el=>getComputedStyle(el).maskImage)).includes('search'));
        assert.equal(await preview.locator('a').getAttribute('href'),nextServer.origin+'/novo.html?conversation=2');
        await preview.locator('a').click();
        await p.waitForURL('**/novo.html?conversation=2');
        assert.equal(await p.locator('.local-model-name').evaluate(el=>getComputedStyle(el).fontWeight),'500');
        await p.locator('#recent-chats [data-id="2"] .sessions__link[aria-current]').waitFor();
        await p.mouse.move(1500,700);
        assert.equal(await p.locator('#recent-chats [data-id="2"] .sessions__more').evaluate(e=>getComputedStyle(e).opacity),'1');
        assert.equal(await p.locator('#recent-chats [data-id="1"] .sessions__more').evaluate(e=>getComputedStyle(e).opacity),'0');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('opções do chat: título, fixar, renomear, excluir e três exportações com notificações',async()=>{
    const f=await fixture(1600),p=f.page;
    try {
        await p.route('**/api/ai/conversations/2',route=>route.request().method()==='GET'?route.fulfill({json:{conversation:{id:'2',title:'Outra conversa',created_at:'2026-09-28T12:00:00Z',updated_at:'2026-09-29T12:00:00Z'},active:false,before:null,turns:[{id:'turn-2',message:'Pergunta',answer:'Resposta salva',thinking:'',status:'completed',created_at:'2026-09-29T12:00:00Z'}]}}):route.fallback());
        await p.goto(nextServer.origin+'/novo.html?conversation=2');
        const trigger=p.locator('.chat-options-toggle');await trigger.waitFor({state:'visible'});await p.waitForFunction(()=>!requiredElement(document,'.chat-options-toggle',HTMLButtonElement).disabled);
        await trigger.click();const menu=p.locator('.chat-options');await menu.waitFor({state:'visible'});
        if(process.env.EXPORT_UI_QA)await p.screenshot({path:'artifacts/chat-options-desktop.png'});
        assert.equal(await menu.locator('h2').textContent(),'Outra conversa');assert.equal(await menu.locator('.chat-options__owner').textContent(),'Teste (Você)');assert.match(await menu.locator('time').textContent() || '',/setembro/);
        await menu.locator('[data-action="pin"]').click();assert(await p.locator('#pinned-chats [data-id="2"]').isVisible());
        await trigger.click();assert.equal(await menu.locator('[data-action="pin"]').textContent(),'Desafixar');await menu.locator('[data-action="pin"]').click();
        await trigger.click();await menu.locator('[data-action="rename"]').click();await p.locator('.chat-rename input').fill('Sessão renomeada');await p.locator('.chat-rename button[type="submit"]').click();await p.locator('.chat-rename').waitFor({state:'hidden'});
        assert.equal(await p.locator('#recent-chats [data-id="2"] .sessions__title').textContent(),'Sessão renomeada');
        for(const [format,extension,type] of [['pdf','pdf','application/pdf'],['markdown','md','text/markdown'],['docx','docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
            let release!:()=>void;const ready=new Promise<void>(resolve=>release=resolve);
            await p.route('**/api/ai/conversations/2/export?format='+format,async route=>{await ready;await route.fulfill({contentType:type,headers:{'Content-Disposition':"attachment; filename*=UTF-8''Sess%C3%A3o."+extension},body:'conteúdo do arquivo'});});
            await trigger.click();await menu.locator('[data-export="'+format+'"]').click();await p.locator('.export-notice[data-state="pending"]').waitFor({state:'visible'});
            const download=p.waitForEvent('download');release();assert.equal((await download).suggestedFilename(),'Sessão.'+extension);
            await p.locator('.export-notice[data-state="complete"]').first().waitFor({state:'visible'});
        }
        assert.equal(await p.locator('.export-notice[data-state="complete"]').count(),3);
        if(process.env.EXPORT_UI_QA)await p.screenshot({path:'artifacts/chat-export-notices.png'});
        await p.locator('.export-notices__clear').click();assert(!await p.locator('.export-notices').isVisible());
        await p.route('**/api/ai/conversations/2/export?format=pdf',route=>route.fulfill({status:500,json:{error:'Falha de teste'}}));
        await trigger.click();await menu.locator('[data-export="pdf"]').click();await p.locator('.export-notice[data-state="failed"]').waitFor({state:'visible'});assert.match(await p.locator('.export-notice small').textContent() || '',/Falha de teste/);
        await p.locator('.export-notice > button').click();assert(!await p.locator('.export-notices').isVisible());
        await p.setViewportSize({width:390,height:800});await trigger.click();
        assert(await menu.evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.getBoundingClientRect().left>=0));
        if(process.env.EXPORT_UI_QA)await p.screenshot({path:'artifacts/chat-options-mobile.png'});
        await menu.locator('[data-action="delete"]').click();assert(await p.locator('.sessions-dialog--delete').isVisible());await p.locator('.sessions-dialog--delete [data-cancel]').click();
        await p.setViewportSize({width:1600,height:800});
        await p.locator('.sidebar__new-chat a[aria-label="Novo chat"]').click();await p.waitForURL('**/novo.html?new=1');await trigger.waitFor({state:'hidden'});assert(!await trigger.isVisible());
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('ditado: bolinhas, brilho e encerramento preservam o texto',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.addInitScript(() => {
   class Recognition {
    onstart: (()=>void)|null=null; onend:(()=>void)|null=null;
    start(){this.onstart?.();} stop(){this.onend?.();} abort(){this.onend?.();}
   }
   Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw new Error('Unavailable in test');},configurable:true});
  });
  await p.goto(nextServer.origin+'/novo.html');
  await p.locator('.home__input').fill('Texto preservado');
  await p.locator('.home__microphone').click();
  await p.waitForFunction(()=>document.querySelector('.home__composer.is-dictating'));
  assert.match(await p.locator('.home__microphone').evaluate(e=>getComputedStyle(e,'::before').maskImage),/stop[^/]*\.svg/);
  assert.equal(await p.locator('.dictation-equalizer circle').count(),145);
  assert.equal(await p.locator('.dictation-equalizer').isVisible(),true);
  assert.equal(await p.locator('.dictation-glow').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  assert.equal(await p.locator('.dictation-glow__spin').evaluate(e=>getComputedStyle(e).animationName),'none');
  await p.locator('.home__send').click();
  assert.equal(await p.locator('.home__input').inputValue(),'Texto preservado');
  assert.equal(await p.locator('.home__composer.is-dictating').count(),0);
  assert.equal(await p.locator('.dictation-equalizer').isVisible(),false);
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('menu mobile: abrir não desloca o conteúdo',async()=>{
 const f=await fixture(390);const p=f.page;
 try {
  for(const route of ['/recentes.html','/novo.html','/financas.html']) {
   await p.goto(nextServer.origin+route);
   const content=p.locator('.workspace__content');
   const before=await content.boundingBox();
   await p.locator('.workspace__menu-toggle').count().then(async count=>{
    if(count) await p.locator('.workspace__menu-toggle').click();
    else await p.locator('.sidebar__toggle').evaluate((e:HTMLElement)=>e.click());
   });
   const after=await content.boundingBox();
   assert.ok(before&&after);
   assert.equal(after.x,before.x,route);
   assert.equal(after.width,before.width,route);
  }
 } finally { await f.context.close(); }
});


test('tema claro: pesos maiores, lateral sem borda e blur gradual',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.evaluate(()=>document.documentElement.dataset.theme='light');
  assert.equal(await p.locator('body').evaluate(e=>getComputedStyle(e).fontWeight),'500');
  assert.equal(await p.locator('.sidebar').evaluate(e=>getComputedStyle(e).borderRightWidth),'0px');
  const handle=p.locator('.sidebar__resize');const box=await handle.boundingBox();assert.ok(box);
  const before=await p.locator('.sidebar').boundingBox();assert.ok(before);
  await p.mouse.move(box.x+3,box.y+100);await p.mouse.down();await p.mouse.move(box.x+63,box.y+100);await p.mouse.up();
  const after=await p.locator('.sidebar').boundingBox();assert.ok(after);assert.ok(after.width>before.width);
  assert.equal(await p.locator('.sidebar__new-chat').evaluate(e=>getComputedStyle(e,'::before').backdropFilter),'none');
  assert.equal(await p.locator('.sidebar__new-chat').evaluate(e=>getComputedStyle(e,'::after').backdropFilter),'blur(5px)');
  assert.match(await p.locator('.sidebar__new-chat').evaluate(e=>getComputedStyle(e,'::after').maskImage),/linear-gradient/);
  await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  assert.equal(await p.locator('body').evaluate(e=>getComputedStyle(e).fontWeight),'450');
 } finally {await f.context.close();}
});


test('riscos: extremos desfocados e proximidade nítida',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.goto(nextServer.origin+'/novo.html');
  await p.locator('.computer-messages').evaluate(e=>{
   (e as HTMLElement).hidden=false;
   for(let i=0;i<16;i++) {const message=document.createElement('div');message.className='computer-message computer-message--user';message.style.minHeight='160px';message.innerHTML='<div class="computer-message__text">Mensagem '+i+'</div>';e.append(message);}
   document.querySelector('.computer-page')?.classList.add('has-conversation');
  });
  const marks=p.locator('.message-navigator__mark');await marks.last().waitFor({state:'attached'});
  await p.locator('.workspace__content').evaluate(e=>{e.scrollTop=(e.scrollHeight-e.clientHeight)/2;});
  await p.waitForFunction(()=>parseFloat((document.querySelector('.message-navigator__mark') as HTMLElement)?.style.getPropertyValue('--mark-blur'))>0);
  await marks.first().hover();
  assert.equal(await marks.first().evaluate(e=>(e as HTMLElement).style.getPropertyValue('--mark-blur')),'0.00px');
  assert.equal(await marks.nth(1).evaluate(e=>(e as HTMLElement).style.getPropertyValue('--mark-blur')),'0.00px');
  assert.ok(await marks.last().evaluate(e=>parseFloat((e as HTMLElement).style.getPropertyValue('--mark-blur')))>0);
  await marks.last().hover();
  const preview=p.locator('.message-navigator__list button:not([hidden])');
  await preview.hover();
  assert.equal(await preview.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await marks.last().evaluate(e=>(e as HTMLElement).style.getPropertyValue('--mark-blur')),'0.00px');
 } finally {await f.context.close();}
});


test('chats laterais: ícone e título alinhados sem sobreposição',async()=>{
 const f=await fixture();
 try {
  const link=f.page.locator('.sidebar .sessions__link').first();
  const icon=await link.locator('.sessions__chat-icon').boundingBox();
  const title=await link.locator('.sessions__title').boundingBox();
  assert.ok(icon&&title);
  assert.equal(icon.width,await link.evaluate(e=>parseFloat(getComputedStyle(e).getPropertyValue('--icon-medium'))));
  assert.equal(Math.round(title.x-icon.x-icon.width),8);
  assert.ok(Math.abs(icon.y+icon.height/2-title.y-title.height/2)<1);
 } finally {await f.context.close();}
});


test('acadêmico: alternar páginas repetidamente mantém tela e controles',async()=>{
 const f=await fixture();const p=f.page;
 try {
  for(let i=0;i<4;i++) {
   for(const route of ['/novo.html?new=1','/financas.html','/recentes.html','/descobrir.html']) {
    await p.evaluate(url=>window.WorkspaceNavigation.go(url),route);
    await p.evaluate(()=>window.WorkspaceNavigation.go('/academico.html'));
    assert.equal(await p.locator('.study-page').isVisible(),true,JSON.stringify(f.errors));
    await p.locator('.home__input').fill('Pergunta de estudo');
    assert.equal(await p.locator('.home__send').isEnabled(),true);
   }
  }
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('acadêmico: falha de inicialização mostra recuperação e permite repetir',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.evaluate(()=>{
   const query=Element.prototype.querySelector;
   Element.prototype.querySelector=function(this:Element,selector:string) {
    if(selector==='.study-topic-list') {Element.prototype.querySelector=query;throw new Error('Falha simulada de inicialização');}
    return query.call(this,selector);
   } as typeof Element.prototype.querySelector;
  });
  await p.evaluate(()=>window.WorkspaceNavigation.go('/academico.html'));
  await p.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await p.locator('.study-page').waitFor({state:'visible'});
  await p.locator('.home__input').fill('Teste após recuperação');
  assert.equal(await p.locator('.home__send').isEnabled(),true);
 } finally {await f.context.close();}
});


test('cabeçalhos: hover, ordenação de fixados e novo chat',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.evaluate(()=>localStorage.setItem('ascenda-pinned-7',JSON.stringify({'1':{id:'1',title:'Zebra',updated_at:'2026-09-28'},'2':{id:'2',title:'Abelha',updated_at:'2026-09-29'}})));
  await p.reload();
  const pinned=p.locator('.sessions').filter({has:p.locator('#pinned-chats')});
  const recent=p.locator('.sessions').filter({has:p.locator('#recent-chats')});
  await p.mouse.move(900,600);
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('.sessions__toggle')!).opacity==='0');
  await p.locator('.sidebar__logo').hover();
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('.sessions__toggle')!).opacity==='1');
  assert.equal(await recent.locator('.sessions__preferences').evaluate(e=>getComputedStyle(e).opacity),'0');
  await pinned.locator('summary').hover();
  await pinned.locator('.sessions__preferences').click();
  await p.locator('#pinned-sort [data-order="name"]').click();
  assert.equal(await p.locator('#pinned-chats .sessions__title').first().textContent(),'Outra conversa');
  assert.equal(await p.evaluate(()=>localStorage.getItem('ascenda-pinned-7-order')),'name');
  assert.equal(await pinned.locator('.sessions__new').count(),0);
  await recent.locator('summary').hover();
  await recent.locator('.sessions__new').click();
  await p.locator('.computer-page').waitFor({state:'visible'});
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('resposta em andamento preserva hover dos cabeçalhos',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.evaluate(()=>{window.ComputerSessions.setBusy(true);document.body.classList.add('chat-is-loading');});
  await p.mouse.move(900,600);
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('.sessions__preferences')!).opacity==='0');
  const summary=p.locator('.sessions').filter({has:p.locator('#recent-chats')}).locator('summary');
  await summary.hover();
  assert.equal(await summary.locator('.sessions__preferences').isEnabled(),true);
  assert.equal(await summary.locator('.sessions__toggle').isEnabled(),true);
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="Ordenar recentes"]')!).opacity==='1');
  assert.equal(await p.locator('#recent-chats .sessions__more').first().isDisabled(),true);
 } finally {await f.context.close();}
});


test('riscos: primeiro no topo e último no fim do chat',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.goto(nextServer.origin+'/novo.html');
  await p.locator('.computer-messages').evaluate(e=>{
   document.querySelector('.computer-page')?.classList.add('has-conversation');
   (e as HTMLElement).hidden=false;
   for(let i=0;i<8;i++){const m=document.createElement('div');m.className='computer-message computer-message--user';m.style.minHeight='240px';m.innerHTML='<div class="computer-message__text">Mensagem '+i+'</div>';e.append(m);}
  });
  await p.locator('.message-navigator__mark').last().waitFor({state:'attached'});
  await p.locator('.workspace__content').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
  await p.waitForFunction(()=>document.querySelector('.message-navigator__mark:last-child')?.getAttribute('aria-current')==='true');
  await p.locator('.workspace__content').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));});
  await p.waitForFunction(()=>document.querySelector('.message-navigator__mark:first-child')?.getAttribute('aria-current')==='true');
  assert.equal(await p.locator('.message-navigator__mark[aria-current="true"]').count(),1);
 } finally {await f.context.close();}
});


test('anônimo: perfil sincronizado, dados ocultos e conversa descartada ao sair',async()=>{
 const f=await fixture();const p=f.page;
 try {
  const payloads:Record<string,unknown>[]=[];
  await p.route('**/api/ai/chat',route=>{payloads.push(testObject(route.request().postDataJSON()));return route.fulfill({contentType:'application/x-ndjson',body:[{type:'conversation',conversation_id:null,turn_id:'private-turn',provider:'gemini'},{type:'delta',text:'Resposta temporária'},{type:'done',metadata:{}}].map(v=>JSON.stringify(v)).join('\n')+'\n'});});
  await p.locator('.sidebar__profile').click();await p.getByRole('switch',{name:'Modo anônimo'}).click();
  await p.waitForFunction(()=>document.body.classList.contains('is-anonymous'));
  assert.equal(await p.locator('.sidebar').isVisible(),true);
  assert.equal(await p.locator('.sidebar__nav').isVisible(),true);
  assert.equal(await p.locator('.sidebar__link[aria-label="Finanças"]').isVisible(),true);
  assert.equal(await p.locator('.sidebar__profile-info').isVisible(),true);
  assert.equal(await p.locator('.sidebar__avatar').first().evaluate(e=>getComputedStyle(e,'::after').maskImage.includes('anonymous')),true);
  assert.equal(await p.locator('.profile-anonymous').getAttribute('aria-checked'),'true');
  assert.equal(await p.locator('.home__composer').evaluate(e=>getComputedStyle(e).borderTopStyle),'solid');
  await p.locator('.home__input').fill('Pergunta privada');await p.locator('.home__send').click();
  await p.waitForFunction(()=>document.querySelector('.computer-message--assistant .computer-message__text')?.textContent==='Resposta temporária');
  assert.equal(payloads[0].anonymous,true);assert.equal(payloads[0].conversation_id,null);assert.deepEqual(payloads[0].history,[]);
  await p.locator('.sidebar__link[aria-label="Novo chat"]').click();
  assert.equal(await p.locator('.computer-messages').textContent(),'');
  assert.equal(await p.locator('.attachment-toggle').isVisible(),true);
  assert.equal(await p.locator('.attachment-toggle').isEnabled(),true);
  await p.locator('.home__input').fill('Segunda privada');await p.locator('.home__send').click();
  await p.waitForFunction(()=>document.querySelectorAll('.sidebar .sessions__row[data-id^="anonymous-"]').length===2);
  assert.deepEqual(payloads[1].history,[]);
  await p.locator('.sidebar .sessions__link').filter({hasText:'Pergunta privada'}).click();
  assert.equal(await p.locator('.computer-message--user').first().textContent().then(t=>t?.includes('Pergunta privada')),true);
  await p.locator('.home__input').fill('Continuação privada');await p.locator('.home__send').click();
  await p.waitForFunction(()=>document.querySelectorAll('.computer-message--assistant').length===2);
  assert.equal((payloads[2].history as unknown[]).length,2);
  assert.equal(await p.evaluate(()=>Object.values(sessionStorage).some(v=>String(v).includes('Segunda privada'))),false);
  await p.screenshot({path:'artifacts/ui-current/anonymous-multiple-chats.png'});
  assert.equal(await p.locator('.anonymous-toggle').isVisible(),false);
  await p.locator('.sidebar__profile').click();
  await p.getByRole('switch',{name:'Modo anônimo'}).click();
  assert.equal(await p.locator('.computer-messages').textContent(),'');
  assert.equal(await p.locator('.home__input').inputValue(),'');
  assert.equal(await p.locator('.sidebar__nav').isVisible(),true);
  assert.equal(await p.locator('.profile-anonymous').getAttribute('aria-checked'),'false');
  assert.equal(await p.locator('.sidebar .sessions__row[data-id^="anonymous-"]').count(),0);
  assert.equal(await p.locator('.sidebar__profile-email').textContent(),'Tester');
  await p.locator('.anonymous-toggle').click();
  await p.locator('.sidebar__link[aria-label="Novo chat"]').click();
  await p.waitForFunction(()=>document.body.classList.contains('is-anonymous') && document.querySelector('.profile-anonymous')?.getAttribute('aria-checked')==='true');
  assert.equal(await p.locator('.computer-messages').textContent(),'');
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('resposta: PDF individual, gaps iguais e aparência anônima',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Conversa teste'},active:false,before:null,turns:[{id:'123',created_at:'2026-10-14T12:00:00Z',message:'Minha pergunta',answer:'Resposta para exportar',thinking:'',status:'completed',attachments:[],metadata:{}}]}}));
  let exportURL='';
  await p.route('**/api/ai/conversations/1/export?*',route=>{exportURL=route.request().url();return route.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':"attachment; filename*=UTF-8''resposta.pdf"},body:'%PDF-1.7\nfixture'});});
  await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?conversation=1'));
  const download=p.locator('.computer-download');await download.waitFor({state:'visible'});
  const boxes=await p.locator('.computer-message__actions > button').evaluateAll(es=>es.slice(0,5).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width};}));
  assert.equal(boxes.length,5);assert.deepEqual(boxes.slice(1).map((r,i)=>r.x-boxes[i].x-boxes[i].width),[4,4,4,4]);
  const [file]=await Promise.all([p.waitForEvent('download'),download.click()]);assert.equal(file.suggestedFilename(),'resposta.pdf');assert.equal(new URL(exportURL).searchParams.get('turn'),'123');
  assert.equal(await p.locator('.computer-composer').evaluate(e=>getComputedStyle(e,'::before').backdropFilter),'none');
  assert.equal(await p.locator('.anonymous-toggle').isVisible(),false);
  await p.locator('.sidebar__profile').click();
  await p.getByRole('switch',{name:'Modo anônimo'}).click();
  await p.locator('.sidebar__profile').click();
  fs.mkdirSync(path.join(root,'artifacts/ui-current'),{recursive:true});
  await p.screenshot({path:path.join(root,'artifacts/ui-current/anonymous-desktop.png')});
  assert.equal(await p.locator('.profile-anonymous').getAttribute('aria-checked'),'true');
  await p.getByRole('switch',{name:'Modo anônimo'}).click();
  assert.equal(await p.locator('.computer-message').count(),0);
  await p.screenshot({path:path.join(root,'artifacts/ui-current/new-chat-desktop.png')});
  const centered = await p.locator('.home__composer').evaluate(e=>{const r=e.getBoundingClientRect();const viewport=document.querySelector('.workspace__content')!.getBoundingClientRect();return Math.abs(r.y+r.height/2-(viewport.y+viewport.height/2));});
  assert.ok(centered<2, 'composer must be vertically centered: '+centered);
  assert.equal(await p.locator('.anonymous-toggle').isVisible(),true);
  assert.match(await p.locator('.web-search-toggle').evaluate(e=>getComputedStyle(e).getPropertyValue('corner-shape')),/^(round|superellipse\(1\))$/);
  const logo=await p.locator('.computer-intro__animated-logo').boundingBox();assert.ok(logo&&logo.width===34&&logo.height===28);
  await p.setViewportSize({width:390,height:844});
  await p.locator('.anonymous-toggle').click();
  await p.locator('.workspace__menu-toggle').click();
  assert.equal(await p.locator('.sidebar').isVisible(),true);
  await p.screenshot({path:path.join(root,'artifacts/ui-current/anonymous-mobile.png')});
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('sombras sem blur, hover sem tooltip e menu diagonal',async()=>{
 const f=await fixture();const p=f.page;
 const sharp = require('sharp') as (input:Buffer)=>{removeAlpha():{raw():{toBuffer():Promise<Buffer>}}};
 try {
  const link=p.locator('.sidebar .sessions__link').first();
  await link.hover(); await p.waitForTimeout(800);
  assert.equal(await link.getAttribute('title'),null);
  assert.equal(await link.getAttribute('data-tooltip'),null);
  assert.equal(await p.locator('.site-tooltip:popover-open').count(),0);
  const trigger=p.locator('.sidebar .sessions__more').first();await trigger.click();
  const button=await trigger.boundingBox(),menu=await p.locator('.sessions-menu').boundingBox();
  assert.ok(button&&menu);assert.ok(Math.abs(menu.x-button.x)<2);assert.ok(Math.abs(menu.y-button.y-button.height-6)<2);
  await p.screenshot({path:'artifacts/ui-current/chat-menu-diagonal.png'});
  const shadowClip={x:menu.x,y:menu.y+menu.height,width:menu.width,height:12};
  const shadowOn=await p.screenshot({clip:shadowClip});
  const shadowOverride=await p.addStyleTag({content:'.sessions-menu {box-shadow:none!important}'});
  const shadowOff=await p.screenshot({clip:shadowClip});await shadowOverride.evaluate(e=>e.parentNode?.removeChild(e));
  const shadowA=await sharp(shadowOn).removeAlpha().raw().toBuffer(),shadowB=await sharp(shadowOff).removeAlpha().raw().toBuffer();
  let shadowPixels=0;for(let i=0;i<shadowA.length;i++)if(Math.abs(shadowA[i]-shadowB[i])>2)shadowPixels++;
  assert.ok(shadowPixels>50,'menu shadow must render outside its border');
  await p.keyboard.press('Escape');
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Teste blur'},active:false,before:null,turns:[{id:'blur-turn',created_at:'2026-10-14T12:00:00Z',message:'Teste de blur',answer:'Texto da resposta para testar a sobreposição. '.repeat(100),thinking:'',status:'completed',attachments:[],metadata:{}}]}}));
  await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?conversation=1'));
  await p.locator('.computer-page.has-conversation').waitFor();
  for(const selector of ['.computer-composer','.sidebar__new-chat','.sidebar__footer','.sidebar .sessions__link','.sources-card']) {
   assert.equal(await p.locator(selector).first().evaluate(e=>getComputedStyle(e,'::before').backdropFilter),'none');
   assert.equal(await p.locator(selector).first().evaluate(e=>getComputedStyle(e,'::after').backdropFilter),'none');
  }
  await p.screenshot({path:'artifacts/ui-current/chat-fade-no-blur.png'});
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('composer: cápsula e microfone redondos, fontes em linha e blur sem blocos',async()=>{
 const f=await fixture();const p=f.page;
 const sharp = require('sharp') as (input:Buffer)=>{removeAlpha():{raw():{toBuffer():Promise<Buffer>}}};
 const difference=async(a:Buffer,b:Buffer)=>{const first=await sharp(a).removeAlpha().raw().toBuffer(),second=await sharp(b).removeAlpha().raw().toBuffer();let changed=0;for(let i=0;i<first.length;i++)if(Math.abs(first[i]-second[i])>3)changed++;return changed;};
 try {
  await p.route('https://www.google.com/s2/favicons?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#168b94"/><circle cx="8" cy="8" r="4" fill="white"/></svg>'}));
  const sources=Array.from({length:6},(_,i)=>({url:'https://source'+i+'.example/report',domain:'source'+i+'.example',title:'Fonte '+i}));
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Teste visual'},active:false,before:null,turns:[{id:'visual-turn',created_at:'2026-10-14T12:00:00Z',message:'Confira as fontes',answer:'Resposta com seis fontes de pesquisa.',thinking:'',status:'completed',attachments:[],metadata:{research:{state:'complete',sources}}}]}}));
  await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?conversation=1'));
  await p.locator('.computer-sources').waitFor();
  await p.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('.computer-source-icons img')].every(i=>i.complete&&i.naturalWidth>0));
  for(const width of [1280,390]) {
   await p.setViewportSize({width,height:844});
   for(const theme of ['dark','light']) {
    await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const mode of ['.model-picker','.computer-provider']) {
     await p.locator('.provider-toggle '+mode).click();
     const geometry=await p.locator('.provider-toggle').evaluate(e=>{
      const group=e.getBoundingClientRect(),pill=e.querySelector('.provider-toggle__indicator')!,r=pill.getBoundingClientRect(),style=getComputedStyle(pill);
      const selected=e.querySelector('button[aria-pressed="true"]')!.getBoundingClientRect();
      return {gapTop:r.top-group.top,gapBottom:group.bottom-r.bottom,x:r.x-selected.x,width:r.width-selected.width,shape:style.getPropertyValue('corner-shape'),radius:parseFloat(style.borderTopLeftRadius),height:r.height,shadow:style.boxShadow};
     });
     assert.equal(geometry.gapTop,2);assert.equal(geometry.gapBottom,2);
     assert.ok(Math.abs(geometry.x)<1&&Math.abs(geometry.width)<1);
     assert.match(geometry.shape,/^(round|superellipse\(1\))$/);assert.ok(geometry.radius>=geometry.height/2);assert.equal(geometry.shadow,'none');
    }
    await p.locator('.home__input').fill('Mensagem de teste');
    await p.locator('.home__send').hover();
    assert.equal(await p.locator('.home__send .ui-arrow').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
    if(width===1280){
      const nav=p.locator('.sidebar__link[aria-label="Finanças"]');await nav.hover();const navColor=await nav.evaluate(e=>getComputedStyle(e).backgroundColor);
      const row=p.locator('.sidebar .sessions__row').first();await row.hover();assert.equal(await row.evaluate(e=>getComputedStyle(e).backgroundColor),navColor);
      if(theme==='dark')assert.equal(await p.locator('.sidebar').evaluate(e=>{const probe=document.createElement('span');probe.style.background='var(--sidebar-surface)';e.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return getComputedStyle(e).backgroundColor===expected;}),true);
    }
    await p.locator('.home__microphone').hover();
    const mic=await p.locator('.home__microphone').evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,radius:parseFloat(s.borderTopLeftRadius),shape:s.getPropertyValue('corner-shape')};});
    assert.equal(mic.width,mic.height);assert.ok(mic.radius>=mic.height/2);assert.match(mic.shape,/^(round|superellipse\(1\))$/);
    const source=await p.locator('.computer-sources').evaluate(e=>{const label=e.lastElementChild!,r=label.getBoundingClientRect(),button=e.getBoundingClientRect();return {height:r.height,line:parseFloat(getComputedStyle(label).lineHeight),right:r.right,buttonRight:button.right,whiteSpace:getComputedStyle(e).whiteSpace};});
    assert.equal(source.whiteSpace,'nowrap');assert.ok(source.height<=source.line+1);assert.ok(source.right<=source.buttonRight);
    const icons=await p.locator('.computer-source-icons img').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,shape:getComputedStyle(e).getPropertyValue('corner-shape')};}));
    assert.equal(icons.length,3);for(const icon of icons){assert.equal(icon.width,16);assert.equal(icon.height,16);assert.match(icon.shape,/^(round|superellipse\(1\))$/);}
    if(width<1100)assert.equal(await p.locator('.computer-sources-panel').evaluate(e=>getComputedStyle(e).borderTopLeftRadius),await p.locator('.sources-card').evaluate(e=>getComputedStyle(e).borderTopLeftRadius));
    await p.screenshot({path:'artifacts/ui-current/composer-rounded-'+width+'-'+theme+'.png'});
   }
  }
  await p.setViewportSize({width:1280,height:844});
  await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  await p.mouse.move(900,100);
  const r=await p.locator('.sidebar .sessions__link').first().boundingBox();assert.ok(r);
  const clip={x:r.x+r.width-26,y:r.y+8,width:20,height:20};
  const blurOn=await p.screenshot({clip});
  const disabled=await p.addStyleTag({content:'.sidebar .sessions__link::after {content:none!important}'});
  const blurOff=await p.screenshot({clip});await disabled.evaluate(e=>e.parentNode?.removeChild(e));
  assert.ok(await difference(blurOn,blurOff)<20,'blur must not paint a rectangle on an empty part of a short title');
  const group=p.locator('.provider-toggle'),groupBox=await group.boundingBox();assert.ok(groupBox);
  const shadowOn=await group.screenshot();
  const noShadow=await p.addStyleTag({content:'.provider-toggle__indicator {box-shadow:none!important}'});
  const shadowOff=await group.screenshot();await noShadow.evaluate(e=>e.parentNode?.removeChild(e));
  assert.equal(await difference(shadowOn,shadowOff),0,'capsule must have no shadow');
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.locator('.provider-toggle .model-picker').click();
  await p.waitForFunction(()=>{const group=document.querySelector('.provider-toggle')!,pill=group.querySelector('.provider-toggle__indicator')!.getBoundingClientRect(),selected=group.querySelector('button[aria-pressed="true"]')!.getBoundingClientRect();return Math.abs(pill.x-selected.x)<.1&&Math.abs(pill.width-selected.width)<.1;});
  await p.screenshot({path:'artifacts/ui-current/composer-capsule-final.png'});
  assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('não lido persiste e trocar de chat durante a resposta não solicita parada',async()=>{
 const f=await fixture(),p=f.page;let cancellations=0;
 try {
  await p.route('**/api/ai/chat/cancel',route=>{cancellations++;return route.fulfill({json:{stopped:true}});});
  await p.route('**/api/ai/conversations?*',route=>route.fulfill({json:{conversations:[{id:'1',title:'Primeira conversa',updated_at:'2026-10-14T12:00:00Z',last_response_at:'2026-10-14T12:00:00Z'},{id:'2',title:'Outra conversa',updated_at:'2026-10-13T12:00:00Z'}],next_offset:null}}));
  await p.route(/\/api\/ai\/conversations\/[12]$/,route=>{const id=route.request().url().split('/').pop();return route.fulfill({json:{conversation:{id,title:id==='1'?'Primeira conversa':'Outra conversa',last_response_at:'2026-10-14T12:00:00Z'},active:false,before:null,turns:[{id:'turn-'+id,message:'Pergunta '+id,answer:'Resposta concluída '+id,thinking:'',status:'completed',created_at:'2026-10-14T12:00:00Z',metadata:{}}]}});});
  await p.goto(nextServer.origin+'/novo.html?new=1');
  await p.evaluate(()=>{
   window.ComputerSessions.markRead('1','2026-10-14T12:00:00Z',true);
   window.ComputerService.prototype.chat=async(_payload:ChatRequest,onDelta:(text:string)=>void,signal:AbortSignal,_thinking:((text:string)=>void)|undefined,onConversation:((event:ConversationEvent)=>void)|undefined)=>new Promise<void>((_resolve,reject)=>{
    onConversation?.({type:'conversation',conversation_id:'1',turn_id:'active-turn',provider:'gemini'});onDelta('Resposta em andamento');
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
   });
  });
  await p.locator('.home__input').fill('Continue ao trocar');await p.locator('.home__send').click();
  await p.waitForFunction(()=>document.querySelector('.home__composer')?.classList.contains('is-responding'));
  await p.locator('.sidebar .sessions__row[data-id="2"] .sessions__link').click();
  await p.waitForFunction(()=>document.querySelector('.computer-message--assistant')?.textContent?.includes('Resposta concluída 2'));
  assert.equal(cancellations,0);
  await p.locator('.sidebar .sessions__row[data-id="1"] .sessions__more').click();
  await p.locator('.sessions-menu').getByRole('button',{name:'Marcar como não lida',exact:true}).click();
  assert.equal(await p.locator('.sidebar .sessions__row[data-id="1"] .sessions__unread').count(),1);
  await p.waitForTimeout(4300);
  assert.equal(await p.locator('.sidebar .sessions__row[data-id="1"] .sessions__unread').count(),1);
  await p.locator('.sidebar .sessions__row[data-id="1"] .sessions__link').click();
  await p.waitForFunction(()=>!document.querySelector('.sidebar .sessions__row[data-id="1"] .sessions__unread'));
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});


test('pesquisa dentro do pensamento preserva consultas e fontes ao concluir',async()=>{
 const f=await fixture();const p=f.page;
 try {
  const research={state:'complete',seconds:3,query:'Salários no Brasil',queries:['salários tecnologia Brasil','salários 2026'],sources:[{title:'Relatório',url:'https://example.com/report',domain:'example.com'}]};
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Pesquisa'},active:false,before:null,turns:[{id:'search-turn',message:'Pesquise salários',answer:'Resposta salva',thinking:'',created_at:'2026-10-15T12:00:00Z',status:'completed',metadata:{research}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  const thinking=p.locator('.computer-thinking');await thinking.locator(':scope > summary').click();
  const step=thinking.locator('.computer-research-step');assert.match(await step.locator('summary').textContent()||'',/Pesquisando 3 s/);
  assert.equal(await step.locator('li').count(),3);assert.equal(await step.locator('a').getAttribute('href'),'https://example.com/report');
  assert.equal(await p.locator('.computer-thinking__logo,.model-icon--ollama').count(),0);
  await p.evaluate(()=>window.ComputerResponseDetails.research(document.querySelector('.computer-message--assistant') as HTMLElement,{state:'complete',query:'Consulta',sources:Array.from({length:5},(_,i)=>({title:'Fonte '+i,url:'https://example.com/'+i,domain:'example.com'}))},true));
  assert.equal(await step.locator('.computer-research-source:visible').count(),3);
  await step.getByRole('button',{name:'+2 mais',exact:true}).click();
  assert.equal(await step.locator('.computer-research-source:visible').count(),5);
  await step.getByRole('button',{name:'Mostrar menos',exact:true}).click();
  assert.equal(await step.locator('.computer-research-source:visible').count(),3);
  assert.equal(await step.locator('ul').evaluate(e=>getComputedStyle(e).fontSize),'14px');
  await step.locator('summary').click();assert.equal(await step.locator('ul').isVisible(),false);await step.locator('summary').click();

  await p.evaluate(()=>window.ComputerResponseDetails.research(document.querySelector('.computer-message--assistant') as HTMLElement,{state:'searching',query:'Nova consulta',queries:['Nova consulta']}));
  assert.match(await step.locator('summary').textContent()||'',/Pesquisando/);
  assert.equal(await thinking.locator(':scope > summary > span').textContent(),'Pensando');
  await p.evaluate(()=>window.ComputerResponseDetails.research(document.querySelector('.computer-message--assistant') as HTMLElement,{state:'empty',query:'Nova consulta'},true));
  assert.match(await step.textContent()||'',/não retornou fontes/);
 } finally {await f.context.close();}
});


test('títulos laterais usam fade sem fundo e conversas usam 16px',async()=>{
 const f=await fixture();const p=f.page;
 try {
  const link=p.locator('.sidebar .sessions__link').first();
  await link.locator('.sessions__title > span').evaluate(e=>e.textContent='Um título muito longo para verificar o recorte do menu lateral sem blocos de cor');
  await link.hover();
  const title=link.locator('.sessions__title');
  assert.notEqual(await title.evaluate(e=>getComputedStyle(e).maskImage),'none');
  assert.equal(await link.evaluate(e=>getComputedStyle(e,'::after').content),'none');
  const textBox=await title.boundingBox(),moreBox=await link.locator('..').locator('.sessions__more').boundingBox();
  assert.ok(textBox&&moreBox&&textBox.x+textBox.width<=moreBox.x);
  assert.equal(await link.evaluate(e=>getComputedStyle(e).fontSize),'16px');
  await p.screenshot({path:path.join(root,'artifacts/ui-current/sidebar-title-fade.png')});
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Teste'},active:false,before:null,turns:[{id:'font-turn',message:'Pergunta',answer:'Resposta',thinking:'',created_at:'2026-10-15T12:00:00Z',status:'completed',metadata:{}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  await p.locator('.computer-message--assistant').waitFor();
  for(const selector of ['.computer-message--user .computer-message__text','.computer-message--assistant .computer-message__text','.home__input']) assert.equal(await p.locator(selector).first().evaluate(e=>getComputedStyle(e).fontSize),'16px');
 } finally {await f.context.close();}
});


test('respostas renderizam negrito seguro e preservam código e citações',async()=>{
 const f=await fixture();const p=f.page;
 try {
  const answer='**Política Social**: texto **com fonte [1]**. <img src=x onerror=alert(1)> '+String.fromCharCode(96)+'**código**'+String.fromCharCode(96)+' e **incompleto';
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Teste'},active:false,before:null,turns:[{id:'bold-turn',message:'Pergunta',answer,thinking:'',created_at:'2026-10-15T12:00:00Z',status:'completed',metadata:{research:{sources:[{title:'Fonte',url:'https://example.com/source',domain:'example.com'}]}}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  const body=p.locator('.computer-message--assistant > .computer-message__text');await body.waitFor();
  assert.deepEqual(await body.locator('strong').allTextContents(),['Política Social','com fonte [1]']);
  assert.equal(await body.locator('strong .computer-citation').getAttribute('href'),'https://example.com/source');
  assert.equal(await body.locator('img').count(),0);
  assert.ok((await body.textContent())?.includes('**código**'));
  assert.ok((await body.textContent())?.includes('**incompleto'));
  assert.equal(await body.locator('strong').first().evaluate(e=>getComputedStyle(e).fontWeight),'700');
 } finally {await f.context.close();}
});


test('OpenRouter: catálogo gratuito, preferência, anexos e envio com o modelo escolhido',async()=>{
 const f=await fixture();const p=f.page;
 try {
  const models=[{"id":"openrouter:nvidia/nemotron-3.5-super-vl:free","name":"Nemotron 3.5 Super VL","configured":true},{"id":"openrouter:nvidia/nemotron-3.5-lightning:free","name":"Nemotron 3.5 Lightning","configured":true},{"id":"openrouter:nvidia/nemotron-3.5-content-safety:free","name":"Nemotron 3.5 Content Safety","configured":true},{"id":"openrouter:nvidia/nemotron-3-ultra-550b-a55b:free","name":"Nemotron 3 Ultra 550B A55B","configured":true},{"id":"openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","name":"Nemotron 3 Nano Omni 30B A3B Reasoning","configured":true},{"id":"openrouter:nvidia/nemotron-3-super-120b-a12b:free","name":"Nemotron 3 Super 120B A12B","configured":true},{"id":"openrouter:thinkingmachines/inkling-small:free","name":"Inkling Small","configured":true},{"id":"openrouter:thinkingmachines/inkling:free","name":"Inkling","configured":true},{"id":"openrouter:cohere/north-mini-code:free","name":"North Mini Code","configured":true},{"id":"openrouter:google/gemma-4-26b-a4b-it:free","name":"Gemma 4 26B A4B","configured":true},{"id":"openrouter:google/gemma-4-31b-it:free","name":"Gemma 4 31B","configured":true},{"id":"qwen3:1.7b","name":"Local","configured":true}];
  await p.route('**/api/ai/models',route=>route.fulfill({json:{models,openrouter_configured:true,openrouter_error:null,default_remote_model:models[0].id,default_model:'qwen3:1.7b'}}));
  await p.goto(nextServer.origin+'/novo.html?new=1');
  await p.waitForFunction(()=>window.ComputerModels.selected()==='openrouter:nvidia/nemotron-3.5-super-vl:free');
  const trigger=p.locator('.local-model-picker');await trigger.click();
  assert.equal(await p.locator('.model-menu [data-provider]').count(),11);
  assert.equal(await trigger.locator('.model-icon').count(),0);
  assert.deepEqual(await p.locator('.model-company').allTextContents(),['NVIDIA','Thinking Machines','Cohere','Google']);
  assert.equal(await p.locator('.model-menu .model-icon--nvidia').count(),6);
  assert.equal(await p.locator('.model-menu .model-icon--gemini').count(),2);
  for(const icon of await p.locator('.model-menu .model-icon').all()) assert.ok((await icon.evaluate(el=>getComputedStyle(el).backgroundImage)).includes('.svg'));
  await p.locator('.model-menu [data-provider="openrouter:google/gemma-4-31b-it:free"]').click();
  assert.equal(await trigger.locator('.local-model-name').textContent(),'Gemma 4 31B');
  assert.equal(await p.evaluate(()=>window.ComputerModels.error()),'');
  await p.reload();await p.waitForFunction(()=>window.ComputerModels.selected()==='openrouter:google/gemma-4-31b-it:free');
  for(const width of [1280,390]) {await p.setViewportSize({width,height:844});await trigger.click();const bounds=await p.locator('.model-menu').boundingBox();assert.ok(bounds&&bounds.x>=12&&bounds.x+bounds.width<=width-12);await p.screenshot({path:path.join(root,'artifacts/ui-current/openrouter-models-'+width+'.png')});await p.keyboard.press('Escape');}
  await p.route('**/api/ai/attachments',route=>route.fulfill({json:{id:'a'.repeat(32),name:'documento.txt',kind:'file',size:5}}));
  await p.locator('#attachment-input').setInputFiles({name:'documento.txt',mimeType:'text/plain',buffer:Buffer.from('teste')});
  await p.waitForFunction(()=>window.ComputerAttachments.files().length===1);assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'openrouter:google/gemma-4-31b-it:free');
  let sent:Record<string,unknown>|undefined;
  await p.route('**/api/ai/chat',route=>{sent=testObject(route.request().postDataJSON());return route.fulfill({contentType:'application/x-ndjson',body:[{type:'conversation',conversation_id:'1',turn_id:'test-turn',provider:'openrouter:google/gemma-4-31b-it:free'},{type:'delta',text:'Resposta do modelo escolhido'},{type:'done',metadata:{provider:'openrouter:google/gemma-4-31b-it:free'}}].map(v=>JSON.stringify(v)).join('\n')+'\n'});});
  await p.locator('.home__input').fill('Olá');await p.locator('.home__send').click();await p.waitForFunction(()=>document.querySelector('.computer-message--assistant .computer-message__text')?.textContent==='Resposta do modelo escolhido');
  assert.equal(sent?.provider,'openrouter:google/gemma-4-31b-it:free');assert.deepEqual(sent?.attachments,['a'.repeat(32)]);assert.deepEqual(f.errors,[]);
 } finally {await f.context.close();}
});


test('falha de autenticação mantém a causa no histórico',async()=>{
 const f=await fixture();const p=f.page;
 try {
  await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Falha'},active:false,before:null,turns:[{id:'failed-turn',message:'Olá',answer:'',thinking:'',created_at:'2026-10-15T12:00:00Z',status:'failed',metadata:{error_code:'provider_auth',error:'A chave deste modelo não foi aceita. Confira a configuração da API.'}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  await p.getByText('A chave deste modelo não foi aceita. Confira a configuração da API.',{exact:true}).waitFor();
  assert.equal(await p.getByText('Resposta interrompida. O conteúdo salvo não foi incluído no contexto das próximas mensagens.',{exact:true}).count(),0);
 } finally {await f.context.close();}
});


test('novo chat: cápsula animada e ícones dos modos em ambos os temas e tamanhos',async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.goto(nextServer.origin+'/novo.html?new=1');
  await p.waitForFunction(()=>window.ComputerModels && !window.ComputerModels.error());
  const fonts=await p.evaluate(async()=>{
   const text=await document.fonts.load('16px "PPLX Sans"');
   const display=await document.fonts.load('24px "PPLX Serif"');
   return [text.length,display.length,text[0]?.status,display[0]?.status];
  });
  assert.deepEqual(fonts,[1,1,'loaded','loaded']);
  for(const width of [1280,390]) for(const theme of ['dark','light']) {
   await p.setViewportSize({width,height:844});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const mode of ['Pesquisar','Computer']) {
    await p.getByRole('button',{name:'Usar '+mode,exact:true}).click();
    await p.waitForTimeout(450);
    const buttons=p.locator('.home__composer .provider-toggle > button');
    assert.deepEqual((await buttons.allTextContents()).map(t=>t.trim()),['Pesquisar','Computer']);
    assert.equal(await buttons.filter({hasText:mode}).getAttribute('aria-pressed'),'true');
    const geometry=await p.locator('.home__composer .provider-toggle').evaluate(el=>{
     const group=el.getBoundingClientRect(),pill=el.querySelector('.provider-toggle__indicator')!,r=pill.getBoundingClientRect(),selected=el.querySelector('[aria-pressed="true"]')!.getBoundingClientRect();
     const icons=[...el.querySelectorAll<HTMLElement>('.provider-toggle__content > i')].map(i=>({width:i.getBoundingClientRect().width,display:getComputedStyle(i).display,mask:getComputedStyle(i).maskImage}));
     return {gap:r.top-group.top,width:r.width-selected.width,x:r.x-selected.x,icons};
    });
    assert.equal(geometry.gap,2);assert.ok(Math.abs(geometry.width)<1 && Math.abs(geometry.x)<1);
    for(const icon of geometry.icons){assert.equal(icon.width,16);assert.notEqual(icon.display,'none');assert.notEqual(icon.mask,'none');}
    assert.equal(await p.evaluate(()=>window.ComputerModels.selected().startsWith('qwen')),mode==='Computer');
    await p.screenshot({path:path.join(root,'artifacts/ui-current/mode-switch-'+width+'-'+theme+'-'+mode+'.png')});
   }
  }
  await p.emulateMedia({reducedMotion:'no-preference'});
  const progress=await p.evaluate(async()=>{
   const group=document.querySelector<HTMLElement>('.home__composer .provider-toggle')!;
   group.querySelector<HTMLButtonElement>('.model-picker')!.click();
   const values:number[]=[];for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);values.push(Number(group.style.getPropertyValue('--provider-progress')));}
   return values;
  });
  assert.ok(progress.some(v=>v>0.01&&v<0.99),'capsule must animate between modes');
  assert.ok(progress.at(-1)!<0.01,'capsule must settle on Pesquisa');
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});


test('chat: tipografia PPLX, metadados abaixo e duração compacta',async()=>{
 const f=await fixture(),p=f.page;
 try{
  const turns=[100,3661,40].map((seconds,i)=>({id:String(i+1),created_at:'2026-10-15T12:00:00Z',message:'Mensagem de teste',answer:'Resposta de teste',thinking:'Análise',status:'completed',metadata:{thinking_seconds:seconds,research:{state:'complete',sources:[{url:'https://example.com',title:'Fonte',domain:'example.com'}]}}}));
  await p.route('**/api/ai/conversations/1',r=>r.fulfill({json:{conversation:{id:'1',title:'Teste'},active:false,before:null,turns}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  await p.locator('.computer-message--assistant').first().waitFor();
  for(const label of ['Pensou por 1m 40s','Pensou por 1h 1m 1s','Pensou por 40s'])assert.ok(await p.getByText(label,{exact:true}).count());
  for(const width of [1280,390]){
   await p.setViewportSize({width,height:844});
   const user=p.locator('.computer-message--user').first();await user.hover();
   const b=await user.boundingBox(),a=await user.locator('.computer-user-actions').boundingBox();assert.ok(b&&a&&a.y>=b.y+b.height-1&&Math.abs(a.x+a.width-b.x-b.width)<2);
   for(const sel of ['.computer-user-time','.response-time','.computer-sources'])for(const size of await p.locator(sel).evaluateAll(es=>es.map(e=>getComputedStyle(e).fontSize)))assert.equal(size,'12px');
   assert.match(await p.locator('.computer-message--assistant > .computer-message__text').first().evaluate(e=>getComputedStyle(e).fontFamily),/PPLX Serif/);
   await p.screenshot({path:path.join(root,'artifacts/ui-current/restored-chat-'+width+'.png')});
  }
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});


test('Markdown: títulos, código literal e ícone Novo visível',async()=>{
 const f=await fixture(),p=f.page;
 try{
  const answer='### Dados **verificáveis**:\nTexto <img src=x onerror=alert(1)>\n\n### Considerações:\nTexto\n\n'+String.fromCharCode(96).repeat(3)+'txt\n### Código literal\n'+String.fromCharCode(96).repeat(3);
  await p.route('**/api/ai/conversations/1',r=>r.fulfill({json:{conversation:{id:'1',title:'Teste'},active:false,before:null,turns:[{id:'1',created_at:'2026-10-15T12:00:00Z',message:'Teste',answer,thinking:'',status:'completed',metadata:{}}]}}));
  await p.goto(nextServer.origin+'/novo.html?conversation=1');
  const body=p.locator('.computer-message--assistant > .computer-message__text');await body.waitFor();
  assert.deepEqual(await body.locator('h3').allTextContents(),['Dados verificáveis:','Considerações:']);
  assert.equal(await body.locator('h3 strong').textContent(),'verificáveis');assert.equal(await body.locator('img').count(),0);
  assert.ok((await body.textContent())?.includes('### Código literal'));
  const icons=await p.locator('.sidebar__new-icon,.sidebar__finance-icon').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,mask:getComputedStyle(e).maskImage};}));
  assert.ok(icons[0].w>0&&icons[0].h>0);assert.equal(icons[0].w,icons[1].w);assert.equal(icons[0].h,icons[1].h);assert.notEqual(icons[0].mask,'none');
  await p.screenshot({path:path.join(root,'artifacts/ui-current/markdown-heading-icons.png')});assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});


test('perfil: alternar modo anônimo mantém o menu aberto',async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.locator('.sidebar__profile').click();
  for(const enabled of [true,false,true,false]){
   await p.getByRole('switch',{name:'Modo anônimo'}).click();
   await p.waitForFunction(value=>document.querySelector('.profile-anonymous')?.getAttribute('aria-checked')===String(value),enabled);
   await p.waitForFunction(()=>document.querySelector('#profile-menu')?.matches(':popover-open'));
   assert.equal(await p.locator('.sidebar__profile').getAttribute('aria-expanded'),'true');
  }
  await p.keyboard.press('Escape');assert.equal(await p.locator('#profile-menu').evaluate(e=>e.matches(':popover-open')),false);
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});

test('sidebar: degradês únicos só nas bordas com conteúdo fora da vista',async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.locator('.sidebar__nav').evaluate(nav=>{
   const list=nav.querySelector('#recent-chats')!;
   const row=list.querySelector('.sessions__row')!;
   for(let index=0;index<20;index++)list.append(row.cloneNode(true));
   nav.scrollTop=0;
  });
  await p.waitForFunction(()=>document.querySelector('.sidebar')?.classList.contains('has-nav-overflow'));
  assert.equal(await p.locator('.sidebar').evaluate(e=>e.classList.contains('is-nav-scrolled')),false);
  for(const selector of ['.sidebar__new-chat','.sidebar__footer']){
   for(const pseudo of ['::before','::after'])assert.equal(await p.locator(selector).evaluate((e,pseudo)=>getComputedStyle(e,pseudo).content,pseudo),'none');
  }
  await p.locator('.sidebar__nav').evaluate(e=>e.scrollTop=100);
  await p.waitForFunction(()=>document.querySelector('.sidebar')?.classList.contains('is-nav-scrolled'));
  await p.screenshot({path:path.join(root,'artifacts/ui-current/sidebar-single-fade.png')});
  await p.locator('.sidebar__nav').evaluate(e=>e.scrollTop=e.scrollHeight);
  await p.waitForFunction(()=>!document.querySelector('.sidebar')?.classList.contains('has-nav-overflow'));
  await p.locator('.sidebar__nav').evaluate(e=>e.scrollTop=0);
  await p.waitForFunction(()=>!document.querySelector('.sidebar')?.classList.contains('is-nav-scrolled'));
  assert.deepEqual(f.errors,[]);
 }finally{await f.context.close();}
});
