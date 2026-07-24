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
import type { UpdatableRegistration } from './update-controller.js';

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

/**
 * Minimal slice of ServiceWorkerRegistration the rescue depends on. Extends
 * the update-controller's {@link UpdatableRegistration} (the source of
 * `update()`) with the `installing` / `waiting` fields the rescue null-checks
 * to tell "already latest" from "an install is under way". Both are only ever
 * null-checked, hence `unknown`.
 */
export interface RescueRegistration extends UpdatableRegistration {
    readonly installing: unknown;
    readonly waiting: unknown;
}

export interface ShareLinkRescueDeps {
    /**
     * Resolves with the SW registration once known, or null when
     * registration failed. May never resolve (no SW registered — e.g. the
     * dev server); the deadline turns that into `unavailable`.
     */
    getRegistration: () => Promise<RescueRegistration | null>;
    /** True when a new worker is already waiting (detected before the rescue). */
    isUpdateReady: () => boolean;
    /** Subscribe to "a new worker is waiting"; returns an unsubscribe. */
    onUpdateReady: (handler: () => void) => () => void;
    /** Activate the waiting update (flush + skip-waiting + reload). */
    applyUpdate: () => void;
    /** Overall deadline for the whole attempt. Defaults to 8000ms. */
    timeoutMs?: number;
    /** Injectable timer for tests; returns a cancel function. */
    schedule?: (handler: () => void, ms: number) => () => void;
    /**
     * Diagnostics breadcrumb for the reject paths (a `getRegistration()` or
     * `update()` rejection collapses into `unavailable`, discarding the error).
     * Injected — not imported — so `diagnostics` (and its DOM/console reach)
     * stays out of this module's unit-test graph; `register.ts` wires the real
     * `diagnostics.warn`. Optional: tests omit it. Mirrors the sibling
     * update-controller path, which logs the same rejections.
     */
    warn?: (message: string, err: unknown) => void;
}

const DEFAULT_RESCUE_TIMEOUT_MS = 8000;

/**
 * Run one update-check rescue. Resolves `updated` after calling
 * `applyUpdate` (a reload is then imminent — the caller should halt boot),
 * `no-update` when the client is already current, or `unavailable` when
 * the check can't run or the deadline expires. Never rejects.
 */
export function attemptShareLinkRescue(deps: ShareLinkRescueDeps): Promise<RescueOutcome> {
    const timeoutMs = deps.timeoutMs ?? DEFAULT_RESCUE_TIMEOUT_MS;
    const schedule =
        deps.schedule ??
        ((handler: () => void, ms: number) => {
            const id = globalThis.setTimeout(handler, ms);
            return () => globalThis.clearTimeout(id);
        });

    return new Promise((resolve) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;

        const settle = (outcome: RescueOutcome): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            cancelDeadline();
            if (outcome === 'updated') deps.applyUpdate();
            resolve(outcome);
        };

        const cancelDeadline = schedule(() => settle('unavailable'), timeoutMs);

        if (deps.isUpdateReady()) {
            settle('updated');
            return;
        }
        unsubscribe = deps.onUpdateReady(() => settle('updated'));

        void (async () => {
            let registration: RescueRegistration | null;
            try {
                registration = await deps.getRegistration();
            } catch (err) {
                deps.warn?.('[pwa] share-link rescue getRegistration() rejected', err);
                settle('unavailable');
                return;
            }
            if (settled) return;
            if (!registration) {
                settle('unavailable');
                return;
            }
            try {
                await Promise.resolve(registration.update());
            } catch (err) {
                deps.warn?.('[pwa] share-link rescue registration.update() rejected', err);
                settle('unavailable');
                return;
            }
            if (settled) return;
            // The check resolved without starting an install and nothing is
            // waiting: this client is already the latest build. If a worker
            // IS installing/waiting, the onUpdateReady subscription (or the
            // deadline, if installation hangs) settles the attempt. Narrow
            // multi-tab corner case: a stale page whose new worker was
            // already activated by another tab (so this tab's own
            // onNeedRefresh never fired) also lands here and reports
            // no-update; it self-heals on the next manual reload.
            if (!registration.installing && !registration.waiting) {
                settle('no-update');
            }
        })();
    });
}
