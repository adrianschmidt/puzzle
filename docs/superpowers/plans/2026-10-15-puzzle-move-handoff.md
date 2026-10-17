# Puzzle Move Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player on the old site (`adrianschmidt.github.io/puzzle/`) carry their puzzle, settings and analytics identity to `puzzlewise.github.io` with one click, and steer them there.

**Architecture:** A new `src/move/` area holds both roles. The *source* role (old site) is active only when built with `VITE_MOVED_TO`; it shows a banner, intercepts New puzzle with a move dialog, and runs a popup + `postMessage` handoff. The *target* role (new site) runs when the page is opened as `?receive-move` by another window: it validates, writes with rollback, and reloads into the moved puzzle. Both are wired in `src/app/bootstrap.ts`.

**Tech Stack:** TypeScript (strict), Vite, Vitest + jsdom, oxlint. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-puzzle-move-handoff-design.md`

## Global Constraints

- Node 22 for every `npm`/`npx` command (`.nvmrc`). Prefix commands with `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH` — the default `node` here is 24 and breaks a geometry digest test.
- Source role exists only when `VITE_MOVED_TO` is set (a full app URL, e.g. `https://puzzlewise.github.io/`). Unset = today's behavior, byte-for-byte in UX.
- Target trusts only `VITE_MOVED_FROM` (an origin), default `https://adrianschmidt.github.io`, and is inert when its own origin equals that origin.
- Message envelope: `{ type: 'puzzle-move/<kind>', v: 1, … }`; kinds `ready`, `payload`, `done`, `declined`, `failed`; failure reasons `invalid-payload`, `unloadable-save`, `write-failed`.
- Every `postMessage` names the exact peer origin as `targetOrigin`; every listener checks `event.origin` and `event.source`.
- The old site's data is never modified except writing `puzzle-moved-to` after `done`.
- Ready timeout on the source and payload timeout on the target: 30 000 ms.
- Comment policy (`CLAUDE.md`): add a comment only if it is intent or a not-in-code contract *and* definitely worth its upkeep. The code below is written to need almost none. `umami.ts` doc comments are the operator-facing spec — keep them accurate and minimal.
- American English in identifiers and comments.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Progress from the last 500 ms before Move** (debounced autosave) must arrive on the new site — the source flushes the save coordinator before the handoff (Task 6 test).
2. **A save written by the frozen legacy build** must keep loading on the new site after future format changes — a pinned save blob literal is applied and loaded (Task 3 test).
3. **Incoming save without a progress key while the target has its own progress** — the stale target progress must be removed, not paired with the new geometry (Task 3 test).
4. **Another open tab of the new site** — the move drops the geometry-ownership token so that tab's next autosave re-checks ownership instead of tearing the pair (Task 3 test).
5. **Player closes the dialog mid-handoff** — no late result event, no `puzzle-moved-to` write (Task 4 and Task 6 tests).

---

### Task 1: Move config and protocol

**Files:**
- Create: `src/move/move-config.ts`
- Create: `src/move/move-protocol.ts`
- Test: `src/move/move-config.test.ts`
- Test: `src/move/move-protocol.test.ts`

**Interfaces:**
- Produces:
  - `MOVED_TO_KEY = 'puzzle-moved-to'`, `RECEIVE_MOVE_PARAM = 'receive-move'`
  - `movedToUrl(): string | undefined`
  - `moveSourceOrigin(): string`
  - `receiveMoveUrl(targetUrl: string): string`
  - `isIosStandalone(nav?: Navigator): boolean`
  - `shareBaseUrl(): string`
  - `hasMoved(): boolean`, `markMoved(targetUrl: string): void`
  - `type MoveFailureReason = 'invalid-payload' | 'unloadable-save' | 'write-failed'`
  - `type MoveMessage = { kind: 'ready' } | { kind: 'payload'; entries: unknown } | { kind: 'done' } | { kind: 'declined' } | { kind: 'failed'; reason: MoveFailureReason }`
  - `encodeMoveMessage(message: MoveMessage): Record<string, unknown>`
  - `readMoveMessage(data: unknown): MoveMessage | undefined`
  - `MOVE_FAILURE_TEXT: Record<MoveFailureReason, string>`

- [ ] **Step 1: Write the failing config test**

`src/move/move-config.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    MOVED_TO_KEY,
    hasMoved,
    isIosStandalone,
    markMoved,
    movedToUrl,
    moveSourceOrigin,
    receiveMoveUrl,
    shareBaseUrl,
} from './move-config.js';

afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    history.replaceState(null, '', '/');
});

describe('movedToUrl', () => {
    it('is undefined when VITE_MOVED_TO is unset', () => {
        vi.stubEnv('VITE_MOVED_TO', '');
        expect(movedToUrl()).toBeUndefined();
    });

    it('normalizes the configured URL', () => {
        vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io');
        expect(movedToUrl()).toBe('https://puzzlewise.github.io/');
    });
});

describe('moveSourceOrigin', () => {
    it('defaults to the legacy origin', () => {
        vi.stubEnv('VITE_MOVED_FROM', '');
        expect(moveSourceOrigin()).toBe('https://adrianschmidt.github.io');
    });

    it('reduces an override to its origin', () => {
        vi.stubEnv('VITE_MOVED_FROM', 'http://localhost:5173/puzzle/');
        expect(moveSourceOrigin()).toBe('http://localhost:5173');
    });
});

describe('receiveMoveUrl', () => {
    it('replaces query and hash with the receive parameter', () => {
        expect(receiveMoveUrl('http://localhost:5174/puzzle/?x=1#p=abc'))
            .toBe('http://localhost:5174/puzzle/?receive-move');
    });
});

describe('isIosStandalone', () => {
    it('is true only for navigator.standalone === true', () => {
        expect(isIosStandalone({ standalone: true } as unknown as Navigator)).toBe(true);
        expect(isIosStandalone({ standalone: false } as unknown as Navigator)).toBe(false);
        expect(isIosStandalone({} as Navigator)).toBe(false);
    });
});

describe('shareBaseUrl', () => {
    it('is the current page without its hash when not moved', () => {
        vi.stubEnv('VITE_MOVED_TO', '');
        history.replaceState(null, '', '/puzzle/?userid=x#p=abc');
        expect(shareBaseUrl()).toBe(`${location.origin}/puzzle/?userid=x`);
    });

    it('is the new site when VITE_MOVED_TO is set', () => {
        vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
        expect(shareBaseUrl()).toBe('https://puzzlewise.github.io/');
    });
});

describe('hasMoved / markMoved', () => {
    it('records the target URL', () => {
        expect(hasMoved()).toBe(false);
        markMoved('https://puzzlewise.github.io/');
        expect(hasMoved()).toBe(true);
        expect(localStorage.getItem(MOVED_TO_KEY)).toBe('https://puzzlewise.github.io/');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-config.test.ts`
Expected: FAIL — cannot resolve `./move-config.js`.

- [ ] **Step 3: Implement `src/move/move-config.ts`**

```ts
import { diagnostics } from '../diagnostics.js';

export const MOVED_TO_KEY = 'puzzle-moved-to';

export const RECEIVE_MOVE_PARAM = 'receive-move';

const DEFAULT_SOURCE_ORIGIN = 'https://adrianschmidt.github.io';

export function movedToUrl(): string | undefined {
    const raw = import.meta.env.VITE_MOVED_TO as string | undefined;
    return raw ? new URL(raw).href : undefined;
}

export function moveSourceOrigin(): string {
    const raw = import.meta.env.VITE_MOVED_FROM as string | undefined;
    return new URL(raw || DEFAULT_SOURCE_ORIGIN).origin;
}

export function receiveMoveUrl(targetUrl: string): string {
    const url = new URL(targetUrl);
    url.search = RECEIVE_MOVE_PARAM;
    url.hash = '';
    return url.href;
}

/**
 * `navigator.standalone` is set only by iOS/iPadOS Safari for home-screen web
 * apps, whose storage is isolated from Safari's — a handoff from there could
 * not reach the new site's Safari or home-screen storage.
 */
export function isIosStandalone(nav: Navigator = navigator): boolean {
    return (nav as Navigator & { standalone?: unknown }).standalone === true;
}

export function shareBaseUrl(): string {
    return movedToUrl() ?? window.location.href.split('#')[0];
}

export function hasMoved(): boolean {
    try {
        return localStorage.getItem(MOVED_TO_KEY) !== null;
    } catch {
        return false;
    }
}

export function markMoved(targetUrl: string): void {
    try {
        localStorage.setItem(MOVED_TO_KEY, targetUrl);
    } catch (error) {
        diagnostics.warn(`Could not record "${MOVED_TO_KEY}":`, error);
    }
}
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing protocol test**

`src/move/move-protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeMoveMessage, readMoveMessage, type MoveMessage } from './move-protocol.js';

