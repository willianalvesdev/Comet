export function mountController(factory: PageFactory) {
        const controller = new AbortController(), cleanups: (()=>void)[] = [], nodes: (HTMLElement | SVGElement)[] = [], timers = new Set<number>(), frames = new Set<number>();
        const scope: PageScope = {
            signal: controller.signal,
            get active() { return !controller.signal.aborted; },
            cleanup(callback) { cleanups.push(callback); },
            listen<K extends keyof AppEvents>(target: EventTarget | null, type: K, callback: (event:AppEvents[K])=>void, options: boolean | AddEventListenerOptions = {}) {
                if (!target) return;
                const listener: EventListener = event => callback(event as AppEvents[K]);
                target.addEventListener(type, listener, {...(typeof options === 'boolean' ? {capture:options} : options), signal:controller.signal});
                if (target === window && type === 'pagehide') cleanups.push(() => listener(new Event('pagehide')));
            },
            append(...elements) { nodes.push(...elements); document.body.append(...elements); }
        };
        function timeout<A extends unknown[]>(callback: (...args: A) => void, delay?: number, ...args: A) {
            if (!scope.active) return 0;
            const id = window.setTimeout(() => { timers.delete(id); if (scope.active) callback(...args); }, delay);
            timers.add(id); return id;
        }
        function interval<A extends unknown[]>(callback: (...args: A) => void, delay?: number, ...args: A) {
            if (!scope.active) return 0;
            const id = window.setInterval(() => { if (scope.active) callback(...args); }, delay);
            timers.add(id); return id;
        }
        function frame(callback: FrameRequestCallback) {
            if (!scope.active) return 0;
            const id = window.requestAnimationFrame(time => { frames.delete(id); if (scope.active) callback(time); });
            frames.add(id); return id;
        }
        class ScopedResizeObserver extends ResizeObserver {
            constructor(callback: ResizeObserverCallback) { super((entries, observer) => { if (scope.active) callback(entries, observer); }); cleanups.push(() => this.disconnect()); }
        }
        class ScopedMutationObserver extends MutationObserver {
            constructor(callback: MutationCallback) { super((entries, observer) => { if (scope.active) callback(entries, observer); }); cleanups.push(() => this.disconnect()); }
        }
        const dispose = () => {
            for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (error) { console.error(error); } }
            controller.abort(); timers.forEach(clearTimeout); timers.forEach(clearInterval); frames.forEach(cancelAnimationFrame);
            nodes.forEach(node => node.remove());
        };
        try { factory({scope, setTimeout:timeout, setInterval:interval, requestAnimationFrame:frame,
            ResizeObserver:ScopedResizeObserver, MutationObserver:ScopedMutationObserver,
            fetch:(url, options = {}) => fetch(url, {...options, signal:options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal})}); } catch (error) { dispose(); throw error; }
        return dispose;
    }

export function mountControllers(factories: PageFactory[]) {
    const cleanups: (() => void)[] = [];
    const dispose = () => { cleanups.reverse().forEach(cleanup => cleanup()); };
    try { factories.forEach(factory => cleanups.push(mountController(factory))); }
    catch (error) { dispose(); throw error; }
    return dispose;
}
