/**
 * Stale-client share-link rescue: when a `#p=` link fails to decode, this
 * client may be an old cached build predating the link's format. Two halves:
 * a sessionStorage loop guard (exactly one rescue per link — the attempt
 * reloads, so the guard stops a still-invalid link reload-looping), and the
 * attempt itself (force a SW update check; if a newer build is waiting, apply
 * it and reload with the hash intact).
 *
 * sessionStorage, not localStorage, so a stale guard can't outlive the tab and
 * suppress a legitimate future rescue. All SW specifics are injected by
 * `register.ts`.
 */

import type { ShareLinkRescueAttemptedData } from '../analytics/index.js';
import type { UpdatableRegistration } from './update-controller.js';

/** Single source of truth: the analytics payload. */
export type RescueOutcome = ShareLinkRescueAttemptedData['outcome'];

const GUARD_KEY = 'share-link-rescue-attempt';

export function wasRescueAttempted(hashBody: string, storage?: Storage): boolean {
    try {
        return (storage ?? sessionStorage).getItem(GUARD_KEY) === hashBody;
    } catch {
        return false;
    }
}

/**
 * Returns true only when the guard verifiably persisted — callers must skip
 * the rescue on false, because an unpersisted guard would let a
 * still-invalid link reload-loop forever.
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

/** Every terminal path of the rescue flow ends here. */
export function clearRescueAttempt(storage?: Storage): void {
    try {
        (storage ?? sessionStorage).removeItem(GUARD_KEY);
    } catch {
        // Storage unavailable.
    }
}

/**
 * `installing` / `waiting` are only ever null-checked (to tell "already latest"
 * from "install under way"), hence `unknown`.
 */
export interface RescueRegistration extends UpdatableRegistration {
    readonly installing: unknown;
    readonly waiting: unknown;
}

export interface ShareLinkRescueDeps {
    /**
     * Null when registration failed. May never resolve (no SW registered —
     * e.g. the dev server); the deadline turns that into `unavailable`.
     */
    getRegistration: () => Promise<RescueRegistration | null>;
    /** True when a new worker is already waiting (detected before the rescue). */
    isUpdateReady: () => boolean;
    /** Subscribe to "a new worker is waiting"; returns an unsubscribe. */
    onUpdateReady: (handler: () => void) => () => void;
    /** Activate the waiting update (flush + skip-waiting + reload). */
    applyUpdate: () => void;
    /** Overall deadline for the whole attempt. Defaults to 8000 ms. */
    timeoutMs?: number;
    /** Injectable timer for tests; returns a cancel function. */
    schedule?: (handler: () => void, ms: number) => () => void;
    /**
     * Breadcrumb for the reject paths (a rejection collapses into `unavailable`,
     * discarding the error). Injected, not imported, so `diagnostics` stays out
     * of this module's unit-test graph.
     */
    warn?: (message: string, err: unknown) => void;
}

const DEFAULT_RESCUE_TIMEOUT_MS = 8000;

/**
 * Resolves `updated` after calling `applyUpdate` (a reload is then imminent
 * — the caller should halt boot), `no-update` when the client is already
 * current, or `unavailable` when the check can't run or the deadline
 * expires. Never rejects.
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
            // No install started and nothing waiting: already the latest build.
            // If a worker IS installing/waiting, onUpdateReady (or the deadline)
            // settles it. Multi-tab corner: a stale page whose new worker was
            // already activated elsewhere also lands here as no-update and
            // self-heals on the next manual reload.
            if (!registration.installing && !registration.waiting) {
                settle('no-update');
            }
        })();
    });
}
