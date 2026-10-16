import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { composerState } from './composer-state';

export function ProviderToggle() {
    const { computer, busy } = useSyncExternalStore(composerState.subscribe, composerState.get, composerState.server);
    const group = useRef<HTMLDivElement>(null);
    const motion = useRef({ value: Number(computer), velocity: 0, frame: 0, ready: false });

    useLayoutEffect(() => {
        const element = group.current!;
        const labels = [...element.querySelectorAll<HTMLElement>('.provider-toggle__content')];
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const current = motion.current;
        const target = Number(computer);
        let previous = performance.now();
        function paint() {
            const collapsed = 36;
            const widths = labels.map(label => Math.max(36, label.scrollWidth));
            const progress = current.value;
            element.style.setProperty('--provider-progress', String(progress));
            element.style.setProperty('--gemini-width', `${collapsed + (widths[0] - collapsed) * (1 - progress)}px`);
            element.style.setProperty('--computer-width', `${collapsed + (widths[1] - collapsed) * progress}px`);
            element.style.setProperty('--indicator-x', `${collapsed * progress}px`);
            element.style.setProperty('--indicator-width', `${widths[0] + (widths[1] - widths[0]) * progress}px`);
        }
        function frame(now: number) {
            let remaining = Math.min((now - previous) / 1000, 0.064);
            previous = now;
            // Small integration steps keep the measured 700/50 spring stable on slow frames.
            while (remaining > 0) {
                const step = Math.min(remaining, 0.001);
                const before = target - current.value;
                current.velocity += (700 * before - 50 * current.velocity) * step;
                current.value += current.velocity * step;
                if (before * (target - current.value) < 0) { current.value = target; current.velocity = 0; }
                remaining -= step;
            }
            if (Math.abs(target - current.value) < 0.0001 && Math.abs(current.velocity) < 0.001) {
                current.value = target; current.velocity = 0;
            } else current.frame = requestAnimationFrame(frame);
            paint();
        }
        function settle() { cancelAnimationFrame(current.frame); current.value = target; current.velocity = 0; paint(); }
        if (!current.ready || reduced.matches) settle();
        else current.frame = requestAnimationFrame(frame);
        current.ready = true;
        const observer = new ResizeObserver(paint);
        labels.forEach(label => observer.observe(label));
        reduced.addEventListener('change', settle);
        return () => { cancelAnimationFrame(current.frame); observer.disconnect(); reduced.removeEventListener('change', settle); };
    }, [computer]);

    return <div ref={group} className="composer-provider-group provider-toggle" role="group" aria-label="Modo da mensagem">
        <span className="provider-toggle__indicator" aria-hidden="true" />
        <button className="model-picker" type="button" aria-label="Usar Pesquisar" aria-pressed={!computer} disabled={busy}>
            <span className="provider-toggle__content"><i className="model-icon model-icon--search" aria-hidden="true" /><span className="provider-toggle__label">Pesquisar</span></span>
        </button>
        <button className="home__mode computer-provider" type="button" aria-label="Usar Computer" aria-pressed={computer} disabled={busy}>
            <span className="provider-toggle__content"><i className="computer-icon" aria-hidden="true" /><span className="provider-toggle__label">Computer</span></span>
        </button>
    </div>;
}