describe('move protocol', () => {
    const messages: MoveMessage[] = [
        { kind: 'ready' },
        { kind: 'payload', entries: { 'puzzle-cut-style': 'classic' } },
        { kind: 'done' },
        { kind: 'declined' },
        { kind: 'failed', reason: 'unloadable-save' },
    ];

    it.each(messages)('round-trips %o', (message) => {
        expect(readMoveMessage(encodeMoveMessage(message))).toEqual(message);
    });

    it('uses the documented envelope', () => {
        expect(encodeMoveMessage({ kind: 'ready' })).toEqual({ type: 'puzzle-move/ready', v: 1 });
    });

    it.each([
        null,
        'puzzle-move/ready',
        { type: 'puzzle-move/ready' },
        { type: 'puzzle-move/ready', v: 2 },
        { type: 'other/ready', v: 1 },
        { type: 'puzzle-move/unknown', v: 1 },
        { type: 'puzzle-move/failed', v: 1, reason: 'nope' },
    ])('rejects %o', (data) => {
        expect(readMoveMessage(data)).toBeUndefined();
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-protocol.test.ts`
Expected: FAIL — cannot resolve `./move-protocol.js`.

- [ ] **Step 7: Implement `src/move/move-protocol.ts`**

```ts
export type MoveFailureReason = 'invalid-payload' | 'unloadable-save' | 'write-failed';

export type MoveMessage =
    | { kind: 'ready' }
    | { kind: 'payload'; entries: unknown }
    | { kind: 'done' }
    | { kind: 'declined' }
    | { kind: 'failed'; reason: MoveFailureReason };

export const MOVE_FAILURE_TEXT: Record<MoveFailureReason, string> = {
    'invalid-payload': 'the new site couldn’t read what was sent',
    'unloadable-save': 'the new site couldn’t open your saved puzzle',
    'write-failed': 'the new site couldn’t store it',
};

const TYPE_PREFIX = 'puzzle-move/';
const VERSION = 1;
const FAILURE_REASONS: readonly MoveFailureReason[] = [
    'invalid-payload',
    'unloadable-save',
    'write-failed',
];

export function encodeMoveMessage(message: MoveMessage): Record<string, unknown> {
    const { kind, ...rest } = message;
    return { type: TYPE_PREFIX + kind, v: VERSION, ...rest };
}

export function readMoveMessage(data: unknown): MoveMessage | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    const record = data as Record<string, unknown>;
    if (record.v !== VERSION || typeof record.type !== 'string') return undefined;
    if (!record.type.startsWith(TYPE_PREFIX)) return undefined;
    const kind = record.type.slice(TYPE_PREFIX.length);
    switch (kind) {
        case 'ready':
        case 'done':
        case 'declined':
            return { kind };
        case 'payload':
            return { kind, entries: record.entries };
        case 'failed': {
            const reason = FAILURE_REASONS.find((r) => r === record.reason);
            return reason === undefined ? undefined : { kind, reason };
        }
        default:
            return undefined;
    }
}
```

- [ ] **Step 8: Run both tests and lint**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/ && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/move/move-config.ts src/move/move-config.test.ts src/move/move-protocol.ts src/move/move-protocol.test.ts
git commit -F - <<'EOF'
feat(move): add move config and handoff message protocol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Moved-key allowlist with tripwire

**Files:**
- Create: `src/move/move-keys.ts`
- Test: `src/move/move-keys.test.ts`

**Interfaces:**
- Produces: `MOVED_KEYS: readonly string[]`, `NOT_MOVED_KEYS: readonly string[]`

- [ ] **Step 1: Write the failing tripwire test**

`src/move/move-keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MOVED_KEYS, NOT_MOVED_KEYS } from './move-keys.js';

const SOURCES = import.meta.glob('/src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const KEY_DECLARATION = /\b[A-Z][A-Z0-9_]*KEY\s*=\s*'([^']+)'/g;

function declaredStorageKeys(): Set<string> {
    const keys = new Set<string>();
    for (const [path, source] of Object.entries(SOURCES)) {
        if (path.endsWith('.test.ts')) continue;
        for (const match of source.matchAll(KEY_DECLARATION)) keys.add(match[1]);
    }
    return keys;
}

describe('moved storage keys', () => {
    it('classifies every storage key the app declares', () => {
        const classified = new Set([...MOVED_KEYS, ...NOT_MOVED_KEYS]);
        const unclassified = [...declaredStorageKeys()].filter((key) => !classified.has(key));
        expect(unclassified, 'add each new key to MOVED_KEYS or NOT_MOVED_KEYS').toEqual([]);
    });

    it('lists only keys the app declares', () => {
        const declared = declaredStorageKeys();
        const stale = [...MOVED_KEYS, ...NOT_MOVED_KEYS].filter((key) => !declared.has(key));
        expect(stale).toEqual([]);
    });

    it('never lists a key as both moved and not moved', () => {
        expect(MOVED_KEYS.filter((key) => NOT_MOVED_KEYS.includes(key))).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-keys.test.ts`
Expected: FAIL — cannot resolve `./move-keys.js`.

- [ ] **Step 3: Implement `src/move/move-keys.ts`**

```ts
export const MOVED_KEYS: readonly string[] = [
    'puzzle-game-state',
    'puzzle-progress',
    'puzzle-background-color',
    'puzzle-background-colour',
    'puzzle-piece-outline',
    'puzzle-piece-outline-color',
    'puzzle-merge-tolerance',
    'puzzle-rotation-enabled',
    'puzzle-marquee-contain',
    'puzzle-offset-drag',
    'puzzle-image-source',
    'puzzle-image-category',
    'puzzle-image-vibrant',
    'puzzle-size-preference',
    'puzzle-cut-style',
    'puzzle-composable-config',
    'puzzle-fractal-config',
    'puzzle-wavy-config',
    'puzzle-analytics-userid',
    'puzzle-game-analytics',
];

/**
 * - `puzzle-geometry-seed`: derived; the loader rebuilds it.
 * - `puzzle-offline-image-stash`: its images live in the old origin's Cache
 *   Storage, so the metadata would claim images the new site does not have.
 * - `puzzle-moved-to`: source-only.
 * - `share-link-rescue-attempt`: a per-tab sessionStorage guard.
 */
export const NOT_MOVED_KEYS: readonly string[] = [
    'puzzle-geometry-seed',
    'puzzle-offline-image-stash',
    'puzzle-moved-to',
    'share-link-rescue-attempt',
];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-keys.test.ts`
Expected: PASS. If "classifies every storage key" lists a key not in either list, look up what it stores and add it to the right list — do not loosen the regex.

- [ ] **Step 5: Commit**

```bash
git add src/move/move-keys.ts src/move/move-keys.test.ts
git commit -F - <<'EOF'
feat(move): list which storage keys move to the new site

A tripwire test fails when a storage key is declared without being
classified, so a new setting can't silently stay behind.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Receiver (new site)

**Files:**
- Create: `src/move/move-receiver.ts`
- Create: `src/ui/receive-move-screen.ts`
- Modify: `src/style.css` (extend the corrupt-save dialog selectors)
- Test: `src/move/move-receiver.test.ts`
- Test: `src/ui/receive-move-screen.test.ts`

**Interfaces:**
- Consumes: Task 1 (`moveSourceOrigin`, `RECEIVE_MOVE_PARAM`, `encodeMoveMessage`, `readMoveMessage`, `MOVE_FAILURE_TEXT`, `MoveFailureReason`), Task 2 (`MOVED_KEYS`), `loadSavedGame`, `STORAGE_KEY`, `PROGRESS_KEY` from `../persistence/index.js`, `GEOMETRY_SEED_KEY` from `../persistence/storage.js`.
- Produces:
  - `REPLACE_PROMPT: string`, `PAYLOAD_TIMEOUT_MS = 30_000`
  - `type ApplyResult = { status: 'done' } | { status: 'declined' } | { status: 'failed'; reason: MoveFailureReason }`
  - `applyMoveEntries(entries: unknown, confirm: (message: string) => boolean): ApplyResult`
  - `isReceiveMode(win?: Window): boolean`
  - `runMoveReceiver(deps: MoveReceiverDeps): Promise<ApplyResult['status'] | 'timeout'>` with `MoveReceiverDeps = { container: HTMLElement; win?: Window; confirm?: (message: string) => boolean; navigate?: (url: string) => void; timeoutMs?: number }`
  - `createReceiveMoveScreen(container: HTMLElement): { showMessage(text: string, onContinue: () => void): void }`
  - `moveButton(label: string, primary?: boolean): HTMLButtonElement` (exported from `src/ui/receive-move-screen.ts`, reused by Task 5)
  - CSS classes `.move-overlay`, `.move-dialog`, `.move-title`, `.move-body`, `.move-status`, `.move-buttons`, `.move-btn`, `.move-btn--primary`

- [ ] **Step 1: Write the failing screen test**

`src/ui/receive-move-screen.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createReceiveMoveScreen } from './receive-move-screen.js';

describe('createReceiveMoveScreen', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.replaceChildren(container);
    });

    it('shows a receiving message with no buttons', () => {
        createReceiveMoveScreen(container);
        expect(container.querySelector('.move-body')?.textContent).toBe('Receiving your puzzle…');
        expect(container.querySelectorAll('button')).toHaveLength(0);
    });

    it('cannot be dismissed with Escape', () => {
        createReceiveMoveScreen(container);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(container.querySelector('.move-dialog')).not.toBeNull();
    });

    it('showMessage replaces the text and offers Continue', () => {
        const onContinue = vi.fn();
        createReceiveMoveScreen(container).showMessage('Nothing arrived.', onContinue);
        expect(container.querySelector('.move-body')?.textContent).toBe('Nothing arrived.');
        const button = container.querySelector<HTMLButtonElement>('.move-btn--primary')!;
        expect(button.textContent).toBe('Continue to Puzzle');
        button.click();
        expect(onContinue).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/receive-move-screen.test.ts`
Expected: FAIL — cannot resolve `./receive-move-screen.js`.

- [ ] **Step 3: Implement `src/ui/receive-move-screen.ts`**

```ts
import { createDismissableOverlay } from './dismissable-overlay.js';

export interface ReceiveMoveScreen {
    showMessage(text: string, onContinue: () => void): void;
}

export function moveButton(label: string, primary = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'move-btn move-btn--primary' : 'move-btn';
    button.textContent = label;
    return button;
}

export function createReceiveMoveScreen(container: HTMLElement): ReceiveMoveScreen {
    const { overlay } = createDismissableOverlay({
        container,
        className: 'move-overlay',
        dismissOn: 'none',
        dismissOnEscape: false,
    });

    const dialog = document.createElement('div');
    dialog.className = 'move-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Bringing your puzzle over');

    const title = document.createElement('h2');
    title.className = 'move-title';
    title.textContent = 'Bringing your puzzle over';

    const body = document.createElement('p');
    body.className = 'move-body';
    body.textContent = 'Receiving your puzzle…';

    const buttons = document.createElement('div');
    buttons.className = 'move-buttons';

    dialog.append(title, body, buttons);
    overlay.appendChild(dialog);

    return {
        showMessage(text, onContinue) {
            body.textContent = text;
            const button = moveButton('Continue to Puzzle', true);
            button.addEventListener('click', onContinue);
            buttons.replaceChildren(button);
        },
    };
}
```

- [ ] **Step 4: Extend the dialog CSS in `src/style.css`**

Add the move selectors to the existing corrupt-save rules (around lines 1566–1641) so both dialogs share one look. Change each selector line exactly as follows, leaving the declarations untouched:

```css
.corrupt-save-overlay,
.move-overlay {
```
```css
.corrupt-save-dialog,
.move-dialog {
```
```css
.corrupt-save-title,
.move-title {
```
```css
.corrupt-save-body,
.move-body {
```
```css
.corrupt-save-buttons,
.move-buttons {
```
```css
.corrupt-save-btn,
.move-btn {
```
```css
.corrupt-save-btn:hover,
.move-btn:hover {
```
```css
.corrupt-save-btn:disabled,
.move-btn:disabled {
```
```css
.corrupt-save-btn--primary,
.move-btn--primary {
```
```css
.corrupt-save-btn--primary:hover,
.move-btn--primary:hover {
```

Then append after the `.corrupt-save-btn--primary:hover` rule:

```css
.move-status {
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 0 20px;
}

.move-status:empty {
  display: none;
}
```

- [ ] **Step 5: Run the screen test**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/receive-move-screen.test.ts src/style.test.ts`
Expected: PASS.

- [ ] **Step 6: Capture a pinned save fixture**

Create a throwaway file `src/move/capture-fixture.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { it } from 'vitest';
import { saveNewPuzzle, STORAGE_KEY, PROGRESS_KEY } from '../persistence/index.js';
import { makeGameState, makeRectPiece } from '../test-helpers/fixtures.js';

it('prints a save', () => {
    localStorage.clear();
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups = pieces.map((piece) => ({
        id: piece.id,
        pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
        position: { x: piece.id * 150, y: 0 },
        rotation: 0,
    }));
    saveNewPuzzle(makeGameState({ pieces, groups, seed: 4242 }));
    console.log(JSON.stringify({
        geometry: localStorage.getItem(STORAGE_KEY),
        progress: localStorage.getItem(PROGRESS_KEY),
    }));
});
```

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/capture-fixture.test.ts --silent=false`
Copy the printed JSON object, then delete the throwaway file: `rm src/move/capture-fixture.test.ts`.

- [ ] **Step 7: Write the failing receiver test**

`src/move/move-receiver.test.ts` — paste the captured `geometry`/`progress` strings into `LEGACY_SAVE` verbatim (they are the frozen-format pin; never regenerate them):

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    loadSavedGame,
    saveNewPuzzle,
    serializeState,
    STORAGE_KEY,
    PROGRESS_KEY,
} from '../persistence/index.js';
import { GEOMETRY_SEED_KEY } from '../persistence/storage.js';
import type { GameState } from '../model/types.js';
import { makeGameState, makeRectPiece } from '../test-helpers/fixtures.js';
import {
    applyMoveEntries,
    isReceiveMode,
    runMoveReceiver,
    REPLACE_PROMPT,
} from './move-receiver.js';
import { encodeMoveMessage } from './move-protocol.js';

/** Written by the build that becomes the frozen legacy deploy. Never regenerate. */
const LEGACY_SAVE = {
    geometry: '<paste geometry string from Step 6>',
    progress: '<paste progress string from Step 6>',
};

const SOURCE_ORIGIN = 'https://adrianschmidt.github.io';

function makeTwoPieceState(seed: number): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups = pieces.map((piece) => ({
        id: piece.id,
        pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
        position: { x: 0, y: 0 },
        rotation: 0,
    }));
    return makeGameState({ pieces, groups, seed });
}

function makeSaveBlobs(seed: number): { geometry: string; progress: string } {
    saveNewPuzzle(makeTwoPieceState(seed));
    const blobs = {
        geometry: localStorage.getItem(STORAGE_KEY)!,
        progress: localStorage.getItem(PROGRESS_KEY)!,
    };
    localStorage.clear();
    return blobs;
}

function messageFrom(source: unknown, origin: string, data: unknown): MessageEvent {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    localStorage.clear();
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
    Reflect.deleteProperty(window, 'opener');
});

describe('applyMoveEntries', () => {
    const never = (): boolean => {
        throw new Error('confirm should not be called');
    };

    it('writes the save and moved settings, skipping unlisted keys', () => {
        const save = makeSaveBlobs(7);
        const result = applyMoveEntries({
            [STORAGE_KEY]: save.geometry,
            [PROGRESS_KEY]: save.progress,
            'puzzle-cut-style': 'wavy',
            'puzzle-offline-image-stash': '{"v":1}',
            'puzzle-geometry-seed': '999',
            'unrelated': 'x',
        }, never);

        expect(result).toEqual({ status: 'done' });
        expect(loadSavedGame().status).toBe('ok');
        expect(localStorage.getItem('puzzle-cut-style')).toBe('wavy');
        expect(localStorage.getItem('puzzle-offline-image-stash')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBeNull();
    });

    it('loads a save written by the legacy build', () => {
        const result = applyMoveEntries({
            [STORAGE_KEY]: LEGACY_SAVE.geometry,
            [PROGRESS_KEY]: LEGACY_SAVE.progress,
        }, never);

        expect(result).toEqual({ status: 'done' });
        const outcome = loadSavedGame();
        expect(outcome.status).toBe('ok');
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(4242);
    });

    it('moves settings alone without asking when no save comes along', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);

        const result = applyMoveEntries({ 'puzzle-cut-style': 'fractal' }, never);

        expect(result).toEqual({ status: 'done' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('fractal');
    });

    it('asks before replacing an existing save and writes nothing when declined', () => {
        const existing = makeSaveBlobs(1);
        const incoming = makeSaveBlobs(2);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        const confirm = vi.fn(() => false);

        const result = applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
            'puzzle-cut-style': 'wavy',
        }, confirm);

        expect(confirm).toHaveBeenCalledWith(REPLACE_PROMPT);
        expect(result).toEqual({ status: 'declined' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem('puzzle-cut-style')).toBeNull();
    });

    it('replaces an existing save when confirmed', () => {
        const existing = makeSaveBlobs(1);
        const incoming = makeSaveBlobs(2);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);

        const result = applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, () => true);

        expect(result).toEqual({ status: 'done' });
        const outcome = loadSavedGame();
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(2);
    });

    it('drops stale target progress when the incoming save is a legacy single-key blob', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        const legacy = JSON.stringify(serializeState(makeTwoPieceState(2)));

        const result = applyMoveEntries({ [STORAGE_KEY]: legacy }, () => true);

        expect(result).toEqual({ status: 'done' });
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        const outcome = loadSavedGame();
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(2);
    });

    it('re-anchors the geometry token to the moved save', () => {
        localStorage.setItem(GEOMETRY_SEED_KEY, '1');
        const incoming = makeSaveBlobs(2);

        applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, never);

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('2');
    });

    it.each([null, 'x', ['a'], { [STORAGE_KEY]: 5 }])('rejects malformed entries %o', (entries) => {
        expect(applyMoveEntries(entries, never)).toEqual({ status: 'failed', reason: 'invalid-payload' });
        expect(localStorage.length).toBe(0);
    });

    it('rolls back when the save does not load', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        localStorage.setItem('puzzle-cut-style', 'classic');

        const result = applyMoveEntries({
            [STORAGE_KEY]: '{not json',
            [PROGRESS_KEY]: '{}',
            'puzzle-cut-style': 'wavy',
        }, () => true);

        expect(result).toEqual({ status: 'failed', reason: 'unloadable-save' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(existing.progress);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('classic');
    });

    it('rolls back when a write throws', () => {
        localStorage.setItem('puzzle-cut-style', 'classic');
        const incoming = makeSaveBlobs(2);
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key === STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
            setItem.call(this, key, value);
        });

        const result = applyMoveEntries({
            'puzzle-cut-style': 'wavy',
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, () => true);
        vi.restoreAllMocks();

        expect(result).toEqual({ status: 'failed', reason: 'write-failed' });
        expect(localStorage.getItem('puzzle-cut-style')).toBe('classic');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});

describe('isReceiveMode', () => {
    it('is false without the parameter', () => {
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(false);
    });

    it('is true with the parameter and an opener', () => {
        history.replaceState(null, '', '/?receive-move');
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(true);
    });

    it('strips the parameter and is false without an opener', () => {
        history.replaceState(null, '', '/?receive-move&userid=x#h');
        expect(isReceiveMode()).toBe(false);
        expect(location.search).toBe('?userid=x');
        expect(location.hash).toBe('#h');
    });

    it('is inert on the source origin itself', () => {
        vi.stubEnv('VITE_MOVED_FROM', location.origin);
        history.replaceState(null, '', '/?receive-move');
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(false);
        expect(location.search).toBe('');
    });
});

describe('runMoveReceiver', () => {
    function setUp(timeoutMs = 30_000) {
        const opener = { postMessage: vi.fn() };
        Object.defineProperty(window, 'opener', { value: opener, configurable: true });
        history.replaceState(null, '', '/puzzle/?receive-move');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const navigate = vi.fn();
        const done = runMoveReceiver({ container, navigate, confirm: () => true, timeoutMs });
        return { opener, container, navigate, done };
    }

    it('announces ready to the source origin only', () => {
        const { opener } = setUp();
        expect(opener.postMessage).toHaveBeenCalledWith(encodeMoveMessage({ kind: 'ready' }), SOURCE_ORIGIN);
    });

    it('applies a payload, replies done, and continues to the app root', async () => {
        const { opener, navigate, done } = setUp();
        const save = makeSaveBlobs(3);

        window.dispatchEvent(messageFrom(opener, SOURCE_ORIGIN, encodeMoveMessage({
            kind: 'payload',
            entries: { [STORAGE_KEY]: save.geometry, [PROGRESS_KEY]: save.progress },
        })));

        await expect(done).resolves.toBe('done');
        expect(opener.postMessage).toHaveBeenLastCalledWith(encodeMoveMessage({ kind: 'done' }), SOURCE_ORIGIN);
        expect(navigate).toHaveBeenCalledWith('/puzzle/');
    });

    it('ignores payloads from another origin or window', () => {
        const { opener } = setUp();
        const payload = encodeMoveMessage({ kind: 'payload', entries: { 'puzzle-cut-style': 'wavy' } });

        window.dispatchEvent(messageFrom(opener, 'https://evil.example', payload));
        window.dispatchEvent(messageFrom({}, SOURCE_ORIGIN, payload));

        expect(localStorage.getItem('puzzle-cut-style')).toBeNull();
        expect(opener.postMessage).toHaveBeenCalledTimes(1);
    });

    it('reports a failure and offers to continue', async () => {
        const { opener, container, navigate, done } = setUp();

        window.dispatchEvent(messageFrom(opener, SOURCE_ORIGIN, encodeMoveMessage({
            kind: 'payload',
            entries: 'garbage',
        })));

        await expect(done).resolves.toBe('failed');
        expect(opener.postMessage).toHaveBeenLastCalledWith(
            encodeMoveMessage({ kind: 'failed', reason: 'invalid-payload' }),
            SOURCE_ORIGIN,
        );
        expect(navigate).not.toHaveBeenCalled();
        container.querySelector<HTMLButtonElement>('.move-btn--primary')!.click();
        expect(navigate).toHaveBeenCalledWith('/puzzle/');
    });

    it('times out with a message when nothing arrives', async () => {
        vi.useFakeTimers();
        const { container, done } = setUp(1000);
        vi.advanceTimersByTime(1000);
        await expect(done).resolves.toBe('timeout');
        expect(container.querySelector('.move-body')?.textContent).toMatch(/Nothing arrived/);
    });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-receiver.test.ts`
Expected: FAIL — cannot resolve `./move-receiver.js`.

- [ ] **Step 9: Implement `src/move/move-receiver.ts`**

```ts
import { diagnostics } from '../diagnostics.js';
import { loadSavedGame, STORAGE_KEY, PROGRESS_KEY } from '../persistence/index.js';
import { GEOMETRY_SEED_KEY } from '../persistence/storage.js';
import { createReceiveMoveScreen } from '../ui/receive-move-screen.js';
import { moveSourceOrigin, RECEIVE_MOVE_PARAM } from './move-config.js';
import { MOVED_KEYS } from './move-keys.js';
import {
    encodeMoveMessage,
    readMoveMessage,
    MOVE_FAILURE_TEXT,
    type MoveFailureReason,
} from './move-protocol.js';

export const PAYLOAD_TIMEOUT_MS = 30_000;

export const REPLACE_PROMPT =
    'This site already has a puzzle in progress. Replace it with the one you’re bringing?';

export type ApplyResult =
    | { status: 'done' }
    | { status: 'declined' }
    | { status: 'failed'; reason: MoveFailureReason };

export interface MoveReceiverDeps {
    container: HTMLElement;
    win?: Window;
    confirm?: (message: string) => boolean;
    navigate?: (url: string) => void;
    timeoutMs?: number;
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && Object.values(value).every((entry) => typeof entry === 'string');
}

function writeAll(writes: ReadonlyMap<string, string | null>): void {
    for (const [key, value] of writes) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }
}

function restore(snapshot: ReadonlyMap<string, string | null>): void {
    for (const [key, value] of snapshot) {
        try {
            writeAll(new Map([[key, value]]));
        } catch (error) {
            diagnostics.warn(`Could not restore "${key}" after a failed move:`, error);
        }
    }
}

export function applyMoveEntries(
    entries: unknown,
    confirm: (message: string) => boolean,
): ApplyResult {
    if (!isStringRecord(entries)) return { status: 'failed', reason: 'invalid-payload' };

    const bringsSave = Object.hasOwn(entries, STORAGE_KEY);
    if (bringsSave && localStorage.getItem(STORAGE_KEY) !== null && !confirm(REPLACE_PROMPT)) {
        return { status: 'declined' };
    }

    const writes = new Map<string, string | null>();
    for (const key of MOVED_KEYS) {
        if (key === STORAGE_KEY || key === PROGRESS_KEY) continue;
        if (Object.hasOwn(entries, key)) writes.set(key, entries[key]);
    }
    if (bringsSave) {
        writes.set(STORAGE_KEY, entries[STORAGE_KEY]);
        writes.set(PROGRESS_KEY, Object.hasOwn(entries, PROGRESS_KEY) ? entries[PROGRESS_KEY] : null);
        writes.set(GEOMETRY_SEED_KEY, null);
    }

    const snapshot = new Map<string, string | null>(
        [...writes.keys()].map((key) => [key, localStorage.getItem(key)]),
    );
    try {
        writeAll(writes);
    } catch (error) {
        diagnostics.warn('Writing the moved puzzle failed; restoring the previous data:', error);
        restore(snapshot);
        return { status: 'failed', reason: 'write-failed' };
    }

    if (bringsSave && loadSavedGame().status !== 'ok') {
        restore(snapshot);
        return { status: 'failed', reason: 'unloadable-save' };
    }
    return { status: 'done' };
}

export function isReceiveMode(win: Window = window): boolean {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(RECEIVE_MOVE_PARAM)) return false;
    if (win.opener && url.origin !== moveSourceOrigin()) return true;
    url.searchParams.delete(RECEIVE_MOVE_PARAM);
    win.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return false;
}

export function runMoveReceiver(deps: MoveReceiverDeps): Promise<ApplyResult['status'] | 'timeout'> {
    const { container, win = window, timeoutMs = PAYLOAD_TIMEOUT_MS } = deps;
    const confirm = deps.confirm ?? ((message: string) => win.confirm(message));
    const navigate = deps.navigate ?? ((url: string) => win.location.replace(url));
    const sourceOrigin = moveSourceOrigin();
    const opener = win.opener as Window;
    const screen = createReceiveMoveScreen(container);
    const continueToApp = (): void => navigate(win.location.pathname);

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            win.removeEventListener('message', onMessage);
            screen.showMessage(
                'Nothing arrived from the old site. Go back to it and try again — your puzzle is still there.',
                continueToApp,
            );
            resolve('timeout');
        }, timeoutMs);

        function onMessage(event: MessageEvent): void {
            if (event.origin !== sourceOrigin || event.source !== opener) return;
            const message = readMoveMessage(event.data);
            if (message?.kind !== 'payload') return;
            clearTimeout(timer);
            win.removeEventListener('message', onMessage);

            const result = applyMoveEntries(message.entries, confirm);
            opener.postMessage(
                encodeMoveMessage(
                    result.status === 'failed'
                        ? { kind: 'failed', reason: result.reason }
                        : { kind: result.status },
                ),
                sourceOrigin,
            );
            if (result.status === 'failed') {
                screen.showMessage(
                    `Couldn’t bring your puzzle over — ${MOVE_FAILURE_TEXT[result.reason]}. It’s still safe on the old site.`,
                    continueToApp,
                );
            } else {
                continueToApp();
            }
            resolve(result.status);
        }

        win.addEventListener('message', onMessage);
        opener.postMessage(encodeMoveMessage({ kind: 'ready' }), sourceOrigin);
    });
}
```

- [ ] **Step 10: Run the receiver tests**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/ src/ui/receive-move-screen.test.ts`
Expected: PASS. If "rolls back when the save does not load" fails because `loadSavedGame` returns `ok` for `'{not json'`, inspect `decompressFromStorage` — do not weaken the assertion.

