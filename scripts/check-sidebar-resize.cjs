const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1200,height:800}});
 const html = `<style>${fs.readFileSync('static/css/globals.css','utf8')}${fs.readFileSync('static/css/principal.css','utf8')}</style><body class="workspace"><aside class="sidebar"><button class="sidebar__toggle"></button><nav class="sidebar__nav"></nav></aside><button class="workspace__menu-toggle"></button><div class="sidebar-backdrop"></div><main class="workspace__content"></main></body>`;
 await page.route('http://sidebar.test/**', route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://sidebar.test/');
 await page.addScriptTag({content:`window.optionalElement=(p,s)=>p.querySelector(s);window.requiredElement=window.optionalElement;window.present=x=>x;window.record=x=>x;window.eventElement=x=>x;window.elementList=(p,s)=>[...p.querySelectorAll(s)];window.CometStorage={getItem:()=>null,setItem:()=>{}};`});
 await page.addScriptTag({path:'static/js/sidebar.js'});
 assert.equal(await page.locator('.sidebar__resize').evaluate(e=>getComputedStyle(e).cursor),'col-resize');
 await page.waitForTimeout(350);
 await page.mouse.move(237,300); await page.mouse.down(); await page.mouse.move(397,300); await page.mouse.up();
 assert.equal(await page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width)),400);
 await page.mouse.move(397,300); await page.mouse.down(); await page.mouse.move(797,300); await page.mouse.up();
 assert.equal(await page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width)),400);
 await page.mouse.move(397,300); await page.mouse.down(); await page.mouse.move(217,300);
 assert.equal(await page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width)),240);
 await page.mouse.move(137,300); await page.mouse.up();
 assert.equal(await page.locator('.sidebar__toggle').getAttribute('aria-expanded'),'false');
 await page.locator('.sidebar__toggle').click(); assert.equal(await page.locator('.sidebar__resize').evaluate(e=>getComputedStyle(e).cursor),'col-resize');
 await page.waitForTimeout(350);
 assert.equal(await page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width)),240);
 await page.mouse.move(237,300); await page.mouse.down(); await page.mouse.move(347,300); await page.mouse.up();
 await page.reload();
 await page.addScriptTag({content:`window.optionalElement=(p,s)=>p.querySelector(s);window.requiredElement=window.optionalElement;window.present=x=>x;window.record=x=>x;window.eventElement=x=>x;window.elementList=(p,s)=>[...p.querySelectorAll(s)];window.CometStorage={getItem:()=>null,setItem:()=>{}};`});
 await page.addScriptTag({path:'static/js/sidebar.js'});
 await page.waitForTimeout(350);
 assert.equal(await page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width)),350);
 console.log('Arraste, limites, recolhimento e largura após atualizar: OK');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
