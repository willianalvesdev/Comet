import { optionalElement, elementList, requiredElement } from './dom';
import { apiError } from './api-data';

export default function mount({scope, fetch, setInterval}: PageContext) {
    const element = optionalElement(document,'.auth',HTMLDialogElement);
    if (!element) return;
    const dialog = element;
    const emailForm = requiredElement(dialog,'[data-auth-email]',HTMLFormElement);
    const verifyForm = requiredElement(dialog,'[data-auth-verify]',HTMLFormElement);
    const emailInput = requiredElement(emailForm,'[name="email"]',HTMLInputElement);
    const digits = elementList(dialog,'[data-auth-digit]',HTMLInputElement);
    const emailButton = requiredElement(emailForm,'button[type="submit"]',HTMLButtonElement);
    const verifyButton = requiredElement(verifyForm,'button[type="submit"]',HTMLButtonElement);
    const resend = requiredElement(dialog,'[data-auth-resend]',HTMLButtonElement);
    const change = requiredElement(dialog,'[data-auth-change]',HTMLButtonElement);
    const providers = elementList(dialog,'[data-auth-provider]',HTMLButtonElement);
    const entryMessage = requiredElement(dialog,'[data-auth-entry-message]',HTMLElement);
    const verifyMessage = requiredElement(dialog,'[data-auth-verify-message]',HTMLElement);
    let busy = false, sentTo = '', resendAt = 0, revision = 0;

    function code() { return digits.map(input => input.value).join(''); }
    function update() {
        emailForm.classList.toggle('has-email', Boolean(emailInput.value.trim()));
        emailButton.disabled = busy || !emailInput.validity.valid || !emailInput.value.trim();
        verifyButton.disabled = busy || !/^\d{6}$/.test(code());
        const seconds = Math.max(0,Math.ceil((resendAt-Date.now())/1000));
        resend.disabled = busy || seconds > 0;
        resend.textContent = seconds > 0 ? `Reenviar em ${seconds}s` : 'Reenviar código';
        change.disabled = busy;
        emailInput.readOnly = busy;
        for (const input of digits) input.readOnly = busy;
        for (const button of providers) button.disabled = busy;
        dialog.setAttribute('aria-busy',String(busy));
    }
    function panel(name: 'entry' | 'verify') {
        for (const item of elementList(dialog,'[data-auth-panel]',HTMLElement)) item.hidden = item.dataset.authPanel !== name;
        dialog.setAttribute('aria-labelledby',`auth-${name}-title`);
        dialog.setAttribute('aria-describedby',`auth-${name}-policy`);
        dialog.scrollTop = 0;
        update();
    }
    function open() {
        revision++;
        entryMessage.textContent = '';
        panel('entry');
        if (!dialog.open) dialog.showModal();
        requiredElement(dialog,'#auth-entry-title',HTMLElement).focus();
    }
    for (const button of elementList(document,'[data-auth-open]',HTMLElement)) button.addEventListener('click',open,{signal:scope.signal});
    for (const button of elementList(dialog,'.auth__close, [data-auth-close]',HTMLElement)) button.addEventListener('click',() => dialog.close(),{signal:scope.signal});
    dialog.addEventListener('close',() => {revision++; for (const input of digits) input.value = '';},{signal:scope.signal});
    emailInput.addEventListener('input',() => {entryMessage.textContent = ''; update();},{signal:scope.signal});
    change.addEventListener('click',() => {revision++; panel('entry'); emailInput.focus();},{signal:scope.signal});
    async function post(url: string, data: Record<string,unknown>) {
        const csrf = requiredElement(emailForm,'[name="csrf_token"]',HTMLInputElement).value;
        const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify(data)});
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(result,'Não foi possível continuar. Tente novamente.'));
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Resposta inválida. Tente novamente.');
        return result as Record<string,unknown>;
    }
    const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível conectar. Tente novamente.';
    async function sendCode(isResend: boolean) {
        if (busy || (isResend && Date.now() < resendAt)) return;
        if (!isResend && !emailForm.reportValidity()) return;
        const destination = isResend ? sentTo : emailInput.value.trim();
        const message = isResend ? verifyMessage : entryMessage;
        const current = revision;
        message.textContent = '';
        busy = true; update();
        try {
            await post('/api/auth/email/request',{email:destination});
            resendAt = Date.now()+60000;
            if (!dialog.open || revision !== current) return;
            sentTo = destination;
            requiredElement(dialog,'[data-auth-destination]',HTMLElement).textContent = sentTo;
            for (const input of digits) input.value = '';
            verifyMessage.textContent = '';
            panel('verify');
            requiredElement(dialog,'[data-auth-status]',HTMLElement).textContent = isResend ? 'Um novo código foi enviado.' : 'Código enviado para o seu e-mail.';
            digits[0].focus();
        } catch (error) { if (revision === current) message.textContent = errorText(error); }
        finally {busy = false; update();}
    }
    emailForm.addEventListener('submit',event => {event.preventDefault(); void sendCode(false);},{signal:scope.signal});
    resend.addEventListener('click',() => void sendCode(true),{signal:scope.signal});

    function distribute(value: string, start: number) {
        verifyMessage.textContent = '';
        const numbers = value.replace(/\D/g,'').slice(0,6);
        if (numbers.length === 6) start = 0;
        for (let i=0;i<numbers.length && start+i<6;i++) digits[start+i].value = numbers[i];
        digits[Math.min(start+numbers.length,5)].focus();
        update();
    }
    digits.forEach((input,index) => {
        input.addEventListener('input',() => {
            const value = input.value.replace(/\D/g,'');
            input.value = '';
            distribute(value,index);
        },{signal:scope.signal});
        input.addEventListener('paste',event => {
            event.preventDefault();
            distribute(event.clipboardData?.getData('text') || '',index);
        },{signal:scope.signal});
        input.addEventListener('focus',() => input.select(),{signal:scope.signal});
        input.addEventListener('keydown',event => {
            if (event.key === 'Backspace' && !input.value && index > 0) {event.preventDefault();digits[index-1].value='';digits[index-1].focus();update();}
            if (event.key === 'ArrowLeft' && index > 0) {event.preventDefault();digits[index-1].focus();}
            if (event.key === 'ArrowRight' && index < 5) {event.preventDefault();digits[index+1].focus();}
        },{signal:scope.signal});
    });
    verifyForm.addEventListener('submit',async event => {
        event.preventDefault();
        if (busy || !/^\d{6}$/.test(code())) return;
        const current = revision;
        busy = true; verifyMessage.textContent = '';update();
        try {
            await post('/api/auth/email/verify',{code:code()});
            if (dialog.open && revision === current) window.location.assign('/principal.html');
        } catch (error) {if (revision === current) {verifyMessage.textContent = errorText(error);digits[0].focus();}}
        finally {busy = false; update();}
    },{signal:scope.signal});
    for (const button of providers) button.addEventListener('click',async () => {
        if (busy) return;
        const current = revision, provider = button.dataset.authProvider;
        busy = true; entryMessage.textContent = ''; update();
        try {
            const result = await post('/api/auth/'+provider+'/start',{});
            const url = new URL(String(result.url));
            const allowed = provider === 'google' ? 'accounts.google.com' : 'github.com';
            if (url.protocol !== 'https:' || url.hostname !== allowed) throw new Error('Não foi possível iniciar a entrada.');
            if (dialog.open && revision === current) window.location.assign(url.href);
        } catch (error) {if (revision === current) entryMessage.textContent = errorText(error);}
        finally {busy = false; update();}
    },{signal:scope.signal});
    const params = new URLSearchParams(location.search);
    if (params.has('login')) {
        open();
        if (params.has('auth_error')) {
            entryMessage.textContent = params.get('auth_error') === 'email'
                ? 'Para acessar esta conta com segurança, continue com o código por e-mail.'
                : 'Não foi possível concluir a entrada. Tente novamente ou continue com e-mail.';
            const clean = new URL(location.href); clean.searchParams.delete('auth_error');
            history.replaceState(history.state,'',clean);
        }
    }
    setInterval(update,1000);
    update();
}
