# Composable Borderless Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `borderless` option to the composable cut style that produces pieces with a tab/blank on every side (no recognizable frame), implemented as a base-cut-generator capability so the grid concept stays in the sine generator.

**Architecture:** A `supportsBorderless` capability on `BaseCutGenerator`; the sine generator oversizes its grid by +1 piece per side when `borderless`; a generic topological post-pass strips the outer ring of pieces and re-marks the exposed edges as borders (keeping their baked tab geometry). The flag threads through `ComposableConfig` → topology config → sine config + strip gate, plus the usual preference / dialog / share-link / serialization plumbing, mirroring fractal's existing `borderless`.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom + node). Spec: `docs/superpowers/specs/2026-06-13-composable-borderless-design.md`.

---

## File Structure

- Modify `src/puzzle/topology/plugin-types.ts` — add `supportsBorderless?` to `BaseCutGenerator`.
- Modify `src/puzzle/topology/sine-cut-generator.ts` — declare capability; oversize grid when `borderless`.
- Create `src/puzzle/topology/strip-border-ring.ts` (+ test) — generic outer-ring strip.
- Modify `src/puzzle/topology/generator.ts` — `borderless` in `TopologyGeneratorConfig`; gate + inject + strip.
- Modify `src/puzzle/composable-generator.ts` — `borderless` in `ComposableConfig`; forward.
- Modify `src/model/types.ts` — `borderless?` on `GameState.composableConfig`.
- Modify `src/game/composable-config.ts` (+ test) — `borderless` on the slider preference + parse.
- Modify `src/sharing/share-link.ts` (+ test) — `cf.bl` encode/decode/validate.
- Modify `src/persistence/serialization.test.ts` — round-trip test (no code change needed; field is deep-copied).
- Modify `src/ui/new-game-dialog.ts` (+ test) — `borderless` on `ComposableSliderConfig` + checkbox gated on capability.
- Modify `src/main.ts` — carry `borderless` through `sliderConfigToGeneratorConfig` + pass the capability flag to the dialog.

Reproducibility note for every task: the oversize and strip run **only** when `borderless === true`. Never change the `cols`/`rows` or PRNG-draw sequence for the `borderless` false/absent path — that is the share-link contract for all existing composable & wavy puzzles.

---

## Task 1: `supportsBorderless` capability

**Files:**
- Modify: `src/puzzle/topology/plugin-types.ts`
- Modify: `src/puzzle/topology/sine-cut-generator.ts`
- Test: `src/puzzle/topology/sine-cut-generator.test.ts` (create if absent)

- [ ] **Step 1: Add the capability field to the interface**

In `src/puzzle/topology/plugin-types.ts`, inside `interface BaseCutGenerator`, after the `id` field (before `generate`):

```ts
    /**
     * Whether this generator supports borderless mode — i.e. it knows how
     * to oversize its grid by one piece on each side so the framework can
     * strip the outer ring (see strip-border-ring.ts). Grid-based
     * generators (sine) set this; generators without a grid concept (Venn)
     * leave it falsy, and a borderless request is then ignored.
     */
    readonly supportsBorderless?: boolean;
```

- [ ] **Step 2: Write the failing test**

Create/append `src/puzzle/topology/sine-cut-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sineCutGenerator } from './sine-cut-generator.js';

describe('sineCutGenerator capability', () => {
    it('advertises borderless support', () => {
        expect(sineCutGenerator.supportsBorderless).toBe(true);
    });
});
```

- [ ] **Step 3: Run it (fails)**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: FAIL — `supportsBorderless` is undefined.

- [ ] **Step 4: Declare the capability on the sine generator**

In `src/puzzle/topology/sine-cut-generator.ts`, add `supportsBorderless: true` to the exported object literal, right after `id: 'sine',`:

```ts
export const sineCutGenerator: BaseCutGenerator = {
    id: 'sine',
    supportsBorderless: true,

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
```

