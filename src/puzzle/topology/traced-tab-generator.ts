/**
 * Traced tab generator: pulls full-edge tab shapes from the photographed
 * library via tracedTabTemplate and maps them onto the edge.
 *
 * Unlike the classic generator (which splices a small mushroom shape
 * into the middle of the edge while preserving the before/after edge
 * curvature), the traced template spans the entire chord between edge
 * endpoints. The resulting curve replaces the edge wholesale —
 * straight-line-plus-tab rather than wavy-line-plus-tab. This is by
 * design: traced library entries are normalized neck-to-neck where the
 * necks are the edge endpoints.
 */

import { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import type { TabGenerator } from './plugin-types.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';
import {
    computeTabPlacement,
    transformTabToEdge,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        // 2 outer PRNG calls: tCenter (unused for full-edge) + isTab
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        // 1 outer PRNG call: seeds the template sub-PRNG
        let path = tracedTabTemplate.generate(random);
        if (!placement.isTab) {
            path = mirrorBezierPathY(path);
        }

        // Transform the full-edge path onto the actual edge coordinates.
        // pLeft = edge start, pRight = edge end anchors the template to the edge.
        const edgeLength = edge.arcLength();
        const transformed = transformTabToEdge(path, edge.start, edge.end, edgeLength);

        // Snap endpoints to exact edge boundary points to prevent gaps.
        const snapped = [...transformed];
        snapped[0] = { ...edge.start };
        snapped[snapped.length - 1] = { ...edge.end };

        return Curve.fromBezierPath(snapped);
    },
};
