import { describe, it, expect } from 'vitest';
import { vennCutGenerator } from './venn-cut-generator.js';

describe('vennCutGenerator', () => {
    it('has id "venn"', () => {
        expect(vennCutGenerator.id).toBe('venn');
    });

    it('produces 4 borders + 2 circles = 6 curves', () => {
        const random = () => 0;
        const curves = vennCutGenerator.generate(
            { width: 600, height: 400 },
            random,
            {
                leftCenter: { x: 240, y: 200 },
                leftRadius: 120,
                rightCenter: { x: 360, y: 200 },
                rightRadius: 120,
            },
        );
        expect(curves).toHaveLength(6);
    });
});
