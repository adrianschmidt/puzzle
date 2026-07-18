import { describe, it, expect, vi, beforeEach } from 'vitest';

// Intercept the analytics `track` call made inside update-controller. A plain
// vi.spyOn would not catch a call made through the module's own import binding
// under Vite, so mock the module and keep the rest of its real exports.
// `vi.hoisted` is needed because the `vi.mock` factory is hoisted above the
// normal top-level statements.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics/index.js', async (importActual) => {
    const actual = await importActual<typeof import('../analytics/index.js')>();
    return { ...actual, track };
});

import {
    createUpdateController,
    setupUpdateChecks,
    type UpdateController,
} from './update-controller.js';

beforeEach(() => {
    track.mockClear();
});

describe('createUpdateController', () => {
    it('is not pending before any refresh is needed', () => {
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: vi.fn(),
        });
        expect(controller.pending).toBe(false);
    });

    it('marks pending and shows the indicator on onNeedRefresh', () => {
        const showIndicator = vi.fn();
        const controller = createUpdateController({ flush: vi.fn(), showIndicator });
        controller.onNeedRefresh();
        expect(controller.pending).toBe(true);
        expect(showIndicator).toHaveBeenCalledOnce();
    });

    it('reloadNow flushes before calling updateSW(true)', () => {
        const flush = vi.fn();
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush, showIndicator: vi.fn() });
        controller.setUpdateSW(updateSW);
        controller.reloadNow();
        expect(flush).toHaveBeenCalledOnce();
        expect(updateSW).toHaveBeenCalledWith(true);
        expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
            updateSW.mock.invocationCallOrder[0],
        );
    });

    it('reloadNow is a no-op when updateSW is not set yet', () => {
        const flush = vi.fn();
        const controller = createUpdateController({ flush, showIndicator: vi.fn() });
        controller.reloadNow();
        expect(flush).not.toHaveBeenCalled();
    });

    it('applies a reload requested before updateSW is set, once it is set', () => {
        const flush = vi.fn();
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush, showIndicator: vi.fn() });
        // Tap arrives before registerSW has resolved the handle.
        controller.reloadNow();
        expect(flush).not.toHaveBeenCalled();
        // Handle becomes available — the buffered reload fires.
        controller.setUpdateSW(updateSW);
        expect(flush).toHaveBeenCalledOnce();
        expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('does not re-fire a buffered reload on a later setUpdateSW call', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.reloadNow();
        controller.setUpdateSW(updateSW);
        controller.setUpdateSW(updateSW);
        expect(updateSW).toHaveBeenCalledOnce();
    });

    it('setUpdateSW does not reload when no reload was requested', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.setUpdateSW(updateSW);
        expect(updateSW).not.toHaveBeenCalled();
    });

    it('requestReloadIfPending reloads only when pending', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.setUpdateSW(updateSW);

        controller.requestReloadIfPending();
        expect(updateSW).not.toHaveBeenCalled();

        controller.onNeedRefresh();
        controller.requestReloadIfPending();
        expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('the indicator callback applies the update', () => {
        const updateSW = vi.fn().mockResolvedValue(undefined);
        let captured: (() => void) | null = null;
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: (onRefresh) => {
                captured = onRefresh;
            },
        });
        controller.setUpdateSW(updateSW);
        controller.onNeedRefresh();
        captured!();
        expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('reloadNow schedules a fallback reload via the injected scheduler', () => {
        const flush = vi.fn();
        const reload = vi.fn();
        const scheduleFallback = vi.fn();
        const controller = createUpdateController({
            flush,
            showIndicator: vi.fn(),
            reload,
            scheduleFallback,
        });
        controller.setUpdateSW(vi.fn().mockResolvedValue(undefined));
        controller.reloadNow();
        expect(scheduleFallback).toHaveBeenCalledOnce();
        expect(scheduleFallback).toHaveBeenCalledWith(expect.any(Function), 3000);
        // Invoke the captured handler to confirm it calls reload.
        const handler = scheduleFallback.mock.calls[0][0] as () => void;
        handler();
        expect(reload).toHaveBeenCalledOnce();
    });

    it('reloadNow is idempotent (second call is a no-op)', () => {
        const flush = vi.fn();
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const reload = vi.fn();
        const scheduleFallback = vi.fn();
        const controller = createUpdateController({
            flush,
            showIndicator: vi.fn(),
            reload,
            scheduleFallback,
        });
        controller.setUpdateSW(updateSW);
        controller.reloadNow();
        controller.reloadNow();
        expect(flush).toHaveBeenCalledOnce();
        expect(updateSW).toHaveBeenCalledOnce();
        expect(scheduleFallback).toHaveBeenCalledOnce();
    });

    it('requestReloadIfPending after a reload has started does nothing more', () => {
        const flush = vi.fn();
        const updateSW = vi.fn().mockResolvedValue(undefined);
        const reload = vi.fn();
        const scheduleFallback = vi.fn();
        const controller = createUpdateController({
            flush,
            showIndicator: vi.fn(),
            reload,
            scheduleFallback,
        });
        controller.setUpdateSW(updateSW);
        controller.onNeedRefresh();
        controller.reloadNow();
        controller.requestReloadIfPending();
        expect(updateSW).toHaveBeenCalledOnce();
    });
});

