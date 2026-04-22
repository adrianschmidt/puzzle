# Puzzle Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player share a puzzle via a self-contained link (hash fragment with base64url-encoded JSON) that recreates the same image, cuts, seed, and optionally merge progress on the recipient's device.

**Architecture:** Two new pure modules (`src/sharing/` for the codec, `src/game/reconstruct-groups.ts` for progress replay) plus two thin UI helpers (`src/ui/share.ts`, `src/ui/toast.ts`). Entry points are wired into the existing info modal and completion overlay. On boot, `main.ts` checks `window.location.hash` before the save-restore branch.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, Web Share API + Clipboard API. Deployed to GitHub Pages (no server changes).

**Spec reference:** `docs/superpowers/specs/2026-04-22-puzzle-sharing-design.md`.

---

## File structure

**New files:**

- `src/sharing/share-link.ts` — payload types, `encodePayload`, `decodePayload`, `buildShareUrl`, `parseLocationHash`, `gameStateToPayload`, `hasShareableProgress`.
- `src/sharing/share-link.test.ts` — round-trip + rejection tests.
- `src/sharing/index.ts` — public barrel.
- `src/game/reconstruct-groups.ts` — `computeMergedOffsets` (pure BFS) and `applyProgress`.
- `src/game/reconstruct-groups.test.ts` — reconstruction tests.
- `src/ui/share.ts` — `sharePuzzle` (Web Share + clipboard fallback).
- `src/ui/share.test.ts` — navigator.share vs clipboard behaviour.
- `src/ui/toast.ts` — small transient `showToast` helper.
- `src/ui/toast.test.ts` — auto-dismiss + duplicate stacking tests.
- `src/ui/share-section.ts` — builds the info-modal "Share this puzzle" section (keeps `info-modal.ts` from bloating).
- `src/ui/share-section.test.ts` — checkbox-disabled-state tests.

**Modified files:**

- `src/model/types.ts` — extend `GameState` with `composableConfig?` and `fractalConfig?` so the codec can read them back.
- `src/game/init.ts` — stash `composableConfig` / `fractalConfig` on the returned state.
- `src/ui/info-modal.ts` — accept state (for progress status) and append the Share section; update help text.
- `src/main.ts` — check hash on boot; wire completion overlay button; pass state into info modal.
- `src/style.css` — `.share-section`, `.share-url-preview`, `.completion-share-btn`, `.app-toast`.
- `BACKLOG.md` — move puzzle-sharing from "ideas" into "done" (or remove if it lives under a future heading).

Each task below is self-contained: it has the code to write, the test to run, and a commit. Don't batch commits across tasks — the writing-plans skill emphasises small, frequent commits.

---

## Task 1: Share-link codec — minimal round-trip

**Files:**
- Create: `src/sharing/share-link.ts`
- Create: `src/sharing/share-link.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sharing/share-link.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    encodePayload,
    decodePayload,
    type SharePayload,
} from './share-link.js';

describe('share-link codec — minimal round-trip', () => {
    it('round-trips a minimal starting payload (no attribution, no progress)', () => {
        const payload: SharePayload = {
            v: 1,
            i: 'https://images.unsplash.com/photo-123?w=1080',
            is: [1080, 720],
            g: [8, 6],
            c: 'classic',
            s: 12345,
            r: 'none',
        };
        const encoded = encodePayload(payload);
        const decoded = decodePayload(encoded);
        expect(decoded).toEqual(payload);
    });

    it('produces a URL-safe base64 string (no "+", "/", "=")', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const encoded = encodePayload(payload);
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it('preserves the "blank" image sentinel verbatim', () => {
        const payload: SharePayload = {
            v: 1, i: 'blank', is: [1080, 720], g: [4, 3], c: 'classic', s: 7, r: 'none',
        };
        expect(decodePayload(encodePayload(payload))?.i).toBe('blank');
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL with "Cannot find module './share-link.js'".

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `src/sharing/share-link.ts`:

```ts
/**
 * Share-link codec — encodes a puzzle (+ optional progress) into a
 * URL-safe base64 JSON payload and back.
 *
 * Used by the "Share this puzzle" section of the info modal and by
 * main.ts on boot to detect and load `#p=...` hash links.
 */

export interface SharePayload {
    /** Schema version; bumped on breaking changes. */
    v: 1;
    /** Image URL, or the sentinel "blank" for the locally-regenerated white canvas. */
    i: string;
    /** Image size [width, height]. */
    is: [number, number];
    /** Optional attribution. */
    a?: { n: string; u: string; p: string };
    /** Grid size [cols, rows]. */
    g: [number, number];
    /** Cut style. */
    c: 'classic' | 'fractal' | 'composable';
    /** PRNG seed. */
    s: number;
    /** Rotation mode. */
    r: 'none' | 'quarter-turn';
    /** Composable-cut config. */
    cf?: { ha: number; hf: number; va: number; vf: number; dt: boolean };
    /** Fractal-cut config (rotationEnabled is implicit via `r`). */
    ff?: { bl: boolean };
    /** Optional progress snapshot. */
    pr?: {
        m: number[][];
        mr?: number[];
        sr?: number[];
    };
}

export function encodePayload(payload: SharePayload): string {
    const json = JSON.stringify(payload);
    return base64UrlEncode(json);
}

