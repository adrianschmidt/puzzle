# Wavy cut style — design

## Summary

Extract the "sine waves + classic tabs" composable preset into a top-level
cut style called **Wavy**. Wavy uses the composable framework under the
hood but with parameters fixed by the spec — no sliders. It joins
Classic and Fractal as a first-class option in the new-game dialog.

The existing **Composable** cut style stays in the codebase and remains
selectable on dev-deploys (and `npm run dev`), but is **hidden from the
production new-game dialog**. A `window.__newComposableGame(...)` helper
exposes the full composable surface to the JS console for power users.

In the same PR, all four indexed-preference stores (cut style, puzzle
size, background colour, merge tolerance) migrate from integer-index
identifiers to stable string ids in localStorage, with a one-shot
backwards-compatible loader so existing saved indices still resolve.
Share-links are already id-based where it matters; no changes needed
there beyond accepting the new `'wavy'` cut style.

## Goals

- Wavy as a recognisable, named cut style with deterministic, grid-derived
  parameters — same pieces every time for a given grid + seed.
- Hide Composable from production users without losing it from the codebase
  (still in tests, dev-deploys, save/share decoding, JS console).
- Free rotation is the natural companion for curved edges — move the
  "Free rotation" sub-checkbox from Composable to Wavy in the dialog.
  Keep it accepting Composable too (on dev-deploys where Composable is
  pickable).
- Eliminate the "indices in localStorage are append-only forever"
  fragility across all four indexed preference stores.

## Non-goals

- Adding more named presets ("Bumpy", "Smooth", etc.) — Wavy is the only
  one we know we want today.
- Changing Composable's behaviour, share-link shape, or save-file shape.
- Migrating in-memory positional payload fields like `g: [cols, rows]`
  or `pr.m`/`pr.mr`/`pr.sr` to id-based — those are tuples and arrays,
  not enum-like positions.
- Removing legacy-integer migration support entirely. We keep
  `legacyOrder` arrays alongside each id-based store and remove them in
  a follow-up once enough time has passed.

## User-facing behaviour

### Cut-style picker

The picker shows three options on production:

1. **Classic** — Traditional jigsaw tabs
2. **Fractal** — Organic circle-packing
3. **Wavy** — Like Classic, but each cut curves boldly

On dev-deploys and local dev, a fourth **Composable** option is shown,
labelled the same as today.

Wavy renders no sub-section in the dialog — there are no sliders. The
**Enable rotation** + **Free rotation** sub-checkbox combo applies to
Wavy exactly like it currently does for Composable.

### Defaults

- First-time users still get **Classic** by default. No promotion of Wavy.
- A user who previously chose Composable: their saved preference now
  resolves to the literal id `'composable'`. On dev-deploys they continue
  to see Composable selected. On production, since Composable isn't
  visible, the dialog opens with the default (Classic) highlighted, but
  the saved preference is not overwritten — switching back to a
  dev-deploy restores their choice.

### Help text (`info-modal.ts`)

The **Cut Styles** section is updated:

- Replace the Composable bullet with a **Wavy** bullet describing it as
  "Smooth sinewave edges with classic jigsaw tabs — a more dramatic take
  on Classic."
- Move the **Free rotation** sub-bullet from under Composable to under
  Wavy.
- No bullet for Composable — it isn't user-facing on production. (Dev
  builds get the same help text; the help is documentation of the
  user-facing options, not a debug surface.)

## Cut-style taxonomy

`CutStyle` becomes `'classic' | 'fractal' | 'wavy' | 'composable'`.

`CUT_STYLE_OPTIONS` is `[classic, fractal, wavy, composable]` in that
order. All four are always exported; the new-game dialog filters to a
visible subset.

```ts
function isComposableVisible(): boolean {
    // BASE_URL is '/' (or '/puzzle/') in prod and '/puzzle/dev/' on
    // the PR-preview deploy. import.meta.env.DEV covers `npm run dev`.
    return import.meta.env.DEV
        || import.meta.env.BASE_URL.includes('/dev/');
}

function getVisibleCutStyleOptions(): readonly CutStyleOption[] {
    return isComposableVisible()
        ? CUT_STYLE_OPTIONS
        : CUT_STYLE_OPTIONS.filter(o => o.id !== 'composable');
}
```

