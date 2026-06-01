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
    saveGeometry,
    saveProgress,
    saveNewPuzzle,
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
    PROGRESS_KEY,
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

describe('saveNewPuzzle / loadState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('round-trips a game state through localStorage', () => {
        const state = makeGameState();
        saveNewPuzzle(state);

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
        // Empty groups → treated as a torn v11 static-only blob (no progress key).
        // The new two-key model returns undefined silently in this case rather
        // than trying to deserialize and throwing.
        const badData = {
            version: STATE_VERSION,
            pieces: [],
            groups: [],
            imageUrl: '',
            completed: false,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(badData));

        const result = loadState();
        expect(result).toBeUndefined();
    });

    it('saves and restores completed state', () => {
        const state = makeGameState({ completed: true });
        saveNewPuzzle(state);

        const restored = loadState();
        expect(restored!.completed).toBe(true);
    });
});

describe('saveNewPuzzle quota handling', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns "ok" and stores an uncompressed geometry for a normal save', () => {
        const result = saveNewPuzzle(makeGameState());
        expect(result).toBe('ok');
        expect(localStorage.getItem(STORAGE_KEY)!.startsWith(COMPRESSED_MARKER)).toBe(false);
    });

    it('falls back to a compressed write when the plain write exceeds quota', () => {
        const state = makeGameState();
        const realSetItem = Storage.prototype.setItem;

        // Reject all uncompressed writes; accept compressed retries.
        // Discriminate by the marker, not by size, so the test is robust.
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (!value.startsWith(COMPRESSED_MARKER)) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveNewPuzzle(state);
        spy.mockRestore();

        expect(result).toBe('ok-compressed');
        // At least the geometry key should be compressed.
        const stored = localStorage.getItem(STORAGE_KEY)!;
        expect(stored.startsWith(COMPRESSED_MARKER)).toBe(true);

        const restored = loadState();
        expect(restored!.pieces).toEqual(state.pieces);
    });

    it('preserves a prior good geometry save and returns "failed" when both writes throw', () => {
        saveNewPuzzle(makeGameState({ imageUrl: 'good.jpg' }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });

        const result = saveGeometry(makeGameState({ imageUrl: 'too-big.jpg' }));
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The earlier good geometry is untouched (we never removeItem first).
        // The prior progress key still matches the prior geometry, so load works.
        expect(loadState()!.imageUrl).toBe('good.jpg');
    });

    it('round-trips a compressed save (including selection) through loadSavedGame', () => {
        const state = makeGameState();
        const realSetItem = Storage.prototype.setItem;
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (!value.startsWith(COMPRESSED_MARKER)) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });
        saveNewPuzzle(state, [1, 0]);
        spy.mockRestore();

        const loaded = loadSavedGame();
        expect(loaded).toBeDefined();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.selection).toEqual([1, 0]);
    });
});

