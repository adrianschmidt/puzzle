/**
 * Stale-client share-link rescue — when a `#p=` link fails to decode, this
 * client may simply be an old cached build that predates the link's format
 * (the share payload has historically grown without bumping `v`). This
 * module holds the two halves of the recovery flow:
 *
 * - a sessionStorage loop guard ensuring exactly one rescue attempt per
 *   link (the attempt reloads the page, so the guard is what stops a
 *   still-invalid link from reload-looping);
 * - the rescue attempt itself (added in a later task): force a
 *   service-worker update check and, if a newer build is waiting, apply it
 *   and reload with the hash intact.
 *
 * sessionStorage (not localStorage) so a stale guard can't outlive the tab
 * and suppress a legitimate future rescue after the app has genuinely
 * updated. All service-worker specifics are injected; `register.ts`
 * supplies the real ones.
 */

import type { ShareLinkRescueAttemptedData } from '../analytics/index.js';

/** How a rescue attempt ended. Single source of truth: the analytics payload. */
export type RescueOutcome = ShareLinkRescueAttemptedData['outcome'];

const GUARD_KEY = 'share-link-rescue-attempt';

/** True when a rescue reload for exactly this link body is in flight. */
export function wasRescueAttempted(hashBody: string, storage?: Storage): boolean {
    try {
        return (storage ?? sessionStorage).getItem(GUARD_KEY) === hashBody;
    } catch {
        return false;
    }
}

/**
 * Record that a rescue is being attempted for this link. Returns true only
 * when the guard verifiably persisted — callers must skip the rescue on
 * false, because an unpersisted guard would let a still-invalid link
 * reload-loop forever.
 */
export function recordRescueAttempt(hashBody: string, storage?: Storage): boolean {
    try {
        const s = storage ?? sessionStorage;
        s.setItem(GUARD_KEY, hashBody);
        return s.getItem(GUARD_KEY) === hashBody;
    } catch {
        return false;
    }
}

/** Drop the guard entry (every terminal path of the flow ends here). */
export function clearRescueAttempt(storage?: Storage): void {
    try {
        (storage ?? sessionStorage).removeItem(GUARD_KEY);
    } catch {
        // Nothing to clean up if storage is unavailable.
    }
}
