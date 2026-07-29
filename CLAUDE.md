# Repo conventions for Claude

## Keep the in-app help text correct

The info modal (`src/ui/info-modal.ts`) is the only in-app place where the
player learns how the app works — there is no separate README shown in the
UI. The goal is a **short, useful** modal: explain the things a player might
actually need explained, and leave out what they'd already expect.

The requirement is that the help text stays **correct**, not that every
user-visible behaviour is documented. When a change makes an existing
sentence in the **How to Play** or **Settings** sections
wrong or misleading, fix it in the same PR. When a change removes a feature
the modal describes, remove that description too.

Adding new copy is a judgment call, not an obligation. Add it only when a
player would plausibly be confused or miss the feature without it — a new
toolbar button, a new cut style or new option in the new-game dialog, a new
setting, or a non-obvious interaction or behaviour change. Do **not** add
copy for behaviour a user would naturally expect (e.g. "your zoom and pan
are remembered across reloads"); spelling out the obvious only makes the
modal longer and less useful.

If the change is purely internal (refactor, perf, bug fix with no visible
behaviour change), or the visible behaviour is what a player would already
expect, no help-text update is needed.

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

## bezier-js's pinned version is part of the geometry contract

The seeded PRNG above is not the only input to a reproduced puzzle. Cut
geometry comes out of bezier-js's numerics, and `package.json` allows any
6.x, so the version resolved in `package-lock.json` decides the piece paths
too. The tripwire is
`src/puzzle/topology/dcel-broad-phase-equivalence.test.ts`, which digests
the piece paths of 11 generator configurations.

A red digest there means something moved generated geometry. Work out what,
and decide whether to take or pin the bump — do **not** re-record. Those
digests are an external snapshot, so `vitest -u` rewrites all 11 without a
word and takes the alarm with them.

## Keep `main.ts` an entry point

`src/main.ts` is loaded by `index.html` as a side-effecting module, so
nothing in it can be imported or called by a test — importing it would boot
the app. It reached 1939 lines because it was also the composition root, and
every feature appended to it.

The composition root is now `src/app/bootstrap.ts`, which exports a function,
runs nothing on import, and has tests (`bootstrap.test.ts` asserts the wiring
order: global handlers first, rotation UI before the session, the `hashchange`
listener after boot is kicked off). **Put new wiring there, with a test.**

`src/main.test.ts` enforces that `main.ts` holds nothing but its two CSS
imports and the `bootstrap()` call. It is deliberately not a line-count cap —
a threshold is just a number the next feature raises by ten. If you find
yourself wanting to relax that assertion rather than clear it, the thing you
are adding belongs in `bootstrap.ts` or in a module it wires.
