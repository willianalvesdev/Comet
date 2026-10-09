import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {execFileSync} from 'node:child_process';
import {test,before,after} from 'node:test';
import {chromium,type Browser} from 'playwright';
const root = path.resolve(__dirname, '../..');
const python = process.env.PYTHON || path.join(root, process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python');
const pages:Record<string,string> = stringPages(JSON.parse(execFileSync(python, ['-c', `import json
from pathlib import Path
from comet import next_page_html
print(json.dumps({name+'.html':next_page_html(Path('out'),name,{'page':name,'user':None if name=='index' else {'id':7,'nome':'Teste','email':'teste@example.com'},'csrfToken':'test-csrf','currentYear':2026}) for name in ['recentes','computer','graficos','descobrir','aprender','index']}))`], {cwd:root, encoding:'utf8', env:{...process.env, PYTHONIOENCODING:'utf-8'}})));

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
        if(url.searchParams.has('_rsc') || url.pathname.endsWith('.txt')) {
            const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index';
            const exported=path.join(root,'out',relative.endsWith('.txt')?relative:relative+'.txt');
            if(fs.existsSync(exported))return route.fulfill({contentType:'text/x-component',body:fs.readFileSync(exported)});
        }
        if(url.pathname==='/' || url.pathname.endsWith('.html')) return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[url.pathname.slice(1)||'index.html'] || pages['recentes.html']});
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
        if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true},{id:'qwen3:4b',configured:true},{id:'qwen3:8b',configured:true},{id:'qwen3:4b-instruct-2507-q4_K_M',configured:true}]}});
        if(url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
        const file=path.join(root,url.pathname.startsWith('/_next/')?'out':'',decodeURIComponent(url.pathname));
        if(fs.existsSync(file) && fs.statSync(file).isFile()) {
            const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.otf':'font/otf'};
            return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
        }
        return route.fulfill({status:404,body:''});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const goto=page.goto.bind(page), reload=page.reload.bind(page);
    const mounted=()=>page.waitForFunction(()=>document.querySelector('#workspace-page, .auth'));
    page.goto=async (...args)=>{const response=await goto(...args);await mounted();return response;};
    page.reload=async (...args)=>{const response=await reload(...args);await mounted();return response;};
    await page.goto('https://comet.test/recentes.html');
    await page.waitForFunction(()=>requiredElement(document, ".recent-chats__list", HTMLElement).getAttribute('aria-busy')==='false');
    return {page,context,errors,requests,failDeletion:()=>{failDelete=true;},allowDeletion:()=>{failDelete=false;}};
}
test('recentes: cabeçalho recolhe, atalho navega e seleção usa os SVGs corretos',async()=>{
    const f=await fixture();const p=f.page;
    try {
        assert.equal(await p.locator('.recent-chats__row').count(),3);
        if(process.env.QA_DESKTOP)await p.screenshot({path:process.env.QA_DESKTOP});
        await p.locator('.sessions__heading[aria-controls="recent-chats"]').click();
        await p.waitForFunction(()=>requiredElement(document, ".sessions__heading[aria-controls=\"recent-chats\"]", HTMLButtonElement).getAttribute('aria-expanded')==='false');
        assert.equal(await p.locator('.sessions__heading[aria-controls="recent-chats"]').getAttribute('aria-expanded'),'false');
        assert.equal(await p.locator('a.sessions__visit').getAttribute('href'),'/recentes.html');
        await p.locator('a.sessions__visit').click();
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
        await p.goto('https://comet.test/recentes.html?return=1');
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
        assert.equal(await p.locator('.sidebar__new-chat .sidebar__link').first().evaluate(e=>e.getBoundingClientRect().height),40);
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
        for(const selector of ['.model-picker','.home__microphone','.sessions__heading']) {
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
            window.CometChart.setData({points,currency:'BRL'});
            window.CometChart.setData({points:points.map(p=>({...p,close:p.close+5})),currency:'BRL'});
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
        assert.equal(await p.locator('.sources-card__title').textContent(),'Fonte de teste');
        assert.equal(await p.locator('.sources-card__source p, .sources-card__source small').count(),0);
        const source=p.locator('.sources-card__source');
        assert.equal(await source.evaluate(e=>e.getBoundingClientRect().height),52);
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
        await p.goto('https://comet.test/computer.html?conversation=1');
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


test('Comet: pesquisa web, fontes e histórico financeiro recolhível', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.goto('https://comet.test/computer.html');
        await p.waitForFunction(() => !requiredElement(document, '.home__input', HTMLTextAreaElement).readOnly);
        await p.locator('.attachment-toggle').click();
        const web = p.locator('.web-search-toggle');
        assert.equal(await web.getAttribute('aria-pressed'), 'true');
        await web.click(); assert.equal(await web.getAttribute('aria-pressed'), 'false');
        assert.equal(await p.locator('.attachment-menu p').count(), 0);
        assert.match(await web.locator('i').evaluate(e => getComputedStyle(e).maskImage), /settings-settings-search(?:\.[\w-]+)?\.svg/);
        assert(!await p.evaluate(() => [...document.fonts].some(font => /Serrif|Geist/i.test(font.family))));
        await p.goto('https://comet.test/graficos.html');
        const toggle = p.locator('.finance-panel-toggle'), history = p.locator('#finance-history-panel');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.locator('.chart-range[data-range="MAX"]').click();
        assert.equal(await p.locator('.chart-statistics dd').count(), 6);
        assert.match(await p.locator('[data-chart-stat="closing"]').innerText(), /120,00/);
        assert.match(await p.locator('[data-chart-stat="volume"]').innerText(), /120,00/);
        await p.locator('.chart-range[data-range="MAX"]').hover();
        assert(!(await p.locator('#chart-tooltip').isVisible()));
        const chart = p.locator('.finance-chart-column');
        const width = await chart.evaluate(e => e.getBoundingClientRect().width);
        await toggle.click(); assert(!(await history.isVisible()));
        await p.waitForFunction(() => {
            const chart = document.querySelector('.finance-chart-column')?.getBoundingClientRect();
            const composer = document.querySelector('.finance-composer')?.getBoundingClientRect();
            return chart && composer && Math.abs(chart.left - composer.left) < 1 && Math.abs(chart.width - composer.width) < 1;
        });
        assert(Math.abs(await chart.evaluate(e => e.getBoundingClientRect().width) - width) < 1);
        await toggle.click(); assert(await history.isVisible());
        await p.route('**/api/finance/transactions', route => route.fulfill({json:{transactions:[],next_cursor:null}}));
        await p.reload();
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        assert(!(await history.isVisible()));
        assert(!(await toggle.isVisible()));
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

test('finanças: planilha usa dados reais, compartilha período e volta ao gráfico', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.goto('https://comet.test/graficos.html');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.locator('[data-range="MAX"]').click();
        await p.getByRole('button', {name:'Planilha',exact:true}).click();
        const rows = p.locator('.finance-sheet tbody tr');
        assert.equal(await rows.count(), 2);
        assert.match(await rows.first().locator('td').nth(3).innerText(), /120,00/);
        assert.match(await rows.first().locator('td').nth(4).innerText(), /20,00/);
        assert(!(await p.locator('.chart-stage').isVisible()));
        assert(!(await p.locator('.market-summary').isVisible()));
        assert(!(await p.locator('.chart-statistics').isVisible()));
        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 1 de 1');
        assert(await p.locator('[data-sheet-page="next"]').isDisabled());
        await p.locator('[data-range="1D"]').click();
        assert.equal(await rows.count(), 1);
        await p.screenshot({path:path.join(root,'artifacts/finance-sheet-desktop.png')});
        await p.setViewportSize({width:390,height:844});
        assert(await p.locator('.finance-sheet').isVisible());
        assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await p.locator('.finance-sheet').evaluate(sheet => {
            const scroller = document.querySelector('.workspace__content');
            if (scroller) scroller.scrollTop += sheet.getBoundingClientRect().top - 180;
        });
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await p.screenshot({path:path.join(root,'artifacts/finance-sheet-mobile.png')});
        await p.getByRole('button', {name:'Gráfico',exact:true}).click();
        assert(await p.locator('.chart-stage').isVisible());
        assert.equal(await p.locator('[data-range="1D"]').getAttribute('aria-pressed'), 'true');
        await p.evaluate(() => window.CometChart.setData({kind:'balance',currency:'BRL',points:[],demo:false}));
        await p.getByRole('button', {name:'Planilha',exact:true}).click();
        assert.equal(await rows.count(), 0);
        assert(await p.locator('.finance-sheet-empty').isVisible());
        await p.evaluate(() => window.CometChart.setData({kind:'balance', currency:'BRL', points:Array.from({length:25}, (_, index) => ({time:(1700000000 + index * 86400) as import('lightweight-charts').UTCTimestamp,open:index,high:index+1,low:index,close:index+1,volume:1})),demo:false}));
        await p.locator('[data-range="MAX"]').click();
        assert.equal(await rows.count(), 10);
        assert(!(await p.locator('.chart-wordmark').isVisible()));
        assert(await p.locator('.finance-sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await p.locator('.finance-sheet').evaluate(sheet => {
            const scroller = document.querySelector('.workspace__content');
            if (scroller) scroller.scrollTop += sheet.getBoundingClientRect().top + 80;
        });
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const sticky = await p.evaluate(() => ({
            header: document.querySelector('.workspace__header')?.getBoundingClientRect().bottom ?? 0,
            toolbar: document.querySelector('.chart-toolbar')?.getBoundingClientRect().top ?? 0,
            toolbarBottom: document.querySelector('.chart-toolbar')?.getBoundingClientRect().bottom ?? 0,
            columns: document.querySelector('.finance-sheet thead th')?.getBoundingClientRect().top ?? 0
        }));
        assert(Math.abs(sticky.toolbar - sticky.header) < 2, JSON.stringify(sticky));
        assert(Math.abs(sticky.columns - sticky.toolbarBottom) < 2);
        await p.screenshot({path:path.join(root,'artifacts/finance-sheet-sticky-mobile.png')});

        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 1 de 3');
        await p.locator('[data-sheet-page="next"]').click();
        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 2 de 3');
        await p.locator('[data-sheet-page="next"]').click();
        assert.equal(await rows.count(), 5);
        assert(await p.locator('[data-sheet-page="next"]').isDisabled());
        await p.locator('[data-sheet-page="previous"]').click();
        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 2 de 3');
        await p.locator('[data-sheet-page="first"]').click();
        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 1 de 3');
        await p.locator('[data-sheet-page="next"]').click();
        await p.locator('[data-range="1D"]').click();
        assert.equal(await p.locator('.finance-sheet-page-label').innerText(), 'Página 1 de 1');
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('gráfico: hover livre por minuto e cartão abaixo do cursor', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.goto('https://comet.test/graficos.html');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.evaluate(() => window.CometChart.setData({currency:'BRL',kind:'balance',points:Array.from({length:4}, (_,i) => ({time:(1700000000+i*86400) as import('lightweight-charts').UTCTimestamp,open:i,close:i+1,low:i,high:i+1,volume:10}))}));
        await p.locator('[data-range="MAX"]').click();
        await p.locator('#market-chart').scrollIntoViewIfNeeded();
        const box = await p.locator('#market-chart').boundingBox(); assert(box);
        const x = box.x + box.width * .4, y = box.y + 100;
        await p.mouse.move(x,y);
        const tooltip = p.locator('#chart-tooltip');
        await tooltip.waitFor({state:'visible'});
        assert.deepEqual(await tooltip.locator('dt').allTextContents(), ['Fechar','Abrir','Máxima','Mínima','Volume']);
        assert.equal(await tooltip.locator('dd').count(), 5);
        assert(!(await p.locator('.chart-selection-result').isVisible()));
        const closing = await tooltip.locator('[data-tooltip-value="close"]').innerText();
        const first = await tooltip.locator('time').innerText();
        const firstLine = await p.locator('.chart-hover-line').evaluate(el => el.getBoundingClientRect().left);
        await p.mouse.move(x+2,y);
        assert.notEqual(await tooltip.locator('time').innerText(), first);
        assert.equal(await tooltip.locator('[data-tooltip-value="close"]').innerText(), closing);
        const secondLine = await p.locator('.chart-hover-line').evaluate(el => el.getBoundingClientRect().left);
        assert(Math.abs(secondLine-firstLine-2)<1);
        const tip = await tooltip.boundingBox(); assert(tip);
        assert(tip.x > x && tip.y > y);
        await p.mouse.wheel(0, -100);
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await p.mouse.move(box.x + 4, box.y + 20);
        const axisClip = {x:box.x, y:box.y + 80, width:50, height:200};
        const axisBefore = await p.screenshot({clip:axisClip});
        await p.mouse.move(x, y);
        await p.mouse.down();
        await p.mouse.move(x, y+80, {steps:5});
        await p.mouse.up();
        await p.mouse.move(box.x + 4, box.y + 20);
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.deepEqual(await p.screenshot({clip:axisClip}), axisBefore);

        await p.locator('[data-range="MAX"]').hover();
        assert(!(await tooltip.isVisible()));
        assert(!(await p.locator('.chart-hover-line').isVisible()));
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

test('gráfico: horários não se repetem e zoom preserva a escala lateral', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.addInitScript(() => {
            let frame = 0;
            const tick = () => { frame++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
            const draw = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
                const labels: string[] = this.canvas.dataset.frame === String(frame) ? JSON.parse(this.canvas.dataset.labels || '[]') : [];
                labels.push(text); this.canvas.dataset.frame = String(frame); this.canvas.dataset.labels = JSON.stringify(labels);
                if (maxWidth === undefined) draw.call(this,text,x,y); else draw.call(this,text,x,y,maxWidth);
            };
        });
        await p.goto('https://comet.test/graficos.html');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.evaluate(() => {
            const clocks = ['08:00:00','08:00:00','09:15:00','09:15:00','00:05:00'];
            const movements = [-100,-70,-90,-40,-20].map((close,i,values) => {
                const open = i ? values[i-1] : 0, occurred_on = i === 4 ? '2026-10-02' : '2026-10-01';
                return {time:chartTimestamp(Date.parse(occurred_on+'T'+clocks[i]+'-03:00')/1000),occurred_on,occurred_time:clocks[i],open,close,low:Math.min(open,close),high:Math.max(open,close),volume:Math.abs(close-open)};
            });
            window.CometChart.setData({kind:'balance',points:[{time:chartTimestamp(Date.UTC(2026,9,1)/1000),open:0,high:0,low:-100,close:-40,volume:200},{time:chartTimestamp(Date.UTC(2026,9,2)/1000),open:-40,high:-20,low:-40,close:-20,volume:20}],movements});
        });
        await p.locator('[data-range="MAX"]').click();
        const host = p.locator('#market-chart'); await host.scrollIntoViewIfNeeded();
        const box = await host.boundingBox(); assert(box);
        assert(box.height < 325);
        await p.mouse.move(box.x+2,box.y+5);
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const labels = await p.locator('#market-chart tr:last-child canvas').evaluateAll(canvases => canvases.flatMap(canvas => JSON.parse(canvas.getAttribute('data-labels') || '[]')) as string[]);
        const nonempty = labels.filter(label => label.trim());
        assert(nonempty.some(label => label.includes('08:00')), JSON.stringify(nonempty));
        assert.equal(new Set(nonempty).size,nonempty.length,JSON.stringify(nonempty));
        assert(!nonempty.some(label => label.includes('1970')));
        const clip = {x:box.x,y:box.y+60,width:50,height:box.height-95};
        const before = await p.screenshot({clip});
        await p.mouse.move(box.x+box.width*.7,box.y+130); await p.mouse.wheel(0,-300);
        await p.mouse.move(box.x+2,box.y+5);
        await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.deepEqual(await p.screenshot({clip}),before);
        await p.screenshot({path:path.join(root,'artifacts/finance-clock-zoom.png')});
        assert.deepEqual(f.errors,[]);
    } finally { await f.context.close(); }
});

test('gráfico: seleção compara saldos e escala evita intervalos mínimos', async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.addInitScript(() => {
            const draw = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
                const labels: string[] = JSON.parse(this.canvas.dataset.testLabels || '[]');
                labels.push(text); this.canvas.dataset.testLabels = JSON.stringify(labels.slice(-100));
                if (maxWidth === undefined) draw.call(this, text, x, y); else draw.call(this, text, x, y, maxWidth);
            };
        });
        await p.goto('https://comet.test/graficos.html');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        const setValues = async (values: number[]) => {
            await p.evaluate(values => window.CometChart.setData({currency:'BRL',kind:'balance',points:values.map((value,i) => ({time:(1700000000+i*86400) as import('lightweight-charts').UTCTimestamp,open:value,close:value,low:value,high:value,volume:10}))}), values);
            await p.locator('[data-range="MAX"]').click();
            await p.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        };
        await setValues([100,110,90,130]);
        await p.locator('#market-chart').scrollIntoViewIfNeeded();
        const box = await p.locator('#market-chart').boundingBox(); assert(box);
        const left = box.x+95, right=box.x+box.width-10, y=box.y+120;
        const result = p.locator('.chart-selection-result');
        const drag = async (from:number,to:number) => { await p.mouse.move(from,y); await p.mouse.down(); await p.mouse.move(to,y,{steps:8}); };
        await drag(left,right);
        assert.match(await result.innerText(), /Ganho:.*30,00.*30%/);
        assert.equal(await p.locator('.chart-hover-line').evaluate(e => getComputedStyle(e).borderLeftColor), await result.evaluate(e => getComputedStyle(e).color));
        assert(await p.locator('.chart-selection-band').isVisible());
        await p.screenshot({path:path.join(root,'artifacts/finance-selection.png')});
        await p.mouse.up();
        await drag(right,left);
        assert.match(await result.innerText(), /Ganho:.*30,00.*30%/);
        await p.mouse.up();
        await setValues([100,90,80,70]);
        await drag(left,right);
        assert.match(await result.innerText(), /Perda:.*30,00.*-30%/);
        await p.mouse.up();
        await setValues([0,10,30,50]);
        await drag(left,right);
        assert.match(await result.innerText(), /Ganho:.*50,00/);
        assert(!/NaN|Infinity|%/.test(await result.innerText()));
        await p.mouse.up();
        await setValues([-1010,-1010,-1010,-1010]);
        await drag(left,right);
        assert.match(await result.innerText(), /Sem variação/);
        await p.mouse.up();
        const labels = await p.locator('#market-chart canvas').evaluateAll(canvases => canvases.flatMap(canvas => JSON.parse(canvas.getAttribute('data-test-labels') || '[]')));
        const prices = labels.filter((label:unknown):label is string => typeof label === 'string').map(label => Number(label.replaceAll('.','').replace(',','.'))).filter(value => value < -900 && value > -1100);
        assert(prices.length > 2);
        assert(Math.max(...prices)-Math.min(...prices) >= 10);
        await p.mouse.move((left+right)/2,y); await p.mouse.wheel(0,-150);
        await p.locator('[data-range="MAX"]').hover();
        assert(!(await result.isVisible()));
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});


test('gráfico: cada transação aparece mesmo no mesmo dia e com saldo negativo', async () => {
    const f = await fixture(), p = f.page;
    try {
        const day = Date.UTC(2026,9,1)/1000;
        const movements = [-100,-70,-90,-40].map((close,i,values) => {
            const open = i ? values[i-1] : 0;
            return {time:day,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:Math.abs(close-open)};
        });
        const points = [{time:day,open:0,close:-40,high:0,low:-100,volume:200}, {time:day+86400,open:-40,close:-40,high:-40,low:-40,volume:0}];
        await p.route('**/api/finance/dashboard', route => route.fulfill({json:{as_of:'2026-10-02',summary:Object.fromEntries(['balance','income','expense'].map(key => [key,{amount:key==='balance'?'-40.00':key==='income'?'80.00':'120.00',difference:'0.00',percentage:null,series:[0,-40]}])),chart:{currency:'BRL',kind:'balance',points,movements,intraday:[]}}}));
        await p.goto('https://comet.test/graficos.html');
        await p.waitForFunction(() => document.querySelector('.finance-page')?.getAttribute('aria-busy') === 'false');
        await p.locator('[data-range="MAX"]').click();
        const host = p.locator('#market-chart');
        await host.scrollIntoViewIfNeeded();
        await host.focus();
        await host.press('Home');
        assert.match(await p.locator('#market-price').innerText(), /0,00/);
        for (const value of ['100,00','70,00','90,00','40,00']) {
            await host.press('ArrowRight');
            assert.match(await p.locator('#market-price').innerText(), new RegExp('-R\\$.*'+value));
        }
        const box = await host.boundingBox(); assert(box);
        const y = box.y+100;
        const positions = new Map<number,number>();
        for (let x=box.x+70; x<box.x+box.width-5; x+=12) {
            await p.mouse.move(x,y);
            const label = await p.locator('#chart-tooltip time').innerText();
            const match = label.match(/Movimentação (\d+)/);
            if (match && !positions.has(Number(match[1]))) positions.set(Number(match[1]),x);
        }
        assert.deepEqual([...positions.keys()], [1,2,3,4]);
        assert(!/UTC|1970/.test(await p.locator('#chart-tooltip time').innerText()));
        const drag = async (from:number,to:number) => {
            const fromX = positions.get(from), toX = positions.get(to);
            assert(fromX !== undefined && toX !== undefined);
            await p.mouse.move(fromX,y); await p.mouse.down();
            await p.mouse.move(toX,y);
            assert.match(await p.locator('.chart-selection-result').innerText(), /Ganho:.*30,00.*30%/);
            await p.mouse.up();
        };
        await drag(1,2); await drag(2,1);
        await p.mouse.move(box.x+4,box.y+10);
        await p.screenshot({path:path.join(root,'artifacts/finance-transactions.png')});
        await p.locator('[data-finance-view="sheet"]').click();
        assert.equal(await p.locator('.finance-sheet tbody tr').count(),2);
        assert.match(await p.locator('.finance-sheet tbody tr').last().innerText(), /200,00/);
        await p.locator('[data-range="1D"]').click();
        assert.equal(await p.locator('.finance-sheet tbody tr').count(),2);
        assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
});

for (const width of [1920, 1280, 390]) test(`aprender: lista e envio com pesquisa e anexo (${width})`, async () => {
    const f = await fixture(width), p = f.page;
    try {
        await p.goto('https://comet.test/aprender.html');
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
        await p.locator('.sidebar__link[href="./aprender.html"]').click();
        await p.locator('.computer-provider').click();
        await p.locator('.local-model-picker').click();
        await p.locator('[data-provider="qwen3:4b"]').click();
        const request = p.waitForRequest('**/api/ai/chat');
        await p.route('**/api/ai/chat', route => route.fulfill({contentType:'application/x-ndjson',body:'{"type":"delta","text":"Estudo"}\n{"type":"done","metadata":{}}\n'}));
        await p.locator('.study-composer textarea').fill('Explique a gravidade');
        await p.locator('.study-composer textarea').press('Enter');
        const payload = testObject((await request).postDataJSON());
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
        await p.goto('https://comet.test/aprender.html');
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
        await f.page.goto('https://comet.test/aprender.html');
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
        await p.locator('.sessions__preferences').click();
        await p.waitForFunction(()=>document.activeElement?.hasAttribute('data-order'));
        await p.keyboard.press('End');
        assert.equal(await p.locator(':focus').getAttribute('data-order'), 'activity');
        await p.keyboard.press('Escape');
        await p.goto('https://comet.test/computer.html');
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
        await p.goto('https://comet.test/computer.html?new=1');
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
                    await p.goto('https://comet.test/'+name+'.html');
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
        await f.context.route('**/api/news?*',route=>route.fulfill({json:{page:1,has_more:false,articles:Array.from({length:4},(_,i)=>({id:String(i),title:'Águias e grandes projetos: notícias de tecnologia e ciência',description:'Pesquisas e descobertas para entender o mundo.',url:'https://example.com/'+i,image:'https://comet.test/audit-cover.svg',published_at:'2026-10-08T10:00:00Z',source:'Exemplo',sources:[{name:'Exemplo',url:'https://example.com'}]}))}}));
        await p.goto('https://comet.test/descobrir.html');
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


test('fontes: topo fixo, scroll interno discreto e brilho do ditado dentro da caixa',async()=>{
    const f=await fixture(1600);const p=f.page;
    try {
        const research={state:'complete',query:'consulta',sources:Array.from({length:20},(_,i)=>({title:'Fonte de pesquisa '+i,url:'https://example.com/report/'+i,domain:'example.com',excerpt:'Trecho detalhado da fonte para consultar as informações que foram usadas na resposta.'}))};
        await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Histórico',created_at:'2026-09-30',updated_at:'2026-09-30'},active:false,before:null,turns:[{id:'turn-1',message:'Analise',answer:'Resposta salva',thinking:'',created_at:'2026-09-30T12:00:00Z',status:'completed',metadata:{research}}]}}));
        await p.goto('https://comet.test/computer.html?conversation=1');
        await p.locator('.computer-sources').click();
        const list=p.locator('.sources-card__list'), heading=p.locator('.sources-card > summary');
        const top=await heading.evaluate(e=>e.getBoundingClientRect().top);
        assert.equal(await p.locator('.computer-sources-panel').evaluate(e=>e.getBoundingClientRect().height),384);
        assert.equal(await heading.evaluate(e=>getComputedStyle(e).padding),'16px 8px');
        assert(await list.evaluate(e=>e.scrollHeight>e.clientHeight));
        await list.evaluate(e=>e.scrollTop=200);
        await p.waitForFunction(()=>document.querySelector('.sources-card__list')?.classList.contains('is-scrolled'));
        assert.equal(await heading.evaluate(e=>e.getBoundingClientRect().top),top);
        assert.equal(await p.locator('.computer-sources-panel').evaluate(e=>e.scrollTop),0);
        assert.equal(await list.evaluate(e=>getComputedStyle(e,'::-webkit-scrollbar').width),'4px');
        assert.equal(await list.evaluate(e=>getComputedStyle(e).getPropertyValue('--sources-fade-top').trim()),'2rem');
        assert(await p.locator('.computer-sources-panel').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
        await p.waitForFunction(()=>{
            const page=requiredElement(document,'.computer-page',HTMLElement), composer=requiredElement(document,'.computer-composer',HTMLElement);
            return Math.abs(page.getBoundingClientRect().left+parseFloat(getComputedStyle(page).paddingLeft)-composer.getBoundingClientRect().left)<1;
        });
        await p.screenshot({path:'artifacts/sources-fixed-header.png'});
        await heading.click();assert(!await list.isVisible());await heading.click();assert(await list.isVisible());
        for(const width of [1600,390]) {
            await p.setViewportSize({width,height:800});
            assert(await p.locator('.computer-sources-panel').evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.getBoundingClientRect().bottom<=innerHeight));
        }
        await p.locator('.home__composer').evaluate(e=>e.classList.add('is-dictating'));
        const inset=await p.locator('.home__composer').evaluate(e=>getComputedStyle(e,'::after').inset);
        assert.equal(inset,'1px');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('fontes: últimas fontes automáticas e painel oculto no novo chat',async()=>{
    const f=await fixture(1600);const p=f.page;
    try {
        await p.goto('https://comet.test/computer.html?new=1');
        const panel=p.locator('.computer-sources-panel'),toggle=p.locator('.sources-panel-toggle');
        assert(!await toggle.isVisible());assert(!await panel.isVisible());
        await p.route('**/api/ai/conversations/1',route=>route.fulfill({json:{conversation:{id:'1',title:'Histórico',created_at:'2026-09-30',updated_at:'2026-09-30'},active:false,before:null,turns:[1,2].map(i=>({id:'turn-'+i,message:'Analise '+i,answer:'Resposta '+i,thinking:'',created_at:'2026-09-30T12:00:00Z',status:'completed',metadata:{research:{state:'complete',sources:[{title:'Fonte '+i,url:'https://example.com/'+i,domain:'example.com',excerpt:'Trecho '+i}]}}}))}}));
        await p.goto('https://comet.test/computer.html?conversation=1');
        await p.waitForFunction(()=>document.querySelector('.sources-card__title')?.textContent==='Fonte 2');
        assert(await panel.isVisible());
        assert.equal(await p.locator('.chat-links__title').textContent(),'Fonte 2');
        await p.evaluate(()=>{
            const article=document.querySelectorAll<HTMLElement>('.computer-message--assistant')[1];
            window.ComputerResponseDetails.research(article,{state:'empty',sources:[]},true);
        });
        assert.equal(await p.locator('.sources-card__title').textContent(),'Fonte 2');
        assert.equal(await p.locator('.chat-links__title').textContent(),'Fonte 2');
        await p.reload();
        await p.waitForFunction(()=>document.querySelector('.sources-card__title')?.textContent==='Fonte 2');
        assert(await panel.isVisible());assert.equal(await panel.evaluate(e=>e.getBoundingClientRect().height),384);
        await p.locator('[data-chat-view="links"]').click();assert(await toggle.isVisible());
        await toggle.click();assert(!await panel.isVisible());await toggle.click();assert(await panel.isVisible());
        await p.goto('https://comet.test/computer.html?new=1');
        await p.waitForFunction(()=>document.querySelector('.sources-card--empty'));
        assert(!await panel.isVisible());assert(!await toggle.isVisible());assert.equal(await p.locator('.sources-card__source').count(),0);
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});


test('aprender: altura acompanha largura e fontes sem precisar digitar', async () => {
    const f=await fixture(1600),p=f.page;
    try {
        await p.goto('https://comet.test/aprender.html');
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
            await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
            assert.equal(await p.locator('.sources-panel-toggle').count(),1);
            await p.evaluate(()=>window.WorkspaceNavigation.go('/aprender.html'));
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

test('Next: cadastro mantém idade e CSRF no formulário', async () => {
    const f=await fixture(),p=f.page;
    try {
        await p.goto('https://comet.test/index.html');
        await p.locator('[data-auth-open="signup"]').click();
        assert.deepEqual(f.errors,[]);
        const form=p.locator('[data-auth-panel=signup] form');
        assert(await form.isVisible());
        assert.equal(await form.locator('[name="csrf_token"]').inputValue(),'test-csrf');
        assert.equal(await form.locator('[name="age"]').count(),1);
        assert.equal(await p.locator('.auth__form--login [name="age"]').count(),0);
        await p.locator('.auth__close').click();
        assert(!await p.locator('.auth').isVisible());
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});

test('Next: logo e novo chat repetido preservam navegação e sessão', async () => {
    const f=await fixture(),p=f.page;
    try {
        await p.locator('.sidebar').evaluate(e=>{(e as HTMLElement).dataset.navigationMarker='preserved';});
        await p.locator('.sidebar__logo').click();
        await p.waitForFunction(()=>document.querySelector('.computer-page') && !document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        assert.equal(new URL(p.url()).pathname,'/computer.html');
        for(let i=0;i<2;i++) {
            await p.evaluate(()=>window.WorkspaceNavigation.go('/computer.html?new=1'));
            await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        }
        await p.evaluate(()=>window.WorkspaceNavigation.go('/aprender.html'));
        await p.goBack();
        await p.locator('.computer-page').waitFor();
        assert.equal(await p.locator('.sidebar').getAttribute('data-navigation-marker'),'preserved');
        assert.deepEqual(f.errors,[]);
    } finally {await f.context.close();}
});
