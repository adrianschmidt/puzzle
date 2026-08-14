/**
 * A `#p=` link that fails to decode may just be newer than this cached build:
 * the share format has grown without bumping `v`. `attemptRescue` runs one
 * forced service-worker update check and, if a newer build is waiting, applies
 * it and reloads with the hash intact so the updated code re-parses the link.
 * A sessionStorage guard allows at most one rescue per link body, so a link the
 * update still can't decode falls through to the invalid-link toast instead of
 * reload-looping.
 */

import { parseLocationHash, type SharePayload } from '../sharing/index.js';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
    type RescueOutcome,
} from '../pwa/share-link-rescue.js';
import { loadState } from '../persistence/index.js';
import { showToast, showLoadingOverlay, hideLoadingOverlay } from '../ui/index.js';
import { runWithErrorReport } from './run-with-error-report.js';
import { track } from '../analytics/index.js';

export interface ShareLinkLoader {
    /**
     * Handle a `#p=` link if one is present. Resolves true when the boot
     * flow must not start a puzzle underneath it — either the shared puzzle
     * loaded, or a rescue reload is imminent.
     */
    tryLoad(): Promise<boolean>;
    isRescueReloadPending(): boolean;
}

export interface ShareLinkLoaderDeps {
    /** `loadSharedPuzzle` bound to the composition root's deps. */
    loadShared: (payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>;
    /** `pwaUpdates.attemptShareLinkRescue`. */
    attemptRescue: () => Promise<RescueOutcome>;
    /** Injected for testing. */
    confirm?: (message: string) => boolean;
}

/**
 * Load precedence: shared-link (hash) > saved game > fresh start — this handles
 * the first only. The boot flow calls {@link ShareLinkLoader.tryLoad} once and
 * checks {@link ShareLinkLoader.isRescueReloadPending} before tearing down the
 * loading overlay; the hashchange listener calls `tryLoad` again for a link
 * pasted into an already-open tab.
 */
export function createShareLinkLoader(deps: ShareLinkLoaderDeps): ShareLinkLoader {
    const confirmDiscard = deps.confirm ?? ((message: string) => window.confirm(message));

    // Set when a rescue update was applied and the page is about to reload:
    // the boot flow's overlay teardown must not run, or the page flashes blank
    // until the reload lands.
    let rescueReloadPending = false;

    /**
     * After the awaited rescue, does our guard entry still name this exact
     * link? True means no concurrent hashchange superseded us. Same predicate
     * as {@link wasRescueAttempted}, aliased for its post-await meaning (before
     * the await the same call answers "is this the post-reload re-check") so the
     * flipped intent doesn't read as a copy-paste.
     */
    function rescueStillOwnsGuard(hashBody: string): boolean {
        return wasRescueAttempted(hashBody);
    }

    /**
     * One update-check-and-reload rescue per link. Returns true when a reload
     * is imminent (caller halts the boot flow); every other outcome falls
     * through to the invalid-link toast.
     */
    async function rescueUndecodableLink(hashBody: string): Promise<boolean> {
        if (wasRescueAttempted(hashBody)) {
            // This load IS the rescue reload for this link, and it still doesn't
            // decode: the latest build doesn't understand it either. (A
            // same-document hash round-trip mid-rescue also lands here —
            // accepted as a contrived edge case.)
            clearRescueAttempt();
            track('share-link-rescue-result', { decoded: false });
            return false;
        }
        // A guard that can't be persisted would let a still-invalid link
        // reload forever; skip the rescue instead of risking the loop.
        if (!recordRescueAttempt(hashBody)) return false;
        showLoadingOverlay('Checking for app update…');
        const outcome = await deps.attemptRescue();
        track('share-link-rescue-attempted', { outcome });
        if (outcome === 'updated') {
            // The update-controller reloads the page (with a hard-reload
            // fallback); keep the overlay and hash up.
            rescueReloadPending = true;
            return true;
        }
        // A mismatch here means a hashchange during our rescue started a newer
        // link's attempt, whose guard entry and overlay must survive — so only
        // tidy up when we still own the guard.
        if (rescueStillOwnsGuard(hashBody)) {
            clearRescueAttempt();
            // The boot path's finally would hide it, but the hashchange path
            // has no such backstop — hide explicitly before the toast.
            hideLoadingOverlay();
        }
        return false;
    }

    async function tryLoad(): Promise<boolean> {
        // Captured once at entry, before any await. `slice(3)` drops the `#p=`
        // prefix (every use is gated on a `#p=` hash). The post-rescue check
        // re-slices the *current* hash instead of reusing this, to spot a
        // hashchange during the await.
        const hashBody = window.location.hash.slice(3);
        const payload = parseLocationHash(window.location.hash);
        if (!payload) {
            if (window.location.hash.startsWith('#p=')) {
                if (await rescueUndecodableLink(hashBody)) {
                    // Rescue reload imminent — report handled so the boot flow
                    // doesn't start a game underneath it.
                    return true;
                }
                // A hashchange during the rescue means this invocation's link is
                // no longer in the address bar; the newer invocation owns the
                // toast/strip decision.
                if (window.location.hash.slice(3) !== hashBody) return false;
                showToast('Invalid share link');
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            return false;
        }

        // The link decoded. If this load is the back half of a rescue reload,
        // close the analytics funnel (the update fixed the link). Clearing
        // unconditionally also drops any stale guard from an abandoned rescue.
        if (wasRescueAttempted(hashBody)) {
            track('share-link-rescue-result', { decoded: true });
        }
        clearRescueAttempt();

        // An unreadable save reads as no progress here, so its recovery blobs
        // aren't offered — corrupt-save recovery is deliberately startup-only. A
        // successful load's `persistNewPuzzle` (inside `deps.loadShared`)
        // overwrites the blobs anyway.
        const hasExistingProgress = !!loadState();
        if (hasExistingProgress) {
            const ok = confirmDiscard('Load shared puzzle? Your current progress will be lost.');
            if (!ok) {
                // Leave the hash in place so the user can reload to retry.
                return false;
            }
        }

        history.replaceState(null, '', window.location.pathname + window.location.search);
        // The previous save is deliberately left alone: `deps.loadShared`
        // persists the new puzzle only once generation fully succeeds, so a
        // cancel (#489) or a throw leaves the previous save intact, matching the
        // in-memory puzzle the player returns to. Clearing up front used to
        // destroy that save on every cancel. A shared puzzle whose geometry
        // exceeds the quota also writes nothing (#399), so the previous puzzle
        // stays on disk and a reload resumes it.
        //
        // Surface-shape validation catches most malformed payloads at decode
        // time, but a link can satisfy the schema and still trip the topology
        // pipeline (an unsupported config combination). Report and toast rather
        // than let it surface as an unhandled rejection.
        return runWithErrorReport({
            run: async () => {
                await deps.loadShared(payload, hasExistingProgress);
                return true;
            },
            warnMessage: 'Failed to load shared puzzle:',
            event: 'shared-load-failed',
            source: 'shared',
            toastMessage: "Couldn't load shared puzzle",
            fallback: false,
        });
    }

    return {
        tryLoad,
        isRescueReloadPending: () => rescueReloadPending,
    };
}
