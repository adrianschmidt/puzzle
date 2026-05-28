/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initErrorTracking } from './error-tracking.js';

describe('initErrorTracking', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };
        // Keep dev diagnostics from spamming the test console.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    it('reports an unhandled rejection as an unhandled-error event', () => {
        initErrorTracking();

        const event = new Event('unhandledrejection') as Event & { reason?: unknown };
        event.reason = new Error('boom from a promise');
        window.dispatchEvent(event);

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            kind: 'rejection',
            reason: 'boom from a promise',
        });
    });

    it('reports an uncaught error as an unhandled-error event', () => {
        initErrorTracking();

        window.dispatchEvent(
            new ErrorEvent('error', { error: new Error('boom from a throw'), message: 'boom from a throw' }),
        );

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            kind: 'error',
            reason: 'boom from a throw',
        });
    });

    it('sanitizes the reason (redacts URLs) before reporting', () => {
        initErrorTracking();

        const event = new Event('unhandledrejection') as Event & { reason?: unknown };
        event.reason = new Error('Failed to fetch https://cdn.example/chunk-abc.js');
        window.dispatchEvent(event);

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            kind: 'rejection',
            reason: 'Failed to fetch <url>',
        });
    });

    it('falls back to the error event message when no error object is present', () => {
        initErrorTracking();

        window.dispatchEvent(new ErrorEvent('error', { message: 'a real parse failure' }));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            kind: 'error',
            reason: 'a real parse failure',
        });
    });

    it('ignores opaque cross-origin "Script error." events', () => {
        initErrorTracking();

        window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' }));

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('ignores errors thrown from browser-extension scripts', () => {
        initErrorTracking();

        window.dispatchEvent(new ErrorEvent('error', {
            message: 'boom',
            error: new Error('boom'),
            filename: 'chrome-extension://abcdefg/content.js',
        }));

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('still reports a genuine same-origin error with a filename', () => {
        initErrorTracking();

        window.dispatchEvent(new ErrorEvent('error', {
            message: 'real boom',
            error: new Error('real boom'),
            filename: 'https://app.example/assets/index-abc.js',
        }));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            kind: 'error',
            reason: 'real boom',
        });
    });
});
