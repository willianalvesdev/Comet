import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createCryptoService } from '../../server/finance/crypto';
import type { CryptoDashboard, CryptoDetail, CryptoHistory, CryptoSearch } from '../../shared/crypto';

const NOW = Date.parse('2026-10-18T18:00:00Z');
const coin = (changes: Record<string, unknown> = {}) => ({ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 100, price_change_24h: -2, price_change_percentage_24h: -1.96, market_cap: 2_000_000, total_volume: 10_000, last_updated: new Date(NOW - 30_000).toISOString(), sparkline_in_7d: { price: [98, 102, 100] }, ...changes });
const request = (query = '') => new Request('http://localhost/api/finance/crypto?' + query);
function environment(t: TestContext) {
  const previous = process.env.COINGECKO_API_KEY;
  delete process.env.COINGECKO_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.COINGECKO_API_KEY; else process.env.COINGECKO_API_KEY = previous; });
}
const mockFetch = (handler: (url: URL, options?: RequestInit) => Promise<Response> | Response): typeof fetch => async (input, options) => handler(new URL(String(input)), options);

test('crypto: normalization, source provenance and shared single-flight cache', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(async (url, options) => {
    calls++; await new Promise(resolve => setImmediate(resolve));
    assert.equal(url.hostname, 'api.coingecko.com'); assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(options?.redirect, 'error');
    return Response.json([coin({ image: 'javascript:alert(1)', market_cap: null, total_volume: '', sparkline_in_7d: { price: [1, null, '2', 'oops', -3] } }), coin(), coin({ id: '../bad' }), coin({ id: 'ethereum', symbol: 'eth', current_price: '200', image: 'https://coin-images.coingecko.com/coins/ethereum.png' })]);
  }), () => NOW);
  const results = await Promise.all(Array.from({ length: 6 }, (_, id) => service.handle(request(), id + 1, ['crypto']).then(response => response.json() as Promise<CryptoDashboard>)));
  assert.equal(calls, 1); const data = results[0];
  assert.equal(data.assets.length, 2); assert.equal(data.assets[0].marketCap, null); assert.equal(data.assets[0].volume, null);
  assert.equal(data.assets[0].image, undefined); assert.deepEqual(data.assets[0].points, [1, 2]); assert.equal(data.assets[1].price, 200);
  assert.equal(data.asOf, new Date(NOW - 30_000).toISOString()); assert.equal(data.provider, 'CoinGecko');
  assert.equal('sectors' in data, false); assert.equal('fixedIncome' in data, false);
  assert.equal((await service.handle(request(), 15, ['crypto'])).status, 200); assert.equal(calls, 1);
  const detail = await (await service.handle(request('id=ethereum'), 1, ['crypto', 'asset'])).json() as CryptoDetail;
  assert.equal(detail.asset.price, 200); assert.equal(calls, 1);
});

test('crypto: 429 backs off, stale results expire after 15 minutes and refresh recovers', async t => {
  environment(t); let now = NOW, calls = 0, fail = false;
  const service = createCryptoService(mockFetch(() => { calls++; return fail ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : Response.json([coin()]); }), () => now);
  await service.handle(request(), 1, ['crypto']);
  now += 5 * 60_000 + 1; fail = true;
  let data = await (await service.handle(request(), 1, ['crypto'])).json() as CryptoDashboard;
  assert.equal(calls, 2); assert.equal(data.stale, true); assert.equal(data.assets[0].price, 100);
  await service.handle(request(), 2, ['crypto']); assert.equal(calls, 2);
  now = NOW + 16 * 60_000;
  data = await (await service.handle(request(), 1, ['crypto'])).json() as CryptoDashboard;
  assert.equal(data.assets.length, 0); assert.equal(data.asOf, null); assert.equal(calls, 3);
  fail = false; now += 121_000;
  data = await (await service.handle(request(), 1, ['crypto'])).json() as CryptoDashboard;
  assert.equal(data.stale, false); assert.equal(data.assets.length, 1); assert.equal(calls, 4);
});

