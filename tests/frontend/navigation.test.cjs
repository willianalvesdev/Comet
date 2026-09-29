const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { before: setup, after: teardown, test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.FRONTEND_ROOT || path.resolve(__dirname, '../..');
const baselineRoot = process.env.BASELINE_ROOT;
const results = {};
let browser;
async function fixture(html, scripts, source, routes = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://ascenda.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    const handler = routes[url.pathname];
    if (handler) return handler(route);
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto('http://ascenda.test/');
  await page.evaluate(() => {
    window.measurements = { creates: 0, titleQueries: 0, previewQueries: 0, currentWrites: 0, disabledWrites: 0 };
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) { measurements.creates++; return create.apply(this, args); };
    const query = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (selector) {
      if (selector === '[title]') measurements.titleQueries++;
      if (selector === '.sessions__link[title]') measurements.previewQueries++;
      return query.call(this, selector);
    };
    for (const method of ['setAttribute', 'removeAttribute']) {
      const original = Element.prototype[method];
      Element.prototype[method] = function (...args) {
        if (args[0] === 'aria-current') measurements.currentWrites++;
        return original.apply(this, args);
      };
    }
    const disabled = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
    Object.defineProperty(HTMLButtonElement.prototype, 'disabled', { ...disabled, set(value) {
      measurements.disabledWrites++;
      return disabled.set.call(this, value);
    } });
    window.resetMeasurements = () => Object.keys(measurements).forEach(key => measurements[key] = 0);
  });
  for (const script of scripts) await page.addScriptTag({ content: fs.readFileSync(path.join(source, 'static/js', script), 'utf8') });
  return { page, errors };
}
async function sessions(source) {
  const requests = [];
  const { page, errors } = await fixture('<meta name="csrf-token" content="fixture-csrf"><body data-user-id="test"><aside class="sidebar"><button class="sidebar__toggle"></button><nav class="sidebar__nav"></nav></aside><main class="computer-page"></main></body>', ['sessions.js'], source, {
    '/api/ai/conversations/chat-2': async route => {
      requests.push({ method: route.request().method(), body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrftoken'] });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: route.request().method() === 'PATCH' ? 'Renamed conversation' : undefined }) });
    }
  });
  const state = await page.evaluate(() => {
    window.events = [];
    for (const name of ['open', 'changed', 'more']) window.addEventListener('sessions:' + name, event => events.push({ name, detail: event.detail }));
    ComputerSessions.select(null);
    const initial = { pinnedHidden: document.querySelector('.sessions').hidden, recentText: document.querySelector('.recents-popover__list').textContent };
    ComputerSessions.render(Array.from({ length: 100 }, (_, index) => ({ id: 'chat-' + index, title: 'Conversation ' + index })), false, true);
    const originalLink = document.querySelector('[data-id="chat-2"] .sessions__link');
    resetMeasurements();
    for (let index = 0; index < 10; index++) ComputerSessions.select('chat-' + index);
    const selectionMetrics = { ...measurements, retainedNodes: originalLink === document.querySelector('[data-id="chat-2"] .sessions__link') };
    const selected = [...document.querySelectorAll('.sessions__link[aria-current]')].map(link => link.closest('.sessions__row').dataset.id);
    const recent = [...document.querySelectorAll('.recents-popover [aria-current]')].map(link => link.dataset.chatId);
    resetMeasurements();
    for (let index = 0; index < 10; index++) ComputerSessions.setBusy(true);
    const busyMetrics = { ...measurements };
    document.querySelector('[data-id="chat-2"] .sessions__link').click();
    const busyEvents = events.length;
    const allDisabled = [...document.querySelectorAll('.sessions button')].every(button => button.disabled);
    ComputerSessions.setBusy(false);
    document.querySelector('[data-id="chat-2"] .sessions__link').click();
    const link = document.querySelector('[data-id="chat-2"] .sessions__link');
    let modifiedClickPrevented;
    link.addEventListener('click', event => { modifiedClickPrevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    document.querySelector('[data-id="chat-2"] .sessions__more').click();
    document.querySelector('.sessions-menu [data-action="pin"]').click();
    const pinned = document.querySelectorAll('.sessions')[0].querySelector('[data-id="chat-2"]') !== null;
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
    document.querySelector('[data-id="chat-2"] .sessions__more').click();
    document.querySelector('.sessions-menu [data-action="rename"]').click();
    document.querySelector('.sessions-dialog input').value = 'Renamed conversation';
    document.querySelector('.sessions-dialog form').requestSubmit();
  });
  await page.waitForFunction(() => document.querySelector('[data-id="chat-2"] .sessions__link').textContent === 'Renamed conversation');
  await page.evaluate(() => {
    document.querySelector('[data-id="chat-2"] .sessions__more').click();
    document.querySelector('.sessions-menu [data-action="delete"]').click();
    document.querySelector('.sessions-dialog form').requestSubmit();
  });
  await page.waitForFunction(() => !document.querySelector('[data-id="chat-2"]'));
  const final = await page.evaluate(() => {
    ComputerSessions.select('new-chat', 'New conversation');
    const created = document.querySelector('[data-id="new-chat"] .sessions__link').textContent;
    ComputerSessions.select(null);
    return { events, created, selected: document.querySelectorAll('.sessions__link[aria-current]').length, pins: JSON.parse(localStorage.getItem('ascenda-pinned-test')) };
  });
  assert.equal(final.created, 'New conversation');
  assert.equal(final.selected, 0);
  assert.deepEqual(final.pins, {});
  assert.deepEqual(final.events.map(event => event.name), ['open', 'changed', 'changed']);
  assert.deepEqual(requests.map(request => request.method), ['PATCH', 'DELETE']);
  assert.equal(requests[0].body.title, 'Renamed conversation');
  assert.ok(requests.every(request => request.csrf === 'fixture-csrf'));
  assert.deepEqual(errors, []);
  await page.close();
  const { selectionMetrics, busyMetrics, ...behavior } = state;
  return { behavior: { ...behavior, final, requests }, metrics: { selection: selectionMetrics, busy: busyMetrics } };
}
async function tooltips(source) {
  const { page, errors } = await fixture('<body><main id="host"><button id="first" title="Initial hint">First</button></main></body>', ['tooltips.js'], source);
  await page.evaluate(() => {
    resetMeasurements();
    const host = document.getElementById('host');
    for (let index = 0; index < 40; index++) {
      const section = document.createElement('section');
      section.innerHTML = '<button title="Hint ' + index + '">Action</button><span><b>Nested content</b></span>';
      host.append(section);
    }
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-tooltip]').length === 41);
  const metrics = await page.evaluate(() => ({ ...measurements }));
  await page.evaluate(() => document.getElementById('first').title = 'Updated hint');
  await page.waitForFunction(() => document.getElementById('first').dataset.tooltip === 'Updated hint');
  await page.focus('#first');
  await page.waitForFunction(() => document.getElementById('site-tooltip').matches(':popover-open'));
  const shown = await page.evaluate(() => ({ text: document.getElementById('site-tooltip').textContent, describedBy: document.getElementById('first').getAttribute('aria-describedby'), titles: document.querySelectorAll('[title]').length }));
  assert.deepEqual(shown, { text: 'Updated hint', describedBy: 'site-tooltip', titles: 0 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#site-tooltip').evaluate(node => node.matches(':popover-open')), false);
  assert.equal(await page.locator('#first').getAttribute('aria-describedby'), null);
  assert.deepEqual(errors, []);
  await page.close();
  return { behavior: shown, metrics };
}
async function preview(source) {
  let requests = 0;
  const { page, errors } = await fixture('<body><nav class="sidebar__nav"><div class="sessions__row" data-id="chat-1"><a class="sessions__link" href="#" title="Conversation">Conversation</a></div><span id="status"></span></nav></body>', ['chat-preview.js'], source, {
    '/api/ai/conversations/chat-1/preview': route => { requests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Question', answer: 'Answer', created_at: '2026-01-01T10:00:00Z' }) }); }
  });
  await page.evaluate(() => {
    resetMeasurements();
    for (let index = 0; index < 20; index++) document.getElementById('status').textContent = String(index);
  });
  await page.waitForTimeout(20);
  const metrics = await page.evaluate(() => ({ ...measurements }));
  await page.focus('.sessions__link');
  await page.waitForFunction(() => !document.querySelector('.chat-preview').hidden);
  const shown = await page.evaluate(() => ({ text: [...document.querySelectorAll('.chat-preview p')].map(node => node.textContent), title: document.querySelector('.sessions__link').getAttribute('title'), describedBy: document.querySelector('.sessions__link').getAttribute('aria-describedby') }));
  assert.deepEqual(shown, { text: ['Question', 'Answer'], title: null, describedBy: 'chat-preview' });
  await page.evaluate(() => document.querySelector('.sessions__row').remove());
  await page.waitForFunction(() => document.querySelector('.chat-preview').hidden);
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'sessions__row'; row.dataset.id = 'chat-1';
    row.innerHTML = '<a class="sessions__link" href="#" title="New title">New conversation</a>';
    document.querySelector('.sidebar__nav').append(row);
  });
  await page.waitForFunction(() => !document.querySelector('.sessions__link').hasAttribute('title'));
  await page.focus('.sessions__link');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(requests, 1);
  assert.equal(await page.locator('.chat-preview').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
  return { behavior: { ...shown, requests }, metrics };
}
async function navigator(source) {
  const messages = Array.from({ length: 40 }, (_, index) => '<article class="computer-message--user" style="height:' + (100 + index % 3 * 80) + 'px;margin-bottom:220px"><div class="computer-message__text">Message ' + index + '</div></article>').join('');
  const { page, errors } = await fixture('<style>.message-navigator{position:fixed;right:0;top:20px}.message-navigator__panel{max-height:300px;overflow:auto}.message-navigator__list button{display:block}</style><body><div style="height:500px"></div><div class="computer-messages">' + messages + '</div><div style="height:600px"></div><div class="computer-composer"></div></body>', ['message-navigator.js'], source);
  await page.waitForFunction(() => document.querySelectorAll('.message-navigator [aria-current]').length === 2);
  const positions = [];
  let metrics;
  for (const index of [5, 12, 25]) {
    await page.evaluate(index => { resetMeasurements(); document.querySelectorAll('.message-navigator__list button')[index].click(); }, index);
    await page.waitForFunction(index => document.querySelectorAll('.message-navigator__list button')[index].hasAttribute('aria-current'), index);
    positions.push(await page.evaluate(index => {
      const rect = document.querySelectorAll('.computer-message--user')[index].getBoundingClientRect();
      return { index, center: Math.round(rect.top + rect.height / 2), viewportCenter: innerHeight / 2, active: [...document.querySelectorAll('.message-navigator__list button')].findIndex(button => button.hasAttribute('aria-current')), closed: document.querySelector('.message-navigator__panel').hidden };
    }, index));
    metrics = await page.evaluate(() => ({ ...measurements }));
  }
  positions.forEach(position => { assert.equal(position.center, position.viewportCenter); assert.equal(position.active, position.index); assert.equal(position.closed, true); });
  await page.evaluate(() => document.querySelector('.message-navigator__mark').focus());
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Message 39');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Message 0');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Message 1');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-navigator__panel').isVisible(), false);
  await page.evaluate(() => document.querySelector('.computer-messages').replaceChildren());
  await page.waitForFunction(() => document.querySelector('.message-navigator').hidden);
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
    if (name === 'sessions') {
      assert.equal(current.metrics.selection.creates, 0);
      assert.equal(current.metrics.selection.retainedNodes, true);
    }
    if (name === 'navigator') assert.equal(current.metrics.currentWrites, 4);
    if (name === 'preview') assert.equal(current.metrics.previewQueries, 0);
    results[name] = { ...(previous ? { before: previous } : {}), after: current };
  });
}
