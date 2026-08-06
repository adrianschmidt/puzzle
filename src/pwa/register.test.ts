/**
 * @vitest-environment jsdom
 *
 * jsdom is needed because the share-link-rescue wiring tests below drive
 * `onRegisteredSW` with a truthy registration, which runs the real
 * `setupUpdateChecks` (touches `document`) and — via the rescue's
 * `applyUpdate` — the update controller's fallback path (touches
 * `location`).
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

// Avoid pulling the DOM-dependent UI barrel into the test; the indicator is
// only ever constructed via `showIndicator`, which this test never triggers.
vi.mock('../ui/index.js', () => ({ createUpdateAvailableIndicator: vi.fn() }));

// Intercept the analytics `track` call made inside register.ts. A plain
// vi.spyOn would not catch a call made through the module's own import binding
// under Vite, so mock the module and pass the rest through.
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
    // Safety net for the fake-timers test below: restores real timers even
    // if an assertion throws before its own cleanup runs.
    vi.useRealTimers();
});

describe('initPwaUpdates onRegisterError', () => {
    it('tracks pwa-register-failed with a sanitized reason when registration fails', () => {
        initPwaUpdates(() => {});

        capturedOptions.current?.onRegisterError?.(new Error('boom'));

        expect(track).toHaveBeenCalledWith('pwa-register-failed', {
            reason: 'boom',
        });
        // `registerSW` calls `onRegisterError` at most once per page load, so a
        // single failure must produce exactly one event — no duplicate report.
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
        // Applying the update schedules a 3s fallback reload via the update
        // controller's real (uninjected) `globalThis.setTimeout`, which
        // would eventually call jsdom's unimplemented `location.reload` as
        // an async uncaught error. Fake timers keep that fallback pending
        // but never fired — the assertions below only depend on the
        // microtask-driven `onNeedRefresh` resolution below, not on the
        // fallback timer.
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