- [ ] **Step 5: Run it (passes)**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/plugin-types.ts src/puzzle/topology/sine-cut-generator.test.ts src/puzzle/topology/sine-cut-generator.ts
git commit -m "feat: add supportsBorderless capability to base cut generators (#139)"
```

---

## Task 2: Sine generator oversize

**Files:**
- Modify: `src/puzzle/topology/sine-cut-generator.ts`
- Test: `src/puzzle/topology/sine-cut-generator.test.ts`

The sine generator's first 4 curves are always the border; internal cuts are `rows-1` horizontal + `cols-1` vertical. With `borderless`, generate the grid for `cols+2 × rows+2` so the to-be-stripped ring exists. All grid math already uses the local `cols`/`rows`, so only those two need adjusting.

- [ ] **Step 1: Write the failing tests**

Append to `src/puzzle/topology/sine-cut-generator.test.ts`:

```ts
import { describe as describe2 } from 'vitest';

describe('sineCutGenerator borderless oversize', () => {
    const frame = { width: 800, height: 600 };
    // Deterministic PRNG that also counts its calls.
    function countingRandom() {
        let calls = 0;
        const fn = () => { calls++; return 0.5; };
        return { fn, calls: () => calls };
    }

    it('bordered: 2x2 grid → 4 border + 1 + 1 = 6 curves', () => {
        const r = countingRandom();
        const curves = sineCutGenerator.generate(frame, r.fn, { cols: 2, rows: 2, ha: 0, hf: 0, va: 0, vf: 0 });
        expect(curves.length).toBe(6);
    });

    it('borderless: 2x2 grid oversizes to 4x4 → 4 border + 3 + 3 = 10 curves', () => {
        const r = countingRandom();
        const curves = sineCutGenerator.generate(frame, r.fn, { cols: 2, rows: 2, ha: 0, hf: 0, va: 0, vf: 0, borderless: true });
        expect(curves.length).toBe(10);
    });

    it('borderless draws the oversized number of per-cut phase offsets', () => {
        // Phase loops draw (rows+1) + (cols+1) values; borderless uses the
        // oversized rows/cols, so the PRNG draw count must match the +2 grid.
        const bordered = countingRandom();
        sineCutGenerator.generate(frame, bordered.fn, { cols: 2, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1 });
        const borderless = countingRandom();
        sineCutGenerator.generate(frame, borderless.fn, { cols: 2, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1, borderless: true });
        expect(bordered.calls()).toBe(6);   // (2+1)+(2+1)
        expect(borderless.calls()).toBe(10); // (4+1)+(4+1)
    });

    it('bordered draw count is unchanged when borderless is absent (PRNG contract)', () => {
        const r = countingRandom();
        sineCutGenerator.generate(frame, r.fn, { cols: 3, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1 });
        expect(r.calls()).toBe(7); // (2+1)+(3+1)
    });
});
```

- [ ] **Step 2: Run them (the borderless ones fail)**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: the two `borderless` curve/draw-count tests FAIL (borderless ignored → 6 curves / 6 draws); the bordered tests pass.

- [ ] **Step 3: Implement the oversize**

In `src/puzzle/topology/sine-cut-generator.ts`, replace the config-reading prologue inside `generate`:

```ts
        const cfg = (config ?? {}) as Partial<SineCutConfig>;
        const cols = cfg.cols ?? 1;
        const rows = cfg.rows ?? 1;
        const ha = cfg.ha ?? 0.15;
        const hf = cfg.hf ?? 1.5;
        const va = cfg.va ?? 0.15;
        const vf = cfg.vf ?? 1.5;
```

with:

```ts
        const cfg = (config ?? {}) as Partial<SineCutConfig> & { borderless?: boolean };
        // Borderless: oversize the grid by one piece on each side (+2 cols,
        // +2 rows) across the SAME frame. The framework then strips the outer
        // ring (strip-border-ring.ts), leaving the requested cols×rows pieces
        // with a tab on every side. Only applies when borderless is true, so
        // the bordered PRNG/cut sequence is unchanged.
        const extra = cfg.borderless === true ? 2 : 0;
        const cols = (cfg.cols ?? 1) + extra;
        const rows = (cfg.rows ?? 1) + extra;
        const ha = cfg.ha ?? 0.15;
        const hf = cfg.hf ?? 1.5;
        const va = cfg.va ?? 0.15;
        const vf = cfg.vf ?? 1.5;
