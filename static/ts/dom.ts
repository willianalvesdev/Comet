function requiredElement<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T {
    const element = parent.querySelector(selector);
    if (!(element instanceof type)) throw new Error('Elemento ausente ou inválido: ' + selector);
    return element;
}
function optionalElement<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T | null {
    const element = parent.querySelector(selector);
    return element instanceof type ? element : null;
}
function elementList<T extends Element>(parent: ParentNode, selector: string, type: {new():T}): T[] {
    return Array.from(parent.querySelectorAll(selector)).filter((element): element is T => element instanceof type);
}
function eventElement(target: EventTarget | null): Element | null { return target instanceof Element ? target : null; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function present<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('Valor obrigatório ausente.');
    return value;
}

function formField(form:HTMLFormElement,name:string):HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement {
 const field=form.elements.namedItem(name);
 if(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)return field;
 throw new Error('Campo ausente: '+name);
}
