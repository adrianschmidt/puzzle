/**
 * Service-worker-side backstop for failures in the worker's own scope, which
 * the page-realm listeners in `analytics/error-tracking.ts` can't see. Mirrors
 * that backstop (sanitized `reason`, low-cardinality `name`, per-session rate
 * limiting) but can't call `track()` (Umami only exists in the page). `post`
 * is injected, keeping the sanitize + rate-limit logic unit-testable.
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
 * Caps per distinct `reason` and in total per worker session; budgets are
 * intentionally independent of the page backstop's. Per-reason truncation is
 * silent (unlike the global cap's one-time `RateLimited` notice), so treat any
 * one `reason`'s reported count as a floor — a per-reason notice would bloat
 * notice cardinality under a multi-reason flood.
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
