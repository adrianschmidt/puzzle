# Adopt oxlint (#502) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add oxlint with type-aware linting to a repo that has 17 inert `eslint-disable` comments and no linter, clear the 55 real violations, and gate CI on it.

**Architecture:** One `.oxlintrc.json` at the repo root selecting the `correctness` + `suspicious` categories, minus ten rules that are wrong for this codebase (each with a written reason), plus the three rules the existing disable comments already assume. `oxlint` is a single Rust binary; type-aware rules come from `oxlint-tsgolint`, which embeds TypeScript 7.0.2 — the version this repo already pins. The lint step is added to the **existing** CI `test` job, so the required-status-check context stays `test` and the branch ruleset needs no change.

**Tech Stack:** `oxlint@1.76.0`, `oxlint-tsgolint@7.0.2001`, npm scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-02-oxlint-adoption-design.md`

## Global Constraints

- **The config is the deliverable, not a maximal rule set.** Ten rules are deliberately off. Do **not** re-enable any of them to "fix more things" — five were verified to be false positives on this codebase's domain types, and two were verified to break the build. Each has a comment in the config saying so. If a rule looks wrongly disabled, read the spec section before touching it.
- **Never add `--type-check`.** It makes tsgolint resolve `src/pwa/sw.ts` against a project without the `WebWorker` lib (that file is excluded from `tsconfig.json` and covered by `tsconfig.sw.json`), producing 10 bogus `TS2339`/`TS7006` errors. Verified: without the flag, zero TS errors leak and zero diagnostics fire on `sw.ts`.
- **Geometry tripwire:** `src/puzzle/topology/dcel-broad-phase-equivalence.test.ts` digests must stay green. If it goes red, a task changed generated geometry — fix the task, **NEVER** `vitest -u` those snapshots. Per CLAUDE.md it silently rewrites all 11 and takes the alarm with it.
- **PRNG contract:** no task here may add, remove, or reorder `random()` calls. None of the 55 violations is in a generator's random path, so this should never come up — if a fix seems to require it, stop.
- **Plan code is a sketch, not a spec** (`feedback_plan_test_code_is_untrusted`): before applying a fix, read the actual code at that line — line numbers drift as earlier tasks land. Re-run `npm run lint` to get current positions rather than trusting the line numbers below.
- Test files live next to the source they test.
- American English in all code/identifiers.
- No info-modal changes: this PR has no user-visible behavior change, so per CLAUDE.md no help text is affected.
- Commit style: conventional commits, match `git log`. Branch: `chore/502-adopt-oxlint` (already exists, has the two spec commits).
- `npm test` runs the suite; `npm run build` runs `tsc` + `tsc -p tsconfig.sw.json` + vite build. **Both must pass at the end of every task.**
- PR body must include `Closes #502` as a standalone line at the top.

---

### Task 1: Dependencies, config, and scripts

Lands the linter with the codebase still failing it. CI is deliberately **not** wired up until Task 7, so `main` never sees a red required check.

**Files:**
- Create: `.oxlintrc.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run lint` and `npm run lint:fix`. Later tasks rely on `npm run lint` exiting non-zero while violations remain, and on its output format `path:line:col: error rule(name): message`.

- [ ] **Step 1: Install the two devDependencies**

```bash
npm install --save-dev --legacy-peer-deps oxlint@1.76.0 oxlint-tsgolint@7.0.2001
```

`--legacy-peer-deps` matches what CI uses (`npm ci --legacy-peer-deps`).

- [ ] **Step 2: Create `.oxlintrc.json`**