```

- [ ] **Step 4: Run them (pass)**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/sine-cut-generator.ts src/puzzle/topology/sine-cut-generator.test.ts
git commit -m "feat: oversize the sine grid for borderless mode (#139)"
```

---

## Task 3: Strip-border-ring module

**Files:**
- Create: `src/puzzle/topology/strip-border-ring.ts`
- Test: `src/puzzle/topology/strip-border-ring.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/puzzle/topology/strip-border-ring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripBorderRing } from './strip-border-ring.js';
import type { Piece, Edge } from '../../model/types.js';

// Minimal edge/piece factories for topology-level assertions.
function edge(id: number, matePieceId: number, mateEdgeId: number, path = 'L1,0'): Edge {
    return { id, matePieceId, mateEdgeId, path, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
}
function piece(id: number, edges: Edge[]): Piece {
    return { id, edges, shape: `shape-${id}`, imageOffset: { x: 0, y: 0 } };
}

describe('stripBorderRing', () => {
    it('removes pieces that have a border edge and keeps the rest', () => {
        // p0 is on the border (has a mate=-1 edge); p1 is interior, mated to p0.
        const p0 = piece(0, [edge(0, -1, -1), edge(1, 1, 10)]);
        const p1 = piece(1, [edge(10, 0, 1), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11), edge(21, 3, 30)]);
        const p3 = piece(3, [edge(30, 2, 21), edge(31, -1, -1)]); // also border

        const { pieces } = stripBorderRing([p0, p1, p2, p3], []);

        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2]);
    });

    it('re-marks a survivor edge that pointed at a removed piece as a border edge', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);            // border ring
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]); // edge 10 → removed p0
        const p2 = piece(2, [edge(20, 1, 11)]);            // keep p2 so p1 isn't all-border

        const { pieces } = stripBorderRing([p0, p1, p2], []);

        const survivor = pieces.find((p) => p.id === 1)!;
        const exposed = survivor.edges.find((e) => e.id === 10)!;
        expect(exposed.matePieceId).toBe(-1);
        expect(exposed.mateEdgeId).toBe(-1);
        // Geometry (the inward tab) is retained, not straightened.
        expect(exposed.path).toBe('L1,0');
        // The still-internal edge is untouched.
        expect(survivor.edges.find((e) => e.id === 11)!.matePieceId).toBe(2);
    });

    it('leaves the piece shape untouched', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11)]);
        const { pieces } = stripBorderRing([p0, p1, p2], []);
        expect(pieces.find((p) => p.id === 1)!.shape).toBe('shape-1');
    });

    it('reconciles autoGroups: drops removed pieces and 1-piece groups', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11), edge(21, 3, 30)]);
        const p3 = piece(3, [edge(30, 2, 21), edge(31, 2, 22)]); // interior, mated only to survivors
        const groups = [
            { id: 0, pieceIds: [0, 1] }, // p0 removed → 1 piece left → dropped
            { id: 1, pieceIds: [2, 3] }, // both survive → kept
        ];
        const { pieces, autoGroups } = stripBorderRing([p0, p1, p2, p3], groups);
        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2, 3]);
        expect(autoGroups).toEqual([{ id: 1, pieceIds: [2, 3] }]);
    });

    it('is a no-op on a graph with no border edges', () => {
        const p1 = piece(1, [edge(10, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 10)]);
        const { pieces } = stripBorderRing([p1, p2], []);
        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2]);
    });
});
```

- [ ] **Step 2: Run them (fail)**

Run: `npx vitest run src/puzzle/topology/strip-border-ring.test.ts`
Expected: FAIL — cannot resolve `./strip-border-ring.js`.

- [ ] **Step 3: Implement the module**

Create `src/puzzle/topology/strip-border-ring.ts`:

