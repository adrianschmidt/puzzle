/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import { runWithErrorReport } from './run-with-error-report.js';

describe('runWithErrorReport', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.mocked(showToast).mockClear();
    });

    it('returns the operation result and reports nothing on success', async () => {
        const result = await runWithErrorReport({
            run: async () => true,
            warnMessage: 'unused',
            event: 'shared-load-failed',
            source: 'shared',
            toastMessage: 'unused',
            fallback: false,
        });

        expect(result).toBe(true);
        expect(umamiTrack).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reports a sanitized reason, shows the toast, and returns the fallback on failure', async () => {
        const result = await runWithErrorReport({
            run: async () => {
                throw new Error('boom at https://secret.example/path');
            },
            warnMessage: 'Failed to load shared puzzle:',
            event: 'shared-load-failed',
            source: 'shared',
            toastMessage: "Couldn't load shared puzzle",
            fallback: false,
        });

        expect(result).toBe(false);
        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', {
            reason: 'boom at <url>',
            source: 'shared',
        });
        expect(showToast).toHaveBeenCalledWith("Couldn't load shared puzzle");
    });

    it('forwards the shared-load-failed source so the console helper is separable', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('topology unsupported');
            },
            warnMessage: 'Failed to load repro puzzle:',
            event: 'shared-load-failed',
            source: 'repro',
            toastMessage: "Couldn't load repro puzzle",
            fallback: false,
        });

        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', {
            reason: 'topology unsupported',
            source: 'repro',
        });
    });

    it('logs through the DEV-gated diagnostic by default', async () => {
        const error = new Error('topology unsupported');
        await runWithErrorReport({
            run: async () => { throw error; },
            warnMessage: 'Failed to load shared puzzle:',
            event: 'shared-load-failed',
            source: 'shared',
            toastMessage: "Couldn't load shared puzzle",
            fallback: false,
        });

        expect(console.warn).toHaveBeenCalledWith('Failed to load shared puzzle:', error);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('logs through console.error when the caller opts into production logging', async () => {
        // `diagnostics.warn` is a no-op on a deployed build, which would hide
        // the one failure `__reproPuzzle` exists to investigate.
        const error = new Error('topology unsupported');
        await runWithErrorReport({
            run: async () => { throw error; },
            warnMessage: 'Failed to load repro puzzle:',
            logInProduction: true,
            event: 'shared-load-failed',
            source: 'repro',
            toastMessage: "Couldn't load repro puzzle",
            fallback: false,
        });

        expect(console.error).toHaveBeenCalledWith('Failed to load repro puzzle:', error);
        expect(console.warn).not.toHaveBeenCalled();
        // The toast and the Umami event still fire.
        expect(showToast).toHaveBeenCalledWith("Couldn't load repro puzzle");
        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', {
            reason: 'topology unsupported',
            source: 'repro',
        });
    });

    it('reports new-game-failed without a source field', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('chunk load failed');
            },
            warnMessage: 'Failed to start new game:',
            event: 'new-game-failed',
            toastMessage: "Couldn't start new game",
            fallback: undefined,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', { reason: 'chunk load failed' });
    });

    it('skips the toast when no toastMessage is given', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('boom');
            },
            warnMessage: 'Failed to start new game:',
            event: 'new-game-failed',
            fallback: undefined,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', { reason: 'boom' });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('passes the phase through to new-game-failed', async () => {
        await runWithErrorReport({
            run: async () => {
                throw new Error('boom');
            },
            warnMessage: 'Boot fallback puzzle also failed to start:',
            event: 'new-game-failed',
            phase: 'boot-fallback',
            toastMessage: "Couldn't start a puzzle",
            fallback: undefined,
        });

        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'boom',
            phase: 'boot-fallback',
        });
    });
});
