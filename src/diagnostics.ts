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
 * Auto-enabled in dev and test (Vite's `import.meta.env.DEV`). In
 * production builds the singleton is disabled by default; call
 * `enableDiagnostics()` to turn it on at runtime.
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

let _enabled = Boolean(import.meta.env.DEV);
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