```ts
/**
 * Borderless post-pass — strip the outer ring of pieces.
 *
 * On an oversized grid (the sine generator's borderless mode adds one piece
 * on each side), every piece that has a border edge (`matePieceId === -1`)
 * is exactly the 1-deep outer ring. This removes that ring, then re-marks
 * the now-exposed edges of the surviving pieces as border edges. The
 * survivors' baked `shape` and each edge's `path` are left untouched, so an
 * exposed edge keeps the inward tab it used to share with a removed ring
 * piece — that is the whole point of borderless mode.
 *
 * Pure and deterministic — it consumes no randomness — so it can run after
 * the generator without perturbing the seeded PRNG stream.
 */

import type { Piece } from '../../model/types.js';
import type { AutoGroup } from './auto-group.js';

export interface StripResult {
    pieces: Piece[];
    autoGroups: AutoGroup[];
}

/** A piece is on the border ring iff any of its edges has no mate. */
function hasBorderEdge(piece: Piece): boolean {
    return piece.edges.some((e) => e.matePieceId === -1);
}

/**
 * Remove the outer ring and re-mark exposed survivor edges as borders.
 *
 * @param pieces - the full (oversized) piece set
 * @param autoGroups - starting groups from the auto-group pass; references
 *   to removed pieces are pruned and groups that fall below two members are
 *   dropped (a one-piece group is just a solo piece)
 */
export function stripBorderRing(
    pieces: Piece[],
    autoGroups: AutoGroup[],
): StripResult {
    const removedIds = new Set<number>();
    for (const piece of pieces) {
        if (hasBorderEdge(piece)) removedIds.add(piece.id);
    }

    const survivors: Piece[] = [];
    for (const piece of pieces) {
        if (removedIds.has(piece.id)) continue;
        const edges = piece.edges.map((e) =>
            removedIds.has(e.matePieceId)
                ? { ...e, mateEdgeId: -1, matePieceId: -1 }
                : e,
        );
        survivors.push({ ...piece, edges });
    }

    const reconciled: AutoGroup[] = [];
    for (const group of autoGroups) {
        const pieceIds = group.pieceIds.filter((id) => !removedIds.has(id));
        if (pieceIds.length >= 2) reconciled.push({ ...group, pieceIds });
    }

    return { pieces: survivors, autoGroups: reconciled };
}
```

- [ ] **Step 4: Run them (pass)**

Run: `npx vitest run src/puzzle/topology/strip-border-ring.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/strip-border-ring.ts src/puzzle/topology/strip-border-ring.test.ts
git commit -m "feat: add generic border-ring strip for borderless mode (#139)"
```

---

## Task 4: Topology + composable wiring

**Files:**
- Modify: `src/puzzle/topology/generator.ts`
- Modify: `src/puzzle/composable-generator.ts`
- Test: `src/puzzle/topology/generator.test.ts` (create if absent) and/or `src/puzzle/composable-generator.test.ts`

- [ ] **Step 1: Add `borderless` to the configs**

In `src/puzzle/topology/generator.ts`, add to `interface TopologyGeneratorConfig` (after `minPieceArea`):

```ts
    /**
     * Borderless mode. When true AND the resolved base cut generator
     * advertises `supportsBorderless`, the base cut config is told to
     * oversize its grid and the outer ring of pieces is stripped (see
     * strip-border-ring.ts). Ignored when the generator doesn't support it.
     */
    borderless?: boolean;
```

In `src/puzzle/composable-generator.ts`, add to `interface ComposableConfig` (after `minPieceArea`, before `tabDebug`):

```ts
    /**
     * Borderless mode — see {@link TopologyGeneratorConfig.borderless}.
     * Honoured only by base cut generators that support it (sine).
     */
    borderless?: boolean;
```

and forward it in `generateComposablePuzzle`'s call to `generateTopologyPuzzle` (add after `tabDebug: config?.tabDebug,`):

```ts
        borderless: config?.borderless,
```

- [ ] **Step 2: Write the failing tests**

