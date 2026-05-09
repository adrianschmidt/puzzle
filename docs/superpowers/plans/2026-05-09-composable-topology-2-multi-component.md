# Composable topology refactor 2: multi-component support + Venn

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NOTE:** Concrete code samples in this plan target the API shapes established in Plan 1 (`docs/superpowers/plans/2026-05-09-composable-topology-1-foundation.md`). After Plan 1 lands, do a quick re-read of this plan and adjust signatures/imports/function names against what actually shipped before starting execution.

**Goal:** Extend the topology framework to support graphs with multiple disconnected components and faces with holes, then add a two-circle Venn `BaseCutGenerator` as the smoke test that this generality actually works.

**Architecture:** Today the DCEL implicitly assumes one connected component containing the frame; faces are bounded by a single edge loop. The refactor adds **component detection** (union-find or BFS over half-edges), **hole assignment** (for each non-frame component, find which inner face contains it and attach it as that face's inner boundary), and **inner-boundary tracking** on `Face`, `PieceDefinition`, and the SVG renderer. Once that lands, the Venn generator (two circles + a frame, where the circles don't touch the frame) acts as the canonical test that no grid-assumption is hiding in the framework.

**Tech Stack:** TypeScript, Vitest, Vite. `bezier-js` for curve math. SVG with `fill-rule: evenodd` for rendering shapes with holes.

**Spec:** `docs/superpowers/specs/2026-05-09-composable-topology-graph-design.md`

**Scope of this plan:** Steps 4–5 of the spec's "Order of work."

**Depends on:** Plan 1 must be complete and merged (this plan extends the `TopologyGraph`, plug-in registry, and pipeline introduced there).

**Out of scope (Plan 3):** `minPieceArea` and auto-grouping; deletion of the legacy `mergeTabsIntoCuts` / `resolveExcessIntersections` / `mergeSmallFaces` modules.

---

## File structure

**Create:**
- `src/puzzle/topology/components.ts` — connected-component detection over the DCEL
- `src/puzzle/topology/components.test.ts`
- `src/puzzle/topology/holes.ts` — point-in-face containment + hole assignment
- `src/puzzle/topology/holes.test.ts`
- `src/puzzle/topology/venn-cut-generator.ts` — two-circle `BaseCutGenerator`
- `src/puzzle/topology/venn-cut-generator.test.ts`
- `src/puzzle/topology/venn.test.ts` — Venn integration test (frame + 2 circles → 4 pieces, one with a hole)

**Modify:**
- `src/puzzle/topology/dcel.ts` — `Face` grows `innerBoundaries: HalfEdge[]` (one entry per inner-loop start half-edge); `buildDCEL` runs component detection and hole assignment
- `src/puzzle/topology/faces-to-pieces.ts` — populate `PieceDefinition.innerBoundaries`
- `src/puzzle/composable/types.ts` — `PieceDefinition` grows `innerBoundaries: EdgeDefinition[][]`
- `src/puzzle/composable/compose.ts` — emit SVG paths with sub-paths per inner boundary
- `src/renderer/svg-dom-renderer.ts` — verify hit-testing respects `fill-rule: evenodd` (likely no change, verify with a test)
- `src/puzzle/topology/generator-registry.ts` — register the Venn generator
- `src/puzzle/topology/curve.ts` — add a closed-curve helper if Venn needs one (a `Curve.circle` static, or similar)

---

## Verification commands

- Type check: `npx tsc --noEmit`
- All tests: `npm test`
- Single file: `npx vitest run path/to/file.test.ts`

A task is "green" when both type-check passes and the affected test files pass.

---

## Task 1: Lock in the Venn integration test as a failing test

**Files:**
- Create: `src/puzzle/topology/venn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/venn.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run src/puzzle/topology/venn.test.ts
```