export function decodePayload(encoded: string): SharePayload | null {
    try {
        const json = base64UrlDecode(encoded);
        const parsed = JSON.parse(json) as unknown;
        if (!isValidPayload(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function base64UrlEncode(text: string): string {
    // btoa handles Latin-1; round-trip via UTF-8 so non-ASCII survives.
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(encoded: string): string {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(pad));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function isValidPayload(x: unknown): x is SharePayload {
    if (!x || typeof x !== 'object') return false;
    const p = x as Record<string, unknown>;
    if (p.v !== 1) return false;
    if (typeof p.i !== 'string') return false;
    if (!isTuple2Number(p.is)) return false;
    if (!isTuple2Number(p.g)) return false;
    if (p.c !== 'classic' && p.c !== 'fractal' && p.c !== 'composable') return false;
    if (typeof p.s !== 'number') return false;
    if (p.r !== 'none' && p.r !== 'quarter-turn') return false;
    return true;
}

function isTuple2Number(x: unknown): x is [number, number] {
    return Array.isArray(x) && x.length === 2
        && typeof x[0] === 'number' && typeof x[1] === 'number';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(sharing): add minimal share-link encode/decode round-trip"
```

---

## Task 2: Codec — optional fields and rejection paths

**Files:**
- Modify: `src/sharing/share-link.test.ts`
- Modify: `src/sharing/share-link.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/sharing/share-link.test.ts`:

```ts
describe('share-link codec — optional fields', () => {
    it('round-trips attribution', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [2, 2], c: 'classic', s: 1, r: 'none',
            a: { n: 'Ada', u: 'https://u', p: 'https://p' },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips composable config', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'none',
            cf: { ha: 0.2, hf: 1, va: 0.3, vf: 2, dt: false },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips fractal config with rotation', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [8, 6], c: 'fractal', s: 1, r: 'quarter-turn',
            ff: { bl: true },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips progress with merged groups only', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [3, 2], c: 'classic', s: 1, r: 'none',
            pr: { m: [[0, 1], [2, 3, 4]] },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips progress with rotation fidelity', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [3, 2], c: 'fractal', s: 1, r: 'quarter-turn',
            ff: { bl: false },
            pr: { m: [[0, 1]], mr: [2], sr: [3, 1, 4, 3] },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });
});

describe('share-link codec — rejection paths', () => {
    it('rejects unsupported schema version', () => {
        const bad = { v: 2, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none' };
        const encoded = encodeRaw(bad);
        expect(decodePayload(encoded)).toBeNull();
    });

    it('rejects malformed base64', () => {
        expect(decodePayload('!!!not base64!!!')).toBeNull();
    });

    it('rejects JSON whose shape is wrong', () => {
        const encoded = encodeRaw({ hello: 'world' });
        expect(decodePayload(encoded)).toBeNull();
    });

    it('rejects invalid cut style', () => {
        const bad = { v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'bogus', s: 0, r: 'none' };
        expect(decodePayload(encodeRaw(bad))).toBeNull();
    });
});

// Helper that mirrors encodePayload without shape-validation, so we can
// craft malformed-but-well-encoded payloads for rejection tests.
function encodeRaw(obj: unknown): string {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

- [ ] **Step 2: Run tests to verify the happy-path additions pass and rejection tests fail (since validation stubs are weak)**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: round-trip tests pass; rejection tests — most should already pass because `isValidPayload` covers the cases. Any failures point to a schema-validation gap to fix.

- [ ] **Step 3: Tighten `isValidPayload` if any rejection test fails**

Confirm `isValidPayload` in `share-link.ts` rejects:
- missing or wrong `v`
- wrong-type `i`, `s`
- bad `is` / `g` tuples
- cut style outside the three allowed values
- rotation mode outside the two allowed values

No broadening needed for optional fields — we only need the decoder to not reject valid payloads; attacker-crafted extra fields in `a`/`cf`/`ff`/`pr` are caller-validated downstream (see Task 7).

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS (all 12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(sharing): cover optional fields and rejection paths in codec"
```

---

## Task 3: URL helpers and public barrel

**Files:**
- Modify: `src/sharing/share-link.ts`
- Modify: `src/sharing/share-link.test.ts`
- Create: `src/sharing/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/sharing/share-link.test.ts`:

```ts
import { buildShareUrl, parseLocationHash } from './share-link.js';

describe('buildShareUrl', () => {
    it('appends "#p=<encoded>" to a bare URL', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const url = buildShareUrl('https://example.com/puzzle/', payload);
        expect(url.startsWith('https://example.com/puzzle/#p=')).toBe(true);
    });

    it('strips an existing hash before appending', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 0, r: 'none',
        };
        const url = buildShareUrl('https://example.com/puzzle/#stale', payload);
        expect(url.includes('#stale')).toBe(false);
        expect(url.includes('#p=')).toBe(true);
    });
});

describe('parseLocationHash', () => {
    it('returns null for empty hash', () => {
        expect(parseLocationHash('')).toBeNull();
    });

    it('returns null for unrelated hash', () => {
        expect(parseLocationHash('#section')).toBeNull();
    });

    it('returns the payload when the hash is a valid share link', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1, 1], g: [2, 2], c: 'classic', s: 42, r: 'none',
        };
        const hash = '#p=' + encodePayload(payload);
        expect(parseLocationHash(hash)).toEqual(payload);
    });

    it('returns null for #p= with malformed body', () => {
        expect(parseLocationHash('#p=!!!')).toBeNull();
    });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — `buildShareUrl` / `parseLocationHash` not exported.

- [ ] **Step 3: Implement in `share-link.ts`**

Append to `src/sharing/share-link.ts`:

```ts
export function buildShareUrl(baseUrl: string, payload: SharePayload): string {
    const withoutHash = baseUrl.split('#')[0];
    return `${withoutHash}#p=${encodePayload(payload)}`;
}

export function parseLocationHash(hash: string): SharePayload | null {
    if (!hash.startsWith('#p=')) return null;
    const body = hash.slice(3);
    if (!body) return null;
    return decodePayload(body);
}
```

Create `src/sharing/index.ts`:

```ts
export {
    type SharePayload,
    encodePayload,
    decodePayload,
    buildShareUrl,
    parseLocationHash,
} from './share-link.js';
```

- [ ] **Step 4: Verify all tests pass**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts src/sharing/index.ts
git commit -m "feat(sharing): add buildShareUrl and parseLocationHash helpers"
```

---

## Task 4: Extend GameState with cut-style configs

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/game/init.ts`

The spec requires the codec to read back `composableConfig` and `fractalConfig`. These are currently passed into `createNewGame` but not stored on the resulting `GameState`. We widen the type and have `createNewGame` echo them back. Serialization (`src/persistence/serialization.ts`) deliberately stays untouched — persisted saves keep their current shape; these fields are for in-memory sharing only.

- [ ] **Step 1: Write the failing test**

Create `src/game/init-configs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createNewGame } from './init.js';

describe('createNewGame — cut-style configs on GameState', () => {
    it('stores fractalConfig when cutStyle is fractal', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'fractal', seed: 1, fractalConfig: { borderless: true } },
        );
        expect(state.fractalConfig).toEqual({ borderless: true });
        expect(state.composableConfig).toBeUndefined();
    });

    it('stores composableConfig when cutStyle is composable', () => {
        const cfg = { horizontalAmplitude: 0.2, horizontalFrequency: 1,
                      verticalAmplitude: 0.3, verticalFrequency: 2, disableTabs: false };
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'composable', seed: 1, composableConfig: cfg },
        );
        expect(state.composableConfig).toEqual(cfg);
        expect(state.fractalConfig).toBeUndefined();
    });

    it('leaves both configs undefined for classic puzzles', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 4, rows: 3 },
            { cutStyle: 'classic', seed: 1 },
        );
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/game/init-configs.test.ts`
Expected: FAIL — `state.fractalConfig` is undefined in all branches.

- [ ] **Step 3: Widen `GameState`**

In `src/model/types.ts`, add these fields to the `GameState` interface (keep existing fields in place):

```ts
    /** Composable-cut config (only set when cutStyle === 'composable'). */
    composableConfig?: {
        horizontalAmplitude: number;
        horizontalFrequency: number;
        verticalAmplitude: number;
        verticalFrequency: number;
        disableTabs: boolean;
    };
    /** Fractal-cut config (only set when cutStyle === 'fractal'). */
    fractalConfig?: {
        borderless: boolean;
    };