Create/append `src/puzzle/topology/generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';
import { registerBaseCutGenerator } from './generator-registry.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { Curve } from './curve.js';

const FRAME = { width: 400, height: 400 };
const rng = () => 0.5;

describe('generateTopologyPuzzle borderless', () => {
    it('bordered 3x3 → 9 pieces', () => {
        const { pieces } = generateTopologyPuzzle(3, 3, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
        });
        expect(pieces.length).toBe(9);
    });

    it('borderless 3x3 → still 9 pieces (oversized to 5x5, ring stripped)', () => {
        const { pieces } = generateTopologyPuzzle(3, 3, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        expect(pieces.length).toBe(9);
    });

    it('borderless 9x1 oversizes both axes (5x3 → strip → 9) not just one', () => {
        // Guards against oversizing only one dimension: 9x1 → (11x3)=33 →
        // strip ring → 9x1 = 9. A one-axis bug would give a different count.
        const { pieces } = generateTopologyPuzzle(9, 1, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        expect(pieces.length).toBe(9);
    });

    it('ignores borderless for a base cut generator without the capability', () => {
        // Register a grid-less fake generator that emits a fixed 2x2 grid and
        // does NOT advertise supportsBorderless. Borderless must be a no-op.
        const fake: BaseCutGenerator = {
            id: 'fake-grid-2x2-no-borderless',
            // no supportsBorderless
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
                Curve.line({ x: 200, y: 0 }, { x: 200, y: 400 }),
            ],
        };
        registerBaseCutGenerator(fake);
        const { pieces } = generateTopologyPuzzle(2, 2, FRAME, rng, {
            baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        // 4 pieces, ring NOT stripped (generator doesn't support borderless).
        expect(pieces.length).toBe(4);
    });
});
```

Note: if `generateTopologyPuzzle`'s signature/imports differ from the above (e.g. `Curve.line` factory name), adjust the fake generator to match the real `sine-cut-generator.ts` border-curve construction (`Curve.line(a, b)` — verified in that file). The `tabGeneratorId: 'none'` keeps edges flat so the grid count is exact.

- [ ] **Step 3: Run them (borderless ones fail)**

Run: `npx vitest run src/puzzle/topology/generator.test.ts`
Expected: the borderless 3×3 test FAILS (returns 25 pieces — oversized but not stripped) until the wiring is added; the no-capability test may already pass (no strip path yet).

- [ ] **Step 4: Wire the gate + strip into the topology generator**

In `src/puzzle/topology/generator.ts`:

Add the import near the other topology imports:

```ts
import { stripBorderRing } from './strip-border-ring.js';
```

Replace the base-cut setup (the lines that build `baseCutGenerator` and `baseCutCfg`):

```ts
    const baseCutGenerator = getBaseCutGenerator(baseCutId);
    const baseCutCfg = {
        cols, rows,
        ...(config?.baseCutConfig ?? {}),
    };
    const curves = baseCutGenerator.generate(imageSize, random, baseCutCfg);
```

with:

```ts
    const baseCutGenerator = getBaseCutGenerator(baseCutId);
    // Borderless applies only when the resolved generator advertises support
    // (it must know how to oversize its grid). Otherwise the flag is ignored.
    const applyBorderless =
        config?.borderless === true && baseCutGenerator.supportsBorderless === true;
    const baseCutCfg = {
        cols, rows,
        ...(config?.baseCutConfig ?? {}),
        borderless: applyBorderless,
    };
    const curves = baseCutGenerator.generate(imageSize, random, baseCutCfg);
```

Then replace the final compose + return (step 6 in the file):

```ts
    const pieces = composePuzzle(pieceDefs, null, random, { disableTabs: true });

    const tabDebugReport = config?.tabDebug?.finish(graph);

    return { pieces, autoGroups, tabDebugReport };
```

with:

```ts
    const composed = composePuzzle(pieceDefs, null, random, { disableTabs: true });

    // Borderless: strip the outer ring AFTER composition. composePuzzle draws
    // no randomness in this path (disableTabs: true), so post-strip placement
    // can't perturb the seeded stream.
    const { pieces, autoGroups: finalAutoGroups } = applyBorderless
        ? stripBorderRing(composed, autoGroups)
        : { pieces: composed, autoGroups };

    const tabDebugReport = config?.tabDebug?.finish(graph);

    return { pieces, autoGroups: finalAutoGroups, tabDebugReport };
```

