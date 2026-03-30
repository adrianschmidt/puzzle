/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadOffsetDragPreference,
    saveOffsetDragPreference,
    OFFSET_DRAG_KEY,
} from './offset-drag.js';

describe('offset-drag', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to disabled when nothing is saved', () => {
        expect(loadOffsetDragPreference()).toBe(false);
    });

    it('returns true when saved as "true"', () => {
        localStorage.setItem(OFFSET_DRAG_KEY, 'true');
        expect(loadOffsetDragPreference()).toBe(true);
    });

    it('returns false when saved as "false"', () => {
        localStorage.setItem(OFFSET_DRAG_KEY, 'false');
        expect(loadOffsetDragPreference()).toBe(false);
    });

    it('saves and loads round-trip', () => {
        saveOffsetDragPreference(false);
        expect(loadOffsetDragPreference()).toBe(false);

        saveOffsetDragPreference(true);
        expect(loadOffsetDragPreference()).toBe(true);
    });
});
