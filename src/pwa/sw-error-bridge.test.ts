import { describe, it, expect, vi, afterEach } from 'vitest';
import { initSwErrorReporting } from './sw-error-bridge.js';
import { SW_ERROR_MESSAGE_TYPE, type SwErrorReport } from './sw-error-reporter.js';
import { diagnostics } from '../diagnostics.js';

/** A minimal stand-in for `navigator.serviceWorker`'s message channel. */
function makeTarget() {
    const handlers = new Set<(event: MessageEvent) => void>();
    return {
        addEventListener: vi.fn((_type: 'message', h: (event: MessageEvent) => void) => {
            handlers.add(h);
        }),
        removeEventListener: vi.fn((_type: 'message', h: (event: MessageEvent) => void) => {
            handlers.delete(h);
        }),
        emit(data: unknown): void {
            for (const h of handlers) h({ data } as MessageEvent);
        },
    };
}

const report: SwErrorReport = {
    type: SW_ERROR_MESSAGE_TYPE,
    source: 'sw-error',
    name: 'TypeError',
    reason: 'boom in the worker',
};

describe('initSwErrorReporting', () => {
    it('relays a worker error report into an unhandled-error track call', () => {
        const target = makeTarget();
        const track = vi.fn();

        initSwErrorReporting({ serviceWorker: target, track: track as never });
        target.emit(report);

        expect(track).toHaveBeenCalledWith('unhandled-error', {
            source: 'sw-error',
            name: 'TypeError',
            reason: 'boom in the worker',
        });
    });

    it('relays a worker rejection report with the sw-rejection source', () => {
        const target = makeTarget();
        const track = vi.fn();

        initSwErrorReporting({ serviceWorker: target, track: track as never });
        target.emit({ ...report, source: 'sw-rejection', name: 'RangeError' });

        expect(track).toHaveBeenCalledWith(
            'unhandled-error',
            expect.objectContaining({ source: 'sw-rejection', name: 'RangeError' }),
        );
    });

    it('ignores messages that are not error reports', () => {
        const target = makeTarget();
        const track = vi.fn();

        initSwErrorReporting({ serviceWorker: target, track: track as never });
        target.emit({ type: 'something-else' });
        target.emit('a bare string');
        target.emit(null);
        target.emit({ type: SW_ERROR_MESSAGE_TYPE, source: 'bogus', name: 'X', reason: 'Y' });

        expect(track).not.toHaveBeenCalled();
    });

    it('dev-warns only for a malformed message that claims our type', () => {
        const target = makeTarget();
        const track = vi.fn();
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});

        initSwErrorReporting({ serviceWorker: target, track: track as never });

        // Unrelated messages: no warn (they aren't claiming to be ours).
        target.emit({ type: 'something-else' });
        target.emit('a bare string');
        target.emit(null);
        expect(warn).not.toHaveBeenCalled();

        // Claims our discriminator but fails the rest of validation: warn.
        const malformed = { type: SW_ERROR_MESSAGE_TYPE, source: 'bogus', name: 'X', reason: 'Y' };
        target.emit(malformed);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.any(String), malformed);
        expect(track).not.toHaveBeenCalled();

        // A well-formed report does not warn.
        warn.mockClear();
        target.emit(report);
        expect(warn).not.toHaveBeenCalled();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes the listener when disposed', () => {
        const target = makeTarget();
        const track = vi.fn();

        const dispose = initSwErrorReporting({ serviceWorker: target, track: track as never });
        dispose();
        target.emit(report);

        expect(track).not.toHaveBeenCalled();
        expect(target.removeEventListener).toHaveBeenCalled();
    });

    it('is a no-op (returns a disposer) when there is no service-worker target', () => {
        // No `serviceWorker` dep and no `navigator` in the node test realm.
        expect(() => initSwErrorReporting()()).not.toThrow();
    });
});
