/**
 * Tests for GameState serialization/deserialization.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, Piece, PieceGroup } from '../model/types.js';
import {
    serializeState,
    deserializeState,
    STATE_VERSION,
    type SerializedGameState,
} from './serialization.js';

/**
 * Create a minimal valid piece for testing with 4 edges forming a 100×100 square.
 *
 * Image offsets simulate a grid: piece 0 at (0,0), piece 1 at (-100,0), etc.
 * This lets getImageDimensions derive a meaningful size from the pieces.
 */
function makePiece(id: number): Piece {
    return {
        id,
        edges: [
            { id: id * 10, mateEdgeId: -1, matePieceId: -1, path: 'L100,0', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
            { id: id * 10 + 1, mateEdgeId: -1, matePieceId: -1, path: 'L100,100', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
            { id: id * 10 + 2, mateEdgeId: -1, matePieceId: -1, path: 'L0,100', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
            { id: id * 10 + 3, mateEdgeId: -1, matePieceId: -1, path: 'L0,0', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
        ],
        shape: 'M0,0 L100,0 L100,100 L0,100 Z',
        imageOffset: { x: id === 0 ? 0 : -id * 100, y: 0 },
    };
}

/** Create a minimal valid game state for testing. */
function makeGameState(overrides?: Partial<GameState>): GameState {
    const pieces = [makePiece(0), makePiece(1), makePiece(2)];

    const groups: PieceGroup[] = [
        {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 50, y: 50 },
            rotation: 0,
        },
        {
            id: 2,
            pieces: new Map([[2, { x: 0, y: 0 }]]),
            position: { x: 300, y: 200 },
            rotation: 0,
        },
    ];

    return {
        pieces,
        groups,
        imageUrl: 'test-image.jpg',
        imageSize: { width: 800, height: 600 },
        gridSize: { cols: 8, rows: 6 },
        completed: false,
        ...overrides,
    };
}

describe('serializeState', () => {
    it('converts Maps to entries arrays', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.groups[0].pieces).toEqual([
            [0, { x: 0, y: 0 }],
            [1, { x: 100, y: 0 }],
        ]);
        expect(serialized.groups[1].pieces).toEqual([[2, { x: 0, y: 0 }]]);
    });

    it('includes the state version', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.version).toBe(STATE_VERSION);
    });

    it('preserves all scalar fields', () => {
        const state = makeGameState({ completed: true });
        const serialized = serializeState(state);

        expect(serialized.imageUrl).toBe('test-image.jpg');
        expect(serialized.imageSize).toEqual({ width: 800, height: 600 });
        expect(serialized.completed).toBe(true);
        expect(serialized.pieces).toEqual(state.pieces);
    });

    it('preserves group positions', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.groups[0].position).toEqual({ x: 50, y: 50 });
        expect(serialized.groups[1].position).toEqual({ x: 300, y: 200 });
    });

    it('produces JSON-safe output', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        // Should round-trip through JSON without loss
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);

        expect(parsed).toEqual(serialized);
    });

    it('includes attribution when present', () => {
        const state = makeGameState({
            attribution: {
                photographerName: 'Test Author',
                photographerUrl: 'https://unsplash.com/@test',
                photoUrl: 'https://unsplash.com/photos/abc',
            },
        });
        const serialized = serializeState(state);

        expect(serialized.attribution).toEqual({
            photographerName: 'Test Author',
            photographerUrl: 'https://unsplash.com/@test',
            photoUrl: 'https://unsplash.com/photos/abc',
        });
    });

    it('omits attribution when not present', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.attribution).toBeUndefined();
    });

    it('includes generatorConfig when present', () => {
        const state = makeGameState({
            generatorConfig: { borderless: true },
        });
        const serialized = serializeState(state);

        expect(serialized.generatorConfig).toEqual({ borderless: true });
    });

    it('omits generatorConfig when not present', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.generatorConfig).toBeUndefined();
    });

    it('round-trips generatorConfig through serialization', () => {
        const state = makeGameState({
            generatorConfig: {
                horizontalAmplitude: 0.15,
                verticalFrequency: 2,
                disableTabs: false,
            },
        });
        const restored = deserializeState(serializeState(state));

        expect(restored.generatorConfig).toEqual({
            horizontalAmplitude: 0.15,
            verticalFrequency: 2,
            disableTabs: false,
        });
    });
});

