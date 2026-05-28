/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initErrorTracking } from './error-tracking.js';

describe('initErrorTracking', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let dispose: () => void;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = {
            track: umamiTrack,
        };
        // Keep dev diagnostics from spamming the test console.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        dispose = initErrorTracking();
    });

    afterEach(() => {
        // Remove the listeners so they don't accumulate across cases.
        dispose();
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    function rejectWith(reason: unknown): void {
        const event = new Event('unhandledrejection') as Event & { reason?: unknown };
        event.reason = reason;
        window.dispatchEvent(event);
    }

    it('reports an unhandled rejection with source, name and reason', () => {
        rejectWith(new TypeError('boom from a promise'));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'rejection',
            name: 'TypeError',
            reason: 'boom from a promise',
        });
    });

    it('reports an uncaught error with source, name and reason', () => {
        window.dispatchEvent(
            new ErrorEvent('error', { error: new RangeError('boom from a throw'), message: 'boom from a throw' }),
        );

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'error',
            name: 'RangeError',
            reason: 'boom from a throw',
        });
    });

    it('uses name "unknown" for a non-Error rejection value', () => {
        rejectWith('a bare string rejection');

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'rejection',
            name: 'unknown',
            reason: 'a bare string rejection',
        });
    });

    it('sanitizes the reason (redacts URLs) before reporting', () => {
        rejectWith(new Error('Failed to fetch https://cdn.example/chunk-abc.js'));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'rejection',
            name: 'Error',
            reason: 'Failed to fetch <url>',
        });
    });

    it('falls back to the error event message when no error object is present', () => {
        window.dispatchEvent(new ErrorEvent('error', { message: 'a real parse failure' }));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'error',
            name: 'unknown',
            reason: 'a real parse failure',
        });
    });

    it('ignores opaque cross-origin "Script error." events', () => {
        window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' }));

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('ignores errors thrown from browser-extension scripts', () => {
        window.dispatchEvent(new ErrorEvent('error', {
            message: 'boom',
            error: new Error('boom'),
            filename: 'chrome-extension://abcdefg/content.js',
        }));

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('still reports a genuine same-origin error with a filename', () => {
        window.dispatchEvent(new ErrorEvent('error', {
            message: 'real boom',
            error: new Error('real boom'),
            filename: 'https://app.example/assets/index-abc.js',
        }));

        expect(umamiTrack).toHaveBeenCalledWith('unhandled-error', {
            source: 'error',
            name: 'Error',
            reason: 'real boom',
        });
    });

    it('does not report resource-load errors (listener is not in the capture phase)', () => {
        // Resource-load errors fire on the element and do not bubble; they
        // only reach window in the capture phase. A bubble-phase window
        // listener must never see them — pin that so a stray `, true`
        // doesn't silently start reporting every 404.
        const img = document.createElement('img');
        document.body.appendChild(img);
        img.dispatchEvent(new Event('error'));
        img.remove();

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('reports each distinct reason at most 5 times per session', () => {
        for (let i = 0; i < 8; i++) {
            rejectWith(new Error('looping boom'));
        }

        const reported = umamiTrack.mock.calls.filter(
            ([, data]) => (data as { reason: string }).reason === 'looping boom',
        );
        expect(reported).toHaveLength(5);
    });

    it('caps total reports per session and emits one RateLimited notice', () => {
        for (let i = 0; i < 60; i++) {
            window.dispatchEvent(new ErrorEvent('error', {
                message: `distinct error ${i}`,
                error: new Error(`distinct error ${i}`),
            }));
        }

        // 50 genuine reports + a single cap notice.
        expect(umamiTrack).toHaveBeenCalledTimes(51);
        expect(umamiTrack.mock.calls.at(-1)![1]).toMatchObject({ name: 'RateLimited' });
    });
});
