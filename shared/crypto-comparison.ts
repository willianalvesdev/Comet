// CoinGecko IDs are stable; ticker symbols can identify more than one coin.
export const COMPARISON_COLORS=Array.from({length:7},(_,index)=>`var(--crypto-comparison-${index+1})`);
export const COMPARISON_LIMIT=COMPARISON_COLORS.length;
export function comparisonIds(search:string,primary:string):string[] {
    const ids=new URLSearchParams(search).get('comparing')?.split(',')??[];
    return [...new Set(ids.filter(id=>id!==primary&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)))].slice(0,COMPARISON_LIMIT-1);
}
export function comparisonURL(current:string,primary:string,ids:string[]):URL {
    const url=new URL(current);
    if(ids.length||url.searchParams.has('comparing'))url.searchParams.set('comparing',[primary,...ids].join(','));
    else url.searchParams.delete('comparing');
    return url;
}
