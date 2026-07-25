import { describe, it, expect } from 'vitest';
import type { GameState } from '../model/types.js';
import { traceSetVersionOf } from './trace-set-version.js';

/**
 * Only the config fields matter here, so the rest of the state is stubbed —
 * the function reads nothing else.
 */
function stateWith(fields: Partial<GameState>): GameState {
    return {
        pieces: [],
        groups: [],
        piecesById: new Map(),
        groupsById: new Map(),
        pieceToGroup: new Map(),
        imageUrl: 'x.jpg',
        imageSize: { width: 100, height: 100 },
        gridSize: { cols: 2, rows: 2 },
        completed: false,
        ...fields,
    };
}

describe('traceSetVersionOf', () => {
    it('reads the version from each style-specific config block', () => {
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'wavy',
            wavyConfig: { traceSetVersion: 3 },
        }))).toBe(3);
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'triangles',
            trianglesConfig: { traceSetVersion: 2 },
        }))).toBe(2);
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 1 },
        }))).toBe(1);
    });

    it('is undefined for a style that carries no trace-set version', () => {
        expect(traceSetVersionOf(stateWith({ cutStyle: 'fractal' }))).toBeUndefined();
        expect(traceSetVersionOf(stateWith({ cutStyle: 'composable' }))).toBeUndefined();
        expect(traceSetVersionOf(stateWith({}))).toBeUndefined();
    });

    it('is undefined for a legacy Classic puzzle, which has no classicConfig', () => {
        // Presence is the generator discriminator for Classic, so absence
        // must not be papered over with a default.
        expect(traceSetVersionOf(stateWith({ cutStyle: 'classic' }))).toBeUndefined();
    });

    it('is undefined for a legacy (classic-tab) Wavy puzzle', () => {
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
        }))).toBeUndefined();
    });

    it('ignores a config block belonging to a different cut style', () => {
        // A crafted share link or hand-edited save could carry one; gating on
        // cutStyle stops it mis-attributing a version.
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'classic',
            wavyConfig: { traceSetVersion: 7 },
            trianglesConfig: { traceSetVersion: 7 },
        }))).toBeUndefined();
        expect(traceSetVersionOf(stateWith({
            cutStyle: 'fractal',
            classicConfig: { traceSetVersion: 7 },
        }))).toBeUndefined();
    });
});
