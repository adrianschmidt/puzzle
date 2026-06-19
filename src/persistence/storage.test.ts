/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the persistence storage layer.
 *
 * Uses jsdom's localStorage implementation via Vitest's jsdom environment.
 */

// vi.mock is hoisted to the top by Vitest. Wrapping decompressFromStorage in a
// vi.fn pass-through makes it spy-able even when called from within storage.ts,
// which holds a direct binding to the function. The mock calls the real
// implementation, so all other tests continue to work correctly.
vi.mock('./compression.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./compression.js')>();
    return {
        ...actual,
        decompressFromStorage: vi.fn(actual.decompressFromStorage),
    };
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import * as compression from './compression.js';
import { COMPRESSED_MARKER } from './compression.js';
import { STATE_VERSION, serializeProgress, type SerializedViewport } from './serialization.js';
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
import {
    makeRectPiece,
    makeGameState as makeBaseGameState,
} from '../test-helpers/fixtures.js';

/** The persisted selection, or `[]` when nothing/none is saved. */
function loadedSelection(): number[] {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.selection : [];
}

/** The persisted viewport, or undefined when none is saved. */
function loadedViewport(): SerializedViewport | undefined {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.viewport : undefined;
}

/** Assert the save loaded successfully and return its `ok` payload. */
function expectLoaded(): { state: GameState; selection: number[] } {
    const outcome = loadSavedGame();
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected an ok load outcome');
    return outcome;
}

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

        const loaded = expectLoaded();
        expect(loaded.state.pieces).toEqual(state.pieces);
        expect(loaded.selection).toEqual([1, 0]);
    });

    it('leaves the previous puzzle loadable when the new geometry write fails', () => {
        saveNewPuzzle(makeGameState({ seed: 1, imageUrl: 'good.jpg' }), [0]);

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realSetItem = Storage.prototype.setItem;
        // Geometry writes (STORAGE_KEY) fail; small progress writes still succeed.
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (key === STORAGE_KEY) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveNewPuzzle(makeGameState({ seed: 2, imageUrl: 'too-big.jpg' }), [1]);
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        // The previous pair is intact: load returns the previous puzzle, not a
        // seed-mismatch.
        const loaded = expectLoaded();
        expect(loaded.state.imageUrl).toBe('good.jpg');
        expect(loaded.state.seed).toBe(1);
    });

    it('does not leave an orphan progress key when the first puzzle is too large to save', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const realSetItem = Storage.prototype.setItem;
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key: string, value: string) {
                if (key === STORAGE_KEY) {
                    throw new DOMException('quota', 'QuotaExceededError');
                }
                realSetItem.call(this, key, value);
            });

        const result = saveNewPuzzle(makeGameState({ seed: 1 }), [0]); // empty storage
        spy.mockRestore();
        warnSpy.mockRestore();

        expect(result).toBe('failed');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull(); // no orphan progress
        expect(loadSavedGame().status).toBe('empty');
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

    it('reports "empty" when nothing is saved at all', () => {
        expect(loadSavedGame().status).toBe('empty');
        expect(loadedSelection()).toEqual([]);
    });

    it('reports "unreadable" for corrupted JSON', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem(STORAGE_KEY, '{ not json');
        expect(loadSavedGame().status).toBe('unreadable');
        expect(loadedSelection()).toEqual([]);
        warnSpy.mockRestore();
    });

    it('returns the state and selection from a recombined pair', () => {
        const state = makeGameState();
        saveNewPuzzle(state, [0, 1]);

        const saved = expectLoaded();
        expect(saved.state.imageUrl).toBe('test-image.jpg');
        expect(saved.state.groups.length).toBe(2);
        expect(saved.selection).toEqual([0, 1]);
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

        const loaded = expectLoaded();
        expect(loaded.state.pieces).toEqual(state.pieces);
        expect(loaded.state.groups.length).toBe(state.groups.length);
        expect(loaded.selection).toEqual([1, 0]);
    });

    it('saveProgress writes only the progress key, leaving the geometry untouched', () => {
        const state = makeGameState({ seed: 5 });
        saveNewPuzzle(state, []);
        const geometryBefore = localStorage.getItem(STORAGE_KEY);

        saveProgress(state, [2]);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(geometryBefore); // unchanged
        expect(expectLoaded().selection).toEqual([2]);
    });

    it('reports "unreadable" for a torn pair (geometry present, progress missing) and logs why', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveGeometry(makeGameState({ seed: 5 })); // writes only the v11 static key
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        expect(loadSavedGame().status).toBe('unreadable');
        expect(warnSpy).toHaveBeenCalled(); // intentional discard leaves a trail
        warnSpy.mockRestore();
    });

    it('reports "unreadable" for a seed-mismatched pair and logs why', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const a = makeGameState({ seed: 1 });
        const b = makeGameState({ seed: 2 });
        saveGeometry(a);
        // saveProgress now refuses to write a seed-mismatched pair, so install the
        // stale/cross-tab progress blob directly — the on-disk shape the load-time
        // guard must still detect.
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(serializeProgress(b, [])));
        expect(loadSavedGame().status).toBe('unreadable');
        expect(warnSpy).toHaveBeenCalled(); // intentional discard leaves a trail
        warnSpy.mockRestore();
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

        const loaded = expectLoaded();
        expect(loaded.state.pieces).toEqual(state.pieces);
        expect(loaded.state.groups.length).toBe(state.groups.length);
        expect(loaded.selection).toEqual([1]);
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
        const loaded = expectLoaded();
        expect(loaded.selection).toEqual([0]); // from progress, not the legacy blob
        expect(loaded.state.pieces).toEqual(state.pieces); // geometry from the legacy static blob
        expect(loaded.state.groups.length).toBe(state.groups.length); // groups recombined from progress
    });

    it('clearSavedState removes both keys', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), [1]);
        clearSavedState();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
    });

    it('reports "empty" for an orphaned progress key when geometry is missing', () => {
        saveProgress(makeGameState({ seed: 5 }), [1]); // only the progress key, no geometry
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        // No geometry anchor: the stray progress key is a harmless torn-write
        // artifact, not a recognizable save, so this is "empty" not "unreadable".
        expect(loadSavedGame().status).toBe('empty');
    });
});

