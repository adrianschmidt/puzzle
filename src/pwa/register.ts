/**
 * Wires service-worker update handling for the PWA. Kept as thin glue: all
 * decision logic lives in `update-controller.ts` (unit-tested) and the
 * indicator UI in `ui/update-available-indicator.ts`. `virtual:pwa-register`
 * is provided by vite-plugin-pwa and only exists at build time, so this file
 * is intentionally not imported from the `pwa/index.ts` barrel (that would
 * pull the virtual module into unit tests).
 */

import { registerSW } from 'virtual:pwa-register';
import {
    createUpdateController,
    setupUpdateChecks,
} from './update-controller.js';
import { createUpdateAvailableIndicator } from '../ui/index.js';

/**
 * Initialize PWA update handling.
 *
 * @param flush  Flush pending autosave before any reload, so a change made
 *               within the autosave debounce window survives the version
 *               switch.
 */
export function initPwaUpdates(flush: () => void): void {
    const controller = createUpdateController({
        flush,
        showIndicator: (onRefresh) => {
            createUpdateAvailableIndicator({ onRefresh });
        },
    });

    const updateSW = registerSW({
        onNeedRefresh() {
            controller.onNeedRefresh();
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (registration) setupUpdateChecks(registration, controller);
        },
    });

    controller.setUpdateSW(updateSW);
}
