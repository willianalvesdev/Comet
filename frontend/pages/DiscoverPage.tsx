import type { BootstrapData } from "../types";
import { MobileMenu } from "../components/WorkspaceParts";

export default function DiscoverPage({ bootstrap }: { bootstrap: BootstrapData }) {
    if (!bootstrap.user) return null;
    return (
        <div id="workspace-page">
            <main className="workspace__content" aria-label="Área de trabalho">
                <header className="workspace__header">
                    <MobileMenu />
                    <span className="workspace__title">Descobrir</span>
                    <nav className="discovery-nav" aria-label="Navegar pelas notícias">
                        <button type="button" data-news-mode="for-you" aria-current="page">Para Você</button>
                        <button type="button" data-news-mode="top">Top</button>
                        <details className="discovery-topics"><summary><span id="topic-label">Tópicos</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></summary><div className="discovery-dropdown"><button type="button" data-discovery-topic="technology" aria-pressed="false"><i className="discovery-icon icon-technology" aria-hidden="true"></i><span>Tecnologia & Ciência</span><i className="topic-check" aria-hidden="true"></i></button><button type="button" data-discovery-topic="business" aria-pressed="false"><i className="discovery-icon icon-business" aria-hidden="true"></i><span>Negócios</span><i className="topic-check" aria-hidden="true"></i></button><button type="button" data-discovery-topic="culture" aria-pressed="false"><i className="discovery-icon icon-culture" aria-hidden="true"></i><span>Arte & Cultura</span><i className="topic-check" aria-hidden="true"></i></button><button type="button" data-discovery-topic="sports" aria-pressed="false"><i className="discovery-icon icon-sports" aria-hidden="true"></i><span>Esportes</span><i className="topic-check" aria-hidden="true"></i></button><button type="button" data-discovery-topic="entertainment" aria-pressed="false"><i className="discovery-icon icon-entertainment" aria-hidden="true"></i><span>Entretenimento</span><i className="topic-check" aria-hidden="true"></i></button></div></details></nav>
                </header>
                <section className="news-page" aria-label="Descobrir notícias" data-user-id={bootstrap.user.id}>
                    <div className="discovery-layout tw:mx-auto tw:grid tw:items-start tw:gap-ui-6">
                        <div className="discovery-stories tw:min-w-0">
                            <div className="news-status" hidden role="status" aria-live="polite"><span className="sidebar__discover-icon" aria-hidden="true"></span><p id="news-status-text">Buscando as últimas notícias…</p><button id="news-retry" type="button" hidden>Tentar novamente</button></div>
                            <div className="news-feed" id="news-feed" aria-busy="true"></div>
                            <div className="news-bottom"><p id="news-update" role="status"></p><button id="news-more" type="button" hidden>Carregar mais notícias</button></div>
                        </div>
                        <aside id="weather-widgets" className="discovery-widgets tw:grid tw:min-w-0 tw:gap-ui-7" aria-label="Interesses e clima">
                            <section className="discovery-panel weather-panel tw:bg-surface tw:rounded-16px tw:p-ui-5" aria-label="Previsão do tempo">
                                <p id="weather-status" role="status">Permita sua localização para ver o clima da região.</p>
                                <div id="weather-content" hidden></div>
                            </section>
                        </aside>
                    </div>
                    <noscript><p>Ative o JavaScript para carregar as notícias.</p></noscript>
                </section>
            </main>
        </div>
    );
}
