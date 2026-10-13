type ComposerState = { computer: boolean; busy: boolean };
const initial: ComposerState = { computer: false, busy: false };
let state = initial;
const listeners = new Set<() => void>();

export const composerState = {
    get: () => state,
    server: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(value: Partial<ComposerState>) {
        const next = { ...state, ...value };
        if (next.computer === state.computer && next.busy === state.busy) return;
        state = next;
        listeners.forEach(listener => listener());
    },
};
