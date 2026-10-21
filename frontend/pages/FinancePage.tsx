import FinanceComposer from '../components/finance/FinanceComposer';
import FinanceTabs from '../components/finance/FinanceTabs';
import LoadingIndicator from '../components/LoadingIndicator';
import FinanceWorkspace from "../components/finance/FinanceWorkspace";
import type { BootstrapData } from "../types";
import { MobileMenu } from "../components/WorkspaceParts";

export default function FinancePage(_props: { bootstrap: BootstrapData }) {
    return (
        <div id="workspace-page">
            <main className="workspace__content" aria-label="Área de trabalho">
                <header className="workspace__header">
                    <MobileMenu />
                    <span className="workspace__title">Finanças</span>
                </header>
                <FinanceTabs active="personal" />
                <section className="finance-page" aria-label="Finanças">
                    <div className="finance-layout">
                        <FinanceWorkspace />
                        <section className="transfer-history" id="finance-history-panel" aria-labelledby="history-title">
                            <h2 className="finance-section-title" id="history-title">Recentes</h2>
                            <div className="transfer-card" id="finance-recent-transactions">
                                <ul className="transfer-list" aria-label="Transações"></ul>
                                <p className="finance-status" role="status"><LoadingIndicator label="Carregando transações"/></p>
                                <button className="transfer-more" type="button" hidden>Carregar mais <i className="ui-arrow" aria-hidden="true"></i></button>
                            </div>
                        </section>
                        <FinanceComposer>
                            <section className="finance-response" aria-label="Resposta do assistente" hidden>
                                <p className="finance-entry-status" tabIndex={0} role="status" aria-live="polite" aria-atomic="true"></p>
                            </section>
                        </FinanceComposer>
                    </div>
                </section>
            </main>
        </div>
    );
}

import controller0 from '../controllers/computer-service';
import controller1 from '../controllers/model-menu';
import controller2 from '../controllers/finance-data';
import controller3 from '../controllers/graph-composer';
import controller4 from '../controllers/dictation';
import controller5 from '../controllers/discovery-panel';
export const controllers: PageFactory[] = [controller0, controller1, controller2, controller3, controller4, controller5];