(If `autoGroups` is declared with `let` already, keep it; `finalAutoGroups` avoids reassigning the `let`. If TypeScript complains about `autoGroups` being possibly reassigned, leave the existing `let autoGroups` as-is — this code only reads it.)

- [ ] **Step 5: Run them (pass)**

Run: `npx vitest run src/puzzle/topology/generator.test.ts`
Expected: PASS (all). Also run the composable generator suite: `npx vitest run src/puzzle/composable-generator.test.ts src/puzzle/topology/` — Expected: PASS (no regressions; the oversize/strip only triggers under `borderless`).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/puzzle/topology/generator.ts src/puzzle/composable-generator.ts src/puzzle/topology/generator.test.ts
git commit -m "feat: gate and apply borderless strip in the topology generator (#139)"
```

---

## Task 5: GameState type + slider preference

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/game/composable-config.ts`
- Test: `src/game/composable-config.test.ts`

- [ ] **Step 1: Add the field to GameState**

In `src/model/types.ts`, in the `composableConfig?: { ... }` object on `GameState`, add after `minPieceArea?: number;`:

```ts
        /** Borderless mode (strip the outer ring of pieces). */
        borderless?: boolean;
```

- [ ] **Step 2: Write the failing tests**

Append to `src/game/composable-config.test.ts`:

```ts
describe('composable borderless preference', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips borderless: true', () => {
        saveComposableConfigPreference({
            horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5,
            tabGenerator: 'classic', borderless: true,
        });
        expect(loadComposableConfigPreference()?.borderless).toBe(true);
    });

    it('defaults borderless to false when the saved config omits it', () => {
        saveComposableConfigPreference({
            horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5,
            tabGenerator: 'classic',
        } as never);
        expect(loadComposableConfigPreference()?.borderless).toBe(false);
    });
});
```

(Match the existing imports / `describe`/`beforeEach` style already in the file — it already imports `saveComposableConfigPreference`/`loadComposableConfigPreference`.)

- [ ] **Step 3: Run them (fail)**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: FAIL — `borderless` is `undefined` (not on the interface / not parsed).

- [ ] **Step 4: Add the field + parse**

In `src/game/composable-config.ts`:

Add to `interface ComposableSliderPreference` (after `tabGenerator`):

```ts
    borderless: boolean;
```

In `parseComposableConfig`, add to the returned object (after `tabGenerator,`):

```ts
        borderless: config.borderless === true,
```

- [ ] **Step 5: Run them (pass)**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/types.ts src/game/composable-config.ts src/game/composable-config.test.ts
git commit -m "feat: persist composable borderless preference (#139)"
```

---

## Task 6: Share-link encode/decode

**Files:**
- Modify: `src/sharing/share-link.ts`
- Test: `src/sharing/share-link.test.ts`

Mirror fractal's `ff: { bl }`. Read the existing composable encode (`gameStateToPayload`), decode (`shareCfToComposableConfig`), and validate (`isValidComposableCf`) blocks and add `bl` parallel to `mpa`.

- [ ] **Step 1: Write the failing test**

Append to `src/sharing/share-link.test.ts`, next to the existing "round-trips composable config" test:

```ts
it('round-trips composable config with borderless: true', () => {
    const payload: SharePayload = {
        v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'none',
        cf: { bg: 'sine', bgc: { ha: 0.2, hf: 1, va: 0.3, vf: 2 }, tg: 'classic', tgc: {}, bl: true },
    };
    expect(decodePayload(encodePayload(payload))).toEqual(payload);
});
```

Also add a state→payload→config round-trip if the file has a `gameStateToPayload`/`shareCfToComposableConfig` test nearby — mirror the fractal one, asserting `shareCfToComposableConfig({ ...cf, bl: true }).borderless === true`.

- [ ] **Step 2: Run it (fails)**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — `bl` dropped on the round-trip (not in the payload type / encode / decode).

- [ ] **Step 3: Add `bl` to the payload type, encode, decode, validate**

In `src/sharing/share-link.ts`:

- `SharePayload['cf']`: add `bl?: boolean;` after `mpa?: number;`.
- `gameStateToPayload` composable branch: after the `if (c.minPieceArea !== undefined) cf.mpa = ...` line, add:
  ```ts
  if (c.borderless !== undefined) cf.bl = c.borderless;
  ```
- `shareCfToComposableConfig`: after the `if (cf.mpa !== undefined) config.minPieceArea = cf.mpa;` line, add:
  ```ts
  if (cf.bl !== undefined) config.borderless = cf.bl;
  ```
- `isValidComposableCf` (if it enumerates optional fields): add
  ```ts
  if (c.bl !== undefined && typeof c.bl !== 'boolean') return false;
  ```

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat: encode composable borderless on share links (#139)"
```

