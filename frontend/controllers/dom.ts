
export function requiredElement<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T {
    const element = parent.querySelector(selector);
    if (!(element instanceof type)) throw new Error('Elemento ausente ou inválido: ' + selector);
    return element;
}
export function optionalElement<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T | null {
    const element = parent.querySelector(selector);
    return element instanceof type ? element : null;
}
export function elementList<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T[] {
    return Array.from(parent.querySelectorAll(selector)).filter((element): element is T => element instanceof type);
}
export function eventElement(target: EventTarget | null): Element | null { return target instanceof Element ? target : null; }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'; }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function present<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('Valor obrigatório ausente.');
    return value;
}

export function formField(form:HTMLFormElement,name:string):HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement {
 const field=form.elements.namedItem(name);
 if(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)return field;
 throw new Error('Campo ausente: '+name);
}

export function setupSortMenu(menu: HTMLElement, trigger: HTMLButtonElement) {
    menu.addEventListener('toggle', () => {
        const open = menu.matches(':popover-open');
        trigger.setAttribute('aria-expanded', String(open));
        if (!open) return;
        const rect = trigger.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 8)) + 'px';
        optionalElement(menu, '[aria-checked="true"]', HTMLButtonElement)?.focus();
    });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); trigger.focus(); }
        if (event.key === 'Tab') menu.hidePopover();
        const buttons = elementList(menu, '[role="menuitemradio"]', HTMLButtonElement);
        if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = buttons.findIndex(button => button === document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus();
    });
}
