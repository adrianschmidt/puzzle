# Traced Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `traced` TabGenerator that draws from a JSON library of
real-photographed puzzle-tab Bezier paths, exposed dev-only via a new
"Tab style" segmented control in the Composable section of the new-game
dialog. Reference spec: `docs/superpowers/specs/2026-05-22-traced-tabs-design.md`.

**Architecture:** A new `tracedTabTemplate` reads from a curated library of
JSON traces under `src/puzzle/composable/traces/` and applies six PRNG-driven
transforms (template pick, x-flip, scale-x, scale-y, lateral shift,
neck pinch). Placement/preparation helpers move out of `classic-tab-generator.ts`
into a shared `tab-generator-helpers.ts`. A new `tracedTabGenerator` uses
them. The existing "Disable tabs" checkbox is replaced by a three-way
segmented control (Classic / Traced / None) backed by a new
`tabGenerator: 'classic' | 'traced' | 'none'` field on
`ComposableSliderConfig` and `ComposableSliderPreference`. Read-side
migration maps legacy `disableTabs: true` → `tabGenerator: 'none'`.

**Tech Stack:** TypeScript + Vite + Vitest; Python 3 + OpenCV + Potrace
(offline CLI). The Python CLI is promoted from the existing `spike/tab-tracing`
branch (`spike/tab-tracing/spike.py`, 1352 lines).

**PRNG contract:** Per [[project_share_link_prng_contract]], the exact PRNG
call order matters. The classic helper extraction (Phase B) is a refactor —
it MUST NOT alter classic's PRNG consumption or output. The traced generator
(Phase C) defines a new PRNG order; once shipped, that order is locked.

---

## File-level plan

### New files
- `src/puzzle/composable/tab-shapes-traced.ts` — `tracedTabTemplate`, `pinchNeck`, types.
- `src/puzzle/composable/tab-shapes-traced.test.ts` — unit tests.
- `src/puzzle/composable/traces/index.ts` — barrel; exports `TRACED_TEMPLATES`.
- `src/puzzle/composable/traces/index.test.ts` — library schema validation.
- `src/puzzle/composable/traces/tab-01-spike-screenshot.json` — initial trace (port from spike).
- `src/puzzle/topology/tab-generator-helpers.ts` — extracted helpers.
- `src/puzzle/topology/tab-generator-helpers.test.ts` — refactor regression tests.
- `src/puzzle/topology/traced-tab-generator.ts` — the new generator.
- `src/puzzle/topology/traced-tab-generator.test.ts` — generator integration tests.
- `tools/trace-tab/main.py` — CLI (promoted from spike).
- `tools/trace-tab/requirements.txt`
- `tools/trace-tab/README.md`
- `tools/trace-tab/tests/test_smoke.py` — algorithm-regression smoke test.

### Modified files
- `src/puzzle/topology/classic-tab-generator.ts` — thin wrapper using shared helpers.
- `src/puzzle/topology/classic-tab-generator.test.ts` — add fixed-seed snapshot test before refactor.
- `src/puzzle/topology/generator-registry.ts` — register `tracedTabGenerator`.
- `src/puzzle/topology/generator-registry.test.ts` — assert `traced` is registered.
- `src/ui/new-game-dialog.ts` — segmented control replaces checkbox; widen `ComposableSliderConfig`.
- `src/game/composable-config.ts` — widen `ComposableSliderPreference`; read-side migration.
- `src/game/composable-config.test.ts` — legacy-load + round-trip tests.
- `src/main.ts` — `sliderConfigToGeneratorConfig` uses new field.
- `src/persistence/serialization.ts` — keep legacy `disableTabs` branch; nothing else changes (already maps to `'none'`/`'classic'`).
- `src/sharing/share-link.ts` — no schema change (`cf.tg` already a `string`); accept `'traced'` like any other id.
- `src/sharing/share-link.test.ts` — add `tg = 'traced'` round-trip + legacy `dt: true` decode test (the latter already passes; add explicit assertion).
- `spike/` directory — left alone (lives on `spike/tab-tracing` branch; main has no `spike/` directory).

### Deleted code (no whole-file deletes)
- `disableTabs` field on `ComposableSliderConfig` and `ComposableSliderPreference`.
- `DEFAULT_DISABLE_TABS` export from `compose.ts` (only used by the dialog).
  Per [[feedback_keep_old_save_migrations]], the legacy *read-path* branches
  in `share-link.ts:translateLegacyComposable`, `serialization.ts:migrateLegacyComposableConfig`,
  and the new `parseComposableConfig` migration ARE PRESERVED.

---

## Phases

The plan is split into four phases so the work can ship incrementally:

- **Phase A** — Python CLI promotion + initial JSON trace. Produces the
  first library entry but doesn't touch the runtime code.
- **Phase B** — Pure refactor: extract helpers from `classic-tab-generator.ts`
  into `tab-generator-helpers.ts`. Locks in classic's pre-refactor PRNG output
  with a snapshot test before the move.
- **Phase C** — New `tracedTabTemplate`, `tracedTabGenerator`, library
  barrel, and registration. End-to-end traced-tab generation works under
  test, but no UI yet.
- **Phase D** — UI segmented control, config field rename, migration,
  share-link test. Feature is now player-reachable on dev deploys.

Each phase ends with a commit (or a small chain of commits) and produces a
working tree where all tests pass.

---

## Phase A: Python CLI + initial trace

### Task A1: Port spike.py from the spike branch and lay out the tool

**Files:**
- Create: `tools/trace-tab/main.py` (port of `spike/tab-tracing/spike.py` from the `spike/tab-tracing` branch)
- Create: `tools/trace-tab/requirements.txt`
- Create: `tools/trace-tab/README.md`
- Create: `tools/trace-tab/.gitignore`

- [ ] **Step 1: Fetch the spike file from its branch**

The spike code lives on the `spike/tab-tracing` branch (not on main).
Bring the file in without switching branches:

```bash
git show spike/tab-tracing:spike/tab-tracing/spike.py > tools/trace-tab/main.py
```

Verify roughly: `wc -l tools/trace-tab/main.py` should print **1352 lines**.

- [ ] **Step 2: Write `tools/trace-tab/requirements.txt`**

```
opencv-python>=4.8
numpy>=1.24
matplotlib>=3.7
```

Potrace is a binary, installed separately (`brew install potrace` on macOS).

- [ ] **Step 3: Write `tools/trace-tab/.gitignore`**

```
__pycache__/
*.pyc
/out/
/scratch/
```

- [ ] **Step 4: Write `tools/trace-tab/README.md`**

```markdown
# trace-tab — extract puzzle-tab Bezier paths from photos

Offline pipeline that turns a cropped photograph of a single puzzle tab
into a normalized cubic-Bezier path JSON, suitable for committing into
`src/puzzle/composable/traces/`.

## Setup

```bash
brew install potrace                              # macOS; apt-get on Linux
conda create -n trace-tab python=3.11 -y
conda activate trace-tab
pip install -r tools/trace-tab/requirements.txt
```

## Use

```bash
python tools/trace-tab/main.py photos/tab-12.jpg \
    --id tab-12-blue-cat \
    --notes "blue cat puzzle, top edge" \
    --out src/puzzle/composable/traces/
