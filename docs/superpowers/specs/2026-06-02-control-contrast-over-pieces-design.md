# Strengthen control contrast over similarly-colored pieces

Closes #388

## Problem

The floating in-app controls (toolbar buttons and the per-piece rotation
buttons/handle) pick a light or dark **foreground** color to contrast with the
chosen **background** color, via `isLightColour()` in
`src/ui/background-colour.ts`. But contrast is only computed against the
background, never against the **pieces** that may sit under a control. When
light-toned pieces sit behind a light-foreground control (dark UI scheme), or
dark-toned pieces behind a dark-foreground control (light UI scheme), the
control's text/icon nearly disappears.

The controls already have a semi-transparent backing (`--ui-overlay`), but it
is both very faint **and tinted toward the foreground** (a white overlay under
white text in the dark scheme). That is backwards for contrast: it does nothing
to separate a light control from light pieces.

## Approach (decided)

Option B from the issue — a **stronger contrasting scrim in the tone opposite
the foreground**: a dark scrim under light controls, a light scrim under dark
controls. This was prototyped against the other options (faint-overlay status
quo, feathered glow/halo, hybrid) over deliberately challenging light and dark
piece imagery, and chosen as the clear winner for legibility while remaining
tasteful over plain bare-table backgrounds.

The `.deselect-button` already follows this idea informally (a hardcoded
`rgba(0,0,0,0.35)` dark scrim), which confirms the direction.

## Design

### Dedicated scrim variables — do NOT repurpose `--ui-overlay`

`--ui-overlay*` is shared with modal/dialog internals. `.size-picker-dialog`,
`.info-modal`, and `.bg-colour-panel` (and their children — size options,
preset options, the segmented control, the solve button, the close button)
explicitly redefine `--ui-overlay*` because those panels have their own dark
backgrounds. Globally inverting `--ui-overlay` to a strong opposite-tone scrim
would either leak into those panels or depend on every modal subtree overriding
it back — fragile and semantically muddy.

Instead, introduce a self-documenting trio used **only** by the
floating-over-pieces controls, defined in both scheme blocks of `src/style.css`:

```css
/* :root — dark scheme (light-foreground controls): dark scrim */
--ui-control-scrim:        rgba(0, 0, 0, 0.45);
--ui-control-scrim-hover:  rgba(0, 0, 0, 0.55);
--ui-control-scrim-active: rgba(0, 0, 0, 0.65);

/* [data-ui-scheme="light"] (dark-foreground controls): light scrim */
--ui-control-scrim:        rgba(255, 255, 255, 0.55);
--ui-control-scrim-hover:  rgba(255, 255, 255, 0.65);
--ui-control-scrim-active: rgba(255, 255, 255, 0.75);
```

The base values (0.45 dark / 0.55 light) are the approved mockup values;
hover/active step up proportionally, mirroring the existing overlay ramp.

### Controls that adopt the scrim

All floating controls that can sit directly over pieces. For each, the
`background` declaration (resting / `:hover` / `:active`) is repointed from
`var(--ui-overlay[-hover|-active])` to `var(--ui-control-scrim[-hover|-active])`:

1. `.new-game-button`
2. `.centre-view-button`
3. `.gather-pieces-button`
4. `.select-tool-button` (its blue `--active` *selected* state is left unchanged)
5. `.rotate-button`
6. `.rotate-handle`
7. `.deselect-button` — replaces its hardcoded `rgba(0,0,0,0.35/0.5/0.6)` with
   the scrim vars. This also fixes a pre-existing bug: in the light scheme its
   icon turns dark (`--ui-fg`) but the backing stayed dark, so it was unreadable
   over a light table. The scrim var flips correctly with the scheme.
8. `.bg-colour-button` — a floating toolbar button not named in the issue but
   subject to the same problem.
9. `.info-button` — likewise.

Items 8–9 are included so the toolbar stays visually consistent; this was
confirmed during brainstorming.

### Explicitly unchanged

- **Modal/dialog internals** continue to use `--ui-overlay*`.
- **Borders** (`--ui-border*`) and **`backdrop-filter: blur(8px)`** are
  unchanged; the scrim provides the added contrast.
- **No new JS / no contract impact.** No TypeScript sets these backgrounds; the
  change is pure CSS. It touches no seeded-PRNG call sequence and no save
  format, so share links and saves are unaffected.

### Help text

No update. Per `CLAUDE.md`, in-app help-text updates trigger on new/removed
toolbar buttons, new interactions, new settings, or new cut styles. This is
cosmetic legibility polish to existing controls — it changes nothing about what
they do or how they are operated, and the info modal documents none of this
styling. (Recorded here so a reviewer can veto if they disagree.)

## Files touched

- `src/style.css` — add the scrim variable trio to the `:root` and
  `[data-ui-scheme="light"]` blocks; repoint the `background` declarations of
  the nine controls above.

## Verification

CSS-only, so no unit test (asserting computed variable values would be brittle
and low-value). Verify visually:

1. `npm run dev`, then in both UI schemes (a dark preset such as Midnight and a
   light preset such as Light) confirm every listed control's text/icon stays
   clearly legible when same-tone pieces sit directly behind it.
2. Confirm the controls do not look heavy/boxy over the plain bare table in
   either scheme.
3. Optionally capture before/after screenshots (Playwright) for the PR.

## Acceptance criteria (from the issue)

- [x] Toolbar and rotation controls remain clearly legible when pieces of the
      same tone as the controls' foreground sit directly behind them.
- [x] Works in both light and dark UI schemes.
- [x] Doesn't make controls look heavy/boxy over plain backgrounds.
