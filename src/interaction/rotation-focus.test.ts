/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { RotationFocus } from './rotation-focus.js';

describe('RotationFocus', () => {
    it('starts with no focused group', () => {
        const focus = new RotationFocus();
        expect(focus.focusedGroupId).toBeNull();
    });

    it('setFocus sets the focused group id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        expect(focus.focusedGroupId).toBe(7);
    });

    it('clearFocus resets the focused group to null', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        focus.clearFocus();
        expect(focus.focusedGroupId).toBeNull();
    });

    it('onChange fires when focus is set from null', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(7);
        expect(cb).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('onChange fires when focus moves to a different id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(8);
        expect(cb).toHaveBeenCalledExactlyOnceWith(8);
    });

    it('onChange fires when focus is cleared from a set value', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.clearFocus();
        expect(cb).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('onChange does NOT fire when setting to the same id', () => {
        const focus = new RotationFocus();
        focus.setFocus(7);
        const cb = vi.fn();
        focus.onChange(cb);
        focus.setFocus(7);
        expect(cb).not.toHaveBeenCalled();
    });

    it('onChange does NOT fire when clearing while already null', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        focus.onChange(cb);
        focus.clearFocus();
        expect(cb).not.toHaveBeenCalled();
    });

    it('onChange returns an unsubscribe function', () => {
        const focus = new RotationFocus();
        const cb = vi.fn();
        const unsubscribe = focus.onChange(cb);
        unsubscribe();
        focus.setFocus(7);
        expect(cb).not.toHaveBeenCalled();
    });

    it('multiple subscribers all receive notifications', () => {
        const focus = new RotationFocus();
        const a = vi.fn();
        const b = vi.fn();
        focus.onChange(a);
        focus.onChange(b);
        focus.setFocus(7);
        expect(a).toHaveBeenCalledExactlyOnceWith(7);
        expect(b).toHaveBeenCalledExactlyOnceWith(7);
    });
});