Reasons are inline on purpose — a disabled rule with no stated reason gets re-enabled by the next person.

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "error"
  },
  "rules": {
    // The three rules the codebase's existing eslint-disable comments assume.
    "no-console": "error",
    "typescript/no-explicit-any": "error",
    "typescript/only-throw-error": "error",

    // --- Off: noise, at a volume that would drown the signal. ---
    // 74 hits. The `__reproPuzzle` / `__newComposableGame` dev-console hooks
    // are deliberately underscore-prefixed to mark them as non-API.
    "no-underscore-dangle": "off",
    // 71 hits, overwhelmingly on helpers that are clearer where they are.
    "unicorn/consistent-function-scoping": "off",
    // 334 hits — flags every `as`, including the guarded decode casts.
    "typescript/no-unsafe-type-assertion": "off",
    // 81 hits, almost all on vi.fn()/spy references in tests.
    "typescript/unbound-method": "off",

    // --- Off: verified to produce WRONG fixes on this codebase. ---
    // Removed a cast tsc requires at sw-error-bridge.ts:87 (2x TS2769).
    "typescript/no-unnecessary-type-assertion": "off",
    // Rewrote `cf.bl = c.borderless === true` to `cf.bl = c.borderless` in
    // share-link.ts. That `=== true` is a deliberate coercion guard: the value
    // is decoded from an untrusted share link, so its declared `boolean` type
    // is a claim, not a fact. Turned a share-link test red.
    "typescript/no-unnecessary-boolean-literal-compare": "off",

    // --- Off: false positives on this codebase's domain types. ---
    // `Curve.reverse(): Curve` (curve.ts:532) builds and returns a NEW Curve;
    // it does not mutate. This rule is non-type-aware and matches the method
    // name. `toReversed()` does not exist on Curve.
    "unicorn/no-array-reverse": "off",
    // Zero real defects in 32 hits: every source site already sorts a fresh
    // copy (.filter().sort(), [...x].sort()) or a Map discarded two lines
    // later. toSorted() would add allocations to geometry paths.
    "unicorn/no-array-sort": "off",
    // All 4 hits are Worker / ServiceWorker-Client postMessage, whose
    // signature is (message, transfer?) — there is no targetOrigin parameter;
    // only window.postMessage has one. The suggested fix would pass a string
    // where a transfer list is expected and throw at runtime.
    "unicorn/require-post-message-target-origin": "off",
    // All 5 hits are exhaustive switches over an enum with a declared return
    // type; tsc already proves every path returns. Satisfying this rule means
    // dead code, and adding a `default` REMOVES the compile error that a newly
    // added enum member would otherwise cause.
    "typescript/consistent-return": "off"
  },
  "overrides": [
    {
      "files": ["**/*.test.ts", "src/diagnostics.ts"],
      "rules": {
        // 26 of 27 hits are console stubs and spies in tests; the last is
        // diagnostics.ts, where console output is the feature. Source keeps a
        // strict global no-console.
        "no-console": "off",
        // All 9 hits are deliberately awkward decimal fixtures (3.14159265,
        // 2.71828182, 99.999999, -1.23456) that exercise coordinate
        // quantization and number formatting. They are not approximations of
        // pi or e; rewriting them to Math.PI would change the inputs under
        // test. Left ON for source, where a stray 3.14159 would be real.
        "oxc/approx-constant": "off"
      }
    }
  ]
}
```

- [ ] **Step 3: Add the scripts to `package.json`**

Insert after `"preview"`, keeping the existing key order otherwise:

```json
    "lint": "oxlint --type-aware --report-unused-disable-directives",
    "lint:fix": "oxlint --type-aware --report-unused-disable-directives --fix",
```

`--report-unused-disable-directives` is on from the start so a suppression can never rot back into the state #502 describes. It reports at warning severity, so it will not fail the build on its own — Task 7 handles the four it finds.

- [ ] **Step 4: Verify the config selects exactly what the spec says**

Run: `npm run lint`

Expected: exit code 1, and **55 errors** plus 4 `Unused eslint-disable directive` warnings. Confirm the rule breakdown matches:

```
13 typescript(require-array-sort-compare)   11 eslint(no-shadow)
 8 unicorn(prefer-add-event-listener)        5 unicorn(no-useless-spread)
 5 unicorn(no-new-array)                     3 typescript(no-explicit-any)
 2 unicorn(no-useless-fallback-in-spread)    2 typescript(no-unnecessary-type-conversion)
 2 typescript(no-redundant-type-constituents)
 1 each: restrict-template-expressions, no-useless-default-assignment,
         no-misused-spread, no-extraneous-class
```

A different total means the config drifted — reconcile before continuing.

- [ ] **Step 5: Verify `sw.ts` is covered but uncorrupted**

Run: `npm run lint 2>&1 | grep -c 'sw\.ts'`
Expected: `0` — no diagnostics, and crucially no `TS2339`/`TS7006` errors, which would mean `--type-check` crept in.

- [ ] **Step 6: Commit**

```bash
git add .oxlintrc.json package.json package-lock.json
git commit -m "build: add oxlint with type-aware linting

