import { describe, it, expect } from 'vitest';
import {
    getBaseCutGenerator,
    getTabGenerator,
    listBaseCutGeneratorIds,
    listTabGeneratorIds,
} from './generator-registry.js';

describe('generator-registry', () => {
    it('has the sine base-cut generator pre-registered', () => {
        expect(getBaseCutGenerator('sine').id).toBe('sine');
    });

    it('has the classic tab generator pre-registered', () => {
        expect(getTabGenerator('classic').id).toBe('classic');
    });

    it('throws on unknown base-cut id', () => {
        expect(() => getBaseCutGenerator('not-a-real-id')).toThrow(/unknown/i);
    });

    it('throws on unknown tab id', () => {
        expect(() => getTabGenerator('not-a-real-id')).toThrow(/unknown/i);
    });

    it('listBaseCutGeneratorIds returns at least "sine"', () => {
        expect(listBaseCutGeneratorIds()).toContain('sine');
    });

    it('listTabGeneratorIds returns at least "classic"', () => {
        expect(listTabGeneratorIds()).toContain('classic');
    });

    it('resolves the traced tab generator', () => {
        expect(getTabGenerator('traced').id).toBe('traced');
    });

    it('lists traced among the registered tab generators', () => {
        expect(listTabGeneratorIds()).toContain('traced');
    });

    /**
     * The base cuts that deliberately declare no `expectedPieceCount`, and
     * are therefore exempt from the piece-count invariant (#512).
     * `plugin-types.ts` gives the reason for each: Venn's count is unrelated
     * to cols x rows, and the triangular lattice's is derivable only for
     * `jitter: 0, smooth: false`.
     */
    const PIECE_COUNT_EXEMPT = ['triangular', 'venn'];

    it('every registered base cut declares an expected piece count or is listed exempt', () => {
        // `expectedPieceCount` is optional, so absence means two different
        // things — "this generator cannot say" and "nobody implemented it" —
        // and a fourth base cut would inherit the second silently: exempt from
        // the invariant with nothing red, and quietly added to the exempt list
        // that `PieceCountMismatchData.baseCut` presents to operators as
        // complete. Registering one therefore has to come with a decision
        // recorded here.
        //
        // Asserted as equality, not containment, so it also fires the other
        // way: giving Venn or the triangular lattice a count without revisiting
        // that doc goes red too.
        const undeclared = listBaseCutGeneratorIds()
            .filter((id) => getBaseCutGenerator(id).expectedPieceCount === undefined)
            .sort();

        expect(undeclared).toEqual(PIECE_COUNT_EXEMPT);
    });
});
