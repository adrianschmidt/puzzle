/**
 * PWA update controller — decides *when* a freshly-built service worker is
 * applied, without disrupting an in-progress puzzle.
 *
 * The controller holds no DOM or service-worker references of its own; every
 * DOM / service-worker side effect (flushing the autosave, activating the new
 * SW, showing the indicator) is injected, which keeps the decision logic
 * unit-testable. Analytics (`track`) and diagnostics are imported directly as
 * ambient observability, following the codebase-wide convention — they are
 * fire-and-forget reporting, not decision inputs, so they need not be injected.
 */

import { track, sanitizeErrorReason } from '../analytics/index.js';
import type { PwaUpdateAppliedData } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';

/**
 * What caused an update to be applied — surfaced on the analytics event.
 * Derived from the analytics payload so the union has a single source of truth
 * (the controller already depends on analytics, so this adds no new coupling).
 */
export type UpdateApplyTrigger = PwaUpdateAppliedData['trigger'];

/** Minimal slice of ServiceWorkerRegistration we depend on. */
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
     * Hard reload used as a fallback when the service-worker-driven reload
     * does not occur (e.g. the new worker was already activated by another
     * tab on this shared origin, so skip-waiting is a no-op and no
     * `controlling` event fires). Defaults to a full-page reload.
     */
    reload?: () => void;
    /**
     * Schedules the fallback reload. Injectable for tests. Defaults to
     * `globalThis.setTimeout`.
     */
    scheduleFallback?: (handler: () => void, ms: number) => void;
    /** Delay before the fallback reload fires. Defaults to 3000ms. */
    fallbackReloadMs?: number;
}

export interface UpdateController {
    /** A new service worker is waiting — remember it and surface the indicator. */
    onNeedRefresh(): void;
    /** Supply the `updateSW` function returned by `registerSW`. */
    setUpdateSW(updateSW: (reload?: boolean) => Promise<void>): void;
    /** Apply the update only if one is pending (e.g. on focus regain). */
    requestReloadIfPending(): void;
    /** Apply the update now (manual indicator tap). */
    reloadNow(): void;
    /** Whether an update is currently waiting to be applied. */
    readonly pending: boolean;
}

export function createUpdateController(
    deps: UpdateControllerDeps,
): UpdateController {
    let pending = false;
    let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
    let reloading = false;
    // Buffers a reload requested before `setUpdateSW` has run. `registerSW`
    // returns the `updateSW` handle only after it is called, so there is an
    // unavoidable window where `onNeedRefresh` (and a user tap on the
    // indicator) can fire before the handle is available — e.g. a worker
    // already waiting on a warm registration. Without this latch that tap
    // would silently no-op and `pending` would stay true until the next
    // focus-regain. We instead remember the request and apply it the moment
    // the handle arrives. The buffered value is the original trigger, so the
    // deferred apply still reports how it was first triggered.
    let bufferedTrigger: UpdateApplyTrigger | null = null;

    // Resolve the injectable defaults once at construction rather than on
    // every `reloadNow` call.
    const reload = deps.reload ?? (() => location.reload());
    const scheduleFallback =
        deps.scheduleFallback ??
        ((handler: () => void, ms: number) => {
            globalThis.setTimeout(handler, ms);
        });
    const fallbackReloadMs = deps.fallbackReloadMs ?? DEFAULT_FALLBACK_RELOAD_MS;

    function apply(trigger: UpdateApplyTrigger): void {
        if (reloading) return;
        // No waiting-worker handle yet: remember the request so it is applied
        // the moment `setUpdateSW` supplies the handle (see `setUpdateSW`).
        if (!updateSW) {
            bufferedTrigger = trigger;
            return;
        }
        // Latch on first call and never reset: once we commit to reloading we
        // stay committed. The scheduled fallback below covers the case where
        // `updateSW(true)` rejects, so there is no need to re-enable retries.
        reloading = true;
        track('pwa-update-applied', { trigger });
        deps.flush();
        // Surface a consistently-failing activation instead of letting it be
        // silent; the scheduled fallback below still recovers the page.
        void Promise.resolve(updateSW(true)).catch((err: unknown) => {
            diagnostics.warn('[pwa] updateSW(true) rejected', err);
            track('pwa-update-apply-failed', {
                reason: sanitizeErrorReason(err),
            });
        });

        // The normal path reloads via workbox's `controlling` event, which
        // navigates the page away before this timer fires. The fallback only
        // actually runs when that event never arrives (the #404 shared-origin
        // case), where a hard reload still loads the now-active new worker.
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
            // Apply any reload that was requested before the handle existed.
            if (bufferedTrigger !== null) {
                const trigger = bufferedTrigger;
                bufferedTrigger = null;
                apply(trigger);
            }
        },
        requestReloadIfPending() {
            // Note: focus-regain reload is only safe because `main.ts` flushes
            // the debounced save on `visibilitychange → hidden` / `pagehide`,
            // so progress is already persisted before the app is backgrounded.
            if (pending) apply('focus-regain');
        },
        reloadNow() {
            apply('manual');
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
 * Wire up update detection for a registered service worker.
 *
 * We deliberately run *no* background timer. Two event-driven triggers cover
 * every case without one:
 * - page load already checks for a new worker, because registering the service
 *   worker (in `register.ts`) makes the browser fetch and byte-compare the SW
 *   script — so anyone who closes and reopens the app updates on the next open;
 * - `visibilitychange → visible` checks for an update (catches "returned to a
 *   long-lived tab" and "reopened from the home screen") and applies any
 *   already-pending update.
 *
 * An always-on interval only ever added value for a tab left open *and*
 * continuously foregrounded for hours — a niche the two triggers above make
 * not worth polling in the background for.
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

    // A failed update *check* is best-effort and self-heals on the next
    // visibility change, but we still label it as `pwa-update-check-failed` so
    // the funnel is complete (detected → check failures → applied / apply-
    // failed) instead of leaving the rejection to surface as a generic
    // `unhandled-error`.
    //
    // Checks fire on every visibility regain, so an offline or server-error
    // session could reject on each return to the tab. Guard against flooding:
    // report each distinct sanitized `reason` at most once per session, and cap
    // the number of distinct reasons (a cardinality bound against pathologically
    // varying messages). This mirrors the backstop's per-reason + total caps but
    // is stricter — once per reason is enough for a "is this path failing"
    // funnel signal; repetition adds no information.
    const reportedReasons = new Set<string>();
    function reportCheckFailure(err: unknown): void {
        const reason = sanitizeErrorReason(err);
        if (reportedReasons.has(reason)) return;
        if (reportedReasons.size >= MAX_CHECK_FAILURE_REASONS) return;
        reportedReasons.add(reason);
        diagnostics.warn('[pwa] registration.update() rejected', err);
        track('pwa-update-check-failed', { reason });
    }

    // `registration.update()` returns `Promise<unknown> | void`; wrap in
    // `Promise.resolve` so the void case is a no-op rather than a throw.
    function checkForUpdate(): void {
        void Promise.resolve(registration.update()).catch(reportCheckFailure);
    }

    addVisibilityListener(() => {
        if (!isVisible()) return;
        checkForUpdate();
        controller.requestReloadIfPending();
    });
}

/** Max distinct check-failure reasons reported per session (cardinality guard). */
const MAX_CHECK_FAILURE_REASONS = 5;
