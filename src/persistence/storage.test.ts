/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the persistence storage layer.
 *
 * Uses jsdom's localStorage implementation via Vitest's jsdom environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import {
    saveState,
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
} from './storage.js';
import { COMPRESSED_MARKER } from './compression.js';

/** The persisted selection, or `[]` when nothing/none is saved. */
function loadedSelection(): number[] {
    return loadSavedGame()?.selection ?? [];
}
import { STATE_VERSION } from './serialization.js';
import {
    makeRectPiece,
    makeGameState as makeBaseGameState,
} from '../test-helpers/fixtures.js';

function makeGameState(overrides?: Partial<GameState>): GameState {
    const pieces = [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 })];

    const groups: PieceGroup[] = [
        {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 50, y: 50 },
            rotation: 0,
        },
        {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        },
    ];

    return makeBaseGameState({
        pieces,
        groups,
        imageUrl: 'test-image.jpg',
        ...overrides,
    });
}

describe('saveState / loadState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('round-trips a game state through localStorage', () => {
        const state = makeGameState();
        saveState(state);

        const restored = loadState();
        expect(restored).toBeDefined();
        expect(restored!.imageUrl).toBe('test-image.jpg');
        expect(restored!.completed).toBe(false);
        expect(restored!.pieces).toEqual(state.pieces);
        expect(restored!.groups.length).toBe(2);
        expect(restored!.groups[0].pieces).toBeInstanceOf(Map);
        expect(restored!.groups[0].pieces.get(0)).toEqual({ x: 0, y: 0 });
    });

    it('returns undefined when nothing is saved', () => {
        expect(loadState()).toBeUndefined();
    });

    it('returns undefined for corrupted JSON', () => {
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = loadState();

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it('returns undefined for wrong version', () => {
        const badData = {
            version: 999,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                },
            ],
            imageUrl: 'test.jpg',
            completed: false,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(badData));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = loadState();

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it('returns undefined for structurally invalid data', () => {
        const badData = {
            version: STATE_VERSION,
            pieces: [],
            groups: [],
            imageUrl: '',
            completed: false,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(badData));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = loadState();

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it('saves and restores completed state', () => {
        const state = makeGameState({ completed: true });
        saveState(state);

        const restored = loadState();
        expect(restored!.completed).toBe(true);
    });
});

describe('saveState quota handling', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns "ok" and stores an uncompressed value for a normal save', () => {
        const result = saveState(makeGameState());
        expect(result).toBe('ok');
        expect(localStorage.getItem(STORAGE_KEY)!.startsWith(COMPRESSED_MARKER)).toBe(false);
    });

    it('falls back to a compressed write when the plain write exceeds quota', () => {
        const state = makeGameState();
        const realSetItem = Storage.prototype.setItem;

        // Reject the large uncompressed write; accept the compressed retry.
        // Discriminate by the marker, not by size, so the test is robust.
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (!value.startsWith(COMPRESSED_MARKER)) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveState(state);
        spy.mockRestore();

        expect(result).toBe('ok-compressed');
        const stored = localStorage.getItem(STORAGE_KEY)!;
        expect(stored.startsWith(COMPRESSED_MARKER)).toBe(true);

        const restored = loadState();
        expect(restored!.pieces).toEqual(state.pieces);
    });

    it('preserves a prior good save and returns "failed" when both writes throw', () => {
        saveState(makeGameState({ imageUrl: 'good.jpg' }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });

        const result = saveState(makeGameState({ imageUrl: 'too-big.jpg' }));
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The earlier good save is untouched (we never removeItem first).
        expect(loadState()!.imageUrl).toBe('good.jpg');
    });
});

describe('saveState / loadSavedGame selection', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('round-trips a multi-select selection alongside the state', () => {
        const state = makeGameState();
        saveState(state, [1, 0]);

        expect(loadedSelection()).toEqual([1, 0]);
    });

    it('returns an empty array when no selection was saved', () => {
        const state = makeGameState();
        saveState(state);

        expect(loadedSelection()).toEqual([]);
    });

    it('treats an empty selection as no selection (omits the field)', () => {
        const state = makeGameState();
        saveState(state, []);

        expect(loadedSelection()).toEqual([]);
    });

    it('returns an empty array (undefined game) when nothing is saved at all', () => {
        expect(loadSavedGame()).toBeUndefined();
        expect(loadedSelection()).toEqual([]);
    });

    it('returns undefined for corrupted JSON', () => {
        localStorage.setItem(STORAGE_KEY, '{ not json');
        expect(loadSavedGame()).toBeUndefined();
        expect(loadedSelection()).toEqual([]);
    });

    it('returns the state and selection from a single parse', () => {
        const state = makeGameState();
        saveState(state, [0, 1]);

        const saved = loadSavedGame();
        expect(saved!.state.imageUrl).toBe('test-image.jpg');
        expect(saved!.state.groups.length).toBe(2);
        expect(saved!.selection).toEqual([0, 1]);
    });
});

describe('clearSavedState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('removes the saved state', () => {
        const state = makeGameState();
        saveState(state);
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

        clearSavedState();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('is safe to call when nothing is saved', () => {
        expect(() => clearSavedState()).not.toThrow();
    });
});

describe('createDebouncedSave', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not save immediately', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        save(state);

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('saves after the debounce interval', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        save(state);
        vi.advanceTimersByTime(500);

        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        const restored = loadState();
        expect(restored!.imageUrl).toBe('test-image.jpg');
    });

    it('carries the selection captured at save time', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        save(state, [1, 0]);
        vi.advanceTimersByTime(500);

        expect(loadedSelection()).toEqual([1, 0]);
    });

    it('persists an empty selection when called without one', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        // Pre-seed a selection, then a save with no selection should clear it.
        saveState(state, [0, 1]);
        save(state);
        vi.advanceTimersByTime(500);

        expect(loadedSelection()).toEqual([]);
    });

    it('resets the timer on repeated calls', () => {
        const { save } = createDebouncedSave();
        const state1 = makeGameState({ imageUrl: 'first.jpg' });
        const state2 = makeGameState({ imageUrl: 'second.jpg' });

        save(state1);
        vi.advanceTimersByTime(300);

        // Second save within the debounce window resets the timer
        save(state2);
        vi.advanceTimersByTime(300);

        // 300ms after second call — not yet saved
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

        // Remaining 200ms — now it fires
        vi.advanceTimersByTime(200);
        const restored = loadState();
        expect(restored!.imageUrl).toBe('second.jpg');
    });

    it('flush saves immediately and clears pending', () => {
        const { save, flush } = createDebouncedSave();
        const state = makeGameState();

        save(state);
        flush();

        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

        // Advancing timers should not cause a double-save
        const saveSpy = vi.spyOn(Storage.prototype, 'setItem');
        vi.advanceTimersByTime(1000);
        expect(saveSpy).not.toHaveBeenCalled();
        saveSpy.mockRestore();
    });

    it('flush is safe when nothing is pending', () => {
        const { flush } = createDebouncedSave();

        expect(() => flush()).not.toThrow();
    });

    it('cancel discards the pending save', () => {
        const { save, cancel } = createDebouncedSave();
        const state = makeGameState();

        save(state);
        cancel();
        vi.advanceTimersByTime(1000);

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
