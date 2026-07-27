/**
 * Run an async application operation and, if it rejects, report the failure
 * uniformly: a console diagnostic (DEV-gated by default, see
 * `logInProduction`), a typed Umami event, and — for the callers that ask
 * for one, see `toastMessage` — a user-facing toast; then resolve to a
 * caller-supplied fallback instead of propagating.
 *
 * Used by the entry-point flows whose failures were previously caught and
 * swallowed without analytics (shared-link load, new-game start). Extracted
 * from `main.ts` so the reporting behavior is unit-testable.
 */

import { diagnostics } from '../diagnostics.js';
import {
    track,
    sanitizeErrorReason,
    type SharedLoadFailedData,
    type NewGameFailedData,
} from '../analytics/index.js';
import { showToast } from '../ui/toast.js';

/**
 * Which typed failure event the operation reports on, plus the per-event
 * fields that can't be derived from the error itself. `shared-load-failed`
 * has two producers (a real `#p=` share link and the `__reproPuzzle` console
 * helper), so it carries a `source` discriminator; `new-game-failed` carries
 * the cut style the failed attempt asked for, and — on the boot path only —
 * which of the two attempts it was.
 */
export type ErrorReportEvent =
    | { event: 'shared-load-failed'; source: SharedLoadFailedData['source'] }
    | {
        event: 'new-game-failed';
        cutStyle: string;
        phase?: NewGameFailedData['phase'];
    };

/**
 * `track` is overloaded per event name, so it can't be called with a union
 * event variable directly. Switching over the union narrows `event` to a
 * single literal in each case, so the matching `track` overload binds and a
 * future rename of either event name is still type-checked here (unlike a
 * blanket cast) — as is a future per-event field.
 */
function trackReasonEvent(report: ErrorReportEvent, reason: string): void {
    switch (report.event) {
        case 'new-game-failed': {
            // Build the payload rather than passing `phase` straight
            // through: a dialog-path failure has to reach Umami with no
            // `phase` key at all, since its absence is exactly what marks
            // it. See `NewGameFailedData.phase` — recovering a
            // dialog-path-only figure is subtraction over rows that carry
            // no `phase` key. Assembling it conditionally keeps that
            // independent of how the tracker serializes an explicit
            // `phase: undefined`, and the unit test pins the key's absence
            // in the payload handed to the tracker. (`cutStyle` is
            // unconditional on every path and needs no such care.)
            const data: NewGameFailedData = { reason, cutStyle: report.cutStyle };
            if (report.phase) data.phase = report.phase;
            track(report.event, data);
            return;
        }
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
    /**
     * Message for the user-facing toast. Omit to stay silent — only for a
     * caller that shows its own message once a recovery attempt has
     * settled. `showToast` renders one toast at a time, so an eager
     * failure toast would be replaced by the recovery's message anyway,
     * and the intermediate flash reads as a contradiction.
     */
    toastMessage?: string;
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
        if (opts.toastMessage !== undefined) showToast(opts.toastMessage);
        return opts.fallback;
    }
}
