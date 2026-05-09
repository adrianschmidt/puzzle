import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { noneTabGenerator } from './none-tab-generator.js';

describe('noneTabGenerator', () => {
    it('has id "none"', () => {
        expect(noneTabGenerator.id).toBe('none');
    });

    it('returns null for any edge (leave flat)', () => {
        const random = () => 0;
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        expect(noneTabGenerator.generate(edge, random, {})).toBeNull();
    });
});
