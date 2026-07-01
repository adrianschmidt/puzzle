# Triangular Flowing-Edges Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a boolean `smooth` option to the triangular base-cut generator that turns the jittered kinks into smooth Catmull-Rom curves ("flowing" cuts).

**Architecture:** Purely per-edge — each cut edge stays a single `Curve` between the same two DCEL vertices, but when `smooth` is on and both endpoints are inside the frame, its control points come from a uniform Catmull-Rom → Bézier formula using the neighbor crossings along the same lattice line, giving a shared tangent (C1) at each crossing. Topology, vertex set, tab-splicing, and the one-outer-PRNG-draw contract are untouched. The option is then threaded through the composable config, the new-game dialog, and the share link.

**Tech Stack:** TypeScript, Vite, Vitest. Geometry via the existing `Curve` class (`src/puzzle/topology/curve.ts`).

## Global Constraints

- **American English** in all identifiers, comments, code artifacts (`smooth`, `neighbor`, `center`).
- **One outer `random()` draw**: the generator must call the caller-provided `random` exactly once regardless of `smooth`. `smooth` consumes no randomness — do not add `random()`/`local()` calls.
- **Do not change `smooth: false` output**: the straight tiling is about to be released; `smooth` off (or absent) must produce the same curves as before.
- **Share-link `bgc` carries booleans fine**: `decode` only rejects non-finite *numbers* (`share-link.ts:83`), so `smooth` rides through `cf.bgc` as a boolean with no encoding tricks.
- **No help-text change**: triangular is undocumented in the info modal (unreleased), so no `info-modal.ts` copy is added.
- **Test files live next to source** (`triangular-cut-generator.test.ts`, `composable-config.test.ts`, `new-game-dialog.test.ts`, `share-link.test.ts`).
- Run the full suite with `npm test`; a single file with `npx vitest run <path>`.

---

### Task 1: `catmullRomBezierEdge` helper

Pure geometry helper that builds one cubic Bézier segment for an edge `a → b`, bowed toward its chain-neighbors `beyondA` (before `a`) and `beyondB` (after `b`). A missing neighbor makes that end straight. This is the whole math core; it has no generator dependencies.

**Files:**
- Modify: `src/puzzle/topology/triangular-cut-generator.ts` (add + export the helper)
- Test: `src/puzzle/topology/triangular-cut-generator.test.ts`

**Interfaces:**
- Consumes: `Curve`, `BezierSegment` from `./curve.js`; `Point` from `../../model/types.js`.
- Produces: `export function catmullRomBezierEdge(a: Point, b: Point, beyondA: Point | undefined, beyondB: Point | undefined): Curve` — a single-segment `Curve`. With both neighbors absent it equals `Curve.line(a, b)`. Used by Task 2.

- [ ] **Step 1: Write the failing tests**

Add this block to `triangular-cut-generator.test.ts` (top-level, after the existing imports; extend the import on line 2 to include the helper):

```ts
// line 2 becomes:
import { triangularCutGenerator, catmullRomBezierEdge } from './triangular-cut-generator.js';

describe('catmullRomBezierEdge', () => {
    const seg = (c: ReturnType<typeof catmullRomBezierEdge>) => c.segments[0];
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
        expect(p.x).toBeCloseTo(q.x, 9);
        expect(p.y).toBeCloseTo(q.y, 9);
    };

    it('reproduces a straight line for collinear, evenly-spaced neighbors', () => {
        const a = { x: 10, y: 0 }, b = { x: 20, y: 0 };
        const got = seg(catmullRomBezierEdge(a, b, { x: 0, y: 0 }, { x: 30, y: 0 }));
        const line = seg(Curve.line(a, b));
        near(got.cp1, line.cp1);
        near(got.cp2, line.cp2);
    });

    it('shares a tangent across a vertex (C1) between adjacent edges', () => {
        const z = { x: 0, y: 0 }, a = { x: 10, y: 5 }, b = { x: 20, y: -5 }, c = { x: 30, y: 0 }, d = { x: 40, y: 4 };
        const e1 = catmullRomBezierEdge(a, b, z, c);
        const e2 = catmullRomBezierEdge(b, c, a, d);
        near(e1.tangentAt(1), e2.tangentAt(0));
    });

    it('falls back to a straight edge when both neighbors are missing', () => {
        const a = { x: 3, y: 7 }, b = { x: 9, y: 2 };
        const got = seg(catmullRomBezierEdge(a, b, undefined, undefined));
        const line = seg(Curve.line(a, b));
        near(got.cp1, line.cp1);
        near(got.cp2, line.cp2);
    });
});
```

