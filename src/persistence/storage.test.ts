/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the persistence storage layer.
 *
 * Uses jsdom's localStorage implementation via Vitest's jsdom environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { GameState, Piece, PieceGroup } from '../model/types.js';
import {
    saveState,
    loadState,
    clearSavedState,
    createDebouncedSave,
    STORAGE_KEY,
} from './storage.js';
import { STATE_VERSION } from './serialization.js';

/** Create a minimal valid piece for testing. */
function makePiece(id: number): Piece {
    return {
        id,
        edges: [
            {
                id: id * 10,
                mateEdgeId: -1,
                matePieceId: -1,
                path: 'M0,0 L100,0',
                start: { x: 0, y: 0 },
                end: { x: 100, y: 0 },
            },
        ],
        shape: 'M0,0 L100,0 L100,100 L0,100 Z',
        imageOffset: { x: id * 100, y: 0 },
    };
}

/** Create a minimal valid game state for testing. */
function makeGameState(overrides?: Partial<GameState>): GameState {
    const pieces = [makePiece(0), makePiece(1)];

    const groups: PieceGroup[] = [
        {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 50, y: 50 },
        },
        {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
        },
    ];

    return {
        pieces,
        groups,
        imageUrl: 'test-image.jpg',
        imageSize: { width: 800, height: 600 },
        completed: false,
        ...overrides,
    };
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
            pieces: [makePiece(0)],
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
