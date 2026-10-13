import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { decodeHTML } from 'entities';
import { ApiError, json } from './http';

const PAGE_SIZE = 100;
const TOPICS: Record<string, string> = {
    technology: 'technology OR science OR tecnologia OR ciencia',
    business: 'finance OR stocks OR investments OR economia OR investimentos OR juros OR bolsa',
    culture: 'art OR culture OR arte OR cultura',
    sports: 'sports OR football OR esportes OR futebol',
    entertainment: 'entertainment OR music OR cinema OR entretenimento',
};
const EXCLUSIONS = ' NOT (crime OR murder OR violence OR porn OR sex OR robbery OR war OR homicidio OR assassinato OR estupro OR tiroteio)';
const UNSUITABLE_TERMS = /\b(crim\w*|murder\w*|homicid\w*|assassin\w*|robber\w*|roub\w*|furto\w*|theft|stolen|fraud\w*|scam\w*|golpes?|police|policial|policiais|arrest\w*|prisao|presos?|sequestr\w*|kidnap\w*|trafic\w*|terror\w*|shootings?|tiroteio\w*|lavagem de dinheiro|money laundering|corrup\w*|extor\w*|violen\w*|delito\w*|asesinat\w*|estafa\w*|meurtre\w*|betrug\w*|mord\w*|porn\w*|sex\w*|nude\w*|nudi\w*|erotic\w*|estupro\w*|rape|rapist\w*|abuso\w*|onlyfans|massacr\w*|guerra\w*|war|warfare|bomb\w*|gore|suicid\w*|esfaque\w*|stabb\w*|behead\w*|tortur\w*|agress\w*)\b/;
const unavailable = () => new ApiError(503, 'Não foi possível atualizar as notícias. Tente novamente em instantes.', 'unavailable');
const privateAddresses = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) privateAddresses.addSubnet(address, prefix, 'ipv6');