describe('createUpdateController analytics', () => {
    it('tracks pwa-update-detected when a refresh is needed', () => {
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.onNeedRefresh();
        expect(track).toHaveBeenCalledWith('pwa-update-detected', {});
    });

    it('tracks pwa-update-applied with the manual trigger on a tap', () => {
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.setUpdateSW(vi.fn().mockResolvedValue(undefined));
        controller.reloadNow();
        expect(track).toHaveBeenCalledWith('pwa-update-applied', { trigger: 'manual' });
    });

    it('tracks pwa-update-applied with the focus-regain trigger', () => {
        const controller = createUpdateController({ flush: vi.fn(), showIndicator: vi.fn() });
        controller.setUpdateSW(vi.fn().mockResolvedValue(undefined));
        controller.onNeedRefresh();
        controller.requestReloadIfPending();
        expect(track).toHaveBeenCalledWith('pwa-update-applied', { trigger: 'focus-regain' });
    });

    it('tracks pwa-update-fallback-reload when the fallback timer fires', () => {
        const reload = vi.fn();
        const scheduleFallback = vi.fn();
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: vi.fn(),
            reload,
            scheduleFallback,
        });
        controller.setUpdateSW(vi.fn().mockResolvedValue(undefined));
        controller.reloadNow();
        // Fallback hasn't fired yet.
        expect(track).not.toHaveBeenCalledWith('pwa-update-fallback-reload', {});
        // Fire the scheduled handler.
        (scheduleFallback.mock.calls[0][0] as () => void)();
        expect(track).toHaveBeenCalledWith('pwa-update-fallback-reload', {});
        expect(reload).toHaveBeenCalledOnce();
    });

    it('tracks pwa-update-apply-failed when updateSW(true) rejects', async () => {
        const controller = createUpdateController({
            flush: vi.fn(),
            showIndicator: vi.fn(),
            scheduleFallback: vi.fn(),
        });
        controller.setUpdateSW(vi.fn().mockRejectedValue(new Error('boom')));
        controller.reloadNow();
        // Let the rejection microtask settle.
        await Promise.resolve();
        await Promise.resolve();
        expect(track).toHaveBeenCalledWith('pwa-update-apply-failed', { reason: 'boom' });
    });
});

function fakeController(): UpdateController {
    return {
        onNeedRefresh: vi.fn(),
        setUpdateSW: vi.fn(),
        requestReloadIfPending: vi.fn(),
        reloadNow: vi.fn(),
        pending: false,
    } as unknown as UpdateController;
}

describe('setupUpdateChecks', () => {
    it('does not check for an update eagerly at setup', () => {
        const registration = { update: vi.fn() };
        setupUpdateChecks(registration, fakeController(), {
            addVisibilityListener: () => {},
            isVisible: () => true,
        });
        // Setup only wires the visibility listener; nothing runs until a
        // visibility regain.
        expect(registration.update).not.toHaveBeenCalled();
    });

    it('on visible: checks for an update and requests reload-if-pending', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        visHandler!();
        expect(registration.update).toHaveBeenCalledOnce();
        expect(controller.requestReloadIfPending).toHaveBeenCalledOnce();
    });

    it('ignores visibility changes when not visible', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => false,
        });
        visHandler!();
        expect(registration.update).not.toHaveBeenCalled();
        expect(controller.requestReloadIfPending).not.toHaveBeenCalled();
    });

    it('does not track a check failure when the check resolves', async () => {
        const registration = { update: vi.fn().mockResolvedValue(undefined) };
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, fakeController(), {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        visHandler!();
        await Promise.resolve();
        await Promise.resolve();
        expect(track).not.toHaveBeenCalledWith(
            'pwa-update-check-failed',
            expect.anything(),
        );
    });

    it('tracks pwa-update-check-failed when the visibility-path check rejects', async () => {
        const registration = {
            update: vi.fn().mockRejectedValue(new Error('offline')),
        };
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, fakeController(), {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        visHandler!();
        await Promise.resolve();
        await Promise.resolve();
        expect(track).toHaveBeenCalledWith('pwa-update-check-failed', {
            reason: 'offline',
        });
    });

    it('reports each distinct reason only once across repeated rejecting checks', async () => {
        const registration = {
            update: vi.fn().mockRejectedValue(new Error('offline')),
        };
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, fakeController(), {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        for (let i = 0; i < 4; i++) {
            visHandler!();
            await Promise.resolve();
            await Promise.resolve();
        }
        const checkFailures = track.mock.calls.filter(
            ([name]) => name === 'pwa-update-check-failed',
        );
        expect(checkFailures).toHaveLength(1);
    });

    it('caps the number of distinct reasons reported per session', async () => {
        const errors = [
            'reason-a',
            'reason-b',
            'reason-c',
            'reason-d',
            'reason-e',
            'reason-f',
        ];
        let i = 0;
        const registration = {
            update: vi.fn(() => Promise.reject(new Error(errors[i++]))),
        };
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, fakeController(), {
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => true,
        });
        for (let n = 0; n < errors.length; n++) {
            visHandler!();
            await Promise.resolve();
            await Promise.resolve();
        }
        const checkFailures = track.mock.calls.filter(
            ([name]) => name === 'pwa-update-check-failed',
        );
        // Five distinct reasons get through; the sixth is dropped as a
        // cardinality guard.
        expect(checkFailures).toHaveLength(5);
        expect(checkFailures.map(([, data]) => data.reason)).not.toContain(
            'reason-f',
        );
    });
});
