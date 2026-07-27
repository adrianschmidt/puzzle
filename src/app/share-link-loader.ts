/**
 * Load a `#p=` share link on boot and on an in-tab hash change, including
 * the stale-client rescue for a link that fails to decode.
 *
 * A `#p=` link that fails to decode may just be newer than this cached
 * build: the share format has historically grown without bumping its
 * version field. `attemptRescue` (`pwaUpdates.attemptShareLinkRescue`) runs
 * one forced service-worker update check and, if a newer build is waiting,
 * applies it and reloads with the hash intact — the reloaded page re-parses
 * the same link under the updated code. A sessionStorage guard
 * (`wasRescueAttempted` / `recordRescueAttempt` / `clearRescueAttempt`)
 * ensures at most one rescue attempt per link body, so a link the update
 * still can't decode falls through to the ordinary invalid-link toast
 * instead of reload-looping.
 *
 * Two things make the guard-and-await interplay subtle enough to warrant
 * comments at each site rather than just in this header:
 *
 *  - `hashBody` is captured once at the top of {@link ShareLinkLoader.tryLoad},
 *    before any `await`. The post-rescue change-detection check deliberately
 *    re-slices the *current* `window.location.hash` instead of reusing that
 *    capture, so it can tell a hashchange landed during the rescue's await
 *    apart from "still the same link" — reusing the capture there would
 *    silently collapse that distinction.
 *  - `wasRescueAttempted(hashBody)` is called twice with opposite readings.
 *    Before the rescue's `await`, it answers "is this load itself the
 *    post-reload re-check for this link". After the `await`, via the
 *    `rescueStillOwnsGuard` alias, it answers "does our guard entry
 *    still name this exact link" — i.e. did no concurrent hashchange
 *    supersede us while we waited. Keeping the two readings behind distinct
 *    names stops the flipped intent from reading as a copy-paste.
 */

import { parseLocationHash, type SharePayload } from '../sharing/index.js';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
    type RescueOutcome,
} from '../pwa/share-link-rescue.js';
import { loadState, clearSavedState } from '../persistence/index.js';
import { showToast, showLoadingOverlay, hideLoadingOverlay } from '../ui/index.js';
import { runWithErrorReport } from './run-with-error-report.js';
import { track } from '../analytics/index.js';

/** Handle returned by {@link createShareLinkLoader}. */
export interface ShareLinkLoader {
    /**
     * Handle a `#p=` link if one is present. Resolves true when the boot
     * flow must not start a puzzle underneath it — either the shared puzzle
     * loaded, or a rescue reload is imminent.
     */
    tryLoad(): Promise<boolean>;
    /** True when a rescue update was applied and a reload is pending. */
    isRescueReloadPending(): boolean;
}

