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
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.mocked(showToast).mockClear();
    });

    it('reports nothing and starts no fallback when the preferred start succeeds', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {},
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('starts the fallback puzzle and explains the substitution', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {
                throw new Error('chunk boom at https://cdn.example/x.js');
            },
            startFallback,
            hasGame: () => false,
        });

        expect(startFallback).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'chunk boom at <url>',
            phase: 'boot',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(FALLBACK_STARTED_TOAST);
    });

    it('leaves a puzzle that did reach the screen alone', async () => {
        const startFallback = vi.fn(async () => {});

        await startWithBootFallback({
            start: async () => {
                throw new Error('late boom');
            },
            startFallback,
            hasGame: () => true,
        });

        expect(startFallback).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'late boom',
            phase: 'boot',
        });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reports both failures and still resolves when the fallback fails too', async () => {
        await startWithBootFallback({
            start: async () => {
                throw new Error('first');
            },
            startFallback: async () => {
                throw new Error('second');
            },
            hasGame: () => false,
        });

        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(umamiTrack).toHaveBeenNthCalledWith(1, 'new-game-failed', {
            reason: 'first',
            phase: 'boot',
        });
        expect(umamiTrack).toHaveBeenNthCalledWith(2, 'new-game-failed', {
            reason: 'second',
            phase: 'boot-fallback',
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(BOOT_FAILED_TOAST);
    });
});
