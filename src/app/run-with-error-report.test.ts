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
            toastMessage: "Couldn't load shared puzzle",
            fallback: false,
        });

        expect(result).toBe(false);
        expect(umamiTrack).toHaveBeenCalledWith('shared-load-failed', { reason: 'boom at <url>' });
        expect(showToast).toHaveBeenCalledWith("Couldn't load shared puzzle");
    });
});
