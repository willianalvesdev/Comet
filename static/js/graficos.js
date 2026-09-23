(() => {
    "use strict";
    const host = document.querySelector("#market-chart");
    const stateMessage = document.querySelector("#chart-state");
    if (!host) return;
    const library = window.LightweightCharts;
    if (!library) {
        stateMessage.textContent = "Não foi possível carregar o gráfico. Atualize a página para tentar novamente.";
        return;
    }
    const { createChart, BaselineSeries, CandlestickSeries, HistogramSeries, LineStyle, LineType, CrosshairMode } = library;
    const priceElement = document.querySelector("#market-price");
    const changeElement = document.querySelector("#market-change");
    const periodElement = document.querySelector("#market-period");
    const tooltip = document.querySelector("#chart-tooltip");
    const description = document.querySelector("#chart-description");
    const ranges = [...document.querySelectorAll("[data-range]")];
    const styles = [...document.querySelectorAll("[data-chart-style]")];
    let model = { currency: "BRL", demo: true, points: [], intraday: [] };
    let selectedRange = "6M";
    let selectedStyle = "line";
    let visiblePoints = [];
    let byTime = new Map();
    let baseline = null;
    let keyboardIndex = -1;
    const day = 86400;
    const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const shortTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
    let money;
    let priceFormat;
    let colors;

    // Resolve CSS colors to RGBA, including alpha and color-mix() in the light theme.
    function cssColor(name) {
        const probe = document.createElement("span");
        probe.style.color = "var(" + name + ")";
        probe.style.display = "none";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return "rgba(" + [r, g, b, a / 255].join(",") + ")";
    }
    function readColors() {
        return Object.fromEntries(["surface", "border", "text-secondary", "green", "red"].map((name) => [name, cssColor("--" + name)]));
    }
    function fills() {
        const alpha = (color, opacity) => color.replace(/,[^,]+\)$/, ',' + opacity + ')');
        return {
            topFillColor1: alpha(colors.green, .20), topFillColor2: alpha(colors.green, .02),
            bottomFillColor1: alpha(colors.red, .02), bottomFillColor2: alpha(colors.red, .20)
        };
    }
    colors = readColors();
    const chart = createChart(host, {
        autoSize: true,
        layout: {
            background: { type: "solid", color: colors.surface },
            textColor: colors["text-secondary"],
            fontFamily: getComputedStyle(document.body).fontFamily,
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
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true }
    });
    const toolbar = document.querySelector(".chart-toolbar");
    const plot = document.querySelector(".chart-plot");
    function reserveToolbarSpace() {
        const toolbarHeight = toolbar.getBoundingClientRect().height;
        const paneHeight = Math.max(1, host.clientHeight - chart.timeScale().height());
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

    function normalize(points) {
        if (!Array.isArray(points)) throw new TypeError("Os pontos devem ser uma lista.");
        const unique = new Map();
        for (const point of points) {
            if (!["time", "open", "high", "low", "close", "volume"].every((key) => Number.isFinite(point[key])) ||
                !Number.isInteger(point.time) || point.time < 0 || point.volume < 0 ||
                point.low > Math.min(point.open, point.close) || point.high < Math.max(point.open, point.close)) {
                throw new TypeError("Ponto inválido: informe time em segundos UTC, valores OHLC e volume.");
            }
            unique.set(point.time, { ...point });
        }
        return [...unique.values()].sort((a, b) => a.time - b.time);
    }
    function shiftMonths(date, months) {
        const targetDay = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + months);
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
        date.setUTCDate(Math.min(targetDay, lastDay));
    }
    function rangeStart(end) {
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
    function showSummary(point) {
        if (!point || !visiblePoints.length) return;
        const first = visiblePoints[0].close;
        const delta = point.close - first;
        const percentage = first === 0 ? null : delta / Math.abs(first) * 100;
        const sign = delta >= 0 ? "+" : "−";
        priceElement.textContent = money.format(point.close);
        changeElement.dataset.trend = delta >= 0 ? "up" : "down";
        changeElement.textContent = sign + money.format(Math.abs(delta)) +
            (percentage === null ? "" : "  " + (delta >= 0 ? "↗ " : "↘ ") + quantity.format(Math.abs(percentage)) + "%");
        periodElement.textContent = shortDate.format(visiblePoints[0].time * 1000) + " — " + shortDate.format(point.time * 1000) +
            (selectedRange === "1D" || selectedRange === "5D" ? ", " + shortTime.format(point.time * 1000) + " UTC" : "");
    }
    function hideTooltip() {
        tooltip.hidden = true;
        showSummary(visiblePoints[visiblePoints.length - 1]);
    }
    function setStyle() {
        line.applyOptions({ visible: selectedStyle === "line" });
        candles.applyOptions({ visible: selectedStyle === "candles" });
        styles.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.chartStyle === selectedStyle)));
        hideTooltip();
    }
    function setRange() {
        const useIntraday = ["1D", "5D"].includes(selectedRange) && model.intraday.length;
        const source = useIntraday ? model.intraday : model.points;
        const latest = source[source.length - 1];
        visiblePoints = latest ? source.filter((point) => point.time >= rangeStart(latest.time)) : [];
        byTime = new Map(visiblePoints.map((point) => [point.time, point]));
        ranges.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.range === selectedRange)));
        keyboardIndex = visiblePoints.length - 1;
        if (baseline) {
            line.removePriceLine(baseline);
            baseline = null;
        }
        line.setData(visiblePoints.map((point) => ({ time: point.time, value: point.close })));
        candles.setData(visiblePoints.map(({ volume: ignored, ...point }) => point));
        volume.setData(visiblePoints.map((point) => ({
            time: point.time, value: point.volume, color: point.close >= point.open ? colors.green : colors.red
        })));
        stateMessage.hidden = visiblePoints.length > 0;
        if (!visiblePoints.length) {
            stateMessage.textContent = "Ainda não há dados para este período.";
            priceElement.textContent = "—";
            changeElement.textContent = "";
            periodElement.textContent = "";
            description.textContent = "Sem dados disponíveis.";
            tooltip.hidden = true;
            return;
        }
        line.applyOptions({ baseValue: { type: "price", price: visiblePoints[0].close } });
        baseline = line.createPriceLine({
            price: visiblePoints[0].close, color: colors["text-secondary"],
            lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false
        });
        chart.applyOptions({ timeScale: { timeVisible: Boolean(useIntraday), secondsVisible: false } });
        chart.timeScale().fitContent();
        hideTooltip();
        description.textContent = "Gráfico de valores e volume com " + visiblePoints.length + " pontos. " +
            periodElement.textContent + ". Valor final: " + priceElement.textContent +
            ". Use as setas do teclado para consultar os pontos.";
    }
    chart.subscribeCrosshairMove((param) => {
        const point = byTime.get(param.time);
        if (!point || !param.point || param.point.x < 0 || param.point.y < 0 ||
            param.point.x > host.clientWidth || param.point.y > host.clientHeight) {
            hideTooltip();
            return;
        }
        showSummary(point);
        tooltip.querySelector("time").textContent = shortDate.format(point.time * 1000) +
            (["1D", "5D"].includes(selectedRange) ? " · " + shortTime.format(point.time * 1000) : "");
        tooltip.querySelector("strong").textContent = money.format(point.close);
        tooltip.querySelector("small").textContent = "Volume: " + quantity.format(point.volume);
        tooltip.hidden = false;
        tooltip.style.left = Math.max(8, Math.min(param.point.x + 24, host.clientWidth - tooltip.offsetWidth - 8)) + "px";
        tooltip.style.top = Math.max(8, Math.min(param.point.y - tooltip.offsetHeight - 12, host.clientHeight - tooltip.offsetHeight - 8)) + "px";
    });
    ranges.forEach((button) => button.addEventListener("click", () => {
        selectedRange = button.dataset.range;
        setRange();
    }));
    styles.forEach((button) => button.addEventListener("click", () => {
        selectedStyle = button.dataset.chartStyle;
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
            layout: { background: { type: "solid", color: colors.surface }, textColor: colors["text-secondary"] },
            grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
            timeScale: { borderColor: colors.border },
            crosshair: { vertLine: { color: colors["text-secondary"] }, horzLine: { color: colors["text-secondary"] } }
        });
        line.applyOptions({ topLineColor: colors.green, bottomLineColor: colors.red, ...fills() });
        candles.applyOptions({ upColor: colors.green, downColor: colors.red, wickUpColor: colors.green, wickDownColor: colors.red });
        if (baseline) baseline.applyOptions({ color: colors["text-secondary"] });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Site integration: provide local values in this format; no external data requests.
    function setData(data) {
        const next = {
            currency: data.currency || "BRL", demo: data.demo === true,
            points: normalize(data.points), intraday: normalize(data.intraday || [])
        };
        const nextMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: next.currency });
        model = next;
        money = nextMoney;
        priceFormat = { type: "custom", minMove: .01, formatter: (value) => quantity.format(value) };
        line.applyOptions({ priceFormat });
        candles.applyOptions({ priceFormat });
        setRange();
        setStyle();
    }
    window.AscendaChart = Object.freeze({ setData });
    try {
        setData(window.AscendaChartData || { points: [], demo: false });
    } catch (error) {
        stateMessage.hidden = false;
        stateMessage.textContent = "Não foi possível exibir os dados do gráfico.";
        console.error(error);
    }
})();

