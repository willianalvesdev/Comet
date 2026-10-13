import { useRef } from 'react';
import type { BootstrapData } from '../types';
import { ChatComposer } from './WorkspaceParts';

export default function LandingPage({ bootstrap }: { bootstrap: BootstrapData }) {
    const mobileMenu = useRef<HTMLDialogElement>(null);
    return (<>
<div className="page-background" aria-hidden="true"></div>
    <header className="site-header">
        <div className="site-header__inner">
            <a className="site-header__brand" href="#" aria-label="Comet — início">
                <img className="site-header__logo" src="/static/img/logos/textlogo.svg" alt="Comet" />
            </a>
            <nav className="site-header__nav" aria-label="Navegação principal">
                <a href="#inicio">Início</a>
                <a href="#contato">Contato</a>
                <a href="#sobre">Sobre a Comet</a>
            </nav>
            <button className="site-header__login" type="button" data-auth-open="login">Iniciar Sessão</button>
            <button className="site-header__menu-toggle" type="button" aria-label="Abrir menu" aria-haspopup="dialog" onClick={() => mobileMenu.current?.showModal()}><svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 6.5h14M2 11.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
        </div>
    </header>
    <dialog className="landing-menu" ref={mobileMenu} aria-label="Menu principal">
        <div className="landing-menu__header"><img src="/static/img/logos/textlogo.svg" alt="Comet" /><button type="button" aria-label="Fechar menu" onClick={() => mobileMenu.current?.close()}><i className="ui-icon-x" aria-hidden="true"></i></button></div>
        <nav aria-label="Navegação móvel" onClick={() => mobileMenu.current?.close()}>
            <a href="#inicio">Início</a><a href="#contato">Contato</a><a href="#sobre">Sobre a Comet</a>
            <button type="button" data-auth-open="login">Iniciar Sessão</button>
        </nav>
    </dialog>
    <main id="inicio">
        <section className="hero" aria-labelledby="hero-title">
            <h1 id="hero-title">O novo Comet<br />para navegador</h1>
            <p className="hero__description" id="sobre">
                A nova ferramenta Web de<br />administração financeira pessoal
            </p>

            <ChatComposer composerClass="hero__composer" demo />

            <div className="hero__actions">
                <button className="hero__action hero__action--primary" type="button" data-auth-open="signup">Criar uma conta</button>
                <a className="hero__action hero__action--secondary" href="#sobre">Sobre o Site</a>
            </div>

        </section>
    </main>
    <dialog className="auth" aria-labelledby="auth-entry-title" aria-describedby="auth-entry-policy">
        <button className="auth__close" type="button" aria-label="Fechar janela"><i className="ui-icon-x" aria-hidden="true"></i></button>
        <section className="auth__panel" data-auth-panel="entry">
            <h2 className="auth__title" id="auth-entry-title" tabIndex={-1}>Entre ou cadastre-se para desbloquear todo o potencial do Comet</h2>
            <p className="auth__policy" id="auth-entry-policy">Escolha como você quer continuar.</p>
            <div className="auth__options">
                <button className="auth__provider auth__provider--google" type="button" data-auth-provider="google"><i aria-hidden="true"></i>Continuar com o Google</button>
                <button className="auth__provider auth__provider--github" type="button" data-auth-provider="github"><i aria-hidden="true"></i>Continuar com o GitHub</button>
                <div className="auth__divider" role="separator"></div>
                <form className="auth__form" data-auth-email action="/api/auth/email/request" method="post">
                    <input type="hidden" name="csrf_token" defaultValue={bootstrap.csrfToken} />
                    <label className="sr-only" htmlFor="auth-email">Seu e-mail</label>
                    <input id="auth-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="Introduza o seu e-mail" required maxLength={254} />
                    <button className="auth__submit auth__submit--email" type="submit" disabled>Continuar com e-mail</button>
                </form>
                <p className="auth__message" data-auth-entry-message role="alert"></p>
            </div>
            <button className="auth__dismiss" type="button" data-auth-close>Fechar</button>
        </section>
        <section className="auth__panel auth__panel--verify" data-auth-panel="verify" hidden>
            <img className="auth__verification-icon" src="/static/img/icons/email-verification.svg" alt="" width="80" height="80" />
            <h2 className="auth__title" id="auth-verify-title" tabIndex={-1}>Verifique o seu e-mail</h2>
            <p className="auth__policy" id="auth-verify-policy">Enviamos um código de seis dígitos para<br /><span data-auth-destination></span></p>
            <form className="auth__form auth__form--verify" data-auth-verify action="/api/auth/email/verify" method="post">
                <input type="hidden" name="csrf_token" defaultValue={bootstrap.csrfToken} />
                <fieldset className="auth__digits"><legend className="sr-only">Código de verificação de seis dígitos</legend>
                    {[0,1,2,3,4,5].map(index => <input key={index} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`Dígito ${index + 1} do código`} maxLength={6} pattern="[0-9]*" data-auth-digit={index} />)}
                </fieldset>
                <p className="auth__message" data-auth-verify-message role="alert"></p>
                <button className="auth__submit" type="submit" disabled>Confirmar</button>
            </form>
            <p className="auth__hint">O código expira em 10 minutos.</p>
            <div className="auth__verification-actions"><button type="button" data-auth-resend>Reenviar código</button><button type="button" data-auth-change>Alterar e-mail</button></div>
            <p className="sr-only" data-auth-status role="status"></p>
        </section>
    </dialog>
    </>);
}
