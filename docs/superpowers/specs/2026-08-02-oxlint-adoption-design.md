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

**`no-console` overrides.** 26 of the 27 hits are in `.test.ts` files (console
stubs and spies); the 1 remaining is `src/diagnostics.ts`, where console
output is the feature. Both go in an `overrides` block rather than 27 inline
comments — the policy is stated once instead of accreting, which is the
pattern the issue complains about.

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

## The 108 violations to clear

Under the final config, in commit groups:

| Rule | Count | Notes |
|---|---|---|
| `unicorn/no-array-sort` | 27 | highest value — see below |
| `typescript/require-array-sort-compare` | 13 | same group |
| `eslint/no-shadow` | 11 | review each |
| `oxc/approx-constant` | 9 | hardcoded `Math.PI` approximations; review |
| `unicorn/prefer-add-event-listener` | 8 | mechanical |
| `unicorn/no-array-reverse` | 8 | mechanical |
| `unicorn/no-useless-spread` | 5 | autofixable |
| `unicorn/no-new-array` | 5 | mechanical |
| `typescript/consistent-return` | 5 | review |
| `unicorn/require-post-message-target-origin` | 4 | worth real attention — worker/SW messaging |
| `typescript/no-explicit-any` | 3 | review |
| long tail (7 rules) | 10 | |

**The sort group is the reason this PR is worth more than its config.** A
default `.sort()` on numbers is lexicographic — a real bug class in a geometry
codebase. Fixing a comparator can move generated geometry, so
`dcel-broad-phase-equivalence.test.ts` is the gate:

- green → the sorts were already effectively correct, and a latent bug class
  is gone;
- red → a real geometry bug is found. **Stop and report. Do not re-record the
  digest** — per CLAUDE.md, `vitest -u` rewrites all 11 digests silently and
  takes the alarm with them.

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
