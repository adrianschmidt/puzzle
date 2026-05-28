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

/** Max reports of any one distinct `reason` per session. */
const MAX_PER_REASON = 5;
/** Max total reports per session before a flood is capped. */
const MAX_TOTAL = 50;

/**
 * Constructor name of a thrown value, for the low-cardinality `name`
 * dimension. `'unknown'` when the value isn't an `Error` (rejections
 * can carry strings/objects).
 */
function errorName(value: unknown): string {
    return value instanceof Error ? (value.name || 'Error') : 'unknown';
}

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
 * {@link import('./umami.js').initAnalytics}. Returns a disposer that
 * removes the listeners (used by tests; the app keeps them for its
 * lifetime). No-op — returning a no-op disposer — when there is no
 * `window` (non-browser/test contexts).
 *
 * Rate limiting (per-session, state scoped to this call) protects the
 * analytics stream from a tight error loop: each distinct `reason` is
 * reported at most {@link MAX_PER_REASON} times and the session at most
 * {@link MAX_TOTAL} times. When the global cap is first hit, a single
 * `RateLimited` notice is emitted so the flood is visible, then the
 * backstop goes quiet (the browser still logs everything natively).
 */
export function initErrorTracking(): () => void {
    if (typeof window === 'undefined') return () => {};

    const reasonCounts = new Map<string, number>();
    let totalSent = 0;
    let capNoticeSent = false;

    function reportingAllowed(reason: string): boolean {
        if (totalSent >= MAX_TOTAL) return false;
        const seen = reasonCounts.get(reason) ?? 0;
        if (seen >= MAX_PER_REASON) return false;
        reasonCounts.set(reason, seen + 1);
        totalSent += 1;
        return true;
    }

    function report(source: 'rejection' | 'error', cause: unknown): void {
        const reason = sanitizeErrorReason(cause);
        if (reportingAllowed(reason)) {
            diagnostics.warn(
                source === 'rejection' ? 'Unhandled promise rejection:' : 'Uncaught error:',
                cause,
            );
            track('unhandled-error', { source, name: errorName(cause), reason });
            return;
        }
        // Surface the flood once (only when the *global* cap is the
        // blocker, not ordinary per-reason dedup), then stay silent.
        if (totalSent >= MAX_TOTAL && !capNoticeSent) {
            capNoticeSent = true;
            track('unhandled-error', {
                source: 'error',
                name: 'RateLimited',
                reason: `unhandled-error cap (${MAX_TOTAL}/session) reached; further errors dropped`,
            });
        }
    }

    const onRejection = (event: PromiseRejectionEvent): void => {
        report('rejection', event.reason);
    };

    // No capture phase, so failed-resource load errors (which only reach
    // window in the capture phase) don't land here — only uncaught
    // script exceptions do.
    const onError = (event: ErrorEvent): void => {
        if (isIgnorableErrorEvent(event)) return;
        report('error', event.error ?? event.message);
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);

    return () => {
        window.removeEventListener('unhandledrejection', onRejection);
        window.removeEventListener('error', onError);
    };
}
