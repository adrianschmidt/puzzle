# BACKLOG — Puzzle App

Status: `todo` | `in-progress` | `done` | `blocked`

---

## Phase 1: Foundation

### 1.1 — Project scaffolding & config
**Status:** done
**Description:** Vite + TypeScript + PWA plugin setup, folder structure, license, design doc.

### 1.2 — Core data model
**Status:** done
**Depends on:** 1.1
**Description:** Define TypeScript types for Point, Size, Edge, Piece, PieceGroup, GameState as specified in DESIGN.md. The model is graph-based and shape-agnostic — no grid assumptions in the engine types. Include helper functions: `getMateEdge(piece, edge)` → finds the mate piece and edge, `getBorderEdges(group, pieces)` → returns edges in the group that have mates in other groups (used for merge detection).

### 1.3 — Grid puzzle generator
**Status:** done
**Depends on:** 1.2
**Description:** Create a puzzle generator that produces a 6×8 grid of pieces with tab/blank Bézier edges. The generator is a separate module from the engine — it outputs `Piece[]` conforming to the generic model. Each piece gets: an SVG clip-path built from its edges (flat/tab/blank using cubic Bézier curves), edge connectivity (mate relationships to adjacent pieces), and image sampling coordinates. Adjacent pieces must use the exact same curve (inverted) for their shared edge. Border edges have `mateEdgeId: -1, matePieceId: -1`.

## Phase 2: Rendering

### 2.1 — Renderer interface
**Status:** done
**Depends on:** 1.2
**Description:** Define a `Renderer` interface that the game logic calls. Methods: `init(container)`, `renderState(gameState)`, `onPiecePointerDown(callback)`, `bringGroupToFront(groupId)`, `destroy()`. This abstraction allows swapping DOM→Canvas later.

### 2.2 — SVG/DOM renderer implementation
**Status:** done
**Depends on:** 1.3, 2.1
**Description:** Implement the Renderer interface using SVG/DOM. Each piece = `<image>` element clipped by its SVG path. Groups are DOM containers with CSS `transform: translate(x, y)`. Handle devicePixelRatio for crisp rendering. Use a fixed puzzle image (find/create a suitable 800×600ish image).

## Phase 3: Interaction

### 3.1 — Drag handling
**Status:** done
**Depends on:** 2.2
**Done:** 2026-03-22
**Description:** Implement pointer event handling for drag. On pointerdown on a piece: identify its group, capture pointer, track delta. On pointermove: update group position. On pointerup: release capture, trigger merge check. Dragged group moves to front (z-order).

### 3.2 — Game initialization
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** On "New Game": use the grid generator to create 48 pieces, initialize each in its own single-piece group, randomize group positions within the viewport (ensuring all pieces are visible and not overlapping too much), render the initial state.

### 3.3 — Clamp drag to viewport bounds
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** Prevent pieces/groups from being dragged out of reach. Clamp pointer position during drag so that at least a grabbable portion of the group remains within the visible viewport. This prevents pieces from getting lost behind browser chrome or off-screen. Uses `visualViewport` for accurate bounds on mobile.

### 3.4 — Zoom and pan
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** Add a viewport transform layer so users can zoom in/out and pan the puzzle table. Pinch-to-zoom on touch, scroll-wheel zoom on desktop. Pan by dragging on empty space (not on a piece). The puzzle table should be larger than the screen, with the viewport acting as a window into it. Essential for puzzles that don't fit on screen.

## Phase 4: Core Mechanic

### 4.1 — Merge detection
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** After a group is dropped: for each piece in the moved group, iterate its edges. For edges with mates, find the mate piece. If the mate piece is in a different group, calculate expected vs actual edge alignment. If within tolerance (~15-20px), trigger merge. Tolerance should be a named constant (`MERGE_TOLERANCE_PX`).

### 4.2 — Group merging
**Status:** done
**Depends on:** 4.1
**Done:** 2026-03-22
**Description:** When merge is detected: combine two groups (recalculate piece offsets relative to new group anchor, snap position so edges align perfectly, remove old group, update DOM structure). Handle cascading merges (after A+B merge, re-check new group's border edges against all mates).

### 4.3 — Win detection
**Status:** done
**Depends on:** 4.2
**Done:** 2026-03-22
**Description:** After each merge, check if all pieces are in a single group. If so, set `completed: true` and show a simple "Puzzle Complete!" message.

### 4.4 — Prevent accidental merges in piece piles
**Status:** done
**Depends on:** 4.2
**Done:** 2026-03-22
**Description:** When dropping a piece near a pile of other pieces, it can accidentally snap to a matching edge even though the player clearly didn't intend to place it there. This makes sorting through piles frustrating. Add a heuristic to suppress merging when the dropped piece/group is overlapping with many other non-matching groups (i.e. it's in a pile, not being intentionally placed). Important: don't block intentional placement into a gap in an assembled section — there, neighboring pieces are expected to be close. Possible approach: count how many distinct other groups overlap the dropped piece's bounding area; if above a threshold and many of those are non-matching, skip the merge.

## Phase 5: Persistence & UI

### 5.1 — Auto-save & restore
**Status:** done
**Depends on:** 4.2
**Done:** 2026-03-22
**Description:** Save full GameState to localStorage on every state change (debounced 500ms). Serialize Maps as entries arrays. On app load: check for saved state, restore if valid, otherwise show new game. Include state version number for future migrations. Wrap restore in try/catch.

