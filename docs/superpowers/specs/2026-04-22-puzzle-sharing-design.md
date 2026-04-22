# Puzzle sharing — design spec

**Date:** 2026-04-22
**Status:** Approved, ready for implementation plan

## Summary

Let the player share a puzzle by copying a link that encodes everything
needed to recreate it on another device — image, grid size, cut style,
seed, rotation mode, and cut-style-specific config. Optionally, the link
can also include the player's current progress (which pieces they've
merged so far), so a recipient can pick up where the sharer left off.

Links are generated from a "Share this puzzle" section in the info modal,
and from a "Challenge a friend" button on the puzzle-completion overlay.
Sharing uses the Web Share API (`navigator.share`) when available, and
falls back to copying the link to the clipboard.

## Goals

- **Reproducibility.** Given a share link, a recipient loads a puzzle
  that is byte-for-byte identical in shape, image, and connectivity to
  the one the sharer had. This includes the piece shapes (from the seed)
  and the image (from the URL).
- **Optional progress fidelity.** The sharer can opt in to include their
  current merges. The link grows a little but stays compact enough for
  any practical puzzle size.
- **Native sharing when possible.** On devices that support the Web
  Share API (iOS, Android, most mobile browsers, some desktop), use the
  OS share sheet. On others, fall back to clipboard copy with a toast.
- **No server changes.** The app is deployed to GitHub Pages; links are
  self-contained URL hashes.

## Non-goals

- **Real-time sync / multiplayer.** Sharing is one-way.
- **Short / vanity URLs.** No redirector service — links are as long as
  they are (~400–600 chars for typical puzzles).
- **Social preview cards (OpenGraph images).** Would need a server to
  render dynamic previews.
- **QR codes.** Possible follow-up, not core.

## What defines a "reproducible puzzle"

From the existing code, a puzzle is fully determined by:

- **Image:** `imageUrl` (stable Unsplash URL, or a `"blank"` sentinel) and
  `imageSize` (width × height). Optional `attribution`.
- **Grid:** `gridSize` (cols × rows).
- **Cut style:** `'classic' | 'fractal' | 'composable'`.
- **Seed:** a number used by the procedural generators.
- **Rotation mode:** `'none' | 'quarter-turn'`.
- **Cut-style-specific config:**
  - Fractal: `{ borderless: boolean }`. `rotationEnabled` is implicit from
    rotation mode.
  - Composable: `{ horizontalAmplitude, horizontalFrequency,
    verticalAmplitude, verticalFrequency, disableTabs }`.

Given the same values, `createNewGame` produces the same `Piece[]` with
the same IDs and edge connectivity. Starting scatter positions and — in
rotation puzzles — initial solo-piece rotations still use `Math.random`,
so those are **not** reproduced from the params alone. That's acceptable
for "same puzzle, fresh start" sharing and is explicitly addressed in
the progress-fidelity section below.

## URL format

Share links use a URL hash fragment:

```
https://adrianschmidt.github.io/puzzle/#p=<base64url-encoded JSON>
```

Rationale:

- **Hash over query:** the fragment never hits any server log and isn't
  included in `Referer` headers when the recipient follows outbound
  links from the page (e.g. the Unsplash attribution). Small privacy
  win at zero cost.
- **Base64url JSON over readable params:** cut-style configs are nested
  and will evolve; JSON handles that cleanly. Base64url avoids
  percent-encoding noise.

### Payload schema (v: 1)

Keys are short to keep links compact. Optional fields are omitted when
not needed.

```ts
interface SharePayload {
    v: 1;                          // schema version
    i: string;                     // imageUrl, or "blank" sentinel
    is: [number, number];          // image size [width, height]
    a?: {                          // attribution (optional)
        n: string;                 // photographer name
        u: string;                 // photographer URL
        p: string;                 // photo URL
    };
    g: [number, number];           // grid size [cols, rows]
    c: 'classic' | 'fractal' | 'composable';
    s: number;                     // seed
    r: 'none' | 'quarter-turn';
    cf?: {                         // composable config
        ha: number; hf: number;
        va: number; vf: number;
        dt: boolean;
    };
    ff?: { bl: boolean };          // fractal config; rotationEnabled implicit via `r`

    // Progress, only present when the sharer opted in.
    pr?: {
        m: number[][];             // merged groups; each inner array ≥ 2 piece IDs
        mr?: number[];             // merged-group rotations, parallel to m; rotation mode only
        sr?: number[];             // solo rotations as flat [id, rot, id, rot, ...]; rotation mode only
    };
}
```

