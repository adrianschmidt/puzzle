/**
 * PWA update controller — decides *when* a freshly-built service worker is
 * applied, without disrupting an in-progress puzzle. Every DOM / SW side
 * effect (flush autosave, activate the new SW, show the indicator) is injected,
 * keeping the decision logic unit-testable. `track` / `diagnostics` are
 * imported directly as fire-and-forget observability, not decision inputs.
 */

import { track, sanitizeErrorReason } from '../analytics/index.js';
import type { PwaUpdateAppliedData } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';

/** Derived from the analytics payload — single source of truth, no new coupling. */
export type UpdateApplyTrigger = PwaUpdateAppliedData['trigger'];

export interface UpdatableRegistration {
    update(): Promise<unknown> | void;
}

export interface UpdateControllerDeps {
    /** Flush any pending autosave before the page reloads. */
    flush: () => void;
    /**
     * Render the persistent "update ready" indicator. The supplied callback
     * applies the update (reload) when the user taps it.
     */
    showIndicator: (onRefresh: () => void) => void;
    /**
     * Hard reload fallback for when the SW-driven reload doesn't occur (e.g. a
     * sibling tab on this shared origin already activated the new worker, so
     * skip-waiting is a no-op and no `controlling` event fires). Defaults to a
     * full-page reload.
     */
    reload?: () => void;
    /** Defaults to `globalThis.setTimeout`. */
    scheduleFallback?: (handler: () => void, ms: number) => void;
    /** Defaults to 3000 ms. */
    fallbackReloadMs?: number;
}

export interface UpdateController {
    /** A new service worker is waiting — remember it and surface the indicator. */
    onNeedRefresh(): void;
    /** Supply the `updateSW` function returned by `registerSW`. */
    setUpdateSW(updateSW: (reload?: boolean) => Promise<void>): void;
    requestReloadIfPending(): void;
    reloadNow(trigger?: UpdateApplyTrigger): void;
    readonly pending: boolean;
}

export function createUpdateController(
    deps: UpdateControllerDeps,
): UpdateController {
    let pending = false;
    let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
    let reloading = false;
    // Buffers a reload requested before `setUpdateSW` runs: `registerSW`
    // returns the `updateSW` handle only after it's called, so onNeedRefresh
    // (or a tap) can fire first — e.g. a worker already waiting on a warm
    // registration — and would otherwise silently no-op. The buffered value is
    // the original trigger, so the deferred apply reports how it was triggered.
    let bufferedTrigger: UpdateApplyTrigger | null = null;

    const reload = deps.reload ?? (() => location.reload());
    const scheduleFallback =
        deps.scheduleFallback ??
        ((handler: () => void, ms: number) => {
            globalThis.setTimeout(handler, ms);
        });
    const fallbackReloadMs = deps.fallbackReloadMs ?? DEFAULT_FALLBACK_RELOAD_MS;

    function apply(trigger: UpdateApplyTrigger): void {
        if (reloading) return;
        if (!updateSW) {
            bufferedTrigger = trigger;
            return;
        }
        // Latch on first call, never reset: once committed to reloading we stay
        // committed. The scheduled fallback covers an updateSW(true) rejection.
        reloading = true;
        track('pwa-update-applied', { trigger });
        deps.flush();
        // Surface a consistently-failing activation; the fallback still recovers.
        void Promise.resolve(updateSW(true)).catch((err: unknown) => {
            diagnostics.warn('[pwa] updateSW(true) rejected', err);
            track('pwa-update-apply-failed', {
                reason: sanitizeErrorReason(err),
            });
        });

        // The normal path reloads via workbox's `controlling` event before this
        // fires. The fallback only runs when that event never arrives (the #404
        // shared-origin case), where a hard reload loads the new worker.
        scheduleFallback(() => {
            track('pwa-update-fallback-reload', {});
            reload();
        }, fallbackReloadMs);
    }

    return {
        onNeedRefresh() {
            pending = true;
            track('pwa-update-detected', {});
            deps.showIndicator(() => apply('manual'));
        },
        setUpdateSW(fn) {
            updateSW = fn;
            if (bufferedTrigger !== null) {
                const trigger = bufferedTrigger;
                bufferedTrigger = null;
                apply(trigger);
            }
        },
        requestReloadIfPending() {
            // Safe only because the save coordinator (app/save-coordinator.ts)
            // flushes the debounced save on visibilitychange→hidden / pagehide,
            // so progress is persisted before the app is backgrounded.
            if (pending) apply('focus-regain');
        },
        reloadNow(trigger = 'manual') {
            apply(trigger);
        },
        get pending() {
            return pending;
        },
    };
}

const DEFAULT_FALLBACK_RELOAD_MS = 3000;

export interface UpdateCheckDeps {
    addVisibilityListener?: (handler: () => void) => void;
    isVisible?: () => boolean;
}

/**
 * No background timer: two event-driven triggers cover every case. Page load
 * already checks (registering the SW in `register.ts` fetches and byte-compares
 * the script), and `visibilitychange → visible` checks and applies any pending
 * update (returning to a long-lived tab, reopening from the home screen). An
 * interval would only help a tab left open and foregrounded for hours.
 */
export function setupUpdateChecks(
    registration: UpdatableRegistration,
    controller: UpdateController,
    deps: UpdateCheckDeps = {},
): void {
    const isVisible =
        deps.isVisible ?? (() => document.visibilityState === 'visible');
    const addVisibilityListener =
        deps.addVisibilityListener ??
        ((handler: () => void) =>
            document.addEventListener('visibilitychange', handler));

    // A failed update *check* self-heals on the next visibility change, but is
    // still labeled `pwa-update-check-failed` so the funnel is complete rather
    // than surfacing as a generic unhandled-error. Checks fire on every
    // visibility regain, so guard against flooding: report each distinct reason
    // at most once per session, and cap the number of distinct reasons.
    const reportedReasons = new Set<string>();
    function reportCheckFailure(err: unknown): void {
        const reason = sanitizeErrorReason(err);
        if (reportedReasons.has(reason)) return;
        if (reportedReasons.size >= MAX_CHECK_FAILURE_REASONS) return;
        reportedReasons.add(reason);
        diagnostics.warn('[pwa] registration.update() rejected', err);
        track('pwa-update-check-failed', { reason });
    }

    // update() returns `Promise<unknown> | void`; Promise.resolve makes the
    // void case a no-op rather than a throw.
    function checkForUpdate(): void {
        void Promise.resolve(registration.update()).catch(reportCheckFailure);
    }

    addVisibilityListener(() => {
        if (!isVisible()) return;
        checkForUpdate();
        controller.requestReloadIfPending();
    });
}

const MAX_CHECK_FAILURE_REASONS = 5;
