# Unsplash HTTP-Error Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image-proxy 4xx/5xx responses (especially Unsplash's 403 rate limit) visible in production analytics via a new `image-fetch-http-error` event whose fields are mandatory on every row. Closes #533.

**Architecture:** Emit the event inside `src/images/unsplash.ts` at the two existing `!response.ok` branches, beside the existing `diagnostics.warn`. Register the event schema in `src/analytics/umami.ts` (the single source of truth). No return-contract or caller changes.

**Tech Stack:** TypeScript, Vitest (jsdom for window.umami stubs), Umami.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-unsplash-http-error-analytics-design.md`.
- Both event fields (`status`, `source`) are mandatory — never optional — so no dashboard query ever needs absent-property arithmetic.
- Comment policy (repo CLAUDE.md): only intent (5) and not-in-the-code information (6). `umami.ts` doc comments are the operator-facing query spec — keep them accurate, don't trim.
- Live comments falsified by this change must be fixed in the same commit (`resolve-image.ts`, `fetch-candidate-images.ts`, `ImageFetchFailedData`).
- `npm run lint`, `npm run build`, `npm test` must pass; never add `--type-check` to lint.
- American English in all code and comments.
- Commit style: conventional commits.

---

### Task 1: Register the `image-fetch-http-error` event schema

**Files:**
- Modify: `src/analytics/umami.ts` (interface after `ImageFetchFailedData` ~line 581; overload after line 1406; rewrite `ImageFetchFailedData` doc comment lines 552–576)
- Test: `src/analytics/umami.test.ts` (mirror the `image-fetch-failed` forward test at ~line 226)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface ImageFetchHttpErrorData { status: number; source: 'single' | 'batch' }` and the overload `export function track(name: 'image-fetch-http-error', data: ImageFetchHttpErrorData): void;` — Task 2 calls exactly this.

- [ ] **Step 1: Write the forwarding test**

In `src/analytics/umami.test.ts`, next to the existing `image-fetch-failed` forward test:

```ts
it('forwards image-fetch-http-error with the typed payload', () => {
    const umamiTrack = vi.fn();
    (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

    track('image-fetch-http-error', {
        status: 403,
        source: 'batch',
    });

    expect(umamiTrack).toHaveBeenCalledWith('image-fetch-http-error', {
        status: 403,
        source: 'batch',
    });
});
```

Follow the surrounding tests' setup/teardown of `window.umami` exactly (same describe block).

Note: this test passes at runtime even before the overload exists (vitest transpiles without type-checking; the `track` implementation forwards any name). The red gate for this task is `npx tsc --noEmit` in Step 3 — run it BEFORE Step 2 and confirm it fails on the test's `track('image-fetch-http-error', …)` call.

- [ ] **Step 2: Add the interface, doc comment, and overload**

In `src/analytics/umami.ts`, insert after the `ImageFetchFailedData` interface (line 581):

```ts
/**
 * Data attached to `image-fetch-http-error` — the image-proxy Worker
 * answered a random-photo request with an error status, which the fetch
 * helpers turn into a handled "no image" result rather than a throw
 * (#533). The complement of {@link ImageFetchFailedData}: between them the
 * two events cover every failed random-photo request — answered-with-error
 * here, thrown there — with no overlap. `triggerPhotoDownload` failures are
 * NOT covered: a download trigger only follows a random fetch that just
 * succeeded, so its errors are a trailing echo of conditions this event
 * already shows.
 *
 * `status` is the HTTP status the client received. `status = 403` is the
 * rate-limit segment this event exists for: Unsplash demo apps get 50
 * requests/hour shared across every player, the Worker passes the 403
 * through, and before this event a rate-limited hour was indistinguishable
 * from a quiet one. The Worker's own failure statuses arrive too — 500 (no
 * key configured), 502 (Unsplash unreachable) — so this is also the
 * in-Umami proxy-health signal {@link ImageFetchFailedData} documents it
 * cannot be.
 *
 * `source` separates the two producers: `'batch'` is the picker's grid
 * fetch, one request per refresh (category change, Vibrant toggle, ↻) and
 * the likely budget-burner; `'single'` is the new-game resolve path, one
 * request per start, where the player silently gets the fallback image.
 * Both fields are set on every row, so status/source filters work directly —
 * none of the absent-property arithmetic {@link SharedLoadFailedData} and
 * {@link NewGameFailedData} need.
 */
export interface ImageFetchHttpErrorData {
    status: number;
    source: 'single' | 'batch';
}
```

