# Adopt oxlint

Closes #502.

## Problem

The repo has no linter, but 17 `eslint-disable` comments across `src/` read as
active suppressions. CI runs `tsc` and `vitest` only. New suppressions keep
getting added by analogy, for rules nobody ever enabled.

## Decision: oxlint, not ESLint

The issue proposes `eslint` + `typescript-eslint`. Both were evaluated; oxlint
wins on this codebase:

- **Dependency surface.** One binary package plus platform optional deps,
  against ESLint + typescript-eslint's transitive tree. This repo already
  demonstrates it cares about supply chain — SHA-pinned actions, Dependabot
  cooldowns with a written rationale, a CSP commit two commits back.
- **Speed.** 2.4s for 72k lines *including* type-aware rules. ESLint with
  `projectService` on 359 files is a different order of magnitude.
- **The existing 17 comments keep working unchanged.** Verified: oxlint honors
  `eslint-disable` comment syntax. Every suppressed line is absent from
  results; the reported hits are all at other lines.

What we give up: oxlint's JS plugin API is alpha, so a custom rule (e.g.
enforcing CLAUDE.md's sub-PRNG invariant) is not realistically available. That
is hypothetical; the wins are measured.

## Type-aware linting is in scope

`oxlint-tsgolint@7.0.2001` embeds TypeScript 7.0.2 — exactly this repo's
`~7.0.2` pin. It went stable 2026-07-22.

It is included for one concrete reason, not for completeness: **it is what
makes all 17 disables load-bearing.** Without it,
`typescript/only-throw-error` cannot fire, and
`--report-unused-disable-directives` flags
`src/puzzle/topology/traced-tab-loader.test.ts:148` as an unused directive.
With it, that directive is real.

## Measured violation volume

The issue calls this "unknown until it is run once". Run once, per category
(non-type-aware, whole `src/`):

| Tier | Violations |
|---|---|
| `correctness` (default) | 12 |
| `+ suspicious` | 225 |
| `+ pedantic` | 1,632 |
| `+ style` | 25,142 |
| `all` | 28,165 |
| `all` + vitest/promise/import plugins | 38,955 |

`style` is a non-starter and not a close call: `no-magic-numbers` 7,241,
`id-length` 6,450, `capitalized-comments` 3,226, `sort-keys` 2,065,
`no-ternary` 185. It also contains `max-lines` and `max-lines-per-function`,
which the issue itself argues against — a threshold is a number the next
feature raises by ten.

## `--fix` is not safe to run blindly

oxlint documents three fix tiers — `--fix` ("do not alter program behavior"),
`--fix-suggestions` ("may alter behavior or may not match your intent") and
`--fix-dangerously`. Everything below came from plain `--fix`, the tier that
promises behavior preservation.

Verified by running `--fix` on a copy of `src/` with a working project setup,
then running `tsc` and the suite. Two real defects, both from rules that
reason about declared types in a codebase that deliberately guards against
runtime values violating them:

**1. Behavior change in the untrusted share-link path.**
`typescript/no-unnecessary-boolean-literal-compare` rewrote
`src/sharing/share-link.ts:682`:

```diff
- if (c.borderless !== undefined) cf.bl = c.borderless === true;
+ if (c.borderless !== undefined) cf.bl =  c.borderless;
```

