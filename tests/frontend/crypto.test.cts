import path = require('node:path');
import assert = require('node:assert/strict');
import {test,before,after} from 'node:test';
import {chromium,type Browser} from 'playwright';
import {startNextServer} from './next-server.cjs';
const root=path.resolve(__dirname,'../..');
let browser:Browser,server:Awaited<ReturnType<typeof startNextServer>>;
before(async()=>{server=await startNextServer(root);browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});});
after(async()=>{await browser?.close();await server?.stop();});
const makeAsset=(id:string,symbol:string,name:string,price:number,changePercent:number)=>({id,symbol,name,kind:'crypto',price,change:price*changePercent/100,changePercent,marketCap:price*1e6,volume:price*1e4,points:[price*.95,price*.96,price*.94,price]});
const assets=[makeAsset('bitcoin','BTC','Bitcoin',65000,3),makeAsset('ethereum','ETH','Ethereum',2500,-2),makeAsset('solana','SOL','Solana',150,5)];
const catalog=[...assets,makeAsset('cardano','ADA','Cardano',.4,-1),makeAsset('dogecoin','DOGE','Dogecoin',.1,2),makeAsset('tether','USDT','Tether',1,0),makeAsset('ripple','XRP','XRP',.5,1),makeAsset('chainlink','LINK','Chainlink',9,4)];
const source={provider:'CoinGecko',sourceUrl:'https://www.coingecko.com/en/api',asOf:'2026-10-18T12:00:00Z',stale:false};
const dashboard={assets,top:assets,...source,configured:true,notice:'Dados agregados em USD.'};
async function fixture(width=1440,theme='dark',url='/finance/crypto'){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',acceptDownloads:true});
 await context.addInitScript(theme=>{localStorage.setItem('ascenda-cookie-choice-v1','accepted');localStorage.setItem('ascensao-theme',theme);},theme);
 const errors:string[]=[],historyRequests:URL[]=[],searchRequests:string[]=[],newsRequests:string[]=[],chatRequests:Record<string,unknown>[]=[];let historyFailure=false,userId=7,searchDelay=0,searchFailure=false,failedCoin='',historyDelay=0;
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/bootstrap')return route.fulfill({json:{page:url.searchParams.get('page'),user:{id:userId,nome:'Teste',email:'teste@example.com'},csrfToken:'test-csrf',currentYear:2026}});
  if(url.pathname==='/api/finance/crypto')return route.fulfill({json:dashboard});
  if(url.pathname==='/api/finance/crypto/search'){
   const q=url.searchParams.get('q')||'';searchRequests.push(q);
   const fail=searchFailure;if(searchDelay)await new Promise(resolve=>setTimeout(resolve,searchDelay));
   return route.fulfill(fail?{status:503,json:{error:'Indisponível'}}:{json:{assets:(q?catalog:assets).filter(a=>!q||(a.name+' '+a.symbol).toLowerCase().includes(q.toLowerCase())),...source}});
  }
  if(url.pathname==='/api/finance/crypto/asset'){
   const asset=catalog.find(a=>a.id===url.searchParams.get('id'));
   return route.fulfill(asset?{json:{asset,...source}}:{status:404,json:{error:'Criptomoeda não encontrada.'}});
  }
  if(url.pathname==='/api/finance/crypto/history'){
   historyRequests.push(url);if(historyDelay)await new Promise(resolve=>setTimeout(resolve,historyDelay));if(historyFailure||url.searchParams.get('id')===failedCoin)return route.fulfill({status:503,json:{error:'Histórico temporariamente indisponível.'}});
   const coin=catalog.find(a=>a.id===url.searchParams.get('id')),base=coin?.price??65000,drift=(catalog.indexOf(coin!)+1)*.003;
   return route.fulfill({json:{points:Array.from({length:20},(_,i)=>({time:Date.parse('2026-10-17T12:00:00Z')+i*21600000,value:base*(1+Math.sin(i/2)*.1+i*drift)})),...source,currency:'USD'}});
  }
  if(url.pathname==='/api/news'){newsRequests.push(url.href);return route.fulfill({json:{articles:Array.from({length:7},(_,i)=>({id:String(i),title:`Notícia cripto ${i+1}`,description:'Resumo verificável da notícia de teste.',url:`https://example.com/news/${i}`,image:'',source:'Fonte de teste',published_at:'2026-10-18T12:00:00Z'})),has_more:false,page:1}});}
  if(url.pathname==='/api/finance/chart')return route.fulfill({status:503,json:{error:'Sem dados no teste do compositor'}});
  if(url.pathname==='/api/finance/transactions')return route.fulfill({json:{transactions:[],next_cursor:null}});
  if(url.pathname==='/api/ai/conversations')return route.fulfill({json:{conversations:[],next_offset:null}});
  if(url.pathname==='/api/ai/models')return route.fulfill({json:{models:[{id:'gemini',configured:true},{id:'qwen3:1.7b',configured:true}]}});
  if(url.pathname==='/api/ai/chat'){chatRequests.push(req.postDataJSON());return route.fulfill({contentType:'application/x-ndjson',body:'{"type":"delta","text":"Resposta sobre cripto."}\n{"type":"done","metadata":{}}\n'});}
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
  return url.origin===server.origin?route.continue():route.fulfill({status:404,body:''});
 });
 const page=await context.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.origin+url);
 await page.locator('.crypto-composer').waitFor();await page.waitForFunction(()=>Boolean(window.ComputerModels));await page.evaluate(()=>window.ComputerModels.whenReady());
 return {page,errors,historyRequests,searchRequests,newsRequests,chatRequests,historyFailure:(v:boolean)=>{historyFailure=v;},failedCoin:(id:string)=>{failedCoin=id;},historyDelay:(v:number)=>{historyDelay=v;},searchDelay:(v:number)=>{searchDelay=v;},searchFailure:(v:boolean)=>{searchFailure=v;},user:(id:number)=>{userId=id;},close:async()=>{await context.unrouteAll({behavior:'wait'});await context.close();}};
}