```

- [ ] **Step 4: Update `createNewGame` to echo the configs**

In `src/game/init.ts`, extend the returned `GameState` literal:

```ts
    return {
        pieces,
        groups,
        imageUrl,
        imageSize: puzzleSize,
        gridSize,
        completed: false,
        seed,
        cutStyle,
        rotationMode,
        composableConfig: cutStyle === 'composable' ? options.composableConfig : undefined,
        fractalConfig: cutStyle === 'fractal' ? options.fractalConfig : undefined,
    };
```

- [ ] **Step 5: Verify tests pass**

Run: `npx vitest run src/game/init-configs.test.ts && npx vitest run src/persistence/serialization.test.ts`
Expected: PASS for both. Serialization tests stay green because `serialize` / `deserialize` only pick known fields.

- [ ] **Step 6: Commit**

```bash
git add src/model/types.ts src/game/init.ts src/game/init-configs.test.ts
git commit -m "feat(game): expose cut-style configs on GameState"
```

---

## Task 5: `gameStateToPayload` + `hasShareableProgress`

**Files:**
- Modify: `src/sharing/share-link.ts`
- Modify: `src/sharing/share-link.test.ts`
- Modify: `src/sharing/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/sharing/share-link.test.ts`:

```ts
import { gameStateToPayload, hasShareableProgress } from './share-link.js';
import type { GameState } from '../model/types.js';

function buildState(partial: Partial<GameState>): GameState {
    return {
        pieces: [],
        groups: [],
        imageUrl: 'blank',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 4, rows: 3 },
        completed: false,
        seed: 42,
        cutStyle: 'classic',
        rotationMode: 'none',
        ...partial,
    };
}

