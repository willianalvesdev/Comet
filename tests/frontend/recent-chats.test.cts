import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {execFileSync} from 'node:child_process';
import {test,before,after} from 'node:test';
import {chromium,type Browser} from 'playwright';
const root = path.resolve(__dirname, '../..');
const python = process.env.PYTHON || path.join(root, process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
const pages:Record<string,string> = stringPages(JSON.parse(execFileSync(python, ['-c', `import json
from jinja2 import Environment,FileSystemLoader,select_autoescape
env=Environment(loader=FileSystemLoader('templates'),autoescape=select_autoescape(['html']))
print(json.dumps({name:env.get_template(name).render(user={'id':7,'nome':'Teste','email':'teste@example.com'},csrf_token=lambda:'test-csrf') for name in ['recentes.html','computer.html','graficos.html','descobrir.html']}))`], {cwd:root, encoding:'utf8', env:{...process.env, PYTHONIOENCODING:'utf-8'}})));

function testObject(value:unknown):Record<string,unknown> {
 if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Invalid test data');
 return value as Record<string,unknown>;
}
function stringPages(value:unknown):Record<string,string> {
 return Object.fromEntries(Object.entries(testObject(value)).map(([key,value])=>{assert.equal(typeof value,'string');if(typeof value!=='string')throw new Error('Invalid page');return [key,value];}));
}
let browser: Browser;
before(async () => { browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--hide-scrollbars']}); });
after(async () => browser.close());
async function fixture(width = 1280) {
    const context = await browser.newContext({viewport:{width,height:800}, reducedMotion:'reduce'});
    await context.addInitScript(() => {localStorage.setItem('ascenda-cookie-choice-v1','accepted');if(!localStorage.getItem('ascensao-theme'))localStorage.setItem('ascensao-theme','dark');});
    let chats = [
        {id:'1',title:'Primeira conversa',updated_at:'2026-09-28T12:00:00Z'},
        {id:'2',title:'Outra conversa',updated_at:'2026-09-29T12:00:00Z'},
        {id:'3',title:'Conversa antiga',updated_at:'2026-09-20T12:00:00Z'}
    ];
    const errors:string[]=[], requests:{id:string;csrf:string}[]=[]; let failDelete = false;
    await context.route('**/*', async route => {
        const request=route.request(), url=new URL(request.url());
        if(url.pathname.endsWith('.html')) return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[url.pathname.slice(1)] || pages['recentes.html']});
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
        if(url.pathname==='/api/finance/dashboard') return route.fulfill({json:{summary:Object.fromEntries(['balance','income','expense'].map(key=>[key,{amount:key==='expense'?'20.00':'100.00',difference:'10.00',percentage:'10.00',series:[0,50,100]}])),chart:{currency:'BRL',kind:'balance',points:[{time:1670000000,open:0,high:100,low:0,close:100,volume:100},{time:1700100000,open:100,high:120,low:100,close:120,volume:20}],intraday:[]}}});
        if(url.pathname==='/api/finance/transactions')return route.fulfill({json:{transactions:[{id:'1',description:'Salário real',kind:'income',amount:'100.00',occurred_on:'2026-09-01',category:'Trabalho'}],next_cursor:null}});
        if(url.pathname==='/api/news')return route.fulfill({json:{articles:[],has_more:false,page:1}});
        if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:4b-instruct-2507-q4_K_M',configured:true}]}});
        if(url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
        const file=path.join(root,decodeURIComponent(url.pathname));
        if(fs.existsSync(file) && fs.statSync(file).isFile()) {
            const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.otf':'font/otf'};
            return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
        }
        return route.fulfill({status:404,body:''});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://ascenda.test/recentes.html');
    await page.waitForFunction(()=>requiredElement(document, ".recent-chats__list", HTMLElement).getAttribute('aria-busy')==='false');
    return {page,context,errors,requests,failDeletion:()=>{failDelete=true;},allowDeletion:()=>{failDelete=false;}};
}
test('recentes: seta recolhe, texto navega e seleção parcial/total usa os SVGs corretos',async()=>{
    const f=await fixture();const p=f.page;
    try {
        assert.equal(await p.locator('.recent-chats__row').count(),3);
        if(process.env.QA_DESKTOP)await p.screenshot({path:process.env.QA_DESKTOP});
        await p.locator('.sessions__collapse[aria-controls="recent-chats"]').click();
        await p.waitForFunction(()=>requiredElement(document, ".sessions__collapse[aria-controls=\"recent-chats\"]", HTMLButtonElement).getAttribute('aria-expanded')==='false');
        assert.equal(await p.locator('.sessions__collapse[aria-controls="recent-chats"]').getAttribute('aria-expanded'),'false');
        assert.equal(await p.locator('a.sessions__heading').getAttribute('href'),'/recentes.html');
        await p.locator('a.sessions__heading').click();
        await p.waitForFunction(()=>optionalElement(document, ".recent-chats__row", HTMLElement));
        await p.locator('.recent-chats__row input').first().check();
        assert(await p.locator('#select-all-chats').evaluate(e=>e instanceof HTMLInputElement && e.indeterminate));
        assert.match(await p.locator('#select-all-chats').evaluate(e=>getComputedStyle(e,'::before').maskImage),/selected-partial.svg/);
        await p.locator('#select-all-chats').check();
        assert.equal(await p.locator('#recent-chats-title').textContent(),'3 selecionado(s)');
        assert.match(await p.locator('#select-all-chats').evaluate(e=>getComputedStyle(e,'::before').maskImage),/check.svg/);
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
        await p.locator('.recent-chats__sort select').selectOption('oldest');
        assert.equal(await p.locator('.recent-chats__name').first().textContent(),'Conversa antiga');
        await p.locator('.recent-chats__search-toggle').click();await p.locator('#recent-chats-search').fill('Primeira');
        assert.equal(await p.locator('.recent-chats__row').count(),1);
        await p.locator('.recent-chats__row').hover();await p.locator('.recent-chats__more').click();await p.locator('#sessions-menu [data-action="pin"]').click();
        assert.equal(await p.locator('.recent-chats__filter').count(),0);
        await p.mouse.move(800,400);
        assert.equal(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).opacity),'1');
        assert.match(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).maskImage),/pinned-filled.svg/);
        assert.equal(await p.locator('.recent-chats__row').count(),1);
        await p.locator('.recent-chats__row').hover();
        assert.equal(await p.locator('.recent-chats__pin').evaluate(e=>getComputedStyle(e).opacity),'0');
        await p.locator('.recent-chats__more').click();await p.locator('#sessions-menu [data-action="rename"]').click();
        await p.locator('.sessions-dialog input[name="title"]').fill('Novo nome');await p.locator('.sessions-dialog [data-confirm]').click();
        await p.waitForFunction(()=>!requiredElement(document, ".sessions-dialog:not(.recent-chats__confirm)", HTMLDialogElement).open);
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

test('fixados: só a seta recolhe e a navegação preserva o estado da lateral', async () => {
    const f = await fixture(); const p = f.page;
    try {
        await p.locator('.recent-chats__row').first().hover();
        await p.locator('.recent-chats__more').first().click();
        await p.locator('#sessions-menu [data-action="pin"]').click();
        const pinned = p.locator('.sessions').filter({has:p.locator('#pinned-chats')});
        await pinned.locator('.sessions__heading').click();
        assert(await pinned.evaluate(e=>e instanceof HTMLDetailsElement && e.open));
        await pinned.locator('.sessions__collapse').click();
        assert(!await pinned.evaluate(e=>e instanceof HTMLDetailsElement && e.open));
        await p.locator('.sessions__collapse[aria-controls="recent-chats"]').click();
        await p.locator('.sidebar__toggle').click();
        await p.goto('https://ascenda.test/recentes.html?return=1');
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
        for (const [href, selector] of [['/computer.html?new=1','.computer-page'],['/graficos.html','#market-chart'],['/descobrir.html','.news-page'],['/recentes.html','.recent-chats'],['/computer.html?new=1','.computer-page']]) {
            await p.evaluate(href=>window.WorkspaceNavigation.go(href),href);
            assert(await p.locator(selector).isVisible());
            assert(await p.evaluate(()=>window.originalSidebar===optionalElement(document, ".sidebar", HTMLElement) && window.originalDocument===document));
        }
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        assert(!await p.locator('.sources-panel-toggle').isVisible());
        assert.equal(await p.locator('.sidebar__new-chat .sidebar__link').evaluate(e=>e.getBoundingClientRect().height),40);
        assert.equal(await p.locator('.computer-intro h1').evaluate(e=>getComputedStyle(e).flexDirection),'row');
        await p.locator('.anonymous-toggle').click();
        assert.equal(await p.locator('.home__composer').evaluate(e=>getComputedStyle(e).borderTopStyle),'dashed');
        assert(await p.locator('.workspace__content').evaluate(e=>e.scrollHeight<=e.clientHeight));
        await p.locator('.anonymous-close').click();
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
        await p.locator('.sidebar a[href="./graficos.html"]').click();
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
        await p.route('**/api/ai/chat', route=>route.fulfill({contentType:'application/x-ndjson',body:[{type:'delta',text:'Uma resposta longa para verificar a rolagem. '.repeat(700)},{type:'done',metadata:{}}].map(value=>JSON.stringify(value)).join('\n')+'\n'}));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        await p.evaluate(()=>document.documentElement.style.setProperty('--response-characters-per-second','5000'));
        await p.locator('.home__input').fill('Teste de rolagem');
        await p.locator('.home__send').click();
        await p.waitForFunction(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTop>300);
        assert(!await p.locator('.computer-message__actions').last().isVisible());
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollHeight-requiredElement(document, ".workspace__content", HTMLElement).scrollTop-requiredElement(document, ".workspace__content", HTMLElement).clientHeight<10));
        await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTo({top:100,behavior:'instant'}));
        const length=await p.locator('.computer-response-reveal').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+node.textContent.length,0));
        await p.waitForFunction(length=>[...elementList(document, ".computer-response-reveal", HTMLElement)].reduce((sum,node)=>sum+node.textContent.length,0)>length+2000,length);
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTop<120));
        await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollTo({top:requiredElement(document, ".workspace__content", HTMLElement).scrollHeight,behavior:'instant'}));
        await p.waitForFunction(()=>!requiredElement(document, ".home__input", HTMLTextAreaElement).readOnly);
        assert(await p.locator('.computer-message__actions').last().isVisible());
        assert(await p.evaluate(()=>requiredElement(document, ".workspace__content", HTMLElement).scrollHeight-requiredElement(document, ".workspace__content", HTMLElement).scrollTop-requiredElement(document, ".workspace__content", HTMLElement).clientHeight<10));
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('preferência de provedor e modelo persiste entre páginas e recargas', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
        await p.waitForFunction(()=>!requiredElement(document, ".computer-provider", HTMLButtonElement).disabled);
        await p.locator('.computer-provider').click();
        assert.equal(await p.evaluate(()=>window.ComputerModels.selected()),'qwen3:1.7b');
        assert.equal(await p.locator('.model-menu [data-provider]').last().getAttribute('data-provider'),'qwen3:4b-instruct-2507-q4_K_M');
        await p.locator('.local-model-picker').click();
        await p.locator('.model-menu [data-provider="qwen3:8b"]').click();
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recentes.html'));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
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


test('carregar histórico não esmaece os controles ao entrar no chat', async () => {
    const f=await fixture();const p=f.page;
    let release:()=>void=()=>{throw new Error("Uninitialized resolver");};
    const pending=new Promise<void>(resolve=>release=resolve);
    try {
        await p.route('**/api/ai/conversations?offset=0',async route=>{await pending;await route.fulfill({json:{conversations:[],next_offset:null}});});
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
        assert(await p.locator('.model-picker').isDisabled());
        for(const selector of ['.model-picker','.home__microphone','.sessions__collapse']) {
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
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
        const greeting=await p.locator('[data-chat-greeting]').textContent();
        await p.reload();
        await p.waitForFunction(()=>window.ComputerModels);
        assert.equal(await p.locator('[data-chat-greeting]').textContent(),greeting);
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recentes.html'));
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
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

test('finanças anima valor e variação ao abrir e mudar período', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.emulateMedia({reducedMotion:'no-preference'});
        await p.evaluate(async()=>{await window.WorkspaceNavigation.go('/graficos.html');});
        await p.waitForFunction(()=>requiredElement(document, ".finance-page", HTMLElement).getAttribute('aria-busy')==='false');
        assert.equal(await p.locator('#market-change').getAttribute('data-trend'),'neutral');
        assert.match(await p.locator('#market-change').textContent() ?? '',/0,00/);
        assert.equal(await p.locator('#market-price').evaluate(e=>e.getAnimations({subtree:true}).length),0);
        await p.waitForFunction(()=>optionalElement(document, "#market-price .market-digit", HTMLElement));
        await p.waitForFunction(()=>elementList(document, ".market-digit > span", HTMLElement).length===0);
        assert.equal(await p.locator('.finance-tabs').count(),0);
        await p.locator('[data-range="5Y"]').click();
        assert.notEqual(await p.locator('#market-change').getAttribute('data-trend'),'neutral');
        await p.waitForFunction(()=>optionalElement(document, "#market-change .market-digit", HTMLElement));
        await p.waitForFunction(()=>elementList(document, ".market-digit > span", HTMLElement).length===0);
        const result=await p.evaluate(()=>{
            const points=[{time:chartTimestamp(1700000000),open:100,high:120,low:90,close:110,volume:100},{time:chartTimestamp(1700100000),open:110,high:130,low:100,close:120,volume:120}];
            window.AscendaChart.setData({points,currency:'BRL'});
            window.AscendaChart.setData({points:points.map(p=>({...p,close:p.close+5})),currency:'BRL'});
            return {text:requiredElement(document, "#market-price", HTMLElement).textContent,animations:requiredElement(document, "#market-price", HTMLElement).getAnimations({subtree:true}).length};
        });
        assert.match(result.text,/125,00/);
        assert.equal(result.animations,0);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('finanças exibe dados recebidos e estados vazios sem demonstrações', async () => {
    const f=await fixture();const p=f.page;
    try {
        await p.evaluate(()=>window.WorkspaceNavigation.go('/graficos.html'));
        await p.waitForFunction(()=>requiredElement(document, ".finance-page", HTMLElement).getAttribute('aria-busy')==='false');
        assert.match(await p.locator('[data-finance-total="balance"] .finance-total__values p').textContent() ?? '',/100,00/);
        assert.equal(await p.locator('.transfer-row').count(),1);
        assert.match(await p.locator('.transfer-row').textContent() ?? '',/Salário real/);
        assert.equal(await p.locator('script[src*="chart-demo"]').count(),0);
        await p.route('**/api/finance/transactions',route=>route.fulfill({json:{transactions:[],next_cursor:null}}));
        await p.route('**/api/finance/dashboard',route=>route.fulfill({json:{summary:Object.fromEntries(['balance','income','expense'].map(key=>[key,{amount:'0.00',difference:'0.00',percentage:null,series:[0]}])),chart:{currency:'BRL',kind:'balance',points:[],intraday:[]}}}));
        await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));
        await p.waitForFunction(()=>requiredElement(document, ".finance-page", HTMLElement).getAttribute('aria-busy')==='false');
        assert.equal(await p.locator('.transfer-row').count(),0);
        assert.match(await p.locator('.finance-status').textContent() ?? '',/Nenhuma transação/);
        assert(!await p.locator('.transfer-more').isVisible());
        assert.match(await p.locator('[data-finance-total="balance"] .finance-total__values p').textContent() ?? '',/0,00/);
        assert(!await p.locator('#chart-state').isVisible());
        assert.equal(await p.locator('.finance-total--zero').count(),3);
        assert.deepEqual(await p.locator('.finance-total__change').allTextContents(),['0%','0%','0%']);
        assert.equal(await p.locator('.market-change').getAttribute('data-trend'),'neutral');
        assert.match(await p.locator('.market-change').textContent() ?? '',/0,00.*0%/);
        assert(await p.locator('#market-chart canvas').count() > 0);
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
        await p.evaluate(()=>window.WorkspaceNavigation.go('/graficos.html'));
        await p.waitForFunction(()=>requiredElement(document, ".finance-page", HTMLElement).getAttribute('aria-busy')==='false');
        await p.locator('.transfer-more').click();
        await p.waitForFunction(()=>elementList(document, ".transfer-row", HTMLElement).length===2);
        assert.match(await p.locator('.transfer-row').last().textContent() ?? '',/Mercado/);
        assert(!await p.locator('.transfer-more').isVisible());
        await p.route('**/api/finance/dashboard',route=>route.fulfill({status:503,json:{error:'Banco indisponível'}}));
        await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));
        await p.waitForFunction(()=>requiredElement(document, ".finance-status", HTMLElement).textContent==='Banco indisponível');
        assert.match(await p.locator('[data-finance-total="balance"] .finance-total__values p').textContent() ?? '',/100,00/);
        assert.match(await p.locator('.finance-total__comparison').first().textContent() ?? '',/indisponíveis/);
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
        await p.evaluate(()=>window.WorkspaceNavigation.go('/graficos.html'));
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
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
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
        await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?conversation=1'));
        await p.waitForFunction(()=>!requiredElement(document,'.home__input',HTMLTextAreaElement).readOnly);
        assert.equal(await p.locator('.attachment-chip__name').textContent(),'documento.txt');
        assert.equal(await p.locator('.computer-message--assistant .computer-message__text').textContent(),'Resposta salva');
        await p.locator('.computer-sources').click();
        assert.match(await p.locator('.sources-card__source').textContent() ?? '',/Trecho da fonte/);
        assert.match(await p.locator('.sources-card__source small').textContent() ?? '',/aprox/);
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
