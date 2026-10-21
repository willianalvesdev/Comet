import {cryptoPercent as percentage,cryptoTrend as sign} from '../../../shared/crypto-chart';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CryptoAsset, CryptoDashboard as CryptoData, CryptoHistory } from '../../../shared/crypto';
import LoadingIndicator from '../LoadingIndicator';
import CryptoComposer from './CryptoComposer';
import CryptoAssetChart from './CryptoAssetChart';

type Article = { id: string; title: string; description?: string; url: string; image?: string; published_at?: string; source: string };
type SavedAsset = Pick<CryptoAsset, 'id' | 'kind' | 'symbol' | 'name'>;
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
const money = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 6 : 2 }).format(value);
const assetPrice = (asset: CryptoAsset, value = asset.price) => money(value);
const keyOf = (asset: Pick<CryptoAsset, 'kind' | 'id'>) => `${asset.kind}:${asset.id}`;
const safeUrl = (value?: string) => { try { const url = new URL(value || ''); return /^https?:$/.test(url.protocol) ? url.href : undefined; } catch { return undefined; } };
const dateLabel = (value?: string | null) => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null; };
function Change({ value }: { value: number | null }) { return <span className={`market-change market-change--${sign(value)}`}>{percentage(value)}</span>; }
function Logo({ asset }: { asset: CryptoAsset }) {
    const [failed, setFailed] = useState(false);
    return <span className="market-logo">{safeUrl(asset.image) && !failed ? <img src={safeUrl(asset.image)} alt="" loading="lazy" onError={() => setFailed(true)} /> : asset.symbol.slice(0, 2)}</span>;
}
function Sparkline({ points, change }: { points: number[]; change: number | null }) {
    const values = points.filter(Number.isFinite);
    if (values.length < 2) return <span className="market-spark-empty">Histórico indisponível</span>;
    const min = Math.min(...values), span = Math.max(...values) - min || 1;
    const path = values.map((value, index) => `${index ? 'L' : 'M'}${(index / (values.length - 1) * 240).toFixed(1)},${(54 - (value - min) / span * 44).toFixed(1)}`).join(' ');
    return <svg className={`market-spark market-change--${sign(change)}`} viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}
function AssetRow({ asset, open, saved, toggle }: { asset: CryptoAsset; open: (asset: CryptoAsset) => void; saved?: boolean; toggle?: (asset: CryptoAsset) => void }) {
    return <div className="market-asset-row"><button type="button" className="market-asset-open" onClick={() => open(asset)} aria-label={`Ver ${asset.name}`}><Logo asset={asset} /><span className="market-asset-name"><span>{asset.name}</span><small>{asset.symbol}</small></span><span className="market-asset-quote"><span>{assetPrice(asset)}</span><Change value={asset.changePercent} /></span></button>{toggle && <button type="button" className="market-watch-button" aria-label={`${saved ? 'Remover' : 'Adicionar'} ${asset.name} ${saved ? 'da' : 'à'} lista`} aria-pressed={Boolean(saved)} onClick={() => toggle(asset)}><i className={`market-icon market-icon--${saved ? 'check' : 'star'}`} aria-hidden="true" /></button>}</div>;
}
function Leaderboard({ assets, open }: { assets: CryptoAsset[]; open: (asset: CryptoAsset) => void }) {
    const [sort, setSort] = useState<{ key: 'marketCap' | 'volume' | 'price' | 'changePercent'; direction: number }>({ key: 'marketCap', direction: -1 });
    const sorted = [...assets].sort((a, b) => a[sort.key] === null ? 1 : b[sort.key] === null ? -1 : (a[sort.key]! - b[sort.key]!) * sort.direction);
    const headers = [{ key: 'marketCap', label: 'Valor de mercado' }, { key: 'volume', label: 'Volume 24h' }, { key: 'price', label: 'Preço' }, { key: 'changePercent', label: 'Variação 24h' }] as const;
    return <section className="market-section"><div className="market-section-heading"><h2>Ranking de criptomoedas</h2><span className="market-small-pill">Mercado agregado</span></div><p className="market-caption">Cotações em dólar · ordene pelas colunas</p><div className="market-table-wrap market-card"><table className="market-table"><thead><tr><th scope="col">Ativo</th>{headers.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort({ key: column.key, direction: sort.key === column.key ? -sort.direction : -1 })}>{column.label}{sort.key === column.key && <span aria-hidden="true">{sort.direction === 1 ? ' ↑' : ' ↓'}</span>}</button></th>)}</tr></thead><tbody>{sorted.map(asset => <tr key={keyOf(asset)}><th scope="row"><button type="button" className="market-table-asset" onClick={() => open(asset)}><Logo asset={asset} /><span><span className="market-table-asset-name">{asset.name}</span><small>{asset.symbol}</small></span></button></th><td>{asset.marketCap === null ? '—' : `US$ ${compact.format(asset.marketCap)}`}</td><td>{asset.volume === null ? '—' : `US$ ${compact.format(asset.volume)}`}</td><td><button type="button" className="market-table-price" onClick={() => open(asset)}>{assetPrice(asset)}</button></td><td><Change value={asset.changePercent} /></td></tr>)}</tbody></table>{!sorted.length && <p className="market-empty">Nenhum ativo encontrado.</p>}</div></section>;
}

