import assert = require('node:assert/strict');
import path = require('node:path');
import {test,before,after} from 'node:test';
import {chromium,type Browser} from 'playwright';
import {startNextServer} from './next-server.cjs';
const root=path.resolve(__dirname,'../..');
let browser:Browser, server:Awaited<ReturnType<typeof startNextServer>>;
before(async()=>{server=await startNextServer(root);browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});});
after(async()=>{await browser?.close();await server?.stop();});
for(const failure of [false,true]) test(`loading icon replaces text and clears after ${failure?'failure':'success'}`,async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 let ready!:()=>void, finish!:()=>void;
 const bootstrap=new Promise<void>(resolve=>{ready=resolve;}), list=new Promise<void>(resolve=>{finish=resolve;});
 const page=await context.newPage();
 try{
  await context.addInitScript(theme=>{localStorage.setItem('ascenda-cookie-choice-v1','accepted');localStorage.setItem('ascensao-theme',theme);},failure?'dark':'light');
  await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/bootstrap'){await bootstrap;return route.fulfill({json:{page:'recentes',user:{id:7,nome:'Teste',email:'test@example.com'},csrfToken:'test',currentYear:2026}});}
   if(url.pathname==='/api/ai/conversations'){await list;return route.fulfill(failure?{status:503,json:{error:'Falha simulada ao carregar'}}:{json:{conversations:[],next_offset:null}});}
   return route.fulfill({json:{}});
  });
  await page.goto(server.origin+'/recentes.html');
  await page.locator('.loading-indicator__icon').first().waitFor();
  const animation=await page.locator('.loading-indicator__icon').first().evaluate(e=>{const s=getComputedStyle(e);return {name:s.animationName,mask:s.maskImage};});
  assert.equal(animation.name,'comet-loading-spin');assert.match(animation.mask,/loading(?:\.[^/]+)?\.svg/);
  assert.equal((await page.request.get(server.origin+'/static/img/icons/loading.svg')).status(),200);
  ready();
  const status=page.locator('.recent-chats__status');await status.locator('.loading-indicator__icon').waitFor();
  assert.equal(await status.locator('.loading-indicator__label').textContent(),'Carregando conversas');
  assert.equal(await status.locator('.loading-indicator__label').evaluate(e=>getComputedStyle(e).clipPath),'inset(50%)');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await status.locator('.loading-indicator__icon').evaluate(e=>getComputedStyle(e).animationName),'none');
  finish();await status.locator('.loading-indicator').waitFor({state:'detached'});
  assert.match(await status.textContent() || '',failure?/Falha simulada/:/ainda n.o tem conversas/);
 }finally{ready();finish();await context.unrouteAll({behavior:'wait'});await context.close();}
});
