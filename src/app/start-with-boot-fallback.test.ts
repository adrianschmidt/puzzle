/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import {
    startWithBootFallback,
    FALLBACK_STARTED_TOAST,
    BOOT_FAILED_TOAST,
} from './start-with-boot-fallback.js';

describe('startWithBootFallback', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        // Both legs opt into `logInProduction`, so they log through
        // `console.error`, not the DEV-gated `diagnostics.warn`. Spying on
        // both keeps the suite output clean either way and lets the tests
        // assert which channel was used — that flag is the only thing
        // keeping a boot failure visible on a deployed build.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.mocked(showToast).mockClear();
    });

    it('reports nothing and starts no fallback when the preferred start succeeds', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            cutStyle: 'wavy',
            start: async () => {},
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('starts the fallback puzzle and explains the substitution', async () => {
        const startFallback = vi.fn(async () => {});
        const error = new Error('chunk boom at https://cdn.example/x.js');

        await startWithBootFallback({
            cutStyle: 'wavy',
            start: async () => {
                throw error;
            },
            startFallback,
            hasGame: () => false,
        });

        expect(startFallback).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'chunk boom at <url>',
            cutStyle: 'wavy',
            phase: 'boot',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(FALLBACK_STARTED_TOAST);
        // A deployed build silences `diagnostics.warn`; the boot legs must
        // stay on the channel a production console still prints.
        expect(console.error).toHaveBeenCalledWith('Failed to start the boot puzzle:', error);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('leaves a puzzle that did reach the screen alone', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            cutStyle: 'wavy',
            start: async () => {
                throw new Error('late boom');
            },
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'late boom',
            cutStyle: 'wavy',
            phase: 'boot',
        });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reports both failures and still resolves when the fallback fails too', async () => {
        const first = new Error('first');
        const second = new Error('second');

        await startWithBootFallback({
            cutStyle: 'wavy',
            start: async () => {
                throw first;
            },
            startFallback: async () => {
                throw second;
            },
            hasGame: () => false,
        });

        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(umamiTrack).toHaveBeenNthCalledWith(1, 'new-game-failed', {
            reason: 'first',
            cutStyle: 'wavy',
            phase: 'boot',
        });
        expect(umamiTrack).toHaveBeenNthCalledWith(2, 'new-game-failed', {
            // The style the fallback actually attempts, not the
            // preference that failed — that one is on the 'boot' event.
            reason: 'second',
            cutStyle: 'classic',
            phase: 'boot-fallback',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(BOOT_FAILED_TOAST);
        // Distinct messages, so the two phases stay tellable apart in a
        // production console — the channel that survives an ad blocker
        // eating the analytics script.
        expect(console.error).toHaveBeenNthCalledWith(1, 'Failed to start the boot puzzle:', first);
        expect(console.error).toHaveBeenNthCalledWith(2, 'Boot fallback puzzle also failed to start:', second);
    });

    it('does not tell the player to reload when the fallback rendered before it threw', async () => {
        // The fallback runs the same `initGame` the preferred start does, so
        // it too can reject after its puzzle is on screen. BOOT_FAILED_TOAST
        // would be untrue there, and its "try reloading" advice destructive.
        let onScreen = false;

        await startWithBootFallback({
            cutStyle: 'wavy',
            start: async () => {
                throw new Error('first');
            },
            startFallback: async () => {
                onScreen = true;
                throw new Error('late');
            },
            hasGame: () => onScreen,
        });

        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(FALLBACK_STARTED_TOAST);
    });
});