```

Writes:

- `src/puzzle/composable/traces/tab-12-blue-cat.json`
- `src/puzzle/composable/traces/tab-12-blue-cat-review.png`

## Photo conventions

- Cropped so the neck endpoints fall on the left and right image edges.
- Tab protrudes upward in the photo (Potrace's polarity detection handles
  light-on-dark vs dark-on-light automatically).
- Good lighting, minimal glare. If glare confuses the trace, reshoot.

## Manual acceptance gate

Eyeball the `*-review.png` before committing the JSON. If neck endpoints,
chord, or refit curve look wrong, discard.
```

- [ ] **Step 5: Commit**

```bash
git add tools/trace-tab/
git commit -m "$(cat <<'EOF'
feat(tools): import trace-tab CLI from spike branch

Port the validated tab-tracing pipeline from spike/tab-tracing into
tools/trace-tab/ so it can be used to add JSON traces to the library.
The file is committed verbatim from the spike — Task A2 reshapes it for
production use.
EOF
)"
```

---

### Task A2: Slim main.py to the per-trace workflow

**Files:**
- Modify: `tools/trace-tab/main.py`

The spike file mixes the per-trace pipeline with the synthetic round-trip
test code, the preprocessing sweep, and exploratory plotting. For the
production CLI we keep only:

1. CLI arg parsing.
2. The cropped-photo neck detection path (the spike's concavity-based path
   is dropped; if a future trace needs it, re-introduce behind a flag).
3. Otsu preprocessing.
4. Potrace at `alphamax=0.5`.
5. Largest-subpath selection.
6. `find_edge_anchors()`.
7. `tab_arc_between_anchors()` with the perpendicular-bulge tiebreaker.
8. Normalize to (0,0)→(1,0).
9. Schneider refit at `1% chord tolerance`.
10. `analyze_tab_shape()` for landmarks.
11. Write `<id>.json` and `<id>-review.png`.

- [ ] **Step 1: Inventory what the spike file exports**

Skim `tools/trace-tab/main.py`. Identify (by function name) which entry
points belong to the per-trace pipeline vs the spike-only experimentation
helpers. The spike's `__main__` block runs synthetic + real photos in
sequence; we'll replace it with a single per-photo invocation.

- [ ] **Step 2: Rewrite the CLI**

Replace the spike's hard-coded `__main__` with `argparse`:

```python
def main() -> int:
    parser = argparse.ArgumentParser(
        prog='trace-tab',
        description='Trace a cropped puzzle-tab photo into a normalized cubic-Bezier JSON.',
    )
    parser.add_argument('photo', help='Path to the cropped tab photo.')
    parser.add_argument('--id', required=True,
                        help='Trace id, used as the output filename stem (e.g. tab-12-blue-cat).')
    parser.add_argument('--out', default='src/puzzle/composable/traces/',
                        help='Output directory for the JSON and review PNG.')
    parser.add_argument('--notes', default='',
                        help='Free-text note saved into source.notes.')
    parser.add_argument('--alphamax', type=float, default=0.5,
                        help='Potrace alphamax (corner threshold).')
    parser.add_argument('--refit-tol', type=float, default=0.01,
                        help='Schneider refit tolerance as fraction of chord length.')
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = trace_photo(
        photo_path=Path(args.photo),
        alphamax=args.alphamax,
        refit_tol_chord_frac=args.refit_tol,
    )

    today = datetime.date.today().isoformat()
    payload = {
        'id': args.id,
        'source': {
            'photo': Path(args.photo).name,
            'captured': today,
            **({'notes': args.notes} if args.notes else {}),
        },
        'path': result.path,
        'landmarks': result.landmarks,
    }

    json_path = out_dir / f'{args.id}.json'
    review_path = out_dir / f'{args.id}-review.png'
    json_path.write_text(json.dumps(payload, indent=2) + '\n')
    write_review_png(review_path, result)
    print(f'wrote {json_path}')
    print(f'wrote {review_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

`trace_photo()` is the orchestrator wrapping the spike's per-photo
pipeline. `write_review_png()` is the existing overlay-rendering helper
in the spike, renamed and called once.

- [ ] **Step 3: Delete spike-only code**

Remove from `main.py` any code that:
- Synthesizes the reference tab (the `classic_tab()` Python port and
  `sample_bezier_path()` if they are only used by the synthetic test).
- Runs the preprocessing sweep (the multi-variant loop).
- Falls back to concavity-based neck detection (keep only the
  cropped-photo `find_edge_anchors()` path).
- Was wired into the spike's `__main__` to process all four real photos
  in a loop.

Keep utility helpers (`parse_potrace_svg`, `subpath_to_segments`,
`schneider_fit`, `analyze_tab_shape`, etc.) — they're load-bearing.

- [ ] **Step 4: Verify the CLI runs on one shipped photo**

The spike photos live on the `spike/tab-tracing` branch. Copy one out
temporarily for verification:

```bash
git show spike/tab-tracing:spike/tab-tracing/photos/01-screenshot.png > /tmp/screenshot.png
python tools/trace-tab/main.py /tmp/screenshot.png \
    --id tab-01-spike-screenshot \
    --notes "Synthetic screenshot from app" \
    --out /tmp/trace-test
ls /tmp/trace-test/
```

Expected: two files, `tab-01-spike-screenshot.json` and
`tab-01-spike-screenshot-review.png`. Open the review PNG and confirm
trace ≈ photo silhouette.

- [ ] **Step 5: Commit**

```bash
git add tools/trace-tab/main.py
git commit -m "$(cat <<'EOF'
refactor(tools): reshape trace-tab into per-trace CLI

Strip the spike's experimentation paths and reshape into a single
photo → JSON + review-PNG pipeline driven by argparse. The cropped-photo
neck-detection convention is the only supported mode for now.
EOF
)"
```

---

### Task A3: Add the first JSON trace to the library

**Files:**
- Create: `src/puzzle/composable/traces/` (new directory)
- Create: `src/puzzle/composable/traces/tab-01-spike-screenshot.json`

- [ ] **Step 1: Run the CLI against the validated spike screenshot**

```bash
mkdir -p src/puzzle/composable/traces
python tools/trace-tab/main.py /tmp/screenshot.png \
    --id tab-01-spike-screenshot \
    --notes "Synthetic screenshot from app (initial library seed)" \
    --out src/puzzle/composable/traces/
```

- [ ] **Step 2: Inspect the review PNG**

Open `src/puzzle/composable/traces/tab-01-spike-screenshot-review.png`.
The refit (red) should hug the contour (blue) closely and the neck
endpoints should sit on the photo's left/right edges.

If it looks wrong, do NOT commit. Re-shoot or adjust thresholds first.

- [ ] **Step 3: Move the review PNG out of the library directory**

Review PNGs are debugging output; they don't belong next to the JSON the
runtime imports. Move the PNG to the spike out folder or delete it:

```bash
rm src/puzzle/composable/traces/tab-01-spike-screenshot-review.png
```

(A future Task tightens the CLI to write the review PNG to a sibling
`out/` directory; for now we just delete.)

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/composable/traces/tab-01-spike-screenshot.json
git commit -m "$(cat <<'EOF'
feat(traces): add initial spike-screenshot trace to library

First JSON entry seeds the traced-tab library so the new generator can
ship with at least one shape. Subsequent traces are added one PR per
photo from physical puzzles.
EOF
)"
```

