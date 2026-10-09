import { isRecord } from './dom';
export function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new Error('Resposta inválida do servidor.');
    return value;
}
export function stringValue(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Texto inválido na resposta.');
    return value;
}
export function numberValue(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Número inválido na resposta.');
    return value;
}
export function booleanValue(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Estado inválido na resposta.');
    return value;
}
export function arrayValue<T>(value: unknown, parse: (item:unknown)=>T): T[] {
    if (!Array.isArray(value)) throw new Error('Lista inválida na resposta.');
    return value.map(parse);
}
export function optionalString(value:unknown): string | undefined { return value == null ? undefined : stringValue(value); }
export function apiError(value:unknown, fallback:string): string { return isRecord(value) && typeof value.error === 'string' ? value.error : fallback; }
export function attachmentData(value: unknown): Attachment {
    const data=record(value);
    if(data.kind!=='image' && data.kind!=='file')throw new Error('Anexo inválido.');
    return {id:stringValue(data.id),name:stringValue(data.name),size:numberValue(data.size),kind:data.kind};
}
export function conversationData(value: unknown): Conversation {
    const data=record(value);
    return {last_response_at:optionalString(data.last_response_at),id:stringValue(data.id),title:stringValue(data.title),created_at:stringValue(data.created_at ?? ''),updated_at:stringValue(data.updated_at ?? '')};
}
export function conversationsData(value: unknown): ConversationList {
    const data=record(value);
    return {conversations:arrayValue(data.conversations,conversationData),next_offset:data.next_offset==null?null:numberValue(data.next_offset)};
}
export function researchData(value: unknown): Research {
    const data=record(value);
    return {error:optionalString(data.error),queries:data.queries==null?undefined:arrayValue(data.queries,stringValue),query:optionalString(data.query),state:researchState(data.state),engine:optionalString(data.engine),suggestions:optionalString(data.suggestions),seconds:data.seconds==null?undefined:numberValue(data.seconds),
        sources:data.sources==null?[]:arrayValue(data.sources,value=>{const source=record(value);return {title:stringValue(source.title),url:stringValue(source.url),domain:stringValue(source.domain ?? ''),excerpt:optionalString(source.excerpt),published_at:optionalString(source.published_at),date_approximate:source.date_approximate==null?undefined:booleanValue(source.date_approximate),snippet:optionalString(source.snippet),image:optionalString(source.image)};})};
}
export function metadataData(value:unknown, includeVersions = true):ResponseMetadata {
    const data=record(value ?? {});
    return {answered_at:optionalString(data.answered_at),versions:includeVersions && data.versions!=null?arrayValue(data.versions,value=>{const version=record(value);return {answer:stringValue(version.answer),thinking:stringValue(version.thinking),metadata:metadataData(version.metadata,false)};}):undefined,provider:optionalString(data.provider),research:data.research==null?undefined:researchData(data.research),thinking_seconds:data.thinking_seconds==null?data.thinking_seconds:numberValue(data.thinking_seconds),elapsed_seconds:data.elapsed_seconds==null?undefined:numberValue(data.elapsed_seconds),instant:data.instant==null?undefined:booleanValue(data.instant)};
}
export function turnData(value:unknown):Turn {
    const data=record(value);
    const status=data.status;
    if(status!=='running' && status!=='completed' && status!=='interrupted' && status!=='failed')throw new Error('Estado da mensagem inválido.');
    return {id:stringValue(data.id),message:stringValue(data.message),answer:stringValue(data.answer),thinking:stringValue(data.thinking ?? ''),created_at:stringValue(data.created_at),status,metadata:metadataData(data.metadata),attachments:data.attachments==null?[]:arrayValue(data.attachments,attachmentData)};
}
export function historyData(value:unknown):ConversationHistory {
    const data=record(value);
    return {conversation:conversationData(data.conversation),turns:arrayValue(data.turns,turnData),before:data.before==null?null:stringValue(data.before),active:booleanValue(data.active),has_more:data.has_more==null?undefined:booleanValue(data.has_more)};
}
export function chatEventData(value:unknown):ChatEvent {
    const data=record(value);
    switch(data.type){
        case 'delta':case 'thinking':return {type:data.type,text:stringValue(data.text)};
        case 'error':return {type:'error',error:stringValue(data.error)};
        case 'done':return {type:'done',metadata:metadataData(data.metadata)};
        case 'search':return {type:'search',...researchData(data)};
        case 'conversation':return {type:'conversation',conversation_id:data.conversation_id===null?null:stringValue(data.conversation_id),turn_id:stringValue(data.turn_id),title:optionalString(data.title),created_at:optionalString(data.created_at),provider:optionalString(data.provider),attachments:data.attachments==null?[]:arrayValue(data.attachments,attachmentData)};
        default:throw new Error('Evento inválido na resposta.');
    }
}
export function chartPointData(value:unknown):ChartPoint {
    const data=record(value);
    return {time:chartTimestamp(numberValue(data.time)),open:numberValue(data.open),high:numberValue(data.high),low:numberValue(data.low),close:numberValue(data.close),volume:numberValue(data.volume),occurred_on:optionalString(data.occurred_on),occurred_time:data.occurred_time == null ? null : stringValue(data.occurred_time)};
}
export function financeCardData(value:unknown):FinanceCard {
    const data=record(value);
    return {amount:stringValue(data.amount),difference:stringValue(data.difference),percentage:data.percentage===null?null:typeof data.percentage==='number'?String(numberValue(data.percentage)):stringValue(data.percentage),series:arrayValue(data.series,numberValue)};
}
export function financeDashboardData(value:unknown):FinanceDashboard {
    const data=record(value),summary=record(data.summary),chart=record(data.chart);
    return {as_of:stringValue(data.as_of ?? ''),summary:{balance:financeCardData(summary.balance),income:financeCardData(summary.income),expense:financeCardData(summary.expense)},chart:{currency:optionalString(chart.currency),kind:optionalString(chart.kind),points:arrayValue(chart.points,chartPointData),intraday:arrayValue(chart.intraday ?? [],chartPointData),movements:arrayValue(chart.movements ?? [],chartPointData)}};
}
export function financeHistoryData(value:unknown):FinanceHistory {
    const data=record(value);
    return {next_cursor:data.next_cursor==null?null:stringValue(data.next_cursor),transactions:arrayValue(data.transactions,value=>{const item=record(value);if(item.kind!=='income'&&item.kind!=='expense')throw new Error('Transação inválida.');return {id:stringValue(item.id),kind:item.kind,amount:stringValue(item.amount),description:stringValue(item.description),category:stringValue(item.category),occurred_on:stringValue(item.occurred_on),occurred_time:item.occurred_time == null ? null : stringValue(item.occurred_time),currency:stringValue(item.currency ?? 'BRL'),deleted_at:item.deleted_at == null ? null : stringValue(item.deleted_at)};})};
}

