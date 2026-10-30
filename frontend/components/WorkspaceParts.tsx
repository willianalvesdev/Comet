import { userInitials } from '../../shared/user-initials';
import type { CSSProperties } from 'react';
import type { BootstrapData } from '../types';
import { ProviderToggle } from './ProviderToggle';
import KeyboardShortcuts from './KeyboardShortcuts';

export function Sidebar({ data }: { data: BootstrapData }) {
    const user = data.user;
    if (!user) return null;
    return (
<><aside className="sidebar tw:flex tw:flex-col tw:bg-surface" id="sidebar" aria-label="Menu lateral">
        <div className="sidebar__top">
            <a className="sidebar__logo tw:grid tw:place-items-center tw:rounded-8px" href="/principal.html" aria-label="Comet — tela principal"><span className="sidebar__wordmark">Comet</span></a>
            <div className="sidebar__top-actions">
            </div>
            <button className="sidebar__toggle" type="button" aria-label="Recolher menu" aria-expanded="true" aria-controls="sidebar-nav" title="Recolher menu">
                <span className="sidebar__toggle-icon" aria-hidden="true"></span>
            </button>
        </div>

        <div className="sidebar__new-chat">
            <a className="sidebar__link" href="/new?new=1" aria-current={data.activePage === 'computer' && !data.conversationId ? 'page' : undefined} aria-label="Novo chat" title="Novo chat"><span className="sidebar__icon sidebar__new-icon" aria-hidden="true"></span><span className="sidebar__label">Novo Chat</span></a>

            <a className="sidebar__link" href="/finance" aria-current={data.activePage === 'graficos' ? 'page' : undefined} aria-label="Finanças" title="Finanças"><span className="sidebar__icon sidebar__finance-icon" aria-hidden="true"></span>
                <span className="sidebar__label">Finanças</span>
            </a>
            <a className="sidebar__link" href="/academic" aria-current={data.activePage === 'aprender' ? 'page' : undefined} aria-label="Acadêmico" title="Acadêmico"><span className="sidebar__icon sidebar__learn-icon" aria-hidden="true"></span><span className="sidebar__label">Acadêmico</span></a>
            <a className="sidebar__link" href="/discover" aria-current={data.activePage === 'descobrir' ? 'page' : undefined} aria-label="Descobrir" title="Descobrir"><span className="sidebar__icon sidebar__discover-icon" aria-hidden="true"></span><span className="sidebar__label">Descobrir</span></a>

        </div>

        <nav className="sidebar__nav" id="sidebar-nav" aria-label="Conversas"></nav>

        <div className="sidebar__footer">
<button className="sidebar__profile" type="button" popoverTarget="profile-menu" aria-expanded="false" aria-controls="profile-menu" aria-label="Abrir menu do perfil">
            <span className="sidebar__avatar" aria-hidden="true">{userInitials(user.nome)}</span>
            <span className="sidebar__profile-info tw:min-w-0 tw:flex-1">
                <span className="sidebar__profile-label" title={user.nome}>{user.nome}</span>
                <span className="sidebar__profile-email">Tester</span>
            </span>
            <span className="sidebar__profile-open" aria-hidden="true"></span>
        </button>


        </div>

        <div className="profile-menu" id="profile-menu" data-user-id={user.id} popover="auto" aria-label="Menu do perfil">
            <div className="profile-menu__main">
                <div className="profile-menu__identity"><span className="sidebar__avatar">{userInitials(user.nome)}</span><div><span>{user.nome}</span><small>{user.email}</small></div></div>
                <button className="profile-menu__item profile-anonymous" type="button" role="switch" aria-checked="false" aria-label="Modo anônimo" data-tooltip="Crie sessões anônimas que não são salvas no seu histórico e expiram após 24 horas"><i className="profile-anonymous__icon" aria-hidden="true"></i><span>Anônima</span><span className="profile-anonymous__switch" aria-hidden="true"></span></button>
                <div className="profile-menu__divider" />
                <button className="profile-menu__item" type="button" data-profile-submenu="appearance" aria-expanded="false" aria-controls="profile-appearance"><i className="profile-menu__icon profile-menu__icon--dark" aria-hidden="true"></i><span>Aparência<small data-theme-label>Escuro</small></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M9.29289 18.7071C8.90237 18.3166 8.90237 17.6834 9.29289 17.2929L14.5858 12L9.29289 6.70711C8.90237 6.31658 8.90237 5.68342 9.29289 5.29289C9.68342 4.90237 10.3166 4.90237 10.7071 5.29289L16.7071 11.2929C16.8946 11.4804 17 11.7348 17 12C17 12.2652 16.8946 12.5196 16.7071 12.7071L10.7071 18.7071C10.3166 19.0976 9.68342 19.0976 9.29289 18.7071Z" fill="currentColor"/>
</svg></button>
                <button className="profile-menu__item" type="button" data-profile-submenu="language" aria-expanded="false" aria-controls="profile-language"><i className="profile-menu__icon profile-menu__icon--language" aria-hidden="true"></i><span>Idioma<small>Português (Brasil)</small></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M9.29289 18.7071C8.90237 18.3166 8.90237 17.6834 9.29289 17.2929L14.5858 12L9.29289 6.70711C8.90237 6.31658 8.90237 5.68342 9.29289 5.29289C9.68342 4.90237 10.3166 4.90237 10.7071 5.29289L16.7071 11.2929C16.8946 11.4804 17 11.7348 17 12C17 12.2652 16.8946 12.5196 16.7071 12.7071L10.7071 18.7071C10.3166 19.0976 9.68342 19.0976 9.29289 18.7071Z" fill="currentColor"/>
</svg></button>

                <div className="profile-menu__divider" />
                <button className="profile-menu__item" type="button" data-open-settings><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/settings-settings.svg)'} as CSSProperties} aria-hidden="true"></i><span>Todas as configurações</span></button>
                <div className="profile-menu__divider" />
                <button className="profile-menu__item" type="button" data-profile-submenu="help" aria-expanded="false" aria-controls="profile-help"><i className="profile-menu__icon profile-menu__icon--help" aria-hidden="true" /><span>Central de ajuda</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.29289 18.7071C8.90237 18.3166 8.90237 17.6834 9.29289 17.2929L14.5858 12L9.29289 6.70711C8.90237 6.31658 8.90237 5.68342 9.29289 5.29289C9.68342 4.90237 10.3166 4.90237 10.7071 5.29289L16.7071 11.2929C16.8946 11.4804 17 11.7348 17 12C17 12.2652 16.8946 12.5196 16.7071 12.7071L10.7071 18.7071C10.3166 19.0976 9.68342 19.0976 9.29289 18.7071Z" fill="currentColor" /></svg></button>
<div className="profile-menu__divider"></div>
                <form action="/logout" method="post"><input type="hidden" name="csrf_token" defaultValue={data.csrfToken} /><button className="profile-menu__item" type="submit"><i className="profile-menu__icon profile-menu__icon--logout" aria-hidden="true"></i><span>Sair</span></button></form>
            </div>
            <div className="profile-menu__submenu" id="profile-appearance" aria-label="Aparência" hidden>
                <button className="profile-menu__back" type="button"><i className="ui-arrow ui-arrow--left" aria-hidden="true"></i> Aparência</button>
                <button className="profile-menu__item" type="button" data-theme-choice="light" aria-pressed="false"><i className="profile-menu__icon profile-menu__icon--light" aria-hidden="true"></i><span>Claro</span><span className="profile-menu__check" aria-hidden="true"></span></button>
<button className="profile-menu__item" type="button" data-theme-choice="dark" aria-pressed="false"><i className="profile-menu__icon profile-menu__icon--dark" aria-hidden="true"></i><span>Escuro</span><span className="profile-menu__check" aria-hidden="true"></span></button>
<button className="profile-menu__item" type="button" data-theme-choice="system" aria-pressed="false"><i className="profile-menu__icon profile-menu__icon--system" aria-hidden="true"></i><span>Sistema</span><span className="profile-menu__check" aria-hidden="true"></span></button>
            </div>
            <div className="profile-menu__submenu profile-menu__languages" id="profile-language" aria-label="Idioma" hidden>
                <button className="profile-menu__back" type="button"><i className="ui-arrow ui-arrow--left" aria-hidden="true"></i> Idioma</button>
                <button className="profile-menu__item" type="button"><span>Português (Brasil)</span><span className="profile-menu__check" aria-hidden="true"></span></button>
                <button className="profile-menu__item" type="button"><span>English</span></button>
            </div>

            <div className="profile-menu__submenu" id="profile-help" aria-label="Central de ajuda" hidden>
                <button className="profile-menu__back" type="button"><i className="ui-arrow ui-arrow--left" aria-hidden="true" /> Central de ajuda</button>
                <a className="profile-menu__item" href="/privacy"><i className="profile-menu__icon profile-menu__icon--privacy" aria-hidden="true" /><span>Política de privacidade</span></a>
                <button className="profile-menu__item" type="button" data-open-shortcuts><i className="profile-menu__icon profile-menu__icon--keyboard" aria-hidden="true" /><span>Atalhos do teclado</span><kbd>Ctrl /</kbd></button>
            </div>
        </div>
    </aside><KeyboardShortcuts /></>
    );
}

