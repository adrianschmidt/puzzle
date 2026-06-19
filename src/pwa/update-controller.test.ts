import { describe, it, expect, vi } from 'vitest';
import {
    createUpdateController,
    setupUpdateChecks,
    type UpdateController,
} from './update-controller.js';

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
    it('polls registration.update on the interval', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let intervalFn: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            pollIntervalMs: 1000,
            setInterval: (fn) => {
                intervalFn = fn;
                return 0;
            },
            addVisibilityListener: () => {},
            isVisible: () => true,
        });
        expect(registration.update).not.toHaveBeenCalled();
        intervalFn!();
        expect(registration.update).toHaveBeenCalledOnce();
    });

    it('on visible: checks for an update and requests reload-if-pending', () => {
        const registration = { update: vi.fn() };
        const controller = fakeController();
        let visHandler: (() => void) | null = null;
        setupUpdateChecks(registration, controller, {
            setInterval: () => 0,
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
            setInterval: () => 0,
            addVisibilityListener: (fn) => {
                visHandler = fn;
            },
            isVisible: () => false,
        });
        visHandler!();
        expect(registration.update).not.toHaveBeenCalled();
        expect(controller.requestReloadIfPending).not.toHaveBeenCalled();
    });
});