Add `Curve` to the test's imports (it is not currently imported):

```ts
import { Curve } from './curve.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts -t catmullRomBezierEdge`
Expected: FAIL — `catmullRomBezierEdge is not exported` / not a function.

- [ ] **Step 3: Implement the helper**

In `triangular-cut-generator.ts`, after the `clipSegmentToFrame` function (i.e. before `export const triangularCutGenerator`), add:

```ts
/**
 * Build one cubic Bézier for the cut edge a→b, bowed so its endpoint tangents
 * are shared with the adjacent edges on the same lattice line (uniform
 * Catmull-Rom → Bézier). `beyondA` is the crossing before `a` on that line and
 * `beyondB` the crossing after `b`; either may be undefined at a chain end, in
 * which case that end uses the straight control point (identical to
 * `Curve.line`). Parameter-free: when the four points are collinear and evenly
 * spaced (the lattice at jitter 0) it reproduces an exact straight line.
 */
export function catmullRomBezierEdge(
    a: Point,
    b: Point,
    beyondA: Point | undefined,
    beyondB: Point | undefined,
): Curve {
    const cp1 = beyondA
        ? { x: a.x + (b.x - beyondA.x) / 6, y: a.y + (b.y - beyondA.y) / 6 }
        : { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    const cp2 = beyondB
        ? { x: b.x - (beyondB.x - a.x) / 6, y: b.y - (beyondB.y - a.y) / 6 }
        : { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 };
    return new Curve([{ p0: a, cp1, cp2, p3: b }]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts -t catmullRomBezierEdge`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/triangular-cut-generator.ts src/puzzle/topology/triangular-cut-generator.test.ts
git commit -m "feat(topology): add catmullRomBezierEdge helper for smooth triangular cuts"
```

---

### Task 2: Thread `smooth` through the generator

Add the `smooth` config field and use `catmullRomBezierEdge` for every edge fully inside the frame; leave fringe (clipped) edges and the `smooth: false` path exactly as they are.

**Files:**
- Modify: `src/puzzle/topology/triangular-cut-generator.ts` (`TriangularCutConfig`, `generate`)
- Test: `src/puzzle/topology/triangular-cut-generator.test.ts`

**Interfaces:**
- Consumes: `catmullRomBezierEdge` (Task 1).
- Produces: `TriangularCutConfig` gains `smooth: boolean`. `generate` reads `cfg.smooth === true` (default false). Consumed by Task 3 (`composableSliderToGeneratorConfig` sets `baseCutConfig.smooth`).

- [ ] **Step 1: Write the failing tests**

Add to `triangular-cut-generator.test.ts` inside the existing `describe('triangularCutGenerator', ...)` block (reuse its `frame`, `makeSeededRandom`, `countingRandom`):

```ts
    // Cross product of (p0→cp) and (p0→p3); ~0 means the control point is on the chord.
    const chordCross = (s: { p0: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; p3: { x: number; y: number } }, cp: 'cp1' | 'cp2') => {
        const u = { x: s[cp].x - s.p0.x, y: s[cp].y - s.p0.y };
        const v = { x: s.p3.x - s.p0.x, y: s.p3.y - s.p0.y };
        return Math.abs(u.x * v.y - u.y * v.x);
    };
    const allStraight = (curves: ReturnType<typeof triangularCutGenerator.generate>) =>
        curves.slice(4).every(c => c.segments.length === 1
            && chordCross(c.segments[0], 'cp1') < 1e-6
            && chordCross(c.segments[0], 'cp2') < 1e-6);

    it('leaves interior edges straight when smooth is off', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3 });
        expect(allStraight(curves)).toBe(true);
    });

    it('stays straight with smooth on but jitter 0', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0, smooth: true });
        expect(allStraight(curves)).toBe(true);
    });

    it('bows at least one interior edge with smooth + jitter', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3, smooth: true });
        const bowed = curves.slice(4).some(c => chordCross(c.segments[0], 'cp1') > 1e-3 || chordCross(c.segments[0], 'cp2') > 1e-3);
        expect(bowed).toBe(true);
    });

    it('draws exactly one outer PRNG value with smooth on', () => {
        const c = countingRandom();
        triangularCutGenerator.generate(frame, c.fn, { rows: 12, jitter: 0.4, smooth: true });
        expect(c.calls()).toBe(1);
    });

    it('emits the same interior edge count with smooth on vs off', () => {
        const off = triangularCutGenerator.generate(frame, makeSeededRandom(4), { rows: 8, jitter: 0.3 });
        const on = triangularCutGenerator.generate(frame, makeSeededRandom(4), { rows: 8, jitter: 0.3, smooth: true });
        expect(on.length).toBe(off.length);
    });

    it('keeps smoothed curves within the frame', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(2), { rows: 6, jitter: 0.4, smooth: true });
        const eps = 1e-6;
        for (let i = 4; i < curves.length; i++) {
            for (let t = 0; t <= 1; t += 0.1) {
                const p = curves[i].pointAt(t);
                expect(p.x).toBeGreaterThanOrEqual(-eps);
                expect(p.x).toBeLessThanOrEqual(frame.width + eps);
                expect(p.y).toBeGreaterThanOrEqual(-eps);
                expect(p.y).toBeLessThanOrEqual(frame.height + eps);
            }
        }
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: the new `smooth`/bow tests FAIL (bowed edge not produced; `smooth` ignored). "leaves interior edges straight when smooth is off" should already PASS.