- [ ] **Step 11: Lint and typecheck**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 12: Commit**

```bash
git add src/move/move-receiver.ts src/move/move-receiver.test.ts src/ui/receive-move-screen.ts src/ui/receive-move-screen.test.ts src/style.css
git commit -F - <<'EOF'
feat(move): receive a moved puzzle on the new site

Opened as ?receive-move by the old site, the new site announces itself,
accepts one payload from the trusted origin, asks before replacing a
puzzle in progress, and writes with rollback so a save that would not
load leaves nothing behind. A pinned save blob keeps saves from the
frozen legacy build loadable as the format evolves.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Sender (old site)

**Files:**
- Create: `src/move/move-sender.ts`
- Test: `src/move/move-sender.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MOVED_TO_KEY`, `markMoved`, `receiveMoveUrl`, `encodeMoveMessage`, `readMoveMessage`, `MoveFailureReason`).
- Produces:
  - `type MoveOutcome = { status: 'done' } | { status: 'declined' } | { status: 'failed'; reason: MoveFailureReason } | { status: 'popup-blocked' } | { status: 'timeout' } | { status: 'canceled' }`
  - `READY_TIMEOUT_MS = 30_000`
  - `collectMoveEntries(storage: Storage): Record<string, string>`
  - `runMoveHandoff(deps: MoveHandoffDeps): Promise<MoveOutcome>` with `MoveHandoffDeps = { targetUrl: string; open?: (url: string) => Window | null; win?: Window; storage?: Storage; timeoutMs?: number; signal?: AbortSignal }`

- [ ] **Step 1: Write the failing test**

`src/move/move-sender.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { collectMoveEntries, runMoveHandoff } from './move-sender.js';
import { encodeMoveMessage } from './move-protocol.js';
import { MOVED_TO_KEY } from './move-config.js';