describe('deserializeState', () => {
    it('reconstructs Maps from entries arrays', () => {
        const state = makeGameState();
        const serialized = serializeState(state);
        const restored = deserializeState(serialized);

        expect(restored.groups[0].pieces).toBeInstanceOf(Map);
        expect(restored.groups[0].pieces.get(0)).toEqual({ x: 0, y: 0 });
        expect(restored.groups[0].pieces.get(1)).toEqual({ x: 100, y: 0 });
        expect(restored.groups[1].pieces).toBeInstanceOf(Map);
        expect(restored.groups[1].pieces.get(2)).toEqual({ x: 0, y: 0 });
    });

    it('round-trips through JSON faithfully', () => {
        const original = makeGameState();
        const serialized = serializeState(original);
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json) as SerializedGameState;
        const restored = deserializeState(parsed);

        // Pieces should be identical
        expect(restored.pieces).toEqual(original.pieces);

        // Groups: compare structurally (Maps vs entries)
        expect(restored.groups.length).toBe(original.groups.length);

        for (let i = 0; i < original.groups.length; i++) {
            expect(restored.groups[i].id).toBe(original.groups[i].id);
            expect(restored.groups[i].position).toEqual(
                original.groups[i].position,
            );
            expect(Array.from(restored.groups[i].pieces.entries())).toEqual(
                Array.from(original.groups[i].pieces.entries()),
            );
        }

        expect(restored.imageUrl).toBe(original.imageUrl);
        expect(restored.imageSize).toEqual(original.imageSize);
        expect(restored.completed).toBe(original.completed);
    });

    it('round-trips attribution through JSON', () => {
        const original = makeGameState({
            attribution: {
                photographerName: 'Jane Doe',
                photographerUrl: 'https://unsplash.com/@jane',
                photoUrl: 'https://unsplash.com/photos/xyz',
            },
        });

        const serialized = serializeState(original);
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json) as SerializedGameState;
        const restored = deserializeState(parsed);

        expect(restored.attribution).toEqual(original.attribution);
    });

    it('migrates v1 state by deriving imageSize from pieces', () => {
        // Simulate a v1 saved state (no imageSize field)
        const v1Serialized: SerializedGameState = {
            version: 1,
            pieces: [makePiece(0), makePiece(1), makePiece(2)],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'old-image.jpg',
            completed: false,
        };

        const restored = deserializeState(v1Serialized);

        // Should derive imageSize from piece data
        expect(restored.imageSize).toBeDefined();
        expect(restored.imageSize.width).toBeGreaterThan(0);
        expect(restored.imageSize.height).toBeGreaterThan(0);
    });

    it('migrates v2 state by defaulting gridSize to 8×6', () => {
        // Simulate a v2 saved state (has imageSize but no gridSize)
        const v2Serialized: SerializedGameState = {
            version: 2,
            pieces: [makePiece(0), makePiece(1)],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
                { id: 1, pieces: [[1, { x: 0, y: 0 }]], position: { x: 100, y: 0 } },
            ],
            imageUrl: 'v2-image.jpg',
            imageSize: { width: 800, height: 600 },
            completed: false,
        };

        const restored = deserializeState(v2Serialized);

        expect(restored.gridSize).toEqual({ cols: 8, rows: 6 });
    });

    it('defaults rotation to 0 when missing (v5 → v6 migration)', () => {
        // Simulate a v5 saved state (has cutStyle but no rotation on groups)
        const v5Serialized: SerializedGameState = {
            version: 5,
            pieces: [makePiece(0), makePiece(1)],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
                { id: 1, pieces: [[1, { x: 0, y: 0 }]], position: { x: 100, y: 0 } },
            ],
            imageUrl: 'v5-image.jpg',
            imageSize: { width: 800, height: 600 },
            completed: false,
        };

        const restored = deserializeState(v5Serialized);

        expect(restored.groups[0].rotation).toBe(0);
        expect(restored.groups[1].rotation).toBe(0);
    });

    it('round-trips non-zero rotation values', () => {
        const original = makeGameState();
        original.groups[0].rotation = 2;
        original.groups[1].rotation = 3;

        const serialized = serializeState(original);
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json) as SerializedGameState;
        const restored = deserializeState(parsed);

        expect(restored.groups[0].rotation).toBe(2);
        expect(restored.groups[1].rotation).toBe(3);
    });

    it('coerces out-of-range rotation values to 0', () => {
        const bad: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makePiece(0)],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                    rotation: 7,
                },
            ],
            imageUrl: 'test.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            completed: false,
        };

        const restored = deserializeState(bad);
        expect(restored.groups[0].rotation).toBe(0);
    });

    it('preserves gridSize in v3 round-trip', () => {
        const original = makeGameState({
            gridSize: { cols: 12, rows: 8 },
        });

        const serialized = serializeState(original);
        expect(serialized.gridSize).toEqual({ cols: 12, rows: 8 });

        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json) as SerializedGameState;
        const restored = deserializeState(parsed);

        expect(restored.gridSize).toEqual({ cols: 12, rows: 8 });
    });

    it('throws on unsupported version', () => {
        const state = makeGameState();
        const serialized = serializeState(state);
        serialized.version = 999;

        expect(() => deserializeState(serialized)).toThrow(
            'Unsupported state version: 999',
        );
    });

    it('throws on empty pieces array', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'test.jpg',
            completed: false,
        };

        expect(() => deserializeState(serialized)).toThrow(
            'pieces must be a non-empty array',
        );
    });

    it('throws on empty groups array', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makePiece(0)],
            groups: [],
            imageUrl: 'test.jpg',
            completed: false,
        };

        expect(() => deserializeState(serialized)).toThrow(
            'groups must be a non-empty array',
        );
    });

    it('throws on missing imageUrl', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makePiece(0)],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: '',
            completed: false,
        };

        expect(() => deserializeState(serialized)).toThrow(
            'imageUrl must be a non-empty string',
        );
    });

    it('throws on invalid group position', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makePiece(0)],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: NaN, y: 0 },
                },
            ],
            imageUrl: 'test.jpg',
            completed: false,
        };

        expect(() => deserializeState(serialized)).toThrow(
            'must have a valid position',
        );
    });

    it('round-trips rotationMode', () => {
        const original = makeGameState({
            cutStyle: 'fractal',
            rotationMode: 'quarter-turn',
        });

        const serialized = serializeState(original);
        expect(serialized.rotationMode).toBe('quarter-turn');

        const restored = deserializeState(
            JSON.parse(JSON.stringify(serialized)) as SerializedGameState,
        );
        expect(restored.rotationMode).toBe('quarter-turn');
    });

    it('infers rotationMode = "quarter-turn" from non-zero group rotations (missing field)', () => {
        const v6WithoutMode: SerializedGameState = {
            version: 6,
            pieces: [makePiece(0), makePiece(1)],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                    rotation: 2,
                },
                {
                    id: 1,
                    pieces: [[1, { x: 0, y: 0 }]],
                    position: { x: 100, y: 0 },
                    rotation: 0,
                },
            ],
            imageUrl: 'v6-image.jpg',
            imageSize: { width: 800, height: 600 },
            completed: false,
        };

        const restored = deserializeState(v6WithoutMode);
        expect(restored.rotationMode).toBe('quarter-turn');
    });

    it('infers rotationMode = "quarter-turn" for pre-field fractal saves', () => {
        const fractalNoMode: SerializedGameState = {
            version: 6,
            pieces: [makePiece(0)],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                    rotation: 0,
                },
            ],
            imageUrl: 'frac.jpg',
            imageSize: { width: 800, height: 600 },
            completed: false,
            cutStyle: 'fractal',
        };

        const restored = deserializeState(fractalNoMode);
        expect(restored.rotationMode).toBe('quarter-turn');
    });

    it('defaults rotationMode to "none" for classic saves without the field', () => {
        const classicNoMode: SerializedGameState = {
            version: 6,
            pieces: [makePiece(0)],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                    rotation: 0,
                },
            ],
            imageUrl: 'classic.jpg',
            imageSize: { width: 800, height: 600 },
            completed: false,
            cutStyle: 'classic',
        };

        const restored = deserializeState(classicNoMode);
        expect(restored.rotationMode).toBe('none');
    });

    it('throws on group with no pieces', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makePiece(0)],
            groups: [
                { id: 0, pieces: [], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'test.jpg',
            completed: false,
        };

        expect(() => deserializeState(serialized)).toThrow(
            'must have at least one piece',
        );
    });
});
