type LocalModel = 'qwen3:1.7b'|'qwen3:4b'|'qwen3:8b'|'qwen3:4b-instruct-2507-q4_K_M';
type ModelProvider = 'gemini'|LocalModel;
type ResearchState = 'searching'|'reading'|'complete'|'empty'|'failed';
interface AppEvents extends WindowEventMap { change: Event; visibilitychange: Event; }
interface PageScope {
    readonly active: boolean;
    cleanup(callback: () => void): void;
    append(...elements: (HTMLElement | SVGElement)[]): void;
    listen<K extends keyof AppEvents>(target: EventTarget | null, type: K, callback: (event: AppEvents[K]) => void, options?: boolean | AddEventListenerOptions): void;
}
interface PageContext {
    scope: PageScope;
    setTimeout: <A extends unknown[]>(callback:(...args:A)=>void, delay?:number, ...args:A)=>number;
    setInterval: <A extends unknown[]>(callback:(...args:A)=>void, delay?:number, ...args:A)=>number;
    requestAnimationFrame: typeof window.requestAnimationFrame;
    fetch: typeof window.fetch;
    ResizeObserver: typeof ResizeObserver;
    MutationObserver: typeof MutationObserver;
}
type PageFactory = (context: PageContext) => void;
interface Attachment { id: string; name: string; size: number; kind: 'image' | 'file'; }
interface Conversation { id: string; title: string; created_at: string; updated_at: string; }
interface ResearchSource { title: string; url: string; domain: string; snippet?: string; image?: string; excerpt?: string; published_at?: string; date_approximate?: boolean; }
interface Research { error?: string; query?: string; sources?: ResearchSource[]; suggestions?: string; status?: string; state?: ResearchState; seconds?: number; queries?: string[]; engine?: string; }
interface ResponseMetadata { research?: Research; thinking_seconds?: number | null; elapsed_seconds?: number; instant?: boolean; }
interface Turn { id: string | null; message: string; answer: string; thinking: string; status: 'running' | 'completed' | 'interrupted' | 'failed'; created_at: string; metadata?: ResponseMetadata; attachments?: Attachment[]; }
interface ConversationList { conversations: Conversation[]; next_offset: number | null; }
interface ConversationHistory { conversation: Conversation; turns: Turn[]; before: string | null; active: boolean; has_more?: boolean; }
interface ChatRequest { history?: {role:'user'|'assistant';content:string}[]; messages?: {role:'user'|'assistant';content:string}[]; message?: string; conversation_id: string | null; request_id: string; provider: ModelProvider; anonymous?: boolean; attachments?: string[]; regenerate?: string; }
interface ConversationEvent { type: 'conversation'; conversation_id: string | null; turn_id: string; title?: string; created_at?: string; attachments?: Attachment[]; provider?: string; }
interface SearchEvent extends Research { type: 'search'; }
type ChatEvent = {type:'delta'|'thinking';text:string} | {type:'error';error:string} | {type:'done';metadata?:ResponseMetadata} | ConversationEvent | SearchEvent;
interface ComputerServiceApi {
    get(path: string): Promise<unknown>;
    list(offset?: number | null): Promise<ConversationList>;
    load(id: string, before?: string | null): Promise<ConversationHistory>;
    chat(payload: ChatRequest, onDelta: (text:string)=>void, signal: AbortSignal, onThinking?: (text:string)=>void, onConversation?: (event:ConversationEvent)=>void, onResearch?: (event:SearchEvent)=>void, onDone?: (metadata:ResponseMetadata)=>void): Promise<void>;
}
interface Window {
    WorkspaceNavigation: {page(url:string,factory:PageFactory):void;go(destination:string|URL,replace?:boolean):Promise<void>};
    AscendaStorage: {getItem(name:string):string|null;setItem(name:string,value:string):void};
    ComputerService: new () => ComputerServiceApi;
    ComputerModels: {selected():ModelProvider;select(value:string):void;error():string;setBusy(value:boolean):void};
    ComputerAttachments: {files():Attachment[];busy():boolean;clear():void;restore(items:Attachment[]):void;setBusy(value:boolean):void};
    ComputerAttachmentCard: (file:Attachment,onRemove?:()=>void)=>HTMLDivElement;
    ComputerSessions: {render(items:Conversation[],append?:boolean,hasMore?:boolean):void;select(id:string|null,title?:string):void;setBusy(value:boolean):void;openOptions(item:Conversation,button:HTMLElement):void;request(path:string,method?:string,body?:unknown):Promise<unknown>;isPinned(id:string):boolean};
    ComputerResponseDetails: {research(article:HTMLElement,value?:Research,complete?:boolean):void;reset():void};
    AscendaChart: {setData(data:ChartData,animate?:boolean):void;rollNumber(element:HTMLElement,text:string):void};
    LightweightCharts: typeof import('lightweight-charts');
    AscendaNewsPreferences?: {topics:string[];languages:string};
}
interface WindowEventMap {
    'attachments:changed': Event;
    'finance:changed': Event;
    'workspace:before-mount': Event;
    'workspace:navigated': Event;
    'news-preferences-change': Event;
    'chat:anonymous': CustomEvent<boolean>;
    'sessions:open': CustomEvent<{id:string}>;
    'sessions:changed': CustomEvent<{id:string;deleted?:boolean;title?:string}>;
    'sessions:new': Event; 'sessions:refresh': Event;
    'sessions:more': Event;
    'sessions:pins': Event;
}

interface SpeechRecognitionSession {
 lang:string;
 continuous:boolean;
 interimResults:boolean;
 onstart:(()=>void)|null;
 onend:(()=>void)|null;
 onresult:((event:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
 onerror:((event:{error:string})=>void)|null;
 start():void;
 stop():void;
 abort():void;
}
interface Window {
 SpeechRecognition?:new()=>SpeechRecognitionSession;
 webkitSpeechRecognition?:new()=>SpeechRecognitionSession;
}
