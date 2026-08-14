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
     * Base cuts that deliberately declare no `expectedPieceCount`, exempt
     * from the piece-count invariant (#512). Reasons in plugin-types.ts:
     * Venn's count isn't tied to cols×rows; triangular's is derivable only
     * for `jitter: 0, smooth: false`.
     */
    const PIECE_COUNT_EXEMPT = ['triangular', 'venn'];

    it('every registered base cut declares an expected piece count or is listed exempt', () => {
        // `expectedPieceCount` is optional, so absence is ambiguous ("can't
        // say" vs "unimplemented"); a new base cut would silently inherit the
        // exemption. Asserted as equality (not containment) so both a new
        // undeclared cut AND giving Venn/triangular a count go red here.
        const undeclared = listBaseCutGeneratorIds()
            .filter((id) => getBaseCutGenerator(id).expectedPieceCount === undefined)
            .sort();

        expect(undeclared).toEqual(PIECE_COUNT_EXEMPT);
    });
});
