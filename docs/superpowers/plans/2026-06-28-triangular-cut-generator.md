# Triangular Base-Cut Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an equilateral/isometric triangle base-cut generator to the Composable framework, selectable from the new-game dialog with an optional irregularity (jitter) slider.

**Architecture:** A new `BaseCutGenerator` (`id: 'triangular'`) emits the frame borders plus a deduplicated lattice of per-edge line segments (horizontal + ±60° families), each clipped to the frame. Jitter displaces interior lattice vertices via a local sub-PRNG seeded from a single outer `random()` draw. The dialog gains a `Sine | Triangular` base-cut picker; the slider→generator translation branches on that choice. Share-link and save serialization already pass `baseCutConfig` through generically, so they need no schema change.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for DOM tests), the existing Composable topology framework (`src/puzzle/topology/`).

## Global Constraints

- **PRNG reproducibility contract:** the generator MUST call the outer `random()` exactly once, regardless of `rows` or `jitter`. All further randomness comes from a local `createSeededRandom` sub-PRNG. (CLAUDE.md "Isolate new seeded randomness behind a sub-PRNG".)
- **No overlapping/duplicate collinear segments:** the DCEL builder (`dcel.ts`) cannot resolve overlapping collinear curves. Each lattice edge is emitted exactly once, and lattice rows that coincide with a border line are NOT emitted as cuts.
- **Border contract:** the first four returned curves are the frame borders in order top, right, bottom, left (each a single-segment `Curve.line`).
- **Vertex merge tolerance:** the DCEL snaps endpoints within 3px. Keep distinct vertices and clip points clear of that tolerance.
- **American English** for all identifiers/comments.
- **No info-modal change** — Composable is dev-gated and intentionally undocumented in `info-modal.ts`.
- **Don't retrofit the sub-PRNG pattern onto existing generators** (sine/venn). Only the new generator is in scope.

---

### Task 1: Triangular cut generator + registry registration

**Files:**
- Create: `src/puzzle/topology/triangular-cut-generator.ts`
- Create: `src/puzzle/topology/triangular-cut-generator.test.ts`
- Modify: `src/puzzle/topology/generator-registry.ts` (add import + `registerBaseCutGenerator`)

**Interfaces:**
- Consumes: `Curve.line(start, end)`, `Curve` `get start()/get end()/segments` from `./curve.js`; `createSeededRandom(seed)` from `../seeded-random.js`; `BaseCutGenerator` from `./plugin-types.js`; `Size`, `Point` from `../../model/types.js`.
- Produces: `export const triangularCutGenerator: BaseCutGenerator` with `id: 'triangular'`; `export interface TriangularCutConfig { rows: number; jitter: number }`. Registered so `getBaseCutGenerator('triangular')` resolves it.

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/triangular-cut-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { triangularCutGenerator } from './triangular-cut-generator.js';
import { getBaseCutGenerator } from './generator-registry.js';

// Inline mulberry32 mirror (same family as createSeededRandom), matching the
// pattern used by sine-cut-generator.test.ts.
function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Deterministic PRNG that counts its calls (mirrors the sine test helper).
function countingRandom() {
    let calls = 0;
    const fn = () => { calls++; return 0.42; };
    return { fn, calls: () => calls };
}

