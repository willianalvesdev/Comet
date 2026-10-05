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
    let model: {currency:string;demo:boolean;kind?:string;asOf?:string;points:ChartPoint[];intraday:ChartPoint[]} = { currency: "BRL", demo: true, points: [], intraday: [] };
    let selectedRange = "6M";
    let selectedStyle = "line";
    let visiblePoints: ChartPoint[] = [];
    let zeroChart = false;
    let byTime = new Map<number,ChartPoint>();
    let baseline: import('lightweight-charts').IPriceLine | null = null;
    let keyboardIndex = -1;
    const day = 86400;
    const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const shortTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
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
        leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: .17, bottom: .2 }, minimumWidth: 60 },
        rightPriceScale: { visible: false },
        timeScale: { allowBoldLabels: false, borderColor: colors.border, rightOffset: 0, lockVisibleTimeRangeOnResize: true, fixLeftEdge: true, fixRightEdge: true },
        crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: colors["text-secondary"], labelVisible: false, style: LineStyle.Dashed },
            horzLine: { color: colors["text-secondary"], labelVisible: false, style: LineStyle.Dashed }
        },
        localization: { locale: "pt-BR", dateFormat: "dd MMM yyyy" },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
    });
    const toolbar = requiredElement(document, ".chart-toolbar", HTMLElement);
    const plot = requiredElement(document, ".chart-plot", HTMLElement);
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
    function renderSheet() {
        const fragment = document.createDocumentFragment();
        const points = model.points.length || model.intraday.length ? visiblePoints : [];
        for (const point of [...points].reverse()) {
            const row = document.createElement('tr');
            const date = document.createElement('th'); date.scope = 'row';
            date.textContent = shortDate.format(point.time * 1000) +
                (['1D', '5D'].includes(selectedRange) && model.intraday.length ? ' · ' + shortTime.format(point.time * 1000) : '');
            row.append(date);
            for (const value of [point.open, point.high, point.low, point.close, point.close - point.open, point.volume]) {
                const cell = document.createElement('td'); cell.textContent = money.format(value); row.append(cell);
            }
            fragment.append(row);
        }
        sheetBody.replaceChildren(fragment);
        requiredElement(sheet, '.finance-sheet-empty', HTMLElement).hidden = points.length > 0;
    }
    function reserveToolbarSpace() {
        if (!present(host).clientHeight) return;
        const toolbarHeight = toolbar.getBoundingClientRect().height;
        const paneHeight = Math.max(1, present(host).clientHeight - chart.timeScale().height());
        const availableHeight = Math.max(0, paneHeight - toolbarHeight);
        chart.priceScale("left").applyOptions({
            scaleMargins: { top: Math.min(.7, (toolbarHeight + availableHeight * .17) / paneHeight), bottom: .2 }
        });
        plot.style.setProperty("--chart-toolbar-height", toolbarHeight + "px");
        plot.style.setProperty("--price-axis-width", chart.priceScale("left").width() + "px");
    }
    const plotObserver = new ResizeObserver(reserveToolbarSpace);
    plotObserver.observe(toolbar);
    plotObserver.observe(host);

    const common = { priceScaleId: "left", priceLineVisible: false, lastValueVisible: false };
    const line = chart.addSeries(BaselineSeries, {
        ...common, lineWidth: 2, lineType: LineType.Curved,
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
    volume.priceScale().applyOptions({ scaleMargins: { top: .89, bottom: 0 } });

    scope.listen(host, 'wheel', event => {
        if (!event.deltaY) return;
        chart.priceScale('left').applyOptions({autoScale:false});
        volume.priceScale().applyOptions({autoScale:false});
    }, {capture:true, passive:true});

    function normalize(points: ChartPoint[]) {
        if (!Array.isArray(points)) throw new TypeError("Os pontos devem ser uma lista.");
        const unique = new Map<number,ChartPoint>();
        for (const point of points) {
            if (!(["time", "open", "high", "low", "close", "volume"] satisfies (keyof ChartPoint)[]).every((key) => Number.isFinite(point[key])) ||
                !Number.isInteger(point.time) || point.time < 0 || point.volume < 0 ||
                point.low > Math.min(point.open, point.close) || point.high < Math.max(point.open, point.close)) {
                throw new TypeError("Ponto inválido: informe time em segundos UTC, valores OHLC e volume.");
            }
            unique.set(point.time, { ...point });
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
        periodElement.textContent = shortDate.format(visiblePoints[0].time * 1000) + " — " + shortDate.format(point.time * 1000) +
            (selectedRange === "1D" || selectedRange === "5D" ? ", " + shortTime.format(point.time * 1000) + " UTC" : "");
    }
    function hideTooltip() {
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
        const first = visiblePoints[0], last = visiblePoints[visiblePoints.length - 1];
        let high = first?.high ?? 0, low = first?.low ?? 0, volumeCents = 0;
        for (const point of visiblePoints) {
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
        chart.priceScale('left').applyOptions({autoScale:true});
        volume.priceScale().applyOptions({autoScale:true});
        const useIntraday = ["1D", "5D"].includes(selectedRange) && model.intraday.length;
        const source = useIntraday ? model.intraday : model.points;
        const latest = source[source.length - 1];
        visiblePoints = latest ? source.filter((point) => point.time >= rangeStart(latest.time)) : [];
        if (!source.length && model.kind === 'balance') {
            const end = Math.floor(Date.parse(model.asOf || new Date().toISOString().slice(0, 10)) / 1000);
            const start = rangeStart(end);
            visiblePoints = [Number.isFinite(start) && start < end ? start : end - day, end]
                .map(time => ({ time:chartTimestamp(time), open: 0, high: 0, low: 0, close: 0, volume: 0 }));
        }
        updateStatistics();
        renderSheet();
        zeroChart = visiblePoints.length > 0 && visiblePoints.every(point =>
            point.open === 0 && point.high === 0 && point.low === 0 && point.close === 0);
        colorLine();
        byTime = new Map(visiblePoints.map((point) => [point.time, point]));
        ranges.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.range === selectedRange)));
        keyboardIndex = visiblePoints.length - 1;
        if (baseline) {
            line.removePriceLine(baseline);
            baseline = null;
        }
        line.setData(visiblePoints.map((point) => ({ time: point.time, value: point.close })));
        candles.setData(visiblePoints.map(({ volume: ignored, ...point }) => point));
        volume.setData(visiblePoints.map((point) => point.volume === 0 ? { time: point.time } : {
            time: point.time, value: point.volume, color: (point.close >= point.open ? present(colors.green) : present(colors.red)).replace(/,\s*[\d.]+\)$/, ",0.8)")
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
        chart.applyOptions({ timeScale: { timeVisible: Boolean(useIntraday), secondsVisible: false } });
        chart.timeScale().fitContent();
        setStyle();
        description.textContent = "Gráfico de valores e volume com " + visiblePoints.length + " pontos. " +
            periodElement.textContent + ". Valor final: " + money.format(visiblePoints[visiblePoints.length - 1].close) +
            ". Use as setas do teclado para consultar os pontos.";
    }
    chart.subscribeCrosshairMove((param) => {
        const point = byTime.get(typeof param.time === 'number' ? param.time : NaN);
        if (!point || !param.point || param.point.x < 0 || param.point.y < toolbar.getBoundingClientRect().height ||
            param.point.x > host.clientWidth || param.point.y > host.clientHeight) {
            hideTooltip();
            return;
        }
        showSummary(point);
        requiredElement(tooltip, "time", HTMLElement).textContent = shortDate.format(point.time * 1000) +
            (["1D", "5D"].includes(selectedRange) ? " · " + shortTime.format(point.time * 1000) : "");
        requiredElement(tooltip, "strong", HTMLElement).textContent = money.format(point.close);
        requiredElement(tooltip, "small", HTMLElement).textContent = "Volume: " + quantity.format(point.volume);
        tooltip.hidden = false;
        tooltip.style.left = Math.max(8, Math.min(param.point.x + 24, host.clientWidth - tooltip.offsetWidth - 8)) + "px";
        tooltip.style.top = Math.max(toolbar.getBoundingClientRect().height + 4, Math.min(param.point.y - tooltip.offsetHeight - 12, host.clientHeight - tooltip.offsetHeight - 8)) + "px";
    });
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
        chart.setCrosshairPosition(point.close, point.time, selectedStyle === "line" ? line : candles);
        showSummary(point);
        description.textContent = shortDate.format(point.time * 1000) + ": " + money.format(point.close);
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
            points: normalize(data.points), intraday: normalize(data.intraday || [])
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

