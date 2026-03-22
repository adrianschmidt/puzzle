# BACKLOG — Puzzle App

Status: `todo` | `in-progress` | `done` | `blocked`

---

## Phase 1: Foundation

### 1.1 — Project scaffolding & config
**Status:** done
**Description:** Vite + TypeScript + PWA plugin setup, folder structure, license, design doc.

### 1.2 — Core data model
**Status:** todo
**Depends on:** 1.1
**Description:** Define TypeScript types for Piece, PieceGroup, GameState, EdgeType. Define the 48-piece grid (6×8) with edge types (ensuring adjacent pieces have complementary edges: tab ↔ blank). Include helper functions: `getNeighborId(pieceId, direction)`, `getPiecesOnBorder(group)`.

### 1.3 — Piece shape generation
**Status:** todo
**Depends on:** 1.2
**Description:** Generate SVG clip-path data from edge definitions. Each edge is either flat (straight line), tab (Bézier curve outward), or blank (Bézier curve inward). The same curve must be used for both sides of a matching edge (tab on piece A = exact inverse of blank on piece B). Output: a function `generatePiecePath(piece, pieceWidth, pieceHeight) → string` returning an SVG path `d` attribute.

## Phase 2: Rendering

### 2.1 — Renderer interface
**Status:** todo
**Depends on:** 1.2
**Description:** Define a `Renderer` interface that the game logic calls. Methods: `init(container)`, `renderState(gameState)`, `onPiecePointerDown(callback)`, `bringGroupToFront(groupId)`, `destroy()`. This abstraction allows swapping DOM→Canvas later.

### 2.2 — SVG/DOM renderer implementation
**Status:** todo
**Depends on:** 1.3, 2.1
**Description:** Implement the Renderer interface using SVG/DOM. Each piece = `<image>` element clipped by its SVG path. Groups are DOM containers with CSS `transform: translate(x, y)`. Handle devicePixelRatio for crisp rendering. Use a fixed puzzle image (find/create a suitable 800×600ish image).

## Phase 3: Interaction

### 3.1 — Drag handling
**Status:** todo
**Depends on:** 2.2
**Description:** Implement pointer event handling for drag. On pointerdown on a piece: identify its group, capture pointer, track delta. On pointermove: update group position. On pointerup: release capture, trigger merge check. Dragged group moves to front (z-order).

### 3.2 — Game initialization
**Status:** todo
**Depends on:** 3.1
**Description:** On "New Game": create 48 single-piece groups, randomize positions within the viewport (ensuring all pieces are visible and not overlapping too much), render the initial state.

## Phase 4: Core Mechanic

### 4.1 — Merge detection
**Status:** todo
**Depends on:** 3.1
**Description:** After a group is dropped: for each border piece in the moved group, find grid-adjacent pieces in other groups. Calculate expected edge alignment position vs actual position. If within tolerance (~15-20px), trigger merge. Tolerance should be a named constant.

### 4.2 — Group merging
**Status:** todo
**Depends on:** 4.1
**Description:** When merge is detected: combine two groups (move all pieces from group B into group A, snap position so edges align perfectly, remove group B, update DOM structure). Handle cascading merges (after A+B merge, check if new group touches C).

### 4.3 — Win detection
**Status:** todo
**Depends on:** 4.2
**Description:** After each merge, check if all pieces are in a single group. If so, set `completed: true` and show a simple "Puzzle Complete!" message.

## Phase 5: Persistence

### 5.1 — Auto-save & restore
**Status:** todo
**Depends on:** 4.2
**Description:** Save full GameState to localStorage on every state change (debounced 500ms). On app load: check for saved state, restore if valid, otherwise show new game. Include state version number for future migrations. Wrap restore in try/catch.

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

---

*Last updated: 2026-03-22*