const TARGET_URL = 'https://puzzlewise.github.io/';
const TARGET_ORIGIN = 'https://puzzlewise.github.io';

function messageFrom(source: unknown, origin: string, data: unknown): MessageEvent {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

function start(options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    const popup = { postMessage: vi.fn() };
    const open = vi.fn(() => popup as unknown as Window);
    const result = runMoveHandoff({ targetUrl: TARGET_URL, open, ...options });
    const send = (data: unknown, origin = TARGET_ORIGIN, source: unknown = popup): void => {
        window.dispatchEvent(messageFrom(source, origin, data));
    };
    return { popup, open, result, send };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
});

describe('collectMoveEntries', () => {
    it('collects puzzle-* keys except the moved marker', () => {
        localStorage.setItem('puzzle-cut-style', 'wavy');
        localStorage.setItem('puzzle-game-state', 'g');
        localStorage.setItem(MOVED_TO_KEY, TARGET_URL);
        localStorage.setItem('other', 'x');

        expect(collectMoveEntries(localStorage)).toEqual({
            'puzzle-cut-style': 'wavy',
            'puzzle-game-state': 'g',
        });
    });
});

describe('runMoveHandoff', () => {
    it('opens the receive URL', () => {
        const { open } = start();
        expect(open).toHaveBeenCalledWith('https://puzzlewise.github.io/?receive-move');
    });

    it('reports a blocked popup', async () => {
        await expect(runMoveHandoff({ targetUrl: TARGET_URL, open: () => null }))
            .resolves.toEqual({ status: 'popup-blocked' });
    });

    it('sends the entries to the target origin on ready, then records done', async () => {
        localStorage.setItem('puzzle-cut-style', 'wavy');
        const { popup, result, send } = start();

        send(encodeMoveMessage({ kind: 'ready' }));
        expect(popup.postMessage).toHaveBeenCalledWith(
            encodeMoveMessage({ kind: 'payload', entries: { 'puzzle-cut-style': 'wavy' } }),
            TARGET_ORIGIN,
        );

        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'done' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBe(TARGET_URL);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('wavy');
    });

    it('ignores messages from another origin or window', () => {
        const { popup, send } = start();
        send(encodeMoveMessage({ kind: 'ready' }), 'https://evil.example');
        send(encodeMoveMessage({ kind: 'ready' }), TARGET_ORIGIN, {});
        expect(popup.postMessage).not.toHaveBeenCalled();
    });

    it('ignores a result that arrives before ready', async () => {
        const { result, send } = start();
        send(encodeMoveMessage({ kind: 'done' }));
        send(encodeMoveMessage({ kind: 'ready' }));
        send(encodeMoveMessage({ kind: 'declined' }));
        await expect(result).resolves.toEqual({ status: 'declined' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });

    it('relays a failure reason without recording the move', async () => {
        const { result, send } = start();
        send(encodeMoveMessage({ kind: 'ready' }));
        send(encodeMoveMessage({ kind: 'failed', reason: 'write-failed' }));
        await expect(result).resolves.toEqual({ status: 'failed', reason: 'write-failed' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });

    it('times out when ready never arrives', async () => {
        vi.useFakeTimers();
        const { result } = start({ timeoutMs: 1000 });
        vi.advanceTimersByTime(1000);
        await expect(result).resolves.toEqual({ status: 'timeout' });
    });

    it('stops waiting for the ready timeout once ready arrives', async () => {
        vi.useFakeTimers();
        const { result, send } = start({ timeoutMs: 1000 });
        send(encodeMoveMessage({ kind: 'ready' }));
        vi.advanceTimersByTime(5000);
        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'done' });
    });

    it('resolves canceled on abort and ignores a later done', async () => {
        const controller = new AbortController();
        const { result, send } = start({ signal: controller.signal });
        send(encodeMoveMessage({ kind: 'ready' }));
        controller.abort();
        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'canceled' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-sender.test.ts`
Expected: FAIL — cannot resolve `./move-sender.js`.

- [ ] **Step 3: Implement `src/move/move-sender.ts`**

```ts
import { markMoved, MOVED_TO_KEY, receiveMoveUrl } from './move-config.js';
import { encodeMoveMessage, readMoveMessage, type MoveFailureReason } from './move-protocol.js';

export const READY_TIMEOUT_MS = 30_000;

export type MoveOutcome =
    | { status: 'done' }
    | { status: 'declined' }
    | { status: 'failed'; reason: MoveFailureReason }
    | { status: 'popup-blocked' }
    | { status: 'timeout' }
    | { status: 'canceled' };

export interface MoveHandoffDeps {
    targetUrl: string;
    open?: (url: string) => Window | null;
    win?: Window;
    storage?: Storage;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export function collectMoveEntries(storage: Storage): Record<string, string> {
    const entries: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null || !key.startsWith('puzzle-') || key === MOVED_TO_KEY) continue;
        const value = storage.getItem(key);
        if (value !== null) entries[key] = value;
    }
    return entries;
}

export function runMoveHandoff(deps: MoveHandoffDeps): Promise<MoveOutcome> {
    const {
        targetUrl,
        win = window,
        storage = localStorage,
        timeoutMs = READY_TIMEOUT_MS,
        signal,
    } = deps;
    const open = deps.open ?? ((url: string) => win.open(url, '_blank'));
    const targetOrigin = new URL(targetUrl).origin;

    const popup = open(receiveMoveUrl(targetUrl));
    if (popup === null) return Promise.resolve({ status: 'popup-blocked' });

    return new Promise((resolve) => {
        let sent = false;
        const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);

        function finish(outcome: MoveOutcome): void {
            clearTimeout(timer);
            win.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
            resolve(outcome);
        }

        function onAbort(): void {
            finish({ status: 'canceled' });
        }

        function onMessage(event: MessageEvent): void {
            if (event.origin !== targetOrigin || event.source !== popup) return;
            const message = readMoveMessage(event.data);
            if (message === undefined) return;
            if (message.kind === 'ready') {
                if (sent) return;
                sent = true;
                clearTimeout(timer);
                popup!.postMessage(
                    encodeMoveMessage({ kind: 'payload', entries: collectMoveEntries(storage) }),
                    targetOrigin,
                );
                return;
            }
            if (!sent) return;
            switch (message.kind) {
                case 'done':
                    markMoved(targetUrl);
                    finish({ status: 'done' });
                    return;
                case 'declined':
                    finish({ status: 'declined' });
                    return;
                case 'failed':
                    finish({ status: 'failed', reason: message.reason });
                    return;
                case 'payload':
                    return;
            }
        }

        win.addEventListener('message', onMessage);
        signal?.addEventListener('abort', onAbort);
    });
}
```

Note: `markMoved` writes to `localStorage`, while `collectMoveEntries` reads the injected `storage`. Both default to `localStorage`; the tests use the default.

- [ ] **Step 4: Run it to verify it passes, then lint**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-sender.test.ts && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint`
Expected: PASS, lint clean. If oxlint flags the non-null assertion `popup!`, replace it by capturing `const target = popup;` after the null check and using `target` inside the closure.

- [ ] **Step 5: Commit**

```bash
git add src/move/move-sender.ts src/move/move-sender.test.ts
git commit -F - <<'EOF'
feat(move): hand the puzzle over from the old site

Opens the new site as a popup, sends every puzzle-* entry once it
announces itself, and records the move only when the new site confirms
the write.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Analytics events, move dialog and banner

**Files:**
- Modify: `src/analytics/umami.ts` (types + `track` overloads, next to `ShareLinkRescueResultData` and the overload list ending at `offline-images-saved`)
- Modify: `src/analytics/index.ts` (export the new types)
- Modify: `src/analytics/umami.test.ts`
- Create: `src/ui/move-dialog.ts`
- Create: `src/ui/move-banner.ts`
- Modify: `src/style.css` (banner styles)
- Test: `src/ui/move-dialog.test.ts`
- Test: `src/ui/move-banner.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MoveFailureReason`, `MOVE_FAILURE_TEXT`), Task 3 (`moveButton`, `.move-*` CSS), Task 4 (`MoveOutcome`).
- Produces:
  - `type MoveTrigger = 'banner' | 'new-game'`
  - `MoveDialogShownData { trigger: MoveTrigger; variant: 'handoff' | 'ios-standalone' }`, `MoveStartedData { trigger: MoveTrigger }`, `MoveResultData { outcome: 'done' | 'declined' | 'failed' | 'popup-blocked' | 'timeout'; reason?: MoveFailureReason }`
  - `track('move-dialog-shown' | 'move-started' | 'move-result', …)`
  - `createMoveDialog(options: MoveDialogOptions): () => void` with `MoveDialogOptions = { container: HTMLElement; variant: 'handoff' | 'ios-standalone'; targetHost: string; move: (signal: AbortSignal) => Promise<MoveOutcome>; onStartHere?: () => void; onOutcome?: (outcome: MoveOutcome) => void }`
  - `createMoveBanner(options: { container: HTMLElement; text: string; onOpen: () => void }): () => void`

- [ ] **Step 1: Write the failing analytics test**

Append to the `describe` that holds the `share-link-rescue-attempted` test in `src/analytics/umami.test.ts` (reuse its `umamiTrack` setup):

```ts
    it('forwards move events with their typed payloads', () => {
        track('move-dialog-shown', { trigger: 'banner', variant: 'handoff' });
        track('move-started', { trigger: 'new-game' });
        track('move-result', { outcome: 'failed', reason: 'unloadable-save' });

        expect(umamiTrack).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'banner', variant: 'handoff' });
        expect(umamiTrack).toHaveBeenCalledWith('move-started', { trigger: 'new-game' });
        expect(umamiTrack).toHaveBeenCalledWith('move-result', { outcome: 'failed', reason: 'unloadable-save' });
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx tsc --noEmit`
Expected: FAIL — no `track` overload matches `'move-dialog-shown'`.

- [ ] **Step 3: Add the event types and overloads to `src/analytics/umami.ts`**

Add near the top-level imports:

```ts
import type { MoveFailureReason } from '../move/move-protocol.js';
```

Add after `ShareLinkRescueResultData`:

```ts
export type MoveTrigger = 'banner' | 'new-game';

/**
 * Move events come only from a build with `VITE_MOVED_TO` set — the legacy
 * adrianschmidt.github.io deploy steering players to puzzlewise.github.io.
 * `ios-standalone` is an installed iOS home-screen app: it is shown
 * instructions instead of the handoff and never sends `move-started`.
 */
export interface MoveDialogShownData {
    trigger: MoveTrigger;
    variant: 'handoff' | 'ios-standalone';
}

export interface MoveStartedData {
    trigger: MoveTrigger;
}

/**
 * `done` means the new site confirmed it wrote the data. Closing the dialog
 * mid-handoff sends no result, so `move-started` minus `move-result` counts
 * abandoned attempts. `reason` is present only with `failed`.
 */
export interface MoveResultData {
    outcome: 'done' | 'declined' | 'failed' | 'popup-blocked' | 'timeout';
    reason?: MoveFailureReason;
}
```

Add after the `offline-images-saved` overload:

```ts
export function track(name: 'move-dialog-shown', data: MoveDialogShownData): void;
export function track(name: 'move-started', data: MoveStartedData): void;
export function track(name: 'move-result', data: MoveResultData): void;
```

In `src/analytics/index.ts`, add `MoveTrigger`, `MoveDialogShownData`, `MoveStartedData`, `MoveResultData` to the `export type { … } from './umami.js'` list.

- [ ] **Step 4: Run analytics test and typecheck**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx tsc --noEmit && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/analytics/umami.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing dialog and banner tests**

`src/ui/move-dialog.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMoveDialog, type MoveDialogOptions } from './move-dialog.js';
import type { MoveOutcome } from '../move/move-sender.js';

function mount(overrides: Partial<MoveDialogOptions> = {}) {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const options: MoveDialogOptions = {
        container,
        variant: 'handoff',
        targetHost: 'puzzlewise.github.io',
        move: vi.fn(async (): Promise<MoveOutcome> => ({ status: 'done' })),
        ...overrides,
    };
    const close = createMoveDialog(options);
    const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('.move-btn')];
    const button = (label: string) => buttons().find((b) => b.textContent === label)!;
    const status = () => container.querySelector('.move-status')?.textContent;
    return { container, options, close, buttons, button, status };
}

describe('createMoveDialog', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('offers Move and Not now when opened from the banner', () => {
        const { buttons } = mount();
        expect(buttons().map((b) => b.textContent)).toEqual(['Not now', 'Move to the new site']);
    });

    it('offers starting here instead of Not now when opened from New puzzle', () => {
        const onStartHere = vi.fn();
        const { buttons, button, container } = mount({ onStartHere });
        expect(buttons().map((b) => b.textContent))
            .toEqual(['Start a new puzzle here anyway', 'Move to the new site']);
        button('Start a new puzzle here anyway').click();
        expect(onStartHere).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.move-dialog')).toBeNull();
    });

    it('names the new host', () => {
        const { container } = mount();
        expect(container.querySelector('.move-body')?.textContent).toContain('puzzlewise.github.io');
    });

    it('shows success and reports the outcome', async () => {
        const onOutcome = vi.fn();
        const { button, status, buttons } = mount({ onOutcome });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toBe('Done — your puzzle is open in the new tab.'));
        expect(onOutcome).toHaveBeenCalledWith({ status: 'done' });
        expect(buttons().map((b) => b.textContent)).toEqual(['Close']);
    });

    it.each([
        [{ status: 'popup-blocked' } as MoveOutcome, 'Your browser blocked the new window — allow pop-ups and try again.'],
        [{ status: 'timeout' } as MoveOutcome, 'Couldn’t reach the new site.'],
        [{ status: 'failed', reason: 'write-failed' } as MoveOutcome,
            'The move didn’t work — the new site couldn’t store it. Your puzzle is still here.'],
    ])('explains %o and offers a retry', async (outcome, message) => {
        const { button, status } = mount({ move: async () => outcome });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(status()).toBe(message));
        expect(button('Try again').disabled).toBe(false);
    });

    it('closes when the new site declines', async () => {
        const { button, container } = mount({ move: async () => ({ status: 'declined' }) });
        button('Move to the new site').click();
        await vi.waitFor(() => expect(container.querySelector('.move-dialog')).toBeNull());
    });

    it('aborts an in-flight handoff when closed', () => {
        let signal: AbortSignal | undefined;
        const { button, close } = mount({
            move: (s) => {
                signal = s;
                return new Promise<MoveOutcome>(() => {});
            },
        });
        button('Move to the new site').click();
        expect(button('Moving…').disabled).toBe(true);
        close();
        expect(signal?.aborted).toBe(true);
    });

    it('aborts an in-flight handoff on Escape', () => {
        let signal: AbortSignal | undefined;
        const { button } = mount({
            move: (s) => {
                signal = s;
                return new Promise<MoveOutcome>(() => {});
            },
        });
        button('Move to the new site').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(signal?.aborted).toBe(true);
    });

    it('shows instructions without a move button on an installed iOS app', () => {
        const move = vi.fn();
        const { buttons, container } = mount({ variant: 'ios-standalone', move, onStartHere: vi.fn() });
        expect(buttons().map((b) => b.textContent)).toEqual(['Start a new puzzle here anyway', 'Close']);
        expect(container.querySelector('.move-body')?.textContent).toMatch(/Safari.*Home Screen/);
        expect(move).not.toHaveBeenCalled();
    });
});
```

`src/ui/move-banner.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { createMoveBanner } from './move-banner.js';

