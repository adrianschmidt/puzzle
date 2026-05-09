import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { findComponents } from './components.js';

describe('findComponents', () => {
    it('returns one component for a connected graph (frame only)', () => {
        const W = 100, H = 100;
        const graph = buildDCEL({ curves: [
            Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
            Curve.line({ x: W, y: 0 }, { x: W, y: H }),
            Curve.line({ x: W, y: H }, { x: 0, y: H }),
            Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
        ]});
        const components = findComponents(graph);
        expect(components).toHaveLength(1);
    });

    it('returns two components for a frame + free-floating circle', () => {
        const W = 600, H = 400;
        const graph = buildDCEL({ curves: [
            Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
            Curve.line({ x: W, y: 0 }, { x: W, y: H }),
            Curve.line({ x: W, y: H }, { x: 0, y: H }),
            Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
            Curve.circle({ x: 300, y: 200 }, 50),
        ]});
        const components = findComponents(graph);
        expect(components).toHaveLength(2);
    });
});