`c.borderless` is *declared* `boolean | undefined`; at runtime it is decoded
from a share link and can be anything. The `=== true` was a deliberate
coercion guard. The test `encodes a non-boolean composable borderless as false
rather than emitting an undecodable link` goes red. (The emitted double space
is oxlint's, verbatim.)

**2. Broken compile.** `typescript/no-unnecessary-type-assertion` removed a
cast at `src/pwa/sw-error-bridge.ts:87-88` that `tsc` requires, producing two
`TS2769` errors on `addEventListener` overload resolution. The rule's
"unnecessary" judgment disagrees with the project's own compiler.

Both rules are therefore **off in the config, with rationale comments** — not
suppressed per-site, because the incompatibility is with the codebase's threat
model, not with individual lines.

Type assertions erase at runtime, so the other 40
`no-unnecessary-type-assertion` hits (all in `.test.ts`, removing
intent-signaling `as any` from tests that deliberately feed invalid shapes)
were runtime no-ops. They are not the reason the rule is off; defect 2 is.

### This is not an oxlint-vs-ESLint difference

Both offending rules are `--fix`-able in typescript-eslint too, carrying the
same 🔧 marker, and neither page warns that the fix can change behavior when
declared types are inaccurate — `no-unnecessary-boolean-literal-compare`'s
only caveat is about `strictNullChecks` being *disabled*, which does not apply
here (`strict: true`). **ESLint would have made the identical `=== true`
rewrite.** Choosing ESLint would not have avoided this.

If anything oxlint's stated contract is the stricter of the two: ESLint has
two tiers (fixable / suggestions) and no explicit behavior-preservation
promise, where oxlint has three and documents one. What happened here is that
oxlint broke its own `--fix` contract on these two rules. That is a bug rather
than a policy, and there is precedent for it being treated as one —
oxc-project/oxc#22860 is a closed report of exactly this shape
(`prefer-optional-chain` `--fix` changing behavior). Both findings are worth
reporting upstream.

The durable lesson is about type-aware autofix generally: it trusts declared
types, and this codebase deliberately does not, at the decode boundary.

### With both rules off, `--fix` is safe here

Verified, not assumed. Under the config below, `--fix` touches 4 files, `tsc`
reports 0 errors, and the suite is green (2,712 passed, 2 skipped). `lint:fix`
is still a local convenience rather than something CI runs, and `npm run
build` + `npm test` remain the backstop.

## Config

`.oxlintrc.json` at repo root. `correctness` + `suspicious` as error, plus the
three rules the codebase already assumes, minus six with stated reasons:

| Rule | Hits | Status |
|---|---|---|
| `no-console` | 27 | **error** (with overrides, below) |
| `typescript/no-explicit-any` | 3 | **error** |
| `typescript/only-throw-error` | 0 | **error** (guards an existing disable) |
| `no-underscore-dangle` | 74 | off — `__reproPuzzle` dev hooks are deliberate |
| `unicorn/consistent-function-scoping` | 71 | off — noise |
| `typescript/no-unsafe-type-assertion` | 334 | off — flags every `as` |
| `typescript/unbound-method` | 81 | off — noise |
| `typescript/no-unnecessary-type-assertion` | 46 | off — breaks `tsc` (above) |
| `typescript/no-unnecessary-boolean-literal-compare` | 1 | off — wrong fix (above) |
| `unicorn/no-array-sort` | 27 | off — see false positives below |
| `unicorn/no-array-reverse` | 8 | off — false-positives on `Curve.reverse()` |
| `unicorn/require-post-message-target-origin` | 4 | off — fix would break the worker path |
| `typescript/consistent-return` | 5 | off — fix would weaken exhaustiveness |

### Five false-positive families

Every violation was inspected rather than counted. Five rule families fire on
this codebase's domain types and are wrong in every instance. The shared cause
is that the `suspicious` category is largely **non-type-aware**, so it matches
on method *names* and syntax without knowing the receiver's type:

1. **`unicorn/no-array-reverse` on `Curve.reverse()`.** `Curve` is a class
   (`src/puzzle/topology/curve.ts:532`) whose `reverse(): Curve` builds and
   returns a *new* Curve — it does not mutate. The rule reads the name and
   assumes `Array#reverse()`. Both source hits (`dcel.ts:688`,
   `apply-tabs.ts:125`) are bogus; `toReversed()` does not exist on `Curve`.

2. **`unicorn/require-post-message-target-origin` on worker messaging.** All 4
   hits are `workerScope.postMessage()`, `worker.postMessage()` and SW
   `client.postMessage()` — whose signature is `(message, transfer?)`, with no
   `targetOrigin` parameter. Only `window.postMessage()` has one. The rule's
   suggested fix, `, workerScope.location.origin`, would pass a string where a
   transfer list is expected: **a runtime TypeError on the generation-worker
   path.** The most dangerous fix found in this evaluation.

3. **`typescript/consistent-return` on exhaustive switches.** All 5 hits
   (`procedural-generator.ts` ×4, `generation-core.ts`) are switches over an
   enum where every member returns, with a declared return type. `tsc` proves
   exhaustiveness under `strict`. Satisfying the rule means adding either dead
   code or a `default` branch — and a `default` *removes* the compile error
   that a newly-added `Dir` member would otherwise cause. The fix trades a
   compile-time guarantee for runtime dead code.

4. **`oxc/approx-constant` on decimal fixtures.** All 9 hits are test data —
   `3.14159265`, `2.71828182`, `99.999999`, `-1.23456` — chosen as awkward
   decimals to exercise coordinate quantization and number formatting, not as
   approximations of π or e. Rewriting them to `Math.PI` would change the
   inputs under test.

5. **`unicorn/no-array-sort` finds no real defect.** Its signal is in-place
   mutation of an array someone else holds. Of 5 source hits, 4 already sort a
   fresh copy (`.filter().sort()`, `[...x].sort()`), and the fifth
   (`auto-group.ts:113`) sorts arrays inside a `Map` constructed two lines
   above and discarded immediately. 27 further hits are in tests. Zero
   defects in 32 violations, and `toSorted()` would add an allocation to
   geometry paths that deliberately spread when they want a copy.

**Overrides.** One `overrides` block, `["**/*.test.ts", "src/diagnostics.ts"]`:

- `no-console` — 26 of the 27 hits are console stubs and spies in tests; the
  1 remaining is `src/diagnostics.ts`, where console output is the feature.
- `oxc/approx-constant` — family 4 above; all 9 hits are test fixtures. Left
  enabled for source, where a stray `3.14159` would be worth flagging.

Stating the policy once beats 35 inline comments, which is the accretion
pattern the issue objects to.

`typescript/require-array-sort-compare` is deliberately **not** in the
override even though all 13 hits are in tests: a missing comparator is a
latent wrong-expectation, and adding `(a, b) => a - b` is cheap.

The source tree keeps a strict global `no-console`. The existing disables in
`dev-hooks.ts`, `run-with-error-report.ts` and `game/init.ts` are source
files and stay load-bearing.

Override globs resolve relative to the config file's directory; verified that
`src/diagnostics.ts` needs the config at repo root (a config elsewhere needs
`**/diagnostics.ts`).

## Disable audit (issue step 5)

17 disables → **13 load-bearing, 4 deleted**. The 4 are the `no-console`
disables in `src/puzzle/topology/tab-rejection-measurement.test.ts` (lines 57,
59, 102, 104), made redundant by the test-file override. Verified via
`--report-unused-disable-directives`, which reports exactly those 4 under the
final config and nothing else.

Nothing is grandfathered: every remaining disable corresponds to a rule that
is actually enabled.

## The two sort rules are unrelated to each other

An earlier draft of this design treated `unicorn/no-array-sort` and
`typescript/require-array-sort-compare` as one 40-violation "sort group" and
called it a latent lexicographic-comparison bug class. That was wrong, and
reading the actual diagnostics corrected it:

- **`unicorn/no-array-sort`** — *"Use `Array#toSorted()` instead of
  `Array#sort()`. `Array#sort()` mutates the original array."* A mutation
  preference, not a comparison concern at all. Its sibling is
  `unicorn/no-array-reverse` (`toReversed()`), not the comparator rule.
- **`typescript/require-array-sort-compare`** — *"Require 'compare'
  argument."* This is the lexicographic-bug rule. **All 13 hits are in
  `.test.ts` files; zero in source.** Production code already passes a
  comparator everywhere it sorts.

So there is no latent geometry bug class here. Auditing all 8 source sites
(detailed as family 5 and family 1 above) found **zero real defects**: four
already sort a fresh copy, one sorts a Map discarded two lines later, and the
remaining three are `Curve.reverse()` false positives. `unicorn/no-array-sort`
and `unicorn/no-array-reverse` are therefore off entirely, not merely
overridden in tests.

What survives from this area is one genuine, modest item: **13 test-file sorts
gain an explicit comparator.** `typescript/require-array-sort-compare` is
type-aware, which is exactly why it is the one rule of the group that does not
misfire.

The geometry-digest concern raised in earlier drafts is moot — no geometry
source is modified by this PR. `dcel-broad-phase-equivalence.test.ts` remains
the gate for the full suite run in Task 5, and a red digest still means **stop
and report, never `vitest -u`** — per CLAUDE.md it rewrites all 11 silently
and takes the alarm with it.

## The 55 violations to clear

Under the final config, in commit groups:

| Rule | Count | Notes |
|---|---|---|
| `typescript/require-array-sort-compare` | 13 | test-only; add comparators |
| `eslint/no-shadow` | 11 | 10 tests, 1 source (`traces/index.ts:94`) |
| `unicorn/prefer-add-event-listener` | 8 | `.onX =` clobbers prior handlers; real |
| `unicorn/no-useless-spread` | 5 | autofixable |
| `unicorn/no-new-array` | 5 | mechanical |
| `typescript/no-explicit-any` | 3 | review |
| `unicorn/no-useless-fallback-in-spread` | 2 | autofixable |
| `typescript/no-unnecessary-type-conversion` | 2 | review |
| `typescript/no-redundant-type-constituents` | 2 | `merge-tolerance.ts` |
| long tail (4 rules, 1 each) | 4 | |

Started at 28,165 for `all`; 108 after category selection; 55 after
inspecting every violation and removing five false-positive families.

## Scripts and CI

```json
"lint": "oxlint --type-aware",
"lint:fix": "oxlint --type-aware --fix"
```

CI gets `- run: npm run lint` **inside the existing `test` job**, not a new
job. The required-status-check context stays `test`, so the "Protect main"
ruleset needs no change — which matters, because per
`dependabot-auto-merge.yml` a required check that isn't mirrored in the
ruleset is a silently dropped gate.

`--report-unused-disable-directives` runs in CI too, so suppressions cannot
rot back into the state this issue describes.

## Risks

**tsgolint / TypeScript version coupling.** `oxlint-tsgolint` versions track a
TypeScript release (`7.0.2001` → TS 7.0.2; the scheme jumped from `0.25.0` to
`7.0.2000` at the stable release). Dependabot here merges unattended, so a TS
bump could drift from tsgolint's embedded compiler. Mitigation: a Dependabot
group covering `typescript`, `oxlint` and `oxlint-tsgolint` so they move
together in one reviewable PR.

**Type-aware is 11 days stable.** Mitigated by the config being ordinary
ESLint-compatible rule names — reverting to non-type-aware is deleting a flag,
and switching to ESLint entirely is a config port, not a rewrite.

**Memory on large codebases** is a documented tsgolint caveat. Not observed
here: the full type-aware run is 2.4s.

## Out of scope

No formatter (no Prettier/Biome). No `max-lines` guard on `main.ts` — that is
already a test asserting `main.ts` holds nothing but its imports and
`bootstrap()`, which needs no threshold and cannot be relaxed by accident.
