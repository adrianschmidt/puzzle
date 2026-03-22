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
**Status:** todo
**Depends on:** 3.1
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

## Phase 5: Persistence

### 5.1 — Auto-save & restore
**Status:** done
**Depends on:** 4.2
**Done:** 2026-03-22
**Description:** Save full GameState to localStorage on every state change (debounced 500ms). Serialize Maps as entries arrays. On app load: check for saved state, restore if valid, otherwise show new game. Include state version number for future migrations. Wrap restore in try/catch.

### 5.2 — New Game button
**Status:** todo
**Depends on:** 5.1
**Description:** Add a minimal UI: "New Game" button that clears saved state and re-randomizes. Confirm before discarding an in-progress game.

## Phase 6: Polish & Deploy

### 6.1 — PWA manifest & icons
**Status:** todo
**Depends on:** 5.2
**Description:** Configure vite-plugin-pwa with proper manifest (name, icons, theme color, display: standalone). Generate app icons for iPad home screen. Test "Add to Home Screen" flow.

### 6.2 — GitHub Pages deployment
**Status:** todo
**Depends on:** 6.1
**Description:** Set up GitHub Actions workflow to build and deploy to gh-pages on push to main. Verify the app loads correctly from the Pages URL.

### 6.3 — Visual polish
**Status:** todo
**Depends on:** 6.2
**Description:** Subtle drop shadow on pieces/groups for depth. Smooth snap animation when pieces merge. Satisfying "complete" animation. Basic responsive layout (works on iPad in both orientations).

### 6.4 — Suppress context menu on long-press
**Status:** done
**Depends on:** 3.1
**Done:** 2026-03-22
**Description:** On touch devices (especially iPad), long-pressing a puzzle piece brings up the browser's context menu. Prevent this by adding `contextmenu` event prevention on the puzzle container. Also ensure no text selection or callout overlays appear during drag (`-webkit-touch-callout: none`, `user-select: none`).

---

*Last updated: 2026-03-22 15:42*