export function SidebarBackdrop() {
    return (
<button className="sidebar-backdrop" type="button" tabIndex={-1} aria-label="Fechar menu" hidden></button>
    );
}

export function MobileMenu() {
    return (
<div className="workspace__mobile-brand">
                <button className="workspace__header-button workspace__menu-toggle" type="button" aria-label="Abrir menu lateral" aria-expanded="false" aria-controls="sidebar">
                    <span className="workspace__mobile-menu-icon" aria-hidden="true"></span>
                </button>
            </div>
    );
}

export function DiscoveryToggle() {
    return (
<button className="workspace__header-button mobile-discover-toggle" type="button" aria-label="Abrir Descobrir" aria-controls="mobile-discovery-panel" aria-expanded="false"><span className="sidebar__discover-icon" aria-hidden="true"></span></button>
    );
}

export function DiscoveryPanel() {
    return (
<dialog className="mobile-discovery-panel" id="mobile-discovery-panel" aria-label="Descobrir">
        <div className="mobile-discovery-panel__header"><button type="button" className="mobile-discovery-back" aria-label="Voltar"><i className="ui-arrow ui-arrow--left" aria-hidden="true"></i></button><span>Descobrir</span></div>
        <iframe title="Notícias do Descobrir" data-src="/discover?panel=1"></iframe>
    </dialog>
    );
}

