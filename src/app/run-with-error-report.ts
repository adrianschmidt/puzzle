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
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { showToast } from '../ui/toast.js';

// TypeScript's overload resolution doesn't distribute over union types, so
// calling track() with a union-typed event name doesn't compile against the
// individual overload signatures. Cast to a minimal compatible signature for
// the two events this helper actually handles — both accept { reason: string }.
type TrackReasonEvent = (name: 'shared-load-failed' | 'new-game-failed', data: { reason: string }) => void;
const trackReasonEvent = track as unknown as TrackReasonEvent;

export async function runWithErrorReport<T>(opts: {
    run: () => Promise<T>;
    warnMessage: string;
    event: 'shared-load-failed' | 'new-game-failed';
    toastMessage: string;
    fallback: T;
}): Promise<T> {
    try {
        return await opts.run();
    } catch (error) {
        diagnostics.warn(opts.warnMessage, error);
        trackReasonEvent(opts.event, { reason: sanitizeErrorReason(error) });
        showToast(opts.toastMessage);
        return opts.fallback;
    }
}
