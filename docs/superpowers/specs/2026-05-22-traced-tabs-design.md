# Traced tabs — design

## Summary

Add a new `TabGenerator` plug-in named **`traced`** that picks tab shapes
from a library of cubic-Bezier paths extracted from photographed real-world
puzzle pieces. Each library entry is a normalized neck-to-neck trace plus
landmark metadata (head/neck y, widths, centre x) produced offline by a
Python CLI that wraps the validated pipeline from the spike branch.

For v1, exposure is **dev-only**: the new generator is selectable in
Composable's tab-style picker, alongside the existing `classic` and
`none` options. Production cut styles (Classic, Wavy, Fractal) are not
touched; their tab-generator choices stay hardcoded in their strategies.

Each `traced` tab generation consumes **one outer PRNG call**, which seeds
a local sub-PRNG that drives all per-edge transforms (template-pick,
random flip, scalex, scaley, mid, neckRatio-analog). Combined with the 2
placement calls already made by `computeTabPlacement`, this is 3 outer
calls per edge (vs. 6 outer for classic). The sub-PRNG isolation lets
future per-edge jitter parameters be added inside the local block
without disturbing the outer puzzle's PRNG sequence. Library size at
launch: aiming for 25+ traces, collected across multiple physical
puzzles.

A separate cleanup in the same PR replaces Composable's "Disable tabs"
checkbox with a three-way segmented control (`● Classic ○ Traced ○ None`)
since `noneTabGenerator` already exists as a registered plug-in. The
boolean `disableTabs` field on `ComposableSliderConfig` and on
`SharePayload.cf` retires; old payloads with `disableTabs: true` are
read as `tabGenerator: 'none'` via a one-shot migration on load.

## Goals

- Make real-world tab shapes available as a tab-generator option without
  disturbing the existing classic, wavy, or fractal cut styles.
- Keep the trace-extraction workflow offline (Python CLI), so the
  in-browser code path stays small and deterministic.
- Preserve share-link reproducibility across the existing tab generators.
  A share link with `cf.tg = 'classic'` (or absent) keeps reproducing
  identically; one with `cf.tg = 'traced'` reproduces against the
  library *as shipped at that point in time*.
- Fold the existing "Disable tabs" checkbox into the new tab-style picker
  so there's a single control for tab choice on Composable.
- Land the change behind dev-only UI so we can validate end-to-end with
  real share-links and several puzzles before exposing to production
  users.

## Non-goals (v1)

- **Production exposure.** Wavy keeps `tabGenerator: 'classic'`. Classic
  keeps its procedural-no-template style. Fractal still has no tabs.
  Promoting `traced` to production is a follow-up that needs library
  versioning in share links (see below).
- **Manual neck-endpoint markers.** Today the Python CLI assumes the
  photo is cropped so the tab's necks fall on the left/right image
  edges. Future tabs whose head protrudes wider than the flange would
  need a marker mechanism (e.g. a hand-drawn red line indicating where
  to cut the trace). Out of scope for v1.
- **In-app trace upload.** No browser-side tracing. No user-contributed
  traces. The CLI runs on a developer's machine and writes JSON files
  that get committed to the repo.
- **Library versioning in share links.** Mid-life additions to the
  library can change which template a given seed picks, breaking older
  traced-tab share links. Acceptable for dev-only v1; will need a
  versioning scheme in `SharePayload.cf.tgc` before going to production.
- **Automated trace QC.** The acceptance gate is a human eyeballing the
  review PNG written by the CLI. No automated "is this a valid puzzle
  tab?" detector.
- **Refactor of Wavy / Classic strategies.** They still hardcode
  `tabGenerator: 'classic'`. No changes there in v1.

## User-facing behaviour

### New-game dialog (dev-only paths)

The Composable section gains one control:

```
┌─ Composable settings ────────────────────────┐
│ H Amplitude  [════•══]                       │
│ H Frequency  [══•════]                       │
│ V Amplitude  [════•══]                       │
│ V Frequency  [══•════]                       │
│ Tab style    ( ● Classic  ○ Traced  ○ None ) │   ← NEW
└──────────────────────────────────────────────┘
```