### Blank image handling

The "blank" image source currently generates a white 1080×720 canvas
data URL in `startNewGame`. Embedding that data URL in a share link
would bloat it by several KB. Instead, encode `i: "blank"` and have the
recipient regenerate the same white canvas locally, using `payload.is`
(`[1080, 720]` today) as the canvas dimensions. Canvas generation is
deterministic given the size.

### Link size sanity check

- Typical Unsplash 192-piece puzzle, starting-puzzle share:
  - Unsplash URL: ~250 chars
  - Attribution: ~100 chars
  - Params: ~50 chars
  - Raw JSON: ~400 chars → base64url: ~550 chars
- Same puzzle with full progress (several large merges):
  - + ~400 chars for merged groups
  - + ~200 chars for rotations (if rotation mode)
  - Total: ~1200–1500 chars

Well within any practical URL limit (2000+ in all modern browsers).

## Architecture

### New module: `src/sharing/`

- `share-link.ts`
  - `encodeShareLink(config, progress?): string` — returns the full
    share URL (base URL + `#p=...`)
  - `decodeShareLink(hash: string): SharePayload | null` — parses,
    validates, returns null on any failure
  - Version check + shape validation
- `share-link.test.ts`

### New module: `src/ui/share.ts`

Thin helper that prefers `navigator.share()`, falls back to clipboard.

```ts
export async function sharePuzzle(opts: {
    url: string;
    title: string;
    text: string;
    onCopied: () => void;       // called when we fell back to clipboard
    onError: (e: Error) => void;
}): Promise<void>;
```

### New helper: `src/game/reconstruct-groups.ts`

Rebuilds merged `PieceGroup`s from a list of piece-ID arrays, by walking
the edge graph to compute piece offsets. Shares the edge-alignment math
with the existing `group-merging.ts` — extract the shared helper rather
than duplicating it.

### New helper: `src/ui/toast.ts`

Small glassmorphism toast ("Link copied to clipboard", auto-dismiss
~2s). Scoped to sharing for now; generalise if a second caller appears.

### Integration points

- **`src/main.ts`** — check `window.location.hash` on load, before the
  existing save-restore branch.
- **`src/ui/info-modal.ts`** — add a "Share this puzzle" section.
- **`src/main.ts`** `showCompletionOverlay` — add "Challenge a friend"
  button.

## UI

### Info modal "Share this puzzle" section

Placed alongside the existing Settings section. Contents:

- **Heading:** "Share this puzzle"
- **Explainer:** "Send this link to share the same puzzle with a friend."
- **Checkbox:** "Include my current progress" — unchecked by default.
  Disabled when there are no merges yet or when the puzzle is complete,
  with helper text explaining why.
  - No merges: "Make some progress first"
  - Completed: "Puzzle is already complete"
- **Primary action button:**
  - Web Share API supported → **"Share…"** (opens native share sheet)
  - Not supported → **"Copy link"** (copies + toast)
- **Live URL preview:** small read-only URL display below the button so
  the user can manually copy if they prefer. Recomputes when the
  checkbox toggles.

### Completion overlay button

Added to the existing `showCompletionOverlay` markup, between the "Well
done!" text and "Tap anywhere to dismiss":

> **"Challenge a friend — share this puzzle!"**