- [ ] **Step 3: Add the `smooth` field to the config type**

In `triangular-cut-generator.ts`, extend `TriangularCutConfig` (currently lines 26–32):

```ts
export interface TriangularCutConfig {
    /** Triangle rows; row height = frame.height / rows. Injected from the
     *  size grid by the topology generator. */
    rows: number;
    /** Irregularity amplitude, fraction of side length (0–0.5). */
    jitter: number;
    /** When true, bow each interior cut edge so adjacent edges on the same
     *  lattice line share a tangent (smooth "flowing" cuts). No-op at
     *  jitter 0. Consumes no randomness. */
    smooth: boolean;
}
```

- [ ] **Step 4: Parse `smooth` in `generate`**

In `generate`, immediately after the `jitter` clamp (line 180 `const jitter = ...;`), add:

```ts
        const smooth = (cfg.smooth ?? false) === true;
```

- [ ] **Step 5: Add neighbor lookups and lattice direction helpers**

In `generate`, immediately after `const pos = (j, k) => nodes.get(key(j, k))!;` (line 238), add:

```ts
        // Neighbor lattice direction helpers (col index in the adjacent row).
        // These mirror the diagonal emission below; `maybePos` returns
        // undefined off-lattice so the smoothed edge stays straight at a chain
        // end. Used only when `smooth` is on.
        const maybePos = (j: number, k: number): Point | undefined => nodes.get(key(j, k));
        const even = (j: number) => j % 2 === 0;
        const drK = (j: number, k: number) => even(j) ? k : k + 1;   // down-right col, row j+1
        const dlK = (j: number, k: number) => even(j) ? k - 1 : k;   // down-left col, row j+1
        const urK = (j: number, k: number) => even(j) ? k - 1 : k;   // up-right col, row j-1
        const ulK = (j: number, k: number) => even(j) ? k : k + 1;   // up-left col, row j-1
```

- [ ] **Step 6: Bow in-frame edges in `pushEdge`**

Replace the current `pushEdge` (lines 248–254):

```ts
        const pushEdge = (a: Point, b: Point): void => {
            const clipped = clipSegmentToFrame(a, b, w, h);
            if (!clipped) return;
            const [p2, q2] = clipped;
            if (Math.hypot(q2.x - p2.x, q2.y - p2.y) < 1) return; // corner graze
            curves.push(Curve.line(p2, q2));
        };
```

with a version that takes the two beyond-neighbors and bows when both endpoints are in the frame:

