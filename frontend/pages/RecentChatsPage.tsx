import type { BootstrapData } from "../types";
import { MobileMenu } from "../components/WorkspaceParts";

export default function RecentChatsPage(_props: { bootstrap: BootstrapData }) {
    return (
        <div id="workspace-page">
            <main className="workspace__content">
                <header className="workspace__header recent-chats__header">
                    <MobileMenu />
                    <h1 id="recent-chats-title">Recentes</h1>
                    <div className="recent-chats__default-actions tw:flex tw:items-center tw:gap-ui-2">
                        <button className="recent-chats__search-toggle" type="button" aria-label="Pesquisar conversas" aria-expanded="false" aria-controls="recent-chats-search"><i className="chat-search__icon" aria-hidden="true"></i></button>
                        <label className="recent-chats__search" hidden><i className="chat-search__icon" aria-hidden="true"></i><input id="recent-chats-search" type="search" placeholder="Buscar conversas..." aria-label="Buscar conversas" maxLength={100} /></label>
                        <a className="recent-chats__new" href="/novo.html?new=1"><i className="recent-chats__icon recent-chats__icon--new" aria-hidden="true"></i>Novo</a>
                    </div>
                    <div className="recent-chats__selection-actions tw:flex tw:items-center tw:gap-ui-2" hidden>
                        <button className="recent-chats__delete" type="button"><i className="sessions-icon sessions-icon--delete" aria-hidden="true"></i>Excluir</button>
                        <button className="recent-chats__cancel" type="button">Cancelar</button>
                    </div>
                </header>
                <section className="recent-chats" aria-labelledby="recent-chats-title">
                    <div className="recent-chats__toolbar tw:mb-ui-3 tw:flex tw:items-center tw:gap-ui-2">
                        <div className="recent-chats__select-group">
                            <input className="recent-chats__checkbox" id="select-all-chats" type="checkbox" aria-label="Selecionar todas as conversas exibidas" disabled />
                            <button type="button" popoverTarget="chat-selection-menu" aria-label="Opções de seleção"><i className="recent-chats__chevron" aria-hidden="true"></i></button>
                        </div>
                        <button type="button" className="recent-chats__sort" aria-label="Ordenar conversas" aria-haspopup="menu" aria-expanded="false" popoverTarget="chat-sort-menu">Ordenar: <span data-sort-label="">mais recentes</span><i className="recent-chats__chevron" aria-hidden="true"></i></button>
                        <div id="chat-sort-menu" className="recent-chats__sort-menu" popover="auto" role="menu" aria-label="Ordenar conversas">
                            <button type="button" role="menuitemradio" aria-checked="true" data-sort="recent" data-label="mais recentes">Mais novos primeiro<i className="ui-icon-check" aria-hidden="true"></i></button>
                            <button type="button" role="menuitemradio" aria-checked="false" data-sort="oldest" data-label="mais antigas">Mais antigos primeiro<i className="ui-icon-check" aria-hidden="true"></i></button>
                            <button type="button" role="menuitemradio" aria-checked="false" data-sort="title" data-label="nome">Nome<i className="ui-icon-check" aria-hidden="true"></i></button>
                        </div>
                    </div>
                    <div id="chat-selection-menu" className="recent-chats__select-menu" popover="auto">
                        <button type="button" data-select="all">Todas</button>
                        <button type="button" data-select="none">Nenhuma</button>
                    </div>
                    <p className="recent-chats__status" role="status">Carregando conversas…</p>
                    <button className="recent-chats__retry" type="button" hidden>Tentar novamente</button>
                    <div className="recent-chats__list" aria-label="Conversas" aria-busy="true"></div>
                </section>
            </main>
            <dialog className="sessions-dialog recent-chats__confirm" aria-labelledby="delete-chats-title">
                <form>
                    <h2 id="delete-chats-title">Excluir conversas?</h2>
                    <p className="recent-chats__delete-description"></p>
                    <p className="sessions-dialog__error" role="alert"></p>
                    <div><button type="button" data-cancel="">Cancelar</button><button type="submit" className="sessions-menu__delete">Excluir</button></div>
                </form>
            </dialog>
        </div>
    );
}