describe('createMoveBanner', () => {
    it('opens on tap and dismisses on ×', () => {
        const container = document.createElement('div');
        const onOpen = vi.fn();
        createMoveBanner({ container, text: 'Puzzle has moved', onOpen });

        const open = container.querySelector<HTMLButtonElement>('.move-banner-open')!;
        expect(open.textContent).toBe('Puzzle has moved');
        open.click();
        expect(onOpen).toHaveBeenCalledTimes(1);

        container.querySelector<HTMLButtonElement>('.move-banner-close')!.click();
        expect(container.querySelector('.move-banner')).toBeNull();
    });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/move-dialog.test.ts src/ui/move-banner.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement `src/ui/move-banner.ts`**

```ts
export interface MoveBannerOptions {
    container: HTMLElement;
    text: string;
    onOpen: () => void;
}

export function createMoveBanner(options: MoveBannerOptions): () => void {
    const { container, text, onOpen } = options;

    const banner = document.createElement('div');
    banner.className = 'move-banner';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'move-banner-open';
    open.textContent = text;
    open.addEventListener('click', onOpen);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'move-banner-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => banner.remove());

    banner.append(open, close);
    container.appendChild(banner);
    return () => banner.remove();
}
```

- [ ] **Step 8: Implement `src/ui/move-dialog.ts`**

```ts
import { MOVE_FAILURE_TEXT } from '../move/move-protocol.js';
import type { MoveOutcome } from '../move/move-sender.js';
import { createDismissableOverlay } from './dismissable-overlay.js';
import { moveButton } from './receive-move-screen.js';

export type MoveDialogVariant = 'handoff' | 'ios-standalone';

export interface MoveDialogOptions {
    container: HTMLElement;
    variant: MoveDialogVariant;
    targetHost: string;
    move: (signal: AbortSignal) => Promise<MoveOutcome>;
    onStartHere?: () => void;
    onOutcome?: (outcome: MoveOutcome) => void;
}

type RetryableOutcome = Extract<MoveOutcome, { status: 'failed' | 'popup-blocked' | 'timeout' }>;

function retryMessage(outcome: RetryableOutcome): string {
    switch (outcome.status) {
        case 'failed':
            return `The move didn’t work — ${MOVE_FAILURE_TEXT[outcome.reason]}. Your puzzle is still here.`;
        case 'popup-blocked':
            return 'Your browser blocked the new window — allow pop-ups and try again.';
        case 'timeout':
            return 'Couldn’t reach the new site.';
    }
}

export function createMoveDialog(options: MoveDialogOptions): () => void {
    const { container, variant, targetHost, move, onStartHere, onOutcome } = options;
    const controller = new AbortController();
    const { overlay, dismiss } = createDismissableOverlay({
        container,
        className: 'move-overlay',
        onDismiss: () => controller.abort(),
    });

    function close(): void {
        controller.abort();
        dismiss();
    }

    const dialog = document.createElement('div');
    dialog.className = 'move-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Puzzle has moved');

    const title = document.createElement('h2');
    title.className = 'move-title';
    title.textContent = 'Puzzle has moved';

    const body = document.createElement('p');
    body.className = 'move-body';
    body.textContent = variant === 'handoff'
        ? `Puzzle now lives at ${targetHost}. Bring your puzzle and settings along — ` +
          'it opens in a new tab, right where you left off. Everything here stays as it is.'
        : `Puzzle now lives at ${targetHost}. To keep getting updates, open ${targetHost} ` +
          'in Safari and add it to your Home Screen. Your current puzzle stays here.';

    const status = document.createElement('p');
    status.className = 'move-status';
    status.setAttribute('role', 'status');

    const buttons = document.createElement('div');
    buttons.className = 'move-buttons';

    if (onStartHere) {
        const startHere = moveButton('Start a new puzzle here anyway');
        startHere.addEventListener('click', () => {
            close();
            onStartHere();
        });
        buttons.appendChild(startHere);
    }

    if (variant === 'ios-standalone') {
        const closeButton = moveButton('Close', onStartHere === undefined);
        closeButton.addEventListener('click', close);
        buttons.appendChild(closeButton);
    } else {
        if (!onStartHere) {
            const notNow = moveButton('Not now');
            notNow.addEventListener('click', close);
            buttons.appendChild(notNow);
        }

        const moveNow = moveButton('Move to the new site', true);
        const runMove = async (): Promise<void> => {
            moveNow.disabled = true;
            moveNow.textContent = 'Moving…';
            status.textContent = '';
            const outcome = await move(controller.signal);
            onOutcome?.(outcome);
            switch (outcome.status) {
                case 'canceled':
                    return;
                case 'declined':
                    close();
                    return;
                case 'done': {
                    status.textContent = 'Done — your puzzle is open in the new tab.';
                    const closeButton = moveButton('Close', true);
                    closeButton.addEventListener('click', close);
                    buttons.replaceChildren(closeButton);
                    return;
                }
                default:
                    status.textContent = retryMessage(outcome);
                    moveNow.disabled = false;
                    moveNow.textContent = 'Try again';
            }
        };
        moveNow.addEventListener('click', () => {
            void runMove();
        });
        buttons.appendChild(moveNow);
    }

    dialog.append(title, body, status, buttons);
    overlay.appendChild(dialog);
    return close;
}
```

- [ ] **Step 9: Add banner CSS to `src/style.css`**

Append after the `.move-status:empty` rule from Task 3:

```css
.move-banner {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  max-width: calc(100% - 32px);
  background: var(--ui-toast-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  z-index: 10002;
  animation: app-toast-in 180ms ease-out;
}

.move-banner-open,
.move-banner-close {
  background: none;
  border: none;
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 12px 16px;
}

.move-banner-close {
  padding: 12px 14px 12px 4px;
  font-size: 18px;
  line-height: 1;
  opacity: 0.7;
}
```

- [ ] **Step 10: Run tests, lint, typecheck**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/move-dialog.test.ts src/ui/move-banner.test.ts src/style.test.ts src/analytics/ && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx tsc --noEmit`
Expected: all PASS / clean.

- [ ] **Step 11: Commit**

```bash
git add src/analytics/umami.ts src/analytics/index.ts src/analytics/umami.test.ts src/ui/move-dialog.ts src/ui/move-dialog.test.ts src/ui/move-banner.ts src/ui/move-banner.test.ts src/style.css
git commit -F - <<'EOF'
feat(move): add the move dialog, banner, and move analytics events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Source wiring (old site behavior)

**Files:**
- Create: `src/move/move-source.ts`
- Test: `src/move/move-source.test.ts`

**Interfaces:**
- Consumes: Task 1 (`hasMoved`, `isIosStandalone`), Task 4 (`runMoveHandoff`, `MoveOutcome`), Task 5 (`createMoveDialog`, `createMoveBanner`, `track` events, `MoveTrigger`).
- Produces:
  - `redirectShareLink(targetUrl: string, location?: Pick<Location, 'hash' | 'replace'>): boolean`
  - `createMoveSource(deps: MoveSourceDeps): MoveSource` with `MoveSourceDeps = { container: HTMLElement; targetUrl: string; flushSave: () => void; location?: Pick<Location, 'assign'>; nav?: Navigator; handoff?: (signal: AbortSignal) => Promise<MoveOutcome> }` and `MoveSource = { onNewGame(openNewGame: () => void): void; showBanner(): void }`

- [ ] **Step 1: Write the failing test**

`src/move/move-source.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../analytics/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../analytics/index.js')>();
    return { ...actual, track: vi.fn() };
});

import { track } from '../analytics/index.js';
import { createMoveSource, redirectShareLink, type MoveSourceDeps } from './move-source.js';
import { MOVED_TO_KEY } from './move-config.js';
import type { MoveOutcome } from './move-sender.js';

const TARGET_URL = 'https://puzzlewise.github.io/';

function setUp(overrides: Pick<Partial<MoveSourceDeps>, 'handoff' | 'nav'> = {}) {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const flushSave = vi.fn();
    const location = { assign: vi.fn() };
    const handoff = vi.fn(overrides.handoff ?? (async (): Promise<MoveOutcome> => ({ status: 'done' })));
    const source = createMoveSource({
        container,
        targetUrl: TARGET_URL,
        flushSave,
        location,
        nav: overrides.nav ?? ({} as Navigator),
        handoff,
    });
    const button = (label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
    return { container, source, button, flushSave, location, handoff };
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
});

describe('redirectShareLink', () => {
    it('sends a #p= link to the new site with its hash', () => {
        const location = { hash: '#p=abc', replace: vi.fn() };
        expect(redirectShareLink(TARGET_URL, location)).toBe(true);
        expect(location.replace).toHaveBeenCalledWith('https://puzzlewise.github.io/#p=abc');
    });

    it('leaves other pages alone', () => {
        const location = { hash: '#other', replace: vi.fn() };
        expect(redirectShareLink(TARGET_URL, location)).toBe(false);
        expect(location.replace).not.toHaveBeenCalled();
    });
});

describe('createMoveSource', () => {
    it('shows the move dialog instead of the new-game dialog', () => {
        const openNewGame = vi.fn();
        const { source, button } = setUp();
        source.onNewGame(openNewGame);

        expect(openNewGame).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'new-game', variant: 'handoff' });
        button('Start a new puzzle here anyway')!.click();
        expect(openNewGame).toHaveBeenCalledTimes(1);
    });

    it('flushes the pending save before handing off, and tracks the result', async () => {
        const { source, button, flushSave, handoff } = setUp();
        source.onNewGame(vi.fn());
        button('Move to the new site')!.click();

        expect(flushSave).toHaveBeenCalled();
        expect(flushSave.mock.invocationCallOrder[0])
            .toBeLessThan(handoff.mock.invocationCallOrder[0]);
        expect(track).toHaveBeenCalledWith('move-started', { trigger: 'new-game' });
        await vi.waitFor(() => expect(track).toHaveBeenCalledWith('move-result', { outcome: 'done' }));
    });

    it('tracks a failure reason', async () => {
        const { source, button } = setUp({
            handoff: async () => ({ status: 'failed', reason: 'write-failed' }),
        });
        source.showBanner();
        button('Puzzle has moved — bring your puzzle along')!.click();
        button('Move to the new site')!.click();
        await vi.waitFor(() =>
            expect(track).toHaveBeenCalledWith('move-result', { outcome: 'failed', reason: 'write-failed' }));
    });

    it('sends no result when the dialog is closed mid-handoff', async () => {
        const { source, button } = setUp({
            handoff: (signal) => new Promise<MoveOutcome>((resolve) => {
                signal.addEventListener('abort', () => resolve({ status: 'canceled' }));
            }),
        });
        source.onNewGame(vi.fn());
        button('Move to the new site')!.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(vi.mocked(track).mock.calls.map(([name]) => name)).not.toContain('move-result');
    });

    it('shows the banner and opens the dialog from it', () => {
        const { source, button, container } = setUp();
        source.showBanner();
        button('Puzzle has moved — bring your puzzle along')!.click();
        expect(container.querySelector('.move-dialog')).not.toBeNull();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'banner', variant: 'handoff' });
    });

    it('after a move, New puzzle and the banner go straight to the new site', () => {
        localStorage.setItem(MOVED_TO_KEY, TARGET_URL);
        const openNewGame = vi.fn();
        const { source, button, location } = setUp();

        source.onNewGame(openNewGame);
        expect(location.assign).toHaveBeenCalledWith(TARGET_URL);
        expect(openNewGame).not.toHaveBeenCalled();

        source.showBanner();
        button('Your puzzle is now at puzzlewise.github.io')!.click();
        expect(location.assign).toHaveBeenCalledTimes(2);
    });

    it('on an installed iOS app, shows no banner and the instructions variant', () => {
        const { source, container, button } = setUp({ nav: { standalone: true } as unknown as Navigator });
        source.showBanner();
        expect(container.querySelector('.move-banner')).toBeNull();

        source.onNewGame(vi.fn());
        expect(button('Move to the new site')).toBeUndefined();
        expect(track).toHaveBeenCalledWith('move-dialog-shown', { trigger: 'new-game', variant: 'ios-standalone' });
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/move-source.test.ts`
Expected: FAIL — cannot resolve `./move-source.js`.

- [ ] **Step 3: Implement `src/move/move-source.ts`**

```ts
import { track, type MoveTrigger } from '../analytics/index.js';
import { createMoveBanner } from '../ui/move-banner.js';
import { createMoveDialog } from '../ui/move-dialog.js';
import { hasMoved, isIosStandalone } from './move-config.js';
import { runMoveHandoff, type MoveOutcome } from './move-sender.js';

export interface MoveSourceDeps {
    container: HTMLElement;
    targetUrl: string;
    flushSave: () => void;
    location?: Pick<Location, 'assign'>;
    nav?: Navigator;
    handoff?: (signal: AbortSignal) => Promise<MoveOutcome>;
}

export interface MoveSource {
    onNewGame(openNewGame: () => void): void;
    showBanner(): void;
}

export function redirectShareLink(
    targetUrl: string,
    location: Pick<Location, 'hash' | 'replace'> = window.location,
): boolean {
    if (!location.hash.startsWith('#p=')) return false;
    location.replace(targetUrl + location.hash);
    return true;
}

function trackOutcome(outcome: MoveOutcome): void {
    if (outcome.status === 'canceled') return;
    track(
        'move-result',
        outcome.status === 'failed'
            ? { outcome: 'failed', reason: outcome.reason }
            : { outcome: outcome.status },
    );
}

export function createMoveSource(deps: MoveSourceDeps): MoveSource {
    const { container, targetUrl, flushSave, location = window.location, nav = navigator } = deps;
    const handoff = deps.handoff ?? ((signal: AbortSignal) => runMoveHandoff({ targetUrl, signal }));
    const targetHost = new URL(targetUrl).host;
    const iosStandalone = isIosStandalone(nav);

    function openDialog(trigger: MoveTrigger, onStartHere?: () => void): void {
        const variant = iosStandalone ? 'ios-standalone' : 'handoff';
        track('move-dialog-shown', { trigger, variant });
        createMoveDialog({
            container,
            variant,
            targetHost,
            onStartHere,
            move: (signal) => {
                track('move-started', { trigger });
                flushSave();
                return handoff(signal);
            },
            onOutcome: trackOutcome,
        });
    }

    return {
        onNewGame(openNewGame) {
            if (hasMoved()) {
                location.assign(targetUrl);
                return;
            }
            openDialog('new-game', openNewGame);
        },
        showBanner() {
            if (iosStandalone) return;
            if (hasMoved()) {
                createMoveBanner({
                    container,
                    text: `Your puzzle is now at ${targetHost}`,
                    onOpen: () => location.assign(targetUrl),
                });
                return;
            }
            createMoveBanner({
                container,
                text: 'Puzzle has moved — bring your puzzle along',
                onOpen: () => openDialog('banner'),
            });
        },
    };
}
```

- [ ] **Step 4: Run it to verify it passes, then lint**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/move/ && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/move/move-source.ts src/move/move-source.test.ts
git commit -F - <<'EOF'
feat(move): steer old-site players to the new site

Shows a banner at startup and the move dialog at New puzzle, redirects
incoming share links, and goes straight to the new site once the move
is done. Installed iOS apps get instructions instead of the handoff,
since their storage cannot reach the new site's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Share links point at the new site

**Files:**
- Modify: `src/ui/info-modal.ts:762-766`
- Modify: `src/ui/completion-overlay.ts:64`
- Modify: `src/ui/completion-overlay.test.ts`
- Modify: `src/sharing/share-link.test.ts`

**Interfaces:**
- Consumes: Task 1 (`shareBaseUrl`).

- [ ] **Step 1: Write the failing completion-overlay test**

In `src/ui/completion-overlay.test.ts`, add `vi.unstubAllEnvs();` to the existing `afterEach`, and add next to "share-button click invokes navigator.share…":

```ts
    it('builds the share URL on the new site when VITE_MOVED_TO is set', () => {
        vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
        const shareSpy = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share: shareSpy });

        showCompletionOverlay({ container, state: makeState() });
        container.querySelector<HTMLButtonElement>('.completion-share-btn')!.click();

        expect(shareSpy.mock.calls[0][0].url).toMatch(/^https:\/\/puzzlewise\.github\.io\/#p=/);
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/completion-overlay.test.ts`
Expected: FAIL — URL starts with the jsdom origin.

- [ ] **Step 3: Use `shareBaseUrl()` at both call sites**

`src/ui/completion-overlay.ts` — add `import { shareBaseUrl } from '../move/move-config.js';` and replace

```ts
        const url = buildShareUrl(window.location.href.split('#')[0], payload);
```
with
```ts
        const url = buildShareUrl(shareBaseUrl(), payload);
```

`src/ui/info-modal.ts` — add the same import and replace

```ts
    // Share section first so it's most prominent. Strip the hash so
    // attachShareSection gets the bare page URL, not a stale `#p=...`.
    if (options.state) {
        const baseUrl = window.location.href.split('#')[0];
        attachShareSection(content, options.state, baseUrl);
    }
```
with
```ts
    if (options.state) {
        attachShareSection(content, options.state, shareBaseUrl());
    }
```

(The deleted comment narrated what `shareBaseUrl` now owns.)

- [ ] **Step 4: Pin a share link from the current encoder**

Capture a link: create a throwaway `src/sharing/capture-link.test.ts`:

```ts
import { it } from 'vitest';
import { buildShareUrl, type SharePayload } from './share-link.js';

it('prints a link', () => {
    const payload: SharePayload = {
        v: 1, i: 'https://images.unsplash.com/photo-123?w=1080', is: [1080, 720],
        g: [8, 6], c: 'classic', s: 12345, r: 'none',
    };
    console.log(buildShareUrl('https://adrianschmidt.github.io/puzzle/', payload));
});
```

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/sharing/capture-link.test.ts --silent=false`, copy the printed hash (from `#p=` on), then `rm src/sharing/capture-link.test.ts`.

Append to `src/sharing/share-link.test.ts` (import `parseLocationHash` if not already imported):

```ts
describe('links from the frozen legacy build', () => {
    it('still decode', () => {
        const hash = '<paste #p=… from the capture>';
        expect(parseLocationHash(hash)).toEqual({
            v: 1, i: 'https://images.unsplash.com/photo-123?w=1080', is: [1080, 720],
            g: [8, 6], c: 'classic', s: 12345, r: 'none',
        });
    });
});
```

- [ ] **Step 5: Run the affected tests**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/ui/completion-overlay.test.ts src/ui/info-modal.test.ts src/sharing/ && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/completion-overlay.ts src/ui/completion-overlay.test.ts src/ui/info-modal.ts src/sharing/share-link.test.ts
git commit -F - <<'EOF'
feat(move): build share links on the new site when moved

A build with VITE_MOVED_TO now hands out links to the new site. A
pinned link keeps links from the frozen legacy build decodable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Bootstrap wiring

**Files:**
- Modify: `src/app/bootstrap.ts`
- Modify: `src/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 1 (`movedToUrl`), Task 3 (`isReceiveMode`, `runMoveReceiver`), Task 6 (`createMoveSource`, `redirectShareLink`).

- [ ] **Step 1: Write the failing wiring tests**

In `src/app/bootstrap.test.ts`, add module mocks next to the existing ones (before the imports):

```ts
vi.mock('../move/move-receiver.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../move/move-receiver.js')>();
    return { ...actual, runMoveReceiver: vi.fn(async () => 'done' as const) };
});

