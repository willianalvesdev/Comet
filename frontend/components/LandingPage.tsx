import SiteHeader from './SiteHeader';
import type { BootstrapData } from '../types';
import { ChatComposer } from './WorkspaceParts';

export default function LandingPage({ bootstrap }: { bootstrap: BootstrapData }) {
    return (<>
<div className="page-background" aria-hidden="true"></div>
<div className="landing-grain" aria-hidden="true"></div>
    <SiteHeader home />
    <main id="inicio">
        <section className="hero" aria-labelledby="hero-title">
            <h1 id="hero-title">O novo Comet<br />para navegador</h1>
            <p className="hero__description" id="sobre">
                A nova ferramenta Web de<br />administração financeira pessoal
            </p>

            <ChatComposer composerClass="hero__composer" demo />

            <div className="hero__actions">
                <button className="site-header__login hero__signup" type="button" data-auth-open="signup">Criar conta</button>
            </div>

        </section>
    </main>
    <footer className="landing-footer">
        <div className="landing-footer__inner">
            <div className="landing-footer__brand">
                <a href="#inicio" aria-label="Comet — início"><img src="/static/img/logos/logo.svg" alt="Comet" width="44" height="44" /></a>
            </div>
            <nav className="landing-footer__column" aria-label="Explore o Comet">
                <h2>Explore</h2>
                <a href="/novo.html">Pesquisar</a>
                <a href="/financas.html">Finanças</a>
                <a href="/academico.html">Acadêmico</a>
                <a href="/descobrir.html">Descobrir</a>
            </nav>
            <nav className="landing-footer__column" aria-label="Sobre o Comet">
                <h2>Comet</h2>
                <a href="#sobre">Sobre a Comet</a>
                <a href="/privacidade.html#contato">Contato</a>
                <button type="button" data-auth-open="signup">Criar conta</button>
                <button type="button" data-auth-open="login">Iniciar sessão</button>
            </nav>
            <nav className="landing-footer__column" aria-label="Privacidade">
                <h2>Privacidade</h2>
                <a href="/privacidade.html">Política de Privacidade</a>
                <button type="button" onClick={() => window.dispatchEvent(new Event('cookies:manage'))}>Preferências de cookies</button>
            </nav>
            <div className="landing-footer__bottom"><span>Comet © {new Date().getFullYear()}</span></div>
        </div>
    </footer>
    <dialog className="auth" aria-labelledby="auth-entry-title" aria-describedby="auth-entry-policy">
        <button className="auth__close" type="button" aria-label="Fechar janela"><i className="ui-icon-x" aria-hidden="true"></i></button>
        <section className="auth__panel" data-auth-panel="entry">
            <h2 className="auth__title" id="auth-entry-title" tabIndex={-1}>Entre ou cadastre-se para desbloquear todo o potencial do Comet</h2>
            <p className="auth__policy" id="auth-entry-policy">Escolha como você quer continuar. <a href="/privacidade.html">Política de Privacidade</a>.</p>
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
            <i className="auth__verification-icon" aria-hidden="true" />
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
