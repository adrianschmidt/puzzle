# Puzzle App — Design Document

## Vision

A jigsaw puzzle web app that recreates the experience of laying a physical puzzle on a physical table. No "snap to correct position" — pieces merge with each other when matching edges are placed close together, regardless of where they are on the screen.

## MVP Scope

- 48 pieces (6×8 grid), fixed cut, fixed image
- Randomized piece placement at game start
- Drag pieces by touch or mouse
- Piece-to-piece merging (the core mechanic)
- Auto-save game state to localStorage
- Win detection (all pieces merged into one group)
- PWA for "Add to Home Screen" on iPad
- Deployed via GitHub Pages

## Architecture Decisions

### Rendering: DOM/SVG with CSS Transforms
- Each piece is an SVG element with a clip-path
- CSS `transform: translate()` for positioning (GPU-accelerated)
- Grouping via DOM structure (`<g>` elements or wrapper divs)
- Native pointer event handling (no manual hit testing)
- DevTools-inspectable for easy debugging

**Renderer interface**: All rendering goes through a `Renderer` interface so we can swap to Canvas later if needed for large puzzles (500+ pieces).

### Data Model: Group-Based
- Every piece is always in exactly one group (solo pieces = single-piece groups)
- Merging = combining two groups into one
- Piece world positions are **derived** from `group.position + (piece.gridPos - anchorPiece.gridPos) × pieceSize`
- No redundant position storage → no drift bugs

### Core Types
```typescript
interface Piece {
  id: number;
  gridX: number;        // Column in solved puzzle (0-based)
  gridY: number;        // Row in solved puzzle (0-based)
  edges: {              // Edge types for each side
    top: EdgeType;      // 'flat' | 'tab' | 'blank'
    right: EdgeType;
    bottom: EdgeType;
    left: EdgeType;
  };
}

interface PieceGroup {
  id: number;
  pieceIds: number[];
  x: number;            // World position of group anchor
  y: number;
}

interface GameState {
  pieces: Piece[];
  groups: PieceGroup[];
  gridCols: number;     // 8 for MVP
  gridRows: number;     // 6 for MVP
  imageUrl: string;
  completed: boolean;
}
```

### Piece Shapes
- SVG paths with cubic Bézier curves for tabs/blanks
- Each edge is: `flat` (border edge), `tab` (protrusion), or `blank` (indentation)
- Adjacent pieces have complementary edges (tab ↔ blank)
- Shapes defined in a dedicated module; MVP uses hardcoded definitions

### Merge Algorithm
On drop of a group:
1. For each piece on the group's border, find grid-adjacent pieces in other groups
2. Check if edges align within tolerance (~15-20px)
3. If match: merge groups, snap to perfect alignment
4. Cascade: re-check new group's borders (one drop can trigger multiple merges)

### Interaction
- Pointer Events API (unified mouse/touch/pen)
- Drag entire group when any piece in it is grabbed
- Dragged group renders on top (z-order management)
- Pointer capture for reliable drag tracking

### Persistence
- `localStorage` with debounced writes (500ms)
- Full GameState serialized as JSON
- Load on startup with try/catch (corrupted state → new game)
- Well under localStorage size limits even for large puzzles

### PWA
- Vite + vite-plugin-pwa for service worker
- Manifest with icons for iPad home screen
- Offline-capable (all assets cached)

## Future Features (not MVP, but architecture must not block)
- Select from built-in image gallery
- Upload/link custom images
- Procedurally generated puzzle cuts
- Different cut styles and puzzle sizes
- Free rotation of pieces
- Zoom/pan for large puzzles (500+ pieces)

## Tech Stack
- TypeScript
- Vite (build + dev server)
- vite-plugin-pwa
- No framework (vanilla TS)
- GitHub Pages for deployment