vi.mock('../move/move-source.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../move/move-source.js')>();
    return { ...actual, redirectShareLink: vi.fn(actual.redirectShareLink) };
});
```

and imports with the others:

```ts
import { runMoveReceiver } from '../move/move-receiver.js';
import { redirectShareLink } from '../move/move-source.js';
```

Then add inside `describe('bootstrap', …)`:

```ts
    describe('moving to the new site', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
            Reflect.deleteProperty(window, 'opener');
            history.replaceState(null, '', '/');
        });

        it('receives a moved puzzle instead of booting when opened by the old site', () => {
            history.replaceState(null, '', '/?receive-move');
            Object.defineProperty(window, 'opener', { value: {}, configurable: true });

            bootstrap(root);

            expect(runMoveReceiver).toHaveBeenCalledWith({ container: root });
            expect(createGameSession).not.toHaveBeenCalled();
            expect(runBootSequence).not.toHaveBeenCalled();
        });

        it('boots normally when ?receive-move has no opener', () => {
            history.replaceState(null, '', '/?receive-move');
            bootstrap(root);
            expect(runMoveReceiver).not.toHaveBeenCalled();
            expect(runBootSequence).toHaveBeenCalled();
            expect(location.search).toBe('');
        });

        it('shows no banner and opens the new-game dialog directly without VITE_MOVED_TO', () => {
            bootstrap(root);
            expect(root.querySelector('.move-banner')).toBeNull();
            vi.mocked(installToolbar).mock.calls[0][0].onNewGame();
            expect(openNewGameDialog).toHaveBeenCalledTimes(1);
        });

        it('with VITE_MOVED_TO, shows the banner and puts the move dialog in front of New puzzle', () => {
            vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
            bootstrap(root);

            expect(root.querySelector('.move-banner')).not.toBeNull();
            vi.mocked(installToolbar).mock.calls[0][0].onNewGame();
            expect(openNewGameDialog).not.toHaveBeenCalled();

            const startHere = [...root.querySelectorAll<HTMLButtonElement>('.move-btn')]
                .find((b) => b.textContent === 'Start a new puzzle here anyway')!;
            startHere.click();
            expect(openNewGameDialog).toHaveBeenCalledTimes(1);
        });

        it('with VITE_MOVED_TO, a share link redirects before anything boots', () => {
            vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
            vi.mocked(redirectShareLink).mockReturnValueOnce(true);

            bootstrap(root);

            expect(redirectShareLink).toHaveBeenCalledWith('https://puzzlewise.github.io/');
            expect(createGameSession).not.toHaveBeenCalled();
            expect(runBootSequence).not.toHaveBeenCalled();
        });

        it('with VITE_MOVED_TO, a pasted share link redirects instead of loading', () => {
            vi.stubEnv('VITE_MOVED_TO', 'https://puzzlewise.github.io/');
            bootstrap(root);
            vi.mocked(redirectShareLink).mockReturnValueOnce(true);

            window.dispatchEvent(new HashChangeEvent('hashchange'));

            expect(createdShareLinks().tryLoad).not.toHaveBeenCalled();
        });
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npx vitest run src/app/bootstrap.test.ts`
Expected: the new tests FAIL (no receive mode, no banner, dialog opens directly); existing tests still PASS.

- [ ] **Step 3: Wire `src/app/bootstrap.ts`**

Add imports:

```ts
import { movedToUrl } from '../move/move-config.js';
import { createMoveSource, redirectShareLink } from '../move/move-source.js';
import { isReceiveMode, runMoveReceiver } from '../move/move-receiver.js';
```

Directly after `installGlobalHandlers(root);`:

```ts
    if (isReceiveMode()) {
        void runMoveReceiver({ container: root });
        return;
    }

    const movedTo = movedToUrl();
    if (movedTo !== undefined && redirectShareLink(movedTo)) return;