Visibility is checked at module load time — the returned list is stable
across a single page load.

## Generation strategy

A new strategy in `src/game/cut-style-strategies.ts`:

```ts
const wavyStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed) => {
        const avgPieceArea =
            (puzzleSize.width * puzzleSize.height)
            / (grid.cols * grid.rows);
        return generateComposablePuzzle(
            grid.cols, grid.rows, puzzleSize, seed,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: {
                    cols: grid.cols,
                    rows: grid.rows,
                    ha: 0.5,
                    hf: grid.cols / 2,
                    va: 0.5,
                    vf: grid.rows / 2,
                },
                tabGenerator: 'classic',
                tabConfig: {},
                minPieceArea: avgPieceArea / 4,
            },
        );
    },
    // configKey omitted — Wavy is fully reproducible from seed + gridSize.
};
```

Registered in `STRATEGIES` as `wavy: wavyStrategy`.

Behaviour:

- Amplitude is fixed at 0.5 (50% of nominal piece dimension).
- Frequency is half the number of pieces along the cut's axis. For the
  four canonical grids:

  | Grid  | hFreq | vFreq |
  |-------|-------|-------|
  | 6×4   | 3     | 2     |
  | 8×6   | 4     | 3     |
  | 12×8  | 6     | 4     |
  | 16×12 | 8     | 6     |

  Non-canonical grids (e.g. 7×5 via console or share-link) get
  non-integer frequencies, which the sine generator handles fine.

- Tabs are enabled, using the `'classic'` tab generator.

- `minPieceArea` is a quarter of the grid-implied piece area. For a
  48-piece puzzle on a 1080×720 image that's ~4 050 px² — well above
  the framework's default 4 px² noise floor. Any sliver under that gets
  auto-grouped with a neighbour rather than presented as a standalone
  piece.

- Because `configKey` is omitted, `state.composableConfig` is left
  `undefined` on Wavy GameStates. This is intentional: Wavy params are
  a deterministic function of `gridSize`, so storing them would be
  redundant *and* tie us to the specific formula in this spec.

  Risk: if we ever change the Wavy formula, old Wavy share-links will
  silently regenerate differently. This is the same contract as
  Classic. Mitigation: treat the formula as part of the public schema —
  if it needs to change, mint a new style id rather than mutate Wavy.
  (See `feedback_share_link_prng_contract` in memory.)

## Free-rotation plumbing (`main.ts`)

The `rotationMode` derivation widens:

```ts
} else if (freeRotation && (cutStyle === 'wavy' || cutStyle === 'composable')) {
    rotationMode = 'free';
}
```

Everything downstream of `rotationMode` is cut-style-agnostic, so no
other touches needed.

The new-game dialog's "Free rotation" sub-checkbox becomes visible when:

- "Enable rotation" is ticked, AND
- the selected cut style is Wavy *or* Composable.

## Share-link / save-file

### Share-link

`SharePayload['c']` extends to
`'classic' | 'fractal' | 'composable' | 'wavy'`. `isValidPayload` accepts
`'wavy'`. No `cf` block is emitted or required for Wavy — the recipient
regenerates parameters from `g: [cols, rows]`.

`gameStateToPayload` and `loadSharedPuzzle` need no special-casing
beyond accepting the new `c` value: `cf` is already gated on
`cutStyle === 'composable'`, and `loadSharedPuzzle` already forwards
`cutStyle: payload.c` to `createNewGame` without inspecting it.

### Save file

`SerializedGameState.cutStyle` is `string`, so saves with
`cutStyle: 'wavy'` round-trip without a schema version bump. Existing
v1–v9 saves with `cutStyle: 'composable'` continue to work unchanged.

## Console helper

`window.__newComposableGame(config?)` in `main.ts`, modelled on the
existing `__startVennPuzzle` helper. Accepts a partial config:

```ts
__newComposableGame({
    cols?, rows?,                                   // default 8, 6
    baseCutGenerator?, baseCutConfig?,              // default 'sine' + sine config
    tabGenerator?, tabConfig?,                      // default 'classic' / {}
    minPieceArea?,                                  // default: framework default
    rotation?: 'none' | 'quarter-turn' | 'free',    // default 'none'
    imageSource?: 'random' | 'blank',               // default current preference
})
```

Defaults make a no-arg call (`__newComposableGame()`) start a 48-piece
Composable game with the same baseline parameters the existing sliders
would default to. Power users override what they need.

Routes through `startNewGame('composable', …)` so all the same
post-generation plumbing (analytics, autosave, image source, etc.)
applies.

## Preference migration: index → id

Four indexed preference stores migrate to string-id storage in
localStorage. Old integer values are translated on read; new writes
always use ids.

### New factory

In `src/ui/preference-store.ts`:

```ts
export function createIdPreferenceStore<T extends { id: string }>(opts: {
    key: string;
    presets: readonly T[];
    defaultId: string;
    /**
     * Pre-migration storage order. If a raw localStorage value is the
     * numeric string `'N'` and `legacyOrder[N]` exists, it migrates to
     * that id. Drop in a follow-up release once enough users have
     * loaded the migrated build.
     */
    legacyOrder: readonly string[];
}): IdPreferenceStore<T>;
```

`load()` returns a valid preset id:

1. If the raw value is a known id, return it.
2. Else if the raw value is a numeric string `N` and `legacyOrder[N]`
   exists, return that id (one-shot migration; the next `save()` writes
   the id form).
3. Else return `defaultId`.

`save(id)` writes the id string. `getPreset(id)` returns the matching
preset, or the default preset if the id isn't found.

A missing localStorage entry or any access error (the existing factory
already handles these via try/catch) collapses to the default. No JSON
parsing is involved — the stored value is a plain string.

### Per-store changes

Each store adds an `id` field to its preset interface and switches to
`createIdPreferenceStore`. The default index constant is replaced by a
default id constant.

