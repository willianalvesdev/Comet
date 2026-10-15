import FinanceWorkspace from "../components/finance/FinanceWorkspace";
import type { BootstrapData } from "../types";
import { ChatToolbar, MobileMenu } from "../components/WorkspaceParts";

export default function FinancePage(_props: { bootstrap: BootstrapData }) {
    return (
        <div id="workspace-page">
            <main className="workspace__content" aria-label="Área de trabalho">
                <header className="workspace__header">
                    <MobileMenu />
                    <span className="workspace__title">Finanças</span>
                </header>
                <section className="finance-page" aria-label="Finanças">
                    <div className="finance-layout is-history-collapsed">
                        <FinanceWorkspace />
                        <button className="finance-panel-toggle" hidden type="button" aria-label="Recolher painel de recentes" aria-expanded="true" aria-controls="finance-history-panel"><i aria-hidden="true"></i></button>
                        <section className="transfer-history" id="finance-history-panel" hidden aria-labelledby="history-title">
                            <h2 className="finance-section-title" id="history-title">Recentes</h2>
                            <div className="transfer-card" id="finance-recent-transactions">
                                <ul className="transfer-list" aria-label="Transações"></ul>
                                <p className="finance-status" role="status">Carregando transações…</p>
                                <button className="transfer-more" type="button" hidden>Carregar mais <i className="ui-arrow" aria-hidden="true"></i></button>
                            </div>
                        </section>
                        <div className="finance-composer" aria-label="Mensagem sobre o gráfico">
                            <section className="finance-response" aria-label="Resposta do assistente" hidden>
                                <p className="finance-entry-status" tabIndex={0} role="status" aria-live="polite" aria-atomic="true"></p>
                            </section>
                            <form className="home__composer" aria-label="Escrever uma mensagem">
                                <p className="home__dictation-status" role="status" aria-live="polite" id="dictation-status"></p>
                                <textarea className="home__input" aria-label="Mensagem" placeholder="Pergunte qualquer coisa" rows={1} maxLength={8000}></textarea>
                                <ChatToolbar attachments={false} />
                            </form>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
