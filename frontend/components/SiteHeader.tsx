import { useRef } from 'react';

export default function SiteHeader({home = false, signedIn = false}: {home?: boolean; signedIn?: boolean}) {
    const mobileMenu = useRef<HTMLDialogElement>(null);
    return <>
    <header className={home ? "site-header" : "site-header site-header--themed"}>
        <div className="site-header__inner">
            <a className="site-header__brand" href={home ? "#inicio" : "/"} aria-label="Comet — início">
                <img className="site-header__logo" src="/static/img/logos/comet-wordmark.svg" alt="Comet" />
            </a>
            <nav className="site-header__nav" aria-label="Navegação principal">
                <a href={home ? "#inicio" : "/#inicio"}>Início</a>
                <a href="/privacidade.html#contato">Contato</a>
                <a href={home ? "#sobre" : "/#sobre"}>Sobre a Comet</a>
            </nav>
            <div className="site-header__actions">{signedIn ? <a className="site-header__login" href="/novo.html">Abrir Comet</a> : <>{home ? <button className="site-header__login" type="button" data-auth-open="signup">Criar conta</button> : <a className="site-header__login" href="/?login=1">Criar conta</a>}{home ? <button className="site-header__login site-header__login--outline" type="button" data-auth-open="login">Iniciar sessão</button> : <a className="site-header__login site-header__login--outline" href="/?login=1">Iniciar sessão</a>}</>}</div>
            <button className="site-header__menu-toggle" type="button" aria-label="Abrir menu" aria-haspopup="dialog" onClick={() => mobileMenu.current?.showModal()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="M3 8C3 7.44772 3.44772 7 4 7H20C20.5523 7 21 7.44772 21 8C21 8.55228 20.5523 9 20 9H4C3.44772 9 3 8.55228 3 8ZM3 16C3 15.4477 3.44772 15 4 15H14C14.5523 15 15 15.4477 15 16C15 16.5523 14.5523 17 14 17H4C3.44772 17 3 16.5523 3 16Z" fill="currentColor"/>
</svg></button>
        </div>
    </header>
    <dialog className={home ? "landing-menu" : "landing-menu landing-menu--themed"} ref={mobileMenu} aria-label="Menu principal">
        <div className="landing-menu__header"><img src="/static/img/logos/textlogo.svg" alt="Comet" /><button type="button" aria-label="Fechar menu" onClick={() => mobileMenu.current?.close()}><i className="ui-icon-x" aria-hidden="true"></i></button></div>
        <nav aria-label="Navegação móvel" onClick={() => mobileMenu.current?.close()}>
            <a href={home ? "#inicio" : "/#inicio"}>Início</a><a href="/privacidade.html#contato">Contato</a><a href={home ? "#sobre" : "/#sobre"}>Sobre a Comet</a>
            <div className="site-header__actions">{signedIn ? <a className="site-header__login" href="/novo.html">Abrir Comet</a> : <>{home ? <button className="site-header__login" type="button" data-auth-open="signup">Criar conta</button> : <a className="site-header__login" href="/?login=1">Criar conta</a>}{home ? <button className="site-header__login site-header__login--outline" type="button" data-auth-open="login">Iniciar sessão</button> : <a className="site-header__login site-header__login--outline" href="/?login=1">Iniciar sessão</a>}</>}</div>
        </nav>
    </dialog>
    </>;
}
