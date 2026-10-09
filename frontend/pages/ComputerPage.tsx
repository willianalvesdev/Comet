import type { BootstrapData } from "../types";
import { ChatComposer, MobileMenu } from "../components/WorkspaceParts";
import "./computer-logo.css";

export default function ComputerPage({ bootstrap }: { bootstrap: BootstrapData }) {
    if (!bootstrap.user) return null;
    return (
        <div id="workspace-page">
            <div className="anonymous-bar">
                <span><i aria-hidden="true"></i>Chat anônimo</span>
                <button className="workspace__header-button anonymous-close" type="button" aria-label="Fechar chat anônimo">
                    <i className="ui-icon-x" aria-hidden="true"></i>
                </button>
            </div>
            <main className="workspace__content" aria-label="Área de trabalho">
                <header className="workspace__header computer-header">
                    <MobileMenu />
                    <nav className="chat-tabs" aria-label="Visualização da resposta" hidden><button type="button" data-chat-view="answer" aria-current="page"><i className="chat-tab-logo" aria-hidden="true"></i>Resposta</button><button type="button" data-chat-view="links" hidden><i className="chat-tab-links" aria-hidden="true"></i>Links</button></nav>
                    <button className="workspace__header-button anonymous-toggle" type="button" aria-label="Ativar modo anônimo" aria-pressed="false"><i aria-hidden="true"></i></button>
                </header>
                <section className="computer-page" aria-labelledby="computer-title">
                    <div className="computer-intro">
                        <h1 id="computer-title"><svg className="computer-intro__animated-logo" aria-hidden="true" width="44" height="36" viewBox="0 0 44 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M35.9999 6.00192C35.9999 4.89618 35.1026 4.00128 33.9992 4.00128H9.9986C8.8952 4.00128 7.99796 4.89618 7.99796 6.00192V22.0047C7.99796 23.1104 8.8952 24.0053 9.9986 24.0053H33.9992C35.1026 24.0053 35.9999 23.1104 35.9999 22.0047V6.00192ZM39.9988 22.0047C39.9988 25.3196 37.3118 28.0066 33.9992 28.0066H9.9986C6.68606 28.0066 3.99902 25.3196 3.99902 22.0047V6.00192C3.99902 2.68704 6.68606 0 9.9986 0H33.9992C37.3118 0 39.9988 2.68704 39.9988 6.00192V22.0047Z" fill="currentColor"></path>
                                <path d="M41.9994 32.0079C43.1028 32.0079 44 32.9052 44 34.0086C44 35.1143 43.1028 36.0092 41.9994 36.0092H1.9983C0.894899 36.0092 0 35.1143 0 34.0086C0 32.9028 0.894899 32.0079 1.9983 32.0079H41.9994Z" fill="currentColor"></path>
                                <g className="computer-eyes">
                                    <path d="M15.9307 10.2129V13.7946C15.9307 14.8996 16.8264 15.7953 17.9313 15.7953C19.0363 15.7953 19.9319 14.8996 19.9319 13.7946V10.2129C19.9319 9.10797 19.0363 8.21228 17.9313 8.21228C16.8264 8.21228 15.9307 9.10797 15.9307 10.2129Z" fill="currentColor"></path>
                                    <path d="M23.9307 10.2129V13.7946C23.9307 14.8996 24.8264 15.7953 25.9313 15.7953C27.0363 15.7953 27.9319 14.8996 27.9319 13.7946V10.2129C27.9319 9.10797 27.0363 8.21228 25.9313 8.21228C24.8264 8.21228 23.9307 9.10797 23.9307 10.2129Z" fill="currentColor"></path>
                                </g>
                            </svg>
                            <span data-chat-greeting="" data-account-name={bootstrap.user.nome} data-account-id={bootstrap.user.id}>Olá</span></h1>
                    </div>
                    <button className="computer-history__older" type="button" hidden>Carregar mensagens anteriores</button>
                    <section className="computer-messages" aria-label="Conversa com Computer" aria-live="polite" aria-relevant="additions text" hidden></section>
                    <div className="computer-composer">
                        <ChatComposer readonly />
                        <p className="anonymous-note" hidden>Esse chat não será salvo no histórico</p>
                        <p className="computer-note" role="status"></p>
                    </div>
                </section>
                <section className="chat-links" aria-label="Links pesquisados" hidden></section>
            </main>
        </div>
    );
}
