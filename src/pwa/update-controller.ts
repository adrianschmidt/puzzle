/**
 * PWA update controller — decides *when* a freshly-built service worker is
 * applied, without disrupting an in-progress puzzle.
 *
 * The controller holds no DOM or service-worker references of its own; every
 * side effect (flushing the autosave, activating the new SW, showing the
 * indicator) is injected, which keeps the decision logic unit-testable.
 */

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

    function reloadNow(): void {
        // Without the updateSW handle there is no waiting worker to activate.
        if (!updateSW) return;
        deps.flush();
        void updateSW(true);
    }

    return {
        onNeedRefresh() {
            pending = true;
            deps.showIndicator(reloadNow);
        },
        setUpdateSW(fn) {
            updateSW = fn;
        },
        requestReloadIfPending() {
            if (pending) reloadNow();
        },
        reloadNow,
        get pending() {
            return pending;
        },
    };
}

const DEFAULT_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface UpdateCheckDeps {
    pollIntervalMs?: number;
    setInterval?: (handler: () => void, ms: number) => unknown;
    addVisibilityListener?: (handler: () => void) => void;
    isVisible?: () => boolean;
}

/**
 * Wire up update detection for a registered service worker:
 * - poll `registration.update()` on an interval while the app is open;
 * - on every visibility → visible, check for an update (catches "reopened
 *   from the home screen") and apply any already-pending update.
 */
export function setupUpdateChecks(
    registration: UpdatableRegistration,
    controller: UpdateController,
    deps: UpdateCheckDeps = {},
): void {
    const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const setIntervalFn =
        deps.setInterval ??
        ((handler: () => void, ms: number) => globalThis.setInterval(handler, ms));
    const isVisible =
        deps.isVisible ?? (() => document.visibilityState === 'visible');
    const addVisibilityListener =
        deps.addVisibilityListener ??
        ((handler: () => void) =>
            document.addEventListener('visibilitychange', handler));

    setIntervalFn(() => {
        void registration.update();
    }, pollIntervalMs);

    addVisibilityListener(() => {
        if (!isVisible()) return;
        void registration.update();
        controller.requestReloadIfPending();
    });
}
