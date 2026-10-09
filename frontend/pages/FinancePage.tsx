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
                        <section className="finance-totals" aria-labelledby="finance-totals-title">
                            <h2 className="finance-section-title finance-totals__title" id="finance-totals-title">Resumo atual</h2>
                            <article className="finance-total finance-total--balance" data-finance-total="balance">
                                <div className="finance-total__header"><h2>Balanço total</h2><div className="finance-total__values"><p>—</p><span className="finance-total__change"></span></div><span className="finance-total__comparison">Carregando…</span></div>
                                <svg className="finance-total__sparkline" viewBox="0 0 260 76" preserveAspectRatio="none" role="img" aria-label="Evolução no mês atual"><defs><linearGradient id="total-balance" x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2"></stop><stop offset="1" stopColor="currentColor" stopOpacity="0"></stop></linearGradient></defs><path className="finance-total__area" fill="url(#total-balance)"></path><path className="finance-total__baseline" d="M0 38 H260"></path><path className="finance-total__line" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"></path></svg>
                            </article>
                            <article className="finance-total finance-total--income" data-finance-total="income">
                                <div className="finance-total__header"><h2>Receitas do mês</h2><div className="finance-total__values"><p>—</p><span className="finance-total__change"></span></div><span className="finance-total__comparison">Carregando…</span></div>
                                <svg className="finance-total__sparkline" viewBox="0 0 260 76" preserveAspectRatio="none" role="img" aria-label="Evolução no mês atual"><defs><linearGradient id="total-income" x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2"></stop><stop offset="1" stopColor="currentColor" stopOpacity="0"></stop></linearGradient></defs><path className="finance-total__area" fill="url(#total-income)"></path><path className="finance-total__baseline" d="M0 38 H260"></path><path className="finance-total__line" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"></path></svg>
                            </article>
                            <article className="finance-total finance-total--expense" data-finance-total="expense">
                                <div className="finance-total__header"><h2>Gastos do mês</h2><div className="finance-total__values"><p>—</p><span className="finance-total__change"></span></div><span className="finance-total__comparison">Carregando…</span></div>
                                <svg className="finance-total__sparkline" viewBox="0 0 260 76" preserveAspectRatio="none" role="img" aria-label="Evolução no mês atual"><defs><linearGradient id="total-expense" x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2"></stop><stop offset="1" stopColor="currentColor" stopOpacity="0"></stop></linearGradient></defs><path className="finance-total__area" fill="url(#total-expense)"></path><path className="finance-total__baseline" d="M0 38 H260"></path><path className="finance-total__line" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"></path></svg>
                            </article>
                        </section>
                        <div className="finance-chart-column">
                            <div className="finance-view-tabs" role="group" aria-label="Visualização das finanças">
                                <button type="button" data-finance-view="chart" aria-pressed="true" aria-controls="finance-data-view">Gráfico</button>
                                <button type="button" data-finance-view="sheet" aria-pressed="false" aria-controls="finance-data-view">Planilha</button>
                            </div>
                            <section className="market-card" id="finance-data-view" aria-label="Evolução dos valores">
                                <div className="market-summary">
                                    <div className="market-summary__values">
                                        <span className="market-price" id="market-price">—</span>
                                        <span className="market-change" id="market-change" data-trend="up"></span>
                                    </div>
                                    <p className="market-period" id="market-period"></p>
                                </div>
                                <div className="chart-plot">
                                    <div className="chart-toolbar">
                                        <div className="chart-ranges" role="group" aria-label="Período do gráfico">
                                            <button className="chart-range" type="button" data-range="1D" aria-pressed="false" aria-label="Um dia">1D</button>
                                            <button className="chart-range" type="button" data-range="5D" aria-pressed="false" aria-label="Cinco dias">5D</button>
                                            <button className="chart-range" type="button" data-range="1M" aria-pressed="false" aria-label="Um mês">1M</button>
                                            <button className="chart-range" type="button" data-range="6M" aria-pressed="true" aria-label="Seis meses">6M</button>
                                            <button className="chart-range" type="button" data-range="YTD" aria-pressed="false" aria-label="Desde o início do ano">YTD</button>
                                            <button className="chart-range" type="button" data-range="1Y" aria-pressed="false" aria-label="Um ano">1A</button>
                                            <button className="chart-range" type="button" data-range="5Y" aria-pressed="false" aria-label="Cinco anos">5A</button>
                                            <button className="chart-range" type="button" data-range="MAX" aria-pressed="false" aria-label="Todo o período">MÁX</button>
                                        </div>
                                        <div className="chart-styles" role="group" aria-label="Tipo de gráfico">
                                            <button className="chart-style" type="button" data-chart-style="line" aria-label="Gráfico de linha" title="Gráfico de linha" aria-pressed="true">
                                                <span className="chart-style__icon chart-style__icon--line" aria-hidden="true"></span>
                                            </button>
                                            <button className="chart-style" type="button" data-chart-style="candles" aria-label="Gráfico de velas" title="Gráfico de velas" aria-pressed="false">
                                                <span className="chart-style__icon chart-style__icon--candles" aria-hidden="true"></span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="finance-sheet" hidden tabIndex={0} role="region" aria-label="Resumos financeiros por data">
                                        <table>
                                            <caption>Valores por data no período selecionado</caption>
                                            <thead><tr><th scope="col">Data</th><th scope="col">Saldo inicial</th><th scope="col">Maior saldo</th><th scope="col">Menor saldo</th><th scope="col">Saldo final</th><th scope="col">Variação</th><th scope="col">Movimentação</th></tr></thead>
                                            <tbody></tbody>
                                        </table>
                                        <p className="finance-sheet-empty" role="status" hidden>Nenhum dado financeiro neste período.</p>
                                    </div>
                                    <div className="chart-stage">
                                        <div className="market-chart" id="market-chart" role="group" tabIndex={0} aria-label="Gráfico interativo de valores e volume" aria-describedby="chart-description"></div>
                                        <p className="chart-empty" id="chart-state" role="status">Carregando gráfico…</p>
                                    </div>
                                    <div className="chart-tooltip" id="chart-tooltip" hidden aria-hidden="true">
                                        <time></time>
                                        <dl className="chart-tooltip-values">
                                            <dt>Fechar</dt><dd data-tooltip-value="close"></dd>
                                            <dt>Abrir</dt><dd data-tooltip-value="open"></dd>
                                            <dt>Máxima</dt><dd data-tooltip-value="high"></dd>
                                            <dt>Mínima</dt><dd data-tooltip-value="low"></dd>
                                            <dt>Volume</dt><dd data-tooltip-value="volume"></dd>
                                        </dl>
                                    </div>
                                </div>
                                <nav className="finance-sheet-pagination" aria-label="Páginas da planilha">
                                    <div><button type="button" data-sheet-page="first" aria-label="Primeira página"><i className="sheet-first" aria-hidden="true"></i></button><button type="button" data-sheet-page="previous"><i className="sheet-previous" aria-hidden="true"></i>Anterior</button></div>
                                    <span className="finance-sheet-page-label" role="status">Página 1 de 1</span>
                                    <button type="button" data-sheet-page="next">Próximo<i className="sheet-next" aria-hidden="true"></i></button>
                                </nav>
                                <dl className="chart-statistics" aria-label="Resumo do período selecionado">
                                    <div><dt>Saldo inicial</dt><dd data-chart-stat="opening">R$ 0,00</dd></div>
                                    <div><dt>Saldo final</dt><dd data-chart-stat="closing">R$ 0,00</dd></div>
                                    <div><dt>Variação</dt><dd data-chart-stat="change">R$ 0,00</dd></div>
                                    <div><dt>Maior saldo</dt><dd data-chart-stat="high">R$ 0,00</dd></div>
                                    <div><dt>Menor saldo</dt><dd data-chart-stat="low">R$ 0,00</dd></div>
                                    <div><dt>Movimentação</dt><dd data-chart-stat="volume">R$ 0,00</dd></div>
                                </dl>
                                <p className="chart-description" id="chart-description" aria-live="polite"></p>
                                <noscript><p className="chart-footer">Ative o JavaScript para visualizar o gráfico.</p></noscript>
                            </section>
                        </div>
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
                                <textarea className="home__input" aria-label="Mensagem" placeholder="Pergunte qualquer coisa" rows={2} maxLength={8000}></textarea>
                                <ChatToolbar attachments={false} />
                            </form>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
