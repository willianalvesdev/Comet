import assert = require('node:assert/strict');
import path = require('node:path');
import {test, before, after} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {startNextServer} from './next-server.cjs';
const root = path.resolve(__dirname, '../..');
let browser: Browser, server: Awaited<ReturnType<typeof startNextServer>>;
before(async () => {
    server = await startNextServer(root);
    browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
});
after(async () => { await browser?.close(); await server?.stop(); });
async function fixture(options: {failList?:boolean; delay?:number} = {}) {
    const context = await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    await context.addInitScript(() => {if(window===window.top)localStorage.setItem('ascenda-cookie-choice-v1','accepted');});
    const requests:string[] = [], errors:string[] = [];
    const chats:Conversation[] = ['1','2','3'].map(id => ({id,title:'Conversa '+id,created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:00:00Z'}));
    const histories = new Map<string, ConversationHistory>(chats.map(conversation => [conversation.id, {conversation,before:null,active:false,turns:Array.from({length:20}, (_,i) => ({id:conversation.id+'-'+i,message:'Pergunta '+i,answer:'Resposta '+conversation.id+' '+i+' '+('Texto para conferir rolagem. '.repeat(20)),thinking:'',status:'completed' as const,created_at:conversation.created_at,metadata:{}}))} satisfies ConversationHistory]));
    let delay = options.delay || 0, failList = !!options.failList, user = 7;
    await context.route('**/*', async route => {
        const req=route.request(),url=new URL(req.url());
        if (url.pathname.startsWith('/api/')) requests.push(req.method()+' '+url.pathname+url.search);
        if (url.pathname === '/api/bootstrap') return route.fulfill({json:{page:url.searchParams.get('page'),user:{id:user,nome:'Teste',email:'teste@example.com'},csrfToken:'test',currentYear:2026}});
        if (url.pathname === '/api/ai/models') return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true}]}});
        if (url.pathname === '/api/ai/personalization') return route.fulfill({json:{name:'Teste'}});
        if (url.pathname === '/api/ai/conversations') return route.fulfill(failList ? {status:503,json:{error:'Lista indisponível'}} : {json:{conversations:chats,next_offset:null}});
        const match=url.pathname.match(/^\/api\/ai\/conversations\/(\d+)$/);
        if (match && req.method()==='GET') {
            const value=structuredClone(histories.get(match[1]));
            if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
            return route.fulfill(value ? {json:value} : {status:404,json:{error:'Conversa removida'}}).catch(()=>{});
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
        if (url.origin===server.origin) return route.continue();
        return route.fulfill({status:404,body:''});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);if(process.env.ARTIFACT_QA)console.error('Browser error:',e.message);});
    await page.goto(server.origin+'/novo.html?conversation=1');
    await page.locator('.computer-message--assistant').first().waitFor();
    await page.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
    return {page,context,requests,errors,histories,chats,setDelay:(ms:number)=>{delay=ms;},setUser:(id:number)=>{user=id;},failList:(value:boolean)=>{failList=value;},close:async()=>{await context.unrouteAll({behavior:'wait'});await context.close();}};
}
async function open(page: import('playwright').Page, id:string) {
    await page.evaluate(id=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id}})),id);
    await page.waitForFunction(id=>document.querySelector('.computer-message--assistant')?.getAttribute('data-turn')===id+'-0',id);
}

test('compartilhamento: painel, permissões, cópia do link e tamanho responsivo',async()=>{
    const f=await fixture(),p=f.page;let access='restricted';
    try {
        await p.context().grantPermissions(['clipboard-read','clipboard-write']);
        await p.route('**/conversations/1/sharing',async route=>{if(route.request().method()==='PATCH')access=route.request().postDataJSON().access;await route.fulfill({json:{access,is_owner:true,owner:{id:'7',name:'Teste',email:'teste@example.com'},members:[],requests:[]}});});
        await p.locator('.chat-share-toggle').click();await p.getByRole('radio',{name:'Qualquer pessoa com o link pode visualizar'}).waitFor();
        assert.equal(Math.round((await p.locator('.chat-sharing').boundingBox())!.width),576);
        const invite=p.locator('.chat-sharing__invite');let invited='';
        await p.route('**/conversations/1/sharing/members',async route=>{invited=route.request().postDataJSON().email;await route.fulfill({json:{}});});
        await invite.getByRole('combobox').fill('destinatario@example.invalid');await invite.getByRole('option',{name:'Convidar destinatario@example.invalid'}).click();
        assert.equal(await invite.locator('.sharing-email-chip').isVisible(),true);await invite.getByRole('button',{name:'Compartilhar',exact:true}).click();
        await p.waitForFunction(()=>!document.querySelector('.chat-sharing')?.hasAttribute('aria-busy'));assert.equal(invited,'destinatario@example.invalid');
        if(process.env.ARTIFACT_QA)await p.screenshot({path:path.join(root,'artifacts','sharing-panel.png')});
        await p.getByRole('radio',{name:'Qualquer pessoa com o link pode visualizar'}).click();
        await p.waitForFunction(()=>document.querySelectorAll('.chat-sharing [role="radio"]')[1]?.getAttribute('aria-checked')==='true');assert.equal(access,'public');
        await p.getByRole('button',{name:'Copiar link',exact:true}).click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),server.origin+'/chat/1');
        await p.setViewportSize({width:390,height:844});assert.ok((await p.locator('.chat-sharing').boundingBox())!.width<=358);
        await p.keyboard.press('Escape');assert.equal(await p.locator('.chat-sharing').evaluate(e=>e.matches(':popover-open')),false);
        assert.deepEqual(f.errors,[]);
    }finally{await f.close();}
});

test('compartilhamento: visualizador não edita e perde o conteúdo após revogação',async()=>{
    const f=await fixture(),p=f.page;let revoked=false;
    try {
        f.histories.get('2')!.conversation.is_owner=false;
        await p.route('**/conversations/2',route=>route.fulfill(revoked?{status:403,json:{error:'Esta conversa é privada.',code:'conversation_private'}}:{json:f.histories.get('2')}));
        await p.route('**/conversations/2/sharing',route=>route.fulfill({json:{access:'restricted',is_owner:false,requested:false}}));
        await p.route('**/conversations/2/access-request',route=>route.fulfill({json:{requested:true}}));
        await open(p,'2');assert.equal(await p.locator('.chat-shared-notice').isVisible(),true);assert.equal(await p.locator('.computer-rewrite').first().isVisible(),false);
        assert.equal(await p.getByRole('button',{name:'Editar',exact:true}).first().isVisible(),false);
        revoked=true;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
        await p.getByRole('heading',{name:'Esta resposta é privada'}).waitFor();assert.equal(await p.locator('.computer-message--assistant').count(),0);
        await p.getByRole('button',{name:'Solicitar acesso',exact:true}).click();await p.getByRole('button',{name:'Acesso solicitado',exact:true}).waitFor();assert.deepEqual(f.errors,[]);
    }finally{await f.close();}
});

test('compartilhamento: visitante lê sessão pública e mantém destino ao entrar',async()=>{
    const f=await fixture(),p=f.page;
    try{
        await p.route('**/api/bootstrap?*',route=>route.fulfill({status:401,json:{error:'Entre na sua conta.'}}));
        await p.route('**/api/shared/conversations/1',route=>route.fulfill({json:f.histories.get('1')}));
        await p.reload();await p.getByRole('link',{name:'Entre para continuar esta conversa'}).waitFor();
        assert.equal(await p.locator('.shared-conversation__turn').count(),20);await p.getByRole('link',{name:'Entre para continuar esta conversa'}).click();
        assert.equal(await p.evaluate(()=>sessionStorage.getItem('comet-login-return')),'/chat/1');assert.deepEqual(f.errors,[]);
    }finally{await f.close();}
});

test('compartilhamento: seguimento cria cópia privada e envia apenas na cópia',async()=>{
    const f=await fixture(),p=f.page;let forks=0;
    try{
        f.histories.get('2')!.conversation.is_owner=false;
        await p.route('**/conversations/2/fork',route=>{forks++;return route.fulfill({json:{conversation:f.histories.get('3')!.conversation}});});
        let payload:Record<string,unknown>|undefined;
        await p.route('**/api/ai/chat',async route=>{payload=route.request().postDataJSON();await route.fulfill({contentType:'application/x-ndjson',body:[{type:'conversation',conversation_id:'3',turn_id:'new-turn',provider:'gemini'},{type:'delta',text:'Seguimento privado'},{type:'done',metadata:{provider:'gemini'}}].map(v=>JSON.stringify(v)).join('\n')+'\n'});});
        await open(p,'2');await p.locator('.home__input').fill('Minha pergunta privada');await p.locator('.home__send').click();await p.getByText('Seguimento privado',{exact:true}).waitFor();
        assert.equal(new URL(p.url()).pathname,'/chat/3');assert.equal(payload?.conversation_id,'3');assert.equal(payload?.message,'Minha pergunta privada');assert.equal(await p.locator('.chat-shared-notice').isVisible(),false);assert.equal(forks,1);assert.deepEqual(f.errors,[]);
    }finally{await f.close();}
});
test('cache: voltar ao chat não busca de novo e restaura rascunho, anexos e rolagem', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.locator('.home__input').fill('Rascunho da primeira');
        await p.evaluate(()=>window.ComputerAttachments.restore([{id:'a'.repeat(32),name:'arquivo.txt',size:10,kind:'file'}]));
        await p.locator('.workspace__content').evaluate(e=>{e.scrollTop=250;e.dispatchEvent(new Event('scroll'));});
        await p.waitForTimeout(100);
        const top=await p.locator('.workspace__content').evaluate(e=>e.scrollTop);
        await open(p,'2'); await p.locator('.home__input').fill('Rascunho da segunda');
        await open(p,'1'); await p.waitForTimeout(100);
        assert.equal(await p.locator('.home__input').inputValue(),'Rascunho da primeira');
        assert.equal(await p.evaluate(()=>window.ComputerAttachments.files()[0]?.name),'arquivo.txt');
        assert.ok(Math.abs(await p.locator('.workspace__content').evaluate(e=>e.scrollTop)-top)<3);
        await open(p,'2'); assert.equal(await p.locator('.home__input').inputValue(),'Rascunho da segunda');
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/conversations/1').length,1);
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/conversations/2').length,1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('navegação: último clique prevalece e respostas tardias não substituem a seleção', async()=>{
    const f=await fixture(),p=f.page;
    try {
        f.setDelay(350);
        await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'2'}})));
        assert.equal(new URL(p.url()).pathname,'/chat/2');
        await open(p,'3'); await p.waitForTimeout(400);
        assert.equal(new URL(p.url()).pathname,'/chat/3');
        assert.match(await p.locator('.computer-message--assistant').first().textContent() || '',/^Resposta 3/);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('histórico abre mesmo com lista indisponível', async()=>{
    const f=await fixture({failList:true});
    try {assert.equal(await f.page.locator('.computer-message--assistant').count(),20);assert.deepEqual(f.errors,[]);}
    finally {await f.close();}
});
test('Recentes compartilha a lista; Voltar restaura rascunho e cache sem recarregar modelos', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.locator('.home__input').fill('Rascunho entre páginas');
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recent'));
        await p.locator('.recent-chats__row').first().waitFor();
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/conversations?offset=0').length,1);
        await p.goBack();await p.locator('.computer-message--assistant').first().waitFor();
        assert.equal(await p.locator('.home__input').inputValue(),'Rascunho entre páginas');
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/models').length,1);
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/personalization').length,1);
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/conversations/1').length,1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('revalidação preserva nós de mensagens inalteradas e incorpora alterações', async()=>{
    const f=await fixture(),p=f.page;
    try {
        const first=await p.locator('.computer-message--assistant').first().elementHandle();
        f.histories.get('1')!.turns[19].answer='Resposta atualizada';
        await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
        await p.getByText('Resposta atualizada',{exact:true}).waitFor();
        assert.equal(await p.locator('.computer-message--assistant').first().evaluate((node,old)=>node===old,first),true);
        assert.equal(await p.locator('.computer-message--assistant').count(),20);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('repouso não consulta a cada quatro segundos; geração remota continua atualizando', async()=>{
    const f=await fixture(),p=f.page;
    try {
        const before=f.requests.length;
        await p.waitForTimeout(4500); assert.equal(f.requests.length,before);
        f.histories.get('2')!.active=true; f.histories.get('2')!.turns[19].status='running';
        await open(p,'2');
        f.histories.get('2')!.active=false; f.histories.get('2')!.turns[19].status='completed';f.histories.get('2')!.turns[19].answer='Geração concluída';
        await p.getByText('Geração concluída',{exact:true}).waitFor();
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('cache invalidado ao excluir; conta diferente não recebe rascunhos da anterior', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.locator('.home__input').fill('Rascunho privado');await open(p,'2');
        f.histories.delete('1');f.chats.splice(f.chats.findIndex(c=>c.id==='1'),1);
        await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:changed',{detail:{id:'1',deleted:true}})));
        await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'1'}})));
        await p.getByText('Conversa removida',{exact:true}).waitFor();
        assert.equal(await p.locator('.computer-message--assistant').count(),0);
        await open(p,'2'); await p.locator('.home__input').fill('Outro rascunho privado');
        f.setUser(8);
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recent'));await p.locator('.recent-chats__row').first().waitFor();
        await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?conversation=2'));
        await p.locator('.computer-message--assistant').first().waitFor();
        assert.equal(await p.locator('.home__input').inputValue(),''); assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('modo anônimo não salva seu rascunho no novo chat normal', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.evaluate(()=>window.dispatchEvent(new Event('sessions:new')));
        await p.locator('.home__input').fill('Rascunho normal');
        await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
        assert.equal(await p.locator('.home__input').inputValue(),'');
        await p.locator('.home__input').fill('Segredo anônimo');
        await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
        assert.equal(await p.locator('.home__input').inputValue(),'Rascunho normal');assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});

