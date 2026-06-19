/**
 * Tests for GameState serialization/deserialization.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import {
    serializeState,
    deserializeState,
    readSelection,
    serializeStatic,
    serializeProgress,
    readViewport,
    recombine,
    STATE_VERSION,
    type SerializedGameState,
} from './serialization.js';
import {
    makeRectPiece,
    makeGameState as makeBaseGameState,
} from '../test-helpers/fixtures.js';

function makeGameState(overrides?: Partial<GameState>): GameState {
    const pieces = [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 }), makeRectPiece({ id: 2 })];

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

    return makeBaseGameState({
        pieces,
        groups,
        imageUrl: 'test-image.jpg',
        ...overrides,
    });
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

    it('omits the selection field when none is passed', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.selection).toBeUndefined();
    });

    it('omits the selection field when the selection is empty', () => {
        const state = makeGameState();
        const serialized = serializeState(state, []);

        expect(serialized.selection).toBeUndefined();
    });

    it('includes the selection ids when present', () => {
        const state = makeGameState();
        const serialized = serializeState(state, new Set([2, 0]));

        expect(serialized.selection).toEqual([2, 0]);
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

    it('includes fractalConfig when present', () => {
        const state = makeGameState({
            cutStyle: 'fractal',
            fractalConfig: { borderless: true },
        });
        const serialized = serializeState(state);

        expect(serialized.fractalConfig).toEqual({ borderless: true });
        expect(serialized.composableConfig).toBeUndefined();
    });

    it('includes composableConfig when present', () => {
        const state = makeGameState({
            cutStyle: 'composable',
            composableConfig: {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.15, vf: 2 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        });
        const serialized = serializeState(state);

        expect(serialized.composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.15, vf: 2 },
            tabGenerator: 'classic',
            tabConfig: {},
        });
        expect(serialized.fractalConfig).toBeUndefined();
    });

    it('omits both cut-style configs when not present', () => {
        const state = makeGameState();
        const serialized = serializeState(state);

        expect(serialized.composableConfig).toBeUndefined();
        expect(serialized.fractalConfig).toBeUndefined();
    });

    it('round-trips composableConfig through serialization', () => {
        const state = makeGameState({
            cutStyle: 'composable',
            composableConfig: {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.15, vf: 2 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        });
        const restored = deserializeState(serializeState(state));

        expect(restored.composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.15, vf: 2 },
            tabGenerator: 'classic',
            tabConfig: {},
        });
    });

    it('round-trips fractalConfig through serialization', () => {
        const state = makeGameState({
            cutStyle: 'fractal',
            fractalConfig: { borderless: true },
        });
        const restored = deserializeState(serializeState(state));

        expect(restored.fractalConfig).toEqual({ borderless: true });
    });

    it('round-trips composableConfig.borderless', () => {
        const state = makeGameState({
            cutStyle: 'composable',
            composableConfig: {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.2, hf: 1, va: 0.3, vf: 2 },
                tabGenerator: 'classic',
                tabConfig: {},
                borderless: true,
            },
        });
        const serialized = serializeState(state);
        expect(serialized.composableConfig?.borderless).toBe(true);
    });

    it('round-trips wavyConfig.borderless through serializeState/deserializeState', () => {
        const state = makeGameState({
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
        });
        const restored = deserializeState(serializeState(state));
        expect(restored.wavyConfig).toEqual({ borderless: true });
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
            pieces: [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 }), makeRectPiece({ id: 2 })],
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
            pieces: [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 })],
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

    it('migrates v7 fractal generatorConfig to fractalConfig', () => {
        const v7Serialized: SerializedGameState = {
            version: 7,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'v7-fractal.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            cutStyle: 'fractal',
            rotationMode: 'quarter-turn',
            completed: false,
            generatorConfig: { borderless: true },
        };

        const restored = deserializeState(v7Serialized);

        expect(restored.fractalConfig).toEqual({ borderless: true });
        expect(restored.composableConfig).toBeUndefined();
    });

    it('migrates v7 composable generatorConfig to composableConfig', () => {
        const v7Serialized: SerializedGameState = {
            version: 7,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'v7-composable.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            cutStyle: 'composable',
            rotationMode: 'none',
            completed: false,
            generatorConfig: {
                horizontalAmplitude: 0.2,
                horizontalFrequency: 1.5,
                verticalAmplitude: 0.1,
                verticalFrequency: 2,
                disableTabs: true,
            },
        };

        const restored = deserializeState(v7Serialized);

        // v7 → v10: legacy fields project onto sine baseCutConfig + tabGenerator='none'.
        expect(restored.composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 1.5, va: 0.1, vf: 2 },
            tabGenerator: 'none',
            tabConfig: {},
        });
        expect(restored.fractalConfig).toBeUndefined();
    });

    it('migrates v9 composableConfig (legacy long-name fields) to v10 opaque shape', () => {
        const v9Serialized: SerializedGameState = {
            version: 9,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 0 },
            ],
            imageUrl: 'v9-composable.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            cutStyle: 'composable',
            rotationMode: 'none',
            completed: false,
            // Cast: v9 composableConfig used the legacy long-name shape, but
            // SerializedGameState already advertises the new (v10) opaque
            // shape via GameState['composableConfig']. The migration path
            // accepts the legacy keys at runtime regardless of the static
            // type.
            composableConfig: {
                horizontalAmplitude: 0.13,
                horizontalFrequency: 7.1,
                verticalAmplitude: 0.08,
                verticalFrequency: 6.9,
                disableTabs: false,
            } as unknown as GameState['composableConfig'],
        };

        const restored = deserializeState(v9Serialized);

        expect(restored.composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9 },
            tabGenerator: 'classic',
            tabConfig: {},
        });
    });

    it('migrates v9 composableConfig with disableTabs: true to tabGenerator: none', () => {
        const v9Serialized: SerializedGameState = {
            version: 9,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 0 },
            ],
            imageUrl: 'v9-composable-no-tabs.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            cutStyle: 'composable',
            rotationMode: 'none',
            completed: false,
            composableConfig: {
                horizontalAmplitude: 0.2,
                horizontalFrequency: 1.5,
                verticalAmplitude: 0.2,
                verticalFrequency: 1.5,
                disableTabs: true,
            } as unknown as GameState['composableConfig'],
        };

        const restored = deserializeState(v9Serialized);

        expect(restored.composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 1.5, va: 0.2, vf: 1.5 },
            tabGenerator: 'none',
            tabConfig: {},
        });
    });

    it('ignores v7 generatorConfig for classic puzzles (no typed shape)', () => {
        const v7Serialized: SerializedGameState = {
            version: 7,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } },
            ],
            imageUrl: 'v7-classic.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            cutStyle: 'classic',
            completed: false,
            generatorConfig: { borderless: true },
        };

        const restored = deserializeState(v7Serialized);

        expect(restored.composableConfig).toBeUndefined();
        expect(restored.fractalConfig).toBeUndefined();
    });

    it('defaults rotation to 0 when missing (v5 → v6 migration)', () => {
        // Simulate a v5 saved state (has cutStyle but no rotation on groups)
        const v5Serialized: SerializedGameState = {
            version: 5,
            pieces: [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 })],
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

    it('coerces missing rotation to 0 (v5 and earlier saves)', () => {
        const noRotation: SerializedGameState = {
            version: 5,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [
                {
                    id: 0,
                    pieces: [[0, { x: 0, y: 0 }]],
                    position: { x: 0, y: 0 },
                    // rotation intentionally omitted
                },
            ],
            imageUrl: 'test.jpg',
            imageSize: { width: 800, height: 600 },
            gridSize: { cols: 8, rows: 6 },
            completed: false,
        };

        const restored = deserializeState(noRotation);
        // 0 quarter-turns × 90 = 0 degrees
        expect(restored.groups[0].rotation).toBe(0);
    });

    it('passes through arbitrary float rotation values in v9 saves', () => {
        const v9: SerializedGameState = {
            version: 9,
            pieces: [makeRectPiece({ id: 0 })],
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

        const restored = deserializeState(v9);
        expect(restored.groups[0].rotation).toBe(7);
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
            pieces: [makeRectPiece({ id: 0 })],
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
            pieces: [makeRectPiece({ id: 0 })],
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
            pieces: [makeRectPiece({ id: 0 })],
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
            pieces: [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1 })],
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
            pieces: [makeRectPiece({ id: 0 })],
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
            pieces: [makeRectPiece({ id: 0 })],
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

    describe('rotation degrees migration (v8 → v9)', () => {
        it('migrates v8 saves with quarter-turn rotation values to degrees', () => {
            const v8Save: SerializedGameState = {
                version: 8,
                pieces: [
                    makeRectPiece({ id: 0 }),
                    makeRectPiece({ id: 1 }),
                    makeRectPiece({ id: 2 }),
                    makeRectPiece({ id: 3 }),
                ],
                groups: [
                    { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 0 },
                    { id: 1, pieces: [[1, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 1 },
                    { id: 2, pieces: [[2, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 2 },
                    { id: 3, pieces: [[3, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 3 },
                ],
                imageUrl: 'test.jpg',
                imageSize: { width: 800, height: 600 },
                gridSize: { cols: 2, rows: 2 },
                completed: false,
            };

            const state = deserializeState(v8Save);

            expect(state.groups.find((g) => g.id === 0)!.rotation).toBe(0);
            expect(state.groups.find((g) => g.id === 1)!.rotation).toBe(90);
            expect(state.groups.find((g) => g.id === 2)!.rotation).toBe(180);
            expect(state.groups.find((g) => g.id === 3)!.rotation).toBe(270);
        });

        it('passes through v9 saves with rotation already in degrees', () => {
            const v9Save: SerializedGameState = {
                version: 9,
                pieces: [makeRectPiece({ id: 0 })],
                groups: [
                    { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 47.3 },
                ],
                imageUrl: 'test.jpg',
                imageSize: { width: 800, height: 600 },
                gridSize: { cols: 1, rows: 1 },
                completed: false,
            };

            const state = deserializeState(v9Save);
            expect(state.groups[0].rotation).toBeCloseTo(47.3);
        });
    });

    it('throws on group with no pieces', () => {
        const serialized: SerializedGameState = {
            version: STATE_VERSION,
            pieces: [makeRectPiece({ id: 0 })],
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

describe('readSelection', () => {
    function makeSerialized(
        selection?: SerializedGameState['selection'],
    ): SerializedGameState {
        return {
            version: STATE_VERSION,
            pieces: [makeRectPiece({ id: 0 })],
            groups: [{ id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 } }],
            imageUrl: 'test.jpg',
            completed: false,
            selection,
        };
    }

    it('returns the stored selection ids', () => {
        expect(readSelection(makeSerialized([3, 1, 4]))).toEqual([3, 1, 4]);
    });

    it('returns an empty array when no selection field is present', () => {
        expect(readSelection(makeSerialized())).toEqual([]);
    });

    it('returns an empty array when selection is not an array', () => {
        const data = { ...makeSerialized(), selection: 'nope' } as unknown as SerializedGameState;
        expect(readSelection(data)).toEqual([]);
    });

    it('drops entries that do not survive JSON as finite numbers', () => {
        // The real load path always comes through JSON.parse, where
        // JSON.stringify has already turned NaN/Infinity into `null`. Exercise
        // that round-tripped shape rather than the impossible literal one.
        const onDisk = JSON.stringify({
            ...makeSerialized(),
            selection: [1, NaN, 2, Infinity, 3],
        });
        const parsed = JSON.parse(onDisk) as SerializedGameState;
        // Sanity-check the precondition: NaN/Infinity serialized to null.
        expect(parsed.selection).toEqual([1, null, 2, null, 3]);
        expect(readSelection(parsed)).toEqual([1, 2, 3]);
    });

    it('drops non-number entries from hand-edited storage', () => {
        const data = {
            ...makeSerialized(),
            selection: [1, 'x', null, 2],
        } as unknown as SerializedGameState;
        expect(readSelection(data)).toEqual([1, 2]);
    });
});

describe('static/progress split (v11)', () => {
    it('serializeStatic omits groups/selection/completed and tags v11', () => {
        const state = makeGameState();
        const s = serializeStatic(state);
        expect(s.version).toBe(11);
        expect('groups' in s).toBe(false);
        expect('completed' in s).toBe(false);
        expect(s.pieces).toEqual(state.pieces);
        expect(s.imageUrl).toBe(state.imageUrl);
    });

    it('serializeProgress carries groups, completed, selection and seed', () => {
        const state = makeGameState({ completed: true, seed: 42 });
        const p = serializeProgress(state, [1, 0]);
        expect(p.version).toBe(11);
        expect(p.completed).toBe(true);
        expect(p.seed).toBe(42);
        expect(p.selection).toEqual([1, 0]);
        expect(p.groups.length).toBe(state.groups.length);
    });

    it('serializeProgress omits an empty selection', () => {
        const p = serializeProgress(makeGameState(), []);
        expect('selection' in p).toBe(false);
    });

    it('recombine rebuilds an equal GameState from static + progress', () => {
        const state = makeGameState({ seed: 7, cutStyle: 'composable', completed: true });
        const restored = recombine(serializeStatic(state), serializeProgress(state, []));
        expect(restored.pieces).toEqual(state.pieces);
        expect(restored.groups.length).toBe(state.groups.length);
        expect(restored.groups[0].pieces).toBeInstanceOf(Map);
        expect(restored.completed).toBe(true);
        expect(restored.seed).toBe(7);
        expect(restored.cutStyle).toBe('composable');
        expect(restored.piecesById.size).toBe(state.pieces.length);
    });

    it('recombine throws on empty pieces', () => {
        const state = makeGameState();
        const bad = { ...serializeStatic(state), pieces: [] };
        expect(() => recombine(bad as never, serializeProgress(state, []))).toThrow();
    });

    it('round-trips the selection through serializeProgress + readSelection', () => {
        expect(readSelection(serializeProgress(makeGameState(), [2, 0]))).toEqual([2, 0]);
    });

    it('preserves a non-default rotationMode through the split', () => {
        const state = makeGameState({ rotationMode: 'free' });
        const restored = recombine(serializeStatic(state), serializeProgress(state, []));
        expect(restored.rotationMode).toBe('free');
    });

    it('derives imageSize from pieces when the static blob omits it', () => {
        const state = makeGameState();
        const s = serializeStatic(state);
        delete (s as { imageSize?: unknown }).imageSize;
        const restored = recombine(s, serializeProgress(state, []));
        expect(restored.imageSize.width).toBeGreaterThan(0);
        expect(restored.imageSize.height).toBeGreaterThan(0);
    });
});

describe('viewport persistence', () => {
    const VP = { scale: 1.5, offset: { x: 30, y: -40 } };

    it('serializeProgress includes the viewport when passed', () => {
        const p = serializeProgress(makeGameState(), [], VP);
        expect(p.viewport).toEqual(VP);
    });

    it('serializeProgress omits the viewport when not passed', () => {
        const p = serializeProgress(makeGameState(), []);
        expect('viewport' in p).toBe(false);
    });

    it('round-trips the viewport through serializeProgress + JSON + readViewport', () => {
        const onDisk = JSON.stringify(serializeProgress(makeGameState(), [], VP));
        const parsed = JSON.parse(onDisk) as ReturnType<typeof serializeProgress>;
        expect(readViewport(parsed)).toEqual(VP);
    });

    it('readViewport returns undefined when the field is absent', () => {
        expect(readViewport(serializeProgress(makeGameState(), []))).toBeUndefined();
    });

    it('readViewport returns undefined for a non-finite scale (NaN survived as null)', () => {
        const onDisk = JSON.stringify(
            serializeProgress(makeGameState(), [], { scale: NaN, offset: { x: 0, y: 0 } }),
        );
        const parsed = JSON.parse(onDisk) as ReturnType<typeof serializeProgress>;
        // Sanity: NaN serialized to null in the stored scale field.
        expect(readViewport(parsed)).toBeUndefined();
    });

    it('readViewport returns undefined for a malformed offset', () => {
        const data = {
            ...serializeProgress(makeGameState(), []),
            viewport: { scale: 1, offset: { x: 'nope', y: 0 } },
        } as unknown as ReturnType<typeof serializeProgress>;
        expect(readViewport(data)).toBeUndefined();
    });

    it('readViewport returns undefined for a non-object viewport from hand-edited storage', () => {
        const data = {
            ...serializeProgress(makeGameState(), []),
            viewport: 'garbage',
        } as unknown as ReturnType<typeof serializeProgress>;
        expect(readViewport(data)).toBeUndefined();
    });
});
