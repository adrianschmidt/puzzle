import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { assignHoles } from './holes.js';
import { findComponents } from './components.js';

describe('assignHoles', () => {
    it('attaches a free-floating circle as an inner boundary on the frame face', () => {
        const W = 600, H = 400;
        const graph = buildDCEL({ curves: [
            Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
            Curve.line({ x: W, y: 0 }, { x: W, y: H }),
            Curve.line({ x: W, y: H }, { x: 0, y: H }),
            Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
            Curve.circle({ x: 300, y: 200 }, 50),
        ]});

        const components = findComponents(graph);
        assignHoles(graph, components);

        // The frame's inner face (the one that's not the global outer
        // face but contains the circle) should have one inner boundary.
        const innerFaces = graph.faces.filter(f => !f.isOuter);
        const facesWithHoles = innerFaces.filter(f =>
            f.innerBoundaries && f.innerBoundaries.length > 0,
        );
        expect(facesWithHoles).toHaveLength(1);
    });
});
