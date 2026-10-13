import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../../server/http';
import { NewsService, fetchNewsAPI, handleNews, newsQuery, normalizeArticle, publicURL, topicSelection } from '../../server/news';

const article = (overrides: Record<string, unknown> = {}) => ({title:'Mercado &amp; economia', url:'https://example.com/noticia', description:'<b>Resumo</b> da notícia', source:{name:'example.com'}, urlToImage:'https://example.com/foto.jpg', publishedAt:'2026-09-23T12:00:00Z', ...overrides});

test('notícias: normaliza conteúdo, filtra temas indevidos e rejeita links privados', () => {
    const normalized = normalizeArticle(article());
    assert.equal(normalized?.title, 'Mercado & economia');
    assert.equal(normalized?.description, 'Resumo da notícia');
    assert.equal(normalized?.sources.length, 1);
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://localhost/x', 'http://localhost./x', 'http://127.1/x', 'http://2130706433/x', 'http://192.168.1.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'https://user:pass@example.com']) assert.equal(publicURL(url), null, url);
    assert.equal(publicURL('https://news.example.com/article'), 'https://news.example.com/article');
    for (const title of ['Stock market earnings grow', 'Governo anuncia pacote', 'Violinista lança álbum', 'Football team wins']) assert.ok(normalizeArticle(article({title})), title);
    for (const title of ['Guerra e bombardeios', 'Fraude em investimentos', 'Bank robbery under police investigation', 'Tiroteio deixa feridos']) assert.equal(normalizeArticle(article({title})), null, title);
    assert.equal(normalizeArticle(article({content:'Police arrested a suspect'})), null);
    assert.equal(normalizeArticle(article({urlToImage:''})), null);
    assert.equal(normalizeArticle(article({publishedAt:'invalid'}))?.published_at, null);
    assert.deepEqual(topicSelection('sports,business,sports'), ['business', 'sports']);
    assert.throws(() => topicSelection('__proto__'), ApiError);
    assert.ok(newsQuery(['sports']).includes('football'));
    assert.ok(!newsQuery(['sports']).includes('finance'));
});

test('notícias: cache, requisições simultâneas, paginação e falhas preservam resultados', async () => {
    let clock = 0, calls = 0, failing = false;
    const service = new NewsService('private-token', async () => {
        calls++;
        await Promise.resolve();
        if (failing) throw new ApiError(503, 'Limite atingido', 'quota');
        return {articles:[article(), article()], totalResults:300};
    }, () => clock);
    const [first, simultaneous] = await Promise.all([service.get(1), service.get(1)]);
    assert.equal(calls, 1);
    assert.deepEqual(first, simultaneous);
    assert.equal(first.articles.length, 1);
    assert.equal(first.has_more, true);
    assert.equal(first.stale, false);
    await service.get(1);
    assert.equal(calls, 1);
    await service.get(1, ['sports']);
    await service.get(1, [], 'top');
    await service.get(1, [], 'top', 'all');
    assert.equal(calls, 4);
    clock = 1900000; failing = true;
    assert.equal((await service.get(1)).stale, true);
    assert.equal(calls, 5);
    assert.equal((await service.get(1)).stale, true);
    assert.equal(calls, 5);
    clock = 90000000;
    await assert.rejects(service.get(1), (error: unknown) => error instanceof ApiError && error.code === 'quota');
    await assert.rejects(new NewsService('', async () => {throw new Error('não deveria consultar');}).get(1), (error: unknown) => error instanceof ApiError && error.code === 'configuration');
});

test('notícias: NewsAPI usa chave privada, intercala idiomas e limita respostas', async context => {
    const requests: Array<{url:string; options:RequestInit | undefined}> = [];
    context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
        const url = String(input); requests.push({url, options});
        const language = new URL(url).searchParams.get('language');
        return Response.json({status:'ok', totalResults:250, articles:[article({title:language || 'all'})]});
    });
    const result = await fetchNewsAPI('private-secret', 2);
    assert.deepEqual(result.articles.map(item => (item as {title:string}).title), ['pt', 'en']);
    assert.equal(result.has_more, true);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => !request.url.includes('private-secret')));
    assert.equal(new Headers(requests[0].options?.headers).get('X-Api-Key'), 'private-secret');
    assert.equal(requests[0].options?.redirect, 'error');
    assert.equal(new URL(requests[0].url).searchParams.get('page'), '2');
    await fetchNewsAPI('private-secret', 1, [], 'top', 'all');
    assert.equal(new URL(requests[2].url).searchParams.has('language'), false);
    assert.equal(new URL(requests[2].url).searchParams.get('sortBy'), 'popularity');
    context.mock.restoreAll();
    for (const [status, code] of [[401, 'configuration'], [429, 'quota'], [500, 'unavailable']] as const) {
        context.mock.method(globalThis, 'fetch', async () => new Response('secret detail', {status}));
        await assert.rejects(fetchNewsAPI('private-secret', 1, [], 'for-you', 'all'), (error: unknown) => error instanceof ApiError && error.code === code && !error.message.includes('secret'));
        context.mock.restoreAll();
    }
    context.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2000001)));
    await assert.rejects(fetchNewsAPI('private-secret', 1, [], 'for-you', 'all'), ApiError);
});

test('notícias: parâmetros e métodos inválidos são recusados antes da consulta', async () => {
    for (const query of ['page=0', 'page=-1', 'page=11', 'page=1.5', 'page=', 'topics=invalid', 'mode=invalid', 'languages=en']) {
        await assert.rejects(handleNews(new Request('https://comet.test/api/news?' + query)), (error: unknown) => error instanceof ApiError && error.status === 400);
    }
    await assert.rejects(handleNews(new Request('https://comet.test/api/news', {method:'POST'})), (error: unknown) => error instanceof ApiError && error.status === 405);
});