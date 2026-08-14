/**
 * Auto-enabled in dev and test, off in every production build — including
 * `/puzzle/dev/`, a production build served from a subpath, so `warn` is
 * silent there too. Nothing binds `enableDiagnostics` to a window/dev-console
 * hook, so a deployed build can't turn it on at runtime — treat `warn` as a
 * local-loop signal only, not a base for production diagnostics.
 */

export interface DiagnosticEntry {
    stage: string;
    message: string;
    data?: Record<string, unknown>;
}

export interface DiagnosticLog {
    readonly enabled: boolean;
    entries: DiagnosticEntry[];
    log(stage: string, message: string, data?: Record<string, unknown>): void;
    warn(...args: unknown[]): void;
    clear(): void;
}

let _enabled = import.meta.env.DEV;
const _entries: DiagnosticEntry[] = [];

export const diagnostics: DiagnosticLog = {
    get enabled() { return _enabled; },
    get entries() { return _entries; },
    log(stage, message, data) {
        if (!_enabled) return;
        _entries.push({ stage, message, data });
    },
    warn(...args) {
        if (!_enabled) return;
        console.warn(...args);
    },
    clear() {
        _entries.length = 0;
    },
};

export function enableDiagnostics(): void {
    _enabled = true;
    _entries.length = 0;
}

export function disableDiagnostics(): void {
    _enabled = false;
    _entries.length = 0;
}
