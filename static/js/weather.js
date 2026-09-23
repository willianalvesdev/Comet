(() => {
    const locate = document.getElementById('weather-locate');
    const status = document.getElementById('weather-status');
    const content = document.getElementById('weather-content');
    let version = 0, busy = false;
    try { localStorage.removeItem('ascenda-weather-city'); } catch {}
    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    function condition(code) {
        if (code === 0) return ['sun', 'Céu limpo'];
        if (code === 1 || code === 2) return ['partly-cloudy', 'Parcialmente nublado'];
        if (code === 3) return ['cloud', 'Nublado'];
        if (code === 45 || code === 48) return ['cloud', 'Neblina'];
        if ([71, 73, 75, 77, 85, 86].includes(code)) return ['cloud', 'Neve'];
        if (code >= 95) return ['rain', 'Trovoadas'];
        if (code >= 51) return ['rain', 'Chuva'];
        return ['cloud', 'Condição indisponível'];
    }
    function icon(code) {
        const [name, description] = condition(code);
        const node = el('span', 'discovery-icon icon-' + name);
        node.setAttribute('role', 'img');
        node.setAttribute('aria-label', description);
        return node;
    }
    async function json(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error();
            return await response.json();
        } finally { clearTimeout(timer); }
    }
    async function forecast(city) {
        if (!Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) return;
        const requestVersion = ++version;
        status.hidden = false;
        status.textContent = 'Buscando previsão…';
        content.hidden = true;
        try {
            const params = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude,
                current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
                forecast_days: 5, timezone: 'auto' });
            const data = await json('https://api.open-meteo.com/v1/forecast?' + params);
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
            content.replaceChildren(now, meta, days);
            content.hidden = false;
            status.hidden = true;
            locate.textContent = 'Atualizar localização';
        } catch {
            if (requestVersion !== version) return;
            status.textContent = 'Não foi possível carregar o clima. Tente usar sua localização novamente.';
        }
    }
    async function locateWeather() {
        if (busy) return;
        status.hidden = false;
        content.hidden = true;
        if (!window.isSecureContext || !navigator.geolocation) {
            status.textContent = 'A localização requer um navegador compatível e HTTPS ou localhost.';
            return;
        }
        busy = true;
        locate.disabled = true;
        status.textContent = 'Permita sua localização para ver o clima da região.';
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: false, timeout: 15000, maximumAge: 300000
                });
            });
            await forecast({ name: 'Sua região',
                latitude: Number(position.coords.latitude.toFixed(2)),
                longitude: Number(position.coords.longitude.toFixed(2)) });
        } catch (error) {
            status.textContent = error.code === 1
                ? 'Localização não permitida. Você pode liberá-la nas permissões do site no navegador.'
                : error.code === 3 ? 'A localização demorou a responder. Tente novamente.'
                : 'Não foi possível obter sua localização. Verifique se ela está ativada e tente novamente.';
        } finally {
            busy = false;
            locate.disabled = false;
        }
    }
    locate.addEventListener('click', locateWeather);
})();
