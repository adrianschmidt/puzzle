/**
 * Service-worker-side backstop for failures in the worker's own scope, which
 * the page-realm listeners in `analytics/error-tracking.ts` cannot see.
 * Mirrors that backstop's shape (sanitized `reason`, low-cardinality `name`,
 * per-session rate limiting), but cannot call `track()` directly: the Umami
 * script only exists in the page. It holds no service-worker references of
 * its own — `post` is injected — which keeps the sanitize + rate-limit logic
 * unit-testable without a worker environment.
 */

import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';

export const SW_ERROR_MESSAGE_TYPE = 'sw-error-report';

/**
 * Distinct from the page realm's `'rejection' | 'error'` so an operator can
 * tell a worker-scope failure from a page-scope one in the shared
 * `unhandled-error` event.
 */
export type SwErrorSource = 'sw-error' | 'sw-rejection';

/** Must stay structured-clonable: crosses realms via `postMessage`. */
export interface SwErrorReport {
    type: typeof SW_ERROR_MESSAGE_TYPE;
    source: SwErrorSource;
    name: string;
    reason: string;
}

/**
 * Max reports per distinct `reason` per worker session. Mirrors the page
 * backstop; the budgets are intentionally independent (a worker flood
 * shouldn't eat the page's budget, or vice versa).
 *
 * Per-reason truncation is silent by design: unlike the global cap (which
 * posts a one-time `RateLimited` notice), hitting this limit emits nothing —
 * treat the reported count of any one `reason` as a floor, not the real
 * volume. A per-reason notice would multiply notice cardinality under a
 * multi-reason flood and diverge from the page backstop's behavior.
 */
const MAX_PER_REASON = 5;
const MAX_TOTAL = 50;

/** Keeps the `name` analytics dimension low-cardinality. */
function errorName(value: unknown): string {
    return value instanceof Error ? value.name || 'Error' : 'unknown';
}

export interface SwErrorReporterDeps {
    post: (report: SwErrorReport) => void;
}

export interface SwErrorReporter {
    report(source: SwErrorSource, cause: unknown): void;
}

export function createSwErrorReporter(deps: SwErrorReporterDeps): SwErrorReporter {
    const reasonCounts = new Map<string, number>();
    let totalSent = 0;
    let capNoticeSent = false;

    function reportingAllowed(reason: string): boolean {
        if (totalSent >= MAX_TOTAL) return false;
        const seen = reasonCounts.get(reason) ?? 0;
        if (seen >= MAX_PER_REASON) return false;
        reasonCounts.set(reason, seen + 1);
        totalSent += 1;
        return true;
    }

    function emit(source: SwErrorSource, name: string, reason: string): void {
        deps.post({ type: SW_ERROR_MESSAGE_TYPE, source, name, reason });
    }

    return {
        report(source, cause): void {
            const reason = sanitizeErrorReason(cause);
            if (reportingAllowed(reason)) {
                emit(source, errorName(cause), reason);
                return;
            }
            if (totalSent >= MAX_TOTAL && !capNoticeSent) {
                capNoticeSent = true;
                emit(
                    'sw-error',
                    'RateLimited',
                    `sw unhandled-error cap (${MAX_TOTAL}/session) reached; further errors dropped`,
                );
            }
        },
    };
}
