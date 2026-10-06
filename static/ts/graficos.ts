window.WorkspaceNavigation.page('/static/js/graficos.js', ({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}) => {
    const host = optionalElement(document, "#market-chart", HTMLElement);
    const stateMessage = requiredElement(document, "#chart-state", HTMLElement);
    if (!host) return;
    const library = window.LightweightCharts;
    if (!library) {
        stateMessage.textContent = "Não foi possível carregar o gráfico. Atualize a página para tentar novamente.";
        return;
    }
    const { createChart, BaselineSeries, CandlestickSeries, HistogramSeries, LineStyle, LineType, CrosshairMode } = library;
    const priceElement = requiredElement(document, "#market-price", HTMLElement);
    const changeElement = requiredElement(document, "#market-change", HTMLElement);
    const periodElement = requiredElement(document, "#market-period", HTMLElement);
    const tooltip = requiredElement(document, "#chart-tooltip", HTMLElement);
    const description = requiredElement(document, "#chart-description", HTMLElement);
    const ranges = [...elementList(document, "[data-range]", HTMLElement)];
    const styles = [...elementList(document, "[data-chart-style]", HTMLElement)];
    let model: {currency:string;demo:boolean;kind?:string;asOf?:string;points:ChartPoint[];intraday:ChartPoint[];movements:ChartPoint[]} = { currency: "BRL", demo: true, points: [], intraday: [], movements: [] };
    let selectedRange = "6M";
    let selectedStyle = "line";
    let visiblePoints: ChartPoint[] = [];
    let periodPoints: ChartPoint[] = [];
    let usingMovements = false;
    let periodPriceRange: {minValue: number; maxValue: number} | null = null;
    let zeroChart = false;
    let baseline: import('lightweight-charts').IPriceLine | null = null;
    let keyboardIndex = -1;
    const day = 86400;
    const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const shortTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
    const axisDate = new Intl.DateTimeFormat('pt-BR', {day:'numeric',month:'short',timeZone:'UTC'});
    function pointDay(point: ChartPoint) { return point.occurred_on ? Date.parse(point.occurred_on + 'T00:00:00Z') : Math.floor(point.time / day) * day * 1000; }
    function pointDate(point: ChartPoint) { return shortDate.format(pointDay(point)); }
    function pointClock(point: ChartPoint) { const clock = point.occurred_time ?? ''; return clock.endsWith(':00') ? clock.slice(0,5) : clock; }
    function movementTick(time: import('lightweight-charts').Time) {
        if (!usingMovements) return null;
        const index = Number(time) - 1, point = visiblePoints[index], previous = visiblePoints[index - 1];
        if (!point) return '';
        const clock = pointClock(point);
        if (!previous || pointDay(point) !== pointDay(previous)) return axisDate.format(pointDay(point)) + (clock ? ' · ' + clock : '');
        return clock !== pointClock(previous) ? clock : '';
    }
    let money: Intl.NumberFormat;
    let priceFormat: import('lightweight-charts').PriceFormatCustom;
    let colors: Record<string,string>;

    function cssColor(name: string) {
        const probe = document.createElement("span");
        probe.style.color = "var(" + name + ")";
        probe.style.display = "none";
        scope.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        present(context).fillStyle = color;
        present(context).fillRect(0, 0, 1, 1);
        const [r, g, b, a] = present(context).getImageData(0, 0, 1, 1).data;
        return "rgba(" + [r, g, b, a / 255].join(",") + ")";
    }
    function readColors() {
        return Object.fromEntries(["surface", "border", "text-secondary", "green", "red"].map((name) => [name, cssColor("--" + name)]));
    }
    function fills() {
        const alpha = (color: string, opacity: number) => color.replace(/,[^,]+\)$/, ',' + opacity + ')');
        return {
            topFillColor1: alpha(colors.green, .20), topFillColor2: alpha(colors.green, .02),
            bottomFillColor1: alpha(colors.red, .02), bottomFillColor2: alpha(colors.red, .20)
        };
    }
    colors = readColors();
    const chart = createChart(host, {
        autoSize: true,
        layout: {
            background: { type: library.ColorType.Solid, color: colors.surface },
            textColor: colors["text-secondary"],
            fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-numbers").trim(),
            fontSize: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--font-size-5")),
            attributionLogo: false
        },
        grid: {
            vertLines: { color: colors.border },
            horzLines: { color: colors.border }
        },
        leftPriceScale: { visible: true, borderVisible: false, entireTextOnly: true, scaleMargins: { top: .17, bottom: .2 }, minimumWidth: 60 },
        rightPriceScale: { visible: false },
        timeScale: { allowBoldLabels: false, borderColor: colors.border, rightOffset: 0, lockVisibleTimeRangeOnResize: true, fixLeftEdge: true, fixRightEdge: true,
            tickMarkFormatter: movementTick },
        crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { visible: false, color: colors["text-secondary"], labelVisible: false, style: LineStyle.Dashed },
            horzLine: { visible: false, color: colors["text-secondary"], labelVisible: false, style: LineStyle.Dashed }
        },
        localization: { locale: "pt-BR", dateFormat: "dd MMM yyyy" },
        handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: {time: true, price: false} }
    });
    const toolbar = requiredElement(document, ".chart-toolbar", HTMLElement);
    const plot = requiredElement(document, ".chart-plot", HTMLElement);
    const hoverLine = document.createElement('span');
    hoverLine.className = 'chart-hover-line'; hoverLine.hidden = true; hoverLine.setAttribute('aria-hidden', 'true');
    plot.append(hoverLine);
    const sheet = requiredElement(document, '.finance-sheet', HTMLElement);
    const sheetBody = requiredElement(sheet, 'tbody', HTMLTableSectionElement);
    const viewButtons = elementList(document, '[data-finance-view]', HTMLButtonElement);
    viewButtons.forEach(button => button.addEventListener('click', () => {
        const showingSheet = button.dataset.financeView === 'sheet';
        requiredElement(document, '.market-card', HTMLElement).classList.toggle('is-sheet-view', showingSheet);
        sheet.hidden = !showingSheet;
        requiredElement(document, '.chart-stage', HTMLElement).hidden = showingSheet;
        viewButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        chart.clearCrosshairPosition(); hideTooltip();
        if (!showingSheet) requestAnimationFrame(reserveToolbarSpace);
    }));
    let sheetPage = 0;
    const sheetPageSize = 10;
    const pageButtons = elementList(document, '[data-sheet-page]', HTMLButtonElement);
    pageButtons.forEach(button => button.addEventListener('click', () => {
        sheetPage = button.dataset.sheetPage === 'first' ? 0 : sheetPage + (button.dataset.sheetPage === 'next' ? 1 : -1);
        renderSheet(); sheet.scrollTop = 0;
    }));
    function renderSheet() {
        const fragment = document.createDocumentFragment();
        const points = periodPoints;
        const pages = Math.max(1, Math.ceil(points.length / sheetPageSize));
        sheetPage = Math.max(0, Math.min(sheetPage, pages - 1));
        requiredElement(document, '.finance-sheet-page-label', HTMLElement).textContent = `Página ${sheetPage + 1} de ${pages}`;
        pageButtons.forEach(button => { button.disabled = button.dataset.sheetPage === 'next' ? sheetPage === pages - 1 : sheetPage === 0; });
        for (const point of [...points].reverse().slice(sheetPage * sheetPageSize, (sheetPage + 1) * sheetPageSize)) {
            const row = document.createElement('tr');
            const date = document.createElement('th'); date.scope = 'row';
            date.textContent = new Date(point.time * 1000).toLocaleDateString('pt-BR', {timeZone:'UTC'}) +
                (['1D', '5D'].includes(selectedRange) && model.intraday.length ? ' · ' + shortTime.format(point.time * 1000) : '');
            row.append(date);
            for (const value of [point.open, point.high, point.low, point.close, point.close - point.open, point.volume]) {
                const cell = document.createElement('td'); cell.textContent = money.format(value).replace(/\u00a0/g, ' '); row.append(cell);
            }
            fragment.append(row);
        }
        sheetBody.replaceChildren(fragment);
        requiredElement(sheet, '.finance-sheet-empty', HTMLElement).hidden = points.length > 0;
    }
    function reserveToolbarSpace() {
        const toolbarHeight = toolbar.getBoundingClientRect().height;
        plot.style.setProperty("--chart-toolbar-height", toolbarHeight + "px");
        if (!present(host).clientHeight) return;
        const paneHeight = Math.max(1, present(host).clientHeight - chart.timeScale().height());
        const availableHeight = Math.max(0, paneHeight - toolbarHeight);
        chart.priceScale("left").applyOptions({
            scaleMargins: { top: Math.min(.7, (toolbarHeight + availableHeight * .17) / paneHeight), bottom: .2 }
        });
    }
    const plotObserver = new ResizeObserver(reserveToolbarSpace);
    plotObserver.observe(toolbar);
    plotObserver.observe(host);

    const autoscaleInfoProvider: import('lightweight-charts').AutoscaleInfoProvider = () =>
        periodPriceRange ? {priceRange:{...periodPriceRange}} : null;
    const common = { priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider };
    const line = chart.addSeries(BaselineSeries, {
        ...common, lineWidth: 2, lineType: LineType.Simple, crosshairMarkerVisible: false,
        topLineColor: colors.green, bottomLineColor: colors.red,
        ...fills(),

    });
    const candles = chart.addSeries(CandlestickSeries, {
        ...common, visible: false, borderVisible: false,
        upColor: colors.green, downColor: colors.red, wickUpColor: colors.green, wickDownColor: colors.red
    });
    const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "",
        priceLineVisible: false, lastValueVisible: false
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: .95, bottom: 0 } });

    // Movement positions are ordinal: their real dates stay on the points, never synthetic clock times.
    function plotTime(index: number) { return usingMovements ? chartTimestamp(index + 1) : visiblePoints[index].time; }
    interface HoverSample { x: number; time: number; value: number; point: ChartPoint; index: number }
    let selection: {pointer: number | null; start: HoverSample; end: HoverSample} | null = null;
    const selectionBand = document.createElement('span');
    selectionBand.className = 'chart-selection-band'; selectionBand.hidden = true; selectionBand.setAttribute('aria-hidden', 'true');
    plot.append(selectionBand);
    const selectionResult = document.createElement('div');
    selectionResult.className = 'chart-selection-result'; selectionResult.hidden = true; selectionResult.setAttribute('role', 'status');
    tooltip.append(selectionResult);
    function clearSelection() {
        const pointer = selection?.pointer;
        selection = null;
        if (pointer != null && present(host).hasPointerCapture(pointer)) present(host).releasePointerCapture(pointer);
        selectionBand.hidden = true; selectionResult.hidden = true;
        hoverLine.style.removeProperty('border-color');
    }
    function sampleAt(x: number): HoverSample | null {
        const first = visiblePoints[0], last = visiblePoints[visiblePoints.length - 1];
        if (!first || !last) return null;
        const axisWidth = chart.priceScale('left').width();
        const firstX = chart.timeScale().timeToCoordinate(plotTime(0));
        const lastX = chart.timeScale().timeToCoordinate(plotTime(visiblePoints.length - 1));
        if (firstX === null || lastX === null) return null;
        const spacing = visiblePoints.length > 1 ? (lastX - firstX) / (visiblePoints.length - 1) : 0;
        const logical = Math.max(0, Math.min(visiblePoints.length - 1, spacing > 0 ? (x - axisWidth - firstX) / spacing : 0));
        const index = usingMovements ? Math.round(logical) : Math.floor(logical);
        const point = visiblePoints[index], next = visiblePoints[Math.min(index + 1, visiblePoints.length - 1)];
        const time = usingMovements ? point.time : Math.floor((point.time + (next.time - point.time) * (logical - index)) / 60) * 60;
        return {x: Math.max(axisWidth, Math.min(x, present(host).clientWidth)), time, value: point.close, point, index};
    }
    scope.listen(host, 'pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        const bounds = present(host).getBoundingClientRect();
        const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
        if (x < chart.priceScale('left').width() || y < toolbar.getBoundingClientRect().height ||
            y >= bounds.height - chart.timeScale().height()) return;
        const start = sampleAt(x); if (!start) return;
        clearSelection();
        selection = {pointer: event.pointerId, start, end: start};
        present(host).setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    scope.listen(host, 'pointerup', event => {
        if (selection?.pointer !== event.pointerId) return;
        selection.pointer = null;
        if (present(host).hasPointerCapture(event.pointerId)) present(host).releasePointerCapture(event.pointerId);
    });
    scope.listen(host, 'pointercancel', clearSelection);
    scope.listen(host, 'lostpointercapture', () => { if (selection?.pointer != null) clearSelection(); });
    scope.listen(host, 'wheel', () => { clearSelection(); hideTooltip(); }, {capture:true, passive:true});

    function normalize(points: ChartPoint[], keepSameDate = false) {
        if (!Array.isArray(points)) throw new TypeError("Os pontos devem ser uma lista.");
        const unique = new Map<number,ChartPoint>();
        for (const point of points) {
            if (!(["time", "open", "high", "low", "close", "volume"] satisfies (keyof ChartPoint)[]).every((key) => Number.isFinite(point[key])) ||
                !Number.isInteger(point.time) || point.time < 0 || point.volume < 0 ||
                point.low > Math.min(point.open, point.close) || point.high < Math.max(point.open, point.close)) {
                throw new TypeError("Ponto inválido: informe time em segundos UTC, valores OHLC e volume.");
            }
            unique.set(keepSameDate ? unique.size : point.time, { ...point });
        }
        return [...unique.values()].sort((a, b) => a.time - b.time);
    }
    function shiftMonths(date: Date, months: number) {
        const targetDay = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + months);
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
        date.setUTCDate(Math.min(targetDay, lastDay));
    }
    function rangeStart(end: number) {
        const date = new Date(end * 1000);
        switch (selectedRange) {
            case "1D": return end - day;
            case "5D": return end - 5 * day;
            case "1M": shiftMonths(date, -1); break;
            case "6M": shiftMonths(date, -6); break;
            case "YTD": date.setUTCMonth(0, 1); date.setUTCHours(0, 0, 0, 0); break;
            case "1Y": shiftMonths(date, -12); break;
            case "5Y": shiftMonths(date, -60); break;
            default: return -Infinity;
        }
        return date.getTime() / 1000;
    }
    let summaryShown = false, animatePeriod = false, summaryKey = '', summaryTimer = 0;
    function rollNumber(element: HTMLElement, text: string) {
        const previous = (element.dataset.number || element.textContent).replace(/\D/g, '').split('');
        const digits = text.replace(/\D/g, '').length;
        let position = 0;
        element.dataset.number = text;
        element.classList.add('market-number');
        element.setAttribute('aria-label', text);
        element.replaceChildren(...Array.from(text, character => {
            const slot = document.createElement('span');
            slot.setAttribute('aria-hidden', 'true');
            if (!/\d/.test(character)) { slot.textContent = character; return slot; }
            const start = Number(previous[previous.length - digits + position++] || 0);
            if (start === Number(character)) { slot.textContent = character; return slot; }
            slot.className = 'market-digit';
            const reel = document.createElement('span');
            const value = Number(character);
            const upwardSteps = (value - start + 10) % 10;
            const downward = upwardSteps > 5;
            const steps = downward ? 10 - upwardSteps : upwardSteps;
            for (let index = 0; index <= steps; index++) {
                const digit = document.createElement('span');digit.textContent = String(downward ? (value + index) % 10 : (start + index) % 10);reel.append(digit);
            }
            slot.append(reel);
            const frames = [{transform:'translateY(0)'},{transform:`translateY(-${steps * 1.5}em)`}];
            const animation = reel.animate(downward ? frames.reverse() : frames, {duration:850,easing:'cubic-bezier(.15,.7,.2,1)',fill:'forwards'});
            animation.onfinish = () => { slot.textContent = character; animation.cancel(); };
            return slot;
        }));
    }
    const amountElement = document.createElement('span');
    const percentageGroup = document.createElement('span');
    percentageGroup.className = 'market-change__percentage';
    const percentageArrow = document.createElement('i');
    percentageArrow.setAttribute('aria-hidden', 'true');
    percentageArrow.className = 'market-direction';
    percentageArrow.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12"/><path class="market-direction__head" d="m9 3 5 5-5 5"/></svg>';
    const percentageElement = document.createElement('span');
    percentageGroup.append(percentageArrow, percentageElement);
    changeElement.append(amountElement, percentageGroup);
    function showSummary(point: ChartPoint | undefined) {
        if (!point || !visiblePoints.length) return;
        const first = model.kind === 'balance' ? visiblePoints[0].open : visiblePoints[0].close;
        const delta = point.close - first;
        const percentage = first === 0 ? (delta === 0 ? 0 : null) : delta / Math.abs(first) * 100;
        const sign = delta === 0 ? "" : delta > 0 ? "+" : "−";
        const key = [point.time, point.close, first].join(':');
        if (key === summaryKey) return;
        summaryKey = key;
        clearTimeout(summaryTimer);
        if (!amountElement.isConnected) changeElement.replaceChildren(amountElement, percentageGroup);
        percentageGroup.hidden = percentage === null;
        const amount = sign + money.format(Math.abs(delta));
        const percent = percentage === null ? '' : quantity.format(Math.abs(percentage)) + '%';
        function finish(animate: boolean) {
            changeElement.dataset.trend = delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down';
            changeElement.classList.remove('is-starting');
            for (const [element, text] of ([[priceElement, money.format(present(point).close)], [amountElement, amount], [percentageElement, percent]] satisfies [HTMLElement,string][])) {
                if (animate) rollNumber(element, text);
                else { element.dataset.number = text; element.textContent = text; element.setAttribute('aria-label', text); }
            }
        }
        if (!summaryShown && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            priceElement.textContent = money.format(0);
            changeElement.dataset.trend = 'neutral';
            changeElement.classList.add('is-starting');
            amountElement.textContent = money.format(0);
            percentageElement.textContent = quantity.format(0) + '%';
            summaryTimer = setTimeout(() => finish(true), 350);
        } else finish(animatePeriod && !matchMedia('(prefers-reduced-motion: reduce)').matches);
        animatePeriod = false;
        summaryShown = true;
        periodElement.textContent = pointDate(visiblePoints[0]) + " — " + pointDate(point) +
            (!usingMovements && (selectedRange === "1D" || selectedRange === "5D") ? ", " + shortTime.format(point.time * 1000) + " UTC" : "");
    }
    function hideTooltip() {
        clearSelection();
        hoverLine.hidden = true;
        tooltip.hidden = true;
        showSummary(visiblePoints[visiblePoints.length - 1]);
    }
    function colorLine() {
        line.applyOptions(zeroChart ? {
            topLineColor: colors["text-secondary"], bottomLineColor: colors["text-secondary"],
            topFillColor1: 'transparent', topFillColor2: 'transparent',
            bottomFillColor1: 'transparent', bottomFillColor2: 'transparent'
        } : { topLineColor: colors.green, bottomLineColor: colors.red, ...fills() });
    }
    function setStyle() {
        line.applyOptions({ visible: zeroChart || selectedStyle === "line" });
        candles.applyOptions({ visible: !zeroChart && selectedStyle === "candles" });
        styles.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.chartStyle === selectedStyle)));
        hideTooltip();
    }
    function updateStatistics() {
        const first = periodPoints[0], last = periodPoints[periodPoints.length - 1];
        let high = first?.high ?? 0, low = first?.low ?? 0, volumeCents = 0;
        for (const point of periodPoints) {
            high = Math.max(high, point.high); low = Math.min(low, point.low);
            volumeCents += Math.round(point.volume * 100);
        }
        const opening = first?.open ?? 0, closing = last?.close ?? 0;
        const stats = {opening, closing, change: closing - opening, high, low, volume: volumeCents / 100};
        for (const [key, value] of Object.entries(stats)) {
            requiredElement(document, `[data-chart-stat="${key}"]`, HTMLElement).textContent = money.format(value);
        }
    }
    toolbar.addEventListener('pointerenter', () => { chart.clearCrosshairPosition(); hideTooltip(); });
    function setRange() {
        sheetPage = 0;
        chart.priceScale('left').applyOptions({autoScale:true});
        volume.priceScale().applyOptions({autoScale:true});
        const useIntraday = ["1D", "5D"].includes(selectedRange) && model.intraday.length;
        const source = useIntraday ? model.intraday : model.points;
        const latest = source[source.length - 1];
        const start = latest ? rangeStart(latest.time) : -Infinity;
        periodPoints = source.filter(point => point.time >= start);
        const movements = model.movements.filter(point => pointDay(point) / 1000 >= start);
        usingMovements = movements.length > 0;
        const first = movements[0];
        visiblePoints = usingMovements ? [{...first, high:first.open, low:first.open, close:first.open, volume:0}, ...movements] : periodPoints;
        if (!source.length && model.kind === 'balance') {
            const end = Math.floor(Date.parse(model.asOf || new Date().toISOString().slice(0, 10)) / 1000);
            const start = rangeStart(end);
            visiblePoints = [Number.isFinite(start) && start < end ? start : end - day, end]
                .map(time => ({ time:chartTimestamp(time), open: 0, high: 0, low: 0, close: 0, volume: 0 }));
        }
        periodPriceRange = null;
        if (visiblePoints.length) {
            let low = visiblePoints[0].low, high = visiblePoints[0].high;
            for (const point of visiblePoints) { low = Math.min(low,point.low); high = Math.max(high,point.high); }
            const center = (low + high) / 2, span = Math.max(high - low, 1, Math.abs(center) * .02);
            periodPriceRange = {minValue:center - span / 2, maxValue:center + span / 2};
        }
        updateStatistics();
        renderSheet();
        zeroChart = visiblePoints.length > 0 && visiblePoints.every(point =>
            point.open === 0 && point.high === 0 && point.low === 0 && point.close === 0);
        colorLine();
        ranges.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.range === selectedRange)));
        keyboardIndex = visiblePoints.length - 1;
        if (baseline) {
            line.removePriceLine(baseline);
            baseline = null;
        }
        line.setData(visiblePoints.map((point, index) => ({ time: plotTime(index), value: point.close })));
        candles.setData(visiblePoints.map(({ volume: ignored, ...point }, index) => ({...point, time:plotTime(index)})));
        volume.setData(visiblePoints.map((point, index) => point.volume === 0 ? { time: plotTime(index) } : {
            time: plotTime(index), value: point.volume, color: (point.close >= point.open ? present(colors.green) : present(colors.red)).replace(/,\s*[\d.]+\)$/, ",0.8)")
        }));
        stateMessage.hidden = visiblePoints.length > 0;
        if (!visiblePoints.length) {
            clearTimeout(summaryTimer);
            summaryKey = '';
            stateMessage.textContent = "Ainda não há dados para este período.";
            priceElement.textContent = "—";
            delete priceElement.dataset.number;
            changeElement.textContent = "";
            periodElement.textContent = "";
            description.textContent = "Sem dados disponíveis.";
            tooltip.hidden = true;
            return;
        }
        line.applyOptions({ baseValue: { type: "price", price: model.kind === 'balance' ? visiblePoints[0].open : visiblePoints[0].close } });
        baseline = line.createPriceLine({
            price: model.kind === 'balance' ? visiblePoints[0].open : visiblePoints[0].close, color: colors["text-secondary"],
            lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false
        });
        chart.applyOptions({ timeScale: { timeVisible: usingMovements || Boolean(useIntraday), secondsVisible: usingMovements } });
        chart.timeScale().fitContent();
        setStyle();
        description.textContent = "Gráfico de valores e volume com " + visiblePoints.length + " pontos. " +
            periodElement.textContent + ". Valor final: " + money.format(visiblePoints[visiblePoints.length - 1].close) +
            ". Use as setas do teclado para consultar os pontos.";
    }
    host.addEventListener('pointermove', event => {
        const bounds = host.getBoundingClientRect();
        const axisWidth = chart.priceScale('left').width();
        const toolbarHeight = toolbar.getBoundingClientRect().height;
        const paneBottom = host.clientHeight - chart.timeScale().height();
        const dragging = selection?.pointer === event.pointerId;
        if (selection && !dragging) clearSelection();
        const x = dragging ? Math.max(axisWidth, Math.min(event.clientX - bounds.left, host.clientWidth)) : event.clientX - bounds.left;
        const y = dragging ? Math.max(toolbarHeight, Math.min(event.clientY - bounds.top, paneBottom)) : event.clientY - bounds.top;
        const sample = sampleAt(x);
        if (!sample || x < axisWidth || y < toolbarHeight || y > paneBottom) { hideTooltip(); return; }
        const {point, time} = sample;
        showSummary(point);
        requiredElement(tooltip, 'time', HTMLElement).textContent = (usingMovements ? pointDate(point) : shortDate.format(time * 1000)) + ' · ' +
            (usingMovements ? (sample.index ? pointClock(point) || 'Movimentação ' + sample.index : 'Saldo inicial') : shortTime.format(time * 1000) + ' UTC');
        for (const key of ['close', 'open', 'high', 'low', 'volume'] as const) {
            requiredElement(tooltip, `[data-tooltip-value="${key}"]`, HTMLElement).textContent = money.format(point[key]);
        }
        if (selection) {
            selection.end = sample;
            const [start, end] = selection.start.x <= sample.x ? [selection.start, sample] : [sample, selection.start];
            const startCents = Math.round(start.value * 100), difference = Math.round(end.value * 100) - startCents;
            const color = difference > 0 ? 'var(--green)' : difference < 0 ? 'var(--red)' : 'var(--text-secondary)';
            const percentage = startCents === 0 ? '' : ' (' + (difference > 0 ? '+' : '') + quantity.format(difference / Math.abs(startCents) * 100) + '%)';
            selectionResult.textContent = (difference > 0 ? 'Ganho: ' : difference < 0 ? 'Perda: ' : 'Sem variação: ') + money.format(Math.abs(difference) / 100) + percentage;
            selectionResult.style.color = color; selectionResult.hidden = false;
            const dates = usingMovements ? pointDate(start.point) + (pointClock(start.point) ? ' · ' + pointClock(start.point) : '') + ' — ' + pointDate(end.point) + (pointClock(end.point) ? ' · ' + pointClock(end.point) : '') :
                shortDate.format(start.time * 1000) + ' · ' + shortTime.format(start.time * 1000) + ' — ' + shortDate.format(end.time * 1000) + ' · ' + shortTime.format(end.time * 1000) + ' UTC';
            selectionResult.title = dates;
            hoverLine.style.borderColor = color;
            selectionBand.style.color = color;
            selectionBand.style.left = Math.min(selection.start.x, x) + 'px';
            selectionBand.style.width = Math.abs(selection.start.x - x) + 'px';
            selectionBand.style.top = toolbarHeight + 'px';
            selectionBand.style.height = Math.max(0, paneBottom - toolbarHeight) + 'px';
            selectionBand.hidden = false;
        }
        tooltip.hidden = false; hoverLine.hidden = false;
        hoverLine.style.left = x + 'px'; hoverLine.style.top = toolbarHeight + 'px';
        hoverLine.style.height = Math.max(0, paneBottom - toolbarHeight) + 'px';
        tooltip.style.left = Math.max(axisWidth, Math.min(x + 16, host.clientWidth - tooltip.offsetWidth - 8)) + 'px';
        tooltip.style.top = Math.max(toolbarHeight + 4, Math.min(y + 16, host.clientHeight - tooltip.offsetHeight - 8)) + 'px';
    });
    host.addEventListener('pointerleave', () => { if (selection?.pointer == null) hideTooltip(); });
    ranges.forEach((button) => button.addEventListener("click", () => {
        if (selectedRange === button.dataset.range) return;
        selectedRange = button.dataset.range || selectedRange;
        animatePeriod = true;
        summaryKey = '';
        clearTimeout(summaryTimer);
        setRange();
    }));
    styles.forEach((button) => button.addEventListener("click", () => {
        selectedStyle = button.dataset.chartStyle || selectedStyle;
        setStyle();
    }));
    host.addEventListener("keydown", (event) => {
        if (!visiblePoints.length) return;
        if (event.key === "Escape") { chart.clearCrosshairPosition(); hideTooltip(); return; }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") keyboardIndex = 0;
        else if (event.key === "End") keyboardIndex = visiblePoints.length - 1;
        else keyboardIndex = Math.max(0, Math.min(visiblePoints.length - 1, keyboardIndex + (event.key === "ArrowLeft" ? -1 : 1)));
        const point = visiblePoints[keyboardIndex];
        chart.setCrosshairPosition(point.close, plotTime(keyboardIndex), selectedStyle === "line" ? line : candles);
        showSummary(point);
        description.textContent = pointDate(point) + (pointClock(point) ? ' · ' + pointClock(point) : '') + ": " + money.format(point.close);
    });
    host.addEventListener("blur", () => { chart.clearCrosshairPosition(); hideTooltip(); });

    new MutationObserver(() => {
        colors = readColors();
        chart.applyOptions({
            layout: { background: { type: library.ColorType.Solid, color: colors.surface }, textColor: colors["text-secondary"] },
            grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
            timeScale: { borderColor: colors.border },
            crosshair: { vertLine: { color: colors["text-secondary"] }, horzLine: { color: colors["text-secondary"] } }
        });
        colorLine();
        candles.applyOptions({ upColor: colors.green, downColor: colors.red, wickUpColor: colors.green, wickDownColor: colors.red });
        if (baseline) baseline.applyOptions({ color: colors["text-secondary"] });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    function setData(data: ChartData, animate = false) {
        animatePeriod = animate && summaryShown;
        const next = {
            kind: data.kind, asOf: data.as_of, currency: data.currency || "BRL", demo: data.demo === true,
            points: normalize(data.points), intraday: normalize(data.intraday || []), movements: normalize(data.movements || [], true)
        };
        const nextMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: next.currency });
        model = next;
        money = nextMoney;
        priceFormat = { type: "custom", minMove: .01, formatter: (value: number) => quantity.format(value) };
        line.applyOptions({ priceFormat });
        candles.applyOptions({ priceFormat });
        setRange();
        setStyle();
    }
    scope.cleanup(() => chart.remove());
    window.CometChart = Object.freeze({ setData, rollNumber });
    try {
        setData({ points: [], demo: false });
    } catch (error) {
        stateMessage.hidden = false;
        stateMessage.textContent = "Não foi possível exibir os dados do gráfico.";
        console.error(error);
    }
});

