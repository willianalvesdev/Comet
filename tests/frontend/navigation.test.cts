import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {before as setup,after as teardown,test} from 'node:test';
import {chromium,type Browser,type Route} from 'playwright';
const root = process.env.FRONTEND_ROOT || path.resolve(__dirname, '../..');
const baselineRoot = process.env.BASELINE_ROOT;
const results: Record<string,unknown> = {};
let browser: Browser;
async function fixture(html: string, scripts: string[], source: string, routes: Record<string,(route:Route)=>Promise<void>> = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://comet.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    const handler = routes[url.pathname];
    if (handler) return handler(route);
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto('http://comet.test/');
  await page.evaluate(() => {
    window.WorkspaceNavigation={go:async()=>{}};
    window.measurements = { creates: 0, titleQueries: 0, previewQueries: 0, currentWrites: 0, disabledWrites: 0 };
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (tagName:string,options?:ElementCreationOptions) { window.measurements.creates++; return create.call(this,tagName,options); };
    const query = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function <E extends Element = Element>(selector:string):NodeListOf<E> {
      if (selector === '[title]') window.measurements.titleQueries++;
      if (selector === '.sessions__link[title]') window.measurements.previewQueries++;
      return query.call(this, selector) as NodeListOf<E>;
    };
    const set=Element.prototype.setAttribute,remove=Element.prototype.removeAttribute;
    Element.prototype.setAttribute=function(name:string,value:string){if(name==='aria-current')window.measurements.currentWrites++;set.call(this,name,value);};
    Element.prototype.removeAttribute=function(name:string){if(name==='aria-current')window.measurements.currentWrites++;remove.call(this,name);};
    const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
    if(!disabled?.set)throw new Error('Missing disabled setter');
    const setDisabled=disabled.set;
    Object.defineProperty(HTMLButtonElement.prototype, 'disabled', { ...disabled, set(value:boolean) {
      window.measurements.disabledWrites++;
      return setDisabled.call(this, value);
    } });
    window.resetMeasurements = () => Object.assign(window.measurements,{creates:0,titleQueries:0,previewQueries:0,currentWrites:0,disabledWrites:0});
  });
  for (const helper of ['dom','api-data']) await page.addScriptTag({content:fs.readFileSync(path.join(root,'artifacts/test-runtime',helper+'.js'),'utf8')});
  for (const script of scripts) await page.addScriptTag({ content: fs.readFileSync(path.join(source, 'artifacts/test-runtime', script), 'utf8') });
  return { page, errors };
}
async function sessions(source: string) {
  const requests: {method:string;body:unknown;csrf:string}[] = [];
  const { page, errors } = await fixture('<meta name="csrf-token" content="fixture-csrf"><body data-user-id="test"><aside class="sidebar"><button class="sidebar__toggle"></button><div class="sidebar__new-chat"><a class="sidebar__link" href="/novo.html?new=1">Novo chat</a></div><nav class="sidebar__nav"></nav></aside><main class="computer-page"></main></body>', ['sessions.js'], source, {
    '/api/ai/conversations/chat-2': async route => {
      requests.push({ method: route.request().method(), body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrftoken'] });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: route.request().method() === 'PATCH' ? 'Renamed conversation' : undefined }) });
    }
  });
  const state = await page.evaluate(() => {
    window.events = [];
    for (const name of ['open', 'changed', 'more']) window.addEventListener('sessions:' + name, event => {if(event instanceof CustomEvent)window.events.push({name,detail:event.detail as unknown});});
    window.ComputerSessions.select(null);
    const initial = { pinnedHidden: requiredElement(document, ".sessions", HTMLDetailsElement).hidden, recentText: requiredElement(document, ".recents-popover__list", HTMLElement).textContent };
    window.ComputerSessions.render(Array.from({ length: 100 }, (_, index) => ({ id: 'chat-' + index, title: 'Conversation ' + index,created_at:'',updated_at:'' })), false, true);
    const originalLink = requiredElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement);
    window.resetMeasurements();
    for (let index = 0; index < 10; index++) window.ComputerSessions.select('chat-' + index);
    const selectionMetrics = { ...window.measurements, retainedNodes: originalLink === optionalElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement) };
    const selected = [...elementList(document, ".sessions__link[aria-current]", HTMLAnchorElement)].map(link => link.closest<HTMLElement>('.sessions__row')?.dataset.id);
    const recent = [...elementList(document, ".recents-popover [aria-current]", HTMLElement)].map(link => link.dataset.chatId);
    window.resetMeasurements();
    for (let index = 0; index < 10; index++) window.ComputerSessions.setBusy(true);
    const busyMetrics = { ...window.measurements };
    requiredElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement).click();
    const busyEvents = window.events.length;
    const allDisabled = [...elementList(document, ".sessions button", HTMLButtonElement)].every(button => button.disabled);
    window.ComputerSessions.setBusy(false);
    requiredElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement).click();
    const link = requiredElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement);
    let modifiedClickPrevented=false;
    link.addEventListener('click', event => { modifiedClickPrevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    requiredElement(document, "[data-id=\"chat-2\"] .sessions__more", HTMLButtonElement).click();
    requiredElement(document, ".sessions-menu [data-action=\"pin\"]", HTMLElement).click();
    const pinned = optionalElement(document.querySelectorAll('.sessions')[0], "[data-id=\"chat-2\"]", HTMLElement) !== null;
    return { initial, selected, recent, busyEvents, allDisabled, modifiedClickPrevented, pinned, selectionMetrics, busyMetrics };
  });
  assert.deepEqual(state.selected, ['chat-9']);
  assert.deepEqual(state.initial, { pinnedHidden: true, recentText: 'Nenhum chat recente' });
  assert.deepEqual(state.recent, ['chat-9']);
  assert.equal(state.busyEvents, 0);
  assert.equal(state.allDisabled, true);
  assert.equal(state.modifiedClickPrevented, false);
  assert.equal(state.pinned, true);
  await page.evaluate(() => {
    requiredElement(document, "[data-id=\"chat-2\"] .sessions__more", HTMLButtonElement).click();
    requiredElement(document, ".sessions-menu [data-action=\"rename\"]", HTMLElement).click();
    const input=requiredElement(document, ".sessions-rename", HTMLInputElement);
    input.value = 'Renamed conversation';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  });
  await page.waitForFunction(() => optionalElement(document, "[data-id=\"chat-2\"] .sessions__link", HTMLAnchorElement)?.textContent === 'Renamed conversation');
  await page.evaluate(() => {
    requiredElement(document, "[data-id=\"chat-2\"] .sessions__more", HTMLButtonElement).click();
    requiredElement(document, ".sessions-menu [data-action=\"delete\"]", HTMLElement).click();
    requiredElement(document, ".sessions-dialog form", HTMLFormElement).requestSubmit();
  });
  await page.waitForFunction(() => !optionalElement(document, "[data-id=\"chat-2\"]", HTMLElement));
  const final = await page.evaluate(() => {
    window.ComputerSessions.select('new-chat', 'New conversation');
    const created = requiredElement(document, "[data-id=\"new-chat\"] .sessions__link", HTMLAnchorElement).textContent;
    window.ComputerSessions.select(null);
    return { events:window.events, created, selected: elementList(document, ".sessions__link[aria-current]", HTMLAnchorElement).length, pins: JSON.parse(localStorage.getItem('ascenda-pinned-test') || '{}') as unknown };
  });
  assert.equal(final.created, 'New conversation');
  assert.equal(final.selected, 0);
  assert.deepEqual(final.pins, {});
  assert.deepEqual(final.events.map(event => event.name), ['open', 'changed', 'changed']);
  assert.deepEqual(requests.map(request => request.method), ['PATCH', 'DELETE']);
  assert.ok(requests[0].body && typeof requests[0].body==='object' && 'title' in requests[0].body);
  assert.equal(requests[0].body.title, 'Renamed conversation');
  assert.ok(requests.every(request => request.csrf === 'fixture-csrf'));
  assert.deepEqual(errors, []);
  await page.close();
  const { selectionMetrics, busyMetrics, ...behavior } = state;
  return { behavior: { ...behavior, final, requests }, metrics: { selection: selectionMetrics, busy: busyMetrics } };
}
async function tooltips(source: string) {
  const { page, errors } = await fixture('<body><main id="host"><button id="first" title="Initial hint">First</button></main></body>', ['tooltips.js'], source);
  await page.evaluate(() => {
    window.resetMeasurements();
    const host = requiredElement(document, "#host", HTMLElement);
    for (let index = 0; index < 40; index++) {
      const section = document.createElement('section');
      section.innerHTML = '<button title="Hint ' + index + '">Action</button><span><b>Nested content</b></span>';
      host.append(section);
    }
  });
  await page.waitForFunction(() => elementList(document, "[data-tooltip]", HTMLElement).length === 41);
  const metrics = await page.evaluate(() => ({ ...window.measurements }));
  await page.evaluate(() => requiredElement(document, "#first", HTMLElement).title = 'Updated hint');
  await page.waitForFunction(() => requiredElement(document, "#first", HTMLElement).dataset.tooltip === 'Updated hint');
  await page.focus('#first');
  await page.waitForFunction(() => requiredElement(document, "#site-tooltip", HTMLElement).matches(':popover-open'));
  const shown = await page.evaluate(() => ({ text: requiredElement(document, "#site-tooltip", HTMLElement).textContent, describedBy: requiredElement(document, "#first", HTMLElement).getAttribute('aria-describedby'), titles: elementList(document, "[title]", HTMLElement).length }));
  assert.deepEqual(shown, { text: 'Updated hint', describedBy: 'site-tooltip', titles: 0 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#site-tooltip').evaluate(node => node.matches(':popover-open')), false);
  assert.equal(await page.locator('#first').getAttribute('aria-describedby'), null);
  assert.deepEqual(errors, []);
  await page.close();
  return { behavior: shown, metrics };
}
async function preview(source: string) {
  let requests = 0;
  const { page, errors } = await fixture('<body><nav class="sidebar__nav"><div class="sessions__row" data-id="chat-1"><a class="sessions__link" href="#" title="Conversation">Conversation</a></div><span id="status"></span></nav></body>', ['chat-preview.js'], source, {
    '/api/ai/conversations/chat-1/preview': route => { requests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Question', answer: 'Answer', created_at: '2026-01-01T10:00:00Z', has_search: true }) }); }
  });
  await page.evaluate(() => {
    window.resetMeasurements();
    for (let index = 0; index < 20; index++) requiredElement(document, "#status", HTMLElement).textContent = String(index);
  });
  await page.waitForTimeout(20);
  const metrics = await page.evaluate(() => ({ ...window.measurements }));
  await page.focus('.sessions__link');
  await page.waitForFunction(() => !requiredElement(document, ".chat-preview", HTMLElement).hidden);
  const shown = await page.evaluate(() => ({ text: [...elementList(document, ".chat-preview__question, .chat-preview__answer", HTMLElement)].map(node => node.textContent), title: requiredElement(document, ".sessions__link", HTMLAnchorElement).getAttribute('title'), describedBy: requiredElement(document, ".sessions__link", HTMLAnchorElement).getAttribute('aria-describedby') }));
  assert.deepEqual(shown, { text: ['Question', 'Answer'], title: null, describedBy: 'chat-preview' });
  assert(await page.locator('.chat-preview__search').isVisible());
  assert.equal(await page.locator('.chat-preview__question').getAttribute('href'), 'http://comet.test/#');
  await page.locator('.chat-preview').hover();
  await page.waitForTimeout(200);
  assert(await page.locator('.chat-preview').isVisible());
  await page.locator('.chat-preview__question').click();
  assert(await page.locator('.chat-preview').isVisible());

  await page.evaluate(() => requiredElement(document, ".sessions__row", HTMLElement).remove());
  await page.waitForFunction(() => requiredElement(document, ".chat-preview", HTMLElement).hidden);
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'sessions__row'; row.dataset.id = 'chat-1';
    row.innerHTML = '<a class="sessions__link" href="#" title="New title">New conversation</a>';
    requiredElement(document, ".sidebar__nav", HTMLElement).append(row);
  });
  await page.waitForFunction(() => !requiredElement(document, ".sessions__link", HTMLAnchorElement).hasAttribute('title'));
  await page.focus('.sessions__link');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(requests, 1);
  assert.equal(await page.locator('.chat-preview').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
  return { behavior: { ...shown, requests }, metrics };
}
async function navigator(source: string) {
  const messages = Array.from({ length: 40 }, (_, index) => '<article class="computer-message--user" style="height:' + (100 + index % 3 * 80) + 'px;margin-bottom:220px"><div class="computer-message__text">Message ' + index + '</div></article>').join('');
  const { page, errors } = await fixture('<style>.message-navigator{position:fixed;right:0;top:20px}.message-navigator__panel{max-height:300px;overflow:auto}.message-navigator__list button{display:block}</style><body><main class="workspace__content" style="height:780px;overflow:auto"><div style="height:500px"></div><div class="computer-messages">' + messages + '</div><div style="height:600px"></div><div class="computer-composer"></div></main></body>', ['message-navigator.js'], source);
  await page.waitForFunction(() => elementList(document, ".message-navigator [aria-current]", HTMLElement).length === 2);
  const positions = [];
  let metrics: Window['measurements'] | undefined;
  for (const index of [5, 12, 25]) {
    await page.evaluate(index => { window.resetMeasurements(); elementList(document, ".message-navigator__list button", HTMLButtonElement)[index].click(); }, index);
    await page.waitForFunction(index => elementList(document, ".message-navigator__list button", HTMLButtonElement)[index].hasAttribute('aria-current'), index);
    positions.push(await page.evaluate(index => {
      const rect = elementList(document, ".computer-message--user", HTMLElement)[index].getBoundingClientRect();
      return { index, center: Math.round(rect.top + rect.height / 2), viewportCenter: innerHeight / 2, active: [...elementList(document, ".message-navigator__list button", HTMLButtonElement)].findIndex(button => button.hasAttribute('aria-current')), closed: requiredElement(document, ".message-navigator__panel", HTMLElement).hidden };
    }, index));
    metrics = await page.evaluate(() => ({ ...window.measurements }));
  }
  positions.forEach(position => { assert.equal(position.center, position.viewportCenter); assert.equal(position.active, position.index); assert.equal(position.closed, true); });
  await page.evaluate(() => requiredElement(document, ".message-navigator__mark", HTMLElement).focus());
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Message 39');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Message 0');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Message 1');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-navigator__panel').isVisible(), false);
  await page.evaluate(() => {
    const answer = document.createElement('article'); answer.className = 'computer-message--assistant';
    answer.innerHTML = '<div class="computer-message__text">Prévia da resposta</div>';
    document.querySelector('.computer-message--user')?.after(answer);
  });
  await page.locator('.message-navigator__mark').first().hover();
  assert.equal(await page.locator('.message-navigator__list button:not([hidden])').count(), 1);
  assert.equal(await page.locator('.message-navigator__answer').first().textContent(), 'Prévia da resposta');
  await page.evaluate(() => { const answer=document.querySelector('.computer-message--assistant .computer-message__text'); if(answer) answer.textContent='Resposta atualizada'; });
  await page.waitForFunction(() => document.querySelector('.message-navigator__answer')?.textContent === 'Resposta atualizada');
  await page.evaluate(() => requiredElement(document, ".computer-messages", HTMLElement).replaceChildren());
  await page.waitForFunction(() => requiredElement(document, ".message-navigator", HTMLElement).hidden);
  assert.deepEqual(errors, []);
  await page.close();
  return { behavior: positions, metrics };
}
setup(async () => {
  const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' ? path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe') : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
teardown(async () => {
  await browser?.close();
  if (process.env.FRONTEND_METRICS) fs.writeFileSync(process.env.FRONTEND_METRICS, JSON.stringify(results, null, 2));
});
for (const [name, scenario] of Object.entries({ sessions, tooltips, preview, navigator })) {
  test(name + ' preserves navigation and accessibility behavior', async () => {
    const previous = baselineRoot ? await scenario(baselineRoot) : null;
    const current = await scenario(root);
    if (previous) assert.deepEqual(current.behavior, previous.behavior, name + ' behavior changed');
    assert.ok(current.metrics);
    if (name === 'sessions' && 'selection' in current.metrics) {
      assert.equal(current.metrics.selection.creates, 0);
      assert.equal(current.metrics.selection.retainedNodes, true);
    }
    if (name === 'navigator' && 'currentWrites' in current.metrics) assert.equal(current.metrics.currentWrites, 4);
    if (name === 'preview' && 'previewQueries' in current.metrics) assert.equal(current.metrics.previewQueries, 0);
    results[name] = { ...(previous ? { before: previous } : {}), after: current };
  });
}
