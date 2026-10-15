import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {test,before,after} from 'node:test';
import {chromium,type Browser,type Page} from 'playwright';
import {startNextServer} from './next-server.cjs';
const root=path.resolve(__dirname,'../..');
let browser:Browser,server:Awaited<ReturnType<typeof startNextServer>>;
before(async()=>{server=await startNextServer(root);browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});});
after(async()=>{await browser?.close();await server?.stop();});
function chartData(count=40,baseline=100){
 const points=Array.from({length:count},(_,i)=>{const open=baseline+Math.sin((i-1)/4)*35,close=baseline+Math.sin(i/4)*35;return {date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),clock:null as string|null,open,high:Math.max(open,close)+2,low:Math.min(open,close)-2,close,volume:Math.abs(close-open)};});
 const series=Object.fromEntries(['balance','income','expense'].map((key,index)=>[key,{label:['Saldo','Receitas','Despesas'][index],baseline:baseline*(index+1),points:points.map(p=>({...p,open:p.open*(index+1),high:p.high*(index+1),low:p.low*(index+1),close:p.close*(index+1)}))}]));
 return {currency:'BRL',asOf:'2026-10-13',start:'2026-09-01',end:'2026-10-13',interval:'day',summary:Object.fromEntries(['balance','income','expense'].map((key,i)=>[key,{amount:['210.00','320.00','110.00'][i],difference:['10.00','20.00','-30.00'][i],percentage:['5','6.67','-21.43'][i],series:Array.from({length:20},(_,j)=>[200,300,140][i]+Math.sin(j/2)*10+(j-10)*2)}])),series};
}
async function fixture(width=1280,theme='dark',reducedMotion:'reduce'|'no-preference'='reduce'){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion,acceptDownloads:true});
 await context.addInitScript(theme=>{localStorage.setItem('ascenda-cookie-choice-v1','accepted');localStorage.setItem('ascensao-theme',theme);},theme);
 const requests:URL[]=[],errors:string[]=[];let data=chartData(),failure=false,delay=0;
 await context.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/api/bootstrap')return route.fulfill({json:{page:url.searchParams.get('page')||'graficos',user:{id:7,nome:'Teste',email:'teste@example.com'},csrfToken:'test-csrf',currentYear:2026}});
  if(url.pathname==='/api/finance/chart'){requests.push(url);const snapshot=structuredClone(data);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return route.fulfill(failure?{status:503,json:{error:'Banco indisponível'}}:{json:snapshot});}
  if(url.pathname==='/api/finance/transactions')return route.fulfill({json:{transactions:[],next_cursor:null}});
  if(url.pathname==='/api/ai/conversations')return route.fulfill({json:{conversations:[],next_offset:null}});
  if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true}]}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
  return url.origin===server.origin?route.continue():route.fulfill({status:404,body:''});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.origin+'/financas.html');await loaded(page);
 return {page,requests,errors,setData:(value:ReturnType<typeof chartData>)=>{data=value;},fail:(v:boolean)=>{failure=v;},delay:(v:number)=>{delay=v;},close:async()=>{await context.unrouteAll({behavior:'wait'});await context.close();}};
}
async function loaded(p:Page){await p.waitForSelector('.finance-chart-column[aria-busy="false"]');}
async function period(p:Page,label:string){const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/finance/chart');await p.getByRole('group',{name:'Período do gráfico',exact:true}).getByRole('button',{name:label,exact:true}).click();await response;await loaded(p);}
async function changed(p:Page){const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/finance/chart');await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));await response;await loaded(p);}

test('finance SVG: real values, modes, hover, selection, zoom, menus and exports',async()=>{
 const f=await fixture(),p=f.page;
 try {
  assert.equal(await p.locator('.finance-total__sparkline').count(),3);
  assert.equal(await p.getByLabel('Valor exibido',{exact:true}).count(),0);assert.equal(await p.locator('button.finance-total').count(),0);assert.equal(await p.locator('.finance-total__sparkline pattern').count(),0);
  const input=p.locator('.finance-composer textarea');assert.equal(await input.getAttribute('rows'),'1');const initialHeight=await input.evaluate(el=>el.getBoundingClientRect().height);assert(initialHeight<=30);await input.fill('Linha 1\nLinha 2\nLinha 3');assert((await input.boundingBox())!.height>initialHeight);await input.fill('');assert.equal((await input.boundingBox())!.height,initialHeight);
  assert((await p.locator('.sidebar__logo').evaluate(el=>getComputedStyle(el,'::before').maskImage)).includes('comet-wordmark'));
  const summary=await p.locator('.finance-total').first().boundingBox();assert(summary&&summary.height===154);
  assert.equal(await p.locator('#market-chart canvas').count(),0);assert.equal(await p.locator('.finance-main-svg').getByText('comet',{exact:true}).count(),0);assert.deepEqual(await p.locator('[data-range]').allTextContents(),['1D','5D','1M','6M','YTD','1Y','5Y','MAX']);
  assert.match(await p.locator('[data-finance-total="balance"] .finance-total__values').ariaSnapshot(),/210,00/);
  assert.equal(f.requests[0].searchParams.get('period'),'6m');
  const options=p.getByRole('button',{name:'Opções do gráfico',exact:true});await options.click();
  const menu=p.locator('.finance-menu:popover-open');assert(await menu.isVisible());
  const menuBox=await menu.boundingBox();assert(menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=1280);
  await options.click();assert.equal(await p.locator('.finance-menu:popover-open').count(),0);
  await p.getByRole('button',{name:'Gráfico de velas',exact:true}).click();assert.equal(await p.locator('.finance-price-line').count(),0);assert.deepEqual(await p.locator('.finance-candle').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).fill)),['rgb(79, 155, 80)','rgb(240, 91, 104)']);
  await p.getByRole('button',{name:'Gráfico de linha',exact:true}).click();assert.equal(await p.locator('.finance-price-line').count(),2);
  assert.equal(await p.getByRole('button',{name:'Comparar',exact:true}).count(),0);
  await options.click();if(await p.getByRole('menuitemcheckbox',{name:'Escala percentual',exact:true}).getAttribute('aria-checked')!=='true')await p.getByRole('menuitemcheckbox',{name:'Escala percentual',exact:true}).click();await p.getByRole('menuitemcheckbox',{name:'Média móvel (20 períodos)',exact:true}).click();await p.keyboard.press('Escape');
  assert((await p.locator('.finance-axis-label').allTextContents()).some(text=>text.includes('%')));
  const host=p.locator('#market-chart');await host.scrollIntoViewIfNeeded();const box=await host.boundingBox();assert(box);
  await p.mouse.move(box.x+box.width*.4,box.y+140);assert(await p.locator('#chart-tooltip').isVisible());const firstCursor=await p.locator('.finance-cursor').getAttribute('d');await p.mouse.move(box.x+box.width*.4+2,box.y+140);assert.notEqual(await p.locator('.finance-cursor').getAttribute('d'),firstCursor);
  const tipBefore=await p.locator('#chart-tooltip').boundingBox();assert(tipBefore);await p.mouse.move(box.x+box.width*.4+2,box.y+170);const tipAfter=await p.locator('#chart-tooltip').boundingBox();assert(tipAfter&&Math.abs(tipAfter.y-tipBefore.y-30)<2);assert(tipAfter.x>box.x+box.width*.4&&tipAfter.y>box.y+170);assert.equal(await p.locator('.finance-main-svg').getByText(/^Inicial:/).count(),0);
  await p.mouse.move(box.x+box.width-10,box.y+130);const outside=await p.locator('#chart-tooltip').boundingBox();assert(outside&&outside.x+outside.width>box.x+box.width);await p.mouse.move(box.x+box.width*.4,box.y+140);assert.equal(await p.locator('.finance-cursor').getAttribute('stroke-dasharray'),null);
  assert.deepEqual(await p.locator('#chart-tooltip dt').allTextContents(),['Final','Inicial','Máxima','Mínima','Movimentação']);
  await p.mouse.down();await p.mouse.move(box.x+box.width*.7,box.y+140,{steps:8});assert(await p.locator('#chart-tooltip strong').isVisible());assert.match(await p.locator('#chart-tooltip strong').innerText(),/\(.*%\)/);assert.equal(await p.locator('#chart-tooltip strong').getAttribute('data-trend'),'up');assert.equal(await p.locator('#chart-tooltip strong').evaluate(el=>getComputedStyle(el).color),'rgb(79, 155, 80)');assert.equal(await p.locator('#market-change').getAttribute('data-trend'),'up');assert(await p.locator('.finance-selection').isVisible());assert.equal(await p.locator('.finance-selection').evaluate(el=>getComputedStyle(el).fill),'rgb(231, 231, 231)');await p.mouse.up();assert.equal(await p.locator('.finance-selection').count(),0);assert.equal(await p.locator('#chart-tooltip strong').count(),0);
  await p.mouse.move(box.x+box.width*.1,box.y+140);await p.mouse.down();await p.mouse.move(box.x+box.width*.4,box.y+180,{steps:5});assert.equal(await p.locator('.finance-range-value').getAttribute('data-trend'),'down');assert.equal(await p.locator('.finance-range-value').evaluate(el=>getComputedStyle(el).color),'rgb(240, 91, 104)');assert.match(await p.locator('.finance-range-value').innerText(),/\(-.*%\)/);assert.equal(await p.locator('#market-change').getAttribute('data-trend'),'down');await p.screenshot({path:path.join(root,'artifacts/finance-pointer-selection.png')});await p.mouse.up();
  const yTicks=await p.locator('.finance-axis-label[x="20"]').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,y:n.getAttribute('y')})));await p.mouse.wheel(0,-250);await p.getByRole('button',{name:'Redefinir zoom'}).waitFor();assert.deepEqual(await p.locator('.finance-axis-label[x="20"]').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,y:n.getAttribute('y')}))),yTicks);await p.getByRole('button',{name:'Redefinir zoom'}).click();
  await host.focus();await host.press('Home');assert.match(await p.locator('#market-price').ariaSnapshot(),/100,00/);await host.press('ArrowRight');assert(!/100,00/.test(await p.locator('#market-price').ariaSnapshot()));
  await p.mouse.move(10,10);assert.equal(await p.locator('#chart-tooltip').count(),0);
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'Baixar imagem',exact:true}).click();const png=await download;assert.equal(png.suggestedFilename(),'comet-grafico.png');await png.saveAs(path.join(root,'artifacts/finance-export.png'));
  await p.getByRole('button',{name:'Tela cheia',exact:true}).click();assert(await p.getByRole('dialog',{name:'Finanças em tela cheia'}).isVisible());const expanded=await p.locator('.is-fullscreen').boundingBox(),content=await p.locator('.workspace__content').boundingBox();assert(expanded&&content&&expanded.x===content.x&&expanded.y===0);assert.equal(await p.locator('.finance-view-tabs').isVisible(),false);assert.equal(await p.locator('.chart-statistics').isVisible(),false);assert.equal((await p.locator('#market-chart').boundingBox())?.height,450);await p.screenshot({path:path.join(root,'artifacts/finance-fullscreen.png')});await p.keyboard.press('Escape');assert.equal(await p.locator('.is-fullscreen').count(),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('finance history: periods, custom range, intervals, sorting, pagination and complete CSV',async()=>{
 const f=await fixture(),p=f.page;
 try {
  await period(p,'1D');assert.equal(f.requests.at(-1)?.searchParams.get('interval'),'movement');
  await p.getByRole('button',{name:'Planilha',exact:true}).click();assert.equal(await p.locator('.finance-sheet tbody tr').count(),20);
  assert.equal(await p.locator('.finance-sheet-page-label').innerText(),'Página 1 de 2');await p.locator('[data-sheet-page="next"]').click();assert.equal(await p.locator('.finance-sheet-page-label').innerText(),'Página 2 de 2');
  await p.getByRole('button',{name:'Data',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.finance-sheet-page-label')?.textContent==='Página 1 de 2');assert.equal(await p.locator('.finance-sheet-page-label').innerText(),'Página 1 de 2');assert.match(await p.locator('.finance-sheet tbody tr').first().innerText(),/1 de set/);
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'Exportar CSV',exact:true}).click();const csv=await download;const file=await csv.path();assert(file);const content=fs.readFileSync(file,'utf8');assert.equal(content.split('\r\n').length,41);assert.match(content,/Inicial;Máxima;Mínima;Final;Movimentação/);
  await p.getByLabel('Intervalo dos dados').selectOption('week');await loaded(p);assert.equal(f.requests.at(-1)?.searchParams.get('interval'),'week');
  await p.getByRole('button',{name:'Selecionar datas',exact:true}).click();
  await p.getByLabel('Data inicial',{exact:true}).fill('2026-10-01');await p.getByLabel('Data final',{exact:true}).fill('2026-10-10');await p.getByRole('button',{name:'Aplicar período'}).click();await loaded(p);
  assert.equal(f.requests.at(-1)?.searchParams.get('period'),'custom');assert.equal(f.requests.at(-1)?.searchParams.get('start'),'2026-10-01');assert.equal(f.requests.at(-1)?.searchParams.get('end'),'2026-10-10');
  await p.getByRole('button',{name:'Gráfico',exact:true}).click();assert(await p.locator('.finance-main-svg').isVisible());
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('finance refresh: empty, single point, negative balances, errors and discarded stale responses',async()=>{
 const f=await fixture(),p=f.page;
 try {
  f.setData(chartData(0,200));await changed(p);assert.match(await p.locator('#market-price').ariaSnapshot(),/200,00/);assert(await p.locator('#chart-state').isVisible());
  f.setData(chartData(1,-100));await changed(p);assert.equal(await p.locator('#chart-state').count(),0);await p.locator('#market-chart').focus();await p.locator('#market-chart').press('Home');assert.match(await p.locator('#market-price').ariaSnapshot(),/-R\$.*100,00/);
  f.fail(true);await changed(p);assert.match(await p.locator('.finance-chart-error').innerText(),/Banco indisponível/);assert.match(await p.locator('#market-price').ariaSnapshot(),/100,00/);
  f.fail(false);f.setData(chartData(3,300));await p.getByRole('button',{name:'Tentar novamente'}).click();await p.locator('.finance-chart-error').waitFor({state:'hidden'});await loaded(p);assert.equal(await p.locator('.finance-chart-error').count(),0);
  f.delay(400);f.setData(chartData(5,500));await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));await p.waitForTimeout(30);
  f.delay(0);f.setData(chartData(0,900));await period(p,'1M');await p.waitForTimeout(500);assert.match(await p.locator('#market-price').ariaSnapshot(),/900,00/);
  await p.route('**/api/finance/chart*',route=>route.fulfill({json:{...chartData(),series:{balance:{points:[{close:'invalid'}]}}}}));
  await changed(p);assert(await p.locator('.finance-chart-error').isVisible());
  await p.evaluate(()=>window.WorkspaceNavigation.go('/novo.html?new=1'));await p.waitForSelector('.computer-page');await p.evaluate(()=>dispatchEvent(new Event('finance:changed')));assert.equal(await p.locator('.finance-menu').count(),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [390,1280])for(const theme of ['dark','light'])test(`finance responsive ${width} ${theme}`,async()=>{
 const f=await fixture(width,theme),p=f.page;
 try {
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const surface=await p.locator('.market-card').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(surface,theme==='dark'?'rgb(30, 30, 30)':'rgb(255, 255, 255)');
  await p.getByRole('button',{name:'Opções do gráfico',exact:true}).click();const menu=p.locator('.finance-menu:popover-open'),box=await menu.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width);
  await p.keyboard.press('Escape');
  if(width===390&&theme==='dark'){
   const svg=p.locator('.finance-main-svg'),area=await svg.boundingBox();assert(area);
   const session=await p.context().newCDPSession(p);
   const touchPoints=[{x:area.x+100,y:area.y+120,id:1},{x:area.x+190,y:area.y+120,id:2}];
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});
   await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...touchPoints[0],x:area.x+65},{...touchPoints[1],x:area.x+230}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await p.getByRole('button',{name:'Redefinir zoom'}).waitFor();await p.getByRole('button',{name:'Redefinir zoom'}).click();await session.detach();
  }
  await p.screenshot({path:path.join(root,`artifacts/finance-${width}-${theme}.png`),fullPage:true});
  await p.getByRole('button',{name:'Planilha',exact:true}).click();assert.equal(await p.locator('.market-card').evaluate(el=>getComputedStyle(el).backgroundColor),surface);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await p.locator('.finance-sheet').evaluate(el=>el.scrollWidth>=el.clientWidth));
  await p.screenshot({path:path.join(root,`artifacts/finance-history-${width}-${theme}.png`),fullPage:true});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});


test('finance number rolling and reduced motion, pointer cancellation and icon sources',async()=>{
 const f=await fixture(1280,'dark','no-preference'),p=f.page;
 try {
  for(const icon of ['calendar','expand','camera'])assert((await p.locator('.finance-icon--'+icon).first().evaluate(el=>getComputedStyle(el).maskImage)).includes('finance-'+icon));
  const host=p.locator('#market-chart');await host.scrollIntoViewIfNeeded();await host.focus();await host.press('Home');
  const number=p.locator('#market-price number-flow-react');await number.waitFor();
  await p.waitForTimeout(950);await host.press('ArrowRight');
  const timings=await number.evaluate(el=>el.shadowRoot!.getAnimations().filter(a=>a.playState==='running').map(a=>a.effect?.getTiming()));
  assert(timings.some(t=>t?.duration===900&&t.easing?.startsWith('linear(')));await host.press('End');assert(await number.evaluate(el=>el.shadowRoot!.getAnimations().some(a=>a.effect?.getTiming().duration===450)));
  await p.emulateMedia({reducedMotion:'reduce'});await host.press('Home');assert.equal(await number.evaluate(el=>el.shadowRoot!.getAnimations().filter(a=>a.playState==='running').length),0);
  const box=await host.boundingBox();assert(box);await p.mouse.move(box.x+100,box.y+140);await p.mouse.down();await p.mouse.move(box.x+200,box.y+140);assert(await p.locator('.finance-selection').isVisible());await p.mouse.move(box.x-4,box.y+140);assert.equal(await p.locator('.finance-selection').count(),0);assert.equal(await p.locator('.finance-cursor').count(),0);await p.mouse.up();
  await p.mouse.move(box.x+100,box.y+140);await p.mouse.down();await p.mouse.move(box.x+200,box.y+140);await p.locator('.finance-main-svg').dispatchEvent('pointercancel');assert.equal(await p.locator('.finance-selection').count(),0);await p.mouse.up();
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