---

## Task 7: Serialization round-trip

**Files:**
- Test: `src/persistence/serialization.test.ts`

The serializer deep-copies `composableConfig`, so `borderless` round-trips with no code change. Lock it with a test.

- [ ] **Step 1: Write the test**

Append to `src/persistence/serialization.test.ts` (mirror the existing `includes fractalConfig when present` test):

```ts
it('round-trips composableConfig.borderless', () => {
    const state = makeGameState({
        cutStyle: 'composable',
        composableConfig: {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 1, va: 0.3, vf: 2 },
            tabGenerator: 'classic',
            tabConfig: {},
            borderless: true,
        },
    });
    const serialized = serializeState(state);
    expect(serialized.composableConfig?.borderless).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: PASS (field is deep-copied). If `makeGameState` rejects the extra field, ensure `GameState['composableConfig']` includes `borderless` from Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/persistence/serialization.test.ts
git commit -m "test: lock composableConfig.borderless serialization round-trip (#139)"
```

---

## Task 8: New-game dialog + main wiring

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Modify: `src/main.ts`
- Test: `src/ui/new-game-dialog.test.ts`

The dialog gets a "Borderless" checkbox in the composable section, shown only when told the base cut generator supports it. `main.ts` computes that capability from the registry and carries the chosen value into `ComposableConfig`.

- [ ] **Step 1: Write the failing dialog test**

