/**
 * SVG/DOM renderer implementation.
 *
 * Each piece = `<svg>` element with an `<image>` clipped by the piece's shape.
 * Groups are absolutely positioned `<div>` containers with CSS transforms.
 *
 * Coordinate system:
 * - Pieces define their shapes in piece-local coordinates
 *   (origin at piece's top-left corner, before tabs/blanks extend beyond)
 * - `piece.imageOffset` positions the full puzzle image behind the clip-path
 * - Groups position pieces in world space via `group.position + piece.groupOffset`
 *
 * The puzzle image is loaded once and referenced by all piece elements.
 */

import { getPieceBounds } from '../model/derive.js';
import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import type { Renderer } from './types.js';

/**
 * Extra padding around each piece's SVG element to accommodate
 * tabs that extend beyond the base piece rectangle.
 */
const PIECE_PADDING = 30;

/**
 * Width of the expanded hit-area stroke around each piece (in world-space
 * pixels). This creates a larger touch target so that near-misses on a
 * piece edge still register as hitting the piece rather than the
 * background. Because the value is in world space, the screen-space
 * expansion is proportionally larger when zoomed out — exactly when
 * pieces are hardest to tap.
 *
 * Only applies to piece-vs-background decisions. When another piece's
 * exact hit area is under the pointer, the expanded area defers.
 */
const HIT_AREA_EXPANSION_PX = 8;

export class SvgDomRenderer implements Renderer {
    private tableEl: HTMLElement | null = null;
    private groupElements = new Map<number, HTMLElement>();
    private pieceElements = new Map<number, SVGSVGElement>();
    private imageSize = { width: 0, height: 0 };
    private pieceBaseWidth = 0;
    private pieceBaseHeight = 0;
    private currentImageUrl = '';
    private currentPieceCount = -1;
    private currentShapeFingerprint = '';

    init(container: HTMLElement): void {
        const table = document.createElement('div');
        table.dataset.puzzleTable = 'true';
        table.style.position = 'relative';
        table.style.width = '100%';
        table.style.height = '100%';
        table.style.overflow = 'visible';
        table.style.touchAction = 'none';
        table.style.transformOrigin = '0 0';
        container.appendChild(table);

        this.tableEl = table;
    }

    renderState(gameState: GameState): void {
        if (!this.tableEl) return;

        // When the puzzle changes (new game), invalidate all cached SVG
        // elements. Piece IDs restart at 0 each game, so stale elements
        // would be reused with wrong shapes if not cleared.
        // We detect a new game by checking image URL, piece count, AND
        // the first piece's shape as a fingerprint.
        const pieceCount = gameState.pieces.length;
        const shapeFingerprint = gameState.pieces[0]?.shape ?? '';
        if (gameState.imageUrl !== this.currentImageUrl ||
            pieceCount !== this.currentPieceCount ||
            shapeFingerprint !== this.currentShapeFingerprint) {
            this.clearAllElements();
            this.currentImageUrl = gameState.imageUrl;
            this.currentPieceCount = pieceCount;
            this.currentShapeFingerprint = shapeFingerprint;
        }

        this.imageSize = gameState.imageSize;
        this.pieceBaseWidth = this.imageSize.width / gameState.gridSize.cols;
        this.pieceBaseHeight = this.imageSize.height / gameState.gridSize.rows;

        const pieceLookup = new Map<number, Piece>();
        for (const piece of gameState.pieces) {
            pieceLookup.set(piece.id, piece);
        }

        const activeGroupIds = new Set<number>();

        for (const group of gameState.groups) {
            activeGroupIds.add(group.id);
            this.renderGroup(group, pieceLookup, gameState.imageUrl);
        }

        // Remove groups that no longer exist (after merging)
        for (const [groupId, el] of this.groupElements) {
            if (!activeGroupIds.has(groupId)) {
                el.remove();
                this.groupElements.delete(groupId);
            }
        }

        // Remove orphaned piece elements
        const activePieceIds = new Set<number>();
        for (const group of gameState.groups) {
            for (const pieceId of group.pieces.keys()) {
                activePieceIds.add(pieceId);
            }
        }

        for (const [pieceId, el] of this.pieceElements) {
            if (!activePieceIds.has(pieceId)) {
                el.remove();
                this.pieceElements.delete(pieceId);
            }
        }
    }