Expected: fails — Venn generator isn't registered, `innerBoundaries` doesn't exist on `Piece`, etc.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/puzzle/topology/venn.test.ts
git commit -m "test(composable): lock in two-circle Venn integration test"
```

---

## Task 2: Add a closed-curve helper to `Curve`

A circle is a closed curve (start === end), which Plan 1's `Curve` type may or may not support cleanly. Add a static helper that produces a circle as a 4-segment cubic Bézier path (the standard 4×kappa approximation).

**Files:**
- Modify: `src/puzzle/topology/curve.ts`
- Modify: `src/puzzle/topology/curve.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/puzzle/topology/curve.test.ts`, add:

```ts
describe('Curve.circle', () => {
    it('produces a closed curve through the four cardinal points', () => {
        const c = Curve.circle({ x: 100, y: 100 }, 50);
        expect(c.segments).toHaveLength(4);
        // start should be on the rightmost cardinal point
        expect(c.start.x).toBeCloseTo(150);
        expect(c.start.y).toBeCloseTo(100);
        // end equals start (closed)
        expect(c.end.x).toBeCloseTo(c.start.x, 6);
        expect(c.end.y).toBeCloseTo(c.start.y, 6);
    });

    it('approximates radius accurately at midpoints of each arc', () => {
        const c = Curve.circle({ x: 0, y: 0 }, 100);
        // Sample heavily and check distance from center
        const samples = c.sample(20);
        for (const p of samples) {
            const r = Math.hypot(p.x, p.y);
            expect(r).toBeCloseTo(100, 0); // 4-segment kappa fit is ~0.0005 off
        }
    });
});
```

- [ ] **Step 2: Implement**

In `src/puzzle/topology/curve.ts`, add the static helper:

```ts
/**
 * Construct a circular curve as four cubic Bézier segments using
 * the standard kappa = 4*(sqrt(2)-1)/3 approximation.
 *
 * Starts at the rightmost point (centre + (radius, 0)) and goes CCW.
 */
static circle(center: Point, radius: number): Curve {
    const k = 0.5522847498307933;  // 4*(sqrt(2)-1)/3
    const r = radius, kr = k * r;
    const cx = center.x, cy = center.y;
    const right  = { x: cx + r,  y: cy };
    const top    = { x: cx,      y: cy - r };
    const left   = { x: cx - r,  y: cy };
    const bottom = { x: cx,      y: cy + r };

    return Curve.fromBezierPath([
        right,
        { x: cx + r,  y: cy + kr }, { x: cx + kr, y: cy + r },  bottom,
        { x: cx - kr, y: cy + r  }, { x: cx - r,  y: cy + kr }, left,
        { x: cx - r,  y: cy - kr }, { x: cx - kr, y: cy - r  }, top,
        { x: cx + kr, y: cy - r  }, { x: cx + r,  y: cy - kr }, right,
    ]);
}
```

(Note: bezier path goes CW in screen space because Y grows downward; the visual orientation is CCW. Actual orientation matters for inner/outer face detection — verify with a test once buildDCEL processes the result.)

- [ ] **Step 3: Verify**

```bash
npx vitest run src/puzzle/topology/curve.test.ts
```

Expected: both new tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/topology/curve.ts src/puzzle/topology/curve.test.ts
git commit -m "feat(topology): Curve.circle factory for closed circular cuts"
```

---

## Task 3: Connected-component detection

For a `TopologyGraph` with multiple disconnected pieces, group half-edges by component using BFS.

**Files:**
- Create: `src/puzzle/topology/components.ts`
- Create: `src/puzzle/topology/components.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/components.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run src/puzzle/topology/components.test.ts
```

Expected: fails (module not found).

- [ ] **Step 3: Implement**

Create `src/puzzle/topology/components.ts`:

```ts
/**
 * Connected-component detection for a TopologyGraph.
 *
 * Two half-edges are in the same component if you can walk from one
 * to the other via .twin / .next / .prev (any combination). A free-
 * floating closed curve is its own component, separate from the frame.
 */

import type { TopologyGraph, HalfEdge } from './dcel.js';

export interface Component {
    /** All half-edges in this component. */
    halfEdges: HalfEdge[];
    /** All faces touched by this component (including the global outer face if it's reachable). */
    faces: Set<number>;
}

export function findComponents(graph: TopologyGraph): Component[] {
    const visited = new Set<number>();
    const components: Component[] = [];

    for (const start of graph.halfEdges) {
        if (visited.has(start.id)) continue;

        const halfEdges: HalfEdge[] = [];
        const faces = new Set<number>();
        const queue: HalfEdge[] = [start];

        while (queue.length > 0) {
            const he = queue.pop()!;
            if (visited.has(he.id)) continue;
            visited.add(he.id);
            halfEdges.push(he);
            if (he.face) faces.add(he.face.id);
            queue.push(he.twin, he.next, he.prev);
        }

        components.push({ halfEdges, faces });
    }
    return components;
}
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/puzzle/topology/components.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/components.ts src/puzzle/topology/components.test.ts
git commit -m "feat(topology): connected-component detection over half-edge graph"
```

---

## Task 4: Point-in-face containment + hole assignment

For each non-frame component, find which face of which other component contains it. Attach the contained component as the containing face's inner boundary.

**Files:**
- Create: `src/puzzle/topology/holes.ts`
- Create: `src/puzzle/topology/holes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/holes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL, getFaceVertices } from './dcel.js';
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
```

- [ ] **Step 2: Update the `Face` type**

In `src/puzzle/topology/dcel.ts`, extend `Face`:

```ts
export interface Face {
    id: number;
    outerEdge: HalfEdge;
    isOuter: boolean;
    /**
     * Inner-boundary loop starting half-edges. Empty for faces
     * without holes. One half-edge per loop; walk via .next to
     * collect the full loop.
     */
    innerBoundaries: HalfEdge[];
}
```

Initialise `innerBoundaries: []` everywhere a `Face` is constructed.

- [ ] **Step 3: Implement `assignHoles`**

Create `src/puzzle/topology/holes.ts`:

```ts
/**
 * Hole assignment.
 *
 * For each non-global-outer component (e.g. a free-floating circle),
 * find which inner face of which other component contains it, and
 * attach the component's outer-loop start as an inner boundary on
 * the containing face.
 *
 * "Contains" is determined by point-in-polygon test of any vertex
 * of the candidate component against each candidate face's outer
 * boundary (sampled densely from the half-edge curves).
 */

import type { TopologyGraph, Face, HalfEdge } from './dcel.js';
import type { Component } from './components.js';
import type { Point } from '../../model/types.js';

export function assignHoles(graph: TopologyGraph, components: Component[]): void {
    // Identify the "primary" component — the one containing the global
    // outer face. Other components are candidates for hole placement.
    const primary = components.find(c => c.faces.has(graph.outerFace.id));
    if (!primary) return;
    const others = components.filter(c => c !== primary);

    for (const inner of others) {
        const probe = inner.halfEdges[0].origin.position;
        const containingFace = findContainingFace(probe, graph, inner);
        if (!containingFace) continue;

        // Pick the half-edge that bounds the inner component's
        // outermost loop (the one whose face is the inner component's
        // own outer face — by analogy with the global outer face).
        const innerOuter = inner.halfEdges.find(he => he.face?.isOuter);
        if (innerOuter) {
            containingFace.innerBoundaries.push(innerOuter.twin);
        }
    }
}

function findContainingFace(
    probe: Point,
    graph: TopologyGraph,
    excludeComponent: Component,
): Face | null {
    const excluded = new Set([...excludeComponent.faces]);
    let best: Face | null = null;
    let bestArea = Infinity;

    for (const face of graph.faces) {
        if (face.isOuter) continue;
        if (excluded.has(face.id)) continue;

        const polygon = sampleFaceBoundary(face);
        if (!pointInPolygon(probe, polygon)) continue;

        const area = polygonArea(polygon);
        if (area < bestArea) {
            bestArea = area;
            best = face;
        }
    }
    return best;
}

function sampleFaceBoundary(face: Face): Point[] {
    const points: Point[] = [];
    let current: HalfEdge = face.outerEdge;
    do {
        points.push(...current.curve.sample(8));
        current = current.next;
    } while (current !== face.outerEdge);
    return points;
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects = ((yi > p.y) !== (yj > p.y))
            && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function polygonArea(polygon: Point[]): number {
    let a = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        a += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
    }
    return Math.abs(a / 2);
}
```