Add the overload after the `image-fetch-failed` line (1406):

```ts
export function track(name: 'image-fetch-http-error', data: ImageFetchHttpErrorData): void;
```

- [ ] **Step 3: Rewrite the falsified parts of `ImageFetchFailedData`'s doc comment**

Replace the comment's first paragraph and its final ("Do NOT use…") paragraph so the whole comment reads (middle paragraphs unchanged):

```ts
/**
 * Data attached to `image-fetch-failed` — fetching a random Unsplash image
 * threw (network/parse failure). This is NOT the "no image found" case:
 * `fetchRandomImage` returns `undefined` on a 4xx/5xx response, which is
 * `image-fetch-http-error`'s case ({@link ImageFetchHttpErrorData}), so this
 * event only fires on a genuine throw. The new game still proceeds with the
 * fallback image. `reason` is the sanitized error message.
 *
 * `orientation` and `imageCategory` describe the request that failed, so a
 * portrait-specific or category-specific fetch problem is distinguishable
 * from a generic one rather than being aggregated away.
 *
 * Since #535 the request goes to the image-proxy Worker, not to Unsplash, so
 * a spike here points at Cloudflare — an unreachable Worker, a stale
 * `VITE_IMAGE_PROXY_URL`, or an origin missing from its CORS allowlist — at
 * least as often as it points at Unsplash itself.
 *
 * Do NOT use this event to answer "is the proxy up?". It cannot see the
 * Worker's own error statuses: a 500 (no key configured), a 502 (Unsplash
 * unreachable) and a passed-through 403 all arrive as `response.ok === false`
 * and land in `image-fetch-http-error`, so this event stays flat through the
 * proxy's most likely misconfigurations. Ask `image-fetch-http-error` (which
 * carries the real status), or — per request — Cloudflare's Workers Logs,
 * which `wrangler.jsonc` enables.
 */
```

- [ ] **Step 4: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run src/analytics/umami.test.ts`
Expected: clean tsc, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/umami.ts src/analytics/umami.test.ts
git commit -m "feat(analytics): add image-fetch-http-error event schema"
```

---

### Task 2: Emit the event from the fetch helpers; fix falsified comments

**Files:**
- Modify: `src/images/unsplash.ts` (`fetchRandomImage` ~line 173, `fetchRandomImages` ~line 203)
- Modify: `src/app/resolve-image.ts:1-5` (header comment)
- Modify: `src/app/fetch-candidate-images.ts:1-6` (header comment)
- Test: `src/images/unsplash.test.ts`

**Interfaces:**
- Consumes: `track(name: 'image-fetch-http-error', data: ImageFetchHttpErrorData)` from Task 1, imported from `'../analytics/index.js'` (which re-exports `track` from `umami.js`).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

`src/images/unsplash.test.ts` runs in the default node environment today, where `track()` deliberately no-ops (no `window`). Add the jsdom pragma as the FIRST lines of the file so the repo's window.umami-stub idiom works:

```ts
/**
 * @vitest-environment jsdom
 */
```

(Repo CLAUDE.md warns this pragma looks like a deletable summary comment — it is a directive, keep the exact shape.)

Import `beforeEach` from vitest alongside the existing imports, then add a new top-level describe:

```ts
describe('image-fetch-http-error tracking', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    it('reports status and source single when the single fetch gets an error response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(umamiTrack).toHaveBeenCalledWith('image-fetch-http-error', {
            status: 403,
            source: 'single',
        });
    });

    it('reports status and source batch when the picker fetch gets an error response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
        });

        await fetchRandomImages(PROXY, 4, mockFetch as unknown as typeof fetch);

        expect(umamiTrack).toHaveBeenCalledWith('image-fetch-http-error', {
            status: 502,
            source: 'batch',
        });
    });

    it('reports nothing on a successful fetch', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('reports nothing when the fetch itself throws — that is image-fetch-failed\'s case', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Network error');

        expect(umamiTrack).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the new tests to verify the two error-response ones fail**

Run: `npx vitest run src/images/unsplash.test.ts`
Expected: the two "reports status and source" tests FAIL (`umamiTrack` never called); the two "reports nothing" tests pass; all pre-existing tests still pass.

- [ ] **Step 3: Emit the event**

In `src/images/unsplash.ts`, add to the imports:

```ts
import { track } from '../analytics/index.js';
```

In `fetchRandomImage`, extend the `!response.ok` branch:

```ts
    if (!response.ok) {
        diagnostics.warn(
            `Image proxy error: ${response.status} ${response.statusText}`,
        );
        track('image-fetch-http-error', { status: response.status, source: 'single' });

        return undefined;
    }
```

In `fetchRandomImages`, the same with `source: 'batch'`:

```ts
    if (!response.ok) {
        diagnostics.warn(
            `Image proxy error: ${response.status} ${response.statusText}`,
        );
        track('image-fetch-http-error', { status: response.status, source: 'batch' });

        return undefined;
    }
```

Do NOT touch `triggerPhotoDownload` (spec: out of scope).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/images/unsplash.test.ts src/app/resolve-image.test.ts src/app/fetch-candidate-images.test.ts`
Expected: PASS (callers mock `fetchRandomImage(s)`, so their suites are unaffected).

- [ ] **Step 5: Fix the two falsified header comments**

`src/app/resolve-image.ts` lines 1–5, replace with:

```ts
/**
 * A no-usable-photo result is a handled outcome, reported one layer down
 * as `image-fetch-http-error`; only a thrown fetch is reported here, as
 * `image-fetch-failed`. Either way the caller falls back to its default
 * image.
 */
```

`src/app/fetch-candidate-images.ts` lines 1–6, replace with:

```ts
/**
 * Returns `null` when the fetch fails or yields nothing — the picker
 * shows its inline error state and the player can retry via the refresh
 * button. An error-status answer from the proxy is reported one layer
 * down as `image-fetch-http-error`; the thrown path caught here stays
 * untracked.
 */
```

- [ ] **Step 6: Commit**

```bash
git add src/images/unsplash.ts src/images/unsplash.test.ts src/app/resolve-image.ts src/app/fetch-candidate-images.ts
git commit -m "feat(images): report image-proxy error statuses to analytics

Closes #533"
```

---

### Task 3: Full verification and PR

**Files:** none new.

- [ ] **Step 1: Run the full gates**

Run: `npm run lint && npm run build && npm test`
Expected: all green. If lint flags a comment, re-read the repo comment policy before changing anything.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin unsplash-http-error-analytics
gh pr create --title "feat(images): surface image-proxy HTTP errors in analytics" --body "$(cat <<'EOF'
Closes #533

## What

Adds an `image-fetch-http-error` analytics event, emitted when the image-proxy Worker answers a random-photo request with an error status — the case `image-fetch-failed` deliberately does not cover (it fires only on a throw) and `diagnostics.warn` only surfaces in dev.

## Shape chosen

The issue offered two shapes with a deciding criterion: keep the "absence can't be filtered" trap out of the dashboard. Widening `image-fetch-failed` with an optional `status` would recreate that trap (throw-path rows and all historical rows lack the key), so this is a distinct event whose two fields are mandatory on every row:

- `status` — `403` is the rate-limit segment; the Worker's own 500/502 become visible too.
- `source` — `'batch'` (picker grid fetch, the likely budget-burner) vs `'single'` (new-game resolve).

`triggerPhotoDownload` is out of scope: its errors only trail a random fetch that just succeeded.

Spec: `docs/superpowers/specs/2026-08-08-unsplash-http-error-analytics-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa
EOF
)"
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch`
Expected: all checks green (a passing local suite is not evidence CI passed).
