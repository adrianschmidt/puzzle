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

import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import type { PiecePointerDownCallback, Renderer } from './types.js';
import {
    PIECE_PADDING,
    getImageDimensions,
    getGridCols,
    getGridRows,
} from './svg-dom-utils.js';

export class SvgDomRenderer implements Renderer {
    private tableEl: HTMLElement | null = null;
    private groupElements = new Map<number, HTMLElement>();
    private pieceElements = new Map<number, SVGSVGElement>();
    private callback: PiecePointerDownCallback | null = null;
    private imageSize = { width: 0, height: 0 };
    private pieceBaseWidth = 0;
    private pieceBaseHeight = 0;

    init(container: HTMLElement): void {
        const table = document.createElement('div');
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

        this.imageSize = getImageDimensions(gameState);
        this.pieceBaseWidth = this.imageSize.width / getGridCols(gameState);
        this.pieceBaseHeight = this.imageSize.height / getGridRows(gameState);

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

    onPiecePointerDown(callback: PiecePointerDownCallback): void {
        this.callback = callback;
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

    getTableElement(): HTMLElement | null {
        return this.tableEl;
    }

    destroy(): void {
        if (this.tableEl) {
            this.tableEl.remove();
            this.tableEl = null;
        }

        this.groupElements.clear();
        this.pieceElements.clear();
        this.callback = null;
    }

    // --- Private rendering helpers ---

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

        groupEl.style.transform =
            `translate(${group.position.x}px, ${group.position.y}px)`;

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

        // Image element clipped to the piece shape
        const image = document.createElementNS(svgNS, 'image');
        image.setAttributeNS(xlinkNS, 'href', imageUrl);
        image.setAttribute('width', String(this.imageSize.width));
        image.setAttribute('height', String(this.imageSize.height));
        image.setAttribute('x', String(piece.imageOffset.x));
        image.setAttribute('y', String(piece.imageOffset.y));
        image.setAttribute(
            'clip-path',
            `url(#clip-piece-${piece.id})`,
        );
        image.setAttribute('draggable', 'false');
        image.setAttribute('pointer-events', 'none');
        svg.appendChild(image);

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

        // Disable pointer events on the SVG container itself —
        // only the hit-area path should respond.
        svg.style.pointerEvents = 'none';

        // Pointer event handler on the hit-area path
        hitArea.addEventListener('pointerdown', (event: PointerEvent) => {
            if (this.callback) {
                this.callback(piece.id, event);
            }
        });

        return svg;
    }

    private positionPiece(svgEl: SVGSVGElement, offset: Point): void {
        svgEl.style.left = `${offset.x - PIECE_PADDING}px`;
        svgEl.style.top = `${offset.y - PIECE_PADDING}px`;
    }
}
