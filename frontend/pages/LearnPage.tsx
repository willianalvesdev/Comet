import type { BootstrapData } from "../types";
import { ChatComposer, MobileMenu } from "../components/WorkspaceParts";

export default function LearnPage(_props: { bootstrap: BootstrapData }) {
    return (
        <div id="workspace-page">
            <main className="workspace__content" aria-label="Aprender">
                <header className="workspace__header">
                    <MobileMenu />
                    <span className="workspace__title">Aprender</span>
                </header>
                <section className="study-page" aria-labelledby="study-title">
                    <h1 id="study-title" className="study-title"><span className="study-logo" role="img" aria-label="Comet"></span><span>acadêmico</span></h1>
                    <ChatComposer composerClass="study-composer" placeholder="Explore artigos acadêmicos, pesquisas e muito mais" webSearch={false} />
                    <div className="study-categories" aria-label="Áreas de estudo">
                        <span><i className="chat-search__icon" aria-hidden="true"></i>Saúde</span>
                        <span><i className="chat-search__icon" aria-hidden="true"></i>Direito</span>
                        <span><i className="chat-search__icon" aria-hidden="true"></i>Tecnologia</span>
                        <span><i className="chat-search__icon" aria-hidden="true"></i>Ciência</span>
                        <span><i className="chat-search__icon" aria-hidden="true"></i>Humanidades</span>
                    </div>
                    <section className="study-topics" aria-labelledby="study-topics-title">
                        <div className="study-topics-heading"><h2 id="study-topics-title">Tópicos</h2></div>
                        <div className="study-carousel">
                            <div className="study-list-controls"><button type="button" data-topic-direction="-1" aria-label="Tópicos anteriores" aria-controls="study-topic-list"><i className="ui-arrow ui-arrow--left" aria-hidden="true"></i></button><button type="button" data-topic-direction="1" aria-label="Próximos tópicos" aria-controls="study-topic-list"><i className="ui-arrow ui-arrow--right" aria-hidden="true"></i></button></div>
                            <ul id="study-topic-list" className="study-topic-list" tabIndex={0} aria-label="Lista de tópicos">
                                <li>Tecnologia e ciência da computação</li>
                                <li>Ciência política e economia</li>
                                <li>Finanças</li>
                                <li>Saúde e medicina</li>
                                <li>Ciências naturais</li>
                                <li>História e filosofia</li>
                            </ul>
                        </div>
                    </section>
                </section>
            </main>
        </div>
    );
}
