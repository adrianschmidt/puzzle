/**
 * Run an async application operation and, if it rejects, report the failure
 * uniformly: a dev diagnostic, a typed Umami event, and a user-facing toast —
 * then resolve to a caller-supplied fallback instead of propagating.
 *
 * Used by the entry-point flows whose failures were previously caught and
 * swallowed without analytics (shared-link load, new-game start). Extracted
 * from `main.ts` so the reporting behavior is unit-testable.
 */

import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason, type SharedLoadFailedData } from '../analytics/index.js';
import { showToast } from '../ui/toast.js';

/**
 * Which typed failure event the operation reports on, plus the per-event
 * fields that can't be derived from the error itself. `shared-load-failed`
 * has two producers (a real `#p=` share link and the `__reproPuzzle` console
 * helper), so it carries a `source` discriminator; `new-game-failed` has one.
 */
export type ErrorReportEvent =
    | { event: 'shared-load-failed'; source: SharedLoadFailedData['source'] }
    | { event: 'new-game-failed' };

/**
 * `track` is overloaded per event name, so it can't be called with a union
 * event variable directly. Switching over the union narrows `event` to a
 * single literal in each case, so the matching `track` overload binds and a
 * future rename of either event name is still type-checked here (unlike a
 * blanket cast) — as is a future per-event field.
 */
function trackReasonEvent(report: ErrorReportEvent, reason: string): void {
    switch (report.event) {
        case 'new-game-failed':
            track(report.event, { reason });
            return;
        case 'shared-load-failed':
            track(report.event, { reason, source: report.source });
            return;
        default: {
            // Exhaustiveness guard: without it a third `ErrorReportEvent`
            // variant type-checks here and silently emits no Umami event at
            // all (the function returns `void`, and `noImplicitReturns` is
            // off), while still showing its toast and diagnostic.
            const unhandled: never = report;
            return unhandled;
        }
    }
}

export async function runWithErrorReport<T>(opts: ErrorReportEvent & {
    run: () => Promise<T>;
    warnMessage: string;
    toastMessage: string;
    fallback: T;
    /**
     * Log through `console.error` instead of the DEV-gated
     * `diagnostics.warn`, for a caller whose failure has to be readable on a
     * deployed build. Opt-in per caller, so the user-facing flows stay
     * silent in production as `diagnostics` documents.
     */
    logInProduction?: boolean;
}): Promise<T> {
    try {
        return await opts.run();
    } catch (error) {
        if (opts.logInProduction) {
            // eslint-disable-next-line no-console
            console.error(opts.warnMessage, error);
        } else {
            diagnostics.warn(opts.warnMessage, error);
        }
        trackReasonEvent(opts, sanitizeErrorReason(error));
        showToast(opts.toastMessage);
        return opts.fallback;
    }
}