test('crypto: validates IDs, queries, methods, ranges and rejects removed stock routes', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(() => { calls++; throw new Error('Unexpected request'); }), () => NOW);
  for (const query of ['id=https://localhost/&range=1d', 'id=../bitcoin&range=1d', 'kind=stock&id=AAPL&range=1m', 'id=bitcoin&range=__proto__', 'id=' + 'a'.repeat(101)]) {
    await assert.rejects(service.handle(request(query), 1, ['crypto', 'history']), { status: 400 });
  }
  await assert.rejects(service.handle(request('view=markets'), 1, ['crypto']), { status: 400 });
  await assert.rejects(service.handle(request(''), 1, ['markets']), { status: 404 });
  await assert.rejects(service.handle(request('id=AAPL'), 1, ['crypto', 'asset']), { status: 400 });
  await assert.rejects(service.handle(request('q=' + 'a'.repeat(81)), 1, ['crypto', 'search']), { status: 400 });
  await assert.rejects(service.handle(request('q=abc%00'), 1, ['crypto', 'search']), { status: 400 });
  await assert.rejects(service.handle(new Request('http://localhost', { method: 'POST' }), 1, ['crypto']), { status: 405 });
  await assert.rejects(service.handle(request(), 1, ['crypto', 'bad']), { status: 404 });
  assert.equal(calls, 0);
});

test('crypto: history removes invalid/future/duplicate samples and keeps chronological order', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(url => {
    calls++; assert.equal(url.pathname, '/api/v3/coins/bitcoin/market_chart'); assert.equal(url.searchParams.get('days'), '1');
    return Response.json({ prices: [[NOW - 20_000, 2], [NOW - 40_000, 1], [NOW - 20_000, 3], [NOW + 86_400_000, 9], [NOW - 100_000_000, 8], [NOW - 10_000, null], ['oops', 4], [NOW - 5_000, -1]] });
  }), () => NOW);
  const data = await (await service.handle(request('id=bitcoin&range=1d'), 1, ['crypto', 'history'])).json() as CryptoHistory;
  assert.deepEqual(data.points, [{ time: NOW - 40_000, value: 1 }, { time: NOW - 20_000, value: 3 }]);
  assert.equal(data.currency, 'USD'); assert.equal(data.stale, false);
  await service.handle(request('id=bitcoin&range=1d'), 2, ['crypto', 'history']); assert.equal(calls, 1);
});

test('crypto: direct detail and history resolve assets beyond the dashboard catalog', async t => {
  environment(t); const calls: string[] = [];
  const service = createCryptoService(mockFetch(url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/coins/markets')) {
      assert.equal(url.searchParams.get('ids'), 'new-coin');
      return Response.json([coin({ id: 'new-coin', name: 'New Coin', symbol: 'new' })]);
    }
    assert.equal(url.pathname, '/api/v3/coins/new-coin/market_chart');
    return Response.json({ prices: [[NOW - 20_000, 100]] });
  }), () => NOW);
  const data = await (await service.handle(request('id=new-coin&range=1d'), 1, ['crypto', 'history'])).json() as CryptoHistory;
  assert.equal(data.points[0].value, 100);
  const detail = await (await service.handle(request('id=new-coin'), 1, ['crypto', 'asset'])).json() as CryptoDetail;
  assert.equal(detail.asset.id, 'new-coin'); assert.equal(detail.asset.name, 'New Coin');
  assert.deepEqual(calls, ['/api/v3/coins/markets', '/api/v3/coins/new-coin/market_chart']);
});

test('crypto: unknown direct asset fails without querying unrelated history', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(url => { calls++; assert.equal(url.pathname, '/api/v3/coins/markets'); return Response.json([coin()]); }), () => NOW);
  await assert.rejects(service.handle(request('id=not-a-real-coin&range=1m'), 1, ['crypto', 'history']), { status: 404 });
  assert.equal(calls, 1);
});