describe('gameStateToPayload', () => {
    it('maps a starting classic puzzle to a minimal payload', () => {
        const state = buildState({});
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload).toEqual({
            v: 1, i: 'blank', is: [1080, 720], g: [4, 3],
            c: 'classic', s: 42, r: 'none',
        });
    });

    it('includes attribution when present', () => {
        const state = buildState({
            attribution: {
                photographerName: 'Ada',
                photographerUrl: 'https://u',
                photoUrl: 'https://p',
            },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.a).toEqual({ n: 'Ada', u: 'https://u', p: 'https://p' });
    });

    it('includes fractalConfig with rotation mode', () => {
        const state = buildState({
            cutStyle: 'fractal',
            rotationMode: 'quarter-turn',
            fractalConfig: { borderless: true },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.c).toBe('fractal');
        expect(payload.r).toBe('quarter-turn');
        expect(payload.ff).toEqual({ bl: true });
    });

    it('includes composableConfig', () => {
        const state = buildState({
            cutStyle: 'composable',
            composableConfig: {
                horizontalAmplitude: 0.2, horizontalFrequency: 1,
                verticalAmplitude: 0.3, verticalFrequency: 2, disableTabs: false,
            },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.cf).toEqual({ ha: 0.2, hf: 1, va: 0.3, vf: 2, dt: false });
    });

    it('omits progress when includeProgress is false', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.pr).toBeUndefined();
    });

    it('captures merged-group piece IDs when includeProgress is true', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1]]);
        expect(payload.pr?.mr).toBeUndefined();
        expect(payload.pr?.sr).toBeUndefined();
    });

    it('captures rotation fidelity in quarter-turn mode', () => {
        const state = buildState({
            rotationMode: 'quarter-turn',
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 2 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 1 },
                { id: 3, pieces: new Map([[3, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        const payload = gameStateToPayload(state, { includeProgress: true });
        expect(payload.pr?.m).toEqual([[0, 1]]);
        expect(payload.pr?.mr).toEqual([2]);
        // Solo rotations: only non-zero ones are encoded.
        expect(payload.pr?.sr).toEqual([2, 1]);
    });
});

describe('hasShareableProgress', () => {
    it('is false when the puzzle has no merged groups', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(false);
    });

    it('is false when the puzzle is complete', () => {
        const state = buildState({
            completed: true,
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(false);
    });

    it('is true when there is at least one multi-piece group and the puzzle is in progress', () => {
        const state = buildState({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        expect(hasShareableProgress(state)).toBe(true);
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — new exports don't exist.

- [ ] **Step 3: Implement in `share-link.ts`**

Append to `src/sharing/share-link.ts`:

```ts
import type { GameState } from '../model/types.js';

export interface EncodeOptions {
    includeProgress: boolean;
}

export function gameStateToPayload(
    state: GameState,
    options: EncodeOptions,
): SharePayload {
    const cutStyle = (state.cutStyle ?? 'classic') as SharePayload['c'];
    const rotationMode = (state.rotationMode ?? 'none') as SharePayload['r'];

    const payload: SharePayload = {
        v: 1,
        i: state.imageUrl,
        is: [state.imageSize.width, state.imageSize.height],
        g: [state.gridSize.cols, state.gridSize.rows],
        c: cutStyle,
        s: state.seed ?? 0,
        r: rotationMode,
    };

    if (state.attribution) {
        payload.a = {
            n: state.attribution.photographerName,
            u: state.attribution.photographerUrl,
            p: state.attribution.photoUrl,
        };
    }

    if (cutStyle === 'composable' && state.composableConfig) {
        const c = state.composableConfig;
        payload.cf = {
            ha: c.horizontalAmplitude, hf: c.horizontalFrequency,
            va: c.verticalAmplitude,   vf: c.verticalFrequency,
            dt: c.disableTabs,
        };
    }

    if (cutStyle === 'fractal' && state.fractalConfig) {
        payload.ff = { bl: state.fractalConfig.borderless };
    }

    if (options.includeProgress) {
        const progress = extractProgress(state);
        if (progress) payload.pr = progress;
    }

    return payload;
}

export function hasShareableProgress(state: GameState): boolean {
    if (state.completed) return false;
    return state.groups.some((g) => g.pieces.size >= 2);
}

function extractProgress(state: GameState): SharePayload['pr'] | null {
    const merged = state.groups.filter((g) => g.pieces.size >= 2);
    if (merged.length === 0) return null;

    const m = merged.map((g) => [...g.pieces.keys()].sort((a, b) => a - b));
    const pr: NonNullable<SharePayload['pr']> = { m };

    if (state.rotationMode === 'quarter-turn') {
        pr.mr = merged.map((g) => g.rotation);
        const sr: number[] = [];
        for (const g of state.groups) {
            if (g.pieces.size !== 1) continue;
            if (g.rotation === 0) continue;
            const [pieceId] = g.pieces.keys();
            sr.push(pieceId, g.rotation);
        }
        if (sr.length > 0) pr.sr = sr;
    }

    return pr;
}
```

- [ ] **Step 4: Re-export from the barrel**

In `src/sharing/index.ts`, add `gameStateToPayload` and `hasShareableProgress` to the re-export list.

- [ ] **Step 5: Verify tests pass**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts src/sharing/index.ts
git commit -m "feat(sharing): build share payloads from game state"
```

---

## Task 6: `computeMergedOffsets` — pure BFS helper

**Files:**
- Create: `src/game/reconstruct-groups.ts`
- Create: `src/game/reconstruct-groups.test.ts`

This helper reconstructs a merged group's piece offsets from a list of piece IDs, walking the edge graph. It is pure (no DOM, no state mutation) so it is straightforward to unit-test against real `generateProceduralPuzzle` output.

- [ ] **Step 1: Write the failing test**

Create `src/game/reconstruct-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import { computeMergedOffsets } from './reconstruct-groups.js';

describe('computeMergedOffsets', () => {
    it('computes offsets for a two-piece horizontal merge that match the generator layout', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 1 are horizontally adjacent in the top row.
        const offsets = computeMergedOffsets(pieces, [0, 1]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        const off1 = offsets!.get(1)!;
        expect(off1.x).toBeCloseTo(100, 3);
        expect(off1.y).toBeCloseTo(0, 3);
    });

    it('computes offsets for a three-piece L-shape', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 top-left, piece 1 right of it, piece 4 below piece 0.
        const offsets = computeMergedOffsets(pieces, [0, 1, 4]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        const off1 = offsets!.get(1)!;
        const off4 = offsets!.get(4)!;
        expect(off1.x).toBeCloseTo(100, 3);
        expect(off1.y).toBeCloseTo(0, 3);
        expect(off4.x).toBeCloseTo(0, 3);
        expect(off4.y).toBeCloseTo(100, 3);
    });

    it('returns null for a disconnected piece set', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 2 are not adjacent.
        expect(computeMergedOffsets(pieces, [0, 2])).toBeNull();
    });

    it('returns null when a piece id is not in the puzzle', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        expect(computeMergedOffsets(pieces, [0, 999])).toBeNull();
    });

    it('returns a single-entry map for a one-piece group', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        const offsets = computeMergedOffsets(pieces, [5]);
        expect(offsets!.size).toBe(1);
        expect(offsets!.get(5)).toEqual({ x: 0, y: 0 });
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/game/reconstruct-groups.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `reconstruct-groups.ts`**

Create `src/game/reconstruct-groups.ts`:

```ts
/**
 * Rebuild merged-group layouts from piece-ID lists (used when loading
 * a shared puzzle that includes progress).
 *
 * Given a list of piece IDs that should be merged, walk the edge graph
 * BFS-style to compute each piece's offset relative to the group anchor
 * (piece 0 in the list). The mate-edge math mirrors the live merge flow:
 * mated edges run in opposite directions, so `edge.start` on this piece
 * meets `mateEdge.end` on the neighbour.
 */

import type { Piece, Point } from '../model/types.js';

export function computeMergedOffsets(
    pieces: Piece[],
    pieceIds: number[],
): Map<number, Point> | null {
    if (pieceIds.length === 0) return null;

    const byId = new Map<number, Piece>();
    for (const p of pieces) byId.set(p.id, p);

    const want = new Set(pieceIds);
    for (const id of pieceIds) {
        if (!byId.has(id)) return null;
    }

    const offsets = new Map<number, Point>();
    const queue: number[] = [];
    const anchorId = pieceIds[0];
    offsets.set(anchorId, { x: 0, y: 0 });
    queue.push(anchorId);

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const current = byId.get(currentId)!;
        const currentOffset = offsets.get(currentId)!;

        for (const edge of current.edges) {
            const mateId = edge.matePieceId;
            if (mateId < 0) continue;
            if (!want.has(mateId)) continue;
            if (offsets.has(mateId)) continue;

            const mate = byId.get(mateId);
            if (!mate) return null;
            const mateEdge = mate.edges.find((e) => e.id === edge.mateEdgeId);
            if (!mateEdge) return null;

            // Align edge.start (on current) with mateEdge.end (on mate):
            //     currentOffset + edge.start === mateOffset + mateEdge.end
            const mateOffset: Point = {
                x: currentOffset.x + edge.start.x - mateEdge.end.x,
                y: currentOffset.y + edge.start.y - mateEdge.end.y,
            };
            offsets.set(mateId, mateOffset);
            queue.push(mateId);
        }
    }

    if (offsets.size !== want.size) return null;
    return offsets;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run src/game/reconstruct-groups.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/game/reconstruct-groups.ts src/game/reconstruct-groups.test.ts
git commit -m "feat(game): compute merged-group offsets from piece ids"
```

---

## Task 7: `applyProgress` — rebuild merged groups onto GameState

**Files:**
- Modify: `src/game/reconstruct-groups.ts`
- Modify: `src/game/reconstruct-groups.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/game/reconstruct-groups.test.ts`:

```ts
import { applyProgress } from './reconstruct-groups.js';
import { createNewGame } from './init.js';
import type { GameState } from '../model/types.js';

function fresh(seed: number, rotationMode: 'none' | 'quarter-turn' = 'none'): GameState {
    return createNewGame(
        'blank',
        { width: 400, height: 300 },
        { width: 800, height: 600 },
        { cols: 4, rows: 3 },
        { cutStyle: 'classic', seed, rotationMode },
    );
}

describe('applyProgress', () => {
    it('merges the listed piece groups into one multi-piece group', () => {
        const state = fresh(123);
        const originalGroupCount = state.groups.length;

        const ok = applyProgress(state, { m: [[0, 1]] });
        expect(ok).toBe(true);

        expect(state.groups.length).toBe(originalGroupCount - 1);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged).toBeDefined();
        expect([...merged!.pieces.keys()].sort()).toEqual([0, 1]);
    });

    it('restores merged-group rotation when rotation mode is on', () => {
        const state = fresh(123, 'quarter-turn');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [2] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(2);
    });

    it('restores solo-piece rotations from sr', () => {
        const state = fresh(123, 'quarter-turn');
        // Force all solo rotations to a known baseline (0) before the test.
        for (const g of state.groups) g.rotation = 0;

        const ok = applyProgress(state, { m: [], sr: [2, 1, 5, 3] });
        expect(ok).toBe(true);
        const soloFor = (pid: number) =>
            state.groups.find((g) => g.pieces.size === 1 && g.pieces.has(pid))!;
        expect(soloFor(2).rotation).toBe(1);
        expect(soloFor(5).rotation).toBe(3);
    });

    it('returns false if any group references a missing piece id', () => {
        const state = fresh(123);
        const ok = applyProgress(state, { m: [[0, 999]] });
        expect(ok).toBe(false);
    });

    it('returns false if any group references disconnected pieces', () => {
        const state = fresh(123);
        // Pieces 0 and 2 are not adjacent.
        const ok = applyProgress(state, { m: [[0, 2]] });
        expect(ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/game/reconstruct-groups.test.ts`
Expected: FAIL — `applyProgress` does not exist.

- [ ] **Step 3: Implement `applyProgress`**

Append to `src/game/reconstruct-groups.ts`:

```ts
import type { GameState, PieceGroup } from '../model/types.js';

export interface ProgressInput {
    m: number[][];
    mr?: number[];
    sr?: number[];
}

export function applyProgress(state: GameState, progress: ProgressInput): boolean {
    // Validate merged groups first so we can abort atomically.
    const reconstructed: Array<{ ids: number[]; offsets: Map<number, { x: number; y: number }> }> = [];
    for (const ids of progress.m) {
        if (ids.length < 2) return false;
        const offsets = computeMergedOffsets(state.pieces, ids);
        if (!offsets) return false;
        reconstructed.push({ ids, offsets });
    }

    const nextGroupId = Math.max(0, ...state.groups.map((g) => g.id)) + 1;
    let idCursor = nextGroupId;

    // Remove solo groups that are being absorbed into merges.
    const absorbedIds = new Set<number>();
    for (const { ids } of reconstructed) for (const id of ids) absorbedIds.add(id);
    state.groups = state.groups.filter((g) => {
        if (g.pieces.size !== 1) return true;
        const [only] = g.pieces.keys();
        return !absorbedIds.has(only);
    });

    // Push each reconstructed merged group.
    reconstructed.forEach(({ ids, offsets }, idx) => {
        const rotation = (progress.mr?.[idx] ?? 0) as 0 | 1 | 2 | 3;
        const group: PieceGroup = {
            id: idCursor++,
            pieces: offsets,
            position: { x: 0, y: 0 }, // gatherAndZoomToFit re-lays-out after this.
            rotation,
        };
        state.groups.push(group);
    });

    // Apply solo rotations.
    if (progress.sr && progress.sr.length >= 2) {
        for (let i = 0; i + 1 < progress.sr.length; i += 2) {
            const pid = progress.sr[i];
            const rot = progress.sr[i + 1] as 0 | 1 | 2 | 3;
            const g = state.groups.find((g) => g.pieces.size === 1 && g.pieces.has(pid));
            if (g) g.rotation = rot;
        }
    }

    return true;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run src/game/reconstruct-groups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/reconstruct-groups.ts src/game/reconstruct-groups.test.ts
git commit -m "feat(game): apply shared progress to a fresh game state"
```

---

## Task 8: `sharePuzzle` — Web Share + clipboard fallback

**Files:**
- Create: `src/ui/share.ts`
- Create: `src/ui/share.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/share.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sharePuzzle } from './share.js';

function stubNavigator(stub: Partial<Navigator>): void {
    Object.defineProperty(globalThis, 'navigator', {
        value: stub,
        configurable: true,
    });
}

describe('sharePuzzle', () => {
    let onCopied: ReturnType<typeof vi.fn>;
    let onError: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onCopied = vi.fn();
        onError = vi.fn();
    });

    it('prefers navigator.share when available', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ share } as unknown as Navigator);

        await sharePuzzle({
            url: 'https://example/#p=x',
            title: 't', text: 'd',
            onCopied, onError,
        });

        expect(share).toHaveBeenCalledWith({
            url: 'https://example/#p=x', title: 't', text: 'd',
        });
        expect(onCopied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('swallows AbortError without falling back', async () => {
        const share = vi.fn().mockRejectedValue(
            Object.assign(new Error('cancelled'), { name: 'AbortError' }),
        );
        const writeText = vi.fn();
        stubNavigator({ share, clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).not.toHaveBeenCalled();
        expect(onCopied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('falls back to clipboard when navigator.share is missing', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).toHaveBeenCalledWith('u');
        expect(onCopied).toHaveBeenCalledTimes(1);
    });

    it('falls back to clipboard on a non-Abort share error', async () => {
        const share = vi.fn().mockRejectedValue(new Error('boom'));
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ share, clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).toHaveBeenCalledWith('u');
        expect(onCopied).toHaveBeenCalledTimes(1);
    });

    it('calls onError when clipboard fails', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('no clip'));
        stubNavigator({ clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('calls onError when neither share nor clipboard is available', async () => {
        stubNavigator({} as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(onError).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/ui/share.test.ts`
Expected: FAIL — `share.ts` missing.

- [ ] **Step 3: Implement `share.ts`**

Create `src/ui/share.ts`:

```ts
/**
 * sharePuzzle — invoke the OS share sheet if available, otherwise copy
 * the link to the clipboard. Users cancelling a native share sheet
 * (AbortError) do NOT fall through to clipboard — treat cancel as a
 * silent no-op.
 */

export interface SharePuzzleOptions {
    url: string;
    title: string;
    text: string;
    onCopied: () => void;
    onError: (e: Error) => void;
}

export async function sharePuzzle(opts: SharePuzzleOptions): Promise<void> {
    const { url, title, text, onCopied, onError } = opts;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
            await navigator.share({ url, title, text });
            return;
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            // fall through to clipboard
        }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(url);
            onCopied();
            return;
        } catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)));
            return;
        }
    }

    onError(new Error('No share mechanism available'));
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run src/ui/share.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/ui/share.ts src/ui/share.test.ts
git commit -m "feat(ui): share puzzle via Web Share API with clipboard fallback"
```

---

## Task 9: `showToast` — transient notification helper

**Files:**
- Create: `src/ui/toast.ts`
- Create: `src/ui/toast.test.ts`
- Modify: `src/style.css` (append `.app-toast` rules)

- [ ] **Step 1: Write the failing test**

Create `src/ui/toast.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from './toast.js';

describe('showToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.replaceChildren();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('appends a toast element to the document body', () => {
        showToast('Hello');
        const toast = document.querySelector('.app-toast');
        expect(toast).not.toBeNull();
        expect(toast!.textContent).toBe('Hello');
    });

    it('auto-dismisses after the default timeout', () => {
        showToast('Bye');
        vi.advanceTimersByTime(1_900);
        expect(document.querySelector('.app-toast')).not.toBeNull();
        vi.advanceTimersByTime(500);
        expect(document.querySelector('.app-toast')).toBeNull();
    });

    it('replaces any existing toast so two calls stack cleanly', () => {
        showToast('First');
        showToast('Second');
        const toasts = document.querySelectorAll('.app-toast');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toBe('Second');
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/ui/toast.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `toast.ts`**

Create `src/ui/toast.ts`:

```ts
/**
 * showToast — tiny glassmorphism notification shown at the bottom of the
 * viewport. Auto-dismisses; only one toast at a time.
 */

const DEFAULT_DURATION_MS = 2000;

export function showToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
    document.querySelectorAll('.app-toast').forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.textContent = message;
    toast.setAttribute('role', 'status');

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), durationMs);
}
```

- [ ] **Step 4: Style the toast**

Append to `src/style.css`:

```css
.app-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    background: rgba(30, 30, 30, 0.75);
    color: #fff;
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    font-size: 14px;
    z-index: 9999;
    pointer-events: none;
    animation: app-toast-in 180ms ease-out;
}

@keyframes app-toast-in {
    from { opacity: 0; transform: translate(-50%, 12px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
}
```

- [ ] **Step 5: Verify tests pass**

Run: `npx vitest run src/ui/toast.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/toast.ts src/ui/toast.test.ts src/style.css
git commit -m "feat(ui): add lightweight toast helper"
```

---

## Task 10: Info-modal "Share this puzzle" section

**Files:**
- Create: `src/ui/share-section.ts`
- Create: `src/ui/share-section.test.ts`
- Modify: `src/ui/info-modal.ts`
- Modify: `src/style.css` (append `.share-section` rules)

The Share section is built in its own module so `info-modal.ts` doesn't swell. The module exports `attachShareSection(parent, state, baseUrl)` — it appends the section's DOM to `parent` and wires the checkbox + button.

- [ ] **Step 1: Write the failing test**

Create `src/ui/share-section.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { attachShareSection } from './share-section.js';
import type { GameState } from '../model/types.js';

function state(overrides: Partial<GameState> = {}): GameState {
    return {
        pieces: [],
        groups: [
            { id: 0, pieces: new Map([[0, { x: 0, y: 0 }]]),
              position: { x: 0, y: 0 }, rotation: 0 },
        ],
        imageUrl: 'blank',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 4, rows: 3 },
        completed: false,
        seed: 1,
        cutStyle: 'classic',
        rotationMode: 'none',
        ...overrides,
    };
}

describe('attachShareSection', () => {
    let host: HTMLElement;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    it('renders a heading, checkbox, primary button, and URL preview', () => {
        attachShareSection(host, state(), 'https://example.com/');
        expect(host.querySelector('h3')?.textContent).toBe('Share this puzzle');
        expect(host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')).not.toBeNull();
        expect(host.querySelector<HTMLButtonElement>('[data-testid="share-primary-btn"]')).not.toBeNull();
        expect(host.querySelector<HTMLElement>('[data-testid="share-url-preview"]')).not.toBeNull();
    });

    it('disables the progress checkbox when no pieces are merged', () => {
        attachShareSection(host, state(), 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(true);
        expect(host.querySelector('[data-testid="share-progress-hint"]')?.textContent)
            .toMatch(/Make some progress/i);
    });

    it('disables the progress checkbox when the puzzle is complete', () => {
        const s = state({ completed: true });
        attachShareSection(host, s, 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(true);
        expect(host.querySelector('[data-testid="share-progress-hint"]')?.textContent)
            .toMatch(/already complete/i);
    });

    it('enables the checkbox when there is progress', () => {
        const s = state({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        attachShareSection(host, s, 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(false);
    });

    it('updates the URL preview when the checkbox toggles', () => {
        const s = state({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        attachShareSection(host, s, 'https://example.com/');
        const preview = host.querySelector<HTMLElement>('[data-testid="share-url-preview"]')!;
        const urlBefore = preview.textContent!;

        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));

        const urlAfter = preview.textContent!;
        expect(urlAfter).not.toBe(urlBefore);
        expect(urlAfter.length).toBeGreaterThan(urlBefore.length);
    });

    it('primary button label is "Share…" if navigator.share is available, else "Copy link"', () => {
        const originalNav = globalThis.navigator;
        try {
            Object.defineProperty(globalThis, 'navigator', {
                value: { share: () => {} }, configurable: true,
            });
            attachShareSection(host, state(), 'https://example.com/');
            expect(host.querySelector<HTMLButtonElement>('[data-testid="share-primary-btn"]')!.textContent)
                .toMatch(/Share/);
        } finally {
            Object.defineProperty(globalThis, 'navigator', { value: originalNav, configurable: true });
        }
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/ui/share-section.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `share-section.ts`**

Create `src/ui/share-section.ts`:

```ts
/**
 * Build and wire the "Share this puzzle" section for the info modal.
 * DOM-building is done via createElement so we don't hand-build HTML
 * strings here; the parent modal owns its HTML template.
 */

import type { GameState } from '../model/types.js';
import {
    buildShareUrl,
    gameStateToPayload,
    hasShareableProgress,
} from '../sharing/index.js';
import { sharePuzzle } from './share.js';
import { showToast } from './toast.js';

export function attachShareSection(
    parent: HTMLElement,
    state: GameState,
    baseUrl: string,
): void {
    const webShareAvailable =
        typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const section = document.createElement('section');
    section.className = 'info-section share-section';

    const h = document.createElement('h3');
    h.textContent = 'Share this puzzle';
    section.appendChild(h);

    const explainer = document.createElement('p');
    explainer.textContent = 'Send this link to share the same puzzle with a friend.';
    section.appendChild(explainer);

    // Checkbox row ----------------------------------------------------
    const label = document.createElement('label');
    label.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.testid = 'share-include-progress';

    const labelText = document.createElement('span');
    labelText.className = 'info-setting-label';
    labelText.textContent = 'Include my current progress';

    label.appendChild(checkbox);
    label.appendChild(labelText);
    section.appendChild(label);

    const hint = document.createElement('p');
    hint.className = 'info-setting-description';
    hint.dataset.testid = 'share-progress-hint';
    section.appendChild(hint);

    // Primary button -------------------------------------------------
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'share-primary-btn';
    button.dataset.testid = 'share-primary-btn';
    button.textContent = webShareAvailable ? 'Share…' : 'Copy link';
    section.appendChild(button);

    // URL preview ----------------------------------------------------
    const preview = document.createElement('div');
    preview.className = 'share-url-preview';
    preview.dataset.testid = 'share-url-preview';
    section.appendChild(preview);

    // Wiring ---------------------------------------------------------
    const progressAvailable = hasShareableProgress(state);
    const completed = !!state.completed;
    if (!progressAvailable && completed) {
        checkbox.disabled = true;
        hint.textContent = 'Puzzle is already complete.';
    } else if (!progressAvailable) {
        checkbox.disabled = true;
        hint.textContent = 'Make some progress first, then you can share it.';
    } else {
        checkbox.disabled = false;
        hint.textContent = 'Off by default. Turning this on makes the link longer.';
    }

    function currentUrl(): string {
        const payload = gameStateToPayload(state, {
            includeProgress: checkbox.checked && !checkbox.disabled,
        });
        return buildShareUrl(baseUrl, payload);
    }

    function refreshPreview(): void {
        preview.textContent = currentUrl();
    }
    refreshPreview();
    checkbox.addEventListener('change', refreshPreview);

    button.addEventListener('click', () => {
        void sharePuzzle({
            url: currentUrl(),
            title: 'Puzzle',
            text: 'Have a go at this puzzle!',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (e) => showToast(`Couldn't share: ${e.message}`),
        });
    });

    parent.appendChild(section);
}
```

- [ ] **Step 4: Style the section**

Append to `src/style.css`:

```css
.share-section .share-primary-btn {
    margin-top: 12px;
    padding: 10px 18px;
    background: rgba(80, 140, 255, 0.22);
    border: 1px solid rgba(80, 140, 255, 0.45);
    color: #fff;
    border-radius: 10px;
    font-size: 14px;
    cursor: pointer;
}
.share-section .share-primary-btn:hover {
    background: rgba(80, 140, 255, 0.32);
}
.share-section .share-url-preview {
    margin-top: 10px;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 8px;
    font-family: monospace;
    font-size: 11px;
    word-break: break-all;
    max-height: 96px;
    overflow-y: auto;
    user-select: all;
    color: #ddd;
}
```

- [ ] **Step 5: Wire into `info-modal.ts`**

In `src/ui/info-modal.ts`:

1. Add an optional `state?: GameState` field to `InfoModalOptions` and import `GameState`.
2. Import `attachShareSection`.
3. Immediately after the existing `Settings` section is rendered (the block that wires the tolerance buttons, offset-drag toggle, etc.), call:

```ts
if (options.state) {
    // Find the Credits section and insert Share before it.
    const creditsHeading = Array.from(content.querySelectorAll<HTMLElement>('section.info-section h3'))
        .find((h) => h.textContent === 'Credits');
    const before = creditsHeading?.parentElement ?? null;
    if (before) {
        const holder = document.createElement('div');
        attachShareSection(holder, options.state, window.location.href);
        const shareSection = holder.firstElementChild;
        if (shareSection) content.insertBefore(shareSection, before);
    } else {
        attachShareSection(content, options.state, window.location.href);
    }
}
```

- [ ] **Step 6: Verify tests pass**

Run: `npx vitest run src/ui/share-section.test.ts src/ui/info-modal.test.ts`
Expected: PASS (existing info-modal tests remain green; if there are no existing info-modal tests, just run the share-section suite).

- [ ] **Step 7: Commit**

```bash
git add src/ui/share-section.ts src/ui/share-section.test.ts src/ui/info-modal.ts src/style.css
git commit -m "feat(ui): add Share this puzzle section to info modal"
```

---

## Task 11: Completion overlay "Challenge a friend" button

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css` (append `.completion-share-btn` rules)

The completion overlay lives in `src/main.ts` as `showCompletionOverlay`. We add a button between the "Well done!" line and the dismiss hint, with `stopPropagation` on click so the overlay-dismiss handler doesn't fire.

- [ ] **Step 1: Modify `showCompletionOverlay` in `src/main.ts`**

Change the function so, after the overlay element is created and its template rendered, we locate the dismiss hint and insert a "Challenge a friend" button before it:

```ts
// After the existing overlay.innerHTML = `...` block, before the
// addEventListener('click', removeCompletionOverlay) line:
const challengeBtn = document.createElement('button');
challengeBtn.type = 'button';
challengeBtn.className = 'completion-share-btn';
challengeBtn.textContent = 'Challenge a friend — share this puzzle!';
challengeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const payload = gameStateToPayload(gameState, { includeProgress: false });
    const url = buildShareUrl(window.location.href, payload);
    void sharePuzzle({
        url,
        title: 'Puzzle',
        text: 'I finished this puzzle — can you?',
        onCopied: () => showToast('Link copied to clipboard'),
        onError: (e) => showToast(`Couldn't share: ${e.message}`),
    });
});

const message = overlay.querySelector('.completion-message');
const dismissHint = message?.querySelector('.completion-dismiss-hint');
if (message && dismissHint) {
    message.insertBefore(challengeBtn, dismissHint);
} else if (message) {
    message.appendChild(challengeBtn);
}
```

Add the imports at the top of `src/main.ts`:

```ts
import { gameStateToPayload, buildShareUrl } from './sharing/index.js';
import { sharePuzzle } from './ui/share.js';
import { showToast } from './ui/toast.js';
```

- [ ] **Step 2: Style the button**

Append to `src/style.css`:

```css
.completion-share-btn {
    margin-top: 16px;
    padding: 10px 22px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.35);
    color: #fff;
    border-radius: 12px;
    font-size: 16px;
    cursor: pointer;
    backdrop-filter: blur(6px);
}
.completion-share-btn:hover {
    background: rgba(255, 255, 255, 0.25);
}
```

- [ ] **Step 3: Smoke-test in the browser**

Run: `npm run dev`

Open the app, use the solve debug button to complete a puzzle. Confirm:
- "Challenge a friend — share this puzzle!" button appears inside the overlay.
- Clicking it opens the native share sheet or copies the link (toast appears).
- Clicking it does NOT dismiss the overlay.
- Clicking anywhere else on the overlay still dismisses it.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat(ui): add Challenge a friend button to completion overlay"
```

---

## Task 12: Open shared links on boot

**Files:**
- Modify: `src/main.ts`

This is the boot-time integration: before restoring a saved game, check `window.location.hash`. If it's a valid `#p=...` link, confirm with the user when there's in-progress work, then clear the hash and load the shared puzzle.

- [ ] **Step 1: Locate the current boot flow**

Find the section in `src/main.ts` where the game is bootstrapped (look for `loadSavedGame`, `restoreGame`, `startNewGame` call sites near the top-level initialisation — typically toward the bottom of the file after the helper functions).

- [ ] **Step 2: Wrap the boot flow**

Add imports:

```ts
import { parseLocationHash, type SharePayload } from './sharing/index.js';
import { applyProgress } from './game/reconstruct-groups.js';
```

Before the existing save-restore branch, insert:

```ts
async function tryLoadSharedPuzzle(): Promise<boolean> {
    const payload = parseLocationHash(window.location.hash);
    if (!payload) {
        if (window.location.hash.startsWith('#p=')) {
            showToast('Invalid share link');
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return false;
    }

    if (shouldConfirmNewGame()) {
        const ok = window.confirm(
            'Load shared puzzle? Your current progress will be lost.',
        );
        if (!ok) {
            // Leave the hash in place so the user can reload to retry or
            // copy the URL elsewhere.
            return false;
        }
    }

    clearSavedState();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await loadSharedPuzzle(payload);
    return true;
}

async function loadSharedPuzzle(payload: SharePayload): Promise<void> {
    const imageUrl = payload.i;
    const imageSize = { width: payload.is[0], height: payload.is[1] };

    // If the sentinel is the blank canvas, regenerate it locally.
    const actualImageUrl = imageUrl === 'blank'
        ? generateBlankImageDataUrl(imageSize.width, imageSize.height)
        : imageUrl;

    const attribution = payload.a
        ? { photographerName: payload.a.n, photographerUrl: payload.a.u, photoUrl: payload.a.p }
        : undefined;

    const state = createNewGame(
        actualImageUrl,
        imageSize,
        getViewportSize(),
        { cols: payload.g[0], rows: payload.g[1] },
        {
            cutStyle: payload.c,
            seed: payload.s,
            rotationMode: payload.r,
            fractalConfig: payload.ff ? { borderless: payload.ff.bl } : undefined,
            composableConfig: payload.cf
                ? {
                    horizontalAmplitude: payload.cf.ha,
                    horizontalFrequency: payload.cf.hf,
                    verticalAmplitude: payload.cf.va,
                    verticalFrequency: payload.cf.vf,
                    disableTabs: payload.cf.dt,
                  }
                : undefined,
        },
    );
    if (attribution) state.attribution = attribution;

    if (payload.pr) {
        const ok = applyProgress(state, payload.pr);
        if (!ok) {
            showToast("Couldn't load progress — starting from scratch");
        }
    }

    installState(state);
    gatherAndZoomToFit();
}
```

Note: `shouldConfirmNewGame`, `clearSavedState`, `getViewportSize`, `generateBlankImageDataUrl`, and `installState` may have different names in the actual codebase — use the existing helpers that the current `startNewGame` / save-restore code calls. Rename the references above to match. If the blank-image generation lives inside `startNewGame`, extract it into a small exported helper in the same PR so both code paths can share it.

Change the top-level bootstrap so the very first step is:

```ts
void (async () => {
    const loadedFromShare = await tryLoadSharedPuzzle();
    if (loadedFromShare) return;
    // existing save-restore / default-new-game path goes here
})();
```

- [ ] **Step 3: Manual test in the browser**

Run: `npm run dev`

1. Open the app, complete a few merges, open DevTools → Application → Local Storage and copy the saved state as a sanity check.
2. In the info modal, toggle "Include my current progress", copy the URL preview.
3. Open the URL in a new window (or paste into the address bar to replace). Expect:
   - The confirm dialog, if there's still a saved game.
   - After confirming, the puzzle loads with the same image, cuts, and merged group(s).
4. Repeat with progress OFF — a starting-puzzle share should load fresh.
5. Repeat with a garbage hash like `#p=xxxxx` — expect the "Invalid share link" toast and the hash to disappear.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): open shared puzzles from URL hash on boot"
```

---

## Task 13: Update in-app help text

**Files:**
- Modify: `src/ui/info-modal.ts`

Repo convention (`CLAUDE.md`): user-visible features get a help-text update in the same PR. Add a bullet in the "How to Play" section about sharing, and a short paragraph explaining the Share section and the "Challenge a friend" button.

- [ ] **Step 1: Add a "Sharing" sub-item to the How-to-Play list**

In the `How to Play` `<ul>` inside `src/ui/info-modal.ts`, add a new `<li>` after the toolbar sub-list (or alongside it, depending on the existing shape):

```html
<li><strong>Share this puzzle</strong> — scroll down to the <em>Share this puzzle</em> section below to copy a link your friends can open to get the exact same puzzle. Finish a puzzle to unlock a <em>Challenge a friend</em> button on the completion screen.</li>
```

- [ ] **Step 2: Manual check**

Open the modal in the browser, scroll through How to Play, confirm the new bullet renders correctly and the Share section is visible.

- [ ] **Step 3: Commit**

```bash
git add src/ui/info-modal.ts
git commit -m "docs(info-modal): document puzzle sharing in How to Play"
```

---

## Task 14: Update BACKLOG and final verification

**Files:**
- Modify: `BACKLOG.md`

- [ ] **Step 1: Move the sharing item from "Ideas" to "Done"**

Open `BACKLOG.md`, locate any existing entry about puzzle sharing (if it was listed as a future idea) and move / strike / annotate it as completed. If no entry exists, add one under the "Done" section:

```md
- Puzzle sharing via link (implemented 2026-04-22).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass, including the new suites.

- [ ] **Step 3: Type-check and lint**

Run: `npm run build` (or the project's type-check command — check `package.json`).
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md
git commit -m "docs(backlog): mark puzzle sharing as done"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/puzzle-sharing
gh pr create --title "feat: puzzle sharing via link" --body "$(cat <<'EOF'
## Summary
- Share a puzzle via `#p=<payload>` URL hash — same image, cuts, seed, and (optionally) merge progress
- Web Share API with clipboard fallback; completion-screen "Challenge a friend" button
- Help text updated in the info modal

## Test plan
- [ ] Run `npm test -- --run` — all suites pass
- [ ] Open a share link with no progress; puzzle loads identical to sharer
- [ ] Open a share link with progress; merges are reconstructed
- [ ] Open a share link when a game is in progress — confirm dialog appears
- [ ] Malformed `#p=…` shows toast and falls through to normal boot
- [ ] Completion overlay "Challenge a friend" button opens share sheet / copies link

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes on correctness

- **Deterministic pieces:** the reconstruction relies on piece IDs being stable for a given `(cutStyle, seed, gridSize, cut-style config)` tuple. This is currently true for all three generators. If that invariant ever changes, the schema version `v` must be bumped and a migration path added.
- **Scatter vs. reconstruction:** `createInitialGroups` randomises positions with `Math.random`, so a shared starting puzzle does not reproduce scatter positions — this is deliberate (spec non-goal). `applyProgress` ignores those positions and lets `gatherAndZoomToFit` lay everything out.
- **Blank image determinism:** `generateBlankImageDataUrl(w, h)` must produce the exact same bytes on sender and recipient. A plain `CanvasRenderingContext2D.fillRect` over a white background is deterministic across browsers at the resolution we use (1080×720). If the blank generator ever starts using randomness, the `i: "blank"` shortcut needs rethinking.
- **AbortError hygiene:** on iOS Safari, the Web Share API throws `AbortError` when the user cancels — we must not surface that as a failure. The test suite in Task 8 pins this behaviour.
