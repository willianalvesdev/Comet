import { requiredElement, optionalElement, present, errorMessage } from './dom';
import { apiError, financeHistoryData } from './api-data';
export default function mount({scope, fetch}: PageContext) {
    const historyToggle = requiredElement(document, '.finance-panel-toggle', HTMLButtonElement);
    const historyPanel = requiredElement(document, '#finance-history-panel', HTMLElement);
    const layout = requiredElement(document, '.finance-layout', HTMLElement);
    let historyCollapsed = false;
    function updateHistoryVisibility(hasTransactions: boolean) {
        historyToggle.hidden = !hasTransactions;
        historyPanel.hidden = !hasTransactions || historyCollapsed;
        layout.classList.toggle('is-history-collapsed', historyPanel.hidden);
        historyToggle.setAttribute('aria-expanded', String(!historyPanel.hidden));
        historyToggle.setAttribute('aria-label', historyPanel.hidden ? 'Expandir painel de recentes' : 'Recolher painel de recentes');
    }
    historyToggle.addEventListener('click', () => {
        historyCollapsed = !historyCollapsed;
        updateHistoryVisibility(true);
    }, {signal: scope.signal});

    const page = optionalElement(document, '.finance-page', HTMLElement);
    if (!page) return;
    const list = requiredElement(page, '.transfer-list', HTMLElement);
    const status = requiredElement(page, '.finance-status', HTMLElement);
    const more = requiredElement(page, '.transfer-more', HTMLButtonElement);
    const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
    let cursor: string | null = null, loading = false, refreshPending = false;
    async function get(url:string):Promise<unknown> {
        const response = await fetch(url, {credentials:'same-origin', cache:'no-store'});
        const data:unknown = await response.json();
        if (!response.ok) throw new Error(apiError(data, 'Não foi possível carregar suas finanças.'));
        return data;
    }
    function renderTransactions(data:FinanceHistory, append:boolean) {
        if (!append) list.replaceChildren();
        for (const item of data.transactions) {
            const row = document.createElement('li');row.className='transfer-row';
            const avatar=document.createElement('span');avatar.className='transfer-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=item.description.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR');row.dataset.kind=item.kind;
            const description=document.createElement('div');description.className='transfer-description';
            const title=document.createElement('span');title.textContent=item.description;title.title=item.description;
            const detail=document.createElement('small');detail.textContent=item.occurred_on.split('-').reverse().join('/') + (item.category ? ' · ' + item.category : '');
            description.append(title,detail);
            const values=document.createElement('div');values.className='transfer-values';
            const amount=document.createElement('span');amount.textContent=(item.kind==='expense'?'−':'+')+money.format(Number(item.amount));
            const kind=document.createElement('span');kind.className='transfer-change transfer-change--'+item.kind;kind.textContent=item.kind==='expense'?'Despesa':'Receita';values.append(amount,kind);
            row.append(avatar,description,values);list.append(row);
        }
        updateHistoryVisibility(list.children.length > 0);
        cursor=data.next_cursor;more.hidden=!cursor;
        status.textContent=list.children.length?'':'Nenhuma transação registrada.';
    }
    async function load(append=false, animate=false) {
        if (loading) { if (animate) refreshPending = true; return; }
        loading=true;more.disabled=true;present(page).setAttribute('aria-busy','true');
        try {
            if (append) renderTransactions(financeHistoryData(await get('/api/finance/transactions?before='+encodeURIComponent(cursor ?? ''))),true);
            else {
                const history=await get('/api/finance/transactions');
                if (!scope.active) return;
                renderTransactions(financeHistoryData(history),false);
            }
        } catch(error) {
            if (!scope.active) return;
            status.textContent=errorMessage(error);
        } finally {loading=false;more.disabled=false;present(page).setAttribute('aria-busy','false');if(refreshPending && scope.active){refreshPending=false;load(false,true);}}
    }
    more.addEventListener('click',()=>load(true), {signal: scope.signal});
    scope.listen(window,'finance:changed',()=>load(false,true));
    scope.listen(window,'online',()=>load());
    load();
}