---

## Phase B: Extract helpers from classic-tab-generator.ts

### Task B1: Snapshot classic's PRNG output before the move

This is the PRNG-contract guard rail. We capture classic's output for a
known seed, then assert it doesn't drift after we move the helpers.

**Files:**
- Modify: `src/puzzle/topology/classic-tab-generator.test.ts`

- [ ] **Step 1: Read the existing test file**

```bash
sed -n '1,120p' src/puzzle/topology/classic-tab-generator.test.ts
```

Note the existing imports and helper functions so the new test fits.

- [ ] **Step 2: Add a fixed-seed snapshot test**

Append to `classic-tab-generator.test.ts`:

```typescript
import { createSeededRandom } from '../seeded-random.js';

describe('classicTabGenerator (PRNG snapshot)', () => {
    it('produces a deterministic curve for a fixed seed and edge', () => {
        const random = createSeededRandom(0xC1A551C); // arbitrary, but stable
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });

        const result = classicTabGenerator.generate(edge, random, {});
        expect(result).not.toBeNull();

        // Flatten to numeric arrays so toMatchInlineSnapshot stays readable.
        const points = result!.segments.flatMap(seg =>
            [seg.p0, seg.p1, seg.p2, seg.p3]
                .map(p => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000])
        );

        expect(points).toMatchInlineSnapshot();
    });
});
```

- [ ] **Step 3: Run the test once to fill in the snapshot**

```bash
npx vitest run src/puzzle/topology/classic-tab-generator.test.ts -u
```

Expected: the test passes; the empty `toMatchInlineSnapshot()` is now
populated with the actual numbers.

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/topology/classic-tab-generator.test.ts
git commit -m "$(cat <<'EOF'
test(classic-tab-generator): pin PRNG-driven output with snapshot

Captures the exact numeric output for a fixed seed so the upcoming
helper-extraction refactor can't silently drift the curve geometry or
PRNG call order (project_share_link_prng_contract).
EOF
)"
```

---

### Task B2: Move helpers into `tab-generator-helpers.ts`

**Files:**
- Create: `src/puzzle/topology/tab-generator-helpers.ts`
- Modify: `src/puzzle/topology/classic-tab-generator.ts`

The helpers being moved are:

- `TabPlacementConfig` (currently private)
- `DEFAULT_TAB_PLACEMENT`
- `PreparedTab`
- `prepareTab`
- `commitTab`
- `computeTabPlacement`
- `joinCurves`
- `transformTabToEdge`
- The file-private `lerp` (move alongside)

All of these are template-agnostic — `prepareTab` already takes a
`TabTemplate` parameter.

- [ ] **Step 1: Create `tab-generator-helpers.ts` with the moved code**

Create the file with this header and exported declarations. Function
**bodies** are a verbatim copy of the existing code in
`classic-tab-generator.ts` — the line ranges to copy are listed below
the scaffold. Do not modify the bodies; the PRNG contract requires
byte-for-byte equivalence.

```typescript
/**
 * Tab placement / preparation primitives shared by all template-based
 * tab generators (classic, traced).
 *
 * The helpers know nothing about which template they're using — they
 * take a TabTemplate via parameter and produce a transformed, spliced
 * curve.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { BezierPath } from '../composable/bezier-path.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';

export interface TabPlacementConfig {
    minEdgeLength: number;
    centreRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 20,
    centreRange: [0.3, 0.7],
};

export interface PreparedTab {
    tabCurve: Curve;
    before: Curve;
    after: Curve;
}

export function computeTabPlacement(
    curve: Curve,
    config: TabPlacementConfig,
    random: () => number,
): { tCenter: number; isTab: boolean } | null {
    // body: copy from classic-tab-generator.ts lines 211-226 (the body
    // inside the existing `computeTabPlacement` definition).
}

export function prepareTab(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): PreparedTab | null {
    // body: copy from classic-tab-generator.ts lines 81-191 (the body
    // inside the existing `prepareTab` definition).
}

export function commitTab(prepared: PreparedTab): Curve {
    return joinCurves([prepared.before, prepared.tabCurve, prepared.after]);
}

function joinCurves(curves: Curve[]): Curve {
    // body: copy from classic-tab-generator.ts lines 233-248 (the body
    // inside the existing `joinCurves` definition).
}

function transformTabToEdge(
    path: BezierPath,
    pLeft: Point,
    pRight: Point,
    edgeLength: number,
): BezierPath {
    // body: copy from classic-tab-generator.ts lines 271-305 (the body
    // inside the existing `transformTabToEdge` definition).
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
```

The line numbers above refer to the file **as it exists on `main`
before this task starts**; if they've drifted, locate the functions by
name and copy each entire `{ … }` block verbatim.

- [ ] **Step 2: Slim `classic-tab-generator.ts`**

The whole file becomes:

```typescript
/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts using the shared tab-generator helpers.
 */

import type { Curve } from './curve.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const classicTabGenerator: TabGenerator = {
    id: 'classic',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, classicTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};
```

- [ ] **Step 3: Run the snapshot test from Task B1**

```bash
npx vitest run src/puzzle/topology/classic-tab-generator.test.ts
```

Expected: PASS. If it FAILS with snapshot diff, something drifted —
revert and investigate. Do NOT update the snapshot.

- [ ] **Step 4: Run the broader test suite**

```bash
npx vitest run src/puzzle/topology/
```

Expected: PASS across all topology tests. The `generator.test.ts`
fixed-seed integration tests double as a second guard rail here.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/classic-tab-generator.ts src/puzzle/topology/tab-generator-helpers.ts
git commit -m "$(cat <<'EOF'
refactor(topology): extract tab placement helpers to shared module

The placement, preparation, and commit primitives are template-agnostic
and will be reused by the upcoming traced-tab generator. Move them into
tab-generator-helpers.ts; classic-tab-generator.ts becomes a thin wiring
between the registry and classicTabTemplate.

No behavior change — the existing fixed-seed snapshot test verifies the
PRNG output matches byte-for-byte.
EOF
)"
```

---

### Task B3: Tiny unit tests for the extracted helpers

**Files:**
- Create: `src/puzzle/topology/tab-generator-helpers.test.ts`

These are not exhaustive — the existing `classic-tab-generator.test.ts`
covers the integration path. We add a single test per helper to lock the
exported signatures.

- [ ] **Step 1: Write the helper tests**

