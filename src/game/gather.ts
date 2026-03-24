/**
 * Gather pieces — computes new positions for all groups to bring them
 * together near the centre of the visible play area.
 *
 * Groups are distributed in a loose grid so they don't all stack on the
 * exact same point, but are close enough to be manageable.
 */

import type { Point, PieceGroup } from '../model/types.js';

/** Padding between groups when distributing in the gather layout. */
export const GATHER_PADDING = 10;

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
 * Minimum margin between groups in the gather layout, in world units.
 * This ensures pieces don't touch each other when gathered.
 */
const MIN_MARGIN = 20;

/**
 * Compute new positions for all groups, arranging them in a compact
 * grid layout with consistent minimum margins between pieces.
 *
 * Groups are shuffled and sorted by size before placement so their grid
 * position has no correlation with their solved position. Each group is
 * positioned using its actual bounding box for efficient space usage.
 *
 * @param groups - Current groups with their positions (not mutated)
 * @param visibleArea - The visible viewport rectangle in world coordinates
 * @param pieceWidth - Width of a single puzzle piece in world units
 * @param pieceHeight - Height of a single puzzle piece in world units
 * @param puzzleCols - Number of columns in the puzzle grid (unused in new layout)
 * @param puzzleRows - Number of rows in the puzzle grid (unused in new layout)
 * @returns Map of groupId → new world position
 */
export function computeGatheredPositions(
    groups: ReadonlyArray<Readonly<PieceGroup>>,
    visibleArea: WorldRect,
    pieceWidth: number,
    pieceHeight: number,
    puzzleCols?: number,
    puzzleRows?: number,
): Map<number, Point> {
    if (groups.length === 0) {
        return new Map();
    }

    // Centre of the visible area
    const centreX = visibleArea.x + visibleArea.width / 2;
    const centreY = visibleArea.y + visibleArea.height / 2;

    if (groups.length === 1) {
        // Single group: place it at the centre
        const group = groups[0];
        const bounds = getGroupOffsetBounds(group);
        const groupWidth = (bounds.maxX - bounds.minX) + pieceWidth;
        const groupHeight = (bounds.maxY - bounds.minY) + pieceHeight;

        return new Map([
            [
                group.id,
                {
                    x: centreX - groupWidth / 2 - bounds.minX,
                    y: centreY - groupHeight / 2 - bounds.minY,
                },
            ],
        ]);
    }

    // Prepare groups with their dimensions for layout
    interface GroupWithSize {
        group: PieceGroup;
        bounds: ReturnType<typeof getGroupOffsetBounds>;
        width: number;
        height: number;
    }

    const groupsWithSizes: GroupWithSize[] = groups.map((group) => {
        const bounds = getGroupOffsetBounds(group);
        return {
            group,
            bounds,
            width: (bounds.maxX - bounds.minX) + pieceWidth,
            height: (bounds.maxY - bounds.minY) + pieceHeight,
        };
    });

    // Shuffle groups so grid position doesn't correlate with solved position
    for (let i = groupsWithSizes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [groupsWithSizes[i], groupsWithSizes[j]] = [groupsWithSizes[j], groupsWithSizes[i]];
    }

    // Sort by size (larger groups first) for better packing efficiency
    groupsWithSizes.sort((a, b) => {
        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        return areaB - areaA;
    });

    // Use a simple grid layout with dynamic cell sizing
    const gridCols = Math.ceil(Math.sqrt(groups.length));
    const gridRows = Math.ceil(groups.length / gridCols);

    // Find the maximum dimensions among all groups for consistent grid sizing
    let maxWidth = 0;
    let maxHeight = 0;
    for (const { width, height } of groupsWithSizes) {
        maxWidth = Math.max(maxWidth, width);
        maxHeight = Math.max(maxHeight, height);
    }

    // Cell dimensions include the largest group plus margin
    const cellWidth = maxWidth + MIN_MARGIN;
    const cellHeight = maxHeight + MIN_MARGIN;

    // Total grid dimensions
    const totalGridWidth = gridCols * cellWidth - MIN_MARGIN; // Subtract margin from final edge
    const totalGridHeight = gridRows * cellHeight - MIN_MARGIN;

    // Position the grid centred in the visible area
    const startX = centreX - totalGridWidth / 2;
    const startY = centreY - totalGridHeight / 2;

    const result = new Map<number, Point>();

    for (let i = 0; i < groupsWithSizes.length; i++) {
        const { group, bounds } = groupsWithSizes[i];
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);

        // Position group at the top-left corner of its cell, accounting for its bounds
        const cellX = startX + col * cellWidth;
        const cellY = startY + row * cellHeight;

        result.set(group.id, {
            x: cellX - bounds.minX,
            y: cellY - bounds.minY,
        });
    }

    return result;
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
