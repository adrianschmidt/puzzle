/**
 * Project-wide diagnostic logging.
 *
 * - `diagnostics.log(stage, message, data?)` collects structured entries
 *   when enabled. Used by topology-pipeline tests to inspect generation
 *   without visual inspection.
 * - `diagnostics.warn(...args)` writes to console.warn when enabled.
 *   Used for runtime issues that developers should see in dev/test
 *   builds but stay silent in production.
 *
 * Auto-enabled in dev and test (Vite's `import.meta.env.DEV`), and off in
 * every production build — which includes `/puzzle/dev/`, a production build
 * served from a subpath, so `diagnostics.warn` is silent there too.
 *
 * `enableDiagnostics()` flips the singleton for code that imports it — no
 * call site does today. It is bound to no `window` property and no
 * dev-console hook, so nothing can turn diagnostics on at runtime in a
 * deployed build — treat `warn` as a local-loop signal only, and don't build
 * a production diagnostic on top of it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Singleton diagnostic log
// ---------------------------------------------------------------------------

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