Append to `src/ui/new-game-dialog.test.ts` (match the file's existing setup/teardown and `createNewGameDialog` invocation style):

```ts
it('includes composableConfig.borderless in the selection when checked', () => {
    const onSelect = vi.fn();
    createNewGameDialog({
        container,
        selectedSizeId: '48',
        selectedCutStyleId: 'composable',
        composableSupportsBorderless: true,
        onSelect,
    });

    const checkbox = container.querySelector<HTMLInputElement>(
        '[data-testid="composable-borderless-toggle"]',
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));

    // Trigger a size selection to fire onSelect (match how other tests do it).
    container.querySelector<HTMLButtonElement>('[data-size-id="48"]')!.click();

    expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
            composableConfig: expect.objectContaining({ borderless: true }),
        }),
    );
});

it('omits the borderless checkbox when the generator does not support it', () => {
    createNewGameDialog({
        container,
        selectedSizeId: '48',
        selectedCutStyleId: 'composable',
        composableSupportsBorderless: false,
        onSelect: vi.fn(),
    });
    expect(
        container.querySelector('[data-testid="composable-borderless-toggle"]'),
    ).toBeNull();
});
```

If the existing tests use a different mechanism to read the selection (e.g. a "Start" button rather than a size click), copy that exact mechanism instead of the `[data-size-id]` click above.

- [ ] **Step 2: Run them (fail)**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — no `composable-borderless-toggle`, and `composableSupportsBorderless` not an accepted option.

- [ ] **Step 3: Implement in the dialog**

In `src/ui/new-game-dialog.ts`:

1. Add `borderless: boolean;` to `interface ComposableSliderConfig` (after `tabGenerator`).
2. Add to `NewGameDialogOptions`:
   ```ts
   /** Whether the composable base cut generator supports borderless mode. */
   composableSupportsBorderless?: boolean;
   ```
3. In `buildComposableSlidersSection(args)`, extend the args type with `showBorderless?: boolean;` and `saved?: ComposableSliderConfig;` (already present). After the tab-generator row is appended, conditionally add the checkbox:
   ```ts
   const borderlessCheckbox = args.showBorderless
       ? appendCheckboxRow(section, 'Borderless', args.saved?.borderless ?? false)
       : null;
   if (borderlessCheckbox) borderlessCheckbox.dataset.testid = 'composable-borderless-toggle';
   ```
   (If `appendCheckboxRow` returns the `<input>` directly, set `.dataset.testid` on it; if it returns a row wrapper, set the testid on the inner input. Match the helper's actual return — see its definition near line 456.)
4. In that section's `getValues()`, add to the returned object:
   ```ts
   borderless: borderlessCheckbox?.checked ?? false,
   ```
5. Where `buildComposableSlidersSection({ saved: options.savedComposableConfig, ... })` is called, pass `showBorderless: options.composableSupportsBorderless ?? false`.

- [ ] **Step 4: Run them (pass)**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire main.ts**

In `src/main.ts`:

1. Import the registry capability lookup near the other puzzle imports:
   ```ts
   import { getBaseCutGenerator } from './puzzle/topology/generator-registry.js';
   ```
   (If `generator-registry` isn't already re-exported through a barrel used by main, import directly from that path.)
2. Extend `sliderConfigToGeneratorConfig`'s parameter type with `borderless?: boolean;` and add to its returned `ComposableConfig`:
   ```ts
   borderless: slider.borderless,
   ```
3. Where `createNewGameDialog({ ... savedComposableConfig, ... })` is constructed, add:
   ```ts
   composableSupportsBorderless: getBaseCutGenerator('sine').supportsBorderless ?? false,
   ```

- [ ] **Step 6: Verify the whole flow type-checks and tests pass**

Run: `npx tsc --noEmit && npx vitest run src/ui/new-game-dialog.test.ts src/main.test.ts`
Expected: clean / PASS (run `src/main.test.ts` only if it exists).

- [ ] **Step 7: Commit**

```bash
git add src/ui/new-game-dialog.ts src/main.ts src/ui/new-game-dialog.test.ts
git commit -m "feat: expose composable borderless toggle in the new-game dialog (#139)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Whole suite**

Run: `npm test`
Expected: all pass (only the one pre-existing skip).

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean / build succeeds.

- [ ] **Step 3: Manual smoke (recommended)**

Run `npm run dev`, open the new-game dialog, pick **Composable** (dev build only), tick **Borderless**, start a game. Confirm: pieces have tabs/blanks on all sides (no flat frame); the requested piece count is produced; reload reproduces the same puzzle (borderless persisted). Toggle it off and confirm the classic bordered composable still works.

---

## Self-Review notes

- **Spec coverage:** capability flag (Task 1) ✓; sine oversize (Task 2) ✓; generic strip + autoGroup reconcile (Task 3) ✓; capability-gated wiring + image-to-full-grid via oversize + strip (Task 4) ✓; config/preference (Task 5) ✓; share link (Task 6) ✓; serialization (Task 7) ✓; dialog gated on capability (Task 8) ✓; **no help text** (Composable is dev-only — deliberately omitted, per spec) ✓; reproducibility (oversize/strip gated on `borderless`, strip draws no randomness — Tasks 2 & 4) ✓.
- **Type consistency:** `borderless` is the field name everywhere (`ComposableConfig`, `TopologyGeneratorConfig`, `GameState.composableConfig`, `ComposableSliderPreference`, `ComposableSliderConfig`); `supportsBorderless` on `BaseCutGenerator`; share-link short key `bl`; `stripBorderRing(pieces, autoGroups) → { pieces, autoGroups }`; `composableSupportsBorderless` dialog option / `showBorderless` section arg. Consistent across tasks.
- **Out of scope confirmed:** no Wavy UI/persistence/help-text; no renderer/engine change; no image re-scaling (slight crop accepted).
