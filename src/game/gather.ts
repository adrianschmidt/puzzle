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
 * Scatter multiplier — the scatter area is this many times wider and
 * taller than the finished puzzle. Gives a natural "dumped on the table"
 * spread without pieces being unreachably far apart.
 */
const SCATTER_MULTIPLIER = 2.5;

/**
 * Maximum random jitter applied to each axis, as a fraction of the
 * cell size. 0.4 = up to 40% of a cell width/height in either direction.
 */
const JITTER_FRACTION = 0.4;

/**
 * Compute new positions for all groups, scattering them in a randomised
 * grid within an area relative to the finished puzzle size.
 *
 * Groups are shuffled before placement so their grid position has no
 * correlation with their solved position. Each group gets random jitter
 * so the layout doesn't look like a perfect grid.
 *
 * @param groups - Current groups with their positions (not mutated)
 * @param visibleArea - The visible viewport rectangle in world coordinates
 * @param pieceWidth - Width of a single puzzle piece in world units
 * @param pieceHeight - Height of a single puzzle piece in world units
 * @param puzzleCols - Number of columns in the puzzle grid (for scatter area sizing)
 * @param puzzleRows - Number of rows in the puzzle grid (for scatter area sizing)
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

    // Compute scatter area based on puzzle dimensions
    const pCols = puzzleCols ?? Math.ceil(Math.sqrt(groups.length));
    const pRows = puzzleRows ?? Math.ceil(groups.length / pCols);
    const puzzleWidth = pCols * pieceWidth;
    const puzzleHeight = pRows * pieceHeight;
    const scatterWidth = puzzleWidth * SCATTER_MULTIPLIER;
    const scatterHeight = puzzleHeight * SCATTER_MULTIPLIER;

    // Grid layout within the scatter area
    const gridCols = Math.ceil(Math.sqrt(groups.length));
    const gridRows = Math.ceil(groups.length / gridCols);
    const cellWidth = scatterWidth / gridCols;
    const cellHeight = scatterHeight / gridRows;

    // Top-left of the scatter area, centred on the visible area
    const startX = centreX - scatterWidth / 2;
    const startY = centreY - scatterHeight / 2;

    // Shuffle groups so grid position doesn't correlate with solved position
    const shuffled = [...groups];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const result = new Map<number, Point>();

    for (let i = 0; i < shuffled.length; i++) {
        const group = shuffled[i];
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);

        // Random jitter within the cell
        const jitterX = (Math.random() - 0.5) * 2 * JITTER_FRACTION * cellWidth;
        const jitterY = (Math.random() - 0.5) * 2 * JITTER_FRACTION * cellHeight;

        result.set(group.id, {
            x: startX + col * cellWidth + jitterX,
            y: startY + row * cellHeight + jitterY,
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
