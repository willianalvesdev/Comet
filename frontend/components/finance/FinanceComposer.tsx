import type { FormEventHandler, ReactNode, Ref } from 'react';
import { ChatToolbar } from '../WorkspaceParts';
export default function FinanceComposer({children,className='',label='Mensagem sobre o gráfico',placeholder='Pergunte qualquer coisa',hostRef,onSubmit}:{children?:ReactNode;className?:string;label?:string;placeholder?:string;hostRef?:Ref<HTMLDivElement>;onSubmit?:FormEventHandler<HTMLFormElement>}) {
    return <div className={`finance-composer ${className}`} aria-label={label} ref={hostRef}>
        {children}
        <form className="home__composer" aria-label="Escrever uma mensagem" onSubmit={onSubmit}>
            <p className="home__dictation-status" role="status" aria-live="polite" id="dictation-status"></p>
            <textarea className="home__input" aria-label="Mensagem" placeholder={placeholder} rows={1} maxLength={8000}></textarea>
            <ChatToolbar attachments={false}/>
        </form>
    </div>;
}