```typescript
import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { createSeededRandom } from '../seeded-random.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

describe('computeTabPlacement', () => {
    it('returns null for edges shorter than minEdgeLength * 1.5', () => {
        const random = createSeededRandom(1);
        const shortEdge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(computeTabPlacement(shortEdge, DEFAULT_TAB_PLACEMENT, random)).toBeNull();
    });

    it('returns tCenter and isTab for a long edge', () => {
        const random = createSeededRandom(1);
        const longEdge = Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 });
        const placement = computeTabPlacement(longEdge, DEFAULT_TAB_PLACEMENT, random);
        expect(placement).not.toBeNull();
        expect(placement!.tCenter).toBeGreaterThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[0]);
        expect(placement!.tCenter).toBeLessThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[1]);
        expect(typeof placement!.isTab).toBe('boolean');
    });
});

describe('prepareTab + commitTab', () => {
    it('produces a curve whose start and end match the input edge', () => {
        const random = createSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const prepared = prepareTab(edge, 0.5, true, classicTabTemplate, random);
        expect(prepared).not.toBeNull();
        const result = commitTab(prepared!);
        expect(result.start.x).toBeCloseTo(edge.start.x);
        expect(result.start.y).toBeCloseTo(edge.start.y);
        expect(result.end.x).toBeCloseTo(edge.end.x);
        expect(result.end.y).toBeCloseTo(edge.end.y);
    });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/tab-generator-helpers.test.ts
git commit -m "$(cat <<'EOF'
test(topology): cover exported tab-generator helpers

Minimal smoke tests pin the public signatures of the extracted helpers
so future refactors notice if the contract changes. Integration
coverage continues to live in classic-tab-generator.test.ts.
EOF
)"
```

---

## Phase C: Traced template + generator + library wiring

### Task C1: Define the trace JSON shape and barrel index

**Files:**
- Create: `src/puzzle/composable/traces/index.ts`
- Create: `src/puzzle/composable/traces/index.test.ts`

- [ ] **Step 1: Write `traces/index.ts`**

```typescript
/**
 * Library of traced puzzle-tab Bezier paths.
 *
 * Each JSON file is produced by tools/trace-tab/ from a real photograph.
 * One file per trace gives readable diffs when traces are added or
 * replaced.
 */

import type { Point } from '../../../model/types.js';
import tab01 from './tab-01-spike-screenshot.json' assert { type: 'json' };

export interface TracedLandmarks {
    /** Y of the highest point of the tab, normalized to chord length. */
    apex_y: number;
    /** Widest point of the head. */
    head: { y: number; width: number; center_x: number };
    /** Narrowest point of the neck. */
    neck: { y: number; width: number; center_x: number };
}

export interface TracedTemplate {
    /** Stable identifier, used as filename stem. */
    id: string;
    source: {
        photo: string;
        captured: string;
        notes?: string;
    };
    /**
     * BezierPath in normalized neck-frame: starts at (0,0), ends at (1,0),
     * protrudes in +Y. Flat array, length 3n+1 for n cubic segments.
     */
    path: readonly Point[];
    landmarks: TracedLandmarks;
}

export const TRACED_TEMPLATES: readonly TracedTemplate[] = [
    tab01 as TracedTemplate,
] as const;
```

Note: if Vite's TS settings don't allow the `assert { type: 'json' }`
import attribute, fall back to `import tab01 from './tab-01-spike-screenshot.json';`
with `resolveJsonModule: true` (which `tsconfig.json` should already have —
verify by reading `tsconfig.json` and either removing the assertion or
adjusting types).

- [ ] **Step 2: Write the schema validation test**

`traces/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TRACED_TEMPLATES } from './index.js';

describe('traced template library', () => {
    it('contains at least one trace', () => {
        expect(TRACED_TEMPLATES.length).toBeGreaterThan(0);
    });

    for (const template of TRACED_TEMPLATES) {
        describe(template.id, () => {
            it('has a path with length 3n+1 for n ≥ 1 cubic segments', () => {
                expect(template.path.length).toBeGreaterThanOrEqual(4);
                expect((template.path.length - 1) % 3).toBe(0);
            });

            it('starts at (0, 0) and ends at (1, 0) within tolerance', () => {
                const first = template.path[0];
                const last = template.path[template.path.length - 1];
                expect(first.x).toBeCloseTo(0, 3);
                expect(first.y).toBeCloseTo(0, 3);
                expect(last.x).toBeCloseTo(1, 3);
                expect(last.y).toBeCloseTo(0, 3);
            });

            it('has all landmark fractions inside [0, 1]', () => {
                const lm = template.landmarks;
                for (const v of [
                    lm.apex_y,
                    lm.head.y, lm.head.width, lm.head.center_x,
                    lm.neck.y, lm.neck.width, lm.neck.center_x,
                ]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                }
            });

            it('has neck below head', () => {
                expect(template.landmarks.neck.y).toBeLessThan(template.landmarks.head.y);
            });
        });
    }
});
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/puzzle/composable/traces/index.test.ts
```

Expected: PASS — the tab-01 JSON from Phase A satisfies all the assertions.
If it doesn't, the CLI output is malformed; fix the CLI and re-run, don't
relax the test.

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/composable/traces/index.ts src/puzzle/composable/traces/index.test.ts
git commit -m "$(cat <<'EOF'
feat(traces): add library barrel and schema-validation tests

Bundles the per-trace JSON files into a TRACED_TEMPLATES array consumed
by the traced-tab generator. The schema test catches malformed entries
at CI time before they reach the runtime.
EOF
)"
```

---

### Task C2: Build `tracedTabTemplate`

**Files:**
- Create: `src/puzzle/composable/tab-shapes-traced.ts`

This implements the PRNG-locked transform pipeline from the spec.

- [ ] **Step 1: Write `tab-shapes-traced.ts`**

```typescript
/**
 * Traced tab shape template — pulls cubic-Bezier paths from a
 * photographed library and applies six PRNG-driven transforms.
 *
 * PRNG call order LOCKED. See project_share_link_prng_contract.
 */

import type { Point } from '../../model/types.js';
import type { BezierPath } from './bezier-path.js';
import type { TabTemplate } from './tab-shapes.js';
import {
    TRACED_TEMPLATES,
    type TracedLandmarks,
    type TracedTemplate,
} from './traces/index.js';

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function mirrorLandmarksX(lm: TracedLandmarks): TracedLandmarks {
    return {
        apex_y: lm.apex_y,
        head: { y: lm.head.y, width: lm.head.width, center_x: 1 - lm.head.center_x },
        neck: { y: lm.neck.y, width: lm.neck.width, center_x: 1 - lm.neck.center_x },
    };
}

/**
 * Smooth bump that's 0 at y=0, peaks at y=neck.y, 0 at y=head.y, 0 above.
 * Uses two smoothstep ramps glued at the neck peak.
 */
function neckWeight(y: number, neckY: number, headY: number): number {
    if (y <= 0 || y >= headY) return 0;
    if (y < neckY) {
        const t = y / neckY; // 0 → 1
        return t * t * (3 - 2 * t);
    } else {
        const t = (headY - y) / (headY - neckY); // 1 at neck.y → 0 at head.y
        return t * t * (3 - 2 * t);
    }
}

