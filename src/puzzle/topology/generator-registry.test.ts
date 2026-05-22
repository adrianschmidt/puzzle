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
});
