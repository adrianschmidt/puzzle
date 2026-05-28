/**
 * App-wide backstop for async failures that no local `try/catch`
 * handled. Registers global `unhandledrejection` and `error` listeners
 * and reports each to Umami as an `unhandled-error` event.
 *
 * Observe-only: the listeners never call `preventDefault()`, so the
 * browser's own console logging still happens. `diagnostics.warn`
 * mirrors them in dev/test (it's a no-op in production builds).
 *
 * The traced-chunk preload paths catch and report their own failures
 * (`traced-chunk-load-failed`), so they don't reach here; this catches
 * everything else — image fetches, persistence, future async code, and
 * the service worker.
 */

import { diagnostics } from '../diagnostics.js';
import { track } from './umami.js';
import { sanitizeErrorReason } from './sanitize-error-reason.js';

/**
 * Install the global handlers. Call once at boot, after
 * {@link import('./umami.js').initAnalytics}. No-op when there is no
 * `window` (non-browser/test contexts).
 */
export function initErrorTracking(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('unhandledrejection', (event) => {
        const reason = sanitizeErrorReason(event.reason);
        diagnostics.warn('Unhandled promise rejection:', event.reason);
        track('unhandled-error', { kind: 'rejection', reason });
    });

    // No capture phase, so failed-resource load errors (which only reach
    // window in the capture phase) don't land here — only uncaught
    // script exceptions do.
    window.addEventListener('error', (event) => {
        const cause = event.error ?? event.message;
        const reason = sanitizeErrorReason(cause);
        diagnostics.warn('Uncaught error:', cause);
        track('unhandled-error', { kind: 'error', reason });
    });
}