function pivotX(y: number, lm: TracedLandmarks): number {
    if (y <= 0) return 0.5;
    if (y <= lm.neck.y) {
        return lerp(0.5, lm.neck.center_x, y / lm.neck.y);
    }
    if (y <= lm.head.y) {
        const t = (y - lm.neck.y) / (lm.head.y - lm.neck.y);
        return lerp(lm.neck.center_x, lm.head.center_x, t);
    }
    return lm.head.center_x;
}

function pinchNeck(
    p: Point,
    lm: TracedLandmarks,
    neckScale: number,
): Point {
    const w = neckWeight(p.y, lm.neck.y, lm.head.y);
    const px = pivotX(p.y, lm);
    const k = lerp(1.0, neckScale, w);
    return { x: px + (p.x - px) * k, y: p.y };
}

export const tracedTabTemplate: TabTemplate = {
    name: 'Traced',

    generate(random: () => number): BezierPath {
        // PRNG call order — LOCKED. See project_share_link_prng_contract.
        const idx       = Math.floor(random() * TRACED_TEMPLATES.length);  // 1
        const flip      = random() < 0.5;                                  // 2
        const scalex    = lerp(0.85, 1.05, random());                      // 3
        const scaley    = lerp(0.85, 1.05, random());                      // 4
        const mid       = lerp(0.45, 0.55, random());                      // 5
        const neckScale = lerp(0.75, 1.10, random());                      // 6

        const template: TracedTemplate = TRACED_TEMPLATES[idx];
        let path: Point[] = template.path.map(p => ({ x: p.x, y: p.y }));
        let landmarks = template.landmarks;

        if (flip) {
            path = path.map(p => ({ x: 1 - p.x, y: p.y }));
            landmarks = mirrorLandmarksX(landmarks);
        }

        // Pinch neck (uses pre-shift landmarks).
        path = path.map(p => pinchNeck(p, landmarks, neckScale));

        // Lateral shift + uniform scale around (mid, 0).
        path = path.map(p => ({
            x: mid + (p.x - 0.5) * scalex,
            y: p.y * scaley,
        }));

        return path;
    },
};
```

- [ ] **Step 2: Run the type checker**

```bash
npx tsc --noEmit
```

Expected: PASS. If the JSON import errors, see Task C1 Step 1's
fallback note.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/composable/tab-shapes-traced.ts
git commit -m "$(cat <<'EOF'
feat(composable): add tracedTabTemplate with PRNG-locked transforms

Pulls a tab from the TRACED_TEMPLATES library and applies six
PRNG-driven adjustments (template pick, x-flip, scalex, scaley, mid
shift, neck pinch). The call order is the share-link reproducibility
contract for traced tabs; reordering or inserting calls breaks every
previously-shared traced-tab puzzle.
EOF
)"
```

---

### Task C3: Test `tracedTabTemplate` end-to-end

**Files:**
- Create: `src/puzzle/composable/tab-shapes-traced.test.ts`

- [ ] **Step 1: Write the unit tests**

```typescript
import { describe, it, expect } from 'vitest';
import { tracedTabTemplate } from './tab-shapes-traced.js';
import { TRACED_TEMPLATES } from './traces/index.js';
import { createSeededRandom } from '../seeded-random.js';

describe('tracedTabTemplate', () => {
    it('starts at y=0 and ends at y=0 (after transforms)', () => {
        const random = createSeededRandom(7);
        const path = tracedTabTemplate.generate(random);
        expect(path[0].y).toBeCloseTo(0, 3);
        expect(path[path.length - 1].y).toBeCloseTo(0, 3);
    });

    it('consumes exactly 6 PRNG calls', () => {
        let calls = 0;
        const random = (): number => {
            calls++;
            return 0.5;
        };
        tracedTabTemplate.generate(random);
        expect(calls).toBe(6);
    });

    it('is deterministic for a fixed seed', () => {
        const r1 = createSeededRandom(123);
        const r2 = createSeededRandom(123);
        const a = tracedTabTemplate.generate(r1);
        const b = tracedTabTemplate.generate(r2);
        expect(a).toEqual(b);
    });

    it('produces a path with the same point count as the picked library entry', () => {
        // With random() === 0 always, idx=0 → first template. flip=true (0<0.5).
        const path = tracedTabTemplate.generate(() => 0);
        expect(path.length).toBe(TRACED_TEMPLATES[0].path.length);
    });

    it('mirrors the path horizontally when flip is chosen', () => {
        // Call counter so we can return 0 for indices 1 (flip) and 0.5 for the rest.
        // PRNG order: idx, flip, scalex, scaley, mid, neckScale.
        let i = 0;
        const random = (): number => {
            i++;
            if (i === 1) return 0;     // idx 0
            if (i === 2) return 0.0;   // flip = true (random() < 0.5)
            if (i === 3) return 0.5;   // scalex = lerp midpoint
            if (i === 4) return 0.5;   // scaley = lerp midpoint
            if (i === 5) return 0.5;   // mid = lerp midpoint = 0.5
            if (i === 6) return 0.5;   // neckScale = lerp midpoint
            return 0.5;
        };
        const flipped = tracedTabTemplate.generate(random);

        // Same parameters but flip=false.
        i = 0;
        const random2 = (): number => {
            i++;
            if (i === 1) return 0;
            if (i === 2) return 0.999; // flip = false (random() >= 0.5)
            if (i === 3) return 0.5;
            if (i === 4) return 0.5;
            if (i === 5) return 0.5;
            if (i === 6) return 0.5;
            return 0.5;
        };
        const upright = tracedTabTemplate.generate(random2);

        // First x of flipped ≈ last x of upright (mirror about x=mid=0.5,
        // then both scaled identically with scalex=1, mid=0.5).
        expect(flipped[0].x).toBeCloseTo(1 - upright[0].x, 3);
        expect(flipped[flipped.length - 1].x).toBeCloseTo(1 - upright[upright.length - 1].x, 3);
    });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/puzzle/composable/tab-shapes-traced.test.ts
```

Expected: PASS. The "PRNG call count = 6" test is the share-link
contract guard.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/composable/tab-shapes-traced.test.ts
git commit -m "$(cat <<'EOF'
test(composable): cover tracedTabTemplate PRNG and transform pipeline