describe('triangularCutGenerator', () => {
    const frame = { width: 800, height: 600 };

    it('has id "triangular"', () => {
        expect(triangularCutGenerator.id).toBe('triangular');
    });

    it('does not advertise borderless support', () => {
        expect(triangularCutGenerator.supportsBorderless).toBeFalsy();
    });

    it('returns the four frame borders first', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(1), { rows: 6, jitter: 0 });
        expect(curves.length).toBeGreaterThan(4);
        expect(curves[0].start).toEqual({ x: 0, y: 0 });
        expect(curves[0].end).toEqual({ x: 800, y: 0 });
        expect(curves[1].end).toEqual({ x: 800, y: 600 });
        expect(curves[2].end).toEqual({ x: 0, y: 600 });
        expect(curves[3].end).toEqual({ x: 0, y: 0 });
        for (let i = 0; i < 4; i++) expect(curves[i].segments).toHaveLength(1);
    });

    it('draws exactly one outer PRNG value regardless of rows/jitter', () => {
        const a = countingRandom();
        triangularCutGenerator.generate(frame, a.fn, { rows: 4, jitter: 0 });
        expect(a.calls()).toBe(1);

        const b = countingRandom();
        triangularCutGenerator.generate(frame, b.fn, { rows: 12, jitter: 0.4 });
        expect(b.calls()).toBe(1);
    });

    it('is deterministic for a given seed + config', () => {
        const c1 = triangularCutGenerator.generate(frame, makeSeededRandom(7), { rows: 8, jitter: 0.3 });
        const c2 = triangularCutGenerator.generate(frame, makeSeededRandom(7), { rows: 8, jitter: 0.3 });
        expect(c1.map(c => c.segments)).toEqual(c2.map(c => c.segments));
    });

    it('keeps all interior cut endpoints within the frame', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(3), { rows: 6, jitter: 0.4 });
        const eps = 1e-6;
        for (let i = 4; i < curves.length; i++) {
            for (const pt of [curves[i].start, curves[i].end]) {
                expect(pt.x).toBeGreaterThanOrEqual(-eps);
                expect(pt.x).toBeLessThanOrEqual(frame.width + eps);
                expect(pt.y).toBeGreaterThanOrEqual(-eps);
                expect(pt.y).toBeLessThanOrEqual(frame.height + eps);
            }
        }
    });

    it('emits no duplicate interior edges', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(5), { rows: 6, jitter: 0 });
        const seen = new Set<string>();
        const r = (n: number) => Math.round(n * 10) / 10;
        for (let i = 4; i < curves.length; i++) {
            const s = curves[i].start, e = curves[i].end;
            const a = `${r(s.x)},${r(s.y)}`;
            const b = `${r(e.x)},${r(e.y)}`;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
    });

    it('jitter changes the interior cuts vs the regular tiling', () => {
        const regular = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0 });
        const jittered = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.4 });
        expect(jittered.map(c => c.segments)).not.toEqual(regular.map(c => c.segments));
    });

    it('is registered in the generator registry', () => {
        expect(getBaseCutGenerator('triangular')).toBe(triangularCutGenerator);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: FAIL — cannot resolve `./triangular-cut-generator.js` (module not found).

- [ ] **Step 3: Implement the generator**

Create `src/puzzle/topology/triangular-cut-generator.ts`:

```ts
/**
 * Equilateral / isometric triangle base-cut generator.
 *
 * Tiles the frame with equilateral triangles (three line families:
 * horizontal plus ±60°), emitted as a deduplicated set of per-edge line
 * segments between shared lattice vertices — NOT maximal full-frame lines.
 * The DCEL builder merges coincident endpoints (3px tolerance) and handles
 * the degree-6 vertices a triangular lattice produces, so a vertex-meeting
 * lattice composes correctly.
 *
 * Border curves come first (top, right, bottom, left). The frame's left/right
 * edges cut border triangles into partial pieces, by design.
 */

import type { Size, Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { createSeededRandom } from '../seeded-random.js';

export interface TriangularCutConfig {
    /** Triangle rows; row height = frame.height / rows. Injected from the
     *  size grid by the topology generator. */
    rows: number;
    /** Irregularity amplitude, fraction of side length (0–0.5). */
    jitter: number;
}

/** Map a [0,1) float onto a 32-bit integer seed (CLAUDE.md sub-PRNG helper). */
function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

/**
 * Liang–Barsky clip of segment a→b to the rectangle [0,w]×[0,h]. Returns the
 * clipped endpoints, or null when the segment lies fully outside.
 */
function clipSegmentToFrame(a: Point, b: Point, w: number, h: number): [Point, Point] | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x, w - a.x, a.y, h - a.y];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null; // parallel to this edge and outside it
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > t1) return null;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return null;
                if (t < t1) t1 = t;
            }
        }
    }
    return [
        { x: a.x + t0 * dx, y: a.y + t0 * dy },
        { x: a.x + t1 * dx, y: a.y + t1 * dy },
    ];
}

export const triangularCutGenerator: BaseCutGenerator = {
    id: 'triangular',
    // supportsBorderless intentionally omitted (falsy): a jittered, partial-edge
    // tiling has no clean 1-deep rectangular ring for strip-border-ring.ts.

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<TriangularCutConfig>;
        const rows = Math.max(1, Math.floor(cfg.rows ?? 1));
        const jitter = Math.min(0.5, Math.max(0, cfg.jitter ?? 0.15));
        const w = frame.width;
        const h = frame.height;

        // ONE outer draw seeds the local sub-PRNG; every jitter draw uses
        // `local`, so the outer stream advances by exactly one call regardless
        // of rows/jitter (reproducibility contract).
        const local = createSeededRandom(seedFromFloat(random()));

        const rowHeight = h / rows;
        const side = (2 * rowHeight) / Math.sqrt(3);

        // Extend two columns past each side so border triangles clip cleanly.
        const kMin = -2;
        const kMax = Math.ceil(w / side) + 2;

        // Pre-compute every node position in a FIXED (j,k) order so the jitter
        // draw order is deterministic; edge emission only reads these.
        const nodes = new Map<string, Point>();
        // Only jitter nodes comfortably inside the frame, so jittered nodes and
        // clip points stay clear of the border and the 3px merge tolerance.
        const inset = side * jitter + 3;
        const key = (j: number, k: number) => `${j}:${k}`;
        for (let j = 0; j <= rows; j++) {
            const rowShift = (j % 2 === 0) ? 0 : side / 2;
            const y = j * rowHeight;
            for (let k = kMin; k <= kMax; k++) {
                const x = k * side + rowShift;
                let px = x;
                let py = y;
                const insideInset = x > inset && x < w - inset && y > inset && y < h - inset;
                if (jitter > 0 && insideInset) {
                    const ang = local() * Math.PI * 2;
                    const mag = local() * jitter * side;
                    px = x + Math.cos(ang) * mag;
                    py = y + Math.sin(ang) * mag;
                }
                nodes.set(key(j, k), { x: px, y: py });
            }
        }
        const pos = (j: number, k: number): Point => nodes.get(key(j, k))!;

        // Borders FIRST (top, right, bottom, left), per the contract.
        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
            Curve.line({ x: w, y: 0 }, { x: w, y: h }),
            Curve.line({ x: w, y: h }, { x: 0, y: h }),
            Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
        ];

        const pushEdge = (a: Point, b: Point): void => {
            const clipped = clipSegmentToFrame(a, b, w, h);
            if (!clipped) return;
            const [p2, q2] = clipped;
            if (Math.hypot(q2.x - p2.x, q2.y - p2.y) < 1) return; // corner graze
            curves.push(Curve.line(p2, q2));
        };

        // Horizontal edges: interior rows only (1..rows-1). Rows 0 and `rows`
        // lie on the top/bottom border lines; emitting them would duplicate the
        // border curves (overlapping collinear segments).
        for (let j = 1; j < rows; j++) {
            for (let k = kMin; k < kMax; k++) {
                pushEdge(pos(j, k), pos(j, k + 1));
            }
        }

        // Diagonal edges: each node in rows 0..rows-1 connects to its two
        // neighbours in the row below. Emitted once from the upper node, so no
        // duplicates. Parity selects the down-left / down-right indices.
        for (let j = 0; j < rows; j++) {
            for (let k = kMin + 1; k < kMax; k++) {
                if (j % 2 === 0) {
                    pushEdge(pos(j, k), pos(j + 1, k));     // down-right
                    pushEdge(pos(j, k), pos(j + 1, k - 1)); // down-left
                } else {
                    pushEdge(pos(j, k), pos(j + 1, k + 1)); // down-right
                    pushEdge(pos(j, k), pos(j + 1, k));     // down-left
                }
            }
        }

        return curves;
    },
};
```

- [ ] **Step 4: Register the generator**

Modify `src/puzzle/topology/generator-registry.ts`. Add the import next to the other base-cut imports:

```ts
import { triangularCutGenerator } from './triangular-cut-generator.js';
```

Add the registration in the "Register additional generators" block (after `registerBaseCutGenerator(vennCutGenerator);`):

```ts
registerBaseCutGenerator(triangularCutGenerator);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/triangular-cut-generator.ts src/puzzle/topology/triangular-cut-generator.test.ts src/puzzle/topology/generator-registry.ts
git commit -m "feat(composable): add triangular base-cut generator"
```

---

### Task 2: Data layer — preference shape, parse defaults, slider→generator translation

Extends the composable preference with `baseCut`/`jitter`, extracts the (currently private, untestable) `sliderConfigToGeneratorConfig` from `main.ts` into `composable-config.ts`, and branches it for triangular. After this task the build is green and behavior is unchanged (base cut still resolves to sine everywhere, because the dialog can't pick triangular yet — Task 3).

**Files:**
- Modify: `src/game/composable-config.ts` (extend `ComposableSliderPreference`, `parseComposableConfig`; add `composableSliderToGeneratorConfig`)
- Modify: `src/game/composable-config.test.ts` (update existing round-trip fixtures; add migration + translation tests)
- Modify: `src/ui/new-game-dialog.ts` (add `baseCut`/`jitter` to `ComposableSliderConfig`; have `getValues()` return placeholder defaults for them)
- Modify: `src/main.ts` (delete local `sliderConfigToGeneratorConfig`; import and call `composableSliderToGeneratorConfig`)

**Interfaces:**
- Consumes: `ComposableConfig` (type) from `../puzzle/composable-generator.js`; existing `ComposableTabGenerator`, `createJsonPreference`.
- Produces:
  - `export type ComposableBaseCut = 'sine' | 'triangular'`
  - `export const DEFAULT_BASE_CUT: ComposableBaseCut = 'sine'`
  - `export const DEFAULT_JITTER = 0.15`
  - `ComposableSliderPreference` gains `baseCut: ComposableBaseCut` and `jitter: number`
  - `export function composableSliderToGeneratorConfig(slider: ComposableSliderPreference): ComposableConfig`
  - `ComposableSliderConfig` (dialog) gains `baseCut: 'sine' | 'triangular'` and `jitter: number`

- [ ] **Step 1: Write the failing tests**

Add to `src/game/composable-config.test.ts`. First, import the new symbols at the top (extend the existing import):

```ts
import {
    COMPOSABLE_CONFIG_KEY,
    saveComposableConfigPreference,
    loadComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from './composable-config.js';
```

Update the existing `sampleConfig` fixture to include the new fields (the existing round-trip tests assert deep equality with what `load` now returns):

```ts
    const sampleConfig = {
        baseCut: 'sine' as const,
        horizontalAmplitude: 0.25,
        horizontalFrequency: 3.0,
        verticalAmplitude: 0.1,
        verticalFrequency: 5.0,
        tabGenerator: 'none' as const,
        borderless: false,
        jitter: 0.15,
    };
```

Then add new tests in a fresh `describe`:

```ts
describe('composable base-cut + jitter', () => {
    beforeEach(() => localStorage.clear());

    it('defaults baseCut to sine and jitter to 0.15 for legacy saved configs', () => {
        // A pre-existing preference written before baseCut/jitter existed.
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
            horizontalAmplitude: 0.2,
            horizontalFrequency: 1,
            verticalAmplitude: 0.2,
            verticalFrequency: 1,
            tabGenerator: 'classic',
            borderless: false,
        }));
        const loaded = loadComposableConfigPreference();
        expect(loaded?.baseCut).toBe('sine');
        expect(loaded?.jitter).toBe(0.15);
    });

    it('round-trips a triangular preference', () => {
        const tri = {
            baseCut: 'triangular' as const,
            horizontalAmplitude: 0.15,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.15,
            verticalFrequency: 1.5,
            tabGenerator: 'classic' as const,
            borderless: false,
            jitter: 0.3,
        };
        saveComposableConfigPreference(tri);
        expect(loadComposableConfigPreference()).toEqual(tri);
    });

    it('translates a sine slider config to a sine generator config', () => {
        const cfg = composableSliderToGeneratorConfig({
            baseCut: 'sine',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 3,
            verticalAmplitude: 0.1,
            verticalFrequency: 4,
            tabGenerator: 'classic',
            borderless: true,
            jitter: 0.3,
        });
        expect(cfg).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 3, va: 0.1, vf: 4 },
            tabGenerator: 'classic',
            tabConfig: {},
            borderless: true,
        });
    });

    it('translates a triangular slider config to a triangular generator config', () => {
        const cfg = composableSliderToGeneratorConfig({
            baseCut: 'triangular',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 3,
            verticalAmplitude: 0.1,
            verticalFrequency: 4,
            tabGenerator: 'traced',
            borderless: true,
            jitter: 0.3,
        });
        expect(cfg).toEqual({
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.3 },
            tabGenerator: 'traced',
            tabConfig: {},
            borderless: false,
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: FAIL — `composableSliderToGeneratorConfig` is not exported; loaded configs lack `baseCut`/`jitter`.

- [ ] **Step 3: Extend `composable-config.ts`**

Add the type-only import near the top of `src/game/composable-config.ts`:

```ts
import type { ComposableConfig } from '../puzzle/composable-generator.js';
```

Add the new constants/type below `DEFAULT_TAB_GENERATOR`:

```ts
/** Base-cut generator choice exposed by the new-game dialog. */
export type ComposableBaseCut = 'sine' | 'triangular';

/** Default base cut when no preference is saved. */
export const DEFAULT_BASE_CUT: ComposableBaseCut = 'sine';

/** Default triangular irregularity (fraction of side length). */
export const DEFAULT_JITTER = 0.15;
```

Extend `ComposableSliderPreference` (add the two fields):

```ts
export interface ComposableSliderPreference {
    baseCut: ComposableBaseCut;
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: ComposableTabGenerator;
    borderless: boolean;
    jitter: number;
}
```

In `parseComposableConfig`, before the `return`, derive the new fields (defaults keep legacy saves valid):

```ts
    const baseCut: ComposableBaseCut =
        config.baseCut === 'triangular' ? 'triangular' : 'sine';
    const jitterRaw = Number(config.jitter);
    const jitter = Number.isFinite(jitterRaw) ? jitterRaw : DEFAULT_JITTER;
```

and include them in the returned object:

```ts
    return {
        baseCut,
        horizontalAmplitude: Number(config.horizontalAmplitude),
        horizontalFrequency: Number(config.horizontalFrequency),
        verticalAmplitude: Number(config.verticalAmplitude),
        verticalFrequency: Number(config.verticalFrequency),
        tabGenerator,
        borderless: config.borderless === true,
        jitter,
    };
```

Append the translation function at the end of the file:

```ts
/**
 * Translate a composable slider/preference config into the framework's
 * opaque {@link ComposableConfig}. Branches on `baseCut`: sine emits the
 * `{ha,hf,va,vf}` shape and honors borderless; triangular emits `{jitter}`
 * (rows are injected downstream from the size grid) and never borderless.
 */
export function composableSliderToGeneratorConfig(
    slider: ComposableSliderPreference,
): ComposableConfig {
    if (slider.baseCut === 'triangular') {
        return {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: slider.jitter },
            tabGenerator: slider.tabGenerator,
            tabConfig: {},
            borderless: false,
        };
    }
    return {
        baseCutGenerator: 'sine',
        baseCutConfig: {
            ha: slider.horizontalAmplitude,
            hf: slider.horizontalFrequency,
            va: slider.verticalAmplitude,
            vf: slider.verticalFrequency,
        },
        tabGenerator: slider.tabGenerator,
        tabConfig: {},
        borderless: slider.borderless,
    };
}
```

- [ ] **Step 4: Extend the dialog config type (no UI yet)**

In `src/ui/new-game-dialog.ts`, extend `ComposableSliderConfig`:

```ts
export interface ComposableSliderConfig {
    baseCut: 'sine' | 'triangular';
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: 'classic' | 'traced' | 'none';
    borderless: boolean;
    jitter: number;
}
```

In `buildComposableSlidersSection`'s `getValues()` return, add placeholder values for the two new fields (real controls arrive in Task 3) so the shape is satisfied:

```ts
        getValues: () => ({
            baseCut: 'sine',
            horizontalAmplitude: parseFloat(sliderInputs.get('horizontalAmplitude')!.value),
            horizontalFrequency: parseFloat(sliderInputs.get('horizontalFrequency')!.value),
            verticalAmplitude: parseFloat(sliderInputs.get('verticalAmplitude')!.value),
            verticalFrequency: parseFloat(sliderInputs.get('verticalFrequency')!.value),
            tabGenerator: tabGeneratorRow.getValue(),
            borderless: borderlessCheckbox?.checked ?? false,
            jitter: 0.15,
        }),
```

- [ ] **Step 5: Rewire `main.ts` to the extracted translation**

In `src/main.ts`, delete the local `sliderConfigToGeneratorConfig` function (the `function sliderConfigToGeneratorConfig(slider: {...}) {...}` block, currently lines 183–203, including its doc comment).

Add `composableSliderToGeneratorConfig` to the existing import from `./game/composable-config.js` (or add a new import if none exists):

```ts
import { composableSliderToGeneratorConfig } from './game/composable-config.js';
```

Replace both call sites (currently the `sliderConfigToGeneratorConfig(composableConfig)` and `sliderConfigToGeneratorConfig(preferredComposable)` calls) with `composableSliderToGeneratorConfig(...)`:

```bash
# After editing, verify there are no remaining references:
grep -n "sliderConfigToGeneratorConfig" src/main.ts
# Expected: no output.
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors (the dialog and both `main.ts` call sites now agree on the `baseCut`/`jitter` fields).

- [ ] **Step 7: Commit**

```bash
git add src/game/composable-config.ts src/game/composable-config.test.ts src/ui/new-game-dialog.ts src/main.ts
git commit -m "refactor(composable): extract slider->generator translation, add baseCut/jitter"
```

---

### Task 3: Dialog UI — base-cut picker + irregularity slider

Adds the `Sine | Triangular` picker and the `Irregularity` slider to the Composable section, toggles control visibility, and returns the real selections from `getValues()`.

**Files:**
- Modify: `src/ui/new-game-dialog.ts` (`buildComposableSlidersSection`)
- Modify: `src/ui/new-game-dialog.test.ts` (UI behavior tests)

**Interfaces:**
- Consumes: `appendSegmentedRow`, `appendCheckboxRow` (module-private helpers); `ComposableSliderConfig` (now with `baseCut`/`jitter`).
- Produces: DOM controls with stable testids — base-cut radios in a row labeled `Base cut`; an `Irregularity` range input `data-testid="composable-jitter-slider"`; a sine-controls wrapper `data-testid="composable-sine-controls"`; a triangular-controls wrapper `data-testid="composable-triangular-controls"`. `getValues()` returns the selected `baseCut` and `jitter`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/new-game-dialog.test.ts` a new describe. It opens the dialog, selects the Composable cut style, switches the base cut, and checks visibility + `onSelect` payload:

```ts
describe('composable base-cut picker', () => {
    let container: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function openDialogAndSelectComposable(onSelect = vi.fn()) {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect });
        // Composable is dev-visible under vitest (import.meta.env.DEV).
        const composableBtn = Array.from(
            container.querySelectorAll<HTMLButtonElement>('.cut-style-option'),
        ).find(b => b.textContent?.toLowerCase().includes('composable'));
        composableBtn!.click();
        return onSelect;
    }

    it('shows sine controls and hides triangular controls by default', () => {
        openDialogAndSelectComposable();
        const sine = container.querySelector<HTMLElement>('[data-testid="composable-sine-controls"]')!;
        const tri = container.querySelector<HTMLElement>('[data-testid="composable-triangular-controls"]')!;
        expect(sine.style.display).not.toBe('none');
        expect(tri.style.display).toBe('none');
    });

    it('reveals the irregularity slider when triangular is picked', () => {
        openDialogAndSelectComposable();
        const triRadio = container.querySelector<HTMLInputElement>(
            'input[type="radio"][value="triangular"]',
        )!;
        triRadio.click();
        const sine = container.querySelector<HTMLElement>('[data-testid="composable-sine-controls"]')!;
        const tri = container.querySelector<HTMLElement>('[data-testid="composable-triangular-controls"]')!;
        expect(sine.style.display).toBe('none');
        expect(tri.style.display).not.toBe('none');
        expect(container.querySelector('[data-testid="composable-jitter-slider"]')).not.toBeNull();
    });

    it('reports baseCut + jitter through onSelect', () => {
        const onSelect = openDialogAndSelectComposable();
        container.querySelector<HTMLInputElement>('input[type="radio"][value="triangular"]')!.click();
        const jitter = container.querySelector<HTMLInputElement>('[data-testid="composable-jitter-slider"]')!;
        jitter.value = '0.3';
        jitter.dispatchEvent(new Event('input'));
        // Pick a size to fire onSelect.
        container.querySelectorAll<HTMLButtonElement>('.size-picker-option')[0].click();
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                cutStyleId: 'composable',
                composableConfig: expect.objectContaining({ baseCut: 'triangular', jitter: 0.3 }),
            }),
        );
    });
});
```

NOTE: confirm the cut-style button selector. If `.cut-style-option` does not match, inspect the rendered DOM in `cut-style-picker.ts` and use the actual class. The size-option selector `.size-picker-option` is confirmed from existing tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — the testid elements and the `triangular` radio do not exist yet.

- [ ] **Step 3: Implement the picker + slider + visibility**

In `buildComposableSlidersSection` (`src/ui/new-game-dialog.ts`), restructure so the four sine sliders go into a wrapper, add the base-cut picker at the top, and add the triangular wrapper.

Right after `section.className = 'composable-sliders';`, add the base-cut picker and wrappers:

```ts
    const sineControls = document.createElement('div');
    sineControls.dataset.testid = 'composable-sine-controls';

    const triangularControls = document.createElement('div');
    triangularControls.dataset.testid = 'composable-triangular-controls';

    const baseCutRow = appendSegmentedRow<'sine' | 'triangular'>(
        section,
        'Base cut',
        [
            { value: 'sine', label: 'Sine' },
            { value: 'triangular', label: 'Triangular' },
        ],
        args.saved?.baseCut ?? 'sine',
        (value) => applyBaseCutVisibility(value),
    );
