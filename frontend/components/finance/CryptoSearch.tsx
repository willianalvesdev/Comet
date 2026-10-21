import {cryptoPercent as percent,cryptoTrend} from '../../../shared/crypto-chart';
import { useEffect, useId, useRef, useState } from 'react';
import {useCryptoSearch} from './useCryptoSearch';
import LoadingIndicator from '../LoadingIndicator';

const quote = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pt-BR', {style:'currency',currency:'USD',maximumFractionDigits:value !== 0 && Math.abs(value) < 1 ? 6 : 2}).format(value);
function imageUrl(value?: string) { try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; } }

export default function CryptoSearch() {
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const listId = useId();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const {assets,loading,error,notice,retry}=useCryptoSearch(query,open);
    const [active,setActive]=useState(-1);
    useEffect(()=>setActive(-1),[query,open]);
    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);
    useEffect(() => { if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'}); }, [active, listId]);
    function update(value: string) { setQuery(value); setOpen(true); setActive(-1); }
    return <div className="crypto-search" ref={root} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <div className="crypto-search-field">
            <i className="market-icon market-icon--search" aria-hidden="true" />
            <input ref={input} type="search" role="combobox" aria-label="Pesquisar criptomoedas" placeholder="Pesquise cripto..." autoComplete="off" spellCheck={false} value={query} maxLength={80} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} onFocus={() => setOpen(true)} onChange={event => update(event.target.value)} onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); if (!loading && assets.length) setActive(current => Math.max(0, Math.min(assets.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); }
                else if (event.key === 'Enter' && open && active >= 0 && assets[active] && !loading) { event.preventDefault(); setOpen(false); void window.WorkspaceNavigation.go(`/finance/crypto/${encodeURIComponent(assets[active].id)}`); }
            }} />
            {query && <button type="button" className="crypto-search-clear" aria-label="Limpar pesquisa" onClick={() => { update(''); input.current?.focus(); }}><i className="market-icon market-icon--close" aria-hidden="true" /></button>}
        </div>
        {open && <div className="crypto-search-menu">
            {loading ? <div className="crypto-search-status"><LoadingIndicator label="Buscando criptomoedas" /></div> : error ? <div className="crypto-search-status"><p role="status">{error}</p><button type="button" className="market-text-button" onClick={retry}>Tentar novamente</button></div> : <>
                <div className="crypto-search-heading">{query.trim() ? 'Resultados' : 'Em alta'}</div>
                <div id={listId} role="listbox" aria-label={query.trim() ? 'Criptomoedas encontradas' : 'Criptomoedas em alta'}>
                    {assets.map((asset, index) => <a href={`/finance/crypto/${encodeURIComponent(asset.id)}`} id={`${listId}-${index}`} key={asset.id} role="option" aria-selected={active === index} className="crypto-search-result" onPointerMove={() => setActive(index)} onClick={() => setOpen(false)}>
                        <span className="market-logo">{imageUrl(asset.image) ? <img src={imageUrl(asset.image)} alt="" onError={event => { event.currentTarget.hidden = true; }} /> : asset.symbol.slice(0,2)}</span>
                        <span className="crypto-search-name"><strong>{asset.name}</strong><small>{asset.symbol} · CRIPTO · USD</small></span>
                        <span className="crypto-search-price">{quote(asset.price)}</span>
                        <span className={`crypto-search-change market-change--${cryptoTrend(asset.changePercent)}`}>{percent(asset.changePercent)}</span>
                        <i className="market-icon market-icon--right" aria-hidden="true" />
                    </a>)}
                </div>
                {!assets.length && <p className="crypto-search-status" role="status">Nenhuma criptomoeda encontrada.</p>}
                {notice && <p className="crypto-search-notice">{notice}</p>}
            </>}
        </div>}
    </div>;
}