```ts
        const inFrame = (p: Point) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
        const pushEdge = (
            a: Point,
            b: Point,
            beyondA?: Point,
            beyondB?: Point,
        ): void => {
            // Smooth path: both endpoints inside the frame → bow the edge.
            // (Fringe edges with an endpoint outside the frame fall through to
            // the straight clip below, as before.)
            if (smooth && inFrame(a) && inFrame(b)) {
                curves.push(catmullRomBezierEdge(a, b, beyondA, beyondB));
                return;
            }
            const clipped = clipSegmentToFrame(a, b, w, h);
            if (!clipped) return;
            const [p2, q2] = clipped;
            if (Math.hypot(q2.x - p2.x, q2.y - p2.y) < 1) return; // corner graze
            curves.push(Curve.line(p2, q2));
        };
```

- [ ] **Step 7: Pass beyond-neighbors at the horizontal call site**

Replace the horizontal edge loop body (line 261 `pushEdge(pos(j, k), pos(j, k + 1));`):

```ts
        for (let j = 1; j < rows; j++) {
            for (let k = kMin; k < kMax; k++) {
                pushEdge(pos(j, k), pos(j, k + 1), maybePos(j, k - 1), maybePos(j, k + 2));
            }
        }
```

- [ ] **Step 8: Pass beyond-neighbors at the diagonal call sites**

Replace the diagonal loop body (lines 268–278) — same edges and order, now with beyond-neighbors:

```ts
        for (let j = 0; j < rows; j++) {
            for (let k = kMin + 1; k < kMax; k++) {
                if (j % 2 === 0) {
                    // down-right (j,k) -> (j+1,k)
                    pushEdge(pos(j, k), pos(j + 1, k),
                        maybePos(j - 1, urK(j, k)), maybePos(j + 2, drK(j + 1, k)));
                    // down-left (j,k) -> (j+1,k-1)
                    pushEdge(pos(j, k), pos(j + 1, k - 1),
                        maybePos(j - 1, ulK(j, k)), maybePos(j + 2, dlK(j + 1, k - 1)));
                } else {
                    // down-right (j,k) -> (j+1,k+1)
                    pushEdge(pos(j, k), pos(j + 1, k + 1),
                        maybePos(j - 1, urK(j, k)), maybePos(j + 2, drK(j + 1, k + 1)));
                    // down-left (j,k) -> (j+1,k)
                    pushEdge(pos(j, k), pos(j + 1, k),
                        maybePos(j - 1, ulK(j, k)), maybePos(j + 2, dlK(j + 1, k)));
                }
            }
        }
```

- [ ] **Step 9: Run the full generator test file**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: PASS (all new `smooth` tests plus the entire existing suite — determinism, no-duplicates, endpoints-in-frame, curve budgets).

- [ ] **Step 10: Commit**

```bash
git add src/puzzle/topology/triangular-cut-generator.ts src/puzzle/topology/triangular-cut-generator.test.ts
git commit -m "feat(topology): bow interior triangular cuts when smooth is enabled"
```

---

### Task 3: Composable config plumbing

Carry `smooth` through the persisted preference and into the generator config.

**Files:**
- Modify: `src/game/composable-config.ts`
- Test: `src/game/composable-config.test.ts`

**Interfaces:**
- Consumes: `TriangularCutConfig.smooth` (Task 2) — surfaced as `baseCutConfig.smooth`.
- Produces: `ComposableSliderPreference` gains `smooth: boolean`; `DEFAULT_SMOOTH = false`; `parseComposableConfig` reads it; `composableSliderToGeneratorConfig` triangular branch emits `baseCutConfig: { jitter, smooth }`. Consumed by Task 4 (dialog) and Task 5 (share-link test uses the same `bgc` shape).

- [ ] **Step 1: Write the failing tests**

In `composable-config.test.ts`, add these tests to the `describe('composable base-cut + jitter', ...)` block (near line 143):