```

Directly before `const backgroundColor = installToolbar({`:

```ts
    const moveSource = movedTo === undefined
        ? undefined
        : createMoveSource({
            container: root,
            targetUrl: movedTo,
            flushSave: () => saveCoordinator.flush(),
        });
```

Replace the `onNewGame` property in the `installToolbar` call:

```ts
        onNewGame: () => {
            const openDialog = (): void => openNewGameDialog({
                container: root,
                start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps),
            });
            if (moveSource) moveSource.onNewGame(openDialog);
            else openDialog();
        },
```

Replace the trailing `hashchange` listener and add the banner after it:

```ts
    window.addEventListener('hashchange', () => {
        if (movedTo !== undefined && redirectShareLink(movedTo)) return;
        void shareLinks.tryLoad();
    });

    moveSource?.showBanner();
```

Keep the existing comment above the `hashchange` listener as is.

- [ ] **Step 4: Run the full suite, lint, and build**

Run: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm test && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run lint && PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH npm run build`
Expected: all tests PASS (including both geometry digests), lint clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/bootstrap.ts src/app/bootstrap.test.ts
git commit -F - <<'EOF'
feat(move): wire the move handoff into bootstrap

The new site enters receive mode before anything boots. A build with
VITE_MOVED_TO redirects share links, shows the move banner, and puts
the move dialog in front of New puzzle; without it nothing changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: End-to-end verification across two origins

No code unless a defect turns up (fix it with a test in the owning task's files, then commit as `fix(move): …`).

- [ ] **Step 1: Start the target (new site) on port 5174**

Run in the background: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH VITE_MOVED_FROM=http://localhost:5173 npx vite --port 5174 --strictPort`

- [ ] **Step 2: Start the source (old site) on port 5173**

Run in the background: `PATH=$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH VITE_MOVED_TO=http://localhost:5174/puzzle/ npx vite --port 5173 --strictPort`

- [ ] **Step 3: Happy path with Playwright**

1. Open `http://localhost:5173/puzzle/`, wait for the puzzle, drag one piece, note the seed (`localStorage['puzzle-geometry-seed']`) and change one setting (e.g. background color).
2. Banner reads "Puzzle has moved — bring your puzzle along"; tap it, tap **Move to the new site**.
3. A new tab opens on `http://localhost:5174/puzzle/`, ends without `?receive-move`, and shows the same puzzle with the dragged piece where it was and the same background color.
4. The source tab shows "Done — your puzzle is open in the new tab." Reload it: banner reads "Your puzzle is now at localhost:5174"; New puzzle navigates to 5174.
5. Screenshot the banner and dialog on a 390×844 viewport to check layout against the toolbar and attribution.

- [ ] **Step 4: Conflict path**

Clear `puzzle-moved-to` on 5173, start a different puzzle on 5174, run the move again. Expect the confirm prompt; **Cancel** leaves 5174's puzzle and settings, source dialog closes. Run again and **OK** — 5174 shows the 5173 puzzle.

- [ ] **Step 5: iOS-standalone path**

With an init script `Object.defineProperty(navigator, 'standalone', { value: true })` on 5173: no banner; New puzzle shows the instructions dialog with no Move button; "Start a new puzzle here anyway" opens the normal dialog.

- [ ] **Step 6: Share link redirect**

Open `http://localhost:5173/puzzle/#p=<hash from Task 7>`; expect an immediate redirect to `http://localhost:5174/puzzle/#p=…` loading that puzzle.

- [ ] **Step 7: Stop both servers and report**

Record each step's result (pass/fail, screenshots) for the PR description.
