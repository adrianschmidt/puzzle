/**
 * Integration test for the two-circle Venn case.
 *
 * Two circles strictly inside a frame, intersecting each other,
 * should produce exactly four inner faces:
 *   - the frame piece (rectangular outer boundary, with a hole
 *     where the circle component sits)
 *   - two crescents
 *   - one lens
 *
 * The frame piece must report exactly one inner boundary.
 * The other three pieces must have no inner boundaries.
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';

describe('composable: two-circle Venn', () => {
    it('produces 4 pieces — frame, two crescents, lens', () => {
        const pieces = generateComposablePuzzle(
            1, 1,                                    // grid size irrelevant for Venn
            { width: 600, height: 400 },
            42,
            {
                baseCutGenerator: 'venn',
                baseCutConfig: {
                    leftCenter: { x: 240, y: 200 },
                    leftRadius: 120,
                    rightCenter: { x: 360, y: 200 },
                    rightRadius: 120,
                },
                tabGenerator: 'none',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(4);
    });

    it('the frame piece has exactly one inner boundary', () => {
        const pieces = generateComposablePuzzle(
            1, 1,
            { width: 600, height: 400 },
            42,
            {
                baseCutGenerator: 'venn',
                baseCutConfig: {
                    leftCenter: { x: 240, y: 200 },
                    leftRadius: 120,
                    rightCenter: { x: 360, y: 200 },
                    rightRadius: 120,
                },
                tabGenerator: 'none',
                tabConfig: {},
            },
        );
        const withHoles = pieces.filter(p => p.innerBoundaries && p.innerBoundaries.length > 0);
        expect(withHoles).toHaveLength(1);
        expect(withHoles[0].innerBoundaries!).toHaveLength(1);
    });
});