function record(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
function plain(value: unknown, maximum: number): string {
    return typeof value === 'string' ? decodeHTML(value.slice(0, 20000).replace(/<!--[\s\S]*?-->|<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}
export function publicURL(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) return null;
    try {
        const parsed = new URL(value), hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
        if (!['http:', 'https:'].includes(parsed.protocol) || !hostname || parsed.username || parsed.password || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return null;
        const version = isIP(hostname);
        if (version && privateAddresses.check(hostname, version === 4 ? 'ipv4' : 'ipv6')) return null;
        return value;
    } catch {return null;}
}
export function topicSelection(value: string): string[] {
    const topics = [...new Set(value.split(',').filter(Boolean))].sort();
    if (topics.some(topic => !Object.hasOwn(TOPICS, topic))) throw new ApiError(400, 'Página ou tópico inválido.');
    return topics;
}
export function newsQuery(topics: string[] = []): string {return '(' + (topics.length ? topics : ['business']).map(topic => TOPICS[topic]).join(' OR ') + ')' + EXCLUSIONS;}
export function normalizeArticle(item: unknown) {
    if (!record(item)) return null;
    const words = ['title', 'description', 'content'].map(field => plain(item[field], 20000)).join(' ').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    if (UNSUITABLE_TERMS.test(words)) return null;
    const url = publicURL(item.url), image = publicURL(item.urlToImage), title = plain(item.title, 300);
    if (!url || !image || !title) return null;
    const source = (record(item.source) ? plain(item.source.name, 120) : '') || new URL(url).hostname;
    const date = typeof item.publishedAt === 'string' ? new Date(item.publishedAt) : null;
    return {
        id:createHash('sha256').update(url).digest('hex').slice(0, 24), title,
        description:plain(item.description || item.content, 550), url, image,
        published_at:date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
        source, sources:[{name:source, url}],
    };
}
interface ProviderResult { articles: unknown[]; totalResults: number; has_more?: boolean }
type Mode = 'for-you' | 'top';
type Languages = 'pt-en' | 'all';
type Fetcher = (token: string, page: number, topics: string[], mode: Mode, languages: Languages) => Promise<ProviderResult>;
export async function fetchNewsAPI(token: string, page: number, topics: string[] = [], mode: Mode = 'for-you', languages: Languages | 'pt' | 'en' = 'pt-en'): Promise<ProviderResult> {
    if (languages === 'pt-en') {
        const results = await Promise.all(['pt', 'en'].map(language => fetchNewsAPI(token, page, topics, mode, language as 'pt' | 'en')));
        return {
            articles:Array.from({length:PAGE_SIZE}, (_, index) => results.flatMap(result => result.articles[index] === undefined ? [] : [result.articles[index]])).flat(),
            totalResults:results.reduce((total, result) => total + result.totalResults, 0),
            has_more:results.some(result => page * PAGE_SIZE < result.totalResults),
        };
    }
    const query = new URLSearchParams({q:newsQuery(topics), searchIn:'title,description', sortBy:mode === 'top' ? 'popularity' : 'publishedAt', pageSize:String(PAGE_SIZE), page:String(page)});
    if (languages !== 'all') query.set('language', languages);
    try {
        const response = await fetch('https://newsapi.org/v2/everything?' + query, {headers:{Accept:'application/json', 'User-Agent':'Comet/1.0', 'X-Api-Key':token}, redirect:'error', signal:AbortSignal.timeout(10000), cache:'no-store'});
        if ([401, 403].includes(response.status)) throw new ApiError(503, 'O serviço de notícias ainda não está disponível.', 'configuration');
        if ([402, 429].includes(response.status)) throw new ApiError(503, 'As notícias estão temporariamente indisponíveis. Tente novamente mais tarde.', 'quota');
        if (!response.ok || !response.body) throw unavailable();
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            for (;;) {
                const {done, value} = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 2000000) {await reader.cancel(); throw unavailable();}
                chunks.push(value);
            }
        } finally {reader.releaseLock();}
        const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(result) || result.status !== 'ok' || !Array.isArray(result.articles)) throw unavailable();
        return {articles:result.articles.slice(0, PAGE_SIZE), totalResults:Number.isFinite(Number(result.totalResults)) ? Math.max(0, Number(result.totalResults)) : 0};
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw unavailable();
    }
}
type NewsResult = {articles:NonNullable<ReturnType<typeof normalizeArticle>>[]; page:number; has_more:boolean; updated_at:string; provider:string};
export class NewsService {
    private cache = new Map<string, {at:number; result:NewsResult}>();
    private errors = new Map<string, {until:number; error:ApiError}>();
    private pending = new Map<string, Promise<NewsResult & {stale:boolean}>>();
    constructor(private token: string, private fetcher: Fetcher = fetchNewsAPI, private clock: () => number = Date.now) {}
    async get(page: number, topics: string[] = [], mode: Mode = 'for-you', languages: Languages = 'pt-en') {
        if (!this.token) throw new ApiError(503, 'As notícias estarão disponíveis em breve.', 'configuration');
        const key = JSON.stringify([page, topics, mode, languages]), now = this.clock();
        const cached = this.cache.get(key), failure = this.errors.get(key);
        if (cached && now - cached.at < 1800000) return {...cached.result, stale:false};
        if (failure && now < failure.until) {
            if (cached && now - cached.at < 86400000) return {...cached.result, stale:true};
            throw failure.error;
        }
        const pending = this.pending.get(key);
        if (pending) return pending;
        const fetchResult = async () => {
            try {
                const payload = await this.fetcher(this.token, page, topics, mode, languages);
                const articles = [], seen = new Set<string>();
                for (const item of payload.articles.slice(0, 200)) {
                    const article = normalizeArticle(item);
                    if (article && !seen.has(article.id)) {articles.push(article); seen.add(article.id);}
                }
                const result = {articles, page, has_more:!!payload.articles.length && page < 10 && (payload.has_more ?? page * PAGE_SIZE < payload.totalResults), updated_at:new Date().toISOString(), provider:'NewsAPI'};
                if (this.cache.size >= 64) {const oldest = this.cache.keys().next().value; if (oldest !== undefined) this.cache.delete(oldest);}
                this.cache.set(key, {at:this.clock(), result});
                this.errors.delete(key);
                return {...result, stale:false};
            } catch (error) {
                const safeError = error instanceof ApiError ? error : unavailable();
                if (this.errors.size >= 64) {const oldest = this.errors.keys().next().value; if (oldest !== undefined) this.errors.delete(oldest);}
                this.errors.set(key, {until:this.clock() + 300000, error:safeError});
                if (cached && this.clock() - cached.at < 86400000) return {...cached.result, stale:true};
                throw safeError;
            }
        };
        const work = fetchResult().finally(() => this.pending.delete(key));
        this.pending.set(key, work);
        return work;
    }
}
let service: NewsService | undefined;
export async function handleNews(request: Request): Promise<Response> {
    if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
    const params = new URL(request.url).searchParams;
    const languages = params.get('languages') ?? 'pt-en', mode = params.get('mode') ?? 'for-you';
    const pageText = params.get('page') ?? '1', page = Number(pageText);
    if (!['pt-en', 'all'].includes(languages) || !['for-you', 'top'].includes(mode) || !/^\d+$/.test(pageText) || !Number.isInteger(page) || page < 1 || page > 10) throw new ApiError(400, 'Página ou tópico inválido.');
    const topics = topicSelection(params.get('topics') ?? '');
    service ??= new NewsService(process.env.NEWS_API_KEY || '');
    return json(await service.get(page, topics, mode as Mode, languages as Languages));
}