Pins the 6-PRNG-call contract, determinism for a fixed seed, the
x-flip transform, and chord-endpoint preservation.
EOF
)"
```

---

### Task C4: Add `tracedTabGenerator` and register it

**Files:**
- Create: `src/puzzle/topology/traced-tab-generator.ts`
- Create: `src/puzzle/topology/traced-tab-generator.test.ts`
- Modify: `src/puzzle/topology/generator-registry.ts`
- Modify: `src/puzzle/topology/generator-registry.test.ts`

- [ ] **Step 1: Write `traced-tab-generator.ts`**

```typescript
/**
 * Traced tab generator: pulls tab shapes from the photographed library
 * via tracedTabTemplate and applies shared placement helpers.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, tracedTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};
```

- [ ] **Step 2: Register `tracedTabGenerator`**

Modify `src/puzzle/topology/generator-registry.ts`:

```typescript
import { tracedTabGenerator } from './traced-tab-generator.js';
// ... existing imports ...

// At the bottom, alongside noneTabGenerator registration:
registerTabGenerator(tracedTabGenerator);
```

The full added line goes right after `registerTabGenerator(noneTabGenerator);`:

```typescript
registerTabGenerator(noneTabGenerator);
registerTabGenerator(tracedTabGenerator);
```

- [ ] **Step 3: Update the registry test**

Modify `src/puzzle/topology/generator-registry.test.ts` to assert
`'traced'` resolves:

```typescript
it('resolves the traced tab generator', () => {
    expect(getTabGenerator('traced').id).toBe('traced');
});

it('lists traced among the registered tab generators', () => {
    expect(listTabGeneratorIds()).toContain('traced');
});
```

(If the registry test file doesn't already have an equivalent "classic"
assertion as a pattern to follow, match the style of the existing
`baseCutGenerator` tests in that file.)

- [ ] **Step 4: Write the generator integration test**

`traced-tab-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tracedTabGenerator } from './traced-tab-generator.js';
import { Curve } from './curve.js';
import { createSeededRandom } from '../seeded-random.js';

describe('tracedTabGenerator', () => {
    it('has id "traced"', () => {
        expect(tracedTabGenerator.id).toBe('traced');
    });

    it('produces a curve with the same start and end as the input edge', () => {
        const random = createSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const result = tracedTabGenerator.generate(edge, random, {});
        expect(result).not.toBeNull();
        expect(result!.start.x).toBeCloseTo(edge.start.x);
        expect(result!.start.y).toBeCloseTo(edge.start.y);
        expect(result!.end.x).toBeCloseTo(edge.end.x);
        expect(result!.end.y).toBeCloseTo(edge.end.y);
    });

    it('returns null for edges that are too short', () => {
        const random = createSeededRandom(1);
        const shortEdge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(tracedTabGenerator.generate(shortEdge, random, {})).toBeNull();
    });

    it('consumes 8 PRNG calls per successful tab (2 placement + 6 template)', () => {
        let calls = 0;
        const counting = (): number => {
            calls++;
            return 0.5; // mid-range — always succeeds.
        };
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const result = tracedTabGenerator.generate(edge, counting, {});
        expect(result).not.toBeNull();
        expect(calls).toBe(8);
    });
});
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/puzzle/topology/traced-tab-generator.test.ts src/puzzle/topology/generator-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/traced-tab-generator.ts src/puzzle/topology/traced-tab-generator.test.ts src/puzzle/topology/generator-registry.ts src/puzzle/topology/generator-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(topology): add traced tab generator and register it

The generator reuses the shared placement helpers and delegates shape
choice to tracedTabTemplate. Total PRNG consumption per edge is 8
calls (2 placement + 6 template), recorded in the test as the
share-link reproducibility contract for traced puzzles.
EOF
)"
```

---

## Phase D: UI segmented control + config migration

### Task D1: Widen `ComposableSliderConfig` and `ComposableSliderPreference`

**Files:**
- Modify: `src/game/composable-config.ts`
- Modify: `src/game/composable-config.test.ts`
- Modify: `src/ui/new-game-dialog.ts` (interface only — UI in next task)
- Modify: `src/puzzle/composable/compose.ts` (remove `DEFAULT_DISABLE_TABS` only if no longer referenced)

This is the type-system half of the migration. The UI change comes next.

- [ ] **Step 1: Update `composable-config.ts`**

Replace the `disableTabs` field with `tabGenerator`, and add a one-shot
read-side migration on load:

```typescript
export type ComposableTabGenerator = 'classic' | 'traced' | 'none';

export const DEFAULT_TAB_GENERATOR: ComposableTabGenerator = 'classic';

export interface ComposableSliderPreference {
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: ComposableTabGenerator;
}

function parseComposableConfig(
    raw: unknown,
): ComposableSliderPreference | undefined {
    if (
        typeof raw !== 'object' ||
        raw === null ||
        !('horizontalAmplitude' in raw) ||
        !('horizontalFrequency' in raw) ||
        !('verticalAmplitude' in raw) ||
        !('verticalFrequency' in raw)
    ) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    // Migration: legacy { disableTabs: boolean } → { tabGenerator: 'none' | 'classic' }.
    // Per feedback_keep_old_save_migrations, this branch stays indefinitely.
    let tabGenerator: ComposableTabGenerator;
    if (config.tabGenerator === 'classic' || config.tabGenerator === 'traced' || config.tabGenerator === 'none') {
        tabGenerator = config.tabGenerator;
    } else if (config.disableTabs === true) {
        tabGenerator = 'none';
    } else {
        tabGenerator = DEFAULT_TAB_GENERATOR;
    }

    return {
        horizontalAmplitude: Number(config.horizontalAmplitude),
        horizontalFrequency: Number(config.horizontalFrequency),
        verticalAmplitude: Number(config.verticalAmplitude),
        verticalFrequency: Number(config.verticalFrequency),
        tabGenerator,
    };
}
```

- [ ] **Step 2: Update `composable-config.test.ts`**

Read `src/puzzle/src/game/composable-config.test.ts` first to match its
existing style. Replace `disableTabs` usages, and add new tests:

```typescript
it('loads legacy { disableTabs: true } as { tabGenerator: "none" }', () => {
    localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
        horizontalAmplitude: 0.1,
        horizontalFrequency: 1,
        verticalAmplitude: 0.1,
        verticalFrequency: 1,
        disableTabs: true,
    }));
    expect(loadComposableConfigPreference()).toEqual({
        horizontalAmplitude: 0.1,
        horizontalFrequency: 1,
        verticalAmplitude: 0.1,
        verticalFrequency: 1,
        tabGenerator: 'none',
    });
});

it('loads legacy { disableTabs: false } as { tabGenerator: "classic" }', () => {
    localStorage.setItem(COMPOSABLE_CONFIG_KEY, JSON.stringify({
        horizontalAmplitude: 0.1,
        horizontalFrequency: 1,
        verticalAmplitude: 0.1,
        verticalFrequency: 1,
        disableTabs: false,
    }));
    expect(loadComposableConfigPreference()?.tabGenerator).toBe('classic');
});

it('round-trips a config with tabGenerator: "traced"', () => {
    const config: ComposableSliderPreference = {
        horizontalAmplitude: 0.1,
        horizontalFrequency: 1,
        verticalAmplitude: 0.1,
        verticalFrequency: 1,
        tabGenerator: 'traced',
    };
    saveComposableConfigPreference(config);
    expect(loadComposableConfigPreference()).toEqual(config);
});
```

Existing tests that pass `disableTabs: true` (line 22, 55 of
`composable-config.test.ts`) need to be updated to pass `tabGenerator:
'none'` and `tabGenerator: 'classic'` respectively — see what the
existing tests assert before replacing.

- [ ] **Step 3: Update `new-game-dialog.ts` interface**

```typescript
export interface ComposableSliderConfig {
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: 'classic' | 'traced' | 'none';
}
```

Drop the `DEFAULT_DISABLE_TABS` import line:

```typescript
// REMOVE:
import { DEFAULT_DISABLE_TABS } from '../puzzle/composable/compose.js';
```

(`appendCheckboxRow` usage in `buildComposableSlidersSection` is
replaced in Task D2.)

- [ ] **Step 4: Check if `DEFAULT_DISABLE_TABS` is still used**

```bash
grep -rn "DEFAULT_DISABLE_TABS" src/
```

If the only references left are inside `compose.ts` and `compose.test.ts`,
keep them — `composePuzzle` still uses `disableTabs` internally for
piece-composition gating (see `compose.ts:34-69`). That's a different
concept from the UI choice; it's intentional.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/game/composable-config.test.ts
```

Expected: PASS.

The full test run will fail at this point because `main.ts` and
`new-game-dialog.ts` still reference `disableTabs` on
`ComposableSliderConfig`. We fix that in Task D2.

- [ ] **Step 6: Commit**

Hold off — D1 leaves the tree in a broken state. Commit after D2.

---

### Task D2: Replace the checkbox with the segmented control

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add a segmented-control helper to `new-game-dialog.ts`**

Right above (or below) `appendCheckboxRow`:

```typescript
interface SegmentedRow<T extends string> {
    /** Currently selected value. */
    getValue(): T;
}

