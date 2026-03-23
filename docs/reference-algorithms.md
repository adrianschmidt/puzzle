# Reference: Puzzle Cut Generation Algorithms

Research notes for implementing improved puzzle piece generators.

## 1. Dillo's Classic Shape (CodePen: Dillo/QWKLYab)

**License:** Not explicitly stated on CodePen. Treat as reference/inspiration only.

### Core Concept
Uses a **coordinate system relative to the edge and its opposite side**:
- `p0, p1` = start and end of the edge
- `dxh, dyh` = horizontal delta (along the edge)
- `ca, cb` = the two corners of the **opposite** side
- `mid0` = midpoint of this edge
- `mid1` = midpoint of the opposite side
- `dxv, dyv` = vertical delta (perpendicular, toward opposite side)

This is the key insight: the `pointAt(coeffh, coeffv)` function places points
using the edge direction as one axis and the perpendicular (toward opposite side)
as the other. This means the coordinate system is naturally symmetric — reversing
the edge simply reverses the `coeffh` parameter.

### `twist0` — The Classic Shape (best-looking)
Defines 5 key points along the edge using `pointAt`:
- `pa` = neck entry (~35% along, ~8% perpendicular)
- `pb` = head left (~33% along, ~25% perpendicular)  
- `pc` = head top (centre, ~33% perpendicular)
- `pd` = head right (~67% along, ~25% perpendicular)
- `pe` = neck exit (~58% along, ~8% perpendicular)

Then creates **6 cubic Bézier segments** between these points, with control
points that create the classic mushroom shape:
1. `p0 → pa` (straight edge curves into neck)
2. `pa → pb` (neck curves outward to head left)
3. `pb → pc` (head left curves across to head top)
4. `pc → pd` (head top curves to head right)
5. `pd → pe` (head right curves back to neck)
6. `pe → p1` (neck curves back to straight edge)

Key randomization parameters (all via seeded PRNG):
- `scalex` [0.8, 1.0] — horizontal scale of the tab
- `scaley` [0.9, 1.0] — vertical scale (height) of the tab
- `mid` [0.45, 0.55] — centre position along the edge

### `twist1` — Simple Triangle Shape
Just 3 points: entry, peak, exit. Creates 4 Bézier segments.
Simpler but less realistic.

### `twist2` — Smooth Bump
Single peak point with lerped control points. Soft curve.

### Edge Matching Approach
Edges are generated once on one side, then `.reversed()` creates the mating
edge by reversing the points array. Since Bézier curves are symmetric when
control points are reversed, this guarantees perfect matching.

**This is much simpler than our current approach** of trying to generate both
sides independently with shared parameters. Generate once, reverse for mate.

---

## 2. Fractal Jigsaw Generator (proceduraljigsaw/Fractalpuzzlejs)

**License:** Not explicitly stated. GitHub repo is public.

### Core Concept
Uses a **circle-packing grid** where each cell is a circle. Pieces are formed
by connecting adjacent cells using circular arcs. The fractal aspect comes from
subdividing pieces recursively.

### Algorithm
1. Create a grid of circles
2. Mark which cells are inside the puzzle boundary
3. Randomly merge adjacent cells into pieces (flood-fill approach)
4. Piece boundaries are drawn using circular arcs between cell centres
5. Arc shapes can be: circular (default), square, or octagonal

### Key Classes
- `CellGrid` — manages the grid of cells
- `CircleFractalJigsaw` — the main generator
  - `generate()` — randomly assigns cells to pieces
  - `fillholes()` — ensures no isolated cells remain
  - `multipaths()` — generates SVG path data for each piece

### Piece Shape
Pieces are irregular, organic shapes made from merged circles.
Very different aesthetic from classic jigsaw pieces.
No tabs/blanks — pieces interlock through the curved boundaries between cells.

---

## Key Takeaway for Our Implementation

**Dillo's approach of generating an edge once and reversing it for the mate
is fundamentally more robust** than our current approach of generating both
sides independently with shared parameters. The reversal is mathematically
guaranteed to produce a perfect mirror.

We should refactor our generator to:
1. Generate each shared edge's path once (from side A's perspective)
2. Store the path points
3. For side B, reverse the points array

This eliminates the entire class of bugs we've been fighting with
centreOffset/skew direction.
