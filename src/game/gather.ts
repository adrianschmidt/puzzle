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
 * Compute new positions for all groups, distributing them in a loose
 * grid centred on the visible area.
 *
 * @param groups - Current groups with their positions (not mutated)
 * @param visibleArea - The visible viewport rectangle in world coordinates
 * @param pieceWidth - Width of a single puzzle piece in world units
 * @param pieceHeight - Height of a single puzzle piece in world units
 * @returns Map of groupId → new world position
 */
export function computeGatheredPositions(
    groups: ReadonlyArray<Readonly<PieceGroup>>,
    visibleArea: WorldRect,
    pieceWidth: number,
    pieceHeight: number,
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

    // Multiple groups: lay them out in a grid around the centre.
    // Each cell is sized to fit the largest group plus padding.
    const cellWidth = pieceWidth + GATHER_PADDING;
    const cellHeight = pieceHeight + GATHER_PADDING;

    // Determine grid dimensions — roughly square, biased wider
    const cols = Math.ceil(Math.sqrt(groups.length));
    const rows = Math.ceil(groups.length / cols);

    // Total grid size
    const gridWidth = cols * cellWidth;
    const gridHeight = rows * cellHeight;

    // Top-left of the grid, centred on the visible area
    const startX = centreX - gridWidth / 2;
    const startY = centreY - gridHeight / 2;

    const result = new Map<number, Point>();

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const col = i % cols;
        const row = Math.floor(i / cols);

        result.set(group.id, {
            x: startX + col * cellWidth,
            y: startY + row * cellHeight,
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
