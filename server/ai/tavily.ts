import {AIError,isObject} from './types';
import {fetchAI,readText,strictJSON} from './providers';
import {safeUrl,diversified,freshness,type Research,type Source,type ImageResult} from './research';

async function search(query:string,signal:AbortSignal,images=false){
    const key=process.env.TAVILY_API_KEY?.trim(),days=freshness(query);
    const headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json'};
    if(key)headers.Authorization='Bearer '+key;else headers['X-Tavily-Access-Mode']='keyless';
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
    const response=await fetchAI('https://api.tavily.com/search',{method:'POST',headers,body:JSON.stringify({
        query:query.slice(0,350),search_depth:'basic',max_results:8,auto_parameters:false,
        topic:/notícias|noticias|news/i.test(query)?'news':'general',
        ...(days?{time_range:days===1?'day':'week'}:{}),
        include_answer:false,include_raw_content:false,include_published_date:true,
        include_images:images,include_image_descriptions:images,safe_search:true,
    })},bounded,12000);
    if(!response.ok){await response.body?.cancel();throw new AIError(response.status===401||response.status===403?'tavily_auth':[429,432,433].includes(response.status)?'tavily_quota':'tavily_unavailable',503);}
    const data=strictJSON(await readText(response,bounded,524288));
    if(!isObject(data)||!Array.isArray(data.results))throw new AIError('tavily_unavailable',503);
    return data;
}
export async function tavilySearch(query:string,signal:AbortSignal):Promise<Research>{
    const data=await search(query,signal),items:Source[]=[];
    for(const entry of (data.results as unknown[]).slice(0,20)){
        if(!isObject(entry))continue;const url=safeUrl(entry.url);if(!url)continue;
        const date=typeof entry.published_date==='string'?new Date(entry.published_date):null;
        items.push({url,title:String(entry.title||new URL(url).hostname).slice(0,200),domain:new URL(url).hostname,
            excerpt:typeof entry.content==='string'?entry.content.replace(/<[^>]+>/g,'').slice(0,900):'',
            published_at:date&&Number.isFinite(date.getTime())?date.toISOString():null,evidence_type:'snippet'});
    }
    return {sources:diversified(items),queries:[query],suggestions:'',engine:'Tavily',retrieved_at:new Date().toISOString()};
}
export async function tavilyImages(query:string,signal:AbortSignal):Promise<ImageResult[]>{
    const data=await search(query,signal,true),images:ImageResult[]=[],seen=new Set<string>();
    for(const entry of (Array.isArray(data.images)?data.images:[]).slice(0,60)){
        const image=safeUrl(typeof entry==='string'?entry:isObject(entry)?entry.url:null);
        if(!image||seen.has(image))continue;seen.add(image);
        const url=isObject(entry)?safeUrl(entry.source_url)||image:image;
        images.push({url,image,thumbnail:image,title:isObject(entry)&&typeof entry.description==='string'?entry.description.replace(/<[^>]+>/g,'').slice(0,200):query,domain:new URL(url).hostname});
        if(images.length===40)break;
    }
    return images;
}
