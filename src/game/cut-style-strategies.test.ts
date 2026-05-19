import { describe, it, expect } from 'vitest';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { createNewGame } from './init.js';

describe('wavy strategy', () => {
    it('is registered for cutStyle "wavy"', () => {
        const strategy = getCutStyleStrategy('wavy');
        expect(strategy).toBeDefined();
        expect(typeof strategy.generatePieces).toBe('function');
    });

    it('uses the image dimensions as-is (no inscription)', () => {
        const strategy = getCutStyleStrategy('wavy');
        const out = strategy.inscribePuzzleSize(
            { width: 1080, height: 720 },
            { cols: 8, rows: 6 },
            {},
        );
        expect(out).toEqual({ width: 1080, height: 720 });
    });

    it('does not scale the user-facing grid', () => {
        const strategy = getCutStyleStrategy('wavy');
        expect(strategy.scaleGrid({ cols: 6, rows: 4 }, { width: 100, height: 100 }, {})).toEqual({
            cols: 6, rows: 4,
        });
    });

    it('generates pieces for the requested grid', () => {
        const strategy = getCutStyleStrategy('wavy');
        const { pieces } = strategy.generatePieces(
            { cols: 6, rows: 4 },
            { width: 1080, height: 720 },
            12345,
            {},
        );
        // 24 base pieces; auto-grouping at minPieceArea = avg/4 is unlikely
        // to consume any of them at this size, but allow ≤24.
        expect(pieces.length).toBeGreaterThanOrEqual(20);
        expect(pieces.length).toBeLessThanOrEqual(24);
    });

    it('produces identical pieces for the same seed', () => {
        const s = getCutStyleStrategy('wavy');
        const a = s.generatePieces({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, 12345, {});
        const b = s.generatePieces({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, 12345, {});
        expect(b.pieces.length).toBe(a.pieces.length);
        for (let i = 0; i < a.pieces.length; i++) {
            expect(b.pieces[i].shape).toBe(a.pieces[i].shape);
        }
    });
});

describe('createNewGame with cutStyle "wavy"', () => {
    it('leaves composableConfig undefined on the GameState', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 8, rows: 6 },
            { cutStyle: 'wavy', seed: 1 },
        );
        expect(state.cutStyle).toBe('wavy');
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });
});
