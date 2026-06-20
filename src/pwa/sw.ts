/**
 * Custom service worker (Workbox `injectManifest` strategy).
 *
 * The repo previously built the worker via Workbox `generateSW`, which has
 * no source file: the plugin generated precache + navigation routing for us.
 * Instrumenting the worker's own scope (#430) needs real `self.addEventListener`
 * handlers, which only a hand-written worker can carry — hence the switch to
 * `injectManifest`, where this file IS the worker and the build only injects
 * the precache manifest at `self.__WB_MANIFEST`.
 *
 * This file therefore has to reproduce the behaviors `generateSW` gave us for
 * free — precache + cleanup, the SPA navigation fallback with the
 * cross-deployment denylist, and the `prompt`-mode skip-waiting handshake —
 * plus the new error backstop. Keep it thin: the testable error logic lives
 * in `sw-error-reporter.ts`.
 */

import {
    precacheAndRoute,
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { createSwErrorReporter } from './sw-error-reporter.js';

// `__WB_MANIFEST` is the literal injection point Workbox replaces with the
// precache manifest at build time (`injectionPoint: 'self.__WB_MANIFEST'`);
// the string must appear verbatim, so don't rename `self` here.
declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Precache everything the build injects at this point, and drop caches left
// by older Workbox revisions (the plugin set `cleanupOutdatedCaches` for the
// generateSW build; preserve that).
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback → the precached index.html. The denylist mirrors
// `navigateFallbackDenylist` from vite.config.ts: don't serve this
// deployment's index.html for navigations into a sibling deployment under the
// same origin (e.g. /puzzle/dev/ when we're the /puzzle/ production build).
const base = import.meta.env.BASE_URL;
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
registerRoute(
    new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), {
        denylist: [new RegExp(`^${escapedBase}[^/]+/`)],
    }),
);

// `registerType: 'prompt'`: never activate a waiting worker on our own.
// `virtual:pwa-register`'s `updateSW(true)` posts `{type: 'SKIP_WAITING'}`
// once the page commits to reloading (see pwa/update-controller.ts); only
// then do we take over. generateSW wired this handshake automatically.
self.addEventListener('message', (event) => {
    if ((event.data as { type?: unknown } | null)?.type === 'SKIP_WAITING') {
        void self.skipWaiting();
    }
});

// #430: report failures thrown inside the worker's own scope — message
// handlers, lifecycle/timer callbacks — which the page's `window` listeners
// can't see. The reporter sanitizes + rate-limits; we forward each finished
// report to every open window, where the page bridge relays it to analytics.
//
// Coverage is deliberately limited to what the worker's global `error` and
// `unhandledrejection` events surface: synchronous throws and unhandled
// promise rejections. It does NOT capture failures that the platform routes
// elsewhere — a `FetchEvent.respondWith` rejection, a precache install
// failure, or an `ExtendableEvent.waitUntil` rejection surface as the event's
// own failure (a network error / failed install / failed activation), not as
// a global error. Don't read the absence of `sw-error`/`sw-rejection` events
// as proof those paths are healthy.
//
// Delivery is best-effort: when no window client is open (e.g. the worker
// woke for a background event with every tab closed), `matchAll` returns an
// empty list and the report is silently dropped — there is nowhere to relay
// it, since only the page can call `track()`.
const reporter = createSwErrorReporter({
    post: (report) => {
        void self.clients
            .matchAll({ includeUncontrolled: true, type: 'window' })
            .then((clients) => {
                for (const client of clients) client.postMessage(report);
            });
    },
});
self.addEventListener('error', (event) => {
    reporter.report('sw-error', event.error ?? event.message);
});
self.addEventListener('unhandledrejection', (event) => {
    reporter.report('sw-rejection', event.reason);
});