- [ ] **Step 4: Wire it into `buildDCEL`**

In `src/puzzle/topology/dcel.ts`, after the existing pipeline produces `vertices`, `halfEdges`, `faces`, and `outerFace`, run component detection and hole assignment:

```ts
const result: TopologyGraph = { vertices, halfEdges, faces, outerFace };
const components = findComponents(result);
assignHoles(result, components);
return result;
```

Update the imports.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/puzzle/topology/holes.test.ts
npm test
```

Expected: new test passes; existing tests still pass (single-component graphs have no holes; the new pass is a no-op for them).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/dcel.ts \
        src/puzzle/topology/holes.ts \
        src/puzzle/topology/holes.test.ts
git commit -m "feat(topology): hole assignment for multi-component graphs"
```

---

## Task 5: Plumb inner boundaries through `PieceDefinition`

**Files:**
- Modify: `src/puzzle/composable/types.ts`
- Modify: `src/puzzle/topology/faces-to-pieces.ts`
- Modify: `src/puzzle/topology/faces-to-pieces.test.ts`

- [ ] **Step 1: Update `PieceDefinition`**

In `src/puzzle/composable/types.ts`:

```ts
export interface PieceDefinition {
    id: number;
    edges: EdgeDefinition[];
    /**
     * Inner-boundary edge loops, one per hole. Each loop is a
     * sequence of EdgeDefinitions in the same orientation as
     * `edges` (clockwise around the hole, which is CCW from the
     * face's perspective). Empty/undefined for faces without holes.
     */
    innerBoundaries?: EdgeDefinition[][];
    imageOffset: Point;
}
```

- [ ] **Step 2: Populate `innerBoundaries` in `facesToPieceDefinitions`**

In `src/puzzle/topology/faces-to-pieces.ts`, extend the conversion:

```ts
return innerFaces.map(face => {
    const pieceId = faceIdToPieceId.get(face.id)!;
    const halfEdges = getFaceEdges(face);
    const bbox = computeFaceBBox(halfEdges);
    const edges = halfEdges.map(he => halfEdgeToEdgeDef(...));

    const innerBoundaries: EdgeDefinition[][] = [];
    for (const innerStart of face.innerBoundaries) {
        const innerEdges = walkLoop(innerStart);
        innerBoundaries.push(innerEdges.map(he => halfEdgeToEdgeDef(...)));
    }

    return {
        id: pieceId,
        edges,
        innerBoundaries: innerBoundaries.length > 0 ? innerBoundaries : undefined,
        imageOffset: { x: -bbox.minX, y: -bbox.minY },
    };
});

function walkLoop(start: HalfEdge): HalfEdge[] {
    const loop: HalfEdge[] = [];
    let current = start;
    do {
        loop.push(current);
        current = current.next;
    } while (current !== start);
    return loop;
}
```

The `bbox` for inner-boundary edges should still come from the OUTER boundary (it's the face's overall bbox). Inner-boundary edges share the same coordinate frame.

- [ ] **Step 3: Add a test**

In `src/puzzle/topology/faces-to-pieces.test.ts`, add a test that builds a frame + free-floating circle, runs the full conversion, and asserts that one piece has `innerBoundaries: [...]` of length 1.

- [ ] **Step 4: Verify**

```bash
npx vitest run src/puzzle/topology/faces-to-pieces.test.ts
npm test
```

Expected: new test passes; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/composable/types.ts \
        src/puzzle/topology/faces-to-pieces.ts \
        src/puzzle/topology/faces-to-pieces.test.ts