```

Change the slider loop so rows append to `sineControls` instead of `section` (replace `section.appendChild(row);` inside the `for (const def of sliderDefs)` loop with `sineControls.appendChild(row);`), and append the wrapper after the loop:

```ts
    section.appendChild(sineControls);
```

Add the irregularity slider into `triangularControls` (place this after the sine slider loop, before the Tab style row):

```ts
    const jitterRow = document.createElement('div');
    jitterRow.className = 'dialog-row';
    const jitterLabel = document.createElement('label');
    jitterLabel.className = 'dialog-row-label';
    jitterLabel.textContent = 'Irregularity';
    const jitterValue = document.createElement('span');
    jitterValue.className = 'dialog-row-value';
    const jitterInput = document.createElement('input');
    jitterInput.type = 'range';
    jitterInput.className = 'dialog-row-input';
    jitterInput.dataset.testid = 'composable-jitter-slider';
    jitterInput.min = '0';
    jitterInput.max = '0.5';
    jitterInput.step = '0.01';
    jitterInput.value = String(args.saved?.jitter ?? 0.15);
    jitterValue.textContent = jitterInput.value;
    jitterInput.addEventListener('input', () => { jitterValue.textContent = jitterInput.value; });
    jitterRow.appendChild(jitterLabel);
    jitterRow.appendChild(jitterInput);
    jitterRow.appendChild(jitterValue);
    triangularControls.appendChild(jitterRow);
    section.appendChild(triangularControls);
