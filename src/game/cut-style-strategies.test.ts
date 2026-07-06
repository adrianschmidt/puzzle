import { describe, it, expect } from 'vitest';
import { getCutStyleStrategy, selectTriangleRows } from './cut-style-strategies.js';
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
        expect(state.wavyConfig).toBeUndefined();
    });
});

describe('wavy borderless', () => {
    const imageUrl = 'test.png';
    const imageSize = { width: 800, height: 600 };
    const viewport = { width: 1000, height: 800 };

    it('writes wavyConfig back onto state when borderless is set', () => {
        const state = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
            seed: 123,
        });
        expect(state.wavyConfig).toEqual({ borderless: true });
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });

    it('leaves wavyConfig undefined when none is provided', () => {
        const state = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy',
            seed: 123,
        });
        expect(state.wavyConfig).toBeUndefined();
    });

    it('borderless wavy nets to the requested piece count (oversize + strip)', () => {
        const bordered = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy', seed: 123,
        });
        const borderless = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy', wavyConfig: { borderless: true }, seed: 123,
        });
        // Wavy may auto-group sub-pixel slivers, so compare piece counts:
        // borderless oversizes to 6x5 then strips the ring back to ~4x3.
        expect(bordered.pieces.length).toBe(12);
        expect(borderless.pieces.length).toBe(12);

        // Borderless strips the flat frame, so the set of piece silhouettes
        // differs from bordered for the same seed — proves oversize+strip
        // actually ran rather than borderless being silently ignored.
        const borderedShapes = bordered.pieces.map((p) => p.shape).sort();
        const borderlessShapes = borderless.pieces.map((p) => p.shape).sort();
        expect(borderlessShapes).not.toEqual(borderedShapes);
    });
});

describe('selectTriangleRows', () => {
    const landscape = { width: 1080, height: 720 };

    it('maps the standard size targets on a 3:2 landscape', () => {
        expect(selectTriangleRows(24, landscape)).toBe(3);   // est 27
        expect(selectTriangleRows(48, landscape)).toBe(4);   // est 44
        expect(selectTriangleRows(96, landscape)).toBe(6);   // est 102
        expect(selectTriangleRows(192, landscape)).toBe(8);  // est 168
    });

    it('uses more rows on portrait images for the same target', () => {
        expect(selectTriangleRows(192, { width: 720, height: 1080 }))
            .toBeGreaterThan(selectTriangleRows(192, landscape));
    });

    it('respects the generator row cap on extreme portraits', () => {
        expect(selectTriangleRows(192, { width: 200, height: 1080 }))
            .toBeLessThanOrEqual(16);
    });
});

describe('triangles strategy grid mapping', () => {
    it('scaleGrid keeps user cols and derives triangle rows from the aspect', () => {
        const s = getCutStyleStrategy('triangles');
        expect(s.scaleGrid({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, {}))
            .toEqual({ cols: 6, rows: 3 });
    });

    it('inscribePuzzleSize is the identity', () => {
        const s = getCutStyleStrategy('triangles');
        const size = { width: 1080, height: 720 };
        expect(s.inscribePuzzleSize(size, { cols: 6, rows: 3 }, {})).toEqual(size);
    });
});