/** Append a label + radio-group "segmented" row and return the value getter. */
function appendSegmentedRow<T extends string>(
    parent: HTMLElement,
    labelText: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    initialValue: T,
): SegmentedRow<T> {
    const row = document.createElement('div');
    row.className = 'dialog-row';

    const label = document.createElement('label');
    label.className = 'dialog-row-label';
    label.textContent = labelText;

    const group = document.createElement('div');
    group.className = 'segmented-control';
    group.setAttribute('role', 'radiogroup');

    const groupName = `seg-${labelText.replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputs: HTMLInputElement[] = [];

    for (const opt of options) {
        const optLabel = document.createElement('label');
        optLabel.className = 'segmented-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = opt.value;
        if (opt.value === initialValue) input.checked = true;
        inputs.push(input);

        const text = document.createElement('span');
        text.textContent = opt.label;

        optLabel.appendChild(input);
        optLabel.appendChild(text);
        group.appendChild(optLabel);
    }

    row.appendChild(label);
    row.appendChild(group);
    parent.appendChild(row);

    return {
        getValue: (): T => {
            const checked = inputs.find(i => i.checked);
            return (checked ? (checked.value as T) : initialValue);
        },
    };
}
```

- [ ] **Step 2: Replace the checkbox in `buildComposableSlidersSection`**

Replace lines 334–338 (the `appendCheckboxRow` for `Disable Tabs`):

```typescript
const tabGeneratorRow = appendSegmentedRow<'classic' | 'traced' | 'none'>(
    section,
    'Tab style',
    [
        { value: 'classic', label: 'Classic' },
        { value: 'traced',  label: 'Traced'  },
        { value: 'none',    label: 'None'    },
    ],
    args.saved?.tabGenerator ?? 'classic',
);
```

And update the `getValues()` return (line 342–348):

```typescript
return {
    element: section,
    getValues: () => ({
        horizontalAmplitude: parseFloat(sliderInputs.get('horizontalAmplitude')!.value),
        horizontalFrequency: parseFloat(sliderInputs.get('horizontalFrequency')!.value),
        verticalAmplitude: parseFloat(sliderInputs.get('verticalAmplitude')!.value),
        verticalFrequency: parseFloat(sliderInputs.get('verticalFrequency')!.value),
        tabGenerator: tabGeneratorRow.getValue(),
    }),
    setVisible: (visible) => {
        section.style.display = visible ? 'block' : 'none';
    },
};
```

Also update the `SliderDef` `id` constraint near line 285:

```typescript
id: keyof Omit<ComposableSliderConfig, 'tabGenerator'>;
```

- [ ] **Step 3: Update `sliderConfigToGeneratorConfig` in `main.ts`**

Lines 136–154 of `main.ts`:

```typescript
function sliderConfigToGeneratorConfig(slider: {
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: 'classic' | 'traced' | 'none';
}): import('./puzzle/composable-generator.js').ComposableConfig {
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
    };
}
```

- [ ] **Step 4: Add the segmented-control CSS**

Find where dialog styles live. Check `src/styles/` and grep:

```bash
grep -rln "dialog-row" src/ | head
```

In the same stylesheet that defines `.dialog-row`, add:

```css
.segmented-control {
    display: inline-flex;
    border: 1px solid var(--border-color, #888);
    border-radius: 4px;
    overflow: hidden;
}

.segmented-control .segmented-option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
    border-right: 1px solid var(--border-color, #888);
}

.segmented-control .segmented-option:last-child {
    border-right: none;
}

.segmented-control .segmented-option input[type="radio"] {
    margin: 0;
}
```

If the codebase has a design-token convention different from
`var(--border-color)`, match what neighboring components use.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: PASS (the type-check via Vitest's TS transform catches the
`disableTabs` → `tabGenerator` rename).

- [ ] **Step 6: Smoke-test in a browser**

Per CLAUDE.md "For UI or frontend changes" guidance:

```bash
npm run dev
```

In the browser:
1. Open the new-game dialog.
2. Pick the Composable cut style.
3. Confirm a "Tab style" row appears with three radio segments.
4. Pick `Traced`, start a 24-piece puzzle. The pieces should generate
   without error (open DevTools console to be sure).
5. Pick `None`, start another puzzle — flat edges, no tabs.
6. Pick `Classic`, start another — looks like before.
7. Refresh the page, re-open the dialog: the last-picked tab style is
   pre-selected.

If anything throws or renders wrong, debug before committing.

- [ ] **Step 7: Commit**

```bash
git add src/game/composable-config.ts src/game/composable-config.test.ts src/ui/new-game-dialog.ts src/main.ts src/styles
git commit -m "$(cat <<'EOF'
feat(ui): replace "Disable tabs" checkbox with three-way tab-style picker

The Composable section now exposes a segmented control (Classic /
Traced / None) instead of the boolean "Disable tabs" toggle. The new
field replaces disableTabs across ComposableSliderConfig and the
preference store; legacy { disableTabs: true } loads as
{ tabGenerator: 'none' }.

Dev-only: gated by the existing Composable-section visibility rule.
EOF
)"
```

---

### Task D3: Share-link round-trip for `tg = 'traced'`

**Files:**
- Modify: `src/sharing/share-link.test.ts`

`share-link.ts` already accepts any string for `cf.tg`, so no source
change is needed there. We just add explicit assertions.

- [ ] **Step 1: Read existing share-link tests around `tg` and `disableTabs`**

```bash
sed -n '740,840p' src/sharing/share-link.test.ts
```

This locates the existing `disableTabs default agreement (#285)` block,
which we'll add new tests alongside.

- [ ] **Step 2: Add traced-tab tests**

```typescript
describe('share-link tg = "traced"', () => {
    it('round-trips an encoded payload with tg: "traced"', () => {
        const payload: SharePayload = {
            v: 1,
            i: 'blank',
            is: [800, 600],
            g: [4, 3],
            c: 'composable',
            s: 12345,
            r: 'none',
            cf: {
                bg: 'sine',
                bgc: { ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 },
                tg: 'traced',
                tgc: {},
            },
        };
        const encoded = encodePayload(payload);
        const decoded = decodePayload(encoded);
        expect(decoded).toEqual(payload);
    });

    it('decodes legacy "dt: true" (no tg) as tg: "none"', () => {
        // Hand-craft a legacy payload (pre-#XXX). translateLegacyComposable
        // should map dt → tg.
        const legacyJson = JSON.stringify({
            v: 1, i: 'blank', is: [800, 600], g: [4, 3], c: 'composable',
            s: 1, r: 'none',
            cf: { ha: 0.1, hf: 1, va: 0.1, vf: 1, dt: true },
        });
        const encoded = base64UrlEncode(legacyJson);
        const decoded = decodePayload(encoded);
        expect(decoded?.cf?.tg).toBe('none');
    });
});
```

If `base64UrlEncode` is not exported from `share-link.ts`, either
export it or build the encoded form by exporting one from the test:

```typescript
// At top of test file, alongside existing imports.
function base64UrlEncode(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

- [ ] **Step 3: Run the share-link tests**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sharing/share-link.test.ts
git commit -m "$(cat <<'EOF'
test(share-link): cover tg = 'traced' round-trip and legacy dt migration

Asserts the share-link codec accepts the new traced tab generator id
and that the existing dt: true → tg: 'none' migration still works.
EOF
)"
```

---

### Task D4: Python smoke test under `tools/trace-tab/tests/`

**Files:**
- Create: `tools/trace-tab/tests/test_smoke.py`
- Create: `tools/trace-tab/tests/__init__.py` (empty, for pytest)

A single algorithm-regression test against the shipped photo. CI doesn't
run Python tests for this repo, so the test exists for the developer
adding traces to verify the CLI still works after edits.

- [ ] **Step 1: Write the smoke test**

```python
"""Smoke test for the trace-tab CLI.

Not part of CI (no Python runner in this repo). Run manually:

    python -m pytest tools/trace-tab/tests/

Requires the spike screenshot to be reachable. Either fetch it from the
spike/tab-tracing branch first, or skip the test if the photo is missing.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = REPO_ROOT / 'tools' / 'trace-tab' / 'main.py'
PHOTO = Path('/tmp/screenshot.png')  # Fetched manually; see README.


@pytest.mark.skipif(not PHOTO.exists(), reason=f'fetch {PHOTO} from spike/tab-tracing first')
def test_screenshot_roundtrip(tmp_path):
    out = tmp_path / 'traces'
    out.mkdir()
    subprocess.run(
        [sys.executable, str(CLI), str(PHOTO),
         '--id', 'smoke-test',
         '--out', str(out)],
        check=True,
    )
    json_path = out / 'smoke-test.json'
    assert json_path.exists()
    data = json.loads(json_path.read_text())
    # Schneider refit at 1% chord on the screenshot consistently lands
    # in this range across the spike's runs.
    n_segments = (len(data['path']) - 1) // 3
    assert 5 <= n_segments <= 12, f'expected 5–12 cubic segments, got {n_segments}'
    # Landmarks sane.
    assert 0 < data['landmarks']['neck']['y'] < data['landmarks']['head']['y'] < 1
```

- [ ] **Step 2: Commit**

```bash
git add tools/trace-tab/tests/__init__.py tools/trace-tab/tests/test_smoke.py
git commit -m "$(cat <<'EOF'
test(tools): add manual smoke test for trace-tab CLI

Single round-trip test against the spike screenshot. Not wired into CI
(no Python runner) — exists for developers adding new traces to verify
the CLI still produces sane output after edits.
EOF
)"
```

---

### Task D5: Open the PR

**Files:** none.

- [ ] **Step 1: Push the branch and open the PR**

The repo uses rebase-and-merge only ([[project_rebase_merge_only]]). The
PR body needs `Closes #<issue>` if there's a tracking issue —
[[feedback_pr_closing_keyword]] — otherwise omit.

```bash
git push -u origin plan/traced-tabs

gh pr create --title "feat: traced tab generator behind dev-only UI" --body "$(cat <<'EOF'
## Summary
- Adds a new `traced` TabGenerator that pulls tab shapes from a JSON library produced offline by `tools/trace-tab/`.
- Replaces Composable's "Disable tabs" checkbox with a three-way "Tab style" picker (Classic / Traced / None).
- Extracts placement helpers out of `classic-tab-generator.ts` into `tab-generator-helpers.ts` so the new generator shares them.

Spec: `docs/superpowers/specs/2026-05-22-traced-tabs-design.md`

## Test plan
- [ ] `npx vitest run` is green.
- [ ] Manual: open new-game dialog → Composable → pick `Traced` → generate a 24-piece puzzle → tabs come from the library.
- [ ] Manual: pick `None` → puzzle has flat edges.
- [ ] Manual: pick `Classic` → puzzle looks unchanged from main.
- [ ] Manual: refresh after picking `Traced` — radio remembers the choice.
- [ ] Manual: load an old share link with `dt: true` (or `disableTabs: true` in localStorage) — decodes as `tabGenerator: 'none'`.
- [ ] Manual: copy a share link from a `Traced` puzzle — paste it into a fresh window — same puzzle regenerates.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Report PR URL to the user**

Print the PR URL in the closing message so the user can review.

---

## Self-review checklist

After all phases complete, before declaring the work done:

- [ ] Run `npx vitest run` — expect green.
- [ ] Run `npx tsc --noEmit` — expect zero errors.
- [ ] Search for stale references:
  ```bash
  grep -rn "disableTabs" src/        # legacy migrations only; no live UI usage
  grep -rn "DEFAULT_DISABLE_TABS" src/
  ```
- [ ] Confirm `git log` shows clean per-task commits (no fixups mixed in).
- [ ] Confirm `tools/trace-tab/main.py` produces a sensible review PNG
      on at least one photo (Phase A Task A2 Step 4).

## Out-of-scope (not in this plan)

- Library versioning in share links (`cf.tgc.libraryHash`).
- Promoting `traced` to Wavy or any production cut style.
- The `--markers <file>` flag for tabs whose head exceeds the chord.
- A larger curated library (we ship with one trace; subsequent traces
  are added one-PR-per-photo).
- Info-modal "How to Play" / "Cut Styles" / "Settings" updates — per
  CLAUDE.md, the modal stays in sync only when the feature is
  player-facing, and this v1 is dev-only.

## References

- Spec: `docs/superpowers/specs/2026-05-22-traced-tabs-design.md`
- Spike branch: `spike/tab-tracing` (contains `spike.py`, photos, FINDINGS.md)
- Memories applied:
  - [[project_share_link_prng_contract]] — PRNG call count/order locked.
  - [[feedback_keep_old_save_migrations]] — legacy migration branches stay.
  - [[feedback_test_file_placement]] — tests next to source.
  - [[project_puzzle_uses_vite_vitest]] — Vitest patterns, not Stencil.
  - [[project_rebase_merge_only]] — linear history on main.
  - [[feedback_push_and_pr_without_asking]] — push + open PR without confirmation.
