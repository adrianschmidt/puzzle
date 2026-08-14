/**
 * Thin glue; decision logic lives in `update-controller.ts` (unit-tested).
 * `virtual:pwa-register` only exists at build time, so this file is
 * deliberately not re-exported from `pwa/index.ts` — that would pull the
 * virtual module into unit tests.
 */

import { registerSW } from 'virtual:pwa-register';
import {
    createUpdateController,
    setupUpdateChecks,
} from './update-controller.js';
import {
    attemptShareLinkRescue,
    type RescueOutcome,
    type RescueRegistration,
} from './share-link-rescue.js';
import { createUpdateAvailableIndicator } from '../ui/index.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';

export interface PwaUpdates {
    attemptShareLinkRescue: () => Promise<RescueOutcome>;
}

/**
 * @param flush  Flush pending autosave before any reload, so a change inside
 *               the debounce window survives the version switch.
 */
export function initPwaUpdates(flush: () => void): PwaUpdates {
    const controller = createUpdateController({
        flush,
        showIndicator: (onRefresh) => {
            createUpdateAvailableIndicator({ onRefresh });
        },
    });

    // The registration arrives asynchronously via onRegisteredSW; a rescue
    // started earlier awaits this promise (bounded by its own deadline — it
    // never resolves on the dev server, where no SW registers).
    let resolveRegistration: (r: RescueRegistration | null) => void = () => {};
    const registrationPromise = new Promise<RescueRegistration | null>(
        (resolve) => { resolveRegistration = resolve; },
    );
    const updateReadyListeners = new Set<() => void>();

    const updateSW = registerSW({
        onNeedRefresh() {
            controller.onNeedRefresh();
            for (const listener of updateReadyListeners) listener();
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (registration) setupUpdateChecks(registration, controller);
            resolveRegistration(registration ?? null);
        },
        // If the SW can't register, there's no update funnel for the session.
        // Label it rather than let it surface as a generic unhandled-error.
        // Fires at most once per load, so it needs no flood guard.
        onRegisterError(error) {
            resolveRegistration(null);
            diagnostics.warn('[pwa] service worker registration failed', error);
            track('pwa-register-failed', { reason: sanitizeErrorReason(error) });
        },
    });

    controller.setUpdateSW(updateSW);

    return {
        attemptShareLinkRescue: () =>
            attemptShareLinkRescue({
                getRegistration: () => registrationPromise,
                isUpdateReady: () => controller.pending,
                onUpdateReady: (handler) => {
                    updateReadyListeners.add(handler);
                    return () => updateReadyListeners.delete(handler);
                },
                applyUpdate: () => controller.reloadNow('share-link-rescue'),
                warn: (message, err) => diagnostics.warn(message, err),
            }),
    };
}
