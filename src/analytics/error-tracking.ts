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
 * Conservatively drop `error` events that are pure noise rather than
 * signal:
 *
 * - Opaque cross-origin script errors. A script loaded without CORS
 *   surfaces as a bare `"Script error."` with an empty filename and no
 *   `error` object — the browser strips everything actionable, so it's
 *   un-triageable.
 * - Exceptions thrown from browser-extension content scripts, which
 *   inject into the page but aren't our code (identified by an
 *   extension-scheme `filename`).
 *
 * Kept deliberately narrow so a real application error is never
 * swallowed. Promise rejections are not filtered: extension content
 * scripts run in isolated worlds and rarely surface rejections into the
 * page's realm, so an `unhandledrejection` here is almost always ours.
 */
function isIgnorableErrorEvent(event: ErrorEvent): boolean {
    if (/^script error\.?$/i.test((event.message ?? '').trim())) {
        return true;
    }
    return /^[a-z-]*extension:\/\//i.test(event.filename ?? '');
}

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
        if (isIgnorableErrorEvent(event)) return;
        const cause = event.error ?? event.message;
        const reason = sanitizeErrorReason(cause);
        diagnostics.warn('Uncaught error:', cause);
        track('unhandled-error', { kind: 'error', reason });
    });
}
