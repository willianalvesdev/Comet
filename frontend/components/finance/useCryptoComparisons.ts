import {useEffect,useMemo,useRef,useState} from 'react';
import type {CryptoAsset,CryptoHistory,CryptoRange} from '../../../shared/crypto';
import {comparisonIds,comparisonURL,COMPARISON_LIMIT} from '../../../shared/crypto-comparison';
export interface ComparedAsset {asset?:CryptoAsset;history?:CryptoHistory;error?:string;}
export function useCryptoComparisons(primary:CryptoAsset,assets:CryptoAsset[],range:CryptoRange) {
    const [ids,setIds]=useState(()=>comparisonIds(location.search,primary.id));
    const [data,setData]=useState<Record<string,ComparedAsset>>({}),[attempt,setAttempt]=useState(0);
    const catalog=useRef(new Map<string,CryptoAsset>()),cache=useRef(new Map<string,ComparedAsset>());
    assets.forEach(asset=>catalog.current.set(asset.id,asset));
    useEffect(()=>{
        const sync=()=>setIds(comparisonIds(location.search,primary.id));
        window.addEventListener('popstate',sync);
        return()=>window.removeEventListener('popstate',sync);
    },[primary.id]);
    useEffect(()=>{
        const url=comparisonURL(location.href,primary.id,ids);
        window.WorkspaceNavigation.replaceURL?.(url);
    },[primary.id,ids]);
    const selection=ids.join(',');
    useEffect(()=>{
        const controller=new AbortController();
        for(const id of ids) {
            const key=range+':'+id,cached=cache.current.get(key);
            if(cached){setData(prev=>({...prev,[key]:cached}));continue;}
            setData(prev=>({...prev,[key]:{asset:catalog.current.get(id)}}));
            const get=async(url:string)=>{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error();return response.json();};
            const coin=catalog.current.get(id);
            Promise.all([coin?Promise.resolve(coin):get('/api/finance/crypto/asset?'+new URLSearchParams({id})).then(body=>{if(body.asset?.id!==id)throw Error();return body.asset as CryptoAsset;}),get('/api/finance/crypto/history?'+new URLSearchParams({id,range}))])
                .then(([asset,history]:[CryptoAsset,CryptoHistory])=>{
                    if(!Array.isArray(history.points))throw Error();
                    if(controller.signal.aborted)return;
                    catalog.current.set(id,asset);const entry={asset,history};cache.current.set(key,entry);setData(prev=>({...prev,[key]:entry}));
                })
                .catch(()=>{if(!controller.signal.aborted)setData(prev=>({...prev,[key]:{asset:catalog.current.get(id),error:'Não foi possível carregar esta comparação.'}}));});
        }
        return()=>controller.abort();
    },[selection,range,attempt]);
    const entries=useMemo(()=>ids.map(id=>({id,...data[range+':'+id]})),[ids,data,range]);
    return {ids,entries,add:(asset:CryptoAsset)=>{catalog.current.set(asset.id,asset);setIds(prev=>asset.id===primary.id||prev.includes(asset.id)?prev:[...prev.slice(0,COMPARISON_LIMIT-2),asset.id]);},remove:(id:string)=>setIds(prev=>prev.filter(value=>value!==id)),retry:()=>setAttempt(value=>value+1)};
}
