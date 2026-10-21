import { createHash } from 'node:crypto';
import { ApiError, json } from '../http';
import type { CryptoAsset, CryptoDashboard, CryptoDetail, CryptoHistory, CryptoRange, CryptoSearch, CryptoSource } from '../../shared/crypto';

const MINUTE = 60_000;
const TTL = 5 * MINUTE, MAX_AGE = 15 * MINUTE, MAX_ENTRIES = 128;
const DAYS: Record<CryptoRange, number> = { '1d': 1, '5d': 5, '1m': 30, '6m': 180, '1y': 365 };
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const KNOWN_CRYPTO = new Set(['bitcoin', 'ethereum', 'solana', 'ripple', 'tether', 'binancecoin', 'usd-coin', 'dogecoin', 'cardano', 'tron']);
const SOURCE = { provider: 'CoinGecko', sourceUrl: 'https://www.coingecko.com/en/api' };

type Row = Record<string, unknown>;
type Payload = CryptoDashboard | CryptoSearch | CryptoDetail | CryptoHistory;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
function number(value: unknown, nonnegative = false): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && (!nonnegative || result >= 0) ? result : null;
}
function text(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? value.slice(0, 120) : fallback; }
function image(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); if (url.protocol === 'https:' && ['coin-images.coingecko.com', 'assets.coingecko.com'].includes(url.hostname)) return url.href; } catch { /* Invalid provider image. */ }
}
function validTime(value: unknown, now: number): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + MINUTE ? parsed : null;
}
function sample(points: number[], maximum = 80): number[] {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * (points.length - 1) / (maximum - 1))]);
}
function normalize(value: unknown, now: number): CryptoSearch {
  if (!Array.isArray(value)) throw new ApiError(502, 'A fonte de criptomoedas retornou dados inválidos.');
  const seen = new Set<string>();
  const assets = value.slice(0, 100).flatMap(item => {
    const row = object(item), id = row.id;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) return [];
    seen.add(id);
    const prices = object(row.sparkline_in_7d).price;
    const asset: CryptoAsset = { id, symbol: text(row.symbol, id).toUpperCase(), name: text(row.name, id), kind: 'crypto', price: number(row.current_price, true), change: number(row.price_change_24h), changePercent: number(row.price_change_percentage_24h), marketCap: number(row.market_cap, true), volume: number(row.total_volume, true), points: Array.isArray(prices) ? sample(prices.map(point => number(point, true)).filter((point): point is number => point !== null)) : [] };
    const logo = image(row.image); if (logo) asset.image = logo;
    return [asset];
  });
  const times = value.map(item => validTime(object(item).last_updated, now)).filter((time): time is number => time !== null);
  return { assets, ...SOURCE, asOf: times.length ? new Date(Math.max(...times)).toISOString() : null, stale: false };
}
function provenance(value: CryptoSource): CryptoSource {
  return { provider: value.provider, sourceUrl: value.sourceUrl, asOf: value.asOf, stale: value.stale, ...(value.notice ? { notice: value.notice } : {}) };
}