### 5.2 — New Game button
**Status:** done
**Depends on:** 5.1
**Done:** 2026-03-22
**Description:** Add a minimal UI: "New Game" button that clears saved state and re-randomizes. Confirm before discarding an in-progress game.

### 5.3 — Centre view button
**Status:** done
**Depends on:** 3.4
**Done:** 2026-03-22
**Description:** Add a UI button that resets the viewport pan/zoom to the default centred view. Useful after zooming/panning around to quickly get back to a known orientation.

### 5.4 — Gather pieces button
**Status:** done
**Depends on:** 3.2
**Done:** 2026-03-22
**Description:** Add a UI button that brings all groups together to the centre of the visible play area. When pieces are scattered widely (especially after zooming out), this collects them into a manageable area without changing their groupings. Should distribute groups loosely so they don't all stack on the exact same point.

## Phase 6: Polish & Deploy

### 6.1 — PWA manifest & icons
**Status:** done
**Depends on:** 5.2
**Done:** 2026-03-22
**Description:** Configure vite-plugin-pwa with proper manifest (name, icons, theme color, display: standalone). Generate app icons for iPad home screen. Test "Add to Home Screen" flow.

### 6.2 — GitHub Pages deployment
**Status:** done
**Done:** 2026-03-22
**Description:** Set up GitHub Actions workflow to build and deploy to gh-pages on push to main. Verify the app loads correctly from the Pages URL.

### 6.3 — Visual polish
**Status:** done
**Done:** 2026-03-22
**Depends on:** 5.2
**Description:** Subtle drop shadow on pieces/groups for depth. Smooth snap animation when pieces merge. Satisfying "complete" animation. Basic responsive layout (works on iPad in both orientations).

### 6.4 — Suppress context menu on long-press
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** On touch devices (especially iPad), long-pressing a puzzle piece brings up the browser's context menu. Prevent this by adding `contextmenu` event prevention on the puzzle container. Also ensure no text selection or callout overlays appear during drag (`-webkit-touch-callout: none`, `user-select: none`).

---

## Phase 7: MLP — Minimum Lovable Product

### 7.1 — Random Unsplash images
**Status:** done
**Done:** 2026-03-22
**Depends on:** 5.1
**Description:** On "New Game", fetch a random landscape photo from Unsplash to use as the puzzle image. Use the Unsplash API (free tier, needs API key). Filter for landscape orientation to match the puzzle grid aspect ratio. Store the image URL in GameState so the image persists across app restarts. Handle errors gracefully (fall back to default image if fetch fails). The API key should be configured via environment variable at build time (not committed to repo).

### 7.1.1 — Fix: New Game should show new Unsplash image immediately
**Status:** todo
**Depends on:** 7.1
**Description:** Currently, starting a new game doesn't display a new image until the app is reloaded. The `startNewGame()` function fetches a new Unsplash image, but the rendered puzzle keeps showing the previous image. Investigate whether this is a browser caching issue, a renderer not updating the image source, or the SVG `<image>` elements holding stale `href` references. The new image should appear immediately when "New Game" is pressed.

### 7.2 — Selectable puzzle sizes
**Status:** done
**Done:** 2026-03-22
**Depends on:** 5.2
**Description:** Let the player choose puzzle size when starting a new game. Options: 24 (4×6), 48 (6×8), 96 (8×12), 192 (12×16). The grid generator already accepts rows/cols, so this is primarily a UI task. Show size options in a new-game dialog or screen. Save the chosen size preference. Consider piece size vs screen size — larger puzzles need smaller pieces.

### 7.3 — Procedurally generated cuts
**Status:** todo
**Depends on:** 1.3
**Description:** Create a new puzzle generator that produces varied, natural-looking cuts so no two puzzles have the same cut pattern. Each game should feel unique. The generator should still conform to the generic Piece/Edge model. Vary tab/blank shapes (different Bézier control points), edge positions (not perfectly grid-aligned), and possibly tab sizes. Use a seeded PRNG so the same seed reproduces the same cut (useful for save/restore).

### 7.4 — Custom images
**Status:** todo
**Depends on:** 7.1
**Description:** Allow the player to use their own image: upload from device or paste a URL. Handle CORS issues (proxy or canvas-based approach for URL images). Resize/crop to fit the puzzle aspect ratio. Show a preview before starting. Error states for invalid images, too-small images, failed loads.

### 7.5 — Free rotation of pieces
**Status:** todo
**Depends on:** 4.2
**Description:** Pieces start at random rotations. Two-finger rotate gesture on touch, or modifier+drag on desktop. Merge detection must account for rotation — edges only align when both pieces are at the correct relative rotation (within tolerance). Add rotation field to PieceGroup. Snap rotation to 0° on merge. This significantly increases puzzle difficulty and realism.

### 7.6 — Background colour selection
**Status:** todo
**Depends on:** 6.3
**Description:** Let the player change the puzzle table background colour. Dark pieces are hard to see on the default dark background. Offer a few preset colours (dark, medium grey, light, wood tone, green felt) and/or a custom colour picker. Persist the choice in localStorage. Apply via CSS custom property on the body/container.

---

*Last updated: 2026-03-22*
