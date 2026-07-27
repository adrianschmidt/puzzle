/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../persistence/index.js', () => ({
    createDebouncedSave: vi.fn(),
    saveNewPuzzle: vi.fn(),
}));

import { showToast } from '../ui/toast.js';
import { createDebouncedSave, saveNewPuzzle } from '../persistence/index.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import { ViewportTransform } from '../interaction/index.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import {
    createSaveCoordinator,
    SAVE_FAILED_TOAST,
    SAVE_FAILED_TOAST_DEDUP_MS,
} from './save-coordinator.js';

describe('createSaveCoordinator', () => {
    let umamiTrack: Mock;
    let save: Mock;
    let flush: Mock;
    let onSaveFailed: (state: ReturnType<typeof makeGameState>) => void;
    let onSaveSkipped: (state: ReturnType<typeof makeGameState>) => void;
    // Each `make()` installs real pagehide/visibilitychange listeners on
    // jsdom's shared window/document (see createSaveCoordinator). Without
    // removing them, listeners from every prior test in this file would
    // stay attached and keep firing. Nothing asserts on these spies —
    // they only exist to give afterEach something to un-register.
    let removeInstalledListeners: () => void;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        save = vi.fn();
        flush = vi.fn();
        vi.mocked(createDebouncedSave).mockImplementation((opts) => {
            onSaveFailed = opts!.onSaveFailed!;
            onSaveSkipped = opts!.onSaveSkipped!;
            return { save, flush, cancel: vi.fn() };
        });
        vi.mocked(saveNewPuzzle).mockReturnValue('ok');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cleanups: Array<() => void> = [];
        const realWindowAdd = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
            cleanups.push(() => window.removeEventListener(type, listener));
            realWindowAdd(type, listener, options);
        });
        const realDocumentAdd = document.addEventListener.bind(document);
        vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
            cleanups.push(() => document.removeEventListener(type, listener));
            realDocumentAdd(type, listener, options);
        });
        removeInstalledListeners = () => cleanups.forEach((cleanup) => cleanup());
    });

    afterEach(() => {
        removeInstalledListeners();
        delete (window as unknown as { umami?: unknown }).umami;
        vi.mocked(showToast).mockClear();
        vi.restoreAllMocks();
    });

    function make(now = () => 0) {
        return createSaveCoordinator({
            selectionManager: new SelectionManager(),
            viewportTransform: new ViewportTransform(),
            now,
        });
    }

    it('flushes pending saves on pagehide', () => {
        make();
        window.dispatchEvent(new Event('pagehide'));
        expect(flush).toHaveBeenCalled();
    });

    it('flushes when the document becomes hidden', () => {
        // pagehide is not guaranteed on mobile app-switch / background-kill.
        make();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).toHaveBeenCalled();
    });

    it('does not flush when the document becomes visible', () => {
        make();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).not.toHaveBeenCalled();
    });

    it('toasts and reports when a new-puzzle save fails', () => {
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        make().persistNewPuzzle(makeGameState({ cutStyle: 'wavy' }));

        expect(showToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
        expect(umamiTrack).toHaveBeenCalledWith(
            'save-failed',
            expect.objectContaining({ op: 'new-puzzle', cutStyle: 'wavy' }),
        );
    });

    it('reports a compressed save without toasting', () => {
        // Near-quota: one growth step from total failure, but nothing is lost.
        vi.mocked(saveNewPuzzle).mockReturnValue('ok-compressed');
        make().persistNewPuzzle(makeGameState({ cutStyle: 'triangles' }));

        expect(showToast).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'save-compressed',
            expect.objectContaining({ cutStyle: 'triangles' }),
        );
    });

    it('suppresses a repeat failure toast inside the dedup window but still reports it', () => {
        // A fast debounced save loop must not spam the user, and a suppressed
        // repeat must still leave a trail rather than vanishing.
        let clock = 0;
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        const coordinator = make(() => clock);

        coordinator.persistNewPuzzle(makeGameState());
        clock = SAVE_FAILED_TOAST_DEDUP_MS - 1;
        coordinator.persistNewPuzzle(makeGameState());

        expect(showToast).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalled();
    });

    it('toasts again once the dedup window has passed', () => {
        let clock = 0;
        vi.mocked(saveNewPuzzle).mockReturnValue('failed');
        const coordinator = make(() => clock);

        coordinator.persistNewPuzzle(makeGameState());
        clock = SAVE_FAILED_TOAST_DEDUP_MS;
        coordinator.persistNewPuzzle(makeGameState());

        expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('attributes a progress failure to the flushed state, not the current one', () => {
        // A save queued for the previous puzzle can flush after a new game
        // starts; reporting the new puzzle's fields would be a lie.
        make();
        onSaveFailed(makeGameState({ cutStyle: 'fractal' }));

        expect(umamiTrack).toHaveBeenCalledWith(
            'save-failed',
            expect.objectContaining({ op: 'progress', cutStyle: 'fractal' }),
        );
    });

    it('reports a cross-tab skip without alarming the user', () => {
        make();
        onSaveSkipped(makeGameState({ cutStyle: 'wavy' }));

        expect(showToast).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith(
            'progress-save-skipped',
            expect.objectContaining({ cutStyle: 'wavy' }),
        );
    });
});
