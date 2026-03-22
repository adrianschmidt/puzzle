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
    const pieces = [makePiece(0), makePiece(1), makePiece(2)];

    const groups: PieceGroup[] = [
        {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 50, y: 50 },
        },
        {
            id: 2,
            pieces: new Map([[2, { x: 0, y: 0 }]]),
            position: { x: 300, y: 200 },
        },
    ];

    return {
        pieces,
        groups,
        imageUrl: 'test-image.jpg',
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
        expect(restored.completed).toBe(original.completed);
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
