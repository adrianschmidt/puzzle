import { diagnostics } from '../diagnostics.js';
import {
    track,
    sanitizeErrorReason,
    type SharedLoadFailedData,
    type NewGameFailedData,
} from '../analytics/index.js';
import { showToast } from '../ui/index.js';

/**
 * `shared-load-failed` has two producers (share link, `__reproPuzzle`), so it
 * carries a `source`; `new-game-failed` carries the cut style, and on the boot
 * path which of the two attempts it was.
 */
export type ErrorReportEvent =
    | { event: 'shared-load-failed'; source: SharedLoadFailedData['source'] }
    | {
        event: 'new-game-failed';
        cutStyle: string;
        phase?: NewGameFailedData['phase'];
    };

/**
 * `track` is overloaded per event name, so it can't take a union variable
 * directly. Switching narrows `event` to a literal per case so the matching
 * overload binds and a rename stays type-checked (unlike a blanket cast).
 */
function trackReasonEvent(report: ErrorReportEvent, reason: string): void {
    switch (report.event) {
        case 'new-game-failed': {
            // Build the payload rather than passing `phase` through: a
            // dialog-path failure must reach Umami with no `phase` key at all,
            // since its absence is what marks it (see `NewGameFailedData.phase`).
            // Assembling it conditionally keeps that independent of how the
            // tracker serializes an explicit `phase: undefined`.
            const data: NewGameFailedData = { reason, cutStyle: report.cutStyle };
            if (report.phase) data.phase = report.phase;
            track(report.event, data);
            return;
        }
        case 'shared-load-failed':
            track(report.event, { reason, source: report.source });
            return;
        default: {
            // Exhaustiveness guard: without it a third variant type-checks and
            // silently emits no Umami event (`noImplicitReturns` is off) while
            // still showing its toast and diagnostic.
            const unhandled: never = report;
            return unhandled;
        }
    }
}

export async function runWithErrorReport<T>(opts: ErrorReportEvent & {
    run: () => Promise<T>;
    warnMessage: string;
    /**
     * Omit to stay silent — for a caller that shows its own message after a
     * recovery settles. `showToast` renders one toast at a time, so an eager
     * failure toast would flash then be replaced, reading as a contradiction.
     */
    toastMessage?: string;
    fallback: T;
    /**
     * Log through `console.error` instead of the DEV-gated `diagnostics.warn`,
     * for a caller whose failure must be readable on a deployed build. Opt-in,
     * so user-facing flows stay silent in production.
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
