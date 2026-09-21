(() => {
    // Local demonstration only. Replace this fixture with data from the site.
    const day = 86400;
    const end = Date.UTC(2026, 8, 21) / 1000;
    const anchors = [70497.01, 65100, 69100, 77000, 79000, 73500, 60000, 64100, 58600, 62200, 63400, 61500, 77200, 75300, 74500, 85410.14];
    const points = [];
    let previous = 34500;
    for (let i = 0; i <= 2191; i += 1) {
        const remaining = 2191 - i;
        let close = 34500 + i * 16 + Math.sin(i / 70) * 5000 + Math.sin(i / 9) * 800;
        if (remaining <= 184) {
            const t = (184 - remaining) / 184 * (anchors.length - 1);
            const index = Math.min(Math.floor(t), anchors.length - 2);
            close = anchors[index] + (anchors[index + 1] - anchors[index]) * (t - index);
            close += Math.sin(i * 1.7) * 670 + Math.sin(i * .61) * 810;
            if (remaining === 184) close = anchors[0];
            if (remaining === 0) close = anchors[anchors.length - 1];
        }
        const open = previous;
        points.push({
            time: end - remaining * day,
            open: Number(open.toFixed(2)),
            high: Number((Math.max(open, close) + 200 + Math.abs(Math.sin(i)) * 480).toFixed(2)),
            low: Number((Math.min(open, close) - 200 - Math.abs(Math.cos(i)) * 420).toFixed(2)),
            close: Number(close.toFixed(2)),
            volume: Math.round(200 + Math.abs(Math.sin(i * .43)) * 110 + Math.abs(close - open) * .025)
        });
        previous = close;
    }
    const intraday = [];
    const daily = points.slice(-6);
    daily.slice(1).forEach((point, index) => {
        const start = daily[index].close;
        for (let step = 1; step <= 48; step += 1) {
            const t = step / 48;
            const close = start + (point.close - start) * t + Math.sin(step * .6) * Math.sin(t * Math.PI) * 200;
            const open = intraday.length ? intraday[intraday.length - 1].close : start;
            intraday.push({
                time: point.time - day + step * 1800,
                open,
                high: Math.max(open, close) + 40,
                low: Math.min(open, close) - 40,
                close: Number(close.toFixed(2)),
                volume: Math.round(point.volume / 48 + Math.abs(Math.sin(step)) * 6)
            });
        }
    });
    window.AscendaChartData = {
        currency: "BRL",
        demo: true,
        points,
        intraday
    };
})();

