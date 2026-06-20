/**
 * Service-worker-side backstop for failures thrown inside the worker's
 * own scope — message handlers, lifecycle/timer callbacks — which the
 * page-realm `window` listeners in `analytics/error-tracking.ts` cannot
 * see. Mirrors that backstop's shape (sanitized `reason`, low-cardinality
 * `name`, per-session rate limiting), but cannot call `track()` directly:
 * the Umami script only exists in the page. Instead it hands each finished
 * report to an injected `post`, which the SW entry forwards to its window
 * clients via `postMessage`; the page bridge
 * (`sw-error-bridge.ts`) relays them into `track('unhandled-error', …)`.
 *
 * The reporter holds no service-worker references of its own (the
 * `clients.matchAll` call is injected as `post`), which keeps the
 * sanitize + rate-limit logic unit-testable without a worker environment.
 */

import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';

/** Discriminator on the cross-realm message the SW posts to the page. */
export const SW_ERROR_MESSAGE_TYPE = 'sw-error-report';

/**
 * The channel that caught the failure inside the worker. Distinct from the
 * page realm's `'rejection' | 'error'` so an operator can tell a
 * worker-scope failure from a page-scope one in the shared
 * `unhandled-error` event.
 */
export type SwErrorSource = 'sw-error' | 'sw-rejection';

/** The structured-clonable report posted from the worker to the page. */
export interface SwErrorReport {
    type: typeof SW_ERROR_MESSAGE_TYPE;
    source: SwErrorSource;
    name: string;
    reason: string;
}

/**
 * Max reports of any one distinct `reason` per worker session. Mirrors the
 * page backstop; the budgets are intentionally independent (a worker flood
 * shouldn't eat the page's budget, or vice versa).
 *
 * Per-reason truncation is silent by design: unlike the global cap (which
 * posts a one-time `RateLimited` notice), hitting this limit emits nothing.
 * So treat the reported count of any one `reason` as a floor, not the real
 * volume — a reason seen `MAX_PER_REASON` times may have fired far more
 * often. We accept that blind spot rather than add a per-reason notice,
 * which would multiply notice cardinality under a multi-reason flood and
 * diverge from the page backstop's identical behavior.
 */
const MAX_PER_REASON = 5;
/** Max total reports per worker session before a flood is capped. */
const MAX_TOTAL = 50;

/**
 * Constructor name of a thrown value, for the low-cardinality `name`
 * dimension. `'unknown'` when the value isn't an `Error` (rejections can
 * carry strings/objects).
 */
function errorName(value: unknown): string {
    return value instanceof Error ? value.name || 'Error' : 'unknown';
}

export interface SwErrorReporterDeps {
    /**
     * Deliver a finished report to the page realm. The SW entry wires this
     * to `clients.matchAll(...).postMessage(report)`; tests pass a spy.
     */
    post: (report: SwErrorReport) => void;
}

export interface SwErrorReporter {
    /** Sanitize, rate-limit and (if allowed) post one caught failure. */
    report(source: SwErrorSource, cause: unknown): void;
}

/**
 * Create a reporter with per-session rate-limit state scoped to this call.
 * When the global cap is first hit, a single `RateLimited` notice is posted
 * so the flood is visible, then the reporter goes quiet.
 */
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
            // Surface the flood once (only when the *global* cap is the
            // blocker, not ordinary per-reason dedup), then stay silent.
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
