import { describe, it, expect } from 'vitest';
import { configKeyForCutStyle, getCutStyleStrategy, selectTriangleRows } from './cut-style-strategies.js';
import { createNewGame } from './init.js';
import { CUT_STYLE_OPTIONS } from './cut-styles.js';

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

        // Borderless strips the flat frame, so silhouettes differ from bordered
        // for the same seed — proves oversize+strip ran, not silently ignored.
        const borderedShapes = bordered.pieces.map((p) => p.shape).sort();
        const borderlessShapes = borderless.pieces.map((p) => p.shape).sort();
        expect(borderlessShapes).not.toEqual(borderedShapes);
    });
});

describe('fractal borderless coercion', () => {
    // Fractal runs its own pipeline (not `generator.ts`'s strict `=== true`) and
    // reads borderless in three places. With truthiness, a crafted non-boolean
    // (`"true"` in `__reproPuzzle`, a pre-tightening save) generated a BORDERLESS
    // puzzle while `applyStyleConfigs` encodes `ff: { bl: false }`, so a re-share
    // described a bordered one. This pins all three: reverting any read makes the
    // `'yes'` result differ from `false` somewhere below.
    const strategy = getCutStyleStrategy('fractal');
    const imageSize = { width: 400, height: 300 };
    const ctxWith = (borderless: unknown) =>
        ({ fractalConfig: { borderless } } as unknown as Parameters<typeof strategy.scaleGrid>[2]);

    const readings = (borderless: unknown) => {
        const ctx = ctxWith(borderless);
        const grid = strategy.scaleGrid({ cols: 6, rows: 4 }, imageSize, ctx);
        return {
            grid,
            size: strategy.inscribePuzzleSize(imageSize, { cols: 10, rows: 8 }, ctx),
            shapes: strategy
                .generatePieces({ cols: 6, rows: 5 }, imageSize, 42, ctx)
                .pieces.map((p) => p.shape),
        };
    };

    it('reads a non-boolean borderless as off, matching what a re-share encodes', () => {
        const off = readings(false);
        // Per-field control, not aggregate: an aggregate `not.toEqual` proves
        // only ONE of the three reads moves, so a site later ignoring the flag
        // stays green — the degradation this test exists to catch.
        const on = readings(true);
        expect(on.grid).not.toEqual(off.grid);
        expect(on.size).not.toEqual(off.size);
        expect(on.shapes).not.toEqual(off.shapes);

        expect(readings('yes')).toEqual(off);
        expect(readings('true')).toEqual(off);
        expect(readings(1)).toEqual(off);
    });

    it('is unchanged for the boolean and absent values the type admits', () => {
        expect(readings(undefined)).toEqual(readings(false));
        // Only `scaleGrid` is compared, so call it directly rather than running
        // a whole `readings(false)` to read `.grid`.
        expect(
            strategy.scaleGrid({ cols: 6, rows: 4 }, imageSize, {}),
        ).toEqual(strategy.scaleGrid({ cols: 6, rows: 4 }, imageSize, ctxWith(false)));
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

describe('configKeyForCutStyle', () => {
    it('returns each style\'s configKey', () => {
        for (const option of CUT_STYLE_OPTIONS) {
            expect(configKeyForCutStyle(option.id)).toBe(getCutStyleStrategy(option.id).configKey);
        }
    });

    it('is undefined for an unknown or absent style', () => {
        expect(configKeyForCutStyle('bogus')).toBeUndefined();
        expect(configKeyForCutStyle('constructor')).toBeUndefined();
        expect(configKeyForCutStyle(undefined)).toBeUndefined();
    });

    it('is undefined for a type-lying non-string id', () => {
        // `hasOwnProperty` coerces its key, so `['classic']` would stringify to
        // 'classic' and resolve a key without the `typeof` guard (as isCutStyle has).
        expect(configKeyForCutStyle(['classic'] as unknown as string)).toBeUndefined();
    });
});