describe('saveProgress cross-tab guard (#404)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks(); // reset the vi.mock'd decompressFromStorage call count
    });

    it('refuses to overwrite progress when the stored geometry is a different puzzle', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]); // geometry=1, progress=1
        const progressBefore = localStorage.getItem(PROGRESS_KEY);

        const result = saveProgress(makeGameState({ seed: 2 }), [1]); // stale tab
        warnSpy.mockRestore();

        expect(result).toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(progressBefore); // untouched
    });

    it('logs why it skipped a mismatched progress write', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]);
        saveProgress(makeGameState({ seed: 2 }), [1]);

        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('keeps the most-recent geometry owner so reload is not a seed-mismatch', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Tab A started puzzle 1; a stale background Tab B autosaves puzzle 2.
        saveNewPuzzle(makeGameState({ seed: 1 }), [0]);
        saveProgress(makeGameState({ seed: 2 }), [1]);
        warnSpy.mockRestore();

        const loaded = expectLoaded();
        expect(loaded.state.seed).toBe(1); // still puzzle 1, pair intact
    });

    it('writes normally when the stored geometry is the same puzzle', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []);
        const result = saveProgress(makeGameState({ seed: 5 }), [1]);

        expect(result).not.toBe('skipped');
        expect(expectLoaded().selection).toEqual([1]);
    });

    it('writes when no geometry is present (nothing to mismatch against)', () => {
        const result = saveProgress(makeGameState({ seed: 7 }), [1]);
        expect(result).not.toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
    });

    it('writes when the stored geometry is unreadable (does not block on it)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
        const result = saveProgress(makeGameState({ seed: 7 }), [1]);
        warnSpy.mockRestore();

        expect(result).not.toBe('skipped');
        expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
    });

    it('writes when either side has no seed (only a confirmed mismatch skips)', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []); // geometry has seed 5
        const result = saveProgress(makeGameState(), [1]); // progress has no seed
        expect(result).not.toBe('skipped');
    });

    it('does not re-decode the geometry on repeated same-puzzle saves (cache)', () => {
        // saveGeometry does not read/decode, so the cache still holds whatever a
        // previous test left. A unique seed guarantees the first read is a cache
        // miss (one decode); subsequent reads of the unchanged bytes must not
        // decode again.
        saveGeometry(makeGameState({ seed: 424242 }));
        const spy = vi.spyOn(compression, 'decompressFromStorage');

        saveProgress(makeGameState({ seed: 424242 }), [1]); // miss → 1 decode
        const afterFirst = spy.mock.calls.length;
        saveProgress(makeGameState({ seed: 424242 }), [2]); // hit → 0
        saveProgress(makeGameState({ seed: 424242 }), [3]); // hit → 0

        expect(afterFirst).toBe(1); // also proves the spy intercepts storage.ts
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('skips after a cross-tab geometry change (cache invalidation)', () => {
        // Geometry replaced by a different puzzle between two progress saves: the
        // raw bytes change, so the guard re-reads the new seed and now skips.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 1 }), []); // geometry=1
        expect(saveProgress(makeGameState({ seed: 1 }), [1])).not.toBe('skipped');

        saveGeometry(makeGameState({ seed: 2 })); // another tab takes over → geometry=2
        expect(saveProgress(makeGameState({ seed: 1 }), [2])).toBe('skipped');
        warnSpy.mockRestore();
    });
});