```

Keep the existing Tab style row (shared). For Borderless, capture its row so it can be hidden for triangular. Replace the existing borderless block with one that appends into a wrapper:

```ts
    const borderlessWrap = document.createElement('div');
    section.appendChild(borderlessWrap);
    const borderlessCheckbox = args.showBorderless
        ? appendCheckboxRow(borderlessWrap, 'Borderless', args.saved?.borderless ?? false)
        : null;
    if (borderlessCheckbox) borderlessCheckbox.dataset.testid = 'composable-borderless-toggle';
```

Add the visibility helper (place it above the `return`, after all controls are created):

```ts
    function applyBaseCutVisibility(baseCut: 'sine' | 'triangular'): void {
        const tri = baseCut === 'triangular';
        sineControls.style.display = tri ? 'none' : 'block';
        triangularControls.style.display = tri ? 'block' : 'none';
        borderlessWrap.style.display = tri ? 'none' : 'block';
    }
    applyBaseCutVisibility(args.saved?.baseCut ?? 'sine');
```

Update `getValues()` to read the real controls (replace the Task 2 placeholders):

```ts
        getValues: () => ({
            baseCut: baseCutRow.getValue(),
            horizontalAmplitude: parseFloat(sliderInputs.get('horizontalAmplitude')!.value),
            horizontalFrequency: parseFloat(sliderInputs.get('horizontalFrequency')!.value),
            verticalAmplitude: parseFloat(sliderInputs.get('verticalAmplitude')!.value),
            verticalFrequency: parseFloat(sliderInputs.get('verticalFrequency')!.value),
            tabGenerator: tabGeneratorRow.getValue(),
            borderless: baseCutRow.getValue() === 'sine' ? (borderlessCheckbox?.checked ?? false) : false,
            jitter: parseFloat(jitterInput.value),
        }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: PASS. If the cut-style selector was wrong, fix the selector in the test per the NOTE in Step 1 and re-run.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat(composable): triangular base-cut picker + irregularity slider in new-game dialog"
```

---

### Task 4: Share-link round-trip regression test

The share-link `bgc` is a generic passthrough, so triangular already round-trips. Add a focused test that locks in the contract.

**Files:**
- Modify: `src/sharing/share-link.test.ts`

- [ ] **Step 1: Write the test**

Add near the other "round-trips composable config" tests in `src/sharing/share-link.test.ts`:

```ts
    it('round-trips a triangular composable config', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'none',
            cf: {
                bg: 'triangular',
                bgc: { jitter: 0.3 },
                tg: 'classic',
                tgc: {},
            },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/sharing/share-link.test.ts
git commit -m "test(sharing): lock triangular base-cut share-link round-trip"
```

---

### Task 5: Full test suite + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite + lint + typecheck**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green. (If `npm run lint` is not defined, skip it; check `package.json` scripts.)

- [ ] **Step 2: Manual verification in the app**

Use the `verify` (or `run`) skill, or start the dev server (`npm run dev`) and:
1. Open the new-game dialog, choose the **Composable** cut style.
2. Switch **Base cut** to **Triangular**; confirm the sine sliders + Borderless disappear and the **Irregularity** slider appears.
3. Start a puzzle at two sizes (e.g. 24 and 96 pieces); confirm triangular pieces render, border pieces are partial triangles, and the frame is fully covered.
4. Set Irregularity to 0 (regular) and to ~0.4 (organic); confirm the difference.
5. Reload to confirm the autosaved puzzle restores identically (PRNG reproducibility), and that a copied share link reproduces the same triangular cuts.

Alternatively, drive it from the dev console:

```js
__newComposableGame({ baseCutGenerator: 'triangular', baseCutConfig: { jitter: 0.3 }, cols: 8, rows: 6 })
```

- [ ] **Step 3: Final review commit (if any verification fixes were needed)**

Commit any fixes discovered during verification with an appropriate message.

---

## Self-Review

**Spec coverage:**
- Equilateral/isometric geometry, per-edge lattice, clip-to-frame, partial border triangles → Task 1.
- Border-first contract, no-overlap rule (skip rows 0/`rows` horizontals), `supportsBorderless` falsy → Task 1.
- One-outer-PRNG-call sub-PRNG, jitter via local stream, border-inset no-jitter → Task 1 (impl + tests).
- `rows` from size grid (injected by topology generator), `jitter` config → Task 1 (config) + Task 3 (slider).
- Base-cut picker + irregularity slider + visibility toggling → Task 3.
- `ComposableSliderConfig`/`ComposableSliderPreference` `baseCut`+`jitter`, translation branch → Task 2.
- Share-link/save round-trip (generic passthrough) → Task 4 (regression test); save persistence via extended preference → Task 2.
- No info-modal change → honored (no task; documented in Global Constraints).
- Tabs reuse existing Tab style row, fallback-to-flat acceptable → no code; Tab style row untouched in Task 3.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only conditional instruction (cut-style button selector in Task 3 Step 1) has an explicit fallback procedure.

**Type consistency:** `composableSliderToGeneratorConfig(slider: ComposableSliderPreference)` is fed `ComposableSliderConfig` values from the dialog; both carry `baseCut`, `jitter`, the four sine sliders, `tabGenerator`, `borderless` after Tasks 2–3, so the shapes are structurally compatible. `TriangularCutConfig { rows, jitter }` matches the `{ jitter }` emitted by the translation plus the `rows` injected by `generateTopologyPuzzle`. Generator id string `'triangular'` is consistent across generator, registry, translation, and share-link tests.
