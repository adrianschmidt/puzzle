/**
 * Marquee (drag-box) selection.
 *
 * Owns one rubber-band gesture: a transient screen-space overlay rectangle,
 * and, on release, an additive selection of every group whose projected
 * screen bounds match the box. Whether a group "matches" depends on the
 * intersect-vs-contain setting read at release time.
 *
 * The gesture is driven by `setupInteraction`, which forwards the same
 * background-drag pointer events the router emits for a viewport pan.
 */

import { getGroupVisualBounds } from '../game/index.js';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import type { SelectionManager } from './selection-manager.js';

export interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface MarqueeControllerOptions {
    /** Parent for the transient overlay element. */
    container: HTMLElement;
    selectionManager: SelectionManager;
    /** Read at release time so a setting change applies without a rebuild. */
    isContainMode: () => boolean;
    /**
     * Projected screen rectangles for every selectable group, evaluated at
     * release time against the current viewport transform.
     */
    getGroupScreenRects: () => ReadonlyArray<{ id: number; rect: ScreenRect }>;
    /** Called once after a marquee adds at least one group to the selection. */
    onSelectionCommitted: () => void;
}

export class MarqueeController {
    private opts: MarqueeControllerOptions;
    private overlay: HTMLElement | null = null;
    private startX = 0;
    private startY = 0;

    constructor(opts: MarqueeControllerOptions) {
        this.opts = opts;
    }

    /** Whether a marquee gesture is currently in progress. */
    get active(): boolean {
        return this.overlay !== null;
    }

    start(evt: PointerEvent): void {
        this.startX = evt.clientX;
        this.startY = evt.clientY;

        const overlay = document.createElement('div');
        overlay.className = 'marquee-box';
        overlay.style.left = `${this.startX}px`;
        overlay.style.top = `${this.startY}px`;
        overlay.style.width = '0px';
        overlay.style.height = '0px';
        this.overlay = overlay;
        this.opts.container.appendChild(overlay);
    }

    move(evt: PointerEvent): void {
        if (!this.overlay) return;
        const r = this.normalizedRect(evt.clientX, evt.clientY);
        this.overlay.style.left = `${r.left}px`;
        this.overlay.style.top = `${r.top}px`;
        this.overlay.style.width = `${r.right - r.left}px`;
        this.overlay.style.height = `${r.bottom - r.top}px`;
    }

    end(evt: PointerEvent): void {
        if (!this.overlay) return;
        const marquee = this.normalizedRect(evt.clientX, evt.clientY);
        this.removeOverlay();

        const contain = this.opts.isContainMode();
        let changed = false;
        for (const { id, rect } of this.opts.getGroupScreenRects()) {
            const hit = contain
                ? rectContains(marquee, rect)
                : rectsIntersect(marquee, rect);
            if (hit && !this.opts.selectionManager.isSelected(id)) {
                this.opts.selectionManager.select(id);
                changed = true;
            }
        }
        if (changed) this.opts.onSelectionCommitted();
    }

    cancel(): void {
        this.removeOverlay();
    }

    private removeOverlay(): void {
        this.overlay?.remove();
        this.overlay = null;
    }

    private normalizedRect(x: number, y: number): ScreenRect {
        return {
            left: Math.min(this.startX, x),
            top: Math.min(this.startY, y),
            right: Math.max(this.startX, x),
            bottom: Math.max(this.startY, y),
        };
    }
}

/**
 * Project a group's rotation-aware, tab-inclusive world bounds into a
 * screen-space rectangle. Returns null for a group with no findable
 * geometry (so callers can skip it). The viewport has no rotation, so an
 * axis-aligned world box maps to an axis-aligned screen box.
 */
export function groupScreenRect(
    group: PieceGroup,
    piecesById: GameState['piecesById'],
    worldToScreen: (p: Point) => Point,
): ScreenRect | null {
    const vb = getGroupVisualBounds(group, piecesById);
    if (vb.width === 0 && vb.height === 0) return null;

    const tl = worldToScreen({
        x: group.position.x + vb.minX,
        y: group.position.y + vb.minY,
    });
    const br = worldToScreen({
        x: group.position.x + vb.minX + vb.width,
        y: group.position.y + vb.minY + vb.height,
    });
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
    return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
}

function rectContains(outer: ScreenRect, inner: ScreenRect): boolean {
    return (
        inner.left >= outer.left &&
        inner.right <= outer.right &&
        inner.top >= outer.top &&
        inner.bottom <= outer.bottom
    );
}