test('cache vencido aparece antes da rede e a revalidação preserva o rascunho', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await open(p,'2');
        await p.clock.install(); await p.clock.fastForward(16000);
        f.setDelay(500); f.histories.get('1')!.turns[19].answer='Texto revalidado';
        const start=Date.now(); await open(p,'1'); assert.ok(Date.now()-start<400);
        await p.locator('.home__input').fill('Digitado durante a atualização');
        await p.getByText('Texto revalidado',{exact:true}).waitFor();
        assert.equal(await p.locator('.home__input').inputValue(),'Digitado durante a atualização');
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('regenerar substitui a resposta no cache e mantém versões ao voltar', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.route('**/messages/1-19/regenerate', route => route.fulfill({contentType:'application/x-ndjson',body:[
            {type:'conversation',conversation_id:'1',turn_id:'1-19',provider:'gemini'},
            {type:'delta',text:'Resposta regenerada'}, {type:'done',metadata:{provider:'gemini'}}
        ].map(e=>JSON.stringify(e)).join('\n')+'\n'}));
        await p.locator('.computer-rewrite').last().click();
        await p.getByText('Resposta regenerada',{exact:true}).waitFor();
        await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
        await open(p,'2'); await open(p,'1');
        await p.getByText('Resposta regenerada',{exact:true}).waitFor();
        assert.equal(await p.locator('.response-versions').last().textContent(),'2 / 2');
        assert.equal(f.requests.filter(r=>r==='GET /api/ai/conversations/1').length,1);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('notificação de outra aba revalida o chat aberto sem esperar o intervalo', async()=>{
    const f=await fixture(),p=f.page;
    try {
        const other=await f.context.newPage(); await other.goto(server.origin+'/recent');
        await other.locator('.recent-chats__row').first().waitFor();
        f.histories.get('1')!.turns[19].answer='Atualizada em outra aba';
        await other.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:changed',{detail:{id:'1'}})));
        await p.getByText('Atualizada em outra aba',{exact:true}).waitFor();
        await other.close(); assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('cache: limite, invalidação e logout impedem reaproveitar dados privados', async()=>{
    const context=await browser.newContext(),p=await context.newPage();
    try {
        await p.goto(server.origin+'/does-not-exist');
        await p.addScriptTag({path:path.join(root,'artifacts/test-runtime/workspace-cache.js')});
        const result=await p.evaluate(()=>{
            clearWorkspaceCache();
            const make=(id:string):ConversationHistory=>({conversation:{id,title:id,created_at:'',updated_at:''},turns:[],active:false,before:null});
            for(let i=0;i<25;i++)cacheConversation(make(String(i)));
            const evicted=!cachedConversation('0'), latest=!!cachedConversation('24');
            saveChatView('24',{draft:'privado',attachments:[],following:false,scrollTop:20});
            invalidateConversation('24',true);
            const deleted=!cachedConversation('24')&&!chatView('24');
            clearWorkspaceCache(false);cacheConversation(make('blocked'));
            saveChatView('blocked',{draft:'não salvar',attachments:[],following:true,scrollTop:0});
            return {evicted,latest,deleted,blocked:!cachedConversation('blocked')&&!chatView('blocked')};
        });
        assert.deepEqual(result,{evicted:true,latest:true,deleted:true,blocked:true});
    } finally {await context.close();}
});

test('editar: conclusão tardia não troca o chat escolhido depois nem envia nele', async()=>{
    const f=await fixture(),p=f.page;
    let release=()=>{}, started=()=>{};
    const pending=new Promise<void>(resolve=>release=resolve), requested=new Promise<void>(resolve=>started=resolve);
    try {
        await p.route('**/messages/1-0/edit', async route=>{started();await pending;await route.fulfill({json:{conversation_id:'1'}});});
        const user=p.locator('.computer-message--user').first();await user.hover();
        await user.getByRole('button',{name:'Editar',exact:true}).click();
        await user.getByRole('textbox',{name:'Editar mensagem'}).fill('Pergunta editada');
        await user.getByRole('button',{name:'Concluído',exact:true}).click();await requested;
        await open(p,'3');release();await p.waitForTimeout(200);
        assert.equal(new URL(p.url()).pathname,'/chat/3');
        assert.equal(await p.locator('.home__input').inputValue(),'');
        assert.equal(f.requests.filter(r=>r==='POST /api/ai/chat').length,0);
        assert.deepEqual(f.errors,[]);
    } finally {release();await f.close();}
});

 test('troca sem cache mantém layout de conversa durante carregamento e erro', async()=>{
    const f=await fixture(),p=f.page;
    try {
        f.setDelay(500);
        await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'2'}})));
        assert.equal(await p.locator('.computer-intro').isVisible(),false);
        assert.equal(await p.locator('.computer-page').evaluate(e=>e.classList.contains('has-conversation')),true);
        await p.waitForFunction(()=>document.querySelector('.computer-message--assistant')?.getAttribute('data-turn')==='2-0');
        f.histories.delete('3');
        await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'3'}})));
        assert.equal(await p.locator('.computer-intro').isVisible(),false);
        await p.waitForFunction(()=>document.querySelector('.computer-note')?.textContent?.includes('Conversa removida'));
        assert.equal(await p.locator('.computer-intro').isVisible(),false);
        await p.getByRole('link', {name:'Novo chat', exact:true}).click();
        await p.locator('.computer-intro').waitFor({state:'visible'});
    } finally {await f.close();}
});

 test('rota dedicada: link antigo redireciona, reload mantém conversa e links saem de /c', async()=>{
    const f=await fixture(),p=f.page;
    try {
        assert.equal(new URL(p.url()).pathname,'/chat/1');
        await p.reload();
        await p.locator('.computer-message--assistant').first().waitFor();
        assert.equal(await p.locator('.computer-intro').isVisible(),false);
        assert.equal(await p.getByRole('link',{name:'Novo chat',exact:true}).getAttribute('href'),'/new?new=1');
        assert.equal(await p.getByRole('link',{name:'Finanças',exact:true}).getAttribute('href'),'/finance');
        await open(p,'2');
        assert.equal(new URL(p.url()).pathname,'/chat/2');
        await p.reload();
        await p.waitForFunction(()=>document.querySelector('.computer-message--assistant')?.getAttribute('data-turn')==='2-0');
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});

 test('configurações: hash restaura aba e fechar limpa o endereço', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.evaluate(()=>{location.hash='settings/general';});
        await p.locator('#settings-dialog').waitFor({state:'visible'});
        assert.equal(await p.locator('[data-settings-tab="preferences"]').getAttribute('aria-current'),'true');
        await p.locator('[data-settings-tab="memory"]').click();
        assert.equal(new URL(p.url()).hash,'#settings/memory');
        await p.reload();await p.locator('#settings-dialog').waitFor({state:'visible'});
        assert.equal(await p.locator('[data-settings-tab="memory"]').getAttribute('aria-current'),'true');
        await p.locator('.settings-close').click();
        await p.waitForFunction(()=>!location.hash);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});