export function ComposerActions() {
    return (<>
<button className="home__microphone tw:grid tw:place-items-center tw:shrink-0 tw:rounded-round" type="button" aria-label="Ditar mensagem" aria-pressed="false" aria-describedby="dictation-status"><span className="microphone-icon" aria-hidden="true"></span></button>
                            <button className="home__send tw:grid tw:place-items-center tw:shrink-0 tw:rounded-round" type="submit" aria-label="Enviar mensagem"><i className="ui-arrow" aria-hidden="true"></i></button>
    </>);
}

export function Settings({ data }: { data: BootstrapData }) {
    const user = data.user;
    if (!user) return null;
    return (<>
<dialog id="settings-dialog" aria-labelledby="settings-title">
<div className="settings-layout"><aside className="settings-sidebar"><label className="settings-search"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/settings-settings-search.svg)'} as CSSProperties} aria-hidden="true"></i><input type="search" placeholder="Pesquisar configurações" aria-label="Pesquisar configurações" /></label><p>Conta</p><nav aria-label="Configurações"><button type="button" data-settings-tab="account"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/settings-account.svg)'} as CSSProperties} aria-hidden="true"></i>Conta</button><button type="button" data-settings-tab="preferences"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/settings-preferences.svg)'} as CSSProperties} aria-hidden="true"></i>Preferências</button><button type="button" data-settings-tab="personalization"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/library/brain.svg)'} as CSSProperties} aria-hidden="true"></i>Personalização</button><button type="button" data-settings-tab="memory"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/settings-memory.svg)'} as CSSProperties} aria-hidden="true"></i>Configurações de memória</button><button type="button" data-settings-tab="notifications"><i className="settings-icon" style={{'--icon': 'url(/static/img/icons/notification.svg)'} as CSSProperties} aria-hidden="true"></i>Notificações</button></nav></aside>
<button type="button" className="settings-close" aria-label="Fechar configurações"><i className="ui-icon-x" aria-hidden="true"></i></button>
<div className="settings-content"><h1 id="settings-title">Personalização</h1>
<section data-settings-panel="preferences" hidden><h2>Aparência</h2><div className="settings-card appearance-card"><div className="appearance-row"><div>Tema<p className="settings-hint">Como a Comet aparece no seu dispositivo</p></div><div className="appearance-options" role="group" aria-label="Tema"><button type="button" className="appearance-choice" data-theme-choice="light" aria-pressed="false"><img src="/static/img/icons/theme-light-preview.svg" alt="" width="112" height="80" /><span>Claro</span></button><button type="button" className="appearance-choice" data-theme-choice="dark" aria-pressed="false"><img src="/static/img/icons/theme-dark-preview.svg" alt="" width="112" height="80" /><span>Escuro</span></button><button type="button" className="appearance-choice" data-theme-choice="system" aria-pressed="false"><img src="/static/img/icons/theme-system-preview.svg" alt="" width="112" height="80" /><span>Automático</span></button></div></div><div className="appearance-row"><div>Fonte das respostas<p className="settings-hint">Estilo da fonte do texto das respostas da IA</p></div><div className="appearance-options" role="group" aria-label="Fonte das respostas"><button type="button" className="appearance-choice" data-response-font="serif" aria-pressed="false"><span className="appearance-font appearance-font--serif" aria-hidden="true">Aa</span><span>Serifada</span></button><button type="button" className="appearance-choice" data-response-font="sans" aria-pressed="false"><span className="appearance-font appearance-font--sans" aria-hidden="true">Aa</span><span>Sans-serif</span></button></div></div></div></section>
<form id="settings-form"><fieldset disabled><section data-settings-panel="account" hidden><h2 className="settings-account-heading">Detalhes</h2><div className="settings-card"><div className="settings-row"><span>Foto do perfil</span><span className="settings-account-avatar" role="img" aria-label="Avatar do perfil">{userInitials(user.nome)}</span></div><label className="settings-row"><span>Nome completo</span><input name="full_name" maxLength={100} autoComplete="name" defaultValue={user.nome} /></label><label className="settings-row"><span>Nome de usuário</span><input name="username" maxLength={30} pattern="[a-zA-Z0-9_.\-]+" autoComplete="nickname" placeholder="Escolha um nome de usuário" /></label><div className="settings-row"><span>E-mail</span><span className="settings-account-email">{user.email}</span></div></div></section><section data-settings-panel="personalization"><div className="settings-card"><label className="settings-row"><span>Como quer ser chamado</span><input name="name" type="text" maxLength={100} placeholder="Nome da sua conta" /></label><label className="settings-row"><span>Sua profissão</span><input name="occupation" type="text" maxLength={200} placeholder="Engenheiro, estudante, etc." /></label><label className="settings-row"><span>Nome da empresa</span><input name="company" type="text" maxLength={200} placeholder="Acme Corp, etc." /></label><label className="settings-row"><span>Data de nascimento</span><input name="birth_date" type="date" maxLength={200} placeholder="" /></label><label className="settings-row"><span>Gênero</span><select name="gender"><option value="">Selecionar</option><option>Feminino</option><option>Masculino</option><option>Não binário</option><option>Prefiro não informar</option></select></label>
<label className="settings-row"><span>Instruções personalizadas</span><textarea name="about" maxLength={2000} placeholder="Preferências, interesses e mais sobre você"></textarea></label></div>
<h2>Localização</h2><div className="settings-card settings-row"><div>Compartilhar localização<p className="settings-hint" id="settings-location-status">Compartilhe sua localização para personalizar as respostas.</p></div><button type="button" id="settings-location">Compartilhar</button></div>
<h2>Preferências de resposta</h2><p className="settings-hint">Defina como o Computer responde às suas perguntas.</p><div className="settings-card"><label className="settings-row"><span>Comprimento da resposta</span><select name="response_length"><option>Padrão</option><option>Curta</option><option>Detalhada</option></select></label><label className="settings-row"><span>Cabeçalhos e listas</span><select name="formatting"><option>Padrão</option><option>Usar quando possível</option><option>Evitar</option></select></label></div></section>
<section data-settings-panel="memory" hidden><div className="settings-card settings-row"><span>Memória entre conversas</span><button type="button" className="memory-switch" role="switch" aria-label="Memória entre conversas" aria-checked="true"><span></span></button></div><div className="settings-card"><label htmlFor="settings-summary">Resumo da memória</label><textarea id="settings-summary" name="summary" maxLength={6000} placeholder="As informações aprendidas sobre você aparecerão aqui."></textarea></div></section>
<div className="settings-actions"><button type="submit">Salvar alterações</button></div></fieldset></form>
<p id="settings-placeholder" hidden>Esta seção estará disponível em breve.</p><p id="settings-status" role="status"></p><button type="button" id="settings-reload" hidden>Tentar novamente</button></div></div></dialog>
<div id="notifications-panel" popover="auto" aria-label="Notificações">
 <header><span>Notificações</span><button type="button" className="notifications-more" aria-label="Opções de notificações" aria-expanded="false"><i className="settings-icon" style={{'--icon': "url('/static/img/icons/news-more.svg')"} as CSSProperties} aria-hidden="true"></i></button></header>
 <div className="notifications-options" hidden><button type="button" data-notification-settings><i className="settings-icon" style={{'--icon': "url('/static/img/icons/settings-settings.svg')"} as CSSProperties} aria-hidden="true"></i>Configurações</button><button type="button" data-notification-clear><i className="settings-icon" style={{'--icon': "url('/static/img/icons/trash.svg')"} as CSSProperties} aria-hidden="true"></i>Excluir tudo lido</button></div>
 <div className="notifications-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path fillRule="evenodd" clipRule="evenodd" d="M3.80094 9.60322C4.25738 5.41917 7.79108 2.25 12 2.25C16.2088 2.25 19.7425 5.41916 20.199 9.60322L20.8731 15.7831C21.0022 16.9665 20.0754 18 18.8849 18H16.8424C16.2874 20.1565 14.3298 21.75 12 21.75C9.67015 21.75 7.71253 20.1565 7.15747 18H5.11498C3.92455 18 2.99767 16.9665 3.12677 15.7831L3.80094 9.60322ZM9.27197 18C9.74598 19.0328 10.7892 19.75 12 19.75C13.2107 19.75 14.2539 19.0328 14.7279 18H9.27197ZM12 4.25C8.8117 4.25 6.1349 6.65066 5.78914 9.82011L5.11498 16L18.8849 16L18.2108 9.82011C17.865 6.65066 15.1882 4.25 12 4.25Z" fill="currentColor"/>