Click stops propagation (so the overlay-dismiss handler doesn't fire)
and triggers the share helper. Always shares the **starting puzzle** —
no progress, because the puzzle is complete. The "tap anywhere to
dismiss" behaviour elsewhere on the overlay is preserved.

## Link-opening flow

In `main.ts`, before the existing save-restore branch:

```
1. Read window.location.hash
2. If starts with "#p=":
   a. decodeShareLink(hash) → SharePayload | null
   b. null → toast "Invalid share link", clear hash, continue to normal boot
   c. Valid payload:
      - If current game is in-progress (shouldConfirmNewGame is true):
        - Show confirm: "Load shared puzzle? Your current progress will be lost."
        - If cancelled: LEAVE the hash in place, continue to normal boot
          (user can reload to try again, or copy the link elsewhere)
      - clearSavedState()
      - history.replaceState(null, '', pathname)  // only NOW clear the hash
      - loadSharedPuzzle(payload)
3. Else: existing save-restore flow
```

### `loadSharedPuzzle(payload)`

Maps the payload onto `createNewGame`:

- `payload.i === 'blank'` → regenerate the white canvas locally
- Otherwise use `payload.i` directly
- Pass through `gridSize`, `cutStyle`, `seed`, `rotationMode`, and the
  composable / fractal configs
- Attach `attribution` if present

The seed + config combo deterministically reproduces the `Piece[]`.
Initial scatter positions, and — in rotation puzzles — initial
solo-piece rotations, are re-randomised unless overridden by the
progress payload.

### Progress reconstruction

```
For each pieceIds[] in progress.m:
    1. Pick piece 0 as anchor (offset {0, 0})
    2. BFS from the anchor over the piece edge graph, restricted to
       the group's piece set:
         - For each edge of the current piece with matePieceId in the
           group, compute the mate's offset from the current piece's
           offset and the edge/mate endpoints (mate edge is mirrored,
           so align edge.start ↔ mateEdge.end and edge.end ↔
           mateEdge.start)
    3. Verify all pieces in the group were reached. Reject as corrupt
       if any were missed.
    4. Build a PieceGroup with:
         - Fresh group ID
         - Map of pieceId → offset
         - Position from the gathered-layout, so the reconstructed
           group is visible and not overlapping
         - Rotation from progress.mr[groupIdx] (0 if rotation mode is 'none')
    5. Remove the absorbed solo groups from state.groups
    6. Push the new merged group

If progress.sr is present:
    For each [id, rot] pair: find the solo group containing that
    piece, set its rotation.
```

After reconstruction, run the existing `gatherAndZoomToFit()` so the
mix of merged groups and solo pieces lays out neatly.

### Failure modes

- Payload version unsupported → toast "This share link was created with
  a newer version of the app", fall through to normal boot
- Malformed base64 / JSON / shape → toast "Invalid share link", fall
  through to normal boot
- Progress references piece IDs not in the generated puzzle → toast
  "Couldn't load progress — starting from scratch", load the starting
  puzzle only
- Progress specifies disconnected pieces as a group → same fallback

## Help-text updates

Required by `CLAUDE.md`: "When you add, remove, or change a
user-visible feature, update the modal's How to Play, Cut Styles,
and/or Settings sections in the same PR."

Same-PR changes to `src/ui/info-modal.ts`:

- Add a new **Share** section (between Settings and credits) with one
  short paragraph explaining the feature, the "Include my current
  progress" checkbox behaviour, and the "Challenge a friend" button on
  the completion overlay.

## Testing

### Unit tests

| Module | Tests |
|---|---|
| `src/sharing/share-link.test.ts` | Round-trip: minimal starting payload; with attribution; with composable config; with fractal config; with progress (no rotation); with progress + rotation fidelity (`mr` + `sr`). Rejects unsupported version. Rejects malformed base64. Rejects invalid JSON shape. Preserves `"blank"` image sentinel. |
| `src/game/reconstruct-groups.test.ts` | Single 2-piece merge reconstructs offsets matching `processDrop`. Multi-piece group (≥ 3) reconstructs correctly. Rejects disconnected piece sets. Rejects piece IDs not in the puzzle. Preserves merged-group rotation. Preserves solo-piece rotations. |
| `src/ui/share.test.ts` | Prefers `navigator.share` when available. Swallows `AbortError` (user cancelled) without falling back. Falls back to clipboard on non-Abort errors. Calls `onCopied` on successful clipboard write. |
| New test file for the share section of the info modal | Disabled-state rules for "Include my current progress" checkbox (no merges yet / completed / in-progress). |

### Browser smoke test (optional)

Open the app with a known `#p=…` hash in Playwright, confirm the
correct puzzle loads with matching pieces.

## Rollout

This is an additive, backwards-compatible feature. No migration
needed. Schema version field (`v: 1`) is in place for future evolution.
