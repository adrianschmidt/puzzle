/**
 * @vitest-environment jsdom
 *
 * The rescue-wiring tests drive `onRegisteredSW` with a truthy registration,
 * which runs the real `setupUpdateChecks` (`document`) and the update
 * controller's fallback path (`location`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

// `register.ts` is otherwise untestable: it imports the build-time-only
// `virtual:pwa-register`.
const { registerSW, capturedOptions } = vi.hoisted(() => {
    const captured: { current: RegisterSWOptions | undefined } = {
        current: undefined,
    };
    const registerSWMock = vi.fn((options?: RegisterSWOptions) => {
        captured.current = options;
        return vi.fn();
    });
    return { registerSW: registerSWMock, capturedOptions: captured };
});
vi.mock('virtual:pwa-register', () => ({ registerSW }));

// Avoid pulling the DOM-dependent UI barrel in; the indicator is only built
// via `showIndicator`, which this test never triggers.
vi.mock('../ui/index.js', () => ({ createUpdateAvailableIndicator: vi.fn() }));

// A plain vi.spyOn won't catch `track` called through register.ts's own import
// binding under Vite, so mock the module and pass the rest through.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics/index.js', async (importActual) => {
    const actual = await importActual<typeof import('../analytics/index.js')>();
    return { ...actual, track };
});

import { initPwaUpdates } from './register.js';

beforeEach(() => {
    track.mockClear();
    registerSW.mockClear();
    capturedOptions.current = undefined;
});

afterEach(() => {
    // Safety net: restores real timers even if the fake-timers test throws
    // before its own cleanup.
    vi.useRealTimers();
});

describe('initPwaUpdates onRegisterError', () => {
    it('tracks pwa-register-failed with a sanitized reason when registration fails', () => {
        initPwaUpdates(() => {});

        capturedOptions.current?.onRegisterError?.(new Error('boom'));

        expect(track).toHaveBeenCalledWith('pwa-register-failed', {
            reason: 'boom',
        });
        // onRegisterError fires at most once per load, so one failure = one event.
        expect(track).toHaveBeenCalledTimes(1);
    });

    it('sanitizes the rejection message before reporting it', () => {
        initPwaUpdates(() => {});

        capturedOptions.current?.onRegisterError?.(
            new Error('failed to fetch https://example.com/sw.js?v=abc123'),
        );

        expect(track).toHaveBeenCalledWith('pwa-register-failed', {
            reason: 'failed to fetch <url>',
        });
    });

    it('does not report a registration failure when none occurs', () => {
        initPwaUpdates(() => {});

        expect(track).not.toHaveBeenCalledWith(
            'pwa-register-failed',
            expect.anything(),
        );
    });
});

describe('initPwaUpdates share-link rescue wiring', () => {
    it('resolves no-update when the registered SW checks clean', async () => {
        const pwa = initPwaUpdates(() => {});
        const registration = {
            update: vi.fn(() => Promise.resolve()),
            installing: null,
            waiting: null,
        };
        capturedOptions.current?.onRegisteredSW?.(
            'sw.js',
            registration as unknown as ServiceWorkerRegistration,
        );

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('no-update');
        expect(registration.update).toHaveBeenCalled();
    });

    it('resolves unavailable when registration failed', async () => {
        const pwa = initPwaUpdates(() => {});
        capturedOptions.current?.onRegisterError?.(new Error('boom'));

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('unavailable');
    });

    it('applies and resolves updated when the check surfaces a waiting worker', async () => {
        // Applying the update schedules a 3s fallback reload on the real
        // setTimeout, which would hit jsdom's unimplemented location.reload as
        // an async uncaught error. Fake timers keep it pending but unfired; the
        // assertions depend only on the microtask onNeedRefresh resolution.
        vi.useFakeTimers();
        const updateSW = vi.fn(() => Promise.resolve());
        registerSW.mockImplementationOnce((options?: RegisterSWOptions) => {
            capturedOptions.current = options;
            return updateSW;
        });
        const flush = vi.fn();
        const pwa = initPwaUpdates(flush);
        const registration = {
            update: vi.fn(() => {
                // The real update() kicks off an install that ends in
                // onNeedRefresh; simulate that resolution order.
                queueMicrotask(() => capturedOptions.current?.onNeedRefresh?.());
                return Promise.resolve();
            }),
            installing: {},
            waiting: null,
        };
        capturedOptions.current?.onRegisteredSW?.(
            'sw.js',
            registration as unknown as ServiceWorkerRegistration,
        );

        await expect(pwa.attemptShareLinkRescue()).resolves.toBe('updated');
        expect(flush).toHaveBeenCalled();
        expect(updateSW).toHaveBeenCalledWith(true);
        expect(track).toHaveBeenCalledWith('pwa-update-applied', {
            trigger: 'share-link-rescue',
        });
    });
});
