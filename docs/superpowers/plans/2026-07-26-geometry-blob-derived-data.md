# Geometry Blob Derived-Data Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the persisted geometry blob (~3.80 MB → ~1.2–1.3 MB for the largest Wavy puzzle) by persisting per-piece bounds instead of `edge.curvePoints` and omitting `piece.shape` where it is rebuildable from edge paths, behind one `STATE_VERSION` 11 → 12 bump.

**Architecture:** A pure "seal" pass in `createNewGame` (after `quantizePieceGeometry`) computes each piece's bounds and strips `curvePoints`; the model `Piece` type carries `bounds` and model `Edge` loses `curvePoints` (generation keeps them on new `GeneratedPiece`/`GeneratedEdge` types). The serializer omits `shape` per piece when `buildShape(edges)` reproduces it byte-identically; the loader rebuilds it. v ≤ 11 blobs migrate on load (compute bounds from their stored `curvePoints`, then drop them).

**Tech Stack:** TypeScript, Vite, Vitest (`npm test` = `vitest run`; typecheck = `npx tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-07-26-geometry-blob-derived-data-design.md`

## Global Constraints

- **Share links must not break:** no PRNG (`random()`) calls added, removed, or reordered anywhere in generation; no change to any `shape` / `edge.path` *string value* produced by any generator. The existing golden-shape tests are the tripwire — they must pass unmodified.
- **Loads must not regenerate geometry** — migration work is limited to string concatenation and min/max scans.
- **Old saves keep loading:** v1–v11 blobs migrate on load; never delete a migration path (see `feedback_keep_old_save_migrations`). Old blobs are NOT rewritten to disk.
- Rendered pixels byte-identical: the renderer consumes `piece.shape`; a deserialized v12 state's `shape` strings must equal the pre-save ones byte-for-byte.
- Info modal: **no** help-text change. Analytics: **no** new events. Progress blob: untouched.
- American English in all identifiers and comments.
- Test files live next to the source they test.
- Commit style: conventional commits, no scopes (match `git log`); no AI attribution or conversation references in messages.
- After each task: `npx tsc --noEmit` clean and `npm test` green before committing.

## File Structure

- `src/model/build-shape.ts` (new) — `fmt` + chain-aware `buildShape`, moved from the puzzle layer so model/persistence may use them (model must not import from `src/puzzle/`).
- `src/model/seal-geometry.ts` (new) — `sealPieceGeometry`: bounds + `curvePoints` strip.
- `src/model/types.ts` — `PieceBounds`, `GeneratedEdge`, `GeneratedPiece`; `Piece.bounds`; `Edge` loses `curvePoints`.
- `src/model/derive.ts` — `computePieceBounds` (the walk, exported); `getPieceBounds` reads stored bounds.
- `src/persistence/serialization.ts` — v12: `SerializedPiece`/`SerializedEdge`, `serializePiece` (shape dedup), `restorePieces` (migration + rebuild), version bump.
- `src/game/init.ts` — seal call site.
- `src/test-helpers/fixtures.ts` — `makePiece`/`makeRectPiece` gain bounds.

---

### Task 1: Move `buildShape` and `fmt` to the model layer

**Files:**
- Create: `src/model/build-shape.ts`
- Create: `src/model/build-shape.test.ts`
- Modify: `src/puzzle/composable/bezier-path.ts` (remove `fmt` body, re-export)
- Modify: `src/puzzle/composable/compose.ts` (delete local `buildShape` + `CHAIN_EPSILON`, import shared)

**Interfaces:**
- Consumes: `Edge`, `Point` from `src/model/types.ts`.
- Produces: `buildShape(edges: Edge[]): string` and `fmt(n: number): string` exported from `src/model/build-shape.ts`. Tasks 4–5 rely on `buildShape` being the *same function object* generation uses, so save-time verification and load-time rebuild are byte-identical by construction.

- [ ] **Step 1: Write the failing test**

`src/model/build-shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildShape, fmt } from './build-shape.js';
import type { Edge } from './types.js';

function edge(id: number, start: { x: number; y: number }, end: { x: number; y: number }, path: string): Edge {
    return { id, mateEdgeId: -1, matePieceId: -1, path, start, end };
}

describe('fmt', () => {
    it('emits integers without decimals and rounds others to 2 dp', () => {
        expect(fmt(5)).toBe('5');
        expect(fmt(1.005)).toBe('1.00'); // toFixed semantics, matches previous behavior
        expect(fmt(3.14159)).toBe('3.14');
    });
});

describe('buildShape', () => {
    it('returns an empty string for no edges', () => {
        expect(buildShape([])).toBe('');
    });

    it('wraps a chained loop in a single M..Z subpath', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 10, y: 0 }, { x: 10, y: 10 }, 'L 10 10'),
            edge(2, { x: 10, y: 10 }, { x: 0, y: 0 }, 'L 0 0'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 L 10 10 L 0 0 Z');
    });

    it('starts a new M..Z subpath when the chain breaks by more than 0.5 px', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 20, y: 20 }, { x: 30, y: 20 }, 'L 30 20'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 Z M 20 20 L 30 20 Z');
    });

    it('tolerates sub-epsilon gaps between consecutive edges', () => {
        const edges = [
            edge(0, { x: 0, y: 0 }, { x: 10, y: 0 }, 'L 10 0'),
            edge(1, { x: 10.4, y: 0.4 }, { x: 10, y: 10 }, 'L 10 10'),
        ];
        expect(buildShape(edges)).toBe('M 0 0 L 10 0 L 10 10 Z');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/model/build-shape.test.ts`
Expected: FAIL — module `./build-shape.js` not found.

- [ ] **Step 3: Create `src/model/build-shape.ts`**

Move — do not rewrite — the existing code. From `src/puzzle/composable/bezier-path.ts` take `fmt` **with its full doc comment** (the one anchoring `GEOMETRY_PRECISION_DECIMALS`); from `src/puzzle/composable/compose.ts` take `buildShape` and `CHAIN_EPSILON` verbatim (`compose.ts:245-266`):

```ts
/**
 * Shared SVG-path construction for piece shapes.
 *
 * Lives in the model layer (not the puzzle layer) because persistence also
 * needs it: the serializer omits `piece.shape` from the geometry blob when
 * this function reproduces it byte-identically from the edge paths, and the
 * loader rebuilds it. Generation (`composable/compose.ts`) uses the same
 * function, so the three sites can never drift apart.
 */

import type { Edge } from './types.js';

/* ...fmt with its original doc comment... */
export function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Tolerance for matching consecutive edges' end→start in piece-local px. */
const CHAIN_EPSILON = 0.5;

/* ...buildShape with its original doc comment, plus a line noting the
   serializer dependency... */
export function buildShape(edges: Edge[]): string {
    /* body verbatim from compose.ts */
}
```

- [ ] **Step 4: Update the two former homes**

In `bezier-path.ts`, replace the `fmt` implementation with a re-export so the existing importers (`fractal/convert.ts`, `curve-clamp.ts`) and the precision-pinning test in `bezier-path.test.ts` keep working unchanged:

```ts
export { fmt } from '../../model/build-shape.js';
```

In `compose.ts`, delete the local `buildShape` and `CHAIN_EPSILON`, and add `import { buildShape } from '../../model/build-shape.js';`.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — in particular the golden-shape tests (`af15b81`) and `bezier-path.test.ts`, proving the move changed no emitted byte.

- [ ] **Step 6: Commit**

```bash
git add src/model/build-shape.ts src/model/build-shape.test.ts src/puzzle/composable/bezier-path.ts src/puzzle/composable/compose.ts
git commit -m "refactor: move buildShape and fmt to the model layer"
```

---

### Task 2: Bounds type, `computePieceBounds`, and the seal pass

**Files:**
- Modify: `src/model/types.ts` (add `PieceBounds`; add optional `bounds?` to `Piece` — made required in Task 3)
- Modify: `src/model/derive.ts` (extract + export `computePieceBounds`; `getPieceBounds` prefers stored bounds)
- Create: `src/model/seal-geometry.ts`
- Create: `src/model/seal-geometry.test.ts`
- Modify: `src/game/init.ts:106-113` (seal after quantize)
- Modify: `src/game/init-geometry-precision.test.ts` (seam assertions)
- Modify: `src/model/derive.test.ts` (stored-bounds branch)

**Interfaces:**
- Consumes: `quantizePieceGeometry` (existing), `Piece`/`Edge` from model types.
- Produces:
  - `interface PieceBounds { minX: number; minY: number; maxX: number; maxY: number }` in `model/types.ts`.
  - `computePieceBounds(piece: { edges: Edge[] }): PieceBounds` exported from `model/derive.ts` (the min/max walk over endpoints + `curvePoints`).
  - `sealPieceGeometry(pieces: Piece[]): Piece[]` exported from `model/seal-geometry.ts` (Task 3 retypes it `(pieces: GeneratedPiece[]) => Piece[]`).
  - `createNewGame(...).pieces` now carry `bounds` and no `curvePoints` — Task 4's serializer relies on this.

- [ ] **Step 1: Add `PieceBounds` and optional `Piece.bounds`**

In `model/types.ts`, above `Piece`:

```ts
/**
 * Piece-local axis-aligned bounding box, computed once at generation time
 * (see `model/seal-geometry.ts`) from edge endpoints and the generator's
 * dense curve samples, which are not retained after sealing.
 */
export interface PieceBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
```

and on `Piece` (optional for now; Task 3 makes it required):

```ts
    /**
     * Piece-local bounding box. Stored rather than derived because the
     * dense curve samples it was computed from are dropped after
     * generation. Optional only during the incremental migration of the
     * codebase; treat as always present on sealed pieces.
     */
    bounds?: PieceBounds;
```

- [ ] **Step 2: Split `getPieceBounds` in `model/derive.ts`**

Extract the walk (`derive.ts:51-87`) into an exported `computePieceBounds` and make `getPieceBounds` prefer stored bounds:

```ts
/**
 * Compute the piece-local bounding box by scanning edge endpoints and
 * `curvePoints` (when present). Used at generation time (sealing) and
 * when migrating v≤11 saves whose edges still carry curve samples —
 * after sealing, read `piece.bounds` (via `getPieceBounds`) instead.
 */
export function computePieceBounds(piece: { edges: Edge[] }): PieceBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const include = (p: { x: number; y: number }): void => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    };

    for (const edge of piece.edges) {
        include(edge.start);
        include(edge.end);
        if (edge.curvePoints) {
            for (const p of edge.curvePoints) include(p);
        }
    }

    return { minX, minY, maxX, maxY };
}

export function getPieceBounds(piece: Piece): {
    minX: number; minY: number; maxX: number; maxY: number;
    width: number; height: number;
} {
    const b = piece.bounds ?? computePieceBounds(piece);
    return { ...b, width: b.maxX - b.minX, height: b.maxY - b.minY };
}
```

(The `?? computePieceBounds` fallback is scaffolding for this task only; Task 3 removes it when `bounds` becomes required.)

- [ ] **Step 3: Write the failing seal tests**

`src/model/seal-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sealPieceGeometry } from './seal-geometry.js';
import { computePieceBounds } from './derive.js';
import type { Piece } from './types.js';

function curvedPiece(): Piece {
    return {
        id: 7,
        imageOffset: { x: -10, y: -20 },
        shape: 'M 0 0 L 10 0 L 10 10 L 0 10 Z',
        edges: [
            {
                id: 0, mateEdgeId: -1, matePieceId: -1,
                path: 'L 10 0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
                // Sample dips below the endpoint box — must extend the bbox.
                curvePoints: [{ x: 0, y: 0 }, { x: 5, y: -2.5 }, { x: 10, y: 0 }],
            },
            {
                id: 1, mateEdgeId: -1, matePieceId: -1,
                path: 'L 0 10', start: { x: 10, y: 0 }, end: { x: 0, y: 10 },
            },
        ],
    };
}

describe('sealPieceGeometry', () => {
    it('stores bounds equal to the curve-aware walk', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.bounds).toEqual(computePieceBounds(input));
        expect(sealed.bounds).toEqual({ minX: 0, minY: -2.5, maxX: 10, maxY: 10 });
    });

    it('strips curvePoints from every edge', () => {
        const [sealed] = sealPieceGeometry([curvedPiece()]);
        for (const e of sealed.edges) {
            expect('curvePoints' in e).toBe(false);
        }
    });

    it('leaves shape, edge paths, endpoints, and imageOffset untouched', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.shape).toBe(input.shape);
        expect(sealed.imageOffset).toBe(input.imageOffset);
        sealed.edges.forEach((e, i) => {
            expect(e.path).toBe(input.edges[i].path);
            expect(e.start).toBe(input.edges[i].start);
            expect(e.end).toBe(input.edges[i].end);
        });
    });

    it('does not mutate its input', () => {
        const input = curvedPiece();
        sealPieceGeometry([input]);
        expect(input.edges[0].curvePoints).toHaveLength(3);
        expect(input.bounds).toBeUndefined();
    });

    it('reuses edge objects that carry no curvePoints', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.edges[1]).toBe(input.edges[1]);
    });

    it('is idempotent', () => {
        const once = sealPieceGeometry([curvedPiece()]);
        const twice = sealPieceGeometry(once);
        expect(twice).toEqual(once);
    });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/model/seal-geometry.test.ts`
Expected: FAIL — module `./seal-geometry.js` not found.

- [ ] **Step 5: Implement `src/model/seal-geometry.ts`**

```ts
/**
 * Final generation pass: freeze each piece's derived geometry.
 *
 * Computes `bounds` from edge endpoints plus the generator's dense curve
 * samples, then drops the samples — post-composition their only consumer
 * was this very bounding box (`getPieceBounds`), while they dominated the
 * persisted geometry blob (~61% of it before #493). Runs in
 * `createNewGame` after `quantizePieceGeometry`, so bounds inherit the
 * 2-decimal precision, and before `createInitialGroups`, so the groups
 * describe the geometry the state keeps.
 *
 * Pure: returns new piece objects, never mutates input, consumes no
 * randomness, and never touches `shape` / `edge.path` — rendered geometry
 * and the share-link contract are unaffected.
 */

import type { Edge, Piece } from './types.js';
import { computePieceBounds } from './derive.js';

function stripCurvePoints(edge: Edge): Edge {
    if (!edge.curvePoints) return edge;
    const { curvePoints: _dropped, ...rest } = edge;
    return rest;
}

export function sealPieceGeometry(pieces: Piece[]): Piece[] {
    return pieces.map((piece) => ({
        ...piece,
        bounds: computePieceBounds(piece),
        edges: piece.edges.map(stripCurvePoints),
    }));
}
```

- [ ] **Step 6: Run the seal tests**

Run: `npx vitest run src/model/seal-geometry.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire into `createNewGame`**

In `src/game/init.ts`, extend the quantize call site (line ~113):

```ts
    // Round generated coordinates to the precision the app actually uses, so
    // the geometry we play, save, and regenerate from a share link is one set
    // of numbers — and so the persisted blob stays on the plain-write
    // localStorage path at the largest supported puzzle (#487). Sealing then
    // freezes each piece's bounds and drops the dense curve samples those
    // bounds were computed from — post-composition nothing else reads them,
    // and they dominated the persisted blob. Both run before the groups are
    // built so the groups describe the geometry we keep.
    const pieces = sealPieceGeometry(quantizePieceGeometry(rawPieces));
```

with `import { sealPieceGeometry } from '../model/seal-geometry.js';`.

- [ ] **Step 8: Extend the seam test**

In `src/game/init-geometry-precision.test.ts`, inside the existing per-cut-style loop that walks `createNewGame(...).pieces` (reuse the already-generated states — generation is ~2.6 s per style), add:

```ts
        it('seals pieces: bounds present, curve samples dropped', () => {
            for (const piece of state.pieces) {
                expect(piece.bounds).toBeDefined();
                for (const edge of piece.edges) {
                    expect('curvePoints' in edge).toBe(false);
                }
            }
        });
```

(Adapt naming to the file's existing structure. The existing precision walk covers `bounds` automatically — min/max of 2 dp values is 2 dp.)

In `src/model/derive.test.ts`, add one test that `getPieceBounds` returns stored bounds when present:

```ts
    it('prefers stored bounds over walking edges', () => {
        const piece = makePiece({ edges: [] });
        piece.bounds = { minX: 1, minY: 2, maxX: 11, maxY: 22 };
        expect(getPieceBounds(piece)).toEqual({
            minX: 1, minY: 2, maxX: 11, maxY: 22, width: 10, height: 20,
        });
    });
```

- [ ] **Step 9: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — including golden-shape tests (seal touches no strings).

- [ ] **Step 10: Commit**

```bash
git add src/model/types.ts src/model/derive.ts src/model/derive.test.ts src/model/seal-geometry.ts src/model/seal-geometry.test.ts src/game/init.ts src/game/init-geometry-precision.test.ts
git commit -m "feat: seal generated pieces with stored bounds, dropping curve samples"
```

---

### Task 3: Tighten the types — `GeneratedPiece`/`GeneratedEdge`, required `bounds`

Pure compile-time refactor: no runtime behavior change, suite must stay green with no test-expectation edits (only type/fixture edits).

**Files:**
- Modify: `src/model/types.ts` (Edge loses `curvePoints`; `Piece.bounds` required; new `GeneratedEdge`, `GeneratedPiece`)
- Modify: `src/model/derive.ts` (`computePieceBounds` takes generated edges; `getPieceBounds` drops the fallback)
- Modify: `src/model/quantize-geometry.ts`, `src/model/seal-geometry.ts` (retype to `GeneratedPiece`)
- Modify: `src/game/cut-style-strategies.ts` (`StrategyPuzzle.pieces: GeneratedPiece[]`)
- Modify: generator internals as the compiler directs — expected: `src/puzzle/composable/compose.ts`, `src/puzzle/topology/faces-to-pieces.ts`, `src/puzzle/topology/generator.ts`, `src/puzzle/procedural-generator.ts`, `src/puzzle/fractal/convert.ts`, plus their tests
- Modify: `src/test-helpers/fixtures.ts` (`makePiece`/`makeRectPiece` produce bounds)

**Interfaces:**
- Consumes: Task 2's `PieceBounds`, `computePieceBounds`, `sealPieceGeometry`.
- Produces (used by Task 4):
  - `Edge` has NO `curvePoints`; `Piece.bounds: PieceBounds` is required.
  - `interface GeneratedEdge extends Edge { curvePoints?: Point[] }`
  - `interface GeneratedPiece { id: number; edges: GeneratedEdge[]; shape: string; imageOffset: Point }`
  - `computePieceBounds(piece: { edges: GeneratedEdge[] }): PieceBounds` (sealed `Edge[]` remains assignable)
  - `sealPieceGeometry(pieces: GeneratedPiece[]): Piece[]`

- [ ] **Step 1: Retype the model**

In `model/types.ts`:

- Delete `curvePoints` from `Edge`. Move its doc-comment content onto `GeneratedEdge`.
- Make `Piece.bounds: PieceBounds` required; update its doc comment (drop the "optional during migration" caveat).
- Add, next to `Edge`/`Piece`:

```ts
/**
 * An edge as emitted by the generators, before sealing: may still carry
 * the dense samples of its underlying cut curve (piece-local coords;
 * present for non-straight cut edges, absent for straight ones; tab
 * protrusions live only in `path`). `sealPieceGeometry` folds the samples
 * into the piece's `bounds` and drops them — sealed model edges never
 * have them, and the persisted blob stores them only in v≤11 legacy saves.
 */
export interface GeneratedEdge extends Edge {
    curvePoints?: Point[];
}

/**
 * A piece as emitted by `strategy.generatePieces`, before sealing:
 * edges may carry `curvePoints`, and `bounds` does not exist yet.
 * `sealPieceGeometry` (via `createNewGame`) turns this into a `Piece`.
 */
export interface GeneratedPiece {
    id: number;
    edges: GeneratedEdge[];
    shape: string;
    imageOffset: Point;
}
```

- [ ] **Step 2: Retype the passes**

- `derive.ts`: `computePieceBounds(piece: { edges: GeneratedEdge[] })` (import `GeneratedEdge`); `getPieceBounds` body becomes `const b = piece.bounds;` — delete the fallback.
- `seal-geometry.ts`: `sealPieceGeometry(pieces: GeneratedPiece[]): Piece[]`; `stripCurvePoints(edge: GeneratedEdge): Edge`.
- `quantize-geometry.ts`: `quantizePieceGeometry(pieces: GeneratedPiece[]): GeneratedPiece[]`, `quantizeEdge(edge: GeneratedEdge): GeneratedEdge` — keep the `curvePoints` branch (it runs pre-seal, and bounds derive from the quantized samples).
- `cut-style-strategies.ts`: `StrategyPuzzle.pieces: GeneratedPiece[]`.

- [ ] **Step 3: Update the fixtures**

In `src/test-helpers/fixtures.ts`, give both builders bounds (with override):

```ts
import { computePieceBounds } from '../model/derive.js';
import type { PieceBounds } from '../model/types.js';

export interface MakePieceOpts {
    id?: number;
    edges?: Edge[];
    shape?: string;
    imageOffset?: Point;
    bounds?: PieceBounds;
}

export function makePiece(opts: MakePieceOpts = {}): Piece {
    const edges = opts.edges ?? [];
    return {
        id: opts.id ?? 0,
        edges,
        shape: opts.shape ?? '',
        imageOffset: opts.imageOffset ?? { x: 0, y: 0 },
        // Note: infinite for the default empty-edge piece, matching what the
        // old on-demand walk produced for it. Tests that read bounds pass
        // real edges or an explicit override.
        bounds: opts.bounds ?? computePieceBounds({ edges }),
    };
}
```

Apply the same `bounds: opts.bounds ?? computePieceBounds({ edges })` pattern in `makeRectPiece` (its edges are always real, so bounds come out finite).

- [ ] **Step 4: Follow the compiler**

Run: `npx tsc --noEmit`

Fix every error mechanically; expected shapes of fix:
- Generator files (`compose.ts`, `faces-to-pieces.ts`, `topology/generator.ts`, `procedural-generator.ts`, `fractal/convert.ts`): change `Piece`/`Edge` imports to `GeneratedPiece`/`GeneratedEdge` where objects with `curvePoints` (or without `bounds`) are constructed or read. Do NOT change any constructed values.
- Tests constructing pieces inline: route through `makePiece`/`makeRectPiece`, or add `bounds: computePieceBounds({ edges })` to the literal — whichever is the smaller diff in that file.
- `quantize-geometry.test.ts` / `seal-geometry.test.ts`: fixtures with `curvePoints` become `GeneratedPiece` typed.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS with zero changes to test *expectations* — this task may only touch types and fixture plumbing. If an expectation seems to need changing, stop: that is a behavior regression.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "refactor: split generation-time piece types from sealed model types"
```

---

### Task 4: v12 serialization — omit rebuildable shapes, migrate v≤11

**Files:**
- Modify: `src/persistence/serialization.ts`
- Modify: `src/persistence/serialization.test.ts`

**Interfaces:**
- Consumes: `buildShape` (Task 1), `computePieceBounds` (Tasks 2–3), `GeneratedEdge`, `PieceBounds`.
- Produces:
  - `STATE_VERSION = 12`; `SUPPORTED_VERSIONS = [1..12]`.
  - `interface SerializedEdge extends Edge { curvePoints?: Point[] }` (samples appear only in v≤11 blobs)
  - `interface SerializedPiece { id: number; edges: SerializedEdge[]; shape?: string; imageOffset: Point; bounds?: PieceBounds }` (`shape` omitted when rebuildable — v12; `bounds` absent — v≤11)
  - `SerializedGameState.pieces` / `SerializedStaticState.pieces` become `SerializedPiece[]`.
  - `deserializeState` / `recombine` return states whose pieces are full `Piece`s (bounds present, `shape` restored, no `curvePoints`).

- [ ] **Step 1: Write the failing tests**

Add to `src/persistence/serialization.test.ts` (adapt fixture construction to the file's existing helpers; the piece fixtures here must be hand-built, not `makePiece`, because they exercise the serialized shape):

```ts
describe('v12 geometry dedup', () => {
    // A piece whose shape IS the edge concatenation (chain-aware M..Z form).
    function rebuildablePiece(): Piece {
        const edges = [
            { id: 0, mateEdgeId: -1, matePieceId: -1, path: 'L 10 0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            { id: 1, mateEdgeId: -1, matePieceId: -1, path: 'L 10 10', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
            { id: 2, mateEdgeId: -1, matePieceId: -1, path: 'L 0 0', start: { x: 10, y: 10 }, end: { x: 0, y: 0 } },
        ];
        return {
            id: 0, edges, imageOffset: { x: 0, y: 0 },
            shape: buildShape(edges),
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        };
    }

    // Same edges, but a shape string the edges do NOT concatenate to
    // (stands in for e.g. Fractal's independently built shapes).
    function bespokeShapePiece(): Piece {
        return { ...rebuildablePiece(), shape: 'M 0 0 L 10 0 L 10 10 L 0 0 Z  ' };
    }

    it('omits shape from the blob when it is rebuildable', () => {
        const state = makeStateWith([rebuildablePiece()]);
        const blob = serializeStatic(state);
        expect('shape' in blob.pieces[0]).toBe(false);
        expect(blob.pieces[0].bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    });

    it('keeps a shape the edges do not reproduce, verbatim', () => {
        const state = makeStateWith([bespokeShapePiece()]);
        const blob = serializeStatic(state);
        expect(blob.pieces[0].shape).toBe(bespokeShapePiece().shape);
    });

    it('round-trips shape byte-identically through recombine', () => {
        const state = makeStateWith([rebuildablePiece(), bespokeShapePiece()]);
        const blob = JSON.parse(JSON.stringify(serializeStatic(state)));
        const progress = JSON.parse(JSON.stringify(serializeProgress(state)));
        const restored = recombine(blob, progress);
        expect(restored.pieces.map(p => p.shape)).toEqual(state.pieces.map(p => p.shape));
        expect(restored.pieces.map(p => p.bounds)).toEqual(state.pieces.map(p => p.bounds));
    });

    it('rejects a v12 piece with no bounds', () => {
        const state = makeStateWith([rebuildablePiece()]);
        const blob = JSON.parse(JSON.stringify(serializeStatic(state)));
        delete blob.pieces[0].bounds;
        const progress = JSON.parse(JSON.stringify(serializeProgress(state)));
        expect(() => recombine(blob, progress)).toThrow(/bounds/);
    });
});

describe('v≤11 piece migration', () => {
    it('computes bounds from stored curvePoints and drops them', () => {
        // Hand-built v11 static blob: shape always present, curve samples on the edge.
        const v11Blob = {
            version: 11,
            imageUrl: 'img',
            imageSize: { width: 100, height: 100 },
            gridSize: { cols: 2, rows: 1 },
            pieces: [{
                id: 0,
                imageOffset: { x: 0, y: 0 },
                shape: 'M 0 0 L 10 0 L 10 10 L 0 0 Z',
                edges: [{
                    id: 0, mateEdgeId: -1, matePieceId: -1,
                    path: 'L 10 0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
                    curvePoints: [{ x: 0, y: 0 }, { x: 5, y: -2.5 }, { x: 10, y: 0 }],
                }],
            }],
        };
        const progress = { version: 12, groups: [/* one group per the file's fixtures */], completed: false };
        const state = recombine(v11Blob, progress);
        expect(state.pieces[0].bounds).toEqual({ minX: 0, minY: -2.5, maxX: 10, maxY: 0 });
        expect('curvePoints' in state.pieces[0].edges[0]).toBe(false);
        expect(state.pieces[0].shape).toBe(v11Blob.pieces[0].shape);
    });
});
```

Also mirror the migration test through `deserializeState` with a legacy full v≤10-style blob (the file has existing legacy fixtures to copy from), asserting the same three properties. And extend one existing v1 fixture test (the no-`imageSize` path) to assert `getImageDimensions`-derived `imageSize` still works — this pins the migrate-before-derive ordering.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: FAIL — `shape` still present in blobs, `bounds` never restored, version mismatches.

- [ ] **Step 3: Implement in `serialization.ts`**

1. `export const STATE_VERSION = 12;`, append `12` to `SUPPORTED_VERSIONS`, and add to the version doc list:

```
 * - v12: pieces store `bounds` and no longer store `curvePoints` (bounds are
 *        precomputed at generation); `shape` is omitted per piece when it is
 *        byte-identically rebuildable from the edge paths (`buildShape`).
 *        v≤11 pieces are migrated on load: bounds computed from their stored
 *        curvePoints, which are then dropped.
```

2. Serialized piece types + imports:

```ts
import { buildShape } from '../model/build-shape.js';
import { computePieceBounds } from '../model/derive.js';
import type { GeneratedEdge, Piece, PieceBounds /* … */ } from '../model/types.js';

/** An edge as stored in a blob: v≤11 blobs may carry curve samples. */
export interface SerializedEdge extends Edge {
    curvePoints?: Point[];
}

/**
 * A piece as stored in a blob. `shape` is omitted (v12+) when
 * `buildShape(edges)` reproduces it byte-identically; `bounds` is required
 * on v12+ pieces and absent on v≤11 pieces (computed during migration).
 */
export interface SerializedPiece {
    id: number;
    edges: SerializedEdge[];
    shape?: string;
    imageOffset: Point;
    bounds?: PieceBounds;
}
```

Change `pieces: GameState['pieces']` to `pieces: SerializedPiece[]` in `SerializedGameState` and `SerializedStaticState`.

3. Save-side dedup — used by both `serializeStatic` and `serializeState` (`pieces: state.pieces.map(serializePiece)`):

```ts
/**
 * Serialize one piece, omitting `shape` when the loader can rebuild it
 * byte-identically from the edge paths. Verified per piece — never assumed
 * per generator — so styles that build `shape` independently (e.g. Fractal)
 * simply keep storing it. Pieces that keep their shape pass through by
 * reference; no deep copy happens on the save path.
 */
function serializePiece(piece: Piece): SerializedPiece {
    if (buildShape(piece.edges) !== piece.shape) return piece;
    const { shape: _omitted, ...rest } = piece;
    return rest;
}
```

4. Load-side restore + migration:

```ts
/**
 * Restore blob pieces to full model `Piece`s.
 *
 * - v12+: `bounds` must be present (throw otherwise — a piece without
 *   bounds is an invalid blob, not a guessable one); a missing `shape`
 *   is rebuilt from the edge paths.
 * - v≤11: `shape` is always present; `bounds` is computed from the stored
 *   edge endpoints + curve samples (same walk the app used at runtime when
 *   these saves were written), and the samples are dropped.
 */
function restorePieces(pieces: SerializedPiece[], version: number): Piece[] {
    if (version >= 12) {
        return pieces.map((piece, i) => {
            const { bounds } = piece;
            if (
                bounds === undefined ||
                ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
                    .every(Number.isFinite)
            ) {
                throw new Error(`Invalid state: piece ${i} has no usable bounds`);
            }
            return {
                ...piece,
                bounds,
                shape: piece.shape ?? buildShape(piece.edges),
            };
        });
    }
    return pieces.map((piece, i) => {
        if (typeof piece.shape !== 'string') {
            throw new Error(`Invalid state: piece ${i} has no shape`);
        }
        return {
            ...piece,
            shape: piece.shape,
            bounds: computePieceBounds(piece),
            edges: piece.edges.map((edge) => {
                if (!edge.curvePoints) return edge;
                const { curvePoints: _dropped, ...rest } = edge;
                return rest;
            }),
        };
    });
}
```

5. Wire it in — **before** any use of the pieces:
   - `deserializeState`: after `validateSerializedState(data)`, add `const pieces = restorePieces(data.pieces, data.version);` and use `pieces` everywhere the function currently uses `data.pieces` (state construction, `buildPiecesById`, and the `deriveImageSize` fallback — the last one matters: `getImageDimensions` reads `piece.bounds` now).
   - `recombine`: same, after its inline pieces/imageUrl checks: `const pieces = restorePieces(staticData.pieces, staticData.version);`, then use `pieces` for `state.pieces`, `buildPiecesById`, and `deriveImageSize`.
   - `deriveImageSize(pieces: Piece[])` — tighten the parameter type (it receives restored pieces only).

- [ ] **Step 4: Run the serialization tests, then the full suite**

Run: `npx vitest run src/persistence/serialization.test.ts && npx tsc --noEmit && npm test`
Expected: PASS. Existing serialization tests must keep passing — they now exercise v12 write + restore; legacy-fixture tests exercise the migration path.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "perf: drop derived data from the persisted geometry blob (v12)"
```

---

### Task 5: Re-measure the size guard and pin the dedup

**Files:**
- Modify: `src/game/init-geometry-precision.test.ts` (size-guard threshold + dedup assertion)

**Interfaces:**
- Consumes: everything above; the existing Wavy 16×12 size-guard test from #493.

- [ ] **Step 1: Measure**

Temporarily add `console.log(JSON.stringify(serializeStatic(state)).length)` inside the existing size-guard test and run it:

Run: `npx vitest run src/game/init-geometry-precision.test.ts`

Record the printed length for the guard seed, and (as #493 did) run the guard's seed-spread block if present — otherwise repeat with the same three extra seeds the existing comment records. Expected ballpark: ~1.2–1.3 M UTF-16 code units (spec estimate). Remove the log.

- [ ] **Step 2: Update the guard**

Replace the existing `4.5M` threshold with a value ~15–20% above the measured maximum across the sampled seeds (e.g. measured 1.30 M → guard `1.6e6`), and rewrite the accompanying comment in the file's existing style: measured value, seed spread, the ~4.75 M practical quota, and a pointer to this design doc. The guard's job flips from "fits the quota" to "the dedup keeps working" — say so in the comment.

- [ ] **Step 3: Pin that the dedup actually fires**

In the same file, using the already-generated per-style states:

```ts
        it('omits shape from the blob for every rebuildable piece', () => {
            const blob = serializeStatic(state);
            const withShape = blob.pieces.filter((p) => 'shape' in p).length;
            expect(storesShape[cutStyle]).toBe(withShape > 0 ? 'stored' : 'omitted');
        });
```

where `storesShape` is a per-style expectation table filled in from what Step 1's run shows (expected: all composable-pipeline styles — wavy, classic-sine, triangles, composable — fully omitted; fractal and legacy classic per observation). The table makes any future drift — a style silently losing its dedup — a loud failure with a named style.

- [ ] **Step 4: Full suite, commit**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

```bash
git add src/game/init-geometry-precision.test.ts
git commit -m "test: pin v12 geometry blob size and per-style shape dedup"
```

---

### Task 6: Push and open the PR

- [ ] **Step 1: Re-run everything once more**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin geometry-blob-derived-data
gh pr create --title "perf: drop derived data from the persisted geometry blob" --body "$(cat <<'EOF'
## Summary

Follow-up to #493. Shrinks the persisted geometry blob by removing the two
places it stored derived data, behind one STATE_VERSION 11 → 12 bump:

- **Bounds instead of curve samples** — post-composition, `edge.curvePoints`
  had exactly one consumer (`getPieceBounds`, a min/max scan). A new seal
  pass computes each piece's bounds at generation time and drops the samples.
- **Shape dedup** — `piece.shape` is the `M`/`Z`-stitched concatenation of
  its `edge.path` strings, so the blob stored every path byte twice. The
  serializer now omits `shape` per piece when rebuilding it from the edges
  reproduces it byte-identically (verified per piece, never assumed); the
  loader rebuilds it with the same shared function.

Largest Wavy puzzle (16×12, 1080×720): **1.15 MB** (was 3.80 MB after
#493, 5.70 MB before it), against the ~4.75 MB localStorage quota — headroom
for larger puzzles without regenerating anything on load.

- Share links: no PRNG or `shape`/`edge.path` string changes; golden-shape
  tests unchanged.
- v≤11 saves migrate on load (bounds computed from their stored samples);
  blobs are not rewritten.
- Old builds reading a v12 blob take the existing unsupported-version →
  warn-and-offer-download path, as with every previous bump.

Design: `docs/superpowers/specs/2026-07-26-geometry-blob-derived-data-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Replace `<measured>` with Task 5's measured size before running.

---

## Self-Review Notes

- **Spec coverage:** data model → Tasks 2–3; seal pass → Task 2; v12 serialization + shared `buildShape` → Tasks 1, 4; migration + validation → Task 4; old-build behavior → no code (existing `SUPPORTED_VERSIONS` throw), asserted implicitly by Task 4's version tests; testing section items 1–6 → Tasks 2 (seal), 4 (round-trip, migration), 2+4 (seam), 5 (size guard), existing goldens (unchanged). Non-changes (info modal, analytics, progress blob) → no task touches them.
- **Type consistency:** `PieceBounds`/`GeneratedEdge`/`GeneratedPiece` defined in Task 3 and consumed with those exact names in Task 4; `computePieceBounds({ edges })` shape used consistently; `sealPieceGeometry` retyped in Task 3 before Task 4 depends on sealed pieces.
- Task 2 deliberately ships `bounds` as optional with a fallback so the codebase compiles between tasks; Task 3 is the tightening step and must not change behavior.