| Store               | New `id` per preset                  | `defaultId`  | `legacyOrder`                                                                                                         |
|---------------------|--------------------------------------|--------------|-----------------------------------------------------------------------------------------------------------------------|
| `cut-styles.ts`     | already has `id`; add `'wavy'`       | `'classic'`  | `['classic', 'fractal', 'composable']`                                                                                |
| `puzzle-sizes.ts`   | `'24' / '48' / '96' / '192'`         | `'48'`       | `['24', '48', '96', '192']`                                                                                           |
| `background-colour.ts` | slug of label: `'midnight'`, `'charcoal'`, `'slate'`, `'light'`, `'wood'`, `'green-felt'`, `'hot-pink'`, `'blush'`, `'peach'`, `'sage'`, `'sky'`, `'lavender'` | `'midnight'` | same as the id list, in that order                                                                                    |
| `merge-tolerance.ts` | `'strict' / 'forgiving' / 'normal'`  | `'normal'`   | `['strict', 'forgiving', 'normal']` (matching the existing append-only storage order documented in that file's docstring) |

### Unknown-id fallback

If `load()` returns a valid id but that id isn't in the *visible* subset
(only applicable to cut-style + composable on prod), the dialog opens
with the default highlighted. The stored preference is **not** rewritten
unless the user picks a new option. This keeps a dev-only Composable
choice intact for the same user's next dev-deploy load.

For all other "value isn't in presets" cases (typos, future renames),
`load()` itself returns the default id — the stored value is rewritten
the next time the user changes that preference.

### Knock-on simplifications

- `findCutStyleIndex()` removed — callers pass ids directly.
- `getSortedPresets()` in `merge-tolerance.ts` no longer needs a
  `storageIndex` field; sorting by `displayOrder` is enough.
- `CutStylePickerOptions.selectedIndex` and
  `NewGameDialogOptions.selectedCutStyleIndex` → `selectedCutStyleId`
  (and similarly for size). `NewGameSelection` carries ids.
- `main.ts`'s `getCutStyleOption(idx).id` calls disappear — `load()`
  already returns the id directly, so the round-trip through
  `getCutStyleOption` to pull `.id` is no longer needed.

### Migration safety

Because `legacyOrder` captures the pre-migration order, the loader
correctly translates *any* historical saved integer regardless of the
new ordering. Adding Wavy between Fractal and Composable does not
disturb the legacy mapping — a saved `'2'` resolves to `'composable'`
(its meaning at write time), not to Wavy's position in the new array.

A user with `puzzle-cut-style = '2'` on a production build:

1. `load()` reads `'2'`, looks up `legacyOrder[2]` → `'composable'`.
2. Returns `'composable'` to the dialog.
3. Dialog notices `'composable'` isn't in `getVisibleCutStyleOptions()`,
   pre-selects the default (Classic) but does not rewrite storage.
4. If the user picks Classic, the next `save('classic')` overwrites the
   `'2'` with `'classic'`, completing the migration.
5. If the user later opens the same browser on a dev-deploy, `load()`
   returns whatever is in storage at that point — `'classic'` if they
   saved, still `'2'`→`'composable'` otherwise.

## Files touched

### New / heavily changed

- `src/game/cut-styles.ts` — add Wavy option, add `isComposableVisible`,
  `getVisibleCutStyleOptions`, switch to `createIdPreferenceStore`.
- `src/game/cut-style-strategies.ts` — add `wavyStrategy`.
- `src/ui/preference-store.ts` — add `createIdPreferenceStore`.
- `src/ui/new-game-dialog.ts` — picker reads filtered options, free
  rotation gated on `'wavy' || 'composable'`, no composable section
  rendered for wavy, selectedCutStyleId.
- `src/ui/cut-style-picker.ts` — accept `selectedCutStyleId` instead of
  index.
- `src/main.ts` — `rotationMode` derivation widens, add
  `__newComposableGame` helper, pass ids around, slider→generator
  adapter is unchanged.
- `src/ui/info-modal.ts` — replace Composable bullet with Wavy bullet,
  move Free rotation sub-bullet.

### Light touches

- `src/sharing/share-link.ts` — `'wavy'` added to `c` union and
  `isValidPayload`. No `cf` for wavy.
- `src/game/puzzle-sizes.ts` — add `id` to each option, switch store.
- `src/ui/background-colour.ts` — add `id` to each preset, switch store.
- `src/ui/merge-tolerance.ts` — add `id` to each preset, switch store,
  drop `storageIndex` from `getSortedPresets`.

### Tests

- `src/ui/preference-store.test.ts` — extend with `createIdPreferenceStore`
  cases (known id / legacy integer / unknown value / JSON or storage
  failure).
- `src/game/cut-styles.test.ts` — Wavy option present, ordering,
  `getVisibleCutStyleOptions()` filtering behaviour for both deploy
  tiers (`import.meta.env` stubs).
- New `src/game/cut-style-strategies.test.ts` (no existing one) —
  Wavy's derived config matches spec for canonical grids; `minPieceArea
  = avgPieceArea / 4`; `state.composableConfig` is `undefined` after
  init via `createNewGame`.
- `src/sharing/share-link.test.ts` — encode/decode a `c: 'wavy'`
  payload without `cf`; existing legacy-composable translator cases
  unchanged.
- `src/ui/new-game-dialog.test.ts` — composable filtered out when
  `isComposableVisible` returns false; Free rotation sub-checkbox
  appears for Wavy (and for Composable when visible).
- `src/ui/info-modal.test.ts` — Wavy bullet present, Composable bullet
  absent.
- Migration cases for puzzle-sizes / background-colour / merge-tolerance:
  one "old integer round-trips to correct id" case per store, alongside
  the existing tests updated to use ids.

## Open risks

- **Cache of `import.meta.env.BASE_URL`**: visibility is computed once
  at module load. If Vite ever serves multiple BASE_URLs from one bundle
  (it doesn't today), this would need to become a function call per
  read. Acceptable risk.
- **Wavy formula stability**: as called out above, changing
  `hf = cols/2` / `va = 0.5` etc. would change every existing Wavy
  share-link. Treat the formula as part of the schema; mint a new id
  rather than mutate.
- **Legacy migration window**: `legacyOrder` arrays stay until we're
  confident no users have lingering integer preferences. Concretely,
  drop them in a follow-up no sooner than ~3 months after this PR ships.