</svg><p>Suas notificações<br />aparecerão aqui</p></div><p className="notifications-status" role="status"></p>
</div>
    </>);
}

export function ChatToolbar({ webSearch = true, attachments = true, providerToggle = true }: { webSearch?: boolean; attachments?: boolean; providerToggle?: boolean }) {
    return (
<div className="home__toolbar tw:flex tw:items-center tw:justify-between">
                        <div className="home__modes tw:flex tw:items-center tw:min-w-0 tw:rounded-round" role="group" aria-label="Modo da mensagem">
{attachments && <>
                            <button className="attachment-toggle" type="button" aria-expanded="false" aria-controls="attachment-menu" aria-label="Adicionar arquivos ou imagens"><i className="attachment-plus" aria-hidden="true"></i></button>
                            <input id="attachment-input" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.csv,.json,.py,.js,.html,.css,.log" hidden />
</>}
                            {providerToggle && <ProviderToggle />}
                        </div>
                        <div className="home__actions tw:relative tw:flex tw:shrink-0 tw:items-center">

<button className="local-model-picker" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="computer-model-menu" hidden><span className="local-model-name">1.7b</span> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M5.29289 9.29289C5.68342 8.90237 6.31658 8.90237 6.70711 9.29289L12 14.5858L17.2929 9.29289C17.6834 8.90237 18.3166 8.90237 18.7071 9.29289C19.0976 9.68342 19.0976 10.3166 18.7071 10.7071L12.7071 16.7071C12.5196 16.8946 12.2652 17 12 17C11.7348 17 11.4804 16.8946 11.2929 16.7071L5.29289 10.7071C4.90237 10.3166 4.90237 9.68342 5.29289 9.29289Z" fill="currentColor"/>
</svg></button>
                            <div className="model-menu" id="computer-model-menu" popover="auto" role="menu" aria-label="Modelos locais"></div>
<ComposerActions />
                        </div>
                    </div>
    );
}