/** Collaborators {@link createShareLinkLoader} cannot own itself. */
export interface ShareLinkLoaderDeps {
    /** Load a decoded share-link payload; `loadSharedPuzzle` bound to the composition root's deps. */
    loadShared: (payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>;
    /** `pwaUpdates.attemptShareLinkRescue`. */
    attemptRescue: () => Promise<RescueOutcome>;
    /** Injected for testing; defaults to `window.confirm`. */
    confirm?: (message: string) => boolean;
}

/**
 * Create a share-link loader. On load: shared-link (hash) > saved game >
 * fresh start — this handles only the first part. The boot flow calls
 * {@link ShareLinkLoader.tryLoad} once and, in its `finally`, checks
 * {@link ShareLinkLoader.isRescueReloadPending} before tearing down the
 * loading overlay; the hashchange listener calls `tryLoad` again for a
 * link pasted into an already-open tab.
 */
export function createShareLinkLoader(deps: ShareLinkLoaderDeps): ShareLinkLoader {
    const confirmDiscard = deps.confirm ?? ((message: string) => window.confirm(message));

    // Set when a rescue update was applied and the page is about to reload:
    // the boot flow's blanket overlay teardown must not run, or the page
    // flashes blank for the up-to-3s gap before the reload lands.
    let rescueReloadPending = false;

    /**
     * After the awaited rescue, does our guard entry still name this exact
     * link? True means no concurrent hashchange superseded us mid-rescue —
     * a newer link's attempt would have overwritten the guard. This is the
     * same predicate as {@link wasRescueAttempted}, named for its post-await
     * meaning: before the await the identical call instead answers "is this
     * load the post-reload re-check". Keeping the two readings behind
     * distinct names stops the flipped intent from reading as a
     * copy-paste.
     */
    function rescueStillOwnsGuard(hashBody: string): boolean {
        return wasRescueAttempted(hashBody);
    }

    /**
     * A `#p=` link that fails to decode may just be newer than this cached
     * build (the share format grows without bumping `v`). Run one
     * update-check-and-reload rescue per link: on success the page reloads
     * with the hash intact and the updated build re-parses it. Returns true
     * when that reload is imminent (the caller must halt the boot flow); on
     * every other outcome the caller falls through to the invalid-link toast.
     */
    async function rescueUndecodableLink(hashBody: string): Promise<boolean> {
        if (wasRescueAttempted(hashBody)) {
            // This load IS the rescue reload for this exact link, and it
            // still doesn't decode: the latest build doesn't understand it
            // either. A same-document hash round-trip back to this link
            // during an in-flight rescue would also land here; that's
            // accepted as a contrived edge case (a real re-paste navigates
            // and gets a fresh page).
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
            // The new worker is activating; the update-controller reloads
            // the page (with a hard-reload fallback). Keep the overlay and
            // hash up.
            rescueReloadPending = true;
            return true;
        }
        // A guard mismatch means a hashchange during our rescue started a
        // newer link's attempt: its guard entry must survive, and the
        // overlay now belongs to that in-flight rescue — leave both alone.
        if (rescueStillOwnsGuard(hashBody)) {
            clearRescueAttempt();
            // The boot path's finally would hide it, but the hashchange path
            // has no such backstop — hide explicitly before the toast.
            hideLoadingOverlay();
        }
        return false;
    }

    async function tryLoad(): Promise<boolean> {
        // Captured once at entry, before any await. `slice(3)` drops the
        // `#p=` prefix and is only meaningful on a `#p=` hash — every use
        // below is gated on that. The post-rescue change-detection check
        // deliberately re-slices the *current* hash instead of reusing
        // this, to spot a hashchange that landed during the await.
        const hashBody = window.location.hash.slice(3);
        const payload = parseLocationHash(window.location.hash);
        if (!payload) {
            if (window.location.hash.startsWith('#p=')) {
                if (await rescueUndecodableLink(hashBody)) {
                    // Rescue reload imminent — report "handled" so the boot
                    // flow doesn't start a saved/fresh game underneath it.
                    return true;
                }
                // A hashchange during the rescue means this invocation's
                // link is no longer the one in the address bar; the newer
                // invocation owns the toast/strip decision now.
                if (window.location.hash.slice(3) !== hashBody) return false;
                showToast('Invalid share link');
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            return false;
        }

        // The link decoded. If this load is the back half of a rescue
        // reload, close the analytics funnel: the update fixed the link.
        // Clearing unconditionally also drops any stale guard from an
        // abandoned rescue.
        if (wasRescueAttempted(hashBody)) {
            track('share-link-rescue-result', { decoded: true });
        }
        clearRescueAttempt();

        // An unreadable save reads as no progress here, so its recovery
        // blobs are not offered for download on this path — corrupt-save
        // recovery is deliberately startup-only. The user is explicitly
        // navigating to a new puzzle, and clearSavedState() below would
        // overwrite the blobs anyway.
        const hasExistingProgress = !!loadState();
        if (hasExistingProgress) {
            const ok = confirmDiscard('Load shared puzzle? Your current progress will be lost.');
            if (!ok) {
                // Leave the hash in place so the user can reload to retry.
                return false;
            }
        }

        clearSavedState();
        history.replaceState(null, '', window.location.pathname + window.location.search);
        // Surface-shape validation (`isValidComposableCf` etc.) catches most
        // malformed payloads at decode time, but a link can still satisfy
        // the schema and then trip the topology pipeline — e.g. a config
        // combination the current build doesn't support. Report it and
        // toast rather than letting it surface as an unhandled rejection.
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