function AssetDetail({ asset, assets, saved, toggle }: { asset: CryptoAsset; assets: CryptoAsset[]; saved: boolean; toggle: (asset: CryptoAsset) => void }) {
    return <section className="market-asset-detail" aria-labelledby="market-asset-title">
        <header><div className="market-detail-identity"><Logo asset={asset}/><div><h1 id="market-asset-title">{asset.name}</h1><small>{asset.symbol} · USD</small></div></div><button type="button" className="market-small-pill market-save" aria-pressed={saved} onClick={()=>toggle(asset)}><i className={`market-icon market-icon--${saved?'check':'star'}`} aria-hidden="true"/>{saved?'Na sua lista':'Acompanhar'}</button></header>
        <CryptoAssetChart asset={asset} assets={assets}/>
    </section>;
}
function News({ articles, loading, error, retry }: { articles: Article[]; loading: boolean; error: boolean; retry: () => void }) {
    return <section className="market-section"><div className="market-section-heading"><h2>Resumo do mercado</h2><span className="market-caption">Notícias e fontes</span></div><div className="market-card crypto-news-summary">{loading ? <div className="market-empty"><LoadingIndicator label="Buscando notícias" /></div> : articles.length ? articles.slice(0, 6).map((article, index) => <details key={article.id || article.url} open={index === 0 ? true : undefined}><summary>{article.title}<i className="market-icon market-icon--down" aria-hidden="true" /></summary><div><p>{article.description || 'Leia a cobertura completa na fonte.'}</p><a href={safeUrl(article.url)} target="_blank" rel="noopener noreferrer">{article.source}{dateLabel(article.published_at) ? ` · ${dateLabel(article.published_at)}` : ''}<span aria-hidden="true"> ↗</span></a></div></details>) : <div className="market-empty"><p>{error ? 'Não foi possível consultar as notícias agora.' : 'Nenhuma notícia disponível no momento.'}</p><button type="button" className="market-text-button" onClick={retry}>Tentar novamente</button></div>}</div></section>;
}
function DiscoverNews({ articles }: { articles: Article[] }) {
    const container = useRef<HTMLDivElement>(null);
    const [perPage, setPerPage] = useState(3);
    const [page, setPage] = useState(0);
    useEffect(() => {
        if (!container.current) return;
        const observer = new ResizeObserver(([entry]) => setPerPage(entry.contentRect.width < 580 ? 1 : 3));
        observer.observe(container.current);
        return () => observer.disconnect();
    }, [articles.length]);
    const pages = Math.ceil(articles.length / perPage);
    const current = Math.min(page, Math.max(0, pages - 1));
    useEffect(() => setPage(0), [perPage, articles]);
    if (!articles.length) return null;
    return <section className="market-section market-discover" aria-label="Descobrir notícias">
        <div className="market-section-heading"><h2>Descobrir</h2></div>
        <div className="market-news-pages" ref={container} aria-roledescription="carrossel">
            <div className="market-news-page" style={{ gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }} key={current}>
                {articles.slice(current * perPage, (current + 1) * perPage).map(article => <a className="market-news-card market-card" href={safeUrl(article.url)} key={article.id || article.url} target="_blank" rel="noopener noreferrer">
                    {safeUrl(article.image) && <img src={safeUrl(article.image)} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}
                    <span><small>{article.source}</small><strong>{article.title}</strong>{dateLabel(article.published_at) && <time>{dateLabel(article.published_at)}</time>}</span>
                </a>)}
            </div>
        </div>
        <nav className="market-carousel-controls" aria-label="Páginas de notícias">
            <button type="button" className="market-carousel-arrow" aria-label="Notícias anteriores" disabled={current === 0} onClick={() => setPage(current - 1)}><i className="market-icon market-icon--left" aria-hidden="true" /></button>
            <div className="market-carousel-dots">{Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-label={`Página ${index + 1} de notícias`} aria-current={current === index ? 'page' : undefined} onClick={() => setPage(index)}><span /></button>)}</div>
            <button type="button" className="market-carousel-arrow" aria-label="Próximas notícias" disabled={current === pages - 1} onClick={() => setPage(current + 1)}><i className="market-icon market-icon--right" aria-hidden="true" /></button>
        </nav>
        <span className="market-visually-hidden" role="status">Página {current + 1} de {pages}</span>
    </section>;
}