// One server cache serves every user; no user data or upstream credentials enter responses.
export function createCryptoService(fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  const cache = new Map<string, { value: Payload; saved: number }>();
  const pending = new Map<string, Promise<Payload>>();
  const retryAt = new Map<string, number>();
  const keyFor = () => {
    const secret = process.env.COINGECKO_API_KEY?.trim() ?? '';
    return { secret, scope: createHash('sha256').update(secret).digest('hex').slice(0, 16) };
  };
  async function upstream(path: string, params: Record<string, string>): Promise<unknown> {
    const { secret, scope } = keyFor();
    if ((retryAt.get(scope) ?? 0) > clock()) throw new ApiError(503, 'A fonte de cotações está temporariamente indisponível. Tente novamente em instantes.');
    const url = new URL(path, 'https://api.coingecko.com/api/v3/');
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Comet/1.0 (personal crypto research)' };
    if (secret) headers['x-cg-demo-api-key'] = secret;
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(12_000), cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status) || response.status >= 500) {
          const seconds = Number(response.headers.get('retry-after'));
          const delay = response.status === 401 || response.status === 403 ? 15 * MINUTE : Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 15 * MINUTE) : MINUTE;
          if (retryAt.size >= 8) retryAt.delete(retryAt.keys().next().value!);
          retryAt.set(scope, clock() + delay);
        }
        throw new ApiError(response.status === 404 ? 404 : 503, response.status === 404 ? 'Criptomoeda não encontrada.' : [401, 402, 403].includes(response.status) ? 'O provedor não liberou estes dados para a configuração atual.' : 'A fonte de cotações está indisponível. Tente novamente em instantes.');
      }
      const chunks: Uint8Array[] = []; let length = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.byteLength;
            if (length > 4_000_000) { await reader.cancel(); throw new ApiError(502, 'A fonte retornou dados acima do limite permitido.'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (retryAt.size >= 8) retryAt.delete(retryAt.keys().next().value!);
      retryAt.set(scope, clock() + MINUTE);
      throw new ApiError(503, 'Não foi possível consultar a fonte de cotações.');
    }
  }
  async function cached<T extends Payload>(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = cache.get(key), age = entry ? clock() - entry.saved : Infinity;
    if (entry && age < TTL) return entry.value as T;
    let loading = pending.get(key);
    if (!loading) {
      if (pending.size >= 12) throw new ApiError(503, 'Muitas consultas em andamento. Tente novamente em instantes.');
      loading = loader().then(value => {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, saved: clock() }); return value;
      }).finally(() => pending.delete(key));
      pending.set(key, loading);
    }
    try { return await loading as T; }
    catch (error) {
      if (entry && clock() - entry.saved <= MAX_AGE) return { ...entry.value, stale: true, notice: 'A atualização falhou. Exibindo a última consulta disponível. ' + (entry.value.notice ?? '') } as T;
      throw error;
    }
  }
  function recentAsset(id: string): CryptoDetail | undefined {
    const prefix = keyFor().scope + ':';
    for (const [key, entry] of cache) {
      if (!key.startsWith(prefix) || clock() - entry.saved >= TTL) continue;
      const value = entry.value;
      const asset = 'assets' in value ? value.assets.find(item => item.id === id) : 'asset' in value && value.asset.id === id ? value.asset : undefined;
      if (asset && 'sourceUrl' in value) return { asset, ...provenance(value) };
    }
  }
  async function dashboard(): Promise<CryptoDashboard> {
    try {
      return await cached(keyFor().scope + ':dashboard', async () => {
        const result = normalize(await upstream('coins/markets', { vs_currency: 'usd', order: 'market_cap_desc', per_page: '100', page: '1', sparkline: 'true' }), clock());
        if (!result.assets.some(asset => asset.price !== null)) throw new ApiError(502, 'A fonte de criptomoedas não retornou cotações.');
        const top = ['bitcoin', 'ethereum', 'solana', 'ripple'].flatMap(id => result.assets.find(asset => asset.id === id) ?? []);
        return { ...result, top, configured: true };
      });
    } catch (error) {
      return { assets: [], top: [], ...SOURCE, asOf: null, stale: false, configured: true, notice: error instanceof ApiError ? error.message : 'Cotações indisponíveis.' };
    }
  }
  async function asset(id: string): Promise<CryptoDetail> {
    const recent = recentAsset(id); if (recent) return recent;
    return cached(keyFor().scope + ':asset:' + id, async () => {
      const result = normalize(await upstream('coins/markets', { vs_currency: 'usd', ids: id, sparkline: 'true' }), clock());
      const found = result.assets.find(item => item.id === id);
      if (!found) throw new ApiError(404, 'Criptomoeda não encontrada.');
      return { asset: found, ...provenance(result) };
    });
  }
  async function search(query: string): Promise<CryptoSearch> {
    if (!query) { const result = await dashboard(); return { assets: result.assets.slice(0, 6), ...provenance(result) }; }
    return cached(keyFor().scope + ':search:' + query.toLowerCase(), async () => {
      const body = object(await upstream('search', { query }));
      if (!Array.isArray(body.coins)) throw new ApiError(502, 'A fonte de criptomoedas retornou uma pesquisa inválida.');
      const seen = new Set<string>();
      const rows = body.coins.slice(0, 100).map(object).filter(row => {
        if (typeof row.id !== 'string' || !ID.test(row.id) || seen.has(row.id)) return false;
        seen.add(row.id); return true;
      }).slice(0, 8);
      if (!rows.length) return { assets: [], ...SOURCE, asOf: null, stale: false };
      const result = normalize(await upstream('coins/markets', { vs_currency: 'usd', ids: rows.map(row => row.id).join(','), sparkline: 'false' }), clock());
      const byId = new Map(result.assets.map(item => [item.id, item]));
      const assets = rows.map(row => byId.get(row.id as string) ?? normalize([{ id: row.id, symbol: row.symbol, name: row.name, image: row.large ?? row.thumb }], clock()).assets[0]);
      return { assets, ...provenance(result) };
    });
  }
  async function history(id: string, range: CryptoRange): Promise<CryptoHistory> {
    return cached(keyFor().scope + ':history:' + id + ':' + range, async () => {
      if (!KNOWN_CRYPTO.has(id) && !recentAsset(id)) await asset(id);
      const now = clock(), cutoff = now - DAYS[range] * 86_400_000;
      const raw = object(await upstream('coins/' + encodeURIComponent(id) + '/market_chart', { vs_currency: 'usd', days: String(DAYS[range]) })).prices;
      if (!Array.isArray(raw)) throw new ApiError(502, 'Histórico indisponível para esta criptomoeda.');
      const seen = new Map<number, number>();
      for (const item of raw.slice(0, 12_000)) {
        const timestamp = Array.isArray(item) ? validTime(item[0], now) : null, value = Array.isArray(item) ? number(item[1], true) : null;
        if (timestamp !== null && value !== null && timestamp >= cutoff) seen.set(timestamp, value);
      }
      let points = [...seen].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
      if (!points.length) throw new ApiError(502, 'Nenhum histórico disponível para este intervalo.');
      if (points.length > 500) points = Array.from({ length: 500 }, (_, index) => points[Math.round(index * (points.length - 1) / 499)]);
      return { points, provider: SOURCE.provider, currency: 'USD', asOf: new Date(points.at(-1)!.time).toISOString(), stale: false };
    });
  }
  async function handle(request: Request, _userId: number, segments: string[]): Promise<Response> {
    if (segments[0] !== 'crypto' || segments.length > 2 || segments.length === 2 && !['history', 'search', 'asset'].includes(segments[1])) throw new ApiError(404, 'Rota não encontrada.');
    if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
    const params = new URL(request.url).searchParams;
    if (params.has('kind') && params.get('kind') !== 'crypto' || params.has('view') && params.get('view') !== 'crypto') throw new ApiError(400, 'Apenas criptomoedas estão disponíveis.');
    if (segments.length === 1) return json(await dashboard());
    if (segments[1] === 'search') {
      const query = (params.get('q') ?? '').trim();
      if (query.length > 80 || /[\x00-\x1f\x7f]/.test(query)) throw new ApiError(400, 'Pesquisa inválida. Use até 80 caracteres.');
      return json(await search(query));
    }
    const id = params.get('id') ?? '';
    if (!ID.test(id)) throw new ApiError(400, 'Criptomoeda inválida.');
    if (segments[1] === 'asset') return json(await asset(id));
    const range = params.get('range') ?? '1m';
    if (!Object.hasOwn(DAYS, range)) throw new ApiError(400, 'Intervalo inválido.');
    return json(await history(id, range as CryptoRange));
  }
  return { handle };
}
const service = createCryptoService();
export const handleCrypto = service.handle;
