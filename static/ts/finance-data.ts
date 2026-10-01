window.WorkspaceNavigation.page('/static/js/finance-data.js', ({scope, fetch}) => {
    const page = optionalElement(document, '.finance-page', HTMLElement);
    if (!page) return;
    const list = requiredElement(page, '.transfer-list', HTMLElement);
    const status = requiredElement(page, '.finance-status', HTMLElement);
    const more = requiredElement(page, '.transfer-more', HTMLButtonElement);
    const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
    const percent = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:2});
    let cursor: string | null = null, loading = false, refreshPending = false;
    async function get(url:string):Promise<unknown> {
        const response = await fetch(url, {credentials:'same-origin', cache:'no-store'});
        const data:unknown = await response.json();
        if (!response.ok) throw new Error(apiError(data, 'Não foi possível carregar suas finanças.'));
        return data;
    }
    function sparkline(card:Element, values:number[]) {
        if (!values.length) values = [0, 0];
        const low = Math.min(...values), high = Math.max(...values);
        const points = values.map((value, index) => `${index * 260 / Math.max(1, values.length - 1)} ${high === low ? 38 : 66 - (value - low) * 56 / (high - low)}`);
        if (points.length === 1) points.push('260 38');
        const path = points.length ? 'M' + points.join(' L') : '';
        requiredElement(card, '.finance-total__line', SVGPathElement).setAttribute('d', path);
        requiredElement(card, '.finance-total__area', SVGPathElement).setAttribute('d', path ? path + ' L260 76 L0 76 Z' : '');
    }
    function renderSummary(data:FinanceDashboard, animate:boolean) {
        for (const [key, value] of Object.entries(data.summary)) {
            const card = present(page).querySelector(`[data-finance-total="${key}"]`);
            const total = requiredElement(present(card), '.finance-total__values p', HTMLElement);
            if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) window.AscendaChart.rollNumber(total, money.format(Number(value.amount)));
            else { total.textContent = money.format(Number(value.amount)); total.dataset.number = total.textContent; }
            const change = requiredElement(present(card), '.finance-total__change', HTMLElement);
            change.replaceChildren();
            const difference = Number(value.difference);
            const zero = Number(value.amount) === 0 && difference === 0 && value.series.every(number => Number(number) === 0);
            present(card).classList.toggle('finance-total--zero', zero);
            if (value.percentage !== null) {
                const arrow = document.createElement('i');
                arrow.className = 'ui-arrow ' + (difference < 0 ? 'ui-arrow--down' : 'ui-arrow--up');
                arrow.setAttribute('aria-hidden','true');
                if (difference) change.append(arrow);
                change.append(document.createTextNode(percent.format(Math.abs(Number(value.percentage))) + '%'));
            } else change.textContent = zero ? '0%' : '—';
            change.title = value.percentage === null ? 'Sem base para comparação percentual' : 'Variação em relação ao mês anterior';
            requiredElement(present(card), '.finance-total__comparison', HTMLElement).textContent = (difference > 0 ? '+' : '') + money.format(Number(value.difference)) + ' vs. mês anterior';
            sparkline(present(card), value.series);
        }
        window.AscendaChart.setData({...data.chart, as_of: data.as_of}, animate);
    }
    function renderTransactions(data:FinanceHistory, append:boolean) {
        if (!append) list.replaceChildren();
        for (const item of data.transactions) {
            const row = document.createElement('li');row.className='transfer-row';
            const avatar=document.createElement('span');avatar.className='transfer-avatar';avatar.setAttribute('aria-hidden','true');
            const description=document.createElement('div');description.className='transfer-description';
            const title=document.createElement('span');title.textContent=item.description;
            const detail=document.createElement('small');detail.textContent=item.occurred_on.split('-').reverse().join('/') + (item.category ? ' · ' + item.category : '');
            description.append(title,detail);
            const values=document.createElement('div');values.className='transfer-values';
            const amount=document.createElement('span');amount.textContent=(item.kind==='expense'?'−':'+')+money.format(Number(item.amount));
            const kind=document.createElement('span');kind.className='transfer-change transfer-change--'+item.kind;kind.textContent=item.kind==='expense'?'Despesa':'Receita';values.append(amount,kind);
            row.append(avatar,description,values);list.append(row);
        }
        cursor=data.next_cursor;more.hidden=!cursor;
        status.textContent=list.children.length?'':'Nenhuma transação registrada.';
    }
    async function load(append=false, animate=false) {
        if (loading) { if (animate) refreshPending = true; return; }
        loading=true;more.disabled=true;present(page).setAttribute('aria-busy','true');
        try {
            if (append) renderTransactions(financeHistoryData(await get('/api/finance/transactions?before='+encodeURIComponent(cursor ?? ''))),true);
            else {
                const [summary, history]=await Promise.all([get('/api/finance/dashboard'),get('/api/finance/transactions')]);
                if (!scope.active) return;
                renderSummary(financeDashboardData(summary), animate);renderTransactions(financeHistoryData(history),false);
            }
        } catch(error) {
            if (!scope.active) return;
            status.textContent=errorMessage(error);
            if (!append) {
                elementList(present(page), '.finance-total__comparison', HTMLElement).forEach(element=>element.textContent='Dados indisponíveis');
                requiredElement(document, '#chart-state', HTMLElement).textContent='Não foi possível carregar os dados financeiros.';
                requiredElement(document, '#chart-state', HTMLElement).hidden=false;
            }
        } finally {loading=false;more.disabled=false;present(page).setAttribute('aria-busy','false');if(refreshPending && scope.active){refreshPending=false;load(false,true);}}
    }
    more.addEventListener('click',()=>load(true));
    scope.listen(window,'finance:changed',()=>load(false,true));
    scope.listen(window,'online',()=>load());
    load();
});
