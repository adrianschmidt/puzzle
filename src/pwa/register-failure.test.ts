import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeRegisterFailure } from './register-failure.js';

const nativeFunction = Math.max;

function stubEnvironment({
    serviceWorker = { register: nativeFunction } as unknown,
    standalone = false,
    visibilityState = 'visible',
} = {}): void {
    vi.stubGlobal('navigator', { serviceWorker });
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: standalone && query === '(display-mode: standalone)',
    }));
    vi.stubGlobal('document', { visibilityState });
}

beforeEach(() => stubEnvironment());
afterEach(() => vi.unstubAllGlobals());

describe('describeRegisterFailure', () => {
    it('describes a bare string rejection by its type', () => {
        expect(describeRegisterFailure('Rejected')).toEqual({
            reason: 'Rejected',
            valueType: 'string',
            name: 'string',
            registerFunction: 'native',
            displayMode: 'browser',
            visibilityState: 'visible',
        });
    });

    it('separates a DOMException from its name', () => {
        const failure = describeRegisterFailure(
            new DOMException('The user denied permission to use Service Worker.', 'SecurityError'),
        );

        expect(failure).toMatchObject({
            reason: 'The user denied permission to use Service Worker.',
            valueType: 'DOMException',
            name: 'SecurityError',
        });
    });

    it('sanitizes the reason', () => {
        expect(describeRegisterFailure(new TypeError('failed https://x.example/sw.js')).reason)
            .toBe('failed <url>');
    });

    it('flags a register function replaced by page script', () => {
        stubEnvironment({
            serviceWorker: { register: () => Promise.reject(new Error('Rejected')) },
        });

        expect(describeRegisterFailure('Rejected').registerFunction).toBe('replaced');
    });

    it('flags a register that is no longer a function as replaced', () => {
        stubEnvironment({ serviceWorker: { register: 'Rejected' } });

        expect(describeRegisterFailure('Rejected').registerFunction).toBe('replaced');
    });

    it('reports register as unavailable when the container is absent', () => {
        vi.stubGlobal('navigator', {});

        expect(describeRegisterFailure('Rejected').registerFunction).toBe('unavailable');
    });

    it('reports register as unavailable when reading the container throws', () => {
        vi.stubGlobal('navigator', {
            get serviceWorker(): never {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
        });

        expect(describeRegisterFailure('Rejected').registerFunction).toBe('unavailable');
    });

    it('reports standalone display mode', () => {
        stubEnvironment({ standalone: true });

        expect(describeRegisterFailure('Rejected').displayMode).toBe('standalone');
    });

    it('reports the document visibility state', () => {
        stubEnvironment({ visibilityState: 'hidden' });

        expect(describeRegisterFailure('Rejected').visibilityState).toBe('hidden');
    });
});