`Disable tabs` (existing checkbox) is removed — its function is now
served by the `None` option.

The control is only visible when Composable is selected — which is only
in dev-deploys and `npm run dev`, per the existing
`getVisibleCutStyleOptions()` gating.

Selection flows through the existing config chain unchanged:

```
NewGameSelection.composableConfig.tabGenerator        (UI selection)
    → GameState.composableConfig.tabGenerator         (in-memory state)
    → SharePayload.cf.tg                              (encoded for share)
    → tabGeneratorId in ComposableConfig              (passed to topology generator)
```

Only one new value (`'traced'`) becomes valid at each layer; the type
declarations widen from `'classic' | 'none'` (currently expressed via
`disableTabs` boolean) to `'classic' | 'traced' | 'none'`.

### Trace appearance

Each traced tab is one path from the library, randomly flipped horizontally
(50/50), then scaled, shifted, and neck-pinched by per-edge PRNG values.
Library traces preserve the photographed asymmetry; random flipping
doubles the effective shape pool for asymmetric templates.

### Save / share-link compatibility

Existing saves and share links with `disableTabs: true` (and no
`tabGenerator`) are read as `tabGenerator: 'none'`. Existing payloads
with `cf.tg = 'classic'` or no `cf.tg` keep working unchanged. Payloads
with `cf.tg = 'traced'` work as long as the library hasn't grown since
the link was created. (For dev-only v1 that's an acceptable caveat.)

## Module architecture

```
tools/trace-tab/                                Python CLI (promoted from spike/).
    main.py
    requirements.txt
    README.md
    tests/                                      Optional: smoke tests on shipped photos.

src/puzzle/composable/
    tab-shapes.ts                               Unchanged — classicTabTemplate stays here.
    tab-shapes-traced.ts                        NEW — tracedTabTemplate, PRNG-driven transforms.
    traces/                                     NEW — library directory.
        index.ts                                Exports TRACED_TEMPLATES array.
        tab-01-<source>.json                    One JSON per trace.
        tab-02-<source>.json
        ...

src/puzzle/topology/
    tab-generator-helpers.ts                    NEW — extracted from classic-tab-generator.ts:
                                                prepareTab, commitTab, computeTabPlacement.
                                                Shared by both generators.
    classic-tab-generator.ts                    Thinned to a one-liner using helpers.
    traced-tab-generator.ts                     NEW — uses helpers + tracedTabTemplate.
    generator-registry.ts                       Register 'traced'.

src/ui/
    new-game-dialog.ts                          Add tab-style segmented control inside
                                                Composable section. Remove "Disable tabs"
                                                checkbox.

src/sharing/
    share-link.ts                               Read-side migration: disableTabs → 'none'.
                                                Encoding already supports cf.tg='traced'.
```

Two existing files become slimmer: `classic-tab-generator.ts` extracts its
placement/preparation helpers into `tab-generator-helpers.ts`, which the new
traced generator reuses. No duplication.

## Trace data format

One JSON file per trace, under `src/puzzle/composable/traces/`:

```jsonc
{
  "id": "tab-01-puzzle-cat",
  "source": {
    "photo": "tab-01-puzzle-cat.jpg",
    "captured": "2026-05-21",
    "notes": "blue cat puzzle, top edge"        // optional
  },
  "path": [                                       // normalized cubic Bezier path
    {"x": 0.0, "y": 0.0},                         // start (left neck endpoint)
    {"x": 0.05, "y": 0.12},                       // cp1, cp2, anchor triples
    ...
    {"x": 1.0, "y": 0.0}                          // end (right neck endpoint)
  ],
  "landmarks": {                                  // detected by the Python pipeline
    "apex_y": 0.787,
    "head":   { "y": 0.551, "width": 0.606, "center_x": 0.644 },
    "neck":   { "y": 0.252, "width": 0.440, "center_x": 0.572 }
  }
}
```

The path follows the existing `TabTemplate.generate(...)` convention
(BezierPath in normalized neck-frame, +Y is protrusion). Landmarks are
used at generation time by the `neckRatio` analog.

A bundled `index.ts` imports the files and applies the JSON-shape type
guard once at build time:

```ts
// src/puzzle/composable/traces/index.ts
import tab01 from './tab-01-puzzle-cat.json';
import tab02 from './tab-02-puzzle-cat.json';
// ...
export const TRACED_TEMPLATES: readonly TracedTemplate[] = [tab01, tab02, ...];
```

One file per trace gives readable git diffs when traces are added,
removed, or replaced. Asset cost per trace: roughly 1-2 KB JSON; a
25-trace library is ~40 KB.

## `tracedTabTemplate.generate(random)` behaviour

Pseudo-code; exact lerp ranges are tunable during implementation:

```ts
generate(random): BezierPath {
    // OUTER PRNG contract — LOCKED at ONE call per traced tab. That
    // call seeds a local sub-PRNG used for every per-edge parameter.
    // Adding/reordering LOCAL calls below changes which shape a given
    // seed produces for THIS edge, but does not disturb the outer
    // stream — so puzzle structure (cuts, piece placement, neighbouring
    // tabs) stays seed-stable as the local block evolves.
    const subSeed = random();
    const local = createSeededRandom(seedFromFloat(subSeed));

    const idx       = Math.floor(local() * TRACED_TEMPLATES.length);    // 1: pick
    const flip      = local() < 0.5;                                    // 2: mirror x
    const scalex    = lerp(0.85, 1.05, local());                        // 3
    const scaley    = lerp(0.85, 1.05, local());                        // 4
    const mid       = lerp(0.45, 0.55, local());                        // 5: lateral shift
    const neckScale = lerp(0.75, 1.10, local());                        // 6: neckRatio analog
    // future per-edge parameters slot in here without affecting outer.

    const template = TRACED_TEMPLATES[idx];
    let path = template.path;
    let landmarks = template.landmarks;

    if (flip) {
        path = path.map(p => ({ x: 1 - p.x, y: p.y }));
        landmarks = mirrorLandmarksX(landmarks);
    }

    // neckRatio analog: pinch x toward the y-dependent centerline,
    // weighted by a smooth bump centered at landmarks.neck.y, returning
    // to 1.0 at y=0 (chord) and y=head.y (head untouched).
    path = path.map(p => pinchNeck(p, landmarks, neckScale));

    // Lateral shift, then uniform scale around (mid, 0).
    path = path.map(p => ({
        x: mid + (p.x - 0.5) * scalex,
        y: p.y * scaley,
    }));

    return path;
}
```

### Why gentle parameter ranges

Traces already carry strong "personality" from the source photo.
Aggressive scaling distorts the shape into something that no longer reads
as the original cardboard tab. Library size does most of the variety
work; per-edge jitter is just there to prevent identical-looking repeats
when the same template gets picked twice on adjacent edges.

### `pinchNeck` formula

Conceptual sketch (implementation details left to the planning step):

For each path point `(x, y)`:

1. Compute a `narrowing weight` `w(y)` that's 0 at `y=0`, peaks at
   `y=landmarks.neck.y`, and returns to 0 at `y=landmarks.head.y` (and
   stays 0 above). A piecewise-linear bump or a `smoothstep`-style
   blend both work; pick whichever reads more naturally during
   implementation.
2. Compute a lateral pivot `pivot_x(y)` — linearly interpolated between
   `0.5` at `y=0`, `landmarks.neck.center_x` at `y=neck.y`, and
   `landmarks.head.center_x` at `y=head.y`.
3. New x: `pivot_x(y) + (x - pivot_x(y)) * lerp(1.0, neckScale, w(y))`.

This keeps chord endpoints fixed at `(0,0)` and `(1,0)`, narrows the
neck inward when `neckScale < 1`, and leaves the head proportions intact.

### Total PRNG cost per edge

- Existing `computeTabPlacement`: 2 outer calls (tCenter, isTab).
- New `tracedTabTemplate.generate`: 1 outer call (subSeed) + 6 local
  sub-PRNG calls.
- **Total per edge: 3 outer + 6 local.** Classic uses 6 outer (2
  placement + 4 template). Switching tab generator changes outer-stream
  consumption from 6 to 3, but the sub-PRNG isolation means future
  additions to the local block (e.g. per-edge rotation jitter,
  per-edge texture variation) won't disturb the outer stream — so
  puzzle structure stays seed-stable across version bumps that only
  change local-block ordering.

## Generator helpers refactor

`classic-tab-generator.ts` today is one `TabGenerator` plus several
file-private helpers (`prepareTab`, `commitTab`, `computeTabPlacement`).
The helpers are template-agnostic — they take a `TabTemplate` as an
argument and don't care which one it is. Move them out:

```ts
// src/puzzle/topology/tab-generator-helpers.ts
export function computeTabPlacement(...): {...} | null;
export function prepareTab(curve, tCenter, isTab, template, random): PreparedTab | null;
export function commitTab(prepared): Curve;
```

Then both generators become small:

```ts
// classic-tab-generator.ts
export const classicTabGenerator: TabGenerator = {
    id: 'classic',
    generate(edge, random) {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;
        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, classicTabTemplate, random);
        return prepared ? commitTab(prepared) : null;
    },
};

// traced-tab-generator.ts — identical structure, different template.
export const tracedTabGenerator: TabGenerator = {
    id: 'traced',
    generate(edge, random) { /* same shape, tracedTabTemplate */ },
};
```

A factory wrapper (`makeTabGenerator(id, template)`) is tempting but
not required — two five-line generators are perfectly readable.

### Implementation note: traced bypasses `prepareTab`

During implementation the traced generator diverged from the
"identical structure" shape above. The traced template's path spans
the full edge — `(0, 0)` to `(1, 0)` are the chord endpoints
themselves, not the mid-edge necks the classic template uses.
`prepareTab` assumes a small mushroom-style shape it can splice into
the middle of an edge, with the rest of the edge preserved as
before/after segments. With a full-edge template that splice gate
always rejects.

The traced generator therefore calls `transformTabToEdge` directly
with `edge.start` / `edge.end` as the anchor frame, replacing the
edge wholesale rather than splicing into it. It still consumes the
two outer placement calls from `computeTabPlacement` (the `tCenter`
value is unused but the call must stay — see the function's
PRNG-contract docstring). See the docstring on
`src/puzzle/topology/traced-tab-generator.ts` for the authoritative
description of the design difference.

## Python CLI

`tools/trace-tab/main.py` — one command per trace:

```sh
$ python tools/trace-tab/main.py photos/tab-12.jpg \
       --id tab-12-blue-cat \
       --notes "blue cat puzzle, top edge" \
       --out src/puzzle/composable/traces/

# writes:
#   src/puzzle/composable/traces/tab-12-blue-cat.json
#   src/puzzle/composable/traces/tab-12-blue-cat-review.png
```

Internals are the spike code, cleaned up:

1. Load photo → grayscale → median blur → Otsu threshold → polarity
   detect → morph open + close.
2. Potrace at `alphamax=0.5` → SVG.
3. Pick the largest subpath; build the closed-contour segment list.
4. `find_edge_anchors()` for the two neck endpoints (cropped-photo
   convention).
5. `tab_arc_between_anchors()` picks the arc whose midpoint bulges
   furthest from the neck chord.
6. Normalize to (0,0)→(1,0), +Y up.
7. Schneider refit at **1% chord tolerance** (the value the spike
   converged on; consistently yields 8-15 segments per trace).
8. `analyze_tab_shape()` for the head/neck/apex landmarks.
9. Write `<id>.json` and `<id>-review.png`.

The review PNG is the same overlay format pushed to the spike PR for
each photo: photo + Potrace contour + Schneider refit + control points
+ neck endpoints.

**Manual acceptance gate.** The person adding the trace eyeballs the
review PNG before committing the JSON. If the trace mis-detects necks,
chases a glare highlight, or otherwise looks wrong, discard and reshoot.

What's NOT in the production CLI:

- Synthetic round-trip tests (classic-tab → render → trace → compare).
  These live as algorithm-regression tests under `tools/trace-tab/tests/`,
  but they aren't part of the per-trace workflow.
- The auto-mode that falls back from cropped-photo to concavity-based
  neck detection. The CLI assumes cropped photos. If a future use case
  needs the concavity mode, add a `--mode` flag.

## Migration: `disableTabs` → `tabGenerator: 'none'`

Read-side only — no on-disk rewriting.

```ts
// src/sharing/share-link.ts (or wherever payload decoding lives)
function readComposableConfig(cf: SharePayloadComposable): ComposableConfig {
    const tabGenerator =
        cf.tg === 'traced' ? 'traced'
      : cf.tg === 'none'   ? 'none'
      : cf.disableTabs     ? 'none'     // legacy: disableTabs:true → none
      : cf.tg ?? 'classic';
    // ... rest of decode
}
```

Save-load follows the same pattern in whichever module decodes saves. Per
the [[feedback_keep_old_save_migrations]] convention, the legacy branch
stays in the codebase indefinitely.

## Testing

New tests, placed next to their source per
[[feedback_test_file_placement]]:

- **`tab-shapes-traced.test.ts`** — with a seeded PRNG and a fixed
  library snapshot, `tracedTabTemplate.generate()` produces a
  deterministic path. Covers PRNG call order and transform composition.
- **`traced-tab-generator.test.ts`** — integration: generator +
  `apply-tabs` produces a valid curve on a known edge.
- **`traces/index.test.ts`** — every JSON file in the library validates
  against the schema (path non-empty, landmarks in `[0,1]`, etc.).
  Catches malformed traces at CI time before they ship.
- **`share-link.test.ts`** — extend existing tests:
  - `cf.tg = 'traced'` round-trips.
  - Legacy payloads with `disableTabs: true` and no `tg` decode to
    `tabGenerator: 'none'`.
- **`classic-tab-generator.test.ts`** — regression on the helper
  refactor. Snapshot classic's output for a fixed seed before and after
  the move; assert no drift. Critical for
  [[project_share_link_prng_contract]].
- **Python smoke tests** under `tools/trace-tab/tests/` — round-trip the
  shipped photos and assert that produced JSONs match expected segment
  counts and landmark ranges (within tolerance for non-determinism in
  Potrace).

No visual / screenshot snapshot tests for traces — the manual review-PNG
step in the CLI is the visual gate; snapshot tests would add CI friction
without catching anything the human review doesn't.

## Performance

Spike measurements:

- Wavy 192-piece generation: ~5 s on phone.
- Same without tabs: ~1 s.
- Tab work today: ~4 s for 192 × ~12 tab edges × 4 segments/tab.
- With traced (refit at 1% chord): ~8 segments/tab, so ~2× tab work
  → projected ~9 s for 192-piece traced Wavy. Acceptable given v1 is
  dev-only.
- At tol=2% chord (5-6 segments), back to roughly current numbers if
  needed.

## Out-of-scope follow-ups (post-v1)

In rough order of priority for a future "promote to production" PR:

1. **Library versioning in share links.** Encode the library hash or
   length in `cf.tgc` so older puzzles reproduce against the original
   library snapshot. This unblocks growing the library without breaking
   in-the-wild share links.
2. **Switch Wavy to `traced`** in `wavyStrategy`. Or expose a
   tab-generator picker for Wavy in production (smaller change to UX
   surface area).
3. **Manual marker support in the CLI** (`--markers <file>`) so tabs
   whose head exceeds the chord can be authored.
4. **Larger library** (50+ traces from multiple physical puzzles) once
   the versioning question is resolved.
5. **Help-text update** to the info modal once the feature is
   player-facing.

## Open questions for the planning step

None that block the plan — the Q&A pass closed them all. Items that
might surface during planning (placement of the segmented control
component, exact lerp ranges for the per-edge jitter, the precise
`pinchNeck` weighting curve) are implementation-detail decisions that
can be made by the planner or the implementer.