Selects correctness + suspicious, plus the three rules the codebase's 17
existing eslint-disable comments already assume. Ten rules are off with
inline reasons: four for noise volume, two verified to emit fixes that break
the build, and four that are false positives on this codebase's domain types.

No CI step yet — the tree does not pass its own linter until the violations
are cleared."
```

---

### Task 2: Autofix pass

Clears the 8 mechanically-safe violations. Verified in advance: under this exact config, `--fix` touches 4 files, `tsc` reports 0 errors, and the full suite stays green.

**Files:**
- Modify: `src/puzzle/topology/curve.ts`, `src/puzzle/topology/generator.ts`, `src/puzzle/topology/holes.ts`, `src/app/install-toolbar.test.ts`

- [ ] **Step 1: Run the autofixer**

Run: `npm run lint:fix`

- [ ] **Step 2: Review every changed line before trusting it**

Run: `git diff`

Expected: exactly 4 files, ~8 changed sites. Two geometry files are touched — confirm the changes are the redundant-copy removals below and nothing else.

`curve.ts` (×4) — `slice()` already returns a new array, so the spread was a second copy:

```diff
-                new Curve([...this.segments.slice(0, segmentIndex)]),
+                new Curve(this.segments.slice(0, segmentIndex)),
```

`generator.ts` (×2) — spreading a falsy value into an object literal adds nothing:

```diff
-        ...(config?.baseCutConfig ?? {}),
+        ...config?.baseCutConfig,
```

`holes.ts` (×1) — `Set` accepts an iterable directly. `install-toolbar.test.ts` (×1) — a `= undefined` default parameter.

**If the diff contains anything else — particularly a removed `as` cast or a removed `=== true` — stop.** That means a disabled rule got re-enabled; revert and check `.oxlintrc.json` against Task 1.

- [ ] **Step 3: Verify the geometry tripwire**

Run: `npx vitest run src/puzzle/topology/dcel-broad-phase-equivalence.test.ts`
Expected: 11 passed. These edits are provably allocation-only, so a red digest here means something else changed — **stop and report, do not `vitest -u`.**

- [ ] **Step 4: Verify the build and full suite**

Run: `npm run build && npm test`
Expected: 0 tsc errors; 2712 passed, 2 skipped.

- [ ] **Step 5: Verify the count dropped**

Run: `npm run lint`
Expected: 47 errors remaining (55 − 8).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor: drop redundant copies and defaults oxlint can prove unused

Autofix only: slice() already returns a new array so the surrounding spread
was a second copy, spreading a falsy value into an object literal adds
nothing, and Set takes an iterable directly. No behavior change; the geometry
digests are unmoved."
```

---

### Task 3: Add comparators to 13 test sorts

`typescript/require-array-sort-compare` is the one rule in this area that does not misfire, because it is type-aware. A bare `.sort()` on numbers compares them as strings — `[2, 10]` sorts to `[10, 2]`. All 13 hits are in tests, so nothing user-facing changes; the value is that these assertions stop depending on the array happening to be single-digit.

**Files:**
- Modify: `src/puzzle/topology/strip-border-ring.test.ts` (3), `src/interaction/selection-manager.test.ts` (3), `src/puzzle/composable/compose.test.ts` (1), `src/persistence/storage.test.ts` (1), `src/model/helpers.test.ts` (1), `src/interaction/pointer-router.test.ts` (1), `src/interaction/marquee-controller.test.ts` (1), `src/game/merge-detection.test.ts` (1), `src/game/reconstruct-groups.test.ts` (1)

- [ ] **Step 1: List the current sites**

Run: `npm run lint 2>&1 | grep require-array-sort-compare`

Work from this output, not the line numbers above — Task 2 shifted some files.

- [ ] **Step 2: Add a numeric comparator at each site**

Every one of the 13 sorts an array of numbers (piece IDs and indices). The fix is the same shape throughout:

```diff
-        const ids = [...group.pieces.keys()].sort();
+        const ids = [...group.pieces.keys()].sort((a, b) => a - b);
```

