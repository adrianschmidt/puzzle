import type { Point, Piece, PieceGroup } from '../model/types.js';
import { getGroupVisualBounds } from './group-bounds.js';

export const GATHER_PADDING = 50;

export interface WorldRect {
    /** Left edge (world x). */
    x: number;
    /** Top edge (world y). */
    y: number;
    width: number;
    height: number;
}

export interface GatherResult {
    /** Map of groupId → new world position. */
    positions: Map<number, Point>;
    /** Bounding box of the entire layout in world coordinates. */
    layoutBounds: { x: number; y: number; width: number; height: number };
}

/**
 * Uses actual visual bounding boxes for each group, so it works
 * correctly with both classic and fractal piece shapes. Does not mutate
 * the groups. After calling this, the caller should zoom-to-fit the
 * returned layoutBounds so all pieces are visible regardless of
 * current zoom.
 */
export function computeGatheredPositions(
    groups: ReadonlyArray<Readonly<PieceGroup>>,
    screenAspectRatio: number,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
): GatherResult {
    const emptyResult: GatherResult = {
        positions: new Map(),
        layoutBounds: { x: 0, y: 0, width: 0, height: 0 },
    };

    if (groups.length === 0) {
        return emptyResult;
    }

    const margin = GATHER_PADDING;

    interface GroupLayout {
        group: PieceGroup;
        bounds: ReturnType<typeof getGroupVisualBounds>;
    }

    const layouts: GroupLayout[] = groups.map(group => ({
        group,
        bounds: getGroupVisualBounds(group, piecesById),
    }));

    // Shuffle so grid position doesn't correlate with solved position
    for (let i = layouts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [layouts[i], layouts[j]] = [layouts[j], layouts[i]];
    }

    // Sort by height descending for better row packing
    layouts.sort((a, b) => b.bounds.height - a.bounds.height);

    const aspectRatio = Math.max(0.1, screenAspectRatio);

    let maxGroupWidth = 0;
    let totalGroupWidth = 0;
    for (const layout of layouts) {
        maxGroupWidth = Math.max(maxGroupWidth, layout.bounds.width);
        totalGroupWidth += layout.bounds.width + margin;
    }

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
            lo = mid;
        } else {
            hi = mid;
        }
    }
    const targetWidth = (lo + hi) / 2;

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

    // Layout centered at origin (0,0) — the caller will handle viewport positioning
    const startX = -maxRowWidth / 2;
    const startY = -totalHeight / 2;

    const result = new Map<number, Point>();
    let y = startY;

    for (const row of rows) {
        let rowWidth = 0;
        for (const layout of row.items) {
            rowWidth += layout.bounds.width + margin;
        }
        rowWidth -= margin;

        let x = -rowWidth / 2;

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

/** Mutates the groups in place. */
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