describe('saveNewPuzzle / loadSavedGame selection', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('round-trips a multi-select selection alongside the state', () => {
        const state = makeGameState();
        saveNewPuzzle(state, [1, 0]);

        expect(loadedSelection()).toEqual([1, 0]);
    });

    it('returns an empty array when no selection was saved', () => {
        const state = makeGameState();
        saveNewPuzzle(state);

        expect(loadedSelection()).toEqual([]);
    });

    it('treats an empty selection as no selection (omits the field)', () => {
        const state = makeGameState();
        saveNewPuzzle(state, []);

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

    it('returns the state and selection from a recombined pair', () => {
        const state = makeGameState();
        saveNewPuzzle(state, [0, 1]);

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
        saveNewPuzzle(state);
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

        clearSavedState();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('is safe to call when nothing is saved', () => {
        expect(() => clearSavedState()).not.toThrow();
    });
});

describe('split storage', () => {
    beforeEach(() => localStorage.clear());

    it('saveNewPuzzle writes both keys and round-trips through loadSavedGame', () => {
        const state = makeGameState({ seed: 5 });
        const result = saveNewPuzzle(state, [1, 0]);
        expect(result).not.toBe('failed');
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();

        const loaded = loadSavedGame();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.state.groups.length).toBe(state.groups.length);
        expect(loaded!.selection).toEqual([1, 0]);
    });

    it('saveProgress writes only the progress key, leaving the geometry untouched', () => {
        const state = makeGameState({ seed: 5 });
        saveNewPuzzle(state, []);
        const geometryBefore = localStorage.getItem(STORAGE_KEY);

        saveProgress(state, [2]);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(geometryBefore); // unchanged
        expect(loadSavedGame()!.selection).toEqual([2]);
    });

    it('discards a torn pair: geometry present, progress missing (v11 static)', () => {
        saveGeometry(makeGameState({ seed: 5 })); // writes only the v11 static key
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        expect(loadSavedGame()).toBeUndefined();
    });

    it('discards a seed-mismatched pair', () => {
        const a = makeGameState({ seed: 1 });
        const b = makeGameState({ seed: 2 });
        saveGeometry(a);
        saveProgress(b, []); // different seed
        expect(loadSavedGame()).toBeUndefined();
    });

    it('still loads a legacy single-key v10 save (groups inline, no progress key)', () => {
        // Hand-write a legacy full blob the way the old build stored it.
        const state = makeGameState({ seed: 9 });
        const legacy = {
            version: 10,
            pieces: state.pieces,
            groups: state.groups.map((g) => ({
                id: g.id,
                pieces: Array.from(g.pieces.entries()),
                position: g.position,
                rotation: g.rotation,
            })),
            imageUrl: state.imageUrl,
            imageSize: state.imageSize,
            gridSize: state.gridSize,
            completed: false,
            seed: 9,
            selection: [1],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();

        const loaded = loadSavedGame();
        expect(loaded!.state.pieces).toEqual(state.pieces);
        expect(loaded!.state.groups.length).toBe(state.groups.length);
        expect(loaded!.selection).toEqual([1]);
    });

    it('prefers the progress key over a legacy inline-groups blob (migration)', () => {
        const state = makeGameState({ seed: 9 });
        const legacy = {
            version: 10,
            pieces: state.pieces,
            groups: state.groups.map((g) => ({
                id: g.id, pieces: Array.from(g.pieces.entries()), position: g.position, rotation: g.rotation,
            })),
            imageUrl: state.imageUrl, imageSize: state.imageSize, gridSize: state.gridSize,
            completed: false, seed: 9,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
        // A newer progress write lands in the progress key.
        saveProgress(state, [0]);
        const loaded = loadSavedGame();
        expect(loaded!.selection).toEqual([0]); // from progress, not the legacy blob
    });

    it('clearSavedState removes both keys', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), [1]);
        clearSavedState();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
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

        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
    });

    it('saves after the debounce interval', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        // Geometry must be present for loadSavedGame to recombine.
        saveGeometry(state);
        save(state);
        vi.advanceTimersByTime(500);

        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
        const restored = loadState();
        expect(restored!.imageUrl).toBe('test-image.jpg');
    });

    it('carries the selection captured at save time', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        saveGeometry(state);
        save(state, [1, 0]);
        vi.advanceTimersByTime(500);

        expect(loadedSelection()).toEqual([1, 0]);
    });

    it('persists an empty selection when called without one', () => {
        const { save } = createDebouncedSave();
        const state = makeGameState();

        // Pre-seed a selection via saveNewPuzzle, then a debounced save with no
        // selection should overwrite the progress key with an empty selection.
        saveNewPuzzle(state, [0, 1]);
        save(state);
        vi.advanceTimersByTime(500);

        expect(loadedSelection()).toEqual([]);
    });

    it('resets the timer on repeated calls', () => {
        const { save } = createDebouncedSave();
        const state1 = makeGameState({ imageUrl: 'first.jpg' });
        const state2 = makeGameState({ imageUrl: 'second.jpg' });

        // Geometry for state2 (the one we expect to load).
        saveGeometry(state2);

        save(state1);
        vi.advanceTimersByTime(300);

        // Second save within the debounce window resets the timer
        save(state2);
        vi.advanceTimersByTime(300);

        // 300ms after second call — not yet saved
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();

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

        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();

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

        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
    });

    it('invokes onSaveFailed when a flushed save fails', () => {
        const onSaveFailed = vi.fn();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const setItemSpy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });

        const { save } = createDebouncedSave(onSaveFailed);
        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).toHaveBeenCalledOnce();
        setItemSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('does not invoke onSaveFailed on a successful save', () => {
        const onSaveFailed = vi.fn();
        const { save } = createDebouncedSave(onSaveFailed);

        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).not.toHaveBeenCalled();
    });
});
