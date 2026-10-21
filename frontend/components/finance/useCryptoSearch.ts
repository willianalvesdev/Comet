import {useEffect,useState} from 'react';
import type {CryptoAsset} from '../../../shared/crypto';
export function useCryptoSearch(query:string,open:boolean) {
    const [assets, setAssets] = useState<CryptoAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true); setError(''); setNotice(''); setAssets([]);
        const timer = window.setTimeout(() => {
            fetch(`/api/finance/crypto/search?${new URLSearchParams({q:query.trim()})}`, {signal:controller.signal})
                .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
                .then(body => {
                    if (!Array.isArray(body.assets)) throw new Error();
                    if (!controller.signal.aborted) { setAssets(body.assets); setNotice(typeof body.notice === 'string' && (body.stale || !body.assets.length) ? body.notice : ''); }
                })
                .catch(() => { if (!controller.signal.aborted) setError('Não foi possível buscar criptomoedas.'); })
                .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        }, query.trim() ? 250 : 0);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [query, open, retry]);
    return {assets,loading,error,notice,retry:()=>setRetry(value=>value+1)};
}
