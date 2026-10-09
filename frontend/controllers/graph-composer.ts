import { optionalElement, requiredElement, present } from './dom';
import { createFinancialConversationState } from './financial-context';
import { executeFinancialActions, refreshFinancialContext, rememberFinancialExecution, FinancialExecutionRejected } from './financial-execution';
import { financialExecutionFeedback, financialClarificationFeedback, financialUserMessage } from './financial-feedback';
import { interpretFinancialInput } from './financial-ai';
export default function mount({scope, fetch, requestAnimationFrame, ResizeObserver, MutationObserver}: PageContext) {
    const composer = optionalElement(document, '.finance-composer', HTMLElement);
    if (!composer) return;
    const column = requiredElement(document, '.finance-chart-column', HTMLElement);
    const page = requiredElement(document, '.finance-page', HTMLElement);
    function alignComposer() {
        const bounds = column.getBoundingClientRect();
        page.style.setProperty('--finance-composer-left', bounds.left + 'px');
        page.style.setProperty('--finance-composer-width', bounds.width + 'px');
        page.style.setProperty('--finance-composer-height', present(composer).offsetHeight + 'px');
    }
    const observer = new ResizeObserver(alignComposer);
    observer.observe(column);
    observer.observe(composer);
    scope.listen(window, 'resize', alignComposer);
    new MutationObserver(alignComposer).observe(requiredElement(document, '.finance-layout', HTMLElement), { attributes: true, attributeFilter: ['class'] });
    let animationFrame = 0;
    function followSidebar() {
        cancelAnimationFrame(animationFrame);
        const start = performance.now();
        function frame(now: number) {
            alignComposer();
            if (now - start < 550) animationFrame = requestAnimationFrame(frame);
        }
        animationFrame = requestAnimationFrame(frame);
    }
    new MutationObserver(followSidebar).observe(requiredElement(document, '.workspace', HTMLElement), { attributes: true, attributeFilter: ['class'] });
    alignComposer();
    const input = optionalElement(composer, 'textarea', HTMLTextAreaElement);
    const send = requiredElement(composer, '.home__send', HTMLButtonElement);
    function updateInput() {
        present(input).style.height = 'auto';
        present(input).style.height = Math.max(38, Math.min(present(input).scrollHeight, 240)) + 'px';
        send.classList.toggle('is-empty', !present(input).value.trim());
    }
    present(input).addEventListener('input', updateInput, {signal: scope.signal});
    updateInput();
    const form = requiredElement(composer, 'form', HTMLFormElement);
    const responseCard = requiredElement(composer, '.finance-response', HTMLElement);
    const status = requiredElement(responseCard, '.finance-entry-status', HTMLElement);
    let context: FinancialContext = {...createFinancialConversationState(),locale:'pt-BR',currency:'BRL',categories:[],transactions:[],deleted_transactions:[],transactions_complete:false,deleted_transactions_complete:false,recent_events:[]};
    let busy = false;
    let pending: {text:string; actions:readonly FinancialAction[]; operationId:string; context:FinancialContext; metadata:FinancialInterpretationMetadata; result?:FinancialExecutionResult} | null = null;
    async function confirmPending() {
        const operation = present(pending);
        const result = operation.result ??= await executeFinancialActions(operation.actions, operation.operationId, fetch);
        const refreshed = await refreshFinancialContext(operation.context, fetch);
        if (!scope.active) return;
        context = rememberFinancialExecution(refreshed, result);
        pending = null;
        status.textContent = financialExecutionFeedback(result, context);
        window.dispatchEvent(new CustomEvent('finance:changed', {detail:operation.metadata}));
    }
    async function submit() {
        const text = present(input).value.trim();
        if (busy || !text) return;
        busy = true; send.disabled = true; present(input).readOnly = true;
        responseCard.hidden = false; status.textContent = 'Conferindo transações…';
        try {
            if (pending && pending.text !== text) {
                await confirmPending();
                if (!scope.active) return;
            }
            if (!pending) {
                context = await refreshFinancialContext(context, fetch);
                if (!scope.active) return;
                const turn = await interpretFinancialInput(text, context, window.ComputerModels.selected(), fetch);
                if (!scope.active) return;
                window.dispatchEvent(new CustomEvent('finance:interpreted', {detail:turn.metadata}));
                if (turn.result.status !== 'resolved') {
                    context = turn.context;
                    status.textContent = financialClarificationFeedback(turn.result, context);
                    if (turn.result.status === 'needs_clarification') present(input).value = '';
                    return;
                }
                pending = {text, actions:turn.result.actions, operationId:crypto.randomUUID(), context:turn.context, metadata:turn.metadata};
            }
            await confirmPending();
            if (scope.active) present(input).value = '';
        } catch (error) {
            if (error instanceof FinancialExecutionRejected) pending = null;
            if (scope.active) status.textContent = error instanceof FinancialExecutionRejected ? financialUserMessage(error.message, 'Não foi possível concluir o pedido. Confira os dados e tente novamente.') : 'Não consegui confirmar o pedido. Envie novamente para conferir, sem duplicar transações.';
        } finally {
            busy = false; send.disabled = false; present(input).readOnly = false; updateInput();
        }
    }
    form.addEventListener('submit', event => {event.preventDefault();void submit();}, {signal: scope.signal});
    present(input).addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();void submit();}
    }, {signal: scope.signal});
}