test('profile reference behavior: resize, collapse, submenus and keyboard', async () => {
    const f = await fixture(), p = f.page;
    try {
        const rail = p.locator('.sidebar'), profile = p.locator('.sidebar__profile'), menu = p.locator('#profile-menu');
        const initial = await rail.boundingBox();
        assert.ok(initial && initial.width === 280);
        const icon = p.locator('.sidebar__finance-icon'), before = await icon.boundingBox();
        await profile.click();
        await p.waitForFunction(() => document.querySelector('#profile-menu')?.matches(':popover-open'));
        assert.equal(await menu.evaluate(e => (e as HTMLElement).offsetWidth), 311);
        const appearance = p.locator('[data-profile-submenu="appearance"]');
        await appearance.focus();
        await appearance.press('ArrowRight');
        const sub = p.locator('#profile-appearance');
        assert(await sub.isVisible());
        assert.equal(await appearance.getAttribute('aria-expanded'), 'true');
        const boxes = await Promise.all([menu.boundingBox(), sub.boundingBox()]);
        assert.ok(boxes[0] && boxes[1] && boxes[1].x >= boxes[0].x + boxes[0].width - 5);
        await p.keyboard.press('ArrowLeft');
        assert.equal(await sub.isVisible(), false);
        await p.keyboard.press('Escape');
        assert.equal(await menu.evaluate(e => e.matches(':popover-open')), false);
        const resize = p.locator('.sidebar__resize');
        for (let i = 0; i < 6; i++) await resize.press('ArrowRight');
        await profile.click();
        await p.waitForFunction(() => {const m=document.querySelector<HTMLElement>('#profile-menu'),t=document.querySelector<HTMLElement>('.sidebar__profile');return !!m&&!!t&&Math.abs(m.offsetWidth-t.offsetWidth)<1;});
        assert.equal(await rail.evaluate(e => e.getBoundingClientRect().width), 400);
        await p.keyboard.press('Escape');
        await menu.waitFor({state:'hidden'});
        await p.locator('.sidebar__toggle').click();
        await p.waitForFunction(() => Math.abs(document.querySelector('.sidebar')!.getBoundingClientRect().width - 56) < 1);
        const after = await icon.boundingBox();
        assert.ok(before && after && Math.abs(before.x-after.x)<1 && Math.abs(before.y-after.y)<1);
        assert.equal(after?.width, 18);
        await profile.click();
        await p.waitForFunction(() => document.querySelector('#profile-menu')?.matches(':popover-open'));
        const collapsedMenu = await menu.boundingBox(), anchor = await profile.boundingBox();
        assert.ok(collapsedMenu && anchor && Math.abs(collapsedMenu.x-anchor.x-anchor.width+4)<1);
        await p.screenshot({path:path.join(root,'artifacts/profile-reference-collapsed.png')});
        await p.locator('.workspace__header').click();
        await p.waitForFunction(() => !document.querySelector('#profile-menu')?.matches(':popover-open'));
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

for(const width of [390,1280])test(`help and keyboard shortcuts ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:850});
  await p.keyboard.press('Control+/');
  const shortcuts=p.getByRole('dialog',{name:'Atalhos do teclado'});
  await shortcuts.waitFor();assert.equal(await shortcuts.locator('dl > div').count(),15);
  assert.equal(await shortcuts.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await p.screenshot({path:path.join(root,`artifacts/keyboard-shortcuts-${width}.png`)});
  await p.keyboard.press('Escape');await shortcuts.waitFor({state:'hidden'});
  await p.keyboard.press('Control+j');assert(await p.locator('.home__input').evaluate(e=>e===document.activeElement));
  await p.keyboard.press('Control+k');await p.getByRole('dialog',{name:'Pesquisar chats',exact:true}).waitFor();
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+Shift+,');await p.locator('#settings-dialog[open]').waitFor();
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+i');await p.locator('.computer-intro').waitFor({state:'visible'});
  await p.keyboard.press('Control+Shift+2');await p.waitForFunction(()=>document.querySelector('.computer-provider')?.getAttribute('aria-pressed')==='true');
  await p.keyboard.press('Control+Shift+1');await p.waitForFunction(()=>document.querySelector('.model-picker')?.getAttribute('aria-pressed')==='true');
  await p.keyboard.press('Control+;');await p.waitForFunction(()=>document.body.classList.contains('is-anonymous'));
  await p.keyboard.press('Control+;');await p.waitForFunction(()=>!document.body.classList.contains('is-anonymous'));
  if(width<640){await p.locator('.workspace__menu-toggle').click();}
  await p.locator('.sidebar__profile').click();
  const anonymous=p.getByRole('switch',{name:'Modo anônimo'}),track=p.locator('.profile-anonymous__switch');
  assert.equal(await track.evaluate(e=>e.getBoundingClientRect().width),24);
  assert.equal(await track.evaluate(e=>e.getBoundingClientRect().height),14);
  assert.equal(await p.locator('.profile-menu__identity').evaluate(e=>getComputedStyle(e).borderBottomWidth),'0px');
  const bg=await track.evaluate(e=>getComputedStyle(e).backgroundColor);
  await anonymous.hover();assert.equal(await track.evaluate(e=>getComputedStyle(e).backgroundColor),bg);
  await anonymous.click();await p.waitForFunction(()=>document.body.classList.contains('is-anonymous'));assert.notEqual(await track.evaluate(e=>getComputedStyle(e).backgroundColor),bg);
  await anonymous.click();await p.waitForFunction(()=>!document.body.classList.contains('is-anonymous'));
  assert.match(await anonymous.getAttribute('data-tooltip')||'',/24 horas/);
  await p.locator('[data-profile-submenu="help"]').click();
  for(const icon of ['help','keyboard','privacy']){
   const mask=await p.locator(`.profile-menu__icon--${icon}`).evaluate(e=>{const s=getComputedStyle(e);return {size:s.maskSize,position:s.maskPosition,repeat:s.maskRepeat};});
   assert.deepEqual(mask,{size:'contain',position:'50% 50%',repeat:'no-repeat'});
  }
  assert.equal(await p.locator('#profile-help a').getAttribute('href'),'/privacy');
  await p.locator('[data-open-shortcuts]').click();await shortcuts.waitFor();
  await p.getByRole('button',{name:'Fechar atalhos do teclado'}).click();
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.keyboard.press('Control+/');
  const motion=await shortcuts.evaluate(e=>({name:getComputedStyle(e).animationName,duration:getComputedStyle(e).animationDuration,backdrop:getComputedStyle(e,'::backdrop').backdropFilter}));
  assert.equal(motion.name,'shortcuts-enter');assert.equal(motion.duration,'0.3s');assert.equal(motion.backdrop,'blur(4px)');
  await p.keyboard.press('Escape');
  await p.emulateMedia({reducedMotion:'reduce'});await p.keyboard.press('Control+/');
  assert.equal(await shortcuts.evaluate(e=>getComputedStyle(e).animationName),'none');
  await p.keyboard.press('Escape');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('keyboard send and private link reuse the chat actions',async()=>{
 const f=await fixture(),p=f.page;
 try{
  let sent=0;
  await p.route('**/api/ai/chat',route=>{sent++;return route.fulfill({contentType:'application/x-ndjson',body:[{type:'delta',text:'Resposta por atalho'},{type:'done',metadata:{}}].map(x=>JSON.stringify(x)).join('\n')+'\n'});});
  await p.locator('.home__input').fill('Mensagem por atalho');
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{document.body.dataset.copiedLink=text;}}}));
  await p.keyboard.press('Control+Shift+c');
  assert.match(await p.locator('body').getAttribute('data-copied-link')||'',/\/chat\/1$/);
  await p.keyboard.press('Control+Enter');await p.getByText('Resposta por atalho',{exact:true}).waitFor();assert.equal(sent,1);
  await p.keyboard.press('Control+Enter');assert.equal(sent,1);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('Escape stops generation without collapsing the sidebar',async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.evaluate(()=>{const original=window.fetch;window.fetch=async(input,init)=>String(input)==='/api/ai/chat'?new Response(new ReadableStream({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Cancelado','AbortError')),{once:true});}}),{headers:{'Content-Type':'application/x-ndjson'}}):original(input,init);});
  await p.locator('.home__input').fill('Esperar resposta');await p.keyboard.press('Control+Enter');
  await p.locator('.home__composer.is-responding').waitFor();await p.keyboard.press('Escape');
  await p.waitForFunction(()=>!document.querySelector('.home__composer.is-responding'));
  assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('is-sidebar-collapsed')),false);
 }finally{await f.close();}
});

for(const width of [390,1280])test(`new chat matches reference geometry and anonymous outline ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:850});await p.keyboard.press('Control+i');await p.locator('.computer-intro').waitFor({state:'visible'});
  const form=p.locator('.home__composer'),before=await form.boundingBox();
  assert.ok(before&&before.width<=640&&before.x>=0&&before.x+before.width<=width);
  if(width===1280){assert.equal(before?.width,640);assert.equal(before?.height,120);}
  assert.equal(await form.evaluate(e=>getComputedStyle(e).borderRadius),'20px');
  await p.keyboard.press('Control+;');await p.waitForFunction(()=>document.body.classList.contains('is-anonymous'));
  const after=await form.boundingBox();assert.equal(after?.width,before?.width);assert.equal(after?.height,before?.height);
  const outline=await form.evaluate(e=>{const s=getComputedStyle(e,'::before');return {style:s.borderTopStyle,width:s.borderTopWidth,color:s.borderTopColor,text:getComputedStyle(e).color,pointer:s.pointerEvents,shadow:getComputedStyle(e).boxShadow};});
  assert.equal(outline.style,'dashed');assert.equal(outline.width,'1px');assert.equal(outline.color,outline.text);assert.equal(outline.pointer,'none');assert.equal(outline.shadow,'none');
  if(width<640)await p.locator('.workspace__menu-toggle').click();
  await p.locator('.sidebar__profile').click();
  assert.equal(await p.locator('.profile-menu__identity .sidebar__avatar').evaluate(e=>getComputedStyle(e,'::after').content),'none');
  assert.match(await p.locator('.sidebar__profile .sidebar__avatar').evaluate(e=>getComputedStyle(e,'::after').maskImage),/anonymous/);
  assert.match(await p.locator('.profile-menu__icon--help').evaluate(e=>getComputedStyle(e).maskImage),/question-mark-circle/);
  const arrow=await p.locator('[data-profile-submenu="appearance"] > svg').getAttribute('viewBox');
  assert.equal(await p.locator('[data-profile-submenu="help"] > svg').getAttribute('viewBox'),arrow);
  await p.keyboard.press('Escape');if(width<640)await p.locator('.sidebar__toggle').click();
  await p.screenshot({path:path.join(root,`artifacts/new-chat-reference-${width}.png`)});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for (const width of [390, 1280]) test(`composer menu appearance and placement ${width}`, async () => {
    const f = await fixture(), p = f.page;
    try {
        await p.setViewportSize({width, height: 900});
        await p.evaluate(() => window.WorkspaceNavigation.go('/new'));
        await p.locator('.computer-intro').waitFor({state: 'visible'});
        await p.mouse.move(0, 0);
        for (const selector of ['.attachment-toggle', '.local-model-picker']) {
            assert.equal(await p.locator(selector).evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
        }
        assert.equal(await p.locator('.provider-toggle').evaluate(e => getComputedStyle(e).boxShadow), 'none');
        assert.equal(await p.locator('.provider-toggle').evaluate(e => getComputedStyle(e).borderTopWidth), '0px');
        assert.equal(await p.locator('.provider-toggle__indicator').evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
        for(const theme of ['dark','light']){
            await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
            const indicator=await p.locator('.provider-toggle__indicator').evaluate(e=>{const s=getComputedStyle(e);return {border:s.borderTopColor,fill:s.backgroundColor,shadow:s.boxShadow};});
            assert.notEqual(indicator.border,indicator.fill);assert.equal(indicator.shadow,'none');
        }
        await p.locator('.local-model-picker').click();
        await p.mouse.move(0, 0);
        assert.notEqual(await p.locator('.local-model-picker').evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
        await p.keyboard.press('Escape');
        const trigger = p.locator('.attachment-toggle');
        await trigger.click();
        const menu = p.locator('#attachment-menu');
        await menu.waitFor({state: 'visible'});
        await p.mouse.move(0, 0);
        assert.notEqual(await trigger.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
        await p.waitForTimeout(200);
        const anchor = await trigger.boundingBox(), box = await menu.boundingBox();
        assert.ok(anchor && box && Math.abs(box.y - anchor.y - anchor.height - 8) < 2);
        assert.ok(anchor && box && Math.abs(box.x - Math.max(12, Math.min(anchor.x, width - box.width - 12))) < 2);
        assert.notEqual(await menu.evaluate(e => getComputedStyle(e).boxShadow), 'none');
        assert.equal(await menu.evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
        assert.equal(await p.locator('.home__composer').evaluate(e => getComputedStyle(e).boxShadow), await menu.evaluate(e => getComputedStyle(e).boxShadow));
        assert.equal(await trigger.locator('.attachment-plus').evaluate(e => getComputedStyle(e).transform), 'matrix(1, 0, 0, 1, 0, 0)');
        await p.keyboard.press('Escape');
        await p.evaluate(() => window.WorkspaceNavigation.go('/academic'));
        assert.equal(await p.locator('.study-topic-list').evaluate(e => getComputedStyle(e).scrollbarWidth), 'none');
    } finally { await f.close(); }
});

 test('anônimo: visual e expiração em 24 horas', async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.route('**/api/ai/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[{type:'delta',text:'Resposta privada'},{type:'done',metadata:{}}].map(e=>JSON.stringify(e)).join('\n')+'\n'}));
        await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
        assert.equal(await p.locator('.computer-intro__animated-logo').isVisible(),false);
        assert.equal(await p.locator('.anonymous-note').isVisible(),true);
        const empty=p.getByText('Nenhuma conversa',{exact:true});
        assert.equal(await empty.evaluate(e=>getComputedStyle(e).color),'rgb(145, 145, 145)');
        await p.locator('.local-model-picker').click();
        const size=await p.locator('.model-menu').boundingBox();
        assert.equal(size?.width,280);assert.ok(size && size.height>0 && size.height<100);
        await p.keyboard.press('Escape');
        assert.equal(await p.locator('.home__composer').evaluate(e=>getComputedStyle(e,'::before').borderTopStyle),'dashed');
        await p.locator('.home__input').fill('Mensagem privada');
        await p.locator('.home__input').press('Enter');
        await p.getByText('Resposta privada',{exact:true}).waitFor();
        await p.evaluate(()=>{const now=Date.now();Date.now=()=>now+24*60*60*1000+1;document.dispatchEvent(new Event('visibilitychange'));});
        await p.waitForFunction(()=>!document.querySelector('.computer-message'));
        assert.equal(await p.locator('.computer-intro').isVisible(),true);
        assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});

test('Computer: onda de caracteres termina sem deslocar o composer',async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.evaluate(()=>window.WorkspaceNavigation.go('/new'));
  await p.locator('.computer-intro').waitFor({state:'visible'});
  await p.emulateMedia({reducedMotion:'no-preference'});
  const before=await p.locator('.home__composer').boundingBox();
  await p.locator('.computer-provider').click();
  await p.waitForFunction(()=>document.querySelector<HTMLElement>('.computer-ripple')?.dataset.running==='true');
  await p.waitForTimeout(500);
  const after=await p.locator('.home__composer').boundingBox();
  assert.ok(Math.abs((before?.y||0)-(after?.y||0))<1);
  await p.screenshot({path:'artifacts/perplexity-animation/comet-ripple.png'});
  await p.waitForFunction(()=>document.querySelector<HTMLElement>('.computer-ripple')?.dataset.running==='false');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [390,1280])test(`chat switching keeps composer fixed and loading inside history ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:800});await p.waitForTimeout(250);const before=await p.locator('.computer-composer form').boundingBox();assert(before);
  f.setDelay(1600);await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'2'}})));
  await p.waitForTimeout(700);assert.equal(await p.locator('.computer-history-status').isVisible(),false);
  await p.locator('.computer-history-status .loading-indicator').waitFor();const during=await p.locator('.computer-composer form').boundingBox();assert(during);
  assert(Math.abs(during.y-before.y)<2);assert(Math.abs(during.x-before.x)<2);assert.equal(await p.locator('.computer-note .loading-indicator').count(),0);
  await p.screenshot({path:path.join(root,`artifacts/chat-switch-${width}.png`)});await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);assert.equal(await p.locator('.computer-history-status').isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const width of [390,1280])test(`chat research images and whole link cards, errors and stale requests ${width}`,async()=>{
 const f=await fixture(),p=f.page;let calls=0,fail=false,delay=250;
 const research=(query:string):Research=>({query,engine:query==='Saturno'?'Tavily':'SearXNG',sources:[{url:'https://example.com/planets',domain:'example.com',title:'Sobre '+query,excerpt:'Texto da fonte consultada.',evidence_type:'page'}]});
 try{
  await p.setViewportSize({width,height:800});
  f.histories.get('2')!.turns[19].metadata={research:research('Saturno')};f.histories.get('3')!.turns[19].metadata={research:research('Júpiter')};
  await p.route('https://images.example.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#39576b"/><circle cx="200" cy="150" r="80" fill="#dea969"/></svg>'}));
  await p.route('**/api/ai/images?*',async route=>{calls++;const params=new URL(route.request().url()).searchParams,q=params.get('q')!;assert.equal(params.get('engine'),q==='Saturno'?'tavily':'searxng');const failed=fail;await new Promise(resolve=>setTimeout(resolve,delay));await route.fulfill(failed?{status:503,json:{error:'Indisponível'}}:{json:{query:q,images:Array.from({length:12},(_,i)=>({title:q+' '+i,url:'https://example.com/'+q+'/'+i,domain:'example.com',image:'https://images.example.com/'+i+'.jpg',thumbnail:'https://images.example.com/'+i+'.jpg',width:400,height:300}))}}).catch(()=>{});});
  await open(p,'2');assert.equal(calls,0);
  await p.locator('.workspace__content').evaluate(el=>{el.scrollTop=300;el.dispatchEvent(new Event('scroll'));});await p.waitForTimeout(100);const answerTop=await p.locator('.workspace__content').evaluate(el=>el.scrollTop);
  await p.getByRole('button',{name:'Links',exact:true}).click();assert.equal(await p.locator('.chat-links__result').evaluate(e=>e.tagName),'A');assert.equal(await p.locator('.chat-links__result a').count(),0);
  const paint=await p.locator('.chat-links__title').evaluate(el=>({color:getComputedStyle(el).color,decoration:getComputedStyle(el).textDecorationLine,accent:getComputedStyle(el).getPropertyValue('--accent')}));assert.equal(paint.decoration,'none');assert(paint.accent);
  const popup=p.waitForEvent('popup');await p.locator('.chat-links__result').click({position:{x:5,y:5}});await (await popup).close();
  await p.screenshot({path:path.join(root,`artifacts/chat-links-${width}.png`)});
  await p.getByRole('button',{name:'Imagens',exact:true}).click();await p.getByRole('status').filter({hasText:'Buscando imagens'}).waitFor();await p.locator('.chat-images__result').first().waitFor();assert.equal(calls,1);assert.match(await p.locator('.chat-images .chat-links__query').innerText(),/Saturno/);assert.equal(await p.locator('.computer-page').isVisible(),false);
  await p.screenshot({path:path.join(root,`artifacts/chat-images-${width}.png`)});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.getByRole('button',{name:'Resposta',exact:true}).click();await p.waitForTimeout(100);assert(Math.abs(await p.locator('.workspace__content').evaluate(el=>el.scrollTop)-answerTop)<3);await p.getByRole('button',{name:'Imagens',exact:true}).click();assert.equal(calls,1);
  fail=true;await open(p,'3');await p.getByRole('button',{name:'Imagens',exact:true}).click();await p.getByText('Não foi possível buscar imagens.',{exact:true}).waitFor();fail=false;await p.getByRole('button',{name:'Tentar novamente',exact:true}).click();await p.locator('.chat-images__result').first().waitFor();assert.match(await p.locator('.chat-images').innerText(),/Júpiter/);assert.doesNotMatch(await p.locator('.chat-images').innerText(),/Saturno/);
  delay=700;f.histories.get('2')!.turns[19].metadata={research:research('Marte')};await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:changed',{detail:{id:'2',deleted:true}})));await open(p,'2');await p.getByRole('button',{name:'Imagens',exact:true}).click();await p.getByRole('status').filter({hasText:'Buscando imagens'}).waitFor();await open(p,'1');await p.waitForTimeout(800);assert.equal(await p.locator('.chat-images').isVisible(),false);assert.equal(await p.locator('.chat-images__result').count(),0);
  await open(p,'3');await p.getByRole('button',{name:'Imagens',exact:true}).click();await p.evaluate(()=>window.WorkspaceNavigation.go('/recent'));await p.locator('.recent-chats__row').first().waitFor();assert.equal(await p.locator('.workspace.showing-chat-images').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('chat loading waits one second, cancels fast switches and restarts for the newest selection',async()=>{
 const f=await fixture(),p=f.page,pending:Array<()=>void>=[];
 try{
  await p.clock.install({time:new Date('2026-10-19T12:00:00Z')});await p.clock.pauseAt(new Date('2026-10-19T12:00:01Z'));
  let finish:()=>void=()=>{};
  await p.route('**/api/ai/conversations/2',async route=>{await new Promise<void>(resolve=>{finish=resolve;pending.push(resolve);});await route.fulfill({json:f.histories.get('2')}).catch(()=>{});});
  const request=p.waitForRequest(r=>new URL(r.url()).pathname==='/api/ai/conversations/2');
  await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'2'}})));await request;
  await p.clock.runFor(999);assert.equal(await p.locator('.computer-history-status').isVisible(),false);
  await p.clock.runFor(1);assert.equal(await p.locator('.computer-history-status').isVisible(),true);
  await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'1'}})));assert.equal(await p.locator('.computer-history-status').isVisible(),false);finish();await p.clock.runFor(1100);assert.equal(await p.locator('.computer-history-status').isVisible(),false);
  let finishThird:()=>void=()=>{};
  await p.route('**/api/ai/conversations/3',async route=>{await new Promise<void>(resolve=>{finishThird=resolve;pending.push(resolve);});await route.fulfill({json:f.histories.get('3')}).catch(()=>{});});
  const third=p.waitForRequest(r=>new URL(r.url()).pathname==='/api/ai/conversations/3');await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sessions:open',{detail:{id:'3'}})));await third;
  await p.clock.runFor(800);assert.equal(await p.locator('.computer-history-status').isVisible(),false);finishThird();
  await p.locator('.computer-message--assistant[data-turn="3-0"]').waitFor();await p.clock.runFor(1100);assert.equal(await p.locator('.computer-history-status').isVisible(),false);assert.equal(await p.locator('.computer-history-status .loading-indicator').count(),0);assert.deepEqual(f.errors,[]);
 }finally{pending.forEach(resolve=>resolve());await f.close();}
});

for(const [width,theme] of [[1280,'dark'],[390,'light']] as const) test(`response feedback: combined menu, filled vote, reset and chat isolation (${width})`,async()=>{
    const f=await fixture(),p=f.page;
    try {
        await p.setViewportSize({width,height:800});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        const vote=p.locator('.computer-message--assistant').last().locator('.computer-feedback'),menu=p.locator('.response-feedback-menu');
        assert.equal(await p.locator('.computer-message--assistant').last().locator('[data-feedback]').count(),1);
        assert.match(await vote.locator('i').getAttribute('style')||'',/thumb-mixed/);
        assert.equal(await p.locator('.workspace__header').evaluate(e=>getComputedStyle(e).borderBottomWidth),'1px');
        if(width>640)assert.equal(await p.locator('.sidebar').evaluate(e=>getComputedStyle(e).borderRightWidth),'1px');
        await vote.click();await menu.waitFor();
        assert.equal(await vote.getAttribute('aria-expanded'),'true');
        const box=(await menu.boundingBox())!;assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=800);
        await p.screenshot({path:path.join(root,`artifacts/response-feedback-${width}.png`)});
        await vote.click();assert.equal(await menu.isVisible(),false);await vote.click();await menu.waitFor();
        await p.getByRole('menuitem',{name:'Boa resposta',exact:true}).click();
        assert.equal(await menu.isVisible(),false);assert.equal(await vote.getAttribute('aria-pressed'),'true');
        assert.match(await vote.locator('i').getAttribute('style')||'',/thumb-up-filled/);
        await open(p,'2');assert.equal(await vote.getAttribute('aria-pressed'),'false');
        await open(p,'1');assert.match(await vote.locator('i').getAttribute('style')||'',/thumb-up-filled/);
        await vote.click();assert.equal(await vote.getAttribute('aria-pressed'),'false');assert.equal(await menu.isVisible(),false);
        await vote.click();await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
        assert.match(await vote.locator('i').getAttribute('style')||'',/thumb-down-filled/);
        await vote.click();assert.match(await vote.locator('i').getAttribute('style')||'',/thumb-mixed/);
        await vote.click();await p.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
        assert.equal(await vote.getAttribute('aria-expanded'),'false');assert.equal(await vote.evaluate(e=>e===document.activeElement),true);
        await vote.click();await p.locator('.home__input').click();assert.equal(await menu.isVisible(),false);
        assert.equal(await vote.getAttribute('aria-expanded'),'false');
        await vote.click();await open(p,'2');assert.equal(await menu.isVisible(),false);
        await p.evaluate(()=>window.WorkspaceNavigation.go('/new'));await p.locator('.computer-intro').waitFor();
        assert.equal(await p.locator('.workspace__header').evaluate(e=>getComputedStyle(e).borderBottomWidth),'1px');
        assert.equal(await p.locator('.workspace__header').evaluate(e=>getComputedStyle(e).borderBottomColor),'rgba(0, 0, 0, 0)');
        await p.evaluate(()=>window.WorkspaceNavigation.go('/recent'));await p.locator('.recent-chats__row').first().waitFor();
        assert.equal(await menu.count(),0);assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
});

for(const width of [1280,390])test(`artifacts: cards, sources panel, spreadsheet preview, download and chat isolation ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 const sheet:import('../../shared/artifact-types').Artifact={id:'a'.repeat(32),created_at:'2026-10-19T12:00:00Z',spec:{kind:'spreadsheet',name:'Lista de passos',sheets:[{name:'Dados',columns:['Dia','Passos'],rows:[['Segunda',6500],['Terça',8200]]},{name:'Total',columns:['Passos'],rows:[[14700]]}]},files:[{format:'xlsx',name:'Lista de passos.xlsx',size:5649},{format:'csv',name:'Lista de passos.csv',size:180}]};
 const html:import('../../shared/artifact-types').Artifact={id:'b'.repeat(32),created_at:sheet.created_at,spec:{kind:'text',name:'pagina',extension:'html',content:'<h1>Prévia segura</h1><script>parent.document.body.dataset.artifactUnsafe="yes"</script>'},files:[{format:'html',name:'pagina.html',size:100}]};
 try{
  await p.setViewportSize({width,height:800});const turn=f.histories.get('2')!.turns[19];turn.metadata={artifacts:[sheet,html],research:{query:'Passos',sources:[{title:'Uma fonte',url:'https://example.com',domain:'example.com'}]}};turn.answer='Uma tabela:\n\n| Dia | Passos |\n| --- | --- |\n| Segunda | 6500 |\n| Terça | 8200 |';
  await open(p,'2');assert.equal(await p.locator('.artifact-card').count(),3);assert.equal(await p.locator('.computer-message__text table').count(),1);assert.equal(await p.getByRole('button',{name:'Baixar CSV',exact:true}).count(),1);
  await toggleSources(p);await p.locator('.artifact-section').waitFor();
  assert.equal(Math.round((await p.locator('.computer-sources-panel').boundingBox())!.width),336);
  assert.equal(await p.locator('.computer-sources-panel').evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert.equal(await p.locator('.sources-group').count(),0);await p.locator('.sources-card__source').waitFor();
  await p.emulateMedia({reducedMotion:'no-preference'});
  assert.match(await p.locator('.computer-sources-panel').evaluate(e=>getComputedStyle(e).transitionProperty),/overlay/);
  await toggleSources(p);await p.waitForTimeout(180);assert.equal(await p.locator('.computer-sources-panel').isVisible(),false);
  await toggleSources(p);await p.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await p.locator('.artifact-section').evaluate(e=>e.nextElementSibling?.querySelector('summary')?.textContent?.startsWith('Fontes')),true);
  await toggleSources(p);await p.locator('.response-artifacts').getByRole('button',{name:'Abrir Lista de passos.xlsx',exact:true}).click();
  const preview=p.locator('.artifact-preview');await preview.waitFor();assert.equal(await preview.locator('table tbody tr').count(),2);
  await preview.getByRole('button',{name:'Total',exact:true}).click();assert.match(await preview.locator('table').textContent()||'',/14700/);
  await preview.getByRole('button',{name:'Dados',exact:true}).click();await p.screenshot({path:path.join(root,`artifacts/files-preview-${width}.png`)});
  let requested='';await p.route('**/api/ai/conversations/2/artifacts/*',async route=>{requested=route.request().url();await route.fulfill({contentType:'application/octet-stream',body:'PK-test-file'});});
  const pending=p.waitForEvent('download');await preview.getByRole('button',{name:'Baixar',exact:true}).click();const downloaded=await pending;assert.equal(downloaded.suggestedFilename(),'Lista de passos.xlsx');assert.match(requested,/conversations\/2\/artifacts\/a+\?format=xlsx/);
  await preview.getByRole('button',{name:'Expandir artefato'}).click();assert.equal(Math.round((await preview.boundingBox())!.width),width);await p.keyboard.press('Escape');assert.equal(await preview.isVisible(),false);
  await p.locator('.response-artifacts').getByRole('button',{name:'Abrir pagina.html',exact:true}).click();const iframe=preview.locator('iframe');assert.equal(await iframe.getAttribute('sandbox'),'');await p.waitForTimeout(100);assert.equal(await p.locator('body').getAttribute('data-artifact-unsafe'),null);assert.equal(await p.locator('body').getAttribute('data-artifactUnsafe'),null);
  await p.keyboard.press('Escape');await open(p,'1');assert.equal(await p.locator('.artifact-card').count(),0);assert.equal(await preview.isVisible(),false);assert.equal(await p.locator('.artifact-section').isVisible(),false);
  await open(p,'2');assert.equal(await p.locator('.artifact-card').count(),3);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('artifacts: live stream adds files before the final text and retains metadata',async()=>{
 const f=await fixture(),p=f.page;const artifact:import('../../shared/artifact-types').Artifact={id:'c'.repeat(32),created_at:'2026-10-19T12:00:00Z',spec:{kind:'text',name:'lista',extension:'txt',content:'Primeiro\nSegundo'},files:[{format:'txt',name:'lista.txt',size:16}]};
 try{
  await p.route('**/api/ai/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[{type:'conversation',conversation_id:'1',turn_id:'1-20',provider:'gemini'},{type:'artifact',state:'creating'},{type:'artifact',state:'complete',artifact},{type:'delta',text:'Arquivo criado.'},{type:'done',metadata:{provider:'gemini',artifacts:[artifact]}}].map(v=>JSON.stringify(v)).join('\n')+'\n'}));
  await p.locator('.home__input').fill('Crie um arquivo de texto com uma lista');await p.locator('.home__send').click();await p.getByRole('button',{name:'Abrir lista.txt',exact:true}).first().waitFor();
  assert.equal(await p.locator('.response-artifact-status').count(),0);await open(p,'2');await open(p,'1');assert.equal(await p.locator('.artifact-card').count(),1);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});


test('artifacts: anonymous download uses transient data and expires with the private chat',async()=>{
 const f=await fixture(),p=f.page;
 const now=Date.now(),artifact:import('../../shared/artifact-types').Artifact={id:'d'.repeat(32),created_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString(),spec:{kind:'text',name:'privado',extension:'txt',content:'Dados fictícios privados'},files:[{format:'txt',name:'privado.txt',size:24}]};
 try{
  let downloadBody:any=null,csrf='';
  await p.route('**/api/ai/chat',route=>{
   assert.equal(route.request().postDataJSON().anonymous,true);
   return route.fulfill({contentType:'application/x-ndjson',body:[{type:'artifact',state:'creating'},{type:'artifact',state:'complete',artifact},{type:'delta',text:'Arquivo privado criado.'},{type:'done',metadata:{artifacts:[artifact]}}].map(e=>JSON.stringify(e)).join('\n')+'\n'});
  });
  await p.route('**/api/ai/artifacts/render',route=>{downloadBody=route.request().postDataJSON();csrf=route.request().headers()['x-csrftoken'];return route.fulfill({contentType:'text/plain',body:artifact.spec.kind==='text'?artifact.spec.content:''});});
  await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
  await p.locator('.home__input').fill('Crie um arquivo de texto privado');await p.locator('.home__input').press('Enter');
  await p.getByText('Arquivo privado criado.',{exact:true}).waitFor();await p.getByRole('button',{name:'Abrir privado.txt',exact:true}).first().click();
  const preview=p.locator('.artifact-preview'),pending=p.waitForEvent('download');await preview.getByRole('button',{name:'Baixar',exact:true}).click();
  assert.equal((await pending).suggestedFilename(),'privado.txt');assert.equal(downloadBody.artifact.id,artifact.id);assert.equal(downloadBody.format,'txt');assert.equal(csrf,'test');
  assert.equal(f.requests.some(r=>r.includes('/artifacts/'+artifact.id)),false);
  assert.equal(await p.evaluate(()=>Object.values(localStorage).some(v=>v.includes('Dados fictícios privados'))),false);
  await p.evaluate(()=>{const now=Date.now();Date.now=()=>now+86400001;document.dispatchEvent(new Event('visibilitychange'));});
  await p.waitForFunction(()=>!document.querySelector('.computer-message'));assert.equal(await p.locator('.artifact-card').count(),0);assert.equal(await preview.isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});


for(const width of [1440,390])test(`artifacts: table hover tools, column rules and sticky header follow page scroll ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:900});await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  const turn=f.histories.get('2')!.turns[19];turn.answer='Tabela de passos\n\n| Dia | Passos | Distância | Calorias |\n| --- | --- | --- | --- |\n'+Array.from({length:60},(_,i)=>'| Dia '+(i+1)+' | '+(6500+i)+' | 4,6 | 230 |').join('\n')+'\n\n'+('Texto depois da tabela.\n'.repeat(35));
  await open(p,'2');const table=p.locator('.answer-table'),actions=table.locator('.answer-table__actions');
  await table.evaluate(e=>{const root=document.querySelector<HTMLElement>('.workspace__content')!;root.scrollTop+=e.getBoundingClientRect().top-root.getBoundingClientRect().top-100;});
  await p.mouse.move(1,1);await p.waitForTimeout(150);assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'0');
  assert.equal(await actions.locator('button').count(),3);assert.equal((await actions.textContent())?.trim(),'');
  await table.locator('td').first().hover();assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1');
  assert.equal(await table.locator('th').first().evaluate(e=>getComputedStyle(e).borderRightWidth),'1px');assert.equal(await table.locator('td').first().evaluate(e=>getComputedStyle(e).borderRightWidth),'1px');
  await table.evaluate(e=>{const root=document.querySelector<HTMLElement>('.workspace__content')!;root.scrollTop+=e.querySelector('table')!.getBoundingClientRect().top-root.getBoundingClientRect().top+500;});
  await p.waitForTimeout(80);
  const sticky=await table.evaluate(e=>({head:e.querySelector('thead')!.getBoundingClientRect().top,top:document.querySelector('.workspace__content')!.getBoundingClientRect().top,body:e.querySelector('tbody')!.getBoundingClientRect().top}));assert(Math.abs(sticky.head-sticky.top)<2);assert(sticky.body<sticky.top);
  await p.screenshot({path:path.join(root,`artifacts/table-sticky-${width}.png`)});
  await table.evaluate(e=>{const root=document.querySelector<HTMLElement>('.workspace__content')!;root.scrollTop+=e.querySelector('table')!.getBoundingClientRect().bottom-root.getBoundingClientRect().top-20;});await p.waitForTimeout(80);
  const end=await table.evaluate(e=>({head:e.querySelector('thead')!.getBoundingClientRect().bottom,table:e.querySelector('table')!.getBoundingClientRect().bottom}));assert(Math.abs(end.head-end.table)<2);
  await table.evaluate(e=>{const root=document.querySelector<HTMLElement>('.workspace__content')!;root.scrollTop+=e.getBoundingClientRect().bottom-root.getBoundingClientRect().top-420;});await p.waitForTimeout(80);
  await actions.getByRole('button',{name:'Baixar CSV',exact:true}).focus();assert.equal(await actions.evaluate(e=>getComputedStyle(e).opacity),'1');
  const pending=p.waitForEvent('download');await actions.getByRole('button',{name:'Baixar CSV',exact:true}).click();assert.equal((await pending).suggestedFilename(),'tabela.csv');
  await p.screenshot({path:path.join(root,`artifacts/table-actions-${width}.png`)});
  await actions.getByRole('button',{name:'Ampliar tabela'}).click();const preview=p.locator('.table-dialog');await preview.waitFor();assert.equal(await preview.evaluate(e=>e.matches(':modal')),true);assert.equal(await p.locator('.artifact-preview').isVisible(),false);assert.equal(await preview.locator('tbody tr').count(),60);
  await preview.locator('.table-dialog__content').evaluate(e=>e.scrollTop=400);await p.waitForTimeout(80);
  const paneSticky=await preview.evaluate(e=>({head:e.querySelector('thead')!.getBoundingClientRect().top,top:e.querySelector('.table-dialog__content')!.getBoundingClientRect().top}));assert(Math.abs(paneSticky.head-paneSticky.top)<2);
  await p.screenshot({path:path.join(root,`artifacts/table-dialog-${width}.png`)});
  await p.keyboard.press('Escape');assert.equal(await preview.isVisible(),false);await actions.getByRole('button',{name:'Ampliar tabela'}).click();
  await preview.getByRole('button',{name:'Fechar tabela'}).click();assert.equal(await p.locator('.workspace__content').evaluate(e=>(e as HTMLElement).inert),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('artifacts: stacked files, nonmodal split, drag, restore, menu and chat switch',async()=>{
 const f=await fixture(),p=f.page;
 const artifact:import('../../shared/artifact-types').Artifact={id:'e'.repeat(32),created_at:new Date().toISOString(),spec:{kind:'spreadsheet',name:'Passos',sheets:[{name:'Dados',columns:['Dia','Passos'],rows:[['Segunda',6500],['Terça',8200]]}]},files:[{format:'xlsx',name:'Passos.xlsx',size:2300},{format:'csv',name:'Passos.csv',size:90}]};
 try{
  await p.setViewportSize({width:1440,height:900});await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  f.histories.get('2')!.turns[19].metadata={artifacts:[artifact]};await open(p,'2');
  const cards=p.locator('.artifact-card'),boxes=await cards.evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,bottom:e.getBoundingClientRect().bottom,width:e.getBoundingClientRect().width})));
  assert.equal(boxes[0].x,boxes[1].x);assert.equal(boxes[0].width,boxes[1].width);assert.equal(boxes[0].bottom,boxes[1].y);
  await cards.first().getByRole('button',{name:'Opções de Passos.xlsx'}).click();await p.getByRole('menuitem',{name:'Abrir arquivo'}).click();
  const preview=p.locator('.artifact-preview');await preview.waitFor();const initial=(await preview.boundingBox())!;
  assert(initial.width<900);assert.equal(await p.locator('dialog:modal').count(),0);
  const chat=await p.locator('.workspace__content').boundingBox();assert(chat&&Math.abs(chat.x+chat.width-initial.x)<2);
  await p.locator('.home__input').fill('Rascunho com arquivo aberto');const composer=await p.locator('.computer-composer').boundingBox();assert(composer&&composer.x+composer.width<=initial.x);
  const moreMask=await cards.first().locator('.artifact-card__more i').evaluate(e=>getComputedStyle(e).maskImage.slice(5,-2));assert.equal((await p.request.get(moreMask)).status(),200);
  await p.screenshot({path:path.join(root,'artifacts/files-pane-side.png')});
  const handle=preview.getByRole('separator',{name:'Largura do painel de arquivo'}),r=(await handle.boundingBox())!;
  await p.mouse.move(r.x+r.width/2,400);await p.mouse.down();await p.mouse.move(r.x+r.width/2-80,400,{steps:8});await p.mouse.up();assert((await preview.boundingBox())!.width>initial.width+60);
  await handle.focus();const before=(await preview.boundingBox())!.width;await p.keyboard.press('ArrowRight');assert.equal(Math.round((await preview.boundingBox())!.width),Math.round(before-32));
  await handle.press('End');const smallComposer=p.locator('.computer-composer .home__composer');await p.screenshot({path:path.join(root,'artifacts/files-pane-narrow.png')});assert(await smallComposer.evaluate(e=>e.scrollWidth<=e.clientWidth+2));await handle.press('Home');await handle.press('ArrowLeft');
  const resized=(await preview.boundingBox())!.width;await preview.getByRole('button',{name:'Expandir artefato'}).click();assert.equal((await preview.boundingBox())!.width,1440);assert.equal(await p.locator('.sidebar').isVisible(),false);
  await preview.getByRole('button',{name:'Reduzir artefato'}).click();assert.equal((await preview.boundingBox())!.width,resized);assert.equal(await p.locator('.home__input').inputValue(),'Rascunho com arquivo aberto');
  await preview.getByRole('button',{name:'Fechar artefato'}).click();assert.equal(await p.locator('.workspace__content').evaluate(e=>(e as HTMLElement).inert),false);
  let request='';await p.route('**/api/ai/conversations/2/artifacts/*',route=>{request=route.request().url();return route.fulfill({contentType:'application/octet-stream',body:'PK-test'});});
  await cards.last().getByRole('button',{name:'Opções de Passos.csv'}).click();const pending=p.waitForEvent('download');await p.getByRole('menuitem',{name:'Baixar arquivo'}).click();assert.equal((await pending).suggestedFilename(),'Passos.csv');assert.match(request,/format=csv/);
  await toggleSources(p);const section=p.locator('.artifact-section');await section.waitFor();
  assert.equal(await section.locator('.artifact-row small').count(),0);assert.equal(await section.locator('summary .ui-arrow').count(),1);
  assert.equal(await section.locator('.artifact-file-icon').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  await section.locator('summary').click();assert.equal(await section.locator('.artifact-count').isVisible(),true);assert.equal(await section.locator('.artifact-download-all').evaluate(e=>getComputedStyle(e).opacity),'0');assert.equal(await section.locator('.artifact-download-all').evaluate(e=>(e as HTMLElement).inert),true);
  await section.locator('summary').click();const zipped=p.waitForEvent('download');await section.getByRole('button',{name:'Baixar todos os arquivos em ZIP'}).click();const zipDownload=await zipped;assert.equal(zipDownload.suggestedFilename(),'artefatos.zip');
  const bytes=await (await import('node:fs/promises')).readFile((await zipDownload.path())!);const unpacked=(await import('fflate')).unzipSync(bytes);assert.deepEqual(Object.keys(unpacked).sort(),['Passos.csv','Passos.xlsx']);assert.equal(new TextDecoder().decode(unpacked['Passos.csv']),'PK-test');assert.equal(await section.evaluate(e=>(e as HTMLDetailsElement).open),true);
  await p.screenshot({path:path.join(root,'artifacts/artifact-menu-zip.png')});if(await p.locator('.sources-side-close').isVisible())await p.locator('.sources-side-close').click();else await toggleSources(p);
  await p.locator('.response-artifacts').getByRole('button',{name:'Abrir Passos.xlsx',exact:true}).click();await open(p,'1');assert.equal(await preview.isVisible(),false);assert.equal(await p.locator('.workspace').evaluate(e=>e.classList.contains('has-artifact-preview')),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [1280,390])test(`Markdown: dividers, nested lists and literal code ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:900});await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  const answer=[
   '**Total de Receitas:** R$ 5.650,00','', '---','', '## Despesas','',
   '- **2024-01-02:** Aluguel apartamento','  - Categoria: Moradia','  - Valor: R$ 1.500,00','  - Forma de Pagamento: Transferência','',
   '- **2024-01-03:** Conta de luz','  - Categoria: Utilidades','  - Valor: R$ 180,00','  - Forma de Pagamento: Débito automático','',
   'Fim das despesas.','', '* * *','', '3. Conferir valores','4. Salvar relatório','',
   '| Dia | Valor |','| --- | --- |','| Segunda | 20 |','',
   'Texto com - sinal, --- literal e -10.','`- código inline`','',
   '```txt','---','- item literal','### Título literal','```','',
   '~~~txt','---','- outro literal','~~~','',
   '- Texto <img src=x onerror=alert(1)> com **destaque** [1]','  continuação do item'
  ].join('\n');
  const history=f.histories.get('2')!;history.turns=[{...history.turns[0],answer,metadata:{research:{query:'Despesas',sources:[{url:'https://example.com',domain:'example.com',title:'Fonte'}]}}}];
  await open(p,'2');const body=p.locator('.computer-message--assistant .computer-message__text');
  assert.equal(await body.locator('hr').count(),2);assert.equal(await body.locator(':scope > ul').count(),2);
  assert.equal(await body.locator(':scope > ul').first().locator(':scope > li').count(),2);
  assert.equal(await body.locator('ul ul').count(),2);assert.equal(await body.locator('ul ul li').count(),6);
  assert.equal(await body.locator('ol').getAttribute('start'),'3');assert.equal(await body.locator('ol > li').count(),2);
  assert.equal(await body.locator('table tbody tr').count(),1);assert.equal(await body.locator('h2').textContent(),'Despesas');assert.equal(await body.locator('h3,img').count(),0);
  assert.equal(await body.locator('ul').first().evaluate(e=>getComputedStyle(e).listStyleType),'disc');assert.equal(await body.locator('ul ul').first().evaluate(e=>getComputedStyle(e).listStyleType),'circle');
  assert.equal(await body.locator('hr').first().evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert.match(await body.textContent()||'',/---\n- item literal/);assert.match(await body.textContent()||'',/---\n- outro literal/);assert.match(await body.textContent()||'',/Texto com - sinal, --- literal e -10/);
  assert.equal(await body.locator('li .computer-citation').getAttribute('href'),'https://example.com');assert.match(await body.locator(':scope > ul').last().textContent()||'',/continuação do item/);
  await p.locator('.workspace__content').evaluate(e=>e.scrollTop=0);await p.screenshot({path:path.join(root,`artifacts/markdown-lists-${width}.png`)});
  await open(p,'1');await open(p,'2');assert.equal(await body.locator('hr').count(),2);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [1280,390])test(`citation pills: grouped sources, hover navigation, keyboard and cleanup at ${width}px`,async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width,height:850});
  const history=f.histories.get('2')!;
  history.turns=[{...history.turns[0],answer:'Resumo de Romeu e Julieta [1][2]. Outra referência [2]. Agrupada [1, 2]. Inválida [3]. Código `[1]`.',metadata:{research:{query:'Romeu e Julieta',sources:[{url:'https://netsaber.com/resumo',domain:'netsaber.com',title:'Resumo de Romeu e Julieta - WILLIAM SHAKESPEARE',excerpt:'Milhares de resumos em um só lugar.'},{url:'https://storyboardthat.com/resumo',domain:'storyboardthat.com',title:'A Tragédia de Romeu e Julieta Resumo',excerpt:'Os alunos criarão um storyboard do enredo completo da tragédia de Shakespeare.'},{url:'javascript:alert(1)',domain:'inválida',title:'Não abrir'}]}}}];
  await f.context.route('https://storyboardthat.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Fonte</title>'}));
  await open(p,'2');await p.waitForTimeout(300);if(width===1280)await p.evaluate(()=>document.documentElement.dataset.theme='dark');const pills=p.locator('.computer-message__text .computer-citation'),panel=p.locator('.citation-preview');
  assert.equal(await pills.count(),3);assert.equal(await pills.first().textContent(),'netsaber.com +1');
  assert.equal(await pills.first().getAttribute('href'),'https://netsaber.com/resumo');
  assert.match(await p.locator('.computer-message--assistant .computer-message__text').textContent()||'',/Inválida \[3\]/);
  await pills.first().hover();await panel.waitFor();assert.equal(await panel.locator('.citation-preview__position').textContent(),'1/2');
  await panel.getByRole('button',{name:'Próxima fonte'}).click();await p.waitForTimeout(250);await p.screenshot({path:path.join(root,`artifacts/citation-next-${width}.png`)});assert.equal(await panel.locator('.citation-preview__position').textContent(),'2/2');
  assert.equal(await pills.first().getAttribute('href'),'https://storyboardthat.com/resumo');assert.equal(await pills.first().textContent(),'storyboardthat.com +1');
  await panel.getByRole('button',{name:'Fonte anterior'}).click();assert.equal(await panel.locator('strong').textContent(),'Resumo de Romeu e Julieta - WILLIAM SHAKESPEARE');
  const bounds=await panel.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=850);
  await p.screenshot({path:path.join(root,`artifacts/citation-preview-${width}.png`)});
  await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await pills.nth(1).focus();await panel.waitFor();assert.equal(await panel.locator('.citation-preview__count').textContent(),'1 fonte');
  await pills.nth(1).press('ArrowDown');assert.equal(await panel.locator('a').evaluate(e=>e===document.activeElement),true);
  await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  const popup=p.waitForEvent('popup');await pills.nth(1).click();const opened=await popup;await opened.waitForLoadState();assert.equal(opened.url(),'https://storyboardthat.com/resumo');await opened.close();
  await pills.first().hover();await panel.waitFor();await open(p,'1');await panel.waitFor({state:'hidden'});
  await open(p,'2');await pills.first().hover();await panel.waitFor();
  await pills.first().evaluate(e=>e.remove());await panel.waitFor({state:'hidden'});
  await p.addScriptTag({path:path.join(root,'artifacts/test-runtime/answer-content.js')});
  const parsed=await p.evaluate(()=>{
   const host=document.createElement('div'),sources=Array.from({length:120},(_,i)=>({url:'https://source'+i+'.org',title:'Fonte '+i,domain:'source'+i+'.org'}));
   renderAnswer(host,'Fato [120][1]. Ausente [999]. Código `[1]`. <img src=x onerror=alert(1)>.',sources);
   return {links:host.querySelectorAll('a').length,name:host.querySelector('a')?.textContent,images:host.querySelectorAll('img').length,text:host.textContent};
  });
  assert.equal(parsed.links,1);assert.equal(parsed.name,'source119.org +1');assert.equal(parsed.images,0);assert.match(parsed.text||'',/Ausente \[999\]/);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [1280,390])test(`connection cursor: thinking transition, one-time collapse and direct replies at ${width}px`,async()=>{
 const f=await fixture(),p=f.page;
 const event=async(value:Record<string,unknown>)=>p.evaluate(value=>window.dispatchEvent(new CustomEvent('test:ai-event',{detail:value})),value);
 try{
  await p.setViewportSize({width,height:850});
  await p.evaluate(()=>{
   const original=window.fetch;
   window.fetch=async(input,init)=>{
    if(String(input)!=='/api/ai/chat')return original(input,init);
    const listener=new AbortController();
    return new Response(new ReadableStream<Uint8Array>({start(controller){
     init?.signal?.addEventListener('abort',()=>{listener.abort();controller.error(new DOMException('Cancelado','AbortError'));},{once:true});
     window.addEventListener('test:ai-event',raw=>{
      const value=(raw as CustomEvent).detail;controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
      if(value.type==='done'||value.type==='error'){listener.abort();controller.close();}
     },{signal:listener.signal});
    },cancel(){listener.abort();}}),{headers:{'Content-Type':'application/x-ndjson'}});
   };
  });
  await p.locator('.home__input').fill('Confira estes dados');await p.locator('.home__send').click();
  const response=p.locator('.computer-message--assistant').last(),cursor=response.locator('.computer-connecting'),thought=response.locator('.computer-thinking');
  await cursor.waitFor();assert.equal(await thought.isVisible(),false);
  assert.match(await cursor.evaluate(e=>getComputedStyle(e,'::before').maskImage),/app-chatgpt-cursor[^/]*\.svg/);
  assert.match(await p.locator('.home__send .ui-arrow').evaluate(e=>getComputedStyle(e).maskImage),/stop[^/]*\.svg/);
  assert.equal(await cursor.evaluate(e=>getComputedStyle(e,'::before').animationName),'none');
  await p.emulateMedia({reducedMotion:'no-preference'});assert.equal(await cursor.evaluate(e=>getComputedStyle(e,'::before').animationName),'computer-connecting-pulse');
  await p.screenshot({path:path.join(root,`artifacts/chat-connecting-${width}.png`)});
  await event({type:'conversation',conversation_id:'1',turn_id:'1-20',provider:'qwen3:1.7b'});assert.equal(await cursor.isVisible(),true);
  await event({type:'thinking',text:'Conferindo os dados.'});await thought.waitFor();await cursor.waitFor({state:'hidden'});
  assert.equal(await thought.locator('summary').textContent(),'Pensando');assert.equal(await thought.getAttribute('open'),'');
  await event({type:'delta',text:'Resultado inicial. '});await response.locator('.computer-message__text').waitFor();assert.equal(await thought.getAttribute('open'),null);
  await thought.locator('summary').click();await event({type:'delta',text:'Complemento.'});assert.equal(await thought.getAttribute('open'),'');
  assert.match(await thought.textContent()||'',/Conferindo os dados/);
  await event({type:'done',metadata:{provider:'qwen3:1.7b',thinking_seconds:2}});await p.waitForFunction(()=>!document.querySelector('.home__send')?.classList.contains('is-stop'));
  await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);assert.equal(await thought.getAttribute('open'),'');
  await p.emulateMedia({reducedMotion:'reduce'});
  await p.locator('.home__input').fill('Responda diretamente');await p.locator('.home__send').click();await cursor.waitFor();
  await event({type:'conversation',conversation_id:'1',turn_id:'1-21',provider:'gemini'});
  await event({type:'delta',text:'Resposta direta.'});await cursor.waitFor({state:'hidden'});assert.equal(await thought.isVisible(),false);
  await event({type:'done',metadata:{provider:'gemini'}});await p.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('.home__input')?.readOnly);
  await p.locator('.home__input').fill('Resposta com falha');await p.locator('.home__send').click();await cursor.waitFor();
  await event({type:'conversation',conversation_id:'1',turn_id:'1-22',provider:'gemini'});await event({type:'error',error:'Falha simulada'});await cursor.waitFor({state:'hidden'});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('connection cursor: restored running chats follow the same phases',async()=>{
 const f=await fixture(),p=f.page;
 try{
  const history=f.histories.get('2')!;history.active=true;history.turns=[{...history.turns[0],answer:'',thinking:'',status:'running'}];
  await open(p,'2');const cursor=p.locator('.computer-connecting'),thought=p.locator('.computer-thinking');await cursor.waitFor();assert.equal(await thought.isVisible(),false);
  history.turns[0].thinking='Raciocínio salvo';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await thought.waitFor();await cursor.waitFor({state:'hidden'});
  await thought.locator('summary').click();history.turns[0].answer='Resposta em andamento';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.getByText('Resposta em andamento',{exact:true}).waitFor();assert.equal(await thought.getAttribute('open'),null);
  await thought.locator('summary').click();history.turns[0].answer+=' com atualização';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.getByText('Resposta em andamento com atualização',{exact:true}).waitFor();assert.equal(await thought.getAttribute('open'),'');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for (const width of [1280,390]) test(`code blocks: safe highlighting, literal copy and layout ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.setViewportSize({width,height:900});
  await f.context.grantPermissions(['clipboard-read','clipboard-write']);
  const source='const html = "<img src=x onerror=alert(1)>";\nconsole.log(html);\n';
  const answer='Código `inline [1]`\n\n```javascript\n'+source+'```\n\n~~~unknown\n<script>alert(1)</script>\n~~~\n\n```python\nprint("incompleto")';
  const history=f.histories.get('2')!;history.turns=[{...history.turns[0],answer}];await open(p,'2');
  const body=p.locator('.computer-message--assistant .computer-message__text'),blocks=body.locator('.answer-code');
  assert.equal(await blocks.count(),3);assert.equal(await blocks.first().locator('pre code').textContent(),source);
  assert.ok(await blocks.first().locator('.hljs-keyword').count()>0);
  assert.equal(await blocks.nth(1).locator('code').textContent(),'<script>alert(1)</script>\n');
  assert.equal(await blocks.nth(2).locator('code').textContent(),'print("incompleto")');
  assert.equal(await body.locator('img,script,.computer-citation').count(),0);assert.equal(await body.locator('.answer-inline-code').textContent(),'inline [1]');
  await blocks.first().getByRole('button',{name:'Copiar código',exact:true}).click();assert.equal(await p.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n/g,'\n')),source);
  assert.equal(await blocks.first().locator('[data-copied]').count(),1);
  await p.locator('.computer-message__actions').getByRole('button',{name:'Copiar',exact:true}).click();assert.equal(await p.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n/g,'\n')),answer);
  for (const theme of ['dark','light']) {
   await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   assert.equal(await body.evaluate(e=>getComputedStyle(e).fontWeight),'350');assert.equal(await blocks.first().locator('code').evaluate(e=>getComputedStyle(e).fontWeight),'380');
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.locator('.workspace__content').evaluate(e=>e.scrollTop=0);await p.evaluate(()=>(document.activeElement as HTMLElement)?.blur());await p.mouse.move(0,0);
   assert.equal(await p.locator('.computer-message__actions').evaluate(e=>getComputedStyle(e).opacity),'1');
   await p.waitForFunction(()=>getComputedStyle(document.querySelector('.response-time')!).opacity==='0');
   const send=p.locator('.home__send');const before=await send.evaluate(e=>({opacity:getComputedStyle(e).opacity,bg:getComputedStyle(e).backgroundColor}));assert.equal(before.opacity,'1');
   await send.hover();await p.waitForTimeout(250);assert.deepEqual(await send.evaluate(e=>({opacity:getComputedStyle(e).opacity,bg:getComputedStyle(e).backgroundColor})),before);
   await p.mouse.move(0,0);await p.screenshot({path:path.join(root,`artifacts/code-blocks-${width}-${theme}.png`)});
  }
  assert.equal(await p.locator('.sidebar__wordmark').textContent(),'Comet');assert.equal(await p.locator('.computer-disclaimer').textContent(),'O Comet pode cometer erros. Confira informações importantes.');
  assert.deepEqual(f.errors,[]);
 } finally {await f.close();}
});

for(const width of [1280,390]) test(`Ollama menu and banners: local, cloud and anonymous priority ${width}`,async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.setViewportSize({width,height:950});await p.emulateMedia({colorScheme:'dark'});await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  await f.context.route('**/api/ai/models',r=>r.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:4b',configured:true,execution:'local'},{id:'gpt-oss:120b-cloud',configured:true,execution:'cloud'},...['gemma4:31b-cloud','glm-5.3-flash:cloud','kimi-k3:cloud','deepseek-v4.1-flash:cloud'].map(id=>({id,configured:true,execution:'cloud'}))],default_model:'qwen3:4b'}}));
  await p.evaluate(()=>window.dispatchEvent(new Event('sessions:new')));
  await p.getByRole('button',{name:'Usar Computer',exact:true}).click();await p.waitForFunction(()=>window.ComputerModels.selected()==='qwen3:4b');
  assert.equal(await p.locator('.local-composer-banner').isVisible(),false);assert.equal(await p.locator('.anonymous-composer-banner').isVisible(),false);
  const composer=p.locator('.home__composer');const base=await composer.boundingBox();assert(base);assert.equal(await composer.evaluate(e=>getComputedStyle(e,'::before').content),'none');
  await open(p,'2');assert.equal(await p.locator('.local-composer-banner').isVisible(),true);
  await p.locator('.local-model-picker').click();await p.locator('.model-menu:popover-open').waitFor();
  assert.equal(await p.locator('[data-provider="qwen3:4b"] .model-icon--cpu').count(),1);assert.equal(await p.locator('[data-provider="gpt-oss:120b-cloud"] .model-icon--cpu').count(),0);
  assert.equal(await p.locator('.model-menu').getByText('Nuvem · Ollama',{exact:true}).count(),1);
  for(const id of ['gemma4:31b-cloud','glm-5.3-flash:cloud','kimi-k3:cloud','deepseek-v4.1-flash:cloud']) assert.equal(await p.locator('[data-provider="'+id+'"] .model-icon').count(),0);
  assert.equal(await composer.evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert.notEqual(await composer.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'0px');
  if(width===1280) for(const height of await p.locator('.sidebar__link').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height))) assert.equal(height,36);
  await p.screenshot({path:path.join(root,`artifacts/ollama-local-menu-${width}.png`)});
  await p.locator('[data-provider="gpt-oss:120b-cloud"]').click();assert.equal(await p.getByRole('button',{name:'Usar Computer'}).getAttribute('aria-pressed'),'true');assert.equal(await p.locator('.local-composer-banner').isVisible(),false);assert.equal(await p.locator('.local-model-name').textContent(),'gpt-oss:120b-cloud');
  await p.locator('.local-model-picker').click();await p.locator('[data-provider="qwen3:4b"]').click();
  await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
  assert.equal(await p.locator('.anonymous-composer-banner').isVisible(),false);
  await p.route('**/api/ai/chat',r=>r.fulfill({contentType:'application/x-ndjson',body:[{type:'delta',text:'Resposta privada para validar o aviso'},{type:'done',metadata:{}}].map(e=>JSON.stringify(e)).join('\n')+'\n'}));
  await p.locator('.home__input').fill('Teste do aviso');await p.locator('.home__input').press('Enter');await p.getByText('Resposta privada para validar o aviso',{exact:true}).waitFor();
  await p.screenshot({path:path.join(root,'artifacts/banner-connected-'+width+'.png')});
  assert.equal(await p.locator('.anonymous-composer-banner').isVisible(),true);assert.equal(await p.locator('.local-composer-banner').isVisible(),false);assert.equal(await p.locator('.anonymous-composer-banner').evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert.equal(await p.locator('.anonymous-composer-shell').evaluate(e=>getComputedStyle(e).backgroundColor),await p.locator('.anonymous-composer-banner').evaluate(e=>getComputedStyle(e).backgroundColor));
  await p.evaluate(()=>window.dispatchEvent(new Event('sessions:new')));
  assert.equal(await p.locator('.anonymous-composer-banner').isVisible(),false);
  assert.equal(await p.locator('.local-composer-banner').isVisible(),false);
  assert.equal((await composer.boundingBox())!.height,base.height);await p.screenshot({path:path.join(root,`artifacts/ollama-anonymous-banner-${width}.png`)});
  if(width===1280){await p.locator('.sidebar__profile').click();const menu=await p.locator('.profile-menu').boundingBox(),trigger=await p.locator('.sidebar__profile').boundingBox();assert(menu&&trigger);assert.equal(menu.x,trigger.x);assert.ok(Math.abs(menu.width-trigger.width)<=1);
   const text=await p.locator('.sidebar__wordmark').boundingBox(),icon=await p.locator('.sidebar__new-chat .sidebar__icon').first().boundingBox();assert.equal(text!.x,icon!.x);
   await p.evaluate(()=>document.querySelector<HTMLElement>('.workspace')!.style.setProperty('--sidebar-expanded-width','360px'));await p.waitForTimeout(400);const resizedMenu=await p.locator('.profile-menu').boundingBox(),resizedTrigger=await p.locator('.sidebar__profile').boundingBox();assert.ok(Math.abs(resizedMenu!.width-resizedTrigger!.width)<=1);await p.screenshot({path:path.join(root,'artifacts/profile-menu-matched.png')});
  }
  assert.deepEqual(f.errors,[]);
 } finally {await f.close();}
});

for(const width of [390,1280]) test('anonymous ripple follows greeting center '+width,async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.setViewportSize({width,height:900});await p.emulateMedia({reducedMotion:'no-preference'});
  await p.evaluate(()=>window.dispatchEvent(new Event('chat:toggle-anonymous')));
  await p.getByRole('button',{name:'Usar Computer',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector<HTMLElement>('.computer-ripple')?.dataset.running==='true');
  await p.waitForTimeout(150);
  const result=await p.locator('.computer-ripple').evaluate(e=>{const c=e as HTMLCanvasElement,g=c.getContext('webgl2')!,program=g.getParameter(g.CURRENT_PROGRAM) as WebGLProgram;const origin=Array.from(g.getUniform(program,g.getUniformLocation(program,'u_rippleOrigin')!) as Float32Array);const rect=c.getBoundingClientRect(),title=document.querySelector('#computer-title')!.getBoundingClientRect();return {origin,expected:[(title.left+title.width/2-rect.left)/rect.width,(title.top+title.height/2-rect.top)/rect.height]};});
  result.origin.forEach((value,i)=>assert(Math.abs(value-result.expected[i])<.001));
  await p.screenshot({path:path.join(root,'artifacts/anonymous-ripple-'+width+'.png')});assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('sources menu: uploaded files, disclosure and conversation isolation',async()=>{
 const f=await fixture(),p=f.page;
 try{
  f.histories.get('2')!.turns[19].attachments=[{id:'c'.repeat(32),name:'Documento enviado.pdf',kind:'file',size:1234}];
  await open(p,'2');await toggleSources(p);
  await p.locator('.sources-uploaded > summary').click();
  await p.getByRole('button',{name:'Documento enviado.pdf',exact:true}).click();
  assert.equal(await p.locator('.sources-menu-toggle').getAttribute('aria-expanded'),'false');
  await toggleSources(p);await p.locator('.sources-uploaded__file').waitFor();
  await p.screenshot({path:path.join(root,'artifacts/sources-menu-uploads.png')});
  await open(p,'1');assert.equal(await p.locator('.sources-menu-toggle').isVisible(),false);assert.equal(await p.locator('.sources-uploaded__file').count(),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});


test('code colors: measured Perplexity dark Python palette',async()=>{
 const f=await fixture(),p=f.page;
 try{
  const source='# Comentário\ndef tarefa():\n    print("texto")\n    return int(1), False';
  f.histories.get('2')!.turns=[{...f.histories.get('2')!.turns[0],answer:'\x60\x60\x60python\n'+source+'\n\x60\x60\x60'}];
  await open(p,'2');await p.evaluate(()=>document.documentElement.dataset.theme='dark');
  const code=p.locator('.answer-code code');
  const color=(selector:string)=>code.locator(selector).first().evaluate(e=>getComputedStyle(e).color);
  assert.equal(await code.textContent(),source+'\n');
  assert.equal(await code.evaluate(e=>getComputedStyle(e).color),'rgb(214, 208, 200)');
  assert.equal(await color('.hljs-comment'),'rgb(167, 163, 154)');
  assert.equal(await color('.hljs-keyword'),'rgb(255, 123, 114)');
  assert.equal(await color('.hljs-string'),'rgb(165, 214, 255)');
  assert.equal(await color('.hljs-title'),'rgb(210, 168, 255)');
  assert.equal(await color('.hljs-built_in:not(.hljs-python-print)'),'rgb(255, 166, 87)');
  assert.equal(await color('.hljs-python-print'),'rgb(255, 123, 114)');
  assert.equal(await color('.hljs-number'),'rgb(255, 166, 87)');
  assert.equal(await color('.hljs-literal'),'rgb(214, 208, 200)');
  assert.equal(await code.locator('.hljs-python-print').filter({hasText:'print'}).count(),1);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('sources responsive: dock, hover close, resize, direct sites and grouped files',async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width:1440,height:900});
  const turn=f.histories.get('2')!.turns[19];turn.metadata={research:{sources:[{title:'Fonte de teste',url:'https://example.com',domain:'example.com'}]}};
  await open(p,'2');await toggleSources(p);
  const panel=p.locator('.computer-sources-panel');await p.waitForFunction(()=>document.querySelector('.workspace')?.classList.contains('has-source-panel'));
  assert.equal((await panel.boundingBox())!.width,320);assert.equal(await panel.getAttribute('popover'),'manual');
  assert.equal(await p.locator('.sources-group').count(),0);await p.locator('.sources-card__source').waitFor();
  const close=p.locator('.sources-side-close');await p.mouse.move(600,400);assert.equal(await close.evaluate(e=>getComputedStyle(e).opacity),'0');
  await panel.hover();assert.equal(await close.evaluate(e=>getComputedStyle(e).opacity),'1');
  await p.screenshot({path:path.join(root,'artifacts/sources-docked-chrome.png')});
  await p.locator('.home__input').click();assert.equal(await panel.evaluate(e=>e.matches(':popover-open')),true);
  await close.click();assert.equal(await panel.isVisible(),false);assert.equal(await p.locator('.workspace').evaluate(e=>e.classList.contains('has-source-panel')),false);
  await toggleSources(p);await p.setViewportSize({width:1100,height:900});
  await p.waitForFunction(()=>document.querySelector('.computer-sources-panel')?.getAttribute('popover')==='auto');assert.equal((await panel.boundingBox())!.width,336);
  await open(p,'1');turn.attachments=[{id:'d'.repeat(32),name:'Fonte.pdf',kind:'file',size:100}];await p.goto(new URL('/chat/2',p.url()).href);await p.locator('.attachment-chip__name').filter({hasText:'Fonte.pdf'}).waitFor();await toggleSources(p);
  assert.equal(await p.locator('.sources-group').count(),2);const web=p.locator('.sources-group > summary').filter({hasText:'Web'});
  assert.match(await web.locator('i').first().evaluate(e=>getComputedStyle(e).maskImage),/web-links/);
  await web.click();await p.locator('.sources-card__source').waitFor();assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

async function toggleSources(p:import('playwright').Page){const side=p.locator('.sources-side-close');if(await side.isVisible())await side.click();else await p.locator('.sources-menu-toggle').click();}

test('sources preference: closed default, corner button, open and closed survive reload',async()=>{
 const f=await fixture(),p=f.page;
 try{
  await p.setViewportSize({width:1536,height:900});
  f.histories.get('2')!.turns[19].metadata={research:{sources:[{title:'Fonte',url:'https://example.com',domain:'example.com'}]}};
  await open(p,'2');const panel=p.locator('.computer-sources-panel'),button=p.locator('.sources-side-close');await button.waitFor();
  assert.equal(await panel.isVisible(),false);assert.equal(await p.locator('.sources-menu-toggle').isVisible(),false);
  assert.equal(await button.getAttribute('aria-label'),'Expandir fontes');
  assert.equal(await p.locator('.workspace').evaluate(e=>getComputedStyle(e).getPropertyValue('--chat-content-width').trim()),'720px');
  await button.click();await p.waitForFunction(()=>localStorage.getItem('comet-sources-panel-open')==='true');
  await p.reload();await p.locator('.computer-sources-panel:popover-open').waitFor();assert.equal(await p.locator('.sources-menu-toggle').isVisible(),false);
  await button.click();await p.waitForFunction(()=>localStorage.getItem('comet-sources-panel-open')==='false');await p.reload();await button.waitFor();
  assert.equal(await panel.isVisible(),false);assert.equal(await button.getAttribute('aria-expanded'),'false');
  assert.ok((await button.boundingBox())!.x>1450);await p.screenshot({path:path.join(root,'artifacts/sources-corner-closed.png')});assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