function TopCard({ asset, open }: { asset: CryptoAsset; open: (asset: CryptoAsset) => void }) {
    const [historyPoints, setHistoryPoints] = useState<number[]>([]);
    useEffect(() => {
        if (asset.points.length > 1 || asset.price === null) return;
        const controller = new AbortController();
        fetch(`/api/finance/crypto/history?${new URLSearchParams({ id: asset.id, range: '1m' })}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<CryptoHistory>; }).then(body => { if (!controller.signal.aborted && Array.isArray(body.points)) setHistoryPoints(body.points.map(point => point.value).filter(Number.isFinite)); }).catch(() => {});
        return () => controller.abort();
    }, [asset.id, asset.kind, asset.price, asset.points.length]);
    return <button type="button" className="market-top-card market-card" onClick={() => open(asset)}><span className="market-top-title"><span>{asset.name}</span><Change value={asset.changePercent} /></span><span className="market-top-price"><span>{assetPrice(asset)}</span><span>{asset.change === null ? asset.symbol : `${asset.change > 0 ? '+' : ''}${assetPrice(asset, asset.change)}`}</span></span><Sparkline points={asset.points.length > 1 ? asset.points : historyPoints} change={asset.changePercent} /></button>;
}
export default function CryptoDashboard({ userId, assetId, onAsset }: { userId: number; assetId?: string; onAsset:(asset:CryptoAsset|null)=>void }) {
    const [data, setData] = useState<CryptoData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [articles, setArticles] = useState<Article[]>([]);
    const [newsLoading, setNewsLoading] = useState(true);
    const [newsError, setNewsError] = useState(false);
    const [newsRetry, setNewsRetry] = useState(0);
    const [detail, setDetail] = useState<{asset: CryptoAsset; notice?: string} | null>(null);
    const [detailLoading, setDetailLoading] = useState(Boolean(assetId));
    const [detailError, setDetailError] = useState('');
    const [mover, setMover] = useState<'gainers' | 'losers' | 'active'>('gainers');
    const storageKey = `comet:crypto:watchlist:${userId}`;
    const [saved, setSaved] = useState<SavedAsset[]>(() => {
        try {
            const value = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(`comet:markets:watchlist:${userId}`) || '[]');
            return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.symbol === 'string' && item.kind === 'crypto').slice(0, 100) : [];
        } catch { return []; }
    });
    const [storageError, setStorageError] = useState('');
    useEffect(() => {
        try {
            if (localStorage.getItem(`comet:markets:watchlist:${userId}`) !== null) {
                localStorage.setItem(storageKey, JSON.stringify(saved));
                localStorage.removeItem(`comet:markets:watchlist:${userId}`);
            }
        } catch { setStorageError('A lista está disponível nesta sessão; o navegador não permitiu salvá-la.'); }
    }, [storageKey, userId, saved]);
    useEffect(() => { onAsset(detail?.asset ?? null); }, [detail, onAsset]);
    useEffect(() => {
        document.title = detail ? `${detail.asset.name} (${detail.asset.symbol}) — Comet` : 'Cripto — Comet';
    }, [detail]);
    useEffect(() => {
        const controller = new AbortController(); let pending = false;
        async function load() {
            if (pending) return; pending = true;
            try {
                const response = await fetch('/api/finance/crypto', { signal: controller.signal });
                if (!response.ok) throw new Error();
                const body = await response.json() as CryptoData;
                if (![body.assets, body.top].every(Array.isArray)) throw new Error();
                if (!controller.signal.aborted) { setData(body); setError(''); }
            } catch { if (!controller.signal.aborted) setError('Não foi possível atualizar as cotações.'); }
            finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
        }
        void load();
        const refresh = () => { if (document.visibilityState === 'visible') void load(); };
        const timer = window.setInterval(refresh, 300_000);
        window.addEventListener('online', refresh);
        return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('online', refresh); };
    }, [retry]);
    useEffect(() => {
        if (!assetId) return;
        const controller = new AbortController();
        setDetailLoading(true); setDetailError(''); setDetail(null);
        fetch(`/api/finance/crypto/asset?${new URLSearchParams({id: assetId})}`, {signal: controller.signal})
            .then(async response => { if (!response.ok) throw new Error(response.status === 404 ? 'Criptomoeda não encontrada.' : 'Não foi possível carregar esta criptomoeda.'); return response.json(); })
            .then(body => { if (!body.asset?.id) throw new Error('Criptomoeda indisponível.'); if (!controller.signal.aborted) setDetail(body); })
            .catch(failure => { if (!controller.signal.aborted) setDetailError(failure.message || 'Não foi possível carregar esta criptomoeda.'); })
            .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
        return () => controller.abort();
    }, [assetId, retry]);
    useEffect(() => {
        if (assetId) return;
        const controller = new AbortController(); setNewsLoading(true); setNewsError(false);
        fetch('/api/news?topics=crypto', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); }).then(body => { if (!controller.signal.aborted) setArticles((Array.isArray(body.articles) ? body.articles : []).filter((article: Article) => article && typeof article.title === 'string' && safeUrl(article.url)).map((article: Article) => ({ ...article, source: typeof article.source === 'string' ? article.source : 'Fonte', description: typeof article.description === 'string' ? article.description : '' })).slice(0, 12)); }).catch(() => { if (!controller.signal.aborted) setNewsError(true); }).finally(() => { if (!controller.signal.aborted) setNewsLoading(false); });
        return () => controller.abort();
    }, [newsRetry, assetId]);
    const allAssets = useMemo(() => Array.from(new Map([...(data?.assets || []), ...(data?.top || []), ...(detail ? [detail.asset] : [])].map(asset => [keyOf(asset), asset])).values()), [data, detail]);
    const currentAssets = data?.assets || [];
    const savedAssets = saved.map(item => allAssets.find(asset => keyOf(asset) === keyOf(item)) || { ...item, price: null, change: null, changePercent: null, volume: null, marketCap: null, points: [] });
    const hasSaved = (asset: CryptoAsset) => saved.some(item => keyOf(item) === keyOf(asset));
    const open = (asset: CryptoAsset) => { void window.WorkspaceNavigation.go(`/finance/crypto/${encodeURIComponent(asset.id)}`); };
    function toggle(asset: CryptoAsset) {
        const next = hasSaved(asset) ? saved.filter(item => keyOf(item) !== keyOf(asset)) : [...saved, { id: asset.id, kind: asset.kind, symbol: asset.symbol, name: asset.name }].slice(-100);
        setSaved(next);
        try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(''); } catch { setStorageError('A lista está disponível nesta sessão; o navegador não permitiu salvá-la.'); }
    }
    const movers = [...currentAssets].filter(asset => mover === 'active' ? asset.volume !== null : asset.changePercent !== null && (mover === 'gainers' ? asset.changePercent > 0 : asset.changePercent < 0)).sort((a, b) => mover === 'active' ? (b.volume || 0) - (a.volume || 0) : mover === 'gainers' ? b.changePercent! - a.changePercent! : a.changePercent! - b.changePercent!).slice(0, 5);
    const highlights = [...currentAssets].filter(asset => asset.changePercent !== null).sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!)).slice(0, 3);
    return <>
        {(error || data?.notice && (data.stale || !data.assets.length)) && <div className="market-notice" role="status"><span>{error || data?.notice}</span><button type="button" className="market-text-button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Tentar novamente</button></div>}
        <div className="crypto-layout"><div className="crypto-main">
            {assetId ? detailLoading ? <div className="market-chart-empty" aria-busy="true"><LoadingIndicator label="Carregando criptomoeda" /></div> : detailError || !detail ? <section className="market-chart-empty"><p role="status">{detailError || 'Criptomoeda indisponível.'}</p><button type="button" className="market-small-pill" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button><a className="market-text-button" href="/finance/crypto">Voltar para Cripto</a></section> : <><AssetDetail key={detail.asset.id} asset={detail.asset} assets={allAssets} saved={hasSaved(detail.asset)} toggle={toggle} /></> : <>
                <section className="market-section"><div className="market-section-heading"><h2>Movimento cripto</h2><span className="market-caption">Variação em 24h</span></div><div className="market-top-grid" aria-busy={loading}>{loading && !data ? <div className="market-empty market-card"><LoadingIndicator label="Buscando cotações" /></div> : (data?.top || []).map(asset => <TopCard key={keyOf(asset)} asset={asset} open={open} />)}</div></section>
                <News articles={articles} loading={newsLoading} error={newsError} retry={() => setNewsRetry(value => value + 1)} />
                <Leaderboard assets={currentAssets} open={open} />
            </>}
            {!assetId && <DiscoverNews articles={articles} />}
            {!assetId && highlights.length > 0 && <section className="market-section"><div className="market-section-heading"><h2>Em destaque</h2><span className="market-caption">Maiores movimentos da seleção</span></div><div className="market-highlights">{highlights.map(asset => <button type="button" className="market-highlight market-card" onClick={() => open(asset)} key={keyOf(asset)}><span className="market-highlight-name"><Logo asset={asset} /><span>{asset.name}<small>{asset.symbol}</small></span></span><span className="market-highlight-quote"><strong>{assetPrice(asset)}</strong><Change value={asset.changePercent} /></span><Sparkline points={asset.points} change={asset.changePercent} /><span className="market-highlight-meta">Volume {asset.volume === null ? '—' : compact.format(asset.volume)}</span></button>)}</div></section>}
            <p className="market-attribution">{data?.provider ? <>Dados: {safeUrl(data.sourceUrl) ? <a href={safeUrl(data.sourceUrl)} target="_blank" rel="noopener noreferrer">{data.provider}</a> : data.provider}.</> : 'Cotações indisponíveis no momento.'} Valores em USD; a disponibilidade e o atraso dependem da fonte. A lista de acompanhamento fica salva neste navegador.</p>
            <CryptoComposer />
        </div><aside className="crypto-sidebar" aria-label="Acompanhamento de criptomoedas">
            <section className="market-section"><div className="market-section-heading"><h2>Sua lista</h2><span className="market-caption">{savedAssets.length ? `${savedAssets.length} ativos` : 'Acompanhar ativos'}</span></div><div className="market-card market-watchlist">{savedAssets.map(asset => <AssetRow key={keyOf(asset)} asset={asset} open={open} saved toggle={toggle} />)}{!savedAssets.length && <p className="market-watch-hint">Adicione as criptomoedas que você quer acompanhar.</p>}<details open={savedAssets.length === 0 ? true : undefined}><summary>Adicionar ativos<i className="market-icon market-icon--down" aria-hidden="true" /></summary><div>{currentAssets.filter(asset => !hasSaved(asset)).slice(0, 8).map(asset => <AssetRow key={keyOf(asset)} asset={asset} open={open} saved={false} toggle={toggle} />)}{currentAssets.length === 0 && <p className="market-caption">As criptomoedas aparecem quando a consulta estiver disponível.</p>}</div></details>{storageError && <p className="market-caption" role="status">{storageError}</p>}</div></section>
            <section className="market-section"><div className="market-section-heading"><h2>Movimentações</h2></div><div className="market-card"><div className="market-movers-tabs" aria-label="Ordenar movimentações">{([{ value: 'gainers', label: 'Altas' }, { value: 'losers', label: 'Baixas' }, { value: 'active', label: 'Volume' }] as const).map(item => <button type="button" key={item.value} aria-pressed={mover === item.value} onClick={() => setMover(item.value)}>{item.label}</button>)}</div>{movers.length ? movers.map(asset => <AssetRow key={keyOf(asset)} asset={asset} open={open} />) : <p className="market-empty">Sem dados para esta seleção.</p>}</div></section>
        </aside></div>
    </>;
}
