/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the rotate-buttons DOM integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRotateButtons } from './rotate-buttons.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import type { RotationDirection } from '../game/rotate-group.js';

describe('createRotateButtons', () => {
    let container: HTMLElement;
    let selectionManager: SelectionManager;
    let onRotate: ReturnType<typeof vi.fn<(direction: RotationDirection) => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        selectionManager = new SelectionManager();
        onRotate = vi.fn<(direction: RotationDirection) => void>();
    });

    function getButtons(): {
        ccw: HTMLButtonElement;
        cw: HTMLButtonElement;
    } {
        const ccw = container.querySelector<HTMLButtonElement>(
            '.rotate-button--ccw',
        );
        const cw = container.querySelector<HTMLButtonElement>(
            '.rotate-button--cw',
        );
        expect(ccw).not.toBeNull();
        expect(cw).not.toBeNull();
        return { ccw: ccw!, cw: cw! };
    }

    it('should add both rotate buttons to the container', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        const { ccw, cw } = getButtons();
        expect(ccw.classList.contains('rotate-button')).toBe(true);
        expect(cw.classList.contains('rotate-button')).toBe(true);
        expect(ccw.type).toBe('button');
        expect(cw.type).toBe('button');
    });

    it('should set aria-labels for accessibility', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        const { ccw, cw } = getButtons();
        expect(ccw.getAttribute('aria-label')).toBe(
            'Rotate selection 90° counter-clockwise',
        );
        expect(cw.getAttribute('aria-label')).toBe(
            'Rotate selection 90° clockwise',
        );
    });

    it('should be hidden by default', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        const { ccw, cw } = getButtons();
        expect(ccw.style.display).toBe('none');
        expect(cw.style.display).toBe('none');
    });

    it('should be disabled when nothing is selected', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        const { ccw, cw } = getButtons();
        expect(ccw.disabled).toBe(true);
        expect(cw.disabled).toBe(true);
    });

    it('should become enabled when a group is selected', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        selectionManager.select(1);

        const { ccw, cw } = getButtons();
        expect(ccw.disabled).toBe(false);
        expect(cw.disabled).toBe(false);
    });

    it('should disable again when selection is cleared', () => {
        createRotateButtons({ container, selectionManager, onRotate });
        selectionManager.select(1);

        selectionManager.clearAll();

        const { ccw, cw } = getButtons();
        expect(ccw.disabled).toBe(true);
        expect(cw.disabled).toBe(true);
    });

    it('should call onRotate("ccw") when the CCW button is clicked', () => {
        createRotateButtons({ container, selectionManager, onRotate });
        selectionManager.select(1);

        const { ccw } = getButtons();
        ccw.click();

        expect(onRotate).toHaveBeenCalledExactlyOnceWith('ccw');
    });

    it('should call onRotate("cw") when the CW button is clicked', () => {
        createRotateButtons({ container, selectionManager, onRotate });
        selectionManager.select(1);

        const { cw } = getButtons();
        cw.click();

        expect(onRotate).toHaveBeenCalledExactlyOnceWith('cw');
    });

    it('should not call onRotate when clicked with no selection', () => {
        createRotateButtons({ container, selectionManager, onRotate });

        const { ccw, cw } = getButtons();
        ccw.click();
        cw.click();

        expect(onRotate).not.toHaveBeenCalled();
    });

    it('show() should make both buttons visible', () => {
        const handle = createRotateButtons({
            container,
            selectionManager,
            onRotate,
        });

        handle.show();

        const { ccw, cw } = getButtons();
        expect(ccw.style.display).toBe('');
        expect(cw.style.display).toBe('');
    });

    it('hide() should hide both buttons', () => {
        const handle = createRotateButtons({
            container,
            selectionManager,
            onRotate,
        });
        handle.show();

        handle.hide();

        const { ccw, cw } = getButtons();
        expect(ccw.style.display).toBe('none');
        expect(cw.style.display).toBe('none');
    });

    it('destroy() should remove both buttons from the DOM', () => {
        const handle = createRotateButtons({
            container,
            selectionManager,
            onRotate,
        });

        expect(container.querySelector('.rotate-button--ccw')).not.toBeNull();
        expect(container.querySelector('.rotate-button--cw')).not.toBeNull();

        handle.destroy();

        expect(container.querySelector('.rotate-button--ccw')).toBeNull();
        expect(container.querySelector('.rotate-button--cw')).toBeNull();
    });

    it('destroy() should unsubscribe from selection changes', () => {
        const handle = createRotateButtons({
            container,
            selectionManager,
            onRotate,
        });

        const { ccw, cw } = getButtons();
        handle.destroy();

        // Subsequent changes must not re-enable the detached buttons.
        selectionManager.select(1);

        expect(ccw.disabled).toBe(true);
        expect(cw.disabled).toBe(true);
    });

    it('destroy() should detach click handlers', () => {
        selectionManager.select(1);
        const handle = createRotateButtons({
            container,
            selectionManager,
            onRotate,
        });

        const { ccw, cw } = getButtons();
        handle.destroy();

        ccw.click();
        cw.click();

        expect(onRotate).not.toHaveBeenCalled();
    });
});