git commit -m "feat(topology): plumb innerBoundaries through PieceDefinition"
```

---

## Task 6: Render shapes with holes

**Files:**
- Modify: `src/puzzle/composable/compose.ts`
- Modify: `src/model/types.ts` (if `Piece.shape` needs updating — likely not)
- Modify: `src/puzzle/composable/compose.test.ts`

- [ ] **Step 1: Add a test**

In `src/puzzle/composable/compose.test.ts`, add:

```ts
it('emits a multi-subpath SVG path for pieces with inner boundaries', () => {
    const pieceDefs: PieceDefinition[] = [{
        id: 0,
        edges: [
            // outer rectangle 0,0 → 100,0 → 100,100 → 0,100 → 0,0
            { id: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
            { id: 1, start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
            { id: 2, start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
            { id: 3, start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
        ],
        innerBoundaries: [[
            // inner triangle hole: (40,40)→(60,40)→(50,60)→(40,40)
            { id: 4, start: { x: 40, y: 40 }, end: { x: 60, y: 40 }, mateEdgeId: -1, matePieceId: -1 },
            { id: 5, start: { x: 60, y: 40 }, end: { x: 50, y: 60 }, mateEdgeId: -1, matePieceId: -1 },
            { id: 6, start: { x: 50, y: 60 }, end: { x: 40, y: 40 }, mateEdgeId: -1, matePieceId: -1 },
        ]],
        imageOffset: { x: 0, y: 0 },
    }];

    const pieces = composePuzzle(pieceDefs, classicTabTemplate, makeSeededRandom(1), { disableTabs: true });
    expect(pieces).toHaveLength(1);
    // The shape path should contain two `M ... Z` sub-paths.
    expect(pieces[0].shape).toMatch(/M.*Z.*M.*Z/);
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run src/puzzle/composable/compose.test.ts
```

Expected: fails (current `composePuzzle` only emits one sub-path).

- [ ] **Step 3: Update `composePuzzle`**

Find where `buildShape(edges)` is called. Replace with a builder that emits multiple sub-paths:

```ts
function buildShape(outerEdges: Edge[], innerLoops?: Edge[][]): string {
    let d = subPath(outerEdges);
    if (innerLoops) {
        for (const inner of innerLoops) {
            d += ' ' + subPath(inner);
        }
    }
    return d;
}

function subPath(edges: Edge[]): string {
    // existing path-building logic, ending in ' Z'
    ...
}
```

In the piece-mapping loop:

```ts
return pieceDefs.map(pieceDef => {
    const edges = pieceDef.edges.map(...);
    const innerLoops = pieceDef.innerBoundaries
        ? pieceDef.innerBoundaries.map(loop => loop.map(...))
        : undefined;
    const shape = buildShape(edges, innerLoops);
    return { id: pieceDef.id, edges, shape, imageOffset: pieceDef.imageOffset };
});
```

`Piece.shape` is a string already; nothing to change in `model/types.ts` unless `Piece` needs a separate inner-edges field for hit-testing (it shouldn't — SVG handles it via fill-rule).

- [ ] **Step 4: Verify**

```bash
npx vitest run src/puzzle/composable/compose.test.ts
npm test
```

Expected: new test passes.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/composable/compose.ts src/puzzle/composable/compose.test.ts
git commit -m "feat(compose): emit multi-subpath SVG paths for pieces with holes"
```

---

## Task 7: Verify renderer hit-testing respects holes

The SVG renderer uses native SVG hit testing, which respects `fill-rule: evenodd` automatically. Verify this with a Playwright/jsdom test rather than assuming.

**Files:**
- Modify: `src/renderer/svg-dom-renderer.ts` — set `fill-rule: evenodd` on piece path elements (if not already)
- Modify: `src/renderer/svg-dom-renderer.test.ts` (or wherever hit-testing is tested)

- [ ] **Step 1: Confirm `fill-rule` is set**

In `src/renderer/svg-dom-renderer.ts`, find the path element that uses `piece.shape`. Add (if absent):

```ts
path.setAttribute('fill-rule', 'evenodd');
```

- [ ] **Step 2: Add a unit test**

In a renderer test file, render a piece-with-hole and assert that a click in the hole region doesn't hit the piece. Use jsdom's `elementsFromPoint` (or the renderer's own `pickPiece` helper if exposed).

- [ ] **Step 3: Verify**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/svg-dom-renderer.ts src/renderer/svg-dom-renderer.test.ts
git commit -m "fix(renderer): set fill-rule:evenodd so hit-testing respects holes"
```

---

## Task 8: Two-circle Venn `BaseCutGenerator`

**Files:**
- Create: `src/puzzle/topology/venn-cut-generator.ts`
- Create: `src/puzzle/topology/venn-cut-generator.test.ts`
- Modify: `src/puzzle/topology/generator-registry.ts` — register Venn

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/venn-cut-generator.test.ts`:

```ts
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
```

- [ ] **Step 2: Implement**

Create `src/puzzle/topology/venn-cut-generator.ts`:

```ts
/**
 * Two-circle Venn base-cut generator.
 *
 * The framework's smoke test that non-grid topologies work. Two
 * overlapping circles inside a rectangular frame produce four
 * inner faces: the frame piece (with the circle component as
 * an inner boundary), two crescents, and a lens.
 */

import type { Size, Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';

export interface VennCutConfig {
    leftCenter: Point;
    leftRadius: number;
    rightCenter: Point;
    rightRadius: number;
}

export const vennCutGenerator: BaseCutGenerator = {
    id: 'venn',

    generate(frame: Size, _random: () => number, config: unknown): Curve[] {
        const cfg = config as VennCutConfig;
        return [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
            Curve.circle(cfg.leftCenter, cfg.leftRadius),
            Curve.circle(cfg.rightCenter, cfg.rightRadius),
        ];
    },
};
```

- [ ] **Step 3: Register Venn in `generator-registry.ts`**

In `src/puzzle/topology/generator-registry.ts`:

```ts
import { vennCutGenerator } from './venn-cut-generator.js';
// ...
registerBaseCutGenerator(vennCutGenerator);
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/puzzle/topology/venn-cut-generator.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/venn-cut-generator.ts \
        src/puzzle/topology/venn-cut-generator.test.ts \
        src/puzzle/topology/generator-registry.ts
git commit -m "feat(topology): two-circle Venn BaseCutGenerator"
```

---

## Task 9: Verify the Venn integration test passes

**Files:** none.

- [ ] **Step 1: Run the locked-in test**

```bash
npx vitest run src/puzzle/topology/venn.test.ts
```

Expected: both tests pass — 4 inner pieces, exactly one with one inner boundary.

If they don't pass, the failure points to a hidden grid-assumption in the framework or a bug in component / hole detection. Investigate before proceeding.

- [ ] **Step 2: Run the full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 3: Visual smoke test**

Add a temporary "Venn" option to the new-game dialog (or use a URL parameter) to generate a Venn puzzle and visually inspect:
- 4 distinct, draggable pieces
- The frame piece has a hole shaped like the circle component
- Crescents and lens render correctly with no overlaps or gaps
- Clicking inside the hole area of the frame piece does NOT pick up the frame piece

The temporary UI knob can be removed before merge if desired.

- [ ] **Step 4: Commit any final tweaks**

```bash
git commit --allow-empty -m "test(composable): verify Venn integration end-to-end"
```

---

## Done — Plan 2 acceptance check

- [ ] `npx vitest run src/puzzle/topology/venn.test.ts` — both tests pass.
- [ ] `npm test` — all tests pass.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Visually confirmed: a Venn puzzle renders as 4 pieces with the frame piece showing a hole, and hit-testing respects the hole.
- [ ] All Plan 1 tests still pass (sine-grid, repro seeds, share-link round-trips). The framework remains backwards-compatible.
