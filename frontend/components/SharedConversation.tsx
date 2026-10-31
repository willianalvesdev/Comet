'use client';

import { useEffect, useRef, useState } from 'react';
import { historyData } from '../controllers/api-data';
import { renderAnswer } from '../controllers/answer-content';
import LoadingIndicator from './LoadingIndicator';

function Answer({turn}:{turn:Turn}) {
    const ref=useRef<HTMLDivElement>(null);
    useEffect(()=>{if(ref.current)renderAnswer(ref.current,turn.answer,turn.metadata?.research?.sources);},[turn]);
    return <div className="computer-message__text" ref={ref} />;
}
export default function SharedConversation({id}:{id:string}) {
    const [history,setHistory]=useState<ConversationHistory|null>(null),[failure,setFailure]=useState(''),[status,setStatus]=useState(0),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
    const request=useRef<AbortController|null>(null);
    const base='/api/shared/conversations/'+encodeURIComponent(id);
    const login='/?login=1';
    function rememberReturn(){try{sessionStorage.setItem('comet-login-return','/chat/'+id);}catch{}}
    useEffect(()=>{
        const controller=new AbortController();request.current=controller;setHistory(null);setFailure('');setStatus(0);setLoading(true);
        const classes=document.body.className;document.body.className='shared-conversation-page';
        void (async()=>{
            try{
                const response=await fetch(base,{cache:'no-store',signal:controller.signal});
                if(!response.ok){setStatus(response.status);throw new Error(response.status===403?'Esta resposta é privada.':response.status===404?'Esta sessão não foi encontrada.':'Não foi possível carregar esta sessão. Tente novamente.');}
                const result=historyData(await response.json());controller.signal.throwIfAborted();setHistory(result);document.title=result.conversation.title+' — Comet';
            }catch(error){if(!controller.signal.aborted)setFailure(error instanceof Error?error.message:'Não foi possível carregar esta sessão.');}
            finally{if(!controller.signal.aborted)setLoading(false);}
        })();
        return()=>{controller.abort();document.body.className=classes;};
    },[base,retry]);
    async function older(){
        if(!history?.before||loading)return;setLoading(true);
        const controller=request.current!;
        try{
            const response=await fetch(base+'?before='+encodeURIComponent(history.before),{cache:'no-store',signal:controller.signal});
            if(!response.ok){setStatus(response.status);setHistory(null);throw new Error(response.status===403?'Esta resposta é privada.':'Não foi possível carregar esta sessão.');}
            const value=historyData(await response.json());controller.signal.throwIfAborted();
            setHistory(current=>current?{...value,turns:[...value.turns,...current.turns]}:value);
        }catch(error){if(!controller.signal.aborted)setFailure(error instanceof Error?error.message:'Não foi possível carregar esta sessão.');}
        finally{if(!controller.signal.aborted)setLoading(false);}
    }
    return <main className="shared-conversation">
        <header><a href="/" aria-label="Comet — início">Comet</a><a href={login} onClick={rememberReturn}>Entrar</a></header>
        {failure?<section className="shared-conversation__blocked" role="alert"><h1>{status===403?'Esta resposta é privada':status===404?'Sessão não encontrada':'Não foi possível abrir esta sessão'}</h1><p>{status===403?'Entre na sua conta para solicitar acesso ao proprietário.':failure}</p>{status===403?<a href={login} onClick={rememberReturn}>Entrar para solicitar acesso</a>:<button type="button" onClick={()=>setRetry(n=>n+1)}>Tentar novamente</button>}<a href="/">Voltar para o Comet</a></section>:history?<>
            <div className="shared-conversation__messages"><h1>{history.conversation.title}</h1>{history.before&&<button type="button" disabled={loading} onClick={()=>void older()}>Carregar mensagens anteriores</button>}
                {history.turns.map(turn=><section className="shared-conversation__turn" key={turn.id}>
                    <article className="computer-message computer-message--user"><div className="shared-conversation__attachments">{turn.attachments?.map(file=><span key={file.id}>{file.kind==='image'&&<img alt="" loading="lazy" src={base+'/attachments/'+encodeURIComponent(file.id)+'/preview'} />}{file.name}</span>)}</div><p>{turn.message}</p></article>
                    <article className="computer-message computer-message--assistant">{turn.thinking&&<details className="computer-thinking"><summary>Pensamento concluído</summary><p>{turn.thinking}</p></details>}<Answer turn={turn} />
                        {!!turn.metadata?.artifacts?.length&&<div className="shared-conversation__files">{turn.metadata.artifacts.flatMap(artifact=>artifact.files.map(file=><a key={artifact.id+file.format} href={base+'/artifacts/'+encodeURIComponent(artifact.id)+'?format='+encodeURIComponent(file.format)} download={file.name}>{file.name}</a>))}</div>}
                    </article>
                </section>)}
                <p className="shared-conversation__notice">O Comet pode cometer erros. Confira informações importantes.</p>
            </div>
            <footer><p>Você está vendo uma sessão compartilhada. Suas perguntas de seguimento serão privadas.</p><a href={login} onClick={rememberReturn}>Entre para continuar esta conversa</a></footer>
        </>:<div className="shared-conversation__loading" role="status"><LoadingIndicator label="Carregando sessão compartilhada" /></div>}
    </main>;
}
