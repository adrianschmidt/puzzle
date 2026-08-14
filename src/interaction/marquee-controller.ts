/**
 * Owns one rubber-band gesture: a transient overlay rectangle, then on release
 * an additive selection of every group whose screen bounds match the box
 * (intersect vs contain read at release time). Driven by setupInteraction,
 * which forwards the router's background-drag pointer events.
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
    /** Screen rects for every selectable group, evaluated at release time. */
    getGroupScreenRects: () => ReadonlyArray<{ id: number; rect: ScreenRect }>;
    /** Called once when a marquee adds ≥1 group to the selection. */
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

    start(evt: PointerEvent): void {
        this.removeOverlay();
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
        const matched: number[] = [];
        for (const { id, rect } of this.opts.getGroupScreenRects()) {
            const hit = contain
                ? rectContains(marquee, rect)
                : rectsIntersect(marquee, rect);
            if (hit) matched.push(id);
        }
        // Batch so selection onChange (re-applies visuals across every group) fires once, not per match.
        const changed = this.opts.selectionManager.selectMany(matched);
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
 * Project a group's rotation-aware, tab-inclusive world bounds to a screen
 * rectangle, or null when the group has no findable geometry. The viewport
 * has no rotation, so an axis-aligned world box stays axis-aligned on screen.
 */
export function groupScreenRect(
    group: PieceGroup,
    piecesById: GameState['piecesById'],
    worldToScreen: (p: Point) => Point,
): ScreenRect | null {
    const vb = getGroupVisualBounds(group, piecesById);
    // getGroupVisualBounds returns a 0×0 box as its no-geometry sentinel; a real group always has a footprint, so skip it.
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
