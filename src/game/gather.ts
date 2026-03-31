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
 * Parse an SVG path string and compute the bounding box of all points
 * (including bezier control points) in the path.
 *
 * This produces a conservative bounding box — control points may extend
 * beyond the actual curve, but the result is guaranteed to contain the
 * full path geometry. Good enough for layout spacing.
 */
export function getPathBounds(
    path: string,
    start: Point,
): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = start.x;
    let minY = start.y;
    let maxX = start.x;
    let maxY = start.y;

    let curX = start.x;
    let curY = start.y;

    function expand(x: number, y: number) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    // Match SVG path commands: a letter followed by numbers/commas/spaces
    const commandRegex = /([MLCSQTZHVAmlcsqtzhva])\s*([-\d.,eE\s]*)/g;
    let match: RegExpExecArray | null;

    while ((match = commandRegex.exec(path)) !== null) {
        const cmd = match[1];
        const argsStr = match[2].trim();
        const nums: number[] = [];

        if (argsStr.length > 0) {
            // Parse numbers, handling negative signs and decimals
            const numRegex = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
            let numMatch: RegExpExecArray | null;
            while ((numMatch = numRegex.exec(argsStr)) !== null) {
                nums.push(parseFloat(numMatch[0]));
            }
        }

        switch (cmd) {
            case 'M':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'm':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'L':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'l':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'H':
                for (const n of nums) {
                    curX = n;
                    expand(curX, curY);
                }
                break;
            case 'h':
                for (const n of nums) {
                    curX += n;
                    expand(curX, curY);
                }
                break;
            case 'V':
                for (const n of nums) {
                    curY = n;
                    expand(curX, curY);
                }
                break;
            case 'v':
                for (const n of nums) {
                    curY += n;
                    expand(curX, curY);
                }
                break;
            case 'C':
                for (let i = 0; i + 5 < nums.length; i += 6) {
                    expand(nums[i], nums[i + 1]);
                    expand(nums[i + 2], nums[i + 3]);
                    curX = nums[i + 4];
                    curY = nums[i + 5];
                    expand(curX, curY);
                }
                break;
            case 'c':
                for (let i = 0; i + 5 < nums.length; i += 6) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    expand(curX + nums[i + 2], curY + nums[i + 3]);
                    curX += nums[i + 4];
                    curY += nums[i + 5];
                    expand(curX, curY);
                }
                break;
            case 'S':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(nums[i], nums[i + 1]);
                    curX = nums[i + 2];
                    curY = nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 's':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    curX += nums[i + 2];
                    curY += nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'Q':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(nums[i], nums[i + 1]);
                    curX = nums[i + 2];
                    curY = nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'q':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    curX += nums[i + 2];
                    curY += nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'T':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 't':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'A':
                for (let i = 0; i + 6 < nums.length; i += 7) {
                    // Include the arc endpoint; radii are harder to bound
                    // but including the endpoint is a reasonable approximation
                    curX = nums[i + 5];
                    curY = nums[i + 6];
                    expand(curX, curY);
                }
                break;
            case 'a':
                for (let i = 0; i + 6 < nums.length; i += 7) {
                    curX += nums[i + 5];
                    curY += nums[i + 6];
                    expand(curX, curY);
                }
                break;
            case 'Z':
            case 'z':
                // Close path — return to start
                curX = start.x;
                curY = start.y;
                break;
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Compute the visual bounding box of a group by examining the actual
 * SVG shape geometry of its pieces. This gives accurate dimensions
 * for both classic (rectangular + tabs) and fractal (organic arcs) pieces.
 *
 * Includes bezier control points from edge paths to account for tab
 * geometry that extends beyond the start/end corner vertices.
 */
export function getGroupVisualBounds(
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

        for (const edge of piece.edges) {
            // Always include start/end points
            const points = [edge.start, edge.end];
            for (const pt of points) {
                const wx = offset.x + pt.x;
                const wy = offset.y + pt.y;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }

            // Include path geometry (control points, curve endpoints)
            if (edge.path) {
                const pathBounds = getPathBounds(edge.path, edge.start);
                const pts = [
                    { x: pathBounds.minX, y: pathBounds.minY },
                    { x: pathBounds.maxX, y: pathBounds.maxY },
                ];
                for (const pt of pts) {
                    const wx = offset.x + pt.x;
                    const wy = offset.y + pt.y;
                    if (wx < minX) minX = wx;
                    if (wy < minY) minY = wy;
                    if (wx > maxX) maxX = wx;
                    if (wy > maxY) maxY = wy;
                }
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

    // Find the target row width that produces a layout matching the
    // viewport aspect ratio. We binary-search on width: pack rows at
    // a candidate width, measure the resulting height, and adjust until
    // width/height ≈ screenAspectRatio.
    const aspectRatio = Math.max(0.1, screenAspectRatio);

    let maxGroupWidth = 0;
    let totalGroupWidth = 0;
    for (const layout of layouts) {
        maxGroupWidth = Math.max(maxGroupWidth, layout.bounds.width);
        totalGroupWidth += layout.bounds.width + margin;
    }

    // Search bounds: minimum is widest group, maximum is all in one row
    const minWidth = maxGroupWidth + margin;
    const maxWidth = totalGroupWidth + margin;

    function packHeight(tw: number): number {
        let height = 0;
        let rowWidth = 0;
        let rowHeight = 0;
        let rowCount = 0;
        for (const layout of layouts) {
            const w = layout.bounds.width + margin;
            if (rowCount > 0 && rowWidth + w > tw) {
                height += rowHeight + margin;
                rowWidth = 0;
                rowHeight = 0;
                rowCount = 0;
            }
            rowWidth += w;
            rowHeight = Math.max(rowHeight, layout.bounds.height);
            rowCount++;
        }
        if (rowCount > 0) height += rowHeight;
        return height;
    }

    // Binary search: ~10 iterations gives <0.1% precision
    let lo = minWidth;
    let hi = maxWidth;
    for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const h = packHeight(mid);
        if (h === 0) break;
        const ratio = mid / h;
        if (ratio < aspectRatio) {
            lo = mid; // too tall → widen
        } else {
            hi = mid; // too wide → narrow
        }
    }
    const targetWidth = (lo + hi) / 2;

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
