import { elementList } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
    const key = 'ascenda-cookie-choice-v1';
    let choice: string | null = null;
    try { choice = localStorage.getItem(key); } catch {}
    const memory = new Map<string, string>();
    const optional = (name: string) => name === 'ascensao-theme' || name === 'ascensao-sidebar-collapsed' || name.startsWith('ascenda-news-');
    window.CometStorage = {
        getItem(name) {
            if (memory.has(name)) return memory.get(name) ?? null;
            if (choice !== 'accepted') return null;
            try { return localStorage.getItem(name); } catch { return null; }
        },
        setItem(name, value) {
            memory.set(name, String(value));
            if (choice === 'accepted') try { localStorage.setItem(name, value); } catch {}
        }
    };
    function save(value: string) {
        choice = value;
        try {
            localStorage.setItem(key, value);
            if (value === 'rejected') {
                Object.keys(localStorage).filter(optional).forEach(name => localStorage.removeItem(name));
            } else {
                memory.forEach((value, name) => localStorage.setItem(name, value));
            }
        } catch {}
    }
    window.addEventListener('storage', event => { if (event.key === key) choice = event.newValue; }, {signal: scope.signal});
    (() => {
        if (window.self !== window.top) return;
        const notice = document.createElement('section');
        notice.className = 'cookie-notice';
        notice.setAttribute('aria-labelledby', 'cookie-title');
        notice.innerHTML = `<h2 id="cookie-title"><span class="cookie-notice__icon" aria-hidden="true"></span>Política de Cookies</h2><p>Na Comet, sua privacidade faz parte da experiência, inclusive ao usar recursos de inteligência artificial. Usamos cookies essenciais para manter seu acesso e proteger sua conta. Com sua permissão, também armazenamos preferências neste navegador, como aparência, interesses e curtidas, para personalizar sua experiência. Ao selecionar “Entendi”, você permite esse armazenamento opcional. Você pode recusá-lo e continuar usando o site. <a href="/privacy">Leia a Política de Privacidade</a>.</p><div class="cookie-actions"><button type="button" data-cookie-choice="rejected">Recusar opcionais</button><button type="button" data-cookie-choice="accepted">Entendi</button></div>`;
        function show(visible: boolean) { notice.hidden = !visible; }
        elementList(notice, '[data-cookie-choice]', HTMLElement).forEach(button => button.addEventListener('click', () => {
            save(button.dataset.cookieChoice ?? 'rejected'); show(false);
        }, {signal: scope.signal}));
        scope.append(notice);
        window.addEventListener('cookies:manage', () => { show(true); notice.querySelector<HTMLButtonElement>('[data-cookie-choice]')?.focus(); }, {signal: scope.signal});
        show(!['accepted', 'rejected'].includes(choice ?? ''));
        window.addEventListener('storage', event => { if (event.key === key) show(!['accepted', 'rejected'].includes(choice ?? '')); }, {signal: scope.signal});
    })();
}