test('crypto: asynchronous provider search validates, bounds and hydrates matching assets', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(url => {
    calls++;
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('query'), 'new');
      return Response.json({ coins: [{ id: '../bad' }, { id: 'new-0', symbol: 'NEW', name: 'New Zero' }, ...Array.from({ length: 20 }, (_, index) => ({ id: 'new-' + index, name: 'New ' + index, symbol: 'n' + index }))], exchanges: [{ id: 'exchange' }] });
    }
    assert.equal(url.pathname, '/api/v3/coins/markets'); assert.equal(url.searchParams.get('ids')!.split(',').length, 8);
    assert.equal(url.searchParams.get('sparkline'), 'false');
    return Response.json([coin({ id: 'new-1', symbol: 'n1' }), coin({ id: 'new-0', symbol: 'new' }), coin({ id: 'injected' })]);
  }), () => NOW);
  const data = await (await service.handle(request('q=new'), 1, ['crypto', 'search'])).json() as CryptoSearch;
  assert.equal(calls, 2); assert.equal(data.assets.length, 8); assert.equal(data.assets[0].id, 'new-0'); assert.equal(data.assets[1].id, 'new-1');
  assert.equal(data.assets[0].price, 100); assert.equal(data.assets[2].price, null); assert.equal(data.assets[2].name, 'New 2');
  assert.equal(data.assets.some(asset => asset.id === 'injected'), false);
  await service.handle(request('q=NEW'), 2, ['crypto', 'search']); assert.equal(calls, 2);
});

test('crypto: empty search shows six popular assets, unmatched query performs no hydration', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch(url => {
    calls++;
    if (url.pathname.endsWith('/search')) return Response.json({ coins: [] });
    return Response.json(Array.from({ length: 10 }, (_, index) => coin({ id: 'coin-' + index })));
  }), () => NOW);
  const popular = await (await service.handle(request(), 1, ['crypto', 'search'])).json() as CryptoSearch;
  assert.equal(popular.assets.length, 6); assert.equal(calls, 1);
  const empty = await (await service.handle(request('q=missing'), 1, ['crypto', 'search'])).json() as CryptoSearch;
  assert.deepEqual(empty.assets, []); assert.equal(calls, 2);
});

test('crypto: Demo key stays in header and changes isolate cached responses', async t => {
  environment(t); let calls = 0;
  const service = createCryptoService(mockFetch((url, options) => {
    calls++; assert.equal(url.searchParams.has('apikey'), false);
    assert.equal(new Headers(options?.headers).get('x-cg-demo-api-key'), process.env.COINGECKO_API_KEY);
    return Response.json([coin()]);
  }), () => NOW);
  process.env.COINGECKO_API_KEY = 'private-demo-one';
  const data = await (await service.handle(request(), 1, ['crypto'])).json();
  assert.equal(JSON.stringify(data).includes('private-demo'), false);
  process.env.COINGECKO_API_KEY = 'private-demo-two';
  await service.handle(request(), 1, ['crypto']); assert.equal(calls, 2);
});

test('crypto: malformed, excessive or denied upstream responses preserve unavailable state', async t => {
  environment(t);
  for (const upstream of [Response.json({ error: 'quota' }), new Response('bad json'), new Response('x'.repeat(4_000_001)), new Response('', { status: 403 })]) {
    const service = createCryptoService(mockFetch(() => upstream), () => NOW);
    const data = await (await service.handle(request(), 1, ['crypto'])).json() as CryptoDashboard;
    assert.equal(data.assets.length, 0); assert.equal(data.asOf, null); assert.ok(data.notice);
  }
});

test('crypto: outstanding queries are bounded and denial backoff applies across endpoints', async t => {
  environment(t); let calls = 0;
  const blocked = createCryptoService(mockFetch(() => { calls++; return new Response('', { status: 403 }); }), () => NOW);
  await blocked.handle(request(), 1, ['crypto']);
  await assert.rejects(blocked.handle(request('q=bitcoin'), 1, ['crypto', 'search']), { status: 503 });
  assert.equal(calls, 1);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const service = createCryptoService(mockFetch(async () => { await wait; return Response.json({ coins: [] }); }), () => NOW);
  const first = Array.from({ length: 12 }, (_, index) => service.handle(request('q=coin' + index), 1, ['crypto', 'search']));
  await assert.rejects(service.handle(request('q=extra'), 1, ['crypto', 'search']), { status: 503 });
  release(); await Promise.all(first);
});
