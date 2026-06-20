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

/**
 * `track` is overloaded per event name, so it can't be called with a union
 * event variable directly. Narrowing the union to a literal in each branch
 * lets each call resolve against its concrete overload, so a future rename of
 * either event name is still type-checked here (unlike a blanket cast).
 */
function trackReasonEvent(event: 'shared-load-failed' | 'new-game-failed', data: { reason: string }): void {
    if (event === 'new-game-failed') {
        track(event, data);
    } else {
        track(event, data);
    }
}

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
