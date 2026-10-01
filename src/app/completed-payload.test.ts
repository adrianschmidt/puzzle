import { describe, it, expect } from 'vitest';
import { makeGameState } from '../test-helpers/fixtures.js';
import type { NewGameData } from '../analytics/index.js';
import { buildPuzzleCompletedData } from './completed-payload.js';

describe('buildPuzzleCompletedData', () => {
    it('derives geometry and style from state when nothing was cached', () => {
        const state = makeGameState({
            cutStyle: 'triangles',
            rotationMode: 'free',
            gridSize: { cols: 5, rows: 3 },
        });

        const data = buildPuzzleCompletedData(state, null, false);

        expect(data.cutStyle).toBe('triangles');
        expect(data.rotationMode).toBe('free');
        expect(data.cols).toBe(5);
        expect(data.rows).toBe(3);
        expect(data.pieceCount).toBe(state.pieces.length);
    });

    it('defaults an absent cut style and rotation mode', () => {
        const data = buildPuzzleCompletedData(
            makeGameState({ cutStyle: undefined, rotationMode: undefined }),
            null,
            false,
        );
        expect(data.cutStyle).toBe('classic');
        expect(data.rotationMode).toBe('none');
    });

    it('lets cached fields win over the derived ones', () => {
        // The cached payload knows what state cannot recover — image source,
        // category, vibrancy.
        const cached = {
            source: 'fresh', cutStyle: 'wavy', rotationMode: 'none',
            orientation: 'landscape', cols: 9, rows: 9, pieceCount: 81,
            imageSource: 'unsplash', imageCategory: 'nature', vibrant: true,
        } as NewGameData;

        const data = buildPuzzleCompletedData(makeGameState({ cutStyle: 'classic' }), cached, false);

        expect(data.cutStyle).toBe('wavy');
        expect(data.imageCategory).toBe('nature');
        expect(data.vibrant).toBe(true);
    });

    it('includes traceSetVersion when the state carries one', () => {
        const state = makeGameState({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 3 },
        });
        expect(buildPuzzleCompletedData(state, null, false).traceSetVersion).toBe(3);
    });

    it('omits traceSetVersion rather than setting it undefined when the state carries none', () => {
        // Presence is the Classic generator discriminator: umami.ts's
        // pre-upgrade-tail query subtracts on presence, so an unconditional
        // `undefined` would silently break it.
        const state = makeGameState({ cutStyle: 'classic' });
        expect('traceSetVersion' in buildPuzzleCompletedData(state, null, false)).toBe(false);
    });

    it.each([true, false])('reports resumed=%s as given', (resumed) => {
        expect(buildPuzzleCompletedData(makeGameState(), null, resumed).resumed).toBe(resumed);
    });

    it('keeps resumed when a cached payload is merged in', () => {
        const cached = {
            source: 'shared', cutStyle: 'classic', rotationMode: 'none',
            orientation: 'landscape', cols: 2, rows: 2, pieceCount: 4,
            generationMode: 'worker', generationMs: 10,
        } as NewGameData;

        const data = buildPuzzleCompletedData(makeGameState(), cached, true);

        expect(data.resumed).toBe(true);
        expect(data.source).toBe('shared');
    });
});
