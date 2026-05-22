# Repo conventions for Claude

## Keep the in-app help text in sync with features

The info modal (`src/ui/info-modal.ts`) is the only in-app place where the
player learns how the app works — there is no separate README shown in the
UI. When you add, remove, or change a user-visible feature, update the
modal's **How to Play**, **Cut Styles**, and/or **Settings** sections in the
same PR so the help text stays accurate.

Triggers for a help-text update include:

- New or removed toolbar button (icon + what it does).
- New or changed interaction (gesture, keyboard shortcut, drag behaviour).
- New cut style, or a new option on an existing cut style (e.g. a checkbox
  in the new-game dialog).
- New or renamed setting in the info modal itself.
- Behaviour change that a returning player would need to be told about
  (e.g. multi-select now being on by default for rotation puzzles).

If the change is purely internal (refactor, perf, bug fix with no visible
behaviour change), no help-text update is needed.

## Isolate new seeded randomness behind a sub-PRNG

The puzzle reproduces puzzles from a share link or save by replaying a
single seeded PRNG through `generateProceduralPuzzle`. The exact number
and order of `random()` calls during generation is a **reproducibility
contract**: adding, removing, or reordering calls silently breaks every
existing share link and save.

When you add a new feature that consumes `random()` (a new tab
generator, a new piece-layout variation, a new cosmetic jitter), don't
make those calls directly on the outer PRNG. Instead, draw **one** outer
value, use it to seed a local sub-PRNG, and make all internal calls
against the local stream:

```ts
import { createSeededRandom } from '../puzzle/seeded-random.js';

function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

function generate(random: () => number): SomeOutput {
    const subSeed = random();                                  // ONE outer call
    const local = createSeededRandom(seedFromFloat(subSeed));

    // All per-feature randomness comes from `local`.
    const paramA = local();
    const paramB = local() < 0.5;
    // ...
}
```

The outer stream advances by exactly one call regardless of how much
randomness the feature internally consumes. Future changes to the local
block — new parameters, reordered calls — affect that feature's output
for a given seed, but they do **not** disturb the rest of the puzzle's
seeded generation. Share links and saves stay valid for everything
except the changed feature's own output, which is the smallest possible
breakage.

Use this pattern whenever you can defer the outer-stream contract to a
smaller scope. The alternative — padding with reserved-but-unused outer
calls — caps your future flexibility (pick N reserved slots, need N+1
later, you're stuck) and still consumes shared outer state.

Don't retrofit this onto existing generators. Their current outer-call
counts are the contract; reshuffling them silently breaks every share
link that targets that generator.