```ts
    it('defaults smooth to false for legacy saved configs', () => {
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
            horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5,
            baseCut: 'triangular', jitter: 0.2,
        }));
        expect(loadComposableConfigPreference()?.smooth).toBe(false);
    });

    it('round-trips smooth true through the preference', () => {
        saveComposableConfigPreference({
            baseCut: 'triangular', horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5, tabGenerator: 'classic',
            borderless: false, jitter: 0.3, smooth: true,
        });
        expect(loadComposableConfigPreference()?.smooth).toBe(true);
    });

    it('passes smooth into the triangular generator config', () => {
        const cfg = composableSliderToGeneratorConfig({
            baseCut: 'triangular', horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
            verticalAmplitude: 0.15, verticalFrequency: 1.5, tabGenerator: 'classic',
            borderless: false, jitter: 0.3, smooth: true,
        });
        expect(cfg.baseCutConfig).toEqual({ jitter: 0.3, smooth: true });
    });
```

Ensure `COMPOSABLE_CONFIG_KEY` is imported in the test file (add to the existing import from `'./composable-config.js'` if absent).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: FAIL — new tests fail; and TypeScript errors on preference literals now missing `smooth` (fixed in Steps 3–5).

- [ ] **Step 3: Add the default and interface field**

In `composable-config.ts`, after `DEFAULT_JITTER` (line 29):

```ts
/** Default triangular smooth ("flowing edges") toggle. */
export const DEFAULT_SMOOTH = false;
```

Add `smooth` to `ComposableSliderPreference` (after `jitter;` on line 57):

```ts
    jitter: number;
    smooth: boolean;
```

- [ ] **Step 4: Parse `smooth`**

In `parseComposableConfig`, after the `jitter` block (after line 96), add:

```ts
    const smooth = config.smooth === true;
```

and include it in the returned object (after `jitter,` on line 106):

```ts
        jitter,
        smooth,
```

- [ ] **Step 5: Emit `smooth` in the triangular generator config**

In `composableSliderToGeneratorConfig`, the triangular branch (lines 135–142) becomes:

```ts
    if (slider.baseCut === 'triangular') {
        return {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: slider.jitter, smooth: slider.smooth },
            tabGenerator: slider.tabGenerator,
            tabConfig: {},
            borderless: false,
        };
    }
```

(The sine branch is unchanged — sine ignores `smooth`.)

- [ ] **Step 6: Fix existing test literals broken by the new required field**

`smooth` is now required on `ComposableSliderPreference`, so every full-object literal must include it. Update these literals in `composable-config.test.ts` (add `smooth: false` unless the test is about smooth):
- the `sampleConfig` / preference object around line 26,
- the saved-preference object around line 106–107,
- the triangular round-trip object at lines 172–181 (add `smooth: false`; the `toEqual(tri)` on line 183 then matches the loaded `smooth: false`),
- the sine translate input at lines 187–196,
- the triangular translate input at lines 207–216, and its expected `baseCutConfig` at line 219 → `{ jitter: 0.3, smooth: false }`.

Let the compiler guide you: `npx tsc --noEmit` lists every literal still missing `smooth`.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/game/composable-config.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/game/composable-config.ts src/game/composable-config.test.ts
git commit -m "feat(game): carry triangular smooth toggle through composable config"
```

---

### Task 4: New-game dialog checkbox

Expose `smooth` as a checkbox in the triangular controls, alongside the Irregularity slider.

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: nothing new at runtime; produces the `smooth` field on the dialog's config.
- Produces: `ComposableSliderConfig` gains `smooth: boolean`; `getValues()` returns it; a checkbox with `data-testid="composable-smooth-toggle"` lives in `triangularControls`.

- [ ] **Step 1: Write the failing test**

Add to `new-game-dialog.test.ts`, right after the existing `'reports baseCut + jitter through onSelect'` test (line 870), reusing the file's `openDialogAndSelectComposable()` harness (defined ~line 828):

```ts
    it('reports the smooth toggle through onSelect', () => {
        const onSelect = openDialogAndSelectComposable();
        container.querySelector<HTMLInputElement>('input[type="radio"][value="triangular"]')!.click();
        const smooth = container.querySelector<HTMLInputElement>('[data-testid="composable-smooth-toggle"]')!;
        expect(smooth).not.toBeNull();
        smooth.checked = true;
        smooth.dispatchEvent(new Event('change'));
        // Pick a size to fire onSelect.
        container.querySelectorAll<HTMLButtonElement>('.size-picker-option')[0].click();
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                composableConfig: expect.objectContaining<Partial<ComposableSliderConfig>>({ baseCut: 'triangular', smooth: true }),
            }),
        );
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/new-game-dialog.test.ts -t "smooth toggle"`
Expected: FAIL — `composable-smooth-toggle` not found.

- [ ] **Step 3: Add `smooth` to the dialog config interface**

In `new-game-dialog.ts`, `ComposableSliderConfig` (lines 19–28), after `jitter: number;`:

```ts
    jitter: number;
    smooth: boolean;