describe('unreadable save carries the raw blobs for download', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        localStorage.clear();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('attaches the raw geometry verbatim on corrupt JSON (reason: parse-error)', () => {
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');

        const outcome = loadSavedGame();
        expect(outcome.status).toBe('unreadable');
        if (outcome.status !== 'unreadable') throw new Error('expected unreadable');
        expect(outcome.reason).toBe('parse-error');
        expect(outcome.raw.geometry).toBe('{not valid json!!!');
        expect(outcome.raw.progress).toBeNull();
    });

    it('still captures the progress blob when the geometry itself is corrupt', () => {
        // A corrupt geometry blob throws on parse before the progress key would
        // otherwise be decoded; the raw snapshot must still include progress so
        // the download is complete.
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
        saveProgress(makeGameState({ seed: 7 }), [1]);
        const progressRaw = localStorage.getItem(PROGRESS_KEY);

        const outcome = loadSavedGame();
        if (outcome.status !== 'unreadable') throw new Error('expected unreadable');
        expect(outcome.reason).toBe('parse-error');
        expect(outcome.raw.geometry).toBe('{not valid json!!!');
        expect(outcome.raw.progress).toBe(progressRaw);
    });

    it('attaches both raw blobs for a seed-mismatched pair (reason: seed-mismatch)', () => {
        saveGeometry(makeGameState({ seed: 1 }));
        // Install the mismatched progress blob directly (saveProgress now guards
        // against writing one); the load-time guard must still flag the pair.
        localStorage.setItem(
            PROGRESS_KEY,
            JSON.stringify(serializeProgress(makeGameState({ seed: 2 }), [])),
        );
        const staticRaw = localStorage.getItem(STORAGE_KEY);
        const progressRaw = localStorage.getItem(PROGRESS_KEY);

        const outcome = loadSavedGame();
        expect(outcome.status).toBe('unreadable');
        if (outcome.status !== 'unreadable') throw new Error('expected unreadable');
        expect(outcome.reason).toBe('seed-mismatch');
        expect(outcome.raw.geometry).toBe(staticRaw);
        expect(outcome.raw.progress).toBe(progressRaw);
    });

    it('reports reason "torn-write" for geometry present with no progress', () => {
        saveGeometry(makeGameState({ seed: 5 }));
        const outcome = loadSavedGame();
        if (outcome.status !== 'unreadable') throw new Error('expected unreadable');
        expect(outcome.reason).toBe('torn-write');
    });

    it('does not modify localStorage (read-only — the live keys are left intact)', () => {
        localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
        const before = localStorage.getItem(STORAGE_KEY);
        const keyCountBefore = localStorage.length;

        loadSavedGame();

        expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
        expect(localStorage.length).toBe(keyCountBefore); // no extra backup keys written
    });

    it('reports "empty" (no raw) when nothing is saved', () => {
        expect(loadSavedGame()).toEqual({ status: 'empty' });
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

        const { save } = createDebouncedSave({ onSaveFailed });
        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).toHaveBeenCalledOnce();
        setItemSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('does not invoke onSaveFailed on a successful save', () => {
        const onSaveFailed = vi.fn();
        const { save } = createDebouncedSave({ onSaveFailed });

        save(makeGameState());
        vi.advanceTimersByTime(500);

        expect(onSaveFailed).not.toHaveBeenCalled();
    });

    it('invokes onSaveSkipped (not onSaveFailed) when a flushed save is skipped', () => {
        const onSaveFailed = vi.fn();
        const onSaveSkipped = vi.fn();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Stored geometry belongs to a different puzzle than the one autosaved —
        // a cross-tab takeover. saveProgress returns 'skipped'.
        saveGeometry(makeGameState({ seed: 1 }));
        const { save } = createDebouncedSave({ onSaveFailed, onSaveSkipped });

        save(makeGameState({ seed: 2 }));
        vi.advanceTimersByTime(500);
        warnSpy.mockRestore();

        expect(onSaveSkipped).toHaveBeenCalledOnce();
        expect(onSaveFailed).not.toHaveBeenCalled();
    });

    it('does not invoke onSaveSkipped on a normal save', () => {
        const onSaveSkipped = vi.fn();
        saveGeometry(makeGameState({ seed: 5 }));
        const { save } = createDebouncedSave({ onSaveSkipped });

        save(makeGameState({ seed: 5 }));
        vi.advanceTimersByTime(500);

        expect(onSaveSkipped).not.toHaveBeenCalled();
    });
});

