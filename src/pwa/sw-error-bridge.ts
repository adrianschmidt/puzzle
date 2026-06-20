/**
 * Page-realm half of the service-worker error backstop (#430). Listens on
 * `navigator.serviceWorker` for the reports the worker posts (see
 * `sw-error-reporter.ts`) and relays each into the same `unhandled-error`
 * analytics event the page backstop uses — the worker can't call `track()`
 * itself because the Umami script only lives in the page.
 *
 * The worker has already sanitized the `reason` and bucketed the `name`, so
 * this side only validates the message shape (an untrusted `postMessage`
 * payload) and forwards it. Rate limiting lives in the worker, so no flood
 * reaches here.
 */

import { track } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';
import {
    SW_ERROR_MESSAGE_TYPE,
    type SwErrorReport,
} from './sw-error-reporter.js';

/** True when `data` carries our discriminator, regardless of the rest. */
function claimsToBeSwErrorReport(data: unknown): boolean {
    return (
        typeof data === 'object' &&
        data !== null &&
        (data as Record<string, unknown>).type === SW_ERROR_MESSAGE_TYPE
    );
}

function isSwErrorReport(data: unknown): data is SwErrorReport {
    if (!claimsToBeSwErrorReport(data)) return false;
    const d = data as Record<string, unknown>;
    return (
        (d.source === 'sw-error' || d.source === 'sw-rejection') &&
        typeof d.name === 'string' &&
        typeof d.reason === 'string'
    );
}

/** Minimal slice of `navigator.serviceWorker` this bridge depends on. */
export interface SwMessageTarget {
    addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
}

export interface SwErrorReportingDeps {
    /** Analytics sink. Defaults to the real `track`; injectable for tests. */
    track?: typeof track;
    /**
     * Source of worker `message` events. Defaults to
     * `navigator.serviceWorker`; injectable for tests.
     */
    serviceWorker?: SwMessageTarget;
}

/**
 * Start relaying service-worker error reports to analytics. Call once at
 * boot. Returns a disposer that removes the listener (used by tests). No-op
 * — returning a no-op disposer — where there is no service-worker container
 * (non-browser/test contexts, or a browser without SW support).
 */
export function initSwErrorReporting(deps: SwErrorReportingDeps = {}): () => void {
    const target =
        deps.serviceWorker ??
        (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? (navigator.serviceWorker as SwMessageTarget)
            : undefined);
    if (!target) return () => {};

    const trackFn = deps.track ?? track;
    const handler = (event: MessageEvent): void => {
        if (!isSwErrorReport(event.data)) {
            // A message bearing our own discriminator but failing the rest
            // of the shape check can only be a worker↔bridge protocol
            // desync (a renamed/retyped field) — surface it in dev/test.
            // Gating on the discriminator keeps this silent for every
            // unrelated `navigator.serviceWorker` message. No-op in prod.
            if (claimsToBeSwErrorReport(event.data)) {
                diagnostics.warn('Dropped malformed sw-error report:', event.data);
            }
            return;
        }
        const { source, name, reason } = event.data;
        trackFn('unhandled-error', { source, name, reason });
    };

    target.addEventListener('message', handler);
    return () => target.removeEventListener('message', handler);
}