Read each call site first: if any sorts strings rather than numbers, the correct fix is `.sort((a, b) => a.localeCompare(b))` instead. Do not blanket-apply the numeric form.

- [ ] **Step 3: Verify the tests still pass and still mean something**

Run: `npm test`
Expected: 2712 passed, 2 skipped.

A test that passed before and after proves the arrays were single-digit and the ordering coincided. Per `feedback_plan_test_code_is_untrusted`, sanity-check one: temporarily invert a comparator to `(a, b) => b - a` and confirm that test fails, then revert.

- [ ] **Step 4: Verify the count dropped**

Run: `npm run lint`
Expected: 34 errors remaining (47 − 13).

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "test: give numeric sorts an explicit comparator

Array#sort() with no comparator compares numbers as strings, so these
assertions only held because the IDs were single-digit. Behaviour is
unchanged today; the tests stop being sensitive to piece counts crossing 10."
```

---

### Task 4: Resolve 11 shadowed bindings

Ten are in tests, one is in source. `no-shadow` catches an inner binding hiding an outer one of the same name — legal, but it makes the inner scope's reads ambiguous to a reader.

**Files:**
- Modify: `src/puzzle/composable/traces/index.ts` (source), `src/puzzle/fractal/index.test.ts` (5), `src/pwa/register.test.ts` (2), `src/game/init.test.ts` (1), `src/puzzle/composable/compose.test.ts` (1), `src/ui/info-modal.test.ts` (1)

- [ ] **Step 1: List the current sites**

Run: `npm run lint 2>&1 | grep no-shadow`

- [ ] **Step 2: Fix the source site first**

`src/puzzle/composable/traces/index.ts` — the `finiteAt` helper takes a parameter named `path`, shadowing the outer `path` array being validated a few lines above. The parameter is a landmark key like `"neck.left"`, not a path, so the rename also improves it:

```diff
-    const finiteAt = (path: string, v: unknown): void => {
+    const finiteAt = (key: string, v: unknown): void => {
         if (typeof v !== 'number' || !Number.isFinite(v)) {
-            fail(`landmarks.${path} is not a finite number`);
+            fail(`landmarks.${key} is not a finite number`);
         }
     };
```

Update every `finiteAt` call site in that file if any pass a named variable.

- [ ] **Step 3: Fix the ten test sites**

Rename the inner binding at each. Prefer a name that says what the inner value *is* rather than mechanically suffixing — `result` shadowed by `result` becomes e.g. `regenerated`, not `result2`. Read each site; these are not uniform.

- [ ] **Step 4: Verify**

Run: `npm run build && npm test`
Expected: 0 tsc errors; 2712 passed, 2 skipped. Renames are compile-checked, so `tsc` catches a missed reference.

- [ ] **Step 5: Verify the count dropped**

Run: `npm run lint`
Expected: 23 errors remaining (34 − 11).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor: rename shadowed bindings

Renames inner bindings that hid an outer one of the same name. In
traces/index.ts the shadowing parameter was also misnamed: finiteAt takes a
landmark key, not a path."
```

---

### Task 5: Convert 8 `.onX =` handlers to `addEventListener`

All 8 are source. The rule's rationale is real: assigning `.onmessage` replaces any previously-registered handler silently, where `addEventListener` accumulates. No site currently double-assigns, so this is preventive rather than a bug fix — but three of the eight are on the generation-worker path, so verify rather than assume.

**Files:**
- Modify: `src/game/generation-worker.ts` (1), `src/game/generate-async.ts` (3), `src/images/image-loader.ts` (2), `src/ui/image-picker.ts` (1), `src/ui/loading-overlay.ts` (1)

- [ ] **Step 1: List the current sites**

Run: `npm run lint 2>&1 | grep prefer-add-event-listener`

- [ ] **Step 2: Convert each site**

The shape, using `generate-async.ts`'s worker handlers:

```diff
-        worker.onmessage = (event) => { ... };
+        worker.addEventListener('message', (event) => { ... });
-        worker.onerror = () => { ... };
+        worker.addEventListener('error', () => { ... });
-        worker.onmessageerror = () => { ... };
+        worker.addEventListener('messageerror', () => { ... });
```

Two things to check per site, because this is where the conversion can go wrong:

1. **Does anything later clear the handler by assigning `null`?** `worker.onmessage = null` has no `addEventListener` equivalent — it needs `removeEventListener` with the same function reference, which means hoisting the handler into a named `const`. Search each file for such assignments before converting.
2. **In `generation-worker.ts`, the handler is on `workerScope`** (the `DedicatedWorkerGlobalScope`), not a `Worker`. The event name is still `'message'`.

- [ ] **Step 3: Verify the worker path specifically**

Run: `npx vitest run src/game/generate-async.test.ts src/game/generation-core.test.ts`
Expected: all pass. These exercise the worker protocol via a stub `Worker` class — if the stub dispatches by assigning `.onmessage` directly rather than via `dispatchEvent`, the conversion will break it. **If it does, that is a signal the stub needs updating, not that the conversion is wrong** — but check with the spec before rewriting a test double.

- [ ] **Step 4: Verify the build and full suite**

Run: `npm run build && npm test`
Expected: 0 tsc errors; 2712 passed, 2 skipped.

- [ ] **Step 5: Verify the count dropped**

Run: `npm run lint`
Expected: 15 errors remaining (23 − 8).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor: register listeners with addEventListener

Assigning .onmessage/.onload replaces any handler already registered, which
makes adding a second listener a silent removal of the first. No site
double-assigns today, so this is preventive."
```

---

### Task 6: Clear the remaining 15

A mixed tail. Each is individually small; they share a commit because none warrants its own review gate.

**Files:**
- Modify: `src/puzzle/fractal/cell-grid.ts` (2), `src/puzzle/topology/apply-tabs.ts` (1), `src/puzzle/topology/curve.ts` (1), `src/puzzle/topology/tab-rejection-measurement.test.ts` (1), `src/app/dev-hooks.ts` (1), `src/interaction/auto-pan.test.ts` (2), `src/ui/merge-tolerance.ts` (2), `src/diagnostics.ts` (1), `src/ui/share-section.ts` (1), `src/puzzle/fractal/arcs.ts` (1), `src/pwa/share-link-rescue.test.ts` (1), `src/game/generate-async.test.ts` (1)

- [ ] **Step 1: List the current sites**

Run: `npm run lint`

- [ ] **Step 2: `unicorn/no-new-array` ×5 — make the intent explicit**

`new Array(n)` is ambiguous between "length n" and "one element n". All five mean length:

```diff
-    const cells = new Array(rows);
+    const cells = Array.from({ length: rows });
```

`curve.ts` and `apply-tabs.ts` are geometry — `Array.from({ length: n })` produces `undefined`-filled elements exactly as `new Array(n)` does, so this is equivalent. If a site immediately `.fill()`s, keep the `.fill()`.

- [ ] **Step 3: `typescript/no-explicit-any` ×3 — suppress, matching the file's own pattern**

These are the `window`/`globalThis` dev-console and test-environment hooks, where `any` is the point. `dev-hooks.ts` already carries three identical suppressions at other lines; this is a fourth site that was missed. Add the same comment:

```diff
+    // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (window as any).__startVennPuzzle = (overrides?: {
```

Same for the two `(globalThis as any)` RAF/CAF stubs in `auto-pan.test.ts`. These suppressions are now load-bearing — the rule is enabled.

- [ ] **Step 4: `typescript/no-redundant-type-constituents` ×2 — drop the collapsed union**

`CutStyle` is a union of string literals, so `CutStyle | string` is just `string`; the annotation reads as if it narrows when it does not:

```diff
-export function getStyleSnapMultiplier(style: CutStyle | string): number {
+export function getStyleSnapMultiplier(style: string): number {
```

Both sites in `merge-tolerance.ts`. The lookup is `STYLE_SNAP_MULTIPLIERS[style] ?? 1.0`, which accepts any string by design — an unknown style falls back to `1.0`.

- [ ] **Step 5: `typescript/no-unnecessary-type-conversion` ×2 — drop the no-op coercions**

`import.meta.env.DEV` is already `boolean`, so `Boolean(...)` does nothing. Read `share-section.ts:80` before changing it: if `state.completed` is `boolean | undefined`, then `!!` *is* meaningful and the rule is wrong — leave it and add a suppression. If it is plain `boolean`, drop the `!!`.

```diff
-let _enabled = Boolean(import.meta.env.DEV);
+let _enabled = import.meta.env.DEV;
```

- [ ] **Step 6: The four singletons**

- `arcs.ts` `restrict-template-expressions` — `` `Invalid quad: ${con.quad}` `` interpolates a non-string. Wrap it: `${String(con.quad)}`.
- `share-link-rescue.test.ts` `no-misused-spread` — spreading a class instance drops its prototype. Read the site; if the test means to clone, construct properly instead.
- `generate-async.test.ts` `no-extraneous-class` — a test double that is a class with only a constructor. If it stands in for `Worker` it genuinely needs to be a class (it is `new`ed); add a suppression with that reason rather than converting it.
- `tab-rejection-measurement.test.ts` — the fifth `no-new-array`, same fix as Step 2.

- [ ] **Step 7: Verify**

Run: `npm run build && npm test`
Expected: 0 tsc errors; 2712 passed, 2 skipped.

- [ ] **Step 8: Verify the tree is clean**

Run: `npm run lint`
Expected: **0 errors.** Four `Unused eslint-disable directive` warnings remain — Task 7 removes them.

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "refactor: clear the remaining oxlint findings

Makes new Array(n) length-intent explicit, drops two no-op coercions and a
union that collapsed to string, and suppresses the dev-console and
test-environment `any` hooks the way the surrounding code already does."
```

---

### Task 7: Delete stale suppressions, gate CI, group the dependency

Closes the loop: the disable audit #502 asks for, the CI gate, and the one operational risk the spec identifies.

**Files:**
- Modify: `src/puzzle/topology/tab-rejection-measurement.test.ts`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `CLAUDE.md`

- [ ] **Step 1: Delete the four suppressions that are now unused**

Run: `npm run lint`

It reports four `Unused eslint-disable directive` warnings in `tab-rejection-measurement.test.ts`. They suppress `no-console`, which the test-file override already disables. Delete the four comment lines (leave the `console.log` calls).

This is #502's step 5: 17 disables → **13 load-bearing, 4 deleted**. Nothing is grandfathered; every remaining suppression names a rule that is actually enabled.

- [ ] **Step 2: Verify the tree is fully clean**

Run: `npm run lint`
Expected: **no output, exit code 0.** Zero errors and zero warnings.

- [ ] **Step 3: Add the CI step**

In `.github/workflows/ci.yml`, add to the **existing `test` job**, after `npm ci` and before `npm run build`:

```yaml
      - run: npm run lint
```

Do **not** create a new job. The `dependabot-auto-merge.yml` header explains why: required status checks are named in the branch ruleset, not inferred from workflow files, so a new job would be an ungated check until someone updates the ruleset by hand. Keeping the step inside `test` means the required context stays `test` and the gate applies immediately.

Placing it before `npm run build` also means lint failures surface without waiting for a full build.

- [ ] **Step 4: Group the linter with TypeScript in Dependabot**

`oxlint-tsgolint` embeds a specific TypeScript release (`7.0.2001` → TS 7.0.2, matching this repo's `~7.0.2`). Dependabot merges unattended here, so an ungrouped TypeScript bump could drift from tsgolint's embedded compiler. Add to the `npm` block's `groups` in `.github/dependabot.yml`:

```yaml
      typescript:
        patterns:
          - "typescript"
          - "oxlint"
          - "oxlint-tsgolint"
```

- [ ] **Step 5: Document the config's disabled rules in CLAUDE.md**

Add a section so a future agent does not "helpfully" re-enable the ten disabled rules. Keep it short — the reasoning lives in the config comments and the spec:

```markdown
## The oxlint config's disabled rules are load-bearing

`npm run lint` runs oxlint with type-aware rules. Ten rules are switched off
in `.oxlintrc.json`, each with an inline reason. Four are noise; **six were
verified to be actively wrong on this codebase** — two emit fixes that break
the build (one silently removes a coercion guard in the untrusted share-link
decode path), and four are false positives on domain types: `Curve.reverse()`
is not `Array#reverse()`, `Worker.postMessage` has no `targetOrigin`
parameter, an exhaustive enum `switch` needs no trailing return, and the
decimal test fixtures are not approximations of pi.

Do not re-enable one to "fix more things" without reading
`docs/superpowers/specs/2026-08-02-oxlint-adoption-design.md` first. Never add
`--type-check`: `src/pwa/sw.ts` is excluded from `tsconfig.json`, so it
resolves against a project without the WebWorker lib and emits ten bogus
errors.
```

- [ ] **Step 6: Verify the whole pipeline as CI will run it**

Run: `npm ci --legacy-peer-deps && npm run lint && npm run build && npm test`
Expected: all four succeed. This is exactly the CI sequence.

- [ ] **Step 7: Commit**

```bash
git add src/ .github/ CLAUDE.md
git commit -m "ci: gate on oxlint and drop the four suppressions it retired

Adds the lint step to the existing test job rather than a new one, so the
required-check context stays \`test\` and the branch ruleset needs no edit.

Completes the disable audit: of the 17 eslint-disable comments that were inert
before this PR, 13 now suppress rules that are actually enabled and 4 are
deleted as redundant. Groups typescript with oxlint and oxlint-tsgolint in
Dependabot, since tsgolint embeds a specific TypeScript release and this repo
merges dependency PRs unattended."
```

- [ ] **Step 8: Open the PR**

```bash
git push -u origin chore/502-adopt-oxlint
gh pr create --title "chore: adopt oxlint with type-aware linting" --body "$(cat <<'BODY'
Closes #502

Adds oxlint (not ESLint — see the spec for the comparison), clears the 55 real
violations, and gates CI on it.

## Why oxlint

One binary package instead of ESLint + typescript-eslint's transitive tree,
2.4s for 72k lines including type-aware rules, and it honors the existing
`eslint-disable` comment syntax so all 17 comments kept working unchanged.
Type-aware linting is included for one specific reason: it is what makes
`only-throw-error` — and therefore the 17th disable — real.

## The interesting part: five false-positive families

Every violation was inspected rather than counted, which took the total from
108 to 55 and turned up ten rules that should be off. Six are not judgment
calls:

- `no-unnecessary-boolean-literal-compare` **rewrites a security guard.** It
  turned `cf.bl = c.borderless === true` into `cf.bl = c.borderless` in
  `share-link.ts`. That value is decoded from an untrusted share link, so its
  declared `boolean` type is a claim rather than a fact. A test caught it.
- `no-unnecessary-type-assertion` **breaks the build** — removes a cast `tsc`
  requires in `sw-error-bridge.ts`.
- `require-post-message-target-origin` would **throw at runtime**: all four
  hits are Worker/ServiceWorker `postMessage`, whose signature is
  `(message, transfer?)` with no `targetOrigin`. Its fix passes a string
  where a transfer list is expected.
- `consistent-return` would **weaken type safety**: satisfying it on an
  exhaustive enum switch means adding a `default`, which removes the compile
  error a newly-added enum member would otherwise cause.
- `no-array-reverse` flags `Curve.reverse()`, a custom method that returns a
  new `Curve`.
- `approx-constant` flags decimal test fixtures as approximations of pi.

Worth knowing: the first two are equally `--fix`-able under typescript-eslint,
with no warning on either rule's page. Choosing ESLint would not have avoided
them. `--fix` is verified safe under the committed config.

## Disable audit

17 → 13 load-bearing, 4 deleted. Nothing grandfathered.

## CI

The lint step goes in the existing `test` job, so the required-check context
stays `test` and the branch ruleset needs no change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa
BODY
)"
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — tool choice and type-aware decision (Task 1 config), the ten disabled rules with reasons (Task 1 Step 2), the five false-positive families (Task 1 config comments + Task 7 CLAUDE.md), `--fix` safety (Task 2), the 55 violations (Tasks 2–6, summing 8+13+11+8+15 = 55), the disable audit (Task 7 Step 1), scripts and CI (Task 1 Step 3, Task 7 Step 3), the tsgolint/TypeScript coupling risk (Task 7 Step 4), and the `--type-check` / `sw.ts` limitation (Global Constraints + Task 1 Step 5).

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Sites the implementer must read before changing (`share-section.ts` `!!`, the `no-misused-spread` test, the `Worker` stub) say so explicitly with the decision criterion, rather than deferring the work.

**Count consistency:** 55 → 47 → 34 → 23 → 15 → 0 across Tasks 2–6, each verified by a `npm run lint` step with a stated expected value.
