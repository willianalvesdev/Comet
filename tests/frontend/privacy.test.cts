import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import {test, before, after} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {startNextServer} from './next-server.cjs';

const root = path.resolve(__dirname, '../..');
let browser: Browser;
let server: Awaited<ReturnType<typeof startNextServer>>;
before(async () => {
    server = await startNextServer(root);
    browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    fs.mkdirSync(path.join(root, 'artifacts/ui-current'), {recursive:true});
});
after(async () => { await browser?.close(); await server?.stop(); });

test('privacidade: acesso público, navegação, temas e preferências de cookies', async () => {
    const bootstrap = await fetch(server.origin + '/api/bootstrap?page=privacidade');
    assert.equal(bootstrap.status, 200);
    assert.equal((await bootstrap.json()).user, null);
    assert.equal((await fetch(server.origin + '/api/bootstrap?page=computer')).status, 401);
    for (const width of [1280, 390]) {
        const context = await browser.newContext({viewport:{width, height:900}, reducedMotion:'reduce'});
        try {
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await context.addInitScript(() => {
                localStorage.setItem('ascenda-cookie-choice-v1', 'accepted');
                localStorage.setItem('ascensao-theme', 'dark');
            });
            await page.goto(server.origin + '/privacidade');
            await page.locator('.privacy-article').waitFor();
            assert.equal(new URL(page.url()).pathname, '/privacidade.html');
            assert.equal(await page.locator('.sidebar').count(), 0);
            assert.match(await page.title(), /Política de Privacidade/);
            assert.equal(await page.locator('.privacy-contact strong').textContent(), 'Willian Alves do Nascimento');
            const targets = await page.locator('.privacy-index a').evaluateAll(links => links.every(link => Boolean(document.querySelector(link.getAttribute('href')!))));
            assert.equal(targets, true);
            for (const theme of ['dark', 'light']) {
                await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
                await page.evaluate(() => window.scrollTo(0,0));
                await page.evaluate(() => document.fonts.ready);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                const colors = await page.locator('.site-header').evaluate(element => {
                    const header = getComputedStyle(element), body = getComputedStyle(document.body);
                    return {text: header.color, expected: body.color, background: header.backgroundColor};
                });
                assert.equal(colors.text, colors.expected);
                await page.screenshot({path:path.join(root, 'artifacts/ui-current/privacy-' + width + '-' + theme + '.png')});
            }
            await page.locator('.privacy-index a[href="#cookies"]').click();
            await page.locator('.privacy-cookie-button').click();
            await page.locator('.cookie-notice').waitFor({state:'visible'});
            await page.getByRole('button', {name:'Recusar opcionais'}).click();
            assert.equal(await page.evaluate(() => localStorage.getItem('ascenda-cookie-choice-v1')), 'rejected');
            assert.equal(await page.locator('.cookie-notice').isVisible(), false);
            if (width < 760) {
                await page.getByRole('button', {name:'Abrir menu', exact:true}).click();
                await page.getByRole('dialog', {name:'Menu principal'}).waitFor({state:'visible'});
                await page.screenshot({path:path.join(root, 'artifacts/ui-current/privacy-mobile-menu.png')});
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('.landing-menu').evaluate(element => (element as HTMLDialogElement).open), false);
            }
            await page.goto(server.origin + '/privacidade.html#contato');
            await page.locator('.privacy-contact').waitFor();
            await page.waitForFunction(() => document.querySelector('#contato')!.getBoundingClientRect().top < innerHeight);
            assert.equal(await page.locator('.privacy-contact a').getAttribute('href'), 'mailto:willian.alves.nascimento2008@gmail.com');
            await page.goto(server.origin + '/?login=1');
            await page.locator('.auth[open]').waitFor();
            await page.locator('.auth__policy a[href="/privacidade.html"]').click();
            await page.locator('.privacy-article').waitFor();
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
});

test('privacidade: sessão existente não redireciona a página pública', async () => {
    const context = await browser.newContext();
    try {
        await context.route('**/api/bootstrap?page=privacidade', route => route.fulfill({json:{page:'privacidade', user:{id:7,nome:'Teste',email:'teste@example.com'},csrfToken:'test',currentYear:2026}}));
        const page = await context.newPage();
        await page.goto(server.origin + '/privacidade.html');
        await page.locator('.privacy-article').waitFor();
        assert.equal(await page.locator('.site-header .site-header__login').textContent(), 'Abrir Comet');
        assert.equal(await page.locator('.site-header .site-header__login').getAttribute('href'), '/novo.html');
        assert.equal(await page.locator('.sidebar').count(), 0);
    } finally { await context.close(); }
});