    bringGroupToFront(groupId: number): void {
        const el = this.groupElements.get(groupId);
        if (el && this.tableEl) {
            this.tableEl.appendChild(el);
        }
    }

    setViewportTransform(scale: number, offsetX: number, offsetY: number): void {
        if (!this.tableEl) return;

        this.tableEl.style.transform =
            `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }

    enableViewportTransition(): void {
        if (!this.tableEl) return;
        this.tableEl.style.transition = 'transform 0.8s ease-in-out';
    }

    disableViewportTransition(): void {
        if (!this.tableEl) return;
        this.tableEl.style.transition = '';
    }

    setGroupDragging(groupId: number, dragging: boolean): void {
        const el = this.groupElements.get(groupId);
        if (!el) return;

        if (dragging) {
            el.classList.add('dragging');
        } else {
            el.classList.remove('dragging');
        }
    }

    setGroupSelected(groupId: number, selected: boolean): void {
        const el = this.groupElements.get(groupId);
        if (!el) return;

        if (selected) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    }

    flashMergePulse(groupId: number): void {
        const el = this.groupElements.get(groupId);
        if (!el) return;

        // Restart the animation by removing and re-adding the class
        el.classList.remove('merge-pulse');
        // Force a reflow to restart the animation
        void el.offsetWidth;
        el.classList.add('merge-pulse');

        // Clean up the class when the animation ends
        el.addEventListener(
            'animationend',
            () => el.classList.remove('merge-pulse'),
            { once: true },
        );
    }

    pieceIdFromTarget(target: EventTarget | null): number | null {
        if (!(target instanceof Element)) return null;
        const svg = target.closest('svg[data-piece-id]') as SVGElement | null;
        if (!svg) return null;
        const id = Number(svg.dataset.pieceId);
        return Number.isFinite(id) ? id : null;
    }

    destroy(): void {
        if (this.tableEl) {
            this.tableEl.remove();
            this.tableEl = null;
        }

        this.groupElements.clear();
        this.pieceElements.clear();
    }

    // --- Private rendering helpers ---

    /**
     * Remove all cached group and piece DOM elements.
     *
     * Called when the puzzle image (or grid size) changes so that every
     * SVG piece element is recreated with the correct `<image>` href,
     * clip-path, and dimensions.
     */
    private clearAllElements(): void {
        for (const el of this.groupElements.values()) {
            el.remove();
        }

        this.groupElements.clear();

        // Piece elements live inside group containers, so they are already
        // removed from the DOM above.  We just need to clear the map.
        this.pieceElements.clear();
    }

    private renderGroup(
        group: PieceGroup,
        pieceLookup: Map<number, Piece>,
        imageUrl: string,
    ): void {
        let groupEl = this.groupElements.get(group.id);

        if (!groupEl) {
            groupEl = document.createElement('div');
            groupEl.dataset.groupId = String(group.id);
            groupEl.style.position = 'absolute';
            groupEl.style.top = '0';
            groupEl.style.left = '0';
            groupEl.style.willChange = 'transform';
            this.tableEl!.appendChild(groupEl);
            this.groupElements.set(group.id, groupEl);
        }

        const rotateDeg = group.rotation * 90;
        groupEl.style.transformOrigin = '0 0';
        groupEl.style.transform =
            `translate(${group.position.x}px, ${group.position.y}px) rotate(${rotateDeg}deg)`;

        // Track which pieces should be in this group
        const expectedPieceIds = new Set(group.pieces.keys());

        // Remove pieces that moved to a different group
        for (const child of Array.from(groupEl.children)) {
            const pieceId = Number((child as HTMLElement).dataset.pieceId);

            if (!expectedPieceIds.has(pieceId)) {
                child.remove();
            }
        }

        // Add/update pieces in this group
        for (const [pieceId, offset] of group.pieces) {
            const piece = pieceLookup.get(pieceId);
            if (!piece) continue;

            let svgEl = this.pieceElements.get(pieceId);

            if (!svgEl) {
                svgEl = this.createPieceSvg(piece, imageUrl);
                this.pieceElements.set(pieceId, svgEl);
            }

            if (svgEl.parentElement !== groupEl) {
                groupEl.appendChild(svgEl);
            }

            this.positionPiece(svgEl, offset);
        }
    }

    private createPieceSvg(piece: Piece, imageUrl: string): SVGSVGElement {
        const svgNS = 'http://www.w3.org/2000/svg';
        const xlinkNS = 'http://www.w3.org/1999/xlink';

        const svgWidth = this.pieceBaseWidth + PIECE_PADDING * 2;
        const svgHeight = this.pieceBaseHeight + PIECE_PADDING * 2;

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', String(svgWidth));
        svg.setAttribute('height', String(svgHeight));
        svg.setAttribute(
            'viewBox',
            `${-PIECE_PADDING} ${-PIECE_PADDING} ${svgWidth} ${svgHeight}`,
        );
        svg.style.position = 'absolute';
        svg.style.overflow = 'visible';
        svg.dataset.pieceId = String(piece.id);

        // Define clip-path
        const defs = document.createElementNS(svgNS, 'defs');
        const clipPath = document.createElementNS(svgNS, 'clipPath');
        clipPath.setAttribute('id', `clip-piece-${piece.id}`);

        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', piece.shape);
        clipPath.appendChild(path);
        defs.appendChild(clipPath);
        svg.appendChild(defs);

        // Image element clipped to the piece shape. `slice` makes the
        // raster cover the puzzle rect with excess cropped, so when the
        // puzzle's aspect ratio doesn't match the image file's aspect
        // ratio (fractal tile grid), the image is uniformly cropped to
        // fit rather than stretched — arcs stay circular.
        const image = document.createElementNS(svgNS, 'image');
        image.setAttributeNS(xlinkNS, 'href', imageUrl);
        image.setAttribute('width', String(this.imageSize.width));
        image.setAttribute('height', String(this.imageSize.height));
        image.setAttribute('x', String(piece.imageOffset.x));
        image.setAttribute('y', String(piece.imageOffset.y));
        image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        image.setAttribute(
            'clip-path',
            `url(#clip-piece-${piece.id})`,
        );
        image.setAttribute('draggable', 'false');
        image.setAttribute('pointer-events', 'none');
        svg.appendChild(image);

        // Expanded hit-area — a thick transparent stroke around the
        // piece shape that catches near-misses.  Placed *before* the
        // exact hit-area so the exact path is higher in z-order.
        // Only fires when no other piece's exact hit-area is under the
        // pointer (piece-vs-background bias, not piece-vs-piece).
        const expandedHitArea = document.createElementNS(svgNS, 'path');
        expandedHitArea.setAttribute('d', piece.shape);
        expandedHitArea.setAttribute('fill', 'rgba(0,0,0,0)');
        expandedHitArea.setAttribute('stroke', 'rgba(0,0,0,0)');
        expandedHitArea.setAttribute(
            'stroke-width',
            String(HIT_AREA_EXPANSION_PX * 2),
        );
        expandedHitArea.setAttribute('pointer-events', 'stroke');
        expandedHitArea.dataset.hitAreaExpanded = 'true';
        svg.appendChild(expandedHitArea);

        // Transparent hit-area matching the piece shape — ensures
        // pointer events only fire inside the actual piece outline,
        // not the rectangular SVG bounding box.
        const hitArea = document.createElementNS(svgNS, 'path');
        hitArea.setAttribute('d', piece.shape);
        hitArea.setAttribute('fill', 'rgba(0,0,0,0)');
        hitArea.setAttribute('stroke', 'none');
        hitArea.setAttribute('pointer-events', 'fill');
        hitArea.dataset.hitArea = 'true';
        svg.appendChild(hitArea);

        // Debug overlay: mateless edge strokes (hidden by default,
        // toggled via .show-mateless-edges on <html>).
        for (const edge of piece.edges) {
            if (edge.mateEdgeId !== -1) continue;
            const edgePath = document.createElementNS(svgNS, 'path');
            edgePath.setAttribute(
                'd',
                `M ${edge.start.x} ${edge.start.y} ${edge.path}`,
            );
            edgePath.setAttribute('fill', 'none');
            edgePath.setAttribute('stroke', '#FF69B4');
            edgePath.setAttribute('stroke-width', '2');
            edgePath.setAttribute('pointer-events', 'none');
            edgePath.dataset.matelessEdge = 'true';
            svg.appendChild(edgePath);
        }

        // Debug overlay: white-fill / black-outline piece shape, a stable
        // piece-ID label, and an arrow marking piece-local "up" (so a
        // player can see how a rotated group was originally oriented).
        // All hidden by default; toggled together via .show-debug-pieces.
        this.appendDebugPieceOverlay(svg, piece);

        // Disable pointer events on the SVG container itself —
        // only the hit-area paths should respond.
        svg.style.pointerEvents = 'none';

        return svg;
    }