```

- [ ] **Step 4: Render the checkbox in `triangularControls`**

In `buildComposableSlidersSection`, right after the jitter row is appended to `triangularControls` (after line 427 `triangularControls.appendChild(jitterRow);`), add a checkbox using the existing `appendCheckboxRow` helper and tag it:

```ts
        const smoothCheckbox = appendCheckboxRow(
            triangularControls,
            'Flowing edges',
            args.saved?.smooth ?? false,
        );
        smoothCheckbox.dataset.testid = 'composable-smooth-toggle';
```

- [ ] **Step 5: Return `smooth` from `getValues()`**

In the `getValues` object (lines 458–471), after `jitter: parseFloat(jitterInput.value),`:

```ts
            jitter: parseFloat(jitterInput.value),
            smooth: smoothCheckbox.checked,
```

- [ ] **Step 6: Fix any dialog-test literals broken by the new required field**

Run `npx tsc --noEmit` and add `smooth: false` to any full `ComposableSliderConfig` literal it flags in `new-game-dialog.test.ts` (the `expect.objectContaining` / `Partial<ComposableSliderConfig>` usages need no change — they are partial).

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/ui/new-game-dialog.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat(ui): add Flowing edges toggle to the triangular new-game controls"
```

---

### Task 5: Share-link round-trip coverage

Lock the `smooth` key into the triangular share-link round-trip (it already rides through `cf.bgc` unmodified; this is a regression guard).

**Files:**
- Test: `src/sharing/share-link.test.ts`

**Interfaces:**
- Consumes: the `cf.bgc` shape carrying `{ jitter, smooth }`.
- Produces: nothing — coverage only.

- [ ] **Step 1: Write the test**

In `share-link.test.ts`, extend the existing `'round-trips a triangular composable config'` test (lines 277–288) to include `smooth`, or add a sibling test:

```ts
    it('round-trips a triangular composable config with smooth enabled', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'none',
            cf: {
                bg: 'triangular',
                bgc: { jitter: 0.3, smooth: true },
                tg: 'classic',
                tgc: {},
            },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });
```

- [ ] **Step 2: Run to verify pass**

Run: `npx vitest run src/sharing/share-link.test.ts -t "smooth enabled"`
Expected: PASS immediately — `bgc` booleans already round-trip (`share-link.ts:83` only rejects non-finite numbers). This test documents/locks that behavior.

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS across the repo.

- [ ] **Step 4: Commit**

```bash
git add src/sharing/share-link.test.ts
git commit -m "test(sharing): lock triangular smooth toggle share-link round-trip"
```

---

## Manual verification (after all tasks)

The unit tests cover geometry and wiring, but the *look* is the point. After Task 5, run the app (`npm run dev`), start a puzzle with **Triangular** base cut, raise **Irregularity**, and toggle **Flowing edges** — confirm the cuts round off at the crossings rather than kinking, at low and high jitter. If cuts visibly overshoot or tangle across neighbors at high jitter, apply the spec's documented fallback (centripetal parametrization / tension clamp) — not expected, but that is the escape hatch.

## Self-Review notes

- **Spec coverage:** algorithm (T1–T2), overshoot safety test (T2 in-frame sampling), frame-boundary in-frame gate (T2), no new randomness (T2 one-draw test), config/UI/share wiring (T3–T5), no help-text change (Global Constraints). All spec sections map to a task.
- **Type consistency:** `smooth: boolean` added identically to `TriangularCutConfig` (T2), `ComposableSliderPreference` (T3), `ComposableSliderConfig` (T4); `baseCutConfig` becomes `{ jitter, smooth }` (T3) and the share-link/decode test asserts that same shape (T5). Helper name `catmullRomBezierEdge` is used verbatim in T2.
