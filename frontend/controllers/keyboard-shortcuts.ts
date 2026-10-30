import {keyboardShortcuts} from '../keyboard-shortcuts';
import {requiredElement} from './dom';

export default function mount({scope}: PageContext) {
    const dialog = requiredElement(document, '.keyboard-shortcuts', HTMLDialogElement);
    let opener: HTMLElement | null = null;
    const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
    function show() {
        if (dialog.open) { dialog.close(); return; }
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.querySelectorAll<HTMLElement>(':popover-open').forEach(menu=>menu.hidePopover());
        dialog.showModal();
    }
    scope.listen(document, 'click', event => {
        if ((event.target as Element).closest('[data-open-shortcuts]')) show();
        if ((event.target as Element).closest('[data-shortcuts-close]')) dialog.close();
    });
    scope.listen(dialog, 'close', () => { (opener?.isConnected && opener.getClientRects().length ? opener : document.querySelector<HTMLElement>('.sidebar__profile'))?.focus({preventScroll:true}); });
    scope.listen(dialog, 'click', event => {
        if (event.target !== dialog) return;
        const r=dialog.getBoundingClientRect();
        if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();
    });
    const status = document.createElement('p'); status.className='sr-only'; status.setAttribute('role','status'); scope.append(status);
    async function run(action: typeof keyboardShortcuts[number]['action'], target: Element | null) {
        switch(action) {
            case 'shortcuts': show(); break;
            case 'new': click('.sidebar__link[aria-label="Novo chat"]'); break;
            case 'focus': document.querySelector<HTMLTextAreaElement>('.home__input')?.focus(); break;
            case 'search': click('.sidebar__search'); break;
            case 'settings': click('[data-open-settings]'); break;
            case 'anonymous': click('.profile-anonymous'); break;
            case 'dictation': click('.home__microphone:not(:disabled):not([hidden])'); break;
            case 'upload': if(document.querySelector('.attachment-toggle:not(:disabled)'))click('#attachment-input:not(:disabled)'); break;
            case 'finance': document.querySelector<HTMLInputElement>('.crypto-search input, .finance-page input[type="search"]')?.focus(); break;
            case 'link':
                if (!/^\/chat\//.test(location.pathname)) return;
                try { await navigator.clipboard.writeText(location.origin+location.pathname); status.textContent='Link da conversa copiado. O acesso exige a conta proprietária.'; }
                catch { status.textContent='Não foi possível copiar o link.'; }
                break;
            case 'send': {
                const editor=target?.closest('.computer-user-editor');
                if(editor) { (editor.querySelector<HTMLButtonElement>('.computer-user-editor__save:not(:disabled)'))?.click(); return; }
                const input=document.querySelector<HTMLTextAreaElement>('.home__input');
                if(input&&!input.readOnly&&!input.disabled&&input.value.trim())input.closest('form')?.requestSubmit();
                break;
            }
            case 'stop': click('.home__composer.is-responding .home__send'); break;
            case 'sidebar': {
                const artifact=document.querySelector<HTMLElement>('.computer-page .artifact-card__open');
                if(document.querySelector('.artifact-preview:not([hidden])'))click('.artifact-close');
                else if(artifact)artifact.click();
                else click(innerWidth<640&&document.body.classList.contains('is-sidebar-collapsed')?'.workspace__menu-toggle':'.sidebar__toggle');
                break;
            }
            case 'research': case 'computer':
                if(!document.querySelector('.computer-page'))await window.WorkspaceNavigation.go('/new');
                click(action==='research'?'.model-picker':'.computer-provider');
                break;
        }
    }
    scope.listen(document, 'keydown', event => {
        if(event.defaultPrevented||event.repeat||event.isComposing||event.altKey)return;
        const target=event.target instanceof Element?event.target:null;
        const mod=event.ctrlKey||event.metaKey;
        const punctuation: Record<string,string> = {Slash:'/',Semicolon:';',Period:'.'};
        const shortcut=keyboardShortcuts.find(item=>(punctuation[item.code] ? event.key===punctuation[item.code] : item.code===event.code) && !!('shift' in item && item.shift)===event.shiftKey && item.keys.some(key=>key==='Ctrl')===mod);
        if(!shortcut)return;
        if(document.querySelector('dialog[open]')&&shortcut.action!=='shortcuts')return;
        if(shortcut.action==='stop'&&(document.querySelector(':popover-open, .computer-user-editor, .artifact-preview:not([hidden])')||!document.querySelector('.home__composer.is-responding')))return;
        if(shortcut.action==='finance'&&(target?.closest('input,textarea,[contenteditable="true"]')||!document.querySelector('.crypto-search input, .finance-page input[type="search"]')))return;
        event.preventDefault(); event.stopPropagation();
        void run(shortcut.action,target).catch(()=>{status.textContent='Não foi possível executar este atalho.';});
    }, {capture:true});
}