export function ChatComposer({ composerClass = "", placeholder = "Pergunte qualquer coisa", readonly = false, webSearch = true, attachments = true, providerToggle = true, demo = false }: { composerClass?: string; placeholder?: string; readonly?: boolean; webSearch?: boolean; attachments?: boolean; providerToggle?: boolean; demo?: boolean }) {
    return (
<form className={`home__composer ${composerClass}`} aria-label={demo ? "Exemplo de registro financeiro" : "Escrever uma mensagem"} onSubmit={demo ? event => event.preventDefault() : undefined}>
    <p className="home__dictation-status" role="status" aria-live="polite" id="dictation-status"></p>
    <div className="attachment-list" aria-label="Arquivos anexados" hidden></div>
    <p className="attachment-status" role="status"></p>
    {demo ? <p className="home__input"><span className="sr-only">Exemplos de registros financeiros.</span><span className="hero__typewriter" data-typewriter aria-hidden="true">Gastei R$ 67 no mercado hoje.</span></p> : <textarea className="home__input" aria-label="Mensagem" placeholder={placeholder} rows={2} maxLength={8000} readOnly={readonly}></textarea>}
{demo ? <div inert><ChatToolbar webSearch={webSearch} attachments={attachments} providerToggle={providerToggle} /></div> : <ChatToolbar webSearch={webSearch} attachments={attachments} providerToggle={providerToggle} />}
{attachments && <div id="attachment-menu" className="attachment-menu" hidden><button type="button" data-upload-files><i aria-hidden="true"></i>Enviar arquivos ou imagens</button>{webSearch && <><button type="button" className="web-search-toggle" aria-pressed="true"><i aria-hidden="true"></i>Pesquisa na web<span className="web-search-check" aria-hidden="true"></span></button></>}</div>}
</form>
    );
}