test('crypto: only two sections, sorting and centered asynchronous search with keyboard navigation',async()=>{
 const f=await fixture(),p=f.page;
 try {
  assert.equal(await p.title(),'Cripto — Comet');
  assert.deepEqual(await p.locator('.finance-section-tabs a').allTextContents(),['Minhas finanças','Cripto']);
  assert.equal(await p.locator('.sidebar__link[aria-label="Finanças"]').getAttribute('aria-current'),'page');
  assert.equal((await p.request.get(server.origin+'/finance/markets')).status(),404);
  const table=p.locator('.market-table');await table.locator('tbody tr').first().waitFor();
  await table.getByRole('button',{name:'Variação 24h'}).click();assert.match(await table.locator('tbody tr').first().innerText(),/Solana/);
  await table.getByRole('button',{name:'Variação 24h'}).click();assert.match(await table.locator('tbody tr').first().innerText(),/Ethereum/);
  const search=p.getByRole('combobox',{name:'Pesquisar criptomoedas'});
  const header=await p.locator('.crypto-header').boundingBox(),field=await search.boundingBox();assert(header&&field);assert(Math.abs(field.x+field.width/2-(header.x+header.width/2))<25);
  await search.focus();await p.getByRole('listbox',{name:'Criptomoedas em alta'}).waitFor();assert.equal(await p.getByRole('option').count(),3);
  const menu=await p.locator('.crypto-search-menu').boundingBox();assert(menu&&menu.width>field.width);assert(Math.abs(menu.x+menu.width/2-(header.x+header.width/2))<2);
  f.searchDelay(700);await search.fill('Bitcoin');await p.getByRole('status').filter({hasText:'Buscando criptomoedas'}).waitFor();assert.equal(await p.getByRole('option').count(),0);
  assert.equal(await table.locator('tbody tr').count(),3);
  await p.getByRole('option').filter({hasText:'Bitcoin'}).waitFor();assert.equal(await p.getByRole('option').count(),1);
  await p.screenshot({path:path.join(root,'artifacts/crypto-search.png')});
  assert.match(await p.locator('.crypto-search-clear i').evaluate(el=>getComputedStyle(el).maskImage),/x(?:\.[\w-]+)?\.svg/);
  await p.getByRole('button',{name:'Limpar pesquisa'}).click();await p.getByRole('listbox',{name:'Criptomoedas em alta'}).waitFor();
  await p.keyboard.press('Escape');assert.equal(await p.locator('.crypto-search-menu').count(),0);
  await search.blur();await search.focus();await p.getByRole('option').first().waitFor();await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
  await p.getByRole('heading',{name:'Bitcoin',exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/finance/crypto/bitcoin');assert.equal(await p.getByRole('dialog').count(),0);
  await p.goBack();await p.getByRole('heading',{name:'Ranking de criptomoedas'}).waitFor();assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('crypto: search handles empty results, failures, retry and superseded requests',async()=>{
 const f=await fixture(),p=f.page,search=p.getByRole('combobox',{name:'Pesquisar criptomoedas'});
 try {
  await search.fill('não existe');await p.getByText('Nenhuma criptomoeda encontrada.',{exact:true}).waitFor();
  f.searchFailure(true);await search.fill('eth');await p.getByText('Não foi possível buscar criptomoedas.',{exact:true}).waitFor();
  f.searchFailure(false);await p.locator('.crypto-search-menu').getByRole('button',{name:'Tentar novamente'}).click();await p.getByRole('option').filter({hasText:'Ethereum'}).waitFor();
  f.searchDelay(700);await search.fill('bitcoin');await p.waitForTimeout(300);await search.fill('sol');await p.getByRole('option').filter({hasText:'Solana'}).waitFor();assert.equal(await p.getByRole('option').count(),1);
  await p.getByRole('heading',{name:'Ranking de criptomoedas'}).click();assert.equal(await p.locator('.crypto-search-menu').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('crypto: direct asset page, history periods and comparison, favorite migration and isolation',async()=>{
 const f=await fixture(),p=f.page;
 try {
  await p.evaluate(()=>localStorage.setItem('comet:markets:watchlist:7',JSON.stringify([{id:'bitcoin',kind:'crypto',symbol:'BTC',name:'Bitcoin'},{id:'AAPL',kind:'stock',symbol:'AAPL',name:'Apple'}])));
  await p.reload();await p.getByRole('button',{name:'Remover Bitcoin da lista'}).waitFor();
  assert.equal(await p.evaluate(()=>localStorage.getItem('comet:markets:watchlist:7')),null);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('comet:crypto:watchlist:7')||'[]').length),1);
  await p.locator('.market-table-asset').filter({hasText:'Bitcoin'}).click();await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();assert.equal(await p.title(),'Bitcoin (BTC) — Comet');
  await p.reload();await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();assert.equal(new URL(p.url()).pathname,'/finance/crypto/bitcoin');
  await p.locator('#market-chart').focus();await p.keyboard.press('Home');assert.match(await p.locator('#market-price').ariaSnapshot(),/65.000,00/);
  const response=p.waitForResponse(r=>r.url().includes('/history?')&&r.url().includes('range=5d'));await p.getByRole('button',{name:'5D',exact:true}).click();await response;await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();
  await p.getByRole('button',{name:'Comparar',exact:true}).click();await p.getByRole('option').filter({hasText:'Ethereum'}).click();await p.locator('.finance-comparison-line').waitFor();assert.equal(await p.locator('.crypto-comparison-row').count(),2);
  assert.match(await p.locator('.market-save i').evaluate(el=>getComputedStyle(el).maskImage),/check(?:\.[\w-]+)?\.svg/);
  await p.screenshot({path:path.join(root,'artifacts/crypto-asset.png')});
  f.user(8);await p.reload();await p.getByRole('button',{name:'Acompanhar',exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Remover Bitcoin da lista'}).count(),0);
  f.historyFailure(true);await p.getByRole('button',{name:'5D',exact:true}).click();await p.locator('.market-history').getByRole('button',{name:'Tentar novamente'}).waitFor();assert.equal(await p.locator('.finance-main-svg').count(),0);
  f.historyFailure(false);await p.locator('.market-history').getByRole('button',{name:'Tentar novamente'}).click();await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [390,1440])for(const theme of ['dark','light'])test(`crypto: responsive layout and paginated Discover ${width} ${theme}`,async()=>{
 const f=await fixture(width,theme),p=f.page;
 try {
  await p.locator('.market-table tbody tr').first().waitFor();await p.evaluate(()=>document.fonts.ready);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const header=await p.locator('.crypto-header').boundingBox(),tabs=await p.locator('.finance-section-tabs').boundingBox();assert(header&&tabs&&header.y+header.height<=tabs.y+1);
  const form=await p.locator('.finance-composer form').boundingBox(),column=await p.locator('.crypto-main').boundingBox();assert(form&&column&&Math.abs(form.x-column.x)<2&&Math.abs(form.width-column.width)<2);
  const discover=p.getByRole('region',{name:'Descobrir notícias'});await discover.scrollIntoViewIfNeeded();const size=width===390?1:3;
  await p.waitForFunction(n=>document.querySelectorAll('.market-news-page a').length===n,size);
  assert.equal(await discover.locator('.market-carousel-dots button').count(),Math.ceil(7/size));assert.equal(await discover.getByRole('button',{name:'Notícias anteriores'}).isDisabled(),true);
  await discover.getByRole('button',{name:'Próximas notícias'}).click();assert.match(await discover.locator('.market-news-page').innerText(),new RegExp(`Notícia cripto ${size+1}`));
  assert.equal(await discover.getByRole('button',{name:'Página 2 de notícias'}).getAttribute('aria-current'),'page');
  await discover.getByRole('button',{name:'Página 1 de notícias'}).click();assert.match(await discover.locator('.market-news-page').innerText(),/Notícia cripto 1/);
  assert(await discover.locator('.market-news-pages').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await p.screenshot({path:path.join(root,`artifacts/crypto-${width}-${theme}.png`),fullPage:true});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('crypto: shared finance composer style and controls, model selection and one chat submission',async()=>{
 const f=await fixture(),p=f.page;
 try {
  const properties=['padding','borderRadius','borderColor','backgroundColor','fontFamily'];
  const signature=async()=>p.locator('.finance-composer form').evaluate((el,keys)=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(el).getPropertyValue(k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()))])),properties);
  const appearance=await signature();const controls=await p.locator('.finance-composer .home__toolbar button').evaluateAll(els=>els.map(e=>e.getAttribute('aria-label')));
  assert(await p.getByRole('button',{name:'Ditar mensagem'}).isVisible());assert(await p.locator('.model-picker').isVisible());assert(await p.locator('.computer-provider').isVisible());
  await p.locator('.finance-section-tabs').getByRole('link',{name:'Minhas finanças'}).click();await p.locator('.finance-page .finance-composer').waitFor();await p.evaluate(()=>window.ComputerModels.whenReady());
  assert.deepEqual(await signature(),appearance);assert.deepEqual(await p.locator('.finance-composer .home__toolbar button').evaluateAll(els=>els.map(e=>e.getAttribute('aria-label'))),controls);
  await p.locator('.finance-section-tabs').getByRole('link',{name:'Cripto',exact:true}).click();await p.locator('.crypto-composer').waitFor();await p.evaluate(()=>window.ComputerModels.whenReady());
  await p.evaluate(()=>window.ComputerModels.select('qwen3:1.7b'));
  const input=p.locator('.crypto-composer textarea');const first=(await input.boundingBox())!.height;await input.fill('Linha 1\nLinha 2\nLinha 3');assert((await input.boundingBox())!.height>first);
  await input.fill('O que explica a variação do Bitcoin?');await input.press('Enter');
  await p.waitForFunction(()=>document.querySelector('.computer-message--assistant')?.textContent?.includes('Resposta sobre cripto.'));
  assert.equal(f.chatRequests.length,1);assert.equal(f.chatRequests[0].message,'O que explica a variação do Bitcoin?');assert.equal(f.chatRequests[0].provider,'qwen3:1.7b');assert.equal(f.chatRequests[0].web_search,true);assert.equal(f.chatRequests[0].conversation_id,null);
  assert.equal(await p.evaluate(()=>window.CometCryptoQuestion),undefined);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('crypto: unknown asset has recoverable page and composer',async()=>{
 const f=await fixture(1440,'dark','/finance/crypto/nonexistent'),p=f.page;
 try {await p.getByText('Criptomoeda não encontrada.',{exact:true}).waitFor();assert(await p.locator('.crypto-composer form').isVisible());await p.getByRole('link',{name:'Voltar para Cripto'}).click();await p.getByRole('heading',{name:'Ranking de criptomoedas'}).waitFor();assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

for(const width of [390,1440])for(const theme of ['dark','light'])test(`crypto: shared chart interactions, header and price timeline ${width} ${theme}`,async()=>{
 const f=await fixture(width,theme,'/finance/crypto/ethereum'),p=f.page;
 try {
  await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();
  assert.match(await p.locator('.crypto-header').innerText(),/Finanças[\s\S]*ETH\/USD/);
  assert.equal(await p.locator('.market-breadcrumb,.market-data-line').count(),0);assert.equal(await p.locator('.market-notice').count(),0);
  assert.equal(await p.getByRole('region',{name:'Descobrir notícias'}).count(),0);assert.deepEqual(f.newsRequests,[]);
  assert.equal(await p.getByText('Dados agregados em USD fornecidos pela CoinGecko; atualização a cada 5 minutos.',{exact:true}).count(),0);
  const colors=await p.locator('.finance-price-line').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).stroke));assert.deepEqual(colors,theme==='dark'?['rgb(64, 201, 119)','rgb(255, 133, 131)']:['rgb(0, 134, 53)','rgb(224, 46, 42)']);
  const host=p.locator('#market-chart');await host.scrollIntoViewIfNeeded();await host.focus();await host.press('Home');assert.match(await p.locator('#market-price').ariaSnapshot(),/US\$.*2.500,00/);assert.doesNotMatch(await p.locator('#chart-tooltip').innerText(),/R\$/);
  const area=await host.boundingBox();assert(area);await p.mouse.move(area.x+area.width*.2,area.y+100);await p.mouse.down();await p.mouse.move(area.x+area.width*.65,area.y+100);
  assert(await p.locator('.finance-selection').isVisible());assert.match(await p.locator('.finance-range-value').innerText(),/US\$/);await p.mouse.up();assert.equal(await p.locator('.finance-selection').count(),0);
  await host.focus();await host.press('+');await p.getByRole('button',{name:'Redefinir zoom'}).waitFor();await p.getByRole('button',{name:'Redefinir zoom'}).click();
  await p.getByRole('button',{name:'Gráfico de velas',exact:true}).click();assert.equal(await p.locator('.finance-candle').count(),2);assert.equal(await p.locator('.finance-price-line').count(),0);await p.getByText('Velas calculadas a partir das cotações amostradas · UTC.',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Gráfico de linha',exact:true}).click();
  await p.getByRole('button',{name:'Opções do gráfico',exact:true}).click();await p.getByRole('menuitemcheckbox',{name:'Linhas de grade',exact:true}).click();assert.equal(await p.locator('.finance-grid-line').count(),0);
  await p.getByRole('menuitemcheckbox',{name:'Linhas de grade',exact:true}).click();assert(await p.locator('.finance-grid-line').count()>0);
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'Exportar CSV',exact:true}).click();assert.match((await download).suggestedFilename(),/comet-ethereum-1m.csv/);
  await p.getByRole('button',{name:'Tela cheia',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Ethereum em tela cheia'});await dialog.waitFor();assert.equal(await p.locator('.finance-composer').isVisible(),false);await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  const timeline=p.getByRole('region',{name:'Movimentos de preço',exact:true});await timeline.scrollIntoViewIfNeeded();assert(await timeline.locator('li').count()>0);assert(await timeline.locator('.crypto-timeline-source').count()>0);assert.doesNotMatch(await timeline.innerText(),/Mercado fechado|Nasdaq/);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await p.locator('.market-stat-grid dd').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1)));
  assert.match(await p.locator('.finance-main-svg').textContent()||'',/out/);
  const breadcrumb=await p.locator('.crypto-header-breadcrumb').boundingBox(),search=await p.locator('.crypto-search').boundingBox();assert(breadcrumb&&search&&breadcrumb.x+breadcrumb.width<=search.x);
  await p.screenshot({path:path.join(root,`artifacts/crypto-timeline-${width}-${theme}.png`)});await host.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(root,`artifacts/crypto-shared-chart-${width}-${theme}.png`)});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('crypto: same number animation and reduced motion as personal finance',async()=>{
 const f=await fixture(1440,'dark','/finance/crypto/bitcoin'),p=f.page;
 try {
  await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();const host=p.locator('#market-chart');await host.scrollIntoViewIfNeeded();await host.focus();await host.press('Home');
  const number=p.locator('#market-price number-flow-react');await p.waitForTimeout(950);await host.press('ArrowRight');
  assert(await number.evaluate(el=>el.shadowRoot!.getAnimations().some(animation=>animation.effect?.getTiming().duration===900)));
  await p.emulateMedia({reducedMotion:'reduce'});await host.press('End');assert.equal(await number.evaluate(el=>el.shadowRoot!.getAnimations().filter(animation=>animation.playState==='running').length),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

async function compare(p:import('playwright').Page,name:string){
 await p.getByRole('button',{name:'Comparar',exact:true}).click();
 await p.getByRole('combobox',{name:'Pesquisar moedas para comparar'}).fill(name);
 await p.locator('.crypto-compare-menu').getByRole('option').filter({hasText:name}).click();
}
test('crypto comparison: asynchronous menu, multiple colors, URL and removal preserve primary and composer',async()=>{
 const f=await fixture(1440,'dark','/finance/crypto/bitcoin?keep=1'),p=f.page;
 try{
  await p.locator('.market-history[aria-busy=false] .finance-main-svg').waitFor();
  await p.locator('.crypto-composer textarea').fill('Meu rascunho');
  const primaryCalls=()=>f.historyRequests.filter(u=>u.searchParams.get('id')==='bitcoin').length;
  const before=primaryCalls();f.searchDelay(500);f.historyDelay(300);
  await p.getByRole('button',{name:'Comparar',exact:true}).click();
  await p.getByRole('status').filter({hasText:'Buscando moedas para comparar'}).waitFor();
  const search=p.getByRole('combobox',{name:'Pesquisar moedas para comparar'});await search.fill('Ethereum');
  await p.locator('.crypto-compare-menu').getByRole('option').first().waitFor();await search.press('ArrowDown');await search.press('Enter');
  await p.locator('.finance-comparison-line[data-asset="ethereum"]').waitFor();assert.equal(await p.locator('.crypto-compare-menu').isVisible(),false);
  assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin,ethereum');assert.equal(new URL(p.url()).searchParams.get('keep'),'1');
  await compare(p,'Solana');await p.locator('.finance-comparison-line[data-asset="solana"]').waitFor();
  assert.equal(await p.locator('.crypto-comparison-row').count(),3);assert.equal(primaryCalls(),before);assert.equal(await p.locator('.crypto-composer textarea').inputValue(),'Meu rascunho');
  assert.equal(await p.locator('.finance-price-line').count(),1);
  const lineColors=await p.locator('.finance-price-line,.finance-comparison-line').evaluateAll(els=>els.map(el=>getComputedStyle(el).stroke));
  const rowColors=await p.locator('.crypto-comparison-row').evaluateAll(els=>els.map(el=>getComputedStyle(el,'::before').backgroundColor));assert.deepEqual(lineColors,rowColors);
  await p.locator('.crypto-comparison-row[data-asset="ethereum"]').hover();assert.equal(await p.locator('.finance-price-line').getAttribute('opacity'),'0.2');assert.equal(await p.locator('.finance-comparison-line[data-asset="ethereum"]').getAttribute('opacity'),'1');
  assert.equal(await p.getByRole('button',{name:'Remover Bitcoin da comparação',exact:true}).count(),0);
  await p.locator('#market-chart').focus();await p.keyboard.press('Home');assert.match(await p.locator('.crypto-comparison-row[data-asset="ethereum"]').ariaSnapshot(),/2.500,00/);
  assert.match(await p.locator('.crypto-comparison-row .crypto-comparison-remove i').first().evaluate(el=>getComputedStyle(el).maskImage),/x(?:\.[\w-]+)?\.svg/);
  await p.keyboard.press('Escape');await p.screenshot({path:path.join(root,'artifacts/crypto-comparison.png')});
  await p.getByRole('button',{name:'Remover Ethereum da comparação',exact:true}).click();assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin,solana');
  await p.getByRole('button',{name:'Remover Solana da comparação',exact:true}).click();assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin');assert.equal(await p.locator('.crypto-comparison-legend').count(),0);assert.equal(await p.locator('.finance-price-line').count(),2);
  assert.equal(primaryCalls(),before);assert.equal(await p.locator('.crypto-composer textarea').inputValue(),'Meu rascunho');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('crypto comparison: direct links, reload, periods, failures, retry and primary promotion',async()=>{
 const f=await fixture(1440,'dark','/finance/crypto/bitcoin?comparing=bitcoin,ethereum,cardano,ethereum,../bad'),p=f.page;
 try{
  await p.locator('.finance-comparison-line[data-asset="cardano"]').waitFor();
  assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin,ethereum,cardano');assert.match(await p.locator('.crypto-comparison-legend').innerText(),/Cardano/);
  await p.reload();await p.locator('.finance-comparison-line[data-asset="cardano"]').waitFor();
  f.failedCoin('ethereum');await p.getByRole('button',{name:'5D',exact:true}).click();await p.getByText('Não foi possível carregar esta comparação.',{exact:false}).waitFor();
  await p.locator('.finance-comparison-line[data-asset="cardano"]').waitFor();assert.equal(await p.locator('.finance-comparison-line[data-asset="ethereum"]').count(),0);assert.equal(await p.locator('.finance-price-line').count(),1);
  const calls=f.historyRequests.length;f.failedCoin('');await p.locator('.crypto-comparison-row[data-asset="ethereum"]').getByRole('button',{name:'Tentar novamente'}).click();await p.locator('.finance-comparison-line[data-asset="ethereum"]').waitFor();assert.equal(f.historyRequests.length,calls+1);
  await p.getByRole('button',{name:'Gráfico de velas',exact:true}).click();assert.equal(await p.locator('.finance-comparison-line').count(),0);assert.equal(await p.getByRole('button',{name:'Comparar',exact:true}).count(),0);
  await p.getByRole('button',{name:'Gráfico de linha',exact:true}).click();await p.locator('.finance-comparison-line[data-asset="ethereum"]').waitFor();
  await p.getByRole('link',{name:'Ver Ethereum como ativo principal',exact:true}).click();await p.getByRole('heading',{name:'Ethereum',exact:true}).waitFor();await p.locator('.finance-comparison-line[data-asset="bitcoin"]').waitFor();
  assert.equal(new URL(p.url()).pathname,'/finance/crypto/ethereum');assert.equal(new URL(p.url()).searchParams.get('comparing'),'ethereum,bitcoin,cardano');
  await p.goBack();await p.getByRole('heading',{name:'Bitcoin',exact:true}).waitFor();await p.locator('.finance-comparison-line[data-asset="ethereum"]').waitFor();assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const width of [390,1440])test(`crypto comparison: menu viewport, fullscreen, keyboard and limit ${width}`,async()=>{
 const f=await fixture(width,'dark','/finance/crypto/bitcoin?comparing=bitcoin,ethereum,solana,cardano,dogecoin,tether,ripple,chainlink'),p=f.page;
 try{
  await p.locator('.finance-comparison-line[data-asset="ripple"]').waitFor();assert.equal(await p.locator('.crypto-comparison-row').count(),7);
  assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin,ethereum,solana,cardano,dogecoin,tether,ripple');
  await p.getByRole('button',{name:'Comparar',exact:true}).click();await p.locator('.crypto-compare-menu').getByRole('option').first().waitFor();
  const box=await p.locator('.crypto-compare-menu').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width&&box.y>=0);await p.keyboard.press('Escape');
  assert(await p.getByRole('button',{name:'Comparar',exact:true}).evaluate(el=>document.activeElement===el));
  await compare(p,'Ethereum');assert.equal(await p.locator('.crypto-comparison-row').count(),7);
  await p.getByRole('button',{name:'Tela cheia',exact:true}).click();
  await p.getByRole('button',{name:'Comparar',exact:true}).click();const search=p.getByRole('combobox',{name:'Pesquisar moedas para comparar'});await search.fill('Chainlink');await p.getByRole('option').filter({hasText:'Chainlink'}).waitFor();
  await p.screenshot({path:path.join(root,`artifacts/crypto-compare-menu-${width}.png`)});
  await search.press('ArrowDown');await search.press('Enter');await p.locator('.finance-comparison-line[data-asset="chainlink"]').waitFor();assert.equal(await p.locator('.crypto-comparison-row').count(),7);assert.equal(new URL(p.url()).searchParams.get('comparing'),'bitcoin,ethereum,solana,cardano,dogecoin,tether,chainlink');
  await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'hidden'});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const width of [1440,390])test(`crypto: sidebar quotes align, zero variation is neutral and list scrolls ${width}`,async()=>{
 const f=await fixture(width),p=f.page;
 try{
  const examples=[...catalog.map(a=>({...a})),makeAsset('tiny','TINY','Tiny coin',.000004,.0001)];examples[0].price=82103;examples[1].changePercent=-.0001;examples[2].changePercent=5.9;
  await p.route('**/api/finance/crypto',route=>route.fulfill({json:{...dashboard,assets:examples}}));await p.reload();await p.locator('.market-watchlist .market-asset-row').first().waitFor();
  const quotes=p.locator('.crypto-sidebar .market-asset-quote');
  for(const quote of await quotes.all()){
   const edges=await quote.locator(':scope > span').evaluateAll(es=>es.map(e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect().right;}));assert(Math.abs(edges[0]-edges[1])<2,JSON.stringify(edges));
  }
  const neutral=p.locator('.market-watchlist .market-asset-open').filter({hasText:'Ethereum'}).locator('.market-change');assert.equal(await neutral.innerText(),'0,00%');assert.match(await neutral.getAttribute('class')||'',/--neutral/);
  assert.match(await p.locator('.market-watchlist .market-asset-open').filter({hasText:'Solana'}).innerText(),/\+5,90%/);
  const scrolling=p.locator('.market-watchlist details > div');assert(await scrolling.evaluate(e=>e.scrollHeight>e.clientHeight));assert.equal(await scrolling.evaluate(e=>getComputedStyle(e).scrollbarWidth),'thin');
  await p.locator('.market-watchlist').screenshot({path:path.join(root,`artifacts/crypto-sidebar-fixed-${width}.png`)});
  await p.getByRole('button',{name:'Adicionar Bitcoin à lista'}).click();await p.getByRole('button',{name:'Remover Bitcoin da lista'}).waitFor();await p.getByRole('button',{name:'Remover Bitcoin da lista'}).click();
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