describe('viewport persistence through storage', () => {
    beforeEach(() => localStorage.clear());

    const VP = { scale: 2, offset: { x: 10, y: 20 } };

    it('saveNewPuzzle round-trips a viewport through loadSavedGame', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), [], VP);
        expect(loadedViewport()).toEqual(VP);
    });

    it('returns undefined when no viewport was saved', () => {
        saveNewPuzzle(makeGameState({ seed: 5 }), []);
        expect(loadedViewport()).toBeUndefined();
    });

    it('saveProgress persists the viewport on top of existing geometry', () => {
        const state = makeGameState({ seed: 5 });
        saveNewPuzzle(state, []);
        saveProgress(state, [], VP);
        expect(loadedViewport()).toEqual(VP);
    });

    it('createDebouncedSave forwards the viewport captured at save time', () => {
        vi.useFakeTimers();
        try {
            const state = makeGameState({ seed: 5 });
            saveGeometry(state);
            const { save } = createDebouncedSave();
            save(state, [], VP);
            vi.advanceTimersByTime(500);
            expect(loadedViewport()).toEqual(VP);
        } finally {
            vi.useRealTimers();
        }
    });

    it('still loads (default view) but warns when a present viewport is malformed', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const state = makeGameState({ seed: 5 });
        saveGeometry(state);
        // A viewport field is present but corrupt (non-finite scale). The save
        // must still load — falling back to the default view — but the silent
        // zoom loss should leave a diagnostics trail, unlike the absent-viewport
        // pre-feature case.
        const progress = serializeProgress(state, [], {
            scale: Number.NaN,
            offset: { x: 0, y: 0 },
        });
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));

        const outcome = loadSavedGame();
        expect(outcome.status).toBe('ok');
        expect(loadedViewport()).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('does not warn when no viewport is present (pre-feature save)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveNewPuzzle(makeGameState({ seed: 5 }), []);
        expect(loadedViewport()).toBeUndefined();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