    private positionPiece(svgEl: SVGSVGElement, offset: Point): void {
        svgEl.style.left = `${offset.x - PIECE_PADDING}px`;
        svgEl.style.top = `${offset.y - PIECE_PADDING}px`;
    }

    /**
     * Append the debug piece-view elements (fill, ID label, up arrow).
     *
     * They're always in the DOM so the toggle can flip them instantly
     * without re-rendering. Defaults to hidden via CSS.
     */
    private appendDebugPieceOverlay(svg: SVGSVGElement, piece: Piece): void {
        const svgNS = 'http://www.w3.org/2000/svg';

        const fillPath = document.createElementNS(svgNS, 'path');
        fillPath.setAttribute('d', piece.shape);
        fillPath.setAttribute('fill', 'white');
        fillPath.setAttribute('stroke', 'black');
        fillPath.setAttribute('stroke-width', '1');
        fillPath.setAttribute('pointer-events', 'none');
        fillPath.dataset.pieceFill = 'true';
        svg.appendChild(fillPath);

        const { minX, minY, maxX, maxY } = getPieceBounds(piece);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', String(centerX));
        label.setAttribute('y', String(centerY));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', '14');
        label.setAttribute('font-family', 'ui-monospace, Menlo, monospace');
        label.setAttribute('fill', 'black');
        label.setAttribute('pointer-events', 'none');
        label.textContent = String(piece.id);
        label.dataset.pieceLabel = 'true';
        svg.appendChild(label);

        // Upward-pointing triangle near the top of the piece's bbox.
        // Drawn in piece-local space, so group rotation carries it along —
        // it always points toward what was originally "up".
        const arrowHalf = 5;
        const arrowHeight = 7;
        const arrowTipY = minY + 4;
        const arrowBaseY = arrowTipY + arrowHeight;
        const arrow = document.createElementNS(svgNS, 'path');
        arrow.setAttribute(
            'd',
            `M ${centerX} ${arrowTipY}` +
                ` L ${centerX - arrowHalf} ${arrowBaseY}` +
                ` L ${centerX + arrowHalf} ${arrowBaseY} Z`,
        );
        arrow.setAttribute('fill', 'black');
        arrow.setAttribute('pointer-events', 'none');
        arrow.dataset.pieceUp = 'true';
        svg.appendChild(arrow);
    }
}
