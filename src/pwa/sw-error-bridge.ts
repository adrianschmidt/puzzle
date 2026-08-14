/**
 * Page-realm half of the service-worker error backstop (#430): the worker
 * can't call `track()` (Umami only lives in the page). The worker already
 * sanitized and rate-limited, so this side only validates the message shape
 * (an untrusted `postMessage` payload) and forwards.
 */

import { track } from '../analytics/index.js';
import { diagnostics } from '../diagnostics.js';
import {
    SW_ERROR_MESSAGE_TYPE,
    type SwErrorReport,
} from './sw-error-reporter.js';

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

export interface SwMessageTarget {
    addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
}

export interface SwErrorReportingDeps {
    track?: typeof track;
    serviceWorker?: SwMessageTarget;
}

/** Call once at boot. */
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
            // A claimed type + failed shape check means a worker↔bridge
            // protocol desync — surface it in dev/test. The discriminator gate
            // keeps unrelated serviceWorker messages silent. No-op in prod.
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
