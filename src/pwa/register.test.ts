import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

// `register.ts` is otherwise untestable: it imports the build-time-only
// `virtual:pwa-register`. Mock it to capture the options object passed to
// `registerSW` (so we can drive the callbacks) and return a stub `updateSW`.
const { registerSW, capturedOptions } = vi.hoisted(() => {
    const capturedOptions: { current: RegisterSWOptions | undefined } = {
        current: undefined,
    };
    const registerSW = vi.fn((options?: RegisterSWOptions) => {
        capturedOptions.current = options;
        return vi.fn();
    });
    return { registerSW, capturedOptions };
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
