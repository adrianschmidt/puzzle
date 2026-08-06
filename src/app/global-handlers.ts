/**
 * Global page-level wiring that isn't owned by any single feature.
 *
 * Call once, as early as possible in boot: the internal ordering — analytics
 * before error tracking before the service-worker error bridge — puts every
 * reporting channel up before anything else that can throw.
 */

import { initAnalytics, initErrorTracking } from '../analytics/index.js';
import { initSwErrorReporting } from '../pwa/sw-error-bridge.js';

export function installGlobalHandlers(container: HTMLElement): void {
    // Suppress the browser context menu on the puzzle table only.
    // On touch devices (especially iPad), long-pressing a piece would
    // otherwise trigger the context menu, interfering with drag. We
    // can't target the table directly here because it's created later
    // by renderer.init; delegate from #app and check the event target
    // so context menus inside the info modal / debug panels still
    // reach the browser (otherwise the user can't copy share links
    // or reproduction parameters via long-press).
    container.addEventListener('contextmenu', (e) => {
        const target = e.target as Element | null;
        if (target?.closest('[data-puzzle-table]')) {
            e.preventDefault();
        }
    });

    initAnalytics();

    // Global backstop: report unhandled rejections / uncaught errors that
    // no local try/catch handled. Observe-only; never swallows them.
    initErrorTracking();

    // Companion backstop for the service worker's own scope (#430): the
    // `window` listeners above run in the page realm and never see exceptions
    // thrown inside the worker, so the worker posts those here for reporting.
    initSwErrorReporting();

    // Resource Timing entries back the traced-chunk `cacheState` dimension
    // (see detectCacheState in traced-tab-loader.ts). The 250-entry default
    // buffer can evict the chunk's entry on long-lived PWA sessions, which
    // would degrade the signal to `unknown`; a larger buffer keeps it
    // reliable at negligible memory cost.
    performance.setResourceTimingBufferSize?.(500);

    // Injected at build time by the deploy workflow via VITE_APP_VERSION.
    const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
    if (appVersion) {
        const versionEl = document.createElement('div');
        versionEl.className = 'app-version';
        versionEl.textContent = appVersion;
        container.appendChild(versionEl);
    }
}
