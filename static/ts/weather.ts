window.WorkspaceNavigation.page('/static/js/weather.js', ({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}) => {
    const locate = optionalElement(document, "#weather-locate", HTMLButtonElement);
    const status = requiredElement(document, "#weather-status", HTMLElement);
    const content = optionalElement(document, "#weather-content", HTMLElement);
    let version = 0, busy = false;
    if (!locate || !content) return;
    const cacheKey = 'ascenda-weather-' + optionalElement(document, '[data-user-id]', HTMLElement)?.dataset.userId;
    let cached: {city:WeatherCity;data:ReturnType<typeof weatherData>;saved:number} | undefined;
    try { const saved=record(JSON.parse(localStorage.getItem(cacheKey) || 'null'));cached={city:weatherCity(saved.city),data:weatherData(saved.data),saved:numberValue(saved.saved)}; } catch {}
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    function condition(code: number) {
        if (code === 0) return ['sun', 'Céu limpo'];
        if (code === 1 || code === 2) return ['partly-cloudy', 'Parcialmente nublado'];
        if (code === 3) return ['cloud', 'Nublado'];
        if (code === 45 || code === 48) return ['cloud', 'Neblina'];
        if ([71, 73, 75, 77, 85, 86].includes(code)) return ['cloud', 'Neve'];
        if (code >= 95) return ['rain', 'Trovoadas'];
        if (code >= 51) return ['rain', 'Chuva'];
        return ['cloud', 'Condição indisponível'];
    }
    function icon(code: number) {
        const [name, description] = condition(code);
        const node = el('span', 'discovery-icon icon-' + name);
        node.setAttribute('role', 'img');
        node.setAttribute('aria-label', description);
        return node;
    }
    async function json(url: string):Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error();
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    async function forecast(city: WeatherCity, restored?: ReturnType<typeof weatherData>) {
        if (!Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) return;
        const requestVersion = ++version;
        status.hidden = false;
        status.textContent = 'Buscando previsão…';
        present(content).hidden = !present(content).children.length;
        try {
            const params = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
                current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
                forecast_days: '5', timezone: 'auto' });
            const data = restored || weatherData(await json('https://api.open-meteo.com/v1/forecast?' + params));
            if (requestVersion !== version) return;
            if (!Number.isFinite(data.current?.temperature_2m) || data.daily?.time?.length !== 5) throw new Error();
            const now = el('div', 'weather-now');
            const temp = el('div', 'weather-temp');
            temp.append(icon(data.current.weather_code), el('span', '', Math.round(data.current.temperature_2m) + '°C'));
            now.append(temp, el('span', 'weather-description', condition(data.current.weather_code)[1]));
            const meta = el('div', 'weather-meta');
            meta.append(el('span', '', city.name), el('span', '', 'Máx: ' + Math.round(data.daily.temperature_2m_max[0]) + '° · Mín: ' + Math.round(data.daily.temperature_2m_min[0]) + '°'));
            const days = el('div', 'weather-days');
            data.daily.time.forEach((date, index) => {
                const day = el('div', 'weather-day');
                const label = index === 0 ? 'Hoje' : new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' });
                day.append(el('small', '', label), icon(data.daily.weather_code[index]), el('span', '', Math.round(data.daily.temperature_2m_max[index]) + '°'));
                days.append(day);
            });
            present(content).replaceChildren(now, meta, days);
            present(content).hidden = false;
            status.hidden = true;
            present(locate).textContent = 'Atualizar localização';
            if (!restored) {
                cached = {city, data, saved: Date.now()};
                try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch {}
            }
        } catch {
            if (requestVersion !== version) return;
            status.textContent = 'Não foi possível carregar o clima. Tente usar sua localização novamente.';
        }
    }
    async function locateWeather() {
        if (busy) return;
        status.hidden = false;
        present(content).hidden = !present(content).children.length;
        if (!window.isSecureContext || !navigator.geolocation) {
            status.textContent = 'A localização requer um navegador compatível e HTTPS ou localhost.';
            return;
        }
        busy = true;
        present(locate).disabled = true;
        status.textContent = 'Permita sua localização para ver o clima da região.';
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: false, timeout: 15000, maximumAge: 300000
                });
            });
            let name = 'Localização atual';
            try {
                const place = record(await json('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=' + position.coords.latitude.toFixed(2) + '&lon=' + position.coords.longitude.toFixed(2)));
                const address=record(place.address);name=optionalString(address.city || address.town || address.village || address.municipality) || name;
            } catch {}
            await forecast({ name,
                latitude: Number(position.coords.latitude.toFixed(2)),
                longitude: Number(position.coords.longitude.toFixed(2)) });
        } catch (error) {
            status.textContent = isRecord(error) && error.code === 1
                ? 'Localização não permitida. Você pode liberá-la nas permissões do site no navegador.'
                : isRecord(error) && error.code === 3 ? 'A localização demorou a responder. Tente novamente.'
                : 'Não foi possível obter sua localização. Verifique se ela está ativada e tente novamente.';
        } finally {
            busy = false;
            present(locate).disabled = false;
        }
    }
    locate.addEventListener('click', locateWeather);
    if (cached?.city && cached?.data) {
        forecast(cached.city, cached.data).then(() => {
            if (Date.now() - present(cached).saved > 1800000) forecast(present(cached).city);
        });
    }
    const toggle = optionalElement(document, '.weather-toggle', HTMLButtonElement);
    const layout = optionalElement(document, '.discovery-layout', HTMLElement);
    const widgets = optionalElement(document, '.discovery-widgets', HTMLElement);
    function anchorWeather() {
        if (!layout || !widgets || !matchMedia('(min-width: 901px)').matches) return;
        const rect = layout.getBoundingClientRect();
        const width = Math.max(260, rect.width * .30);
        layout.style.setProperty('--stories-width', (rect.width - width - 72) + 'px');
    }
    anchorWeather();
    scope.listen(window, 'resize', anchorWeather);
    const compactWeather = matchMedia('(max-width: 900px)');
    function resetCompactWeather() {
        if (!compactWeather.matches || !layout || !widgets) return;
        layout.classList.remove('is-weather-collapsed'); widgets.hidden = false;
        toggle?.setAttribute('aria-expanded','true');
    }
    scope.listen(compactWeather, 'change',resetCompactWeather); resetCompactWeather();
    toggle?.addEventListener('click', () => {
        const collapsed = requiredElement(document, '.discovery-layout', HTMLElement).classList.toggle('is-weather-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expandir painel' : 'Recolher painel');
        requiredElement(document, '.discovery-widgets', HTMLElement).hidden = collapsed;
    });
});