export function chartTimestamp(value:number):import('lightweight-charts').UTCTimestamp {
 if(!Number.isInteger(value)||value<0)throw new Error('Invalid timestamp');
 return value as import('lightweight-charts').UTCTimestamp;
}
export interface NewsArticle {id:string;url:string;title:string;image:string;published_at:string;description:string;source:string;sources:{name:string;url:string}[]}
export function newsData(value:unknown) {
 const data=record(value);
 return {page:numberValue(data.page),has_more:booleanValue(data.has_more),stale:booleanValue(data.stale ?? false),articles:arrayValue(data.articles,item=>{
  const article=record(item);
  return {id:stringValue(article.id),url:stringValue(article.url),title:stringValue(article.title),image:stringValue(article.image ?? ''),published_at:stringValue(article.published_at ?? ''),description:stringValue(article.description ?? ''),source:stringValue(article.source),sources:arrayValue(article.sources,item=>{const source=record(item);return {name:stringValue(source.name),url:stringValue(source.url)};})};
 })};
}
export interface WeatherCity {name:string;latitude:number;longitude:number}
export function weatherCity(value:unknown):WeatherCity {const city=record(value);return {name:stringValue(city.name),latitude:numberValue(city.latitude),longitude:numberValue(city.longitude)};}
export function weatherData(value:unknown) {
 const data=record(value),current=record(data.current),daily=record(data.daily);
 return {current:{temperature_2m:numberValue(current.temperature_2m),weather_code:numberValue(current.weather_code),is_day:current.is_day === 0 ? 0 : 1},daily:{time:arrayValue(daily.time,stringValue),weather_code:arrayValue(daily.weather_code,numberValue),temperature_2m_max:arrayValue(daily.temperature_2m_max,numberValue),temperature_2m_min:arrayValue(daily.temperature_2m_min,numberValue)}};
}

export function isLocalModel(value:unknown):value is LocalModel {
 return typeof value==='string' && value!=='gemini' && value!=='qwen' && value.length<=200 && !value.includes('://') && !value.toLowerCase().includes('cloud') && /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value);
}
export function researchState(value:unknown):ResearchState|undefined {
 if(value==null)return undefined;
 if(value==='searching'||value==='reading'||value==='complete'||value==='empty'||value==='failed')return value;
 throw new Error('Invalid research state');
}
