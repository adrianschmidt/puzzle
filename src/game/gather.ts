/**
 * Gather pieces — computes new positions for all groups to bring them
 * together near the centre of the visible play area.
 *
 * Groups are arranged in a compact layout using row-based packing,
 * where each row's height adapts to its tallest group. Groups are
 * shuffled so their layout position has no correlation with their
 * solved position.
 */

import type { Point, Piece, PieceGroup } from '../model/types.js';

/** Padding between groups when distributing in the gather layout. */
export const GATHER_PADDING = 50;

/**
 * A rectangular area in world coordinates.
 */
export interface WorldRect {
    /** Left edge (world x). */
    x: number;
    /** Top edge (world y). */
    y: number;
    /** Width in world units. */
    width: number;
    /** Height in world units. */
    height: number;
}

/**
 * Compute bounding box of piece offsets within a group (group-local space).
 *
 * Returns the min/max of all piece offset coordinates. For a single-piece
 * group at offset (0,0), this returns {minX:0, minY:0, maxX:0, maxY:0}.
 *
 * Note: This uses piece offsets only (not edge geometry). For accurate
 * world-space bounding boxes that include tab shapes, use
 * `getGroupBounds` from pile-detection.
 */
export function getGroupOffsetBounds(group: PieceGroup): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const offset of group.pieces.values()) {
        if (offset.x < minX) {
            minX = offset.x;
        }

        if (offset.y < minY) {
            minY = offset.y;
        }

        if (offset.x > maxX) {
            maxX = offset.x;
        }

        if (offset.y > maxY) {
            maxY = offset.y;
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Compute the visual bounding box of a group by examining the actual
 * SVG shape geometry of its pieces. This gives accurate dimensions
 * for both classic (rectangular + tabs) and fractal (organic arcs) pieces.
 */
function getGroupVisualBounds(
    group: PieceGroup,
    pieces: ReadonlyArray<Readonly<Piece>>,
): { minX: number; minY: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [pieceId, offset] of group.pieces) {
        const piece = pieces.find(p => p.id === pieceId);
        if (!piece) continue;

        // Use edge start/end points to determine piece extents
        for (const edge of piece.edges) {
            const points = [edge.start, edge.end];
            for (const pt of points) {
                const wx = offset.x + pt.x;
                const wy = offset.y + pt.y;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }
        }
    }

    if (!isFinite(minX)) {
        return { minX: 0, minY: 0, width: 0, height: 0 };
    }

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Result of computing gathered positions, including the layout bounds
 * so the caller can zoom-to-fit.
 */
export interface GatherResult {
    /** Map of groupId → new world position. */
    positions: Map<number, Point>;
    /** Bounding box of the entire layout in world coordinates. */
    layoutBounds: { x: number; y: number; width: number; height: number };
}

/**
 * Compute new positions for all groups, arranging them in a compact
 * row-based layout that matches the screen's aspect ratio.
 *
 * Uses actual visual bounding boxes for each group, so it works
 * correctly with both classic and fractal piece shapes. Rows are
 * packed left-to-right, wrapping to maintain the target aspect ratio.
 *
 * After calling this, the caller should zoom-to-fit the returned
 * layoutBounds so all pieces are visible regardless of current zoom.
 *
 * @param groups - Current groups with their positions (not mutated)
 * @param screenAspectRatio - Width/height ratio of the screen viewport
 * @param pieces - All pieces in the puzzle (for computing visual bounds)
 * @returns Positions and layout bounds for zoom-to-fit
 */
export function computeGatheredPositions(
    groups: ReadonlyArray<Readonly<PieceGroup>>,
    screenAspectRatio: number,
    pieces: ReadonlyArray<Readonly<Piece>>,
): GatherResult {
    const emptyResult: GatherResult = {
        positions: new Map(),
        layoutBounds: { x: 0, y: 0, width: 0, height: 0 },
    };

    if (groups.length === 0) {
        return emptyResult;
    }

    const margin = GATHER_PADDING;

    // Compute visual bounds for each group
    interface GroupLayout {
        group: PieceGroup;
        bounds: ReturnType<typeof getGroupVisualBounds>;
    }

    const layouts: GroupLayout[] = groups.map(group => ({
        group,
        bounds: getGroupVisualBounds(group, pieces),
    }));

    // Shuffle so grid position doesn't correlate with solved position
    for (let i = layouts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [layouts[i], layouts[j]] = [layouts[j], layouts[i]];
    }

    // Sort by height descending for better row packing
    layouts.sort((a, b) => b.bounds.height - a.bounds.height);

    // Estimate a good target width based on the screen aspect ratio.
    // We want the final layout to roughly match the screen's proportions.
    // Estimate total content area from all groups, then derive target width.
    let totalArea = 0;
    for (const layout of layouts) {
        totalArea += (layout.bounds.width + margin) * (layout.bounds.height + margin);
    }

    // targetWidth × (targetWidth / aspectRatio) ≈ totalArea
    // targetWidth² ≈ totalArea × aspectRatio
    const aspectRatio = Math.max(0.5, Math.min(3, screenAspectRatio));
    const targetWidth = Math.sqrt(totalArea * aspectRatio) * 1.1; // 10% extra to avoid being too tight

    // Pack into rows
    const rows: Array<{ items: GroupLayout[]; rowHeight: number }> = [];
    let currentRow: GroupLayout[] = [];
    let currentRowWidth = 0;
    let currentRowHeight = 0;

    for (const layout of layouts) {
        const itemWidth = layout.bounds.width + margin;

        if (currentRow.length > 0 && currentRowWidth + itemWidth > targetWidth) {
            rows.push({ items: currentRow, rowHeight: currentRowHeight });
            currentRow = [];
            currentRowWidth = 0;
            currentRowHeight = 0;
        }

        currentRow.push(layout);
        currentRowWidth += itemWidth;
        currentRowHeight = Math.max(currentRowHeight, layout.bounds.height);
    }

    if (currentRow.length > 0) {
        rows.push({ items: currentRow, rowHeight: currentRowHeight });
    }

    // Compute total layout dimensions
    let totalHeight = 0;
    let maxRowWidth = 0;
    for (const row of rows) {
        let rowWidth = 0;
        for (const layout of row.items) {
            rowWidth += layout.bounds.width + margin;
        }
        rowWidth -= margin;
        maxRowWidth = Math.max(maxRowWidth, rowWidth);
        totalHeight += row.rowHeight + margin;
    }
    totalHeight -= margin;

    // Layout centred at origin (0,0) — the caller will handle viewport positioning
    const startX = -maxRowWidth / 2;
    const startY = -totalHeight / 2;

    const result = new Map<number, Point>();
    let y = startY;

    for (const row of rows) {
        // Compute row width for centering
        let rowWidth = 0;
        for (const layout of row.items) {
            rowWidth += layout.bounds.width + margin;
        }
        rowWidth -= margin;

        let x = -rowWidth / 2; // Centre each row

        for (const layout of row.items) {
            const { group, bounds } = layout;

            result.set(group.id, {
                x: x - bounds.minX,
                y: y - bounds.minY,
            });

            x += bounds.width + margin;
        }

        y += row.rowHeight + margin;
    }

    return {
        positions: result,
        layoutBounds: {
            x: startX - margin,
            y: startY - margin,
            width: maxRowWidth + margin * 2,
            height: totalHeight + margin * 2,
        },
    };
}

/**
 * Apply gathered positions to groups (mutates the groups in place).
 *
 * @param groups - The groups array to update
 * @param positions - Map of groupId → new position
 */
export function applyGatheredPositions(
    groups: PieceGroup[],
    positions: Map<number, Point>,
): void {
    for (const group of groups) {
        const newPos = positions.get(group.id);
        if (newPos) {
            group.position = { ...newPos };
        }
    }
}
