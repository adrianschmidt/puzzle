/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvgDomRenderer } from './svg-dom-renderer.js';
import type { GameState, Piece, PieceGroup } from '../model/types.js';

/** Create a simple rectangular piece (no Bézier curves). */
function makePiece(
    id: number,
    width: number,
    height: number,
    col: number,
    row: number,
): Piece {
    return {
        id,
        edges: [
            {
                id: id * 4,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L ${width} 0`,
                start: { x: 0, y: 0 },
                end: { x: width, y: 0 },
            },
            {
                id: id * 4 + 1,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L ${width} ${height}`,
                start: { x: width, y: 0 },
                end: { x: width, y: height },
            },
            {
                id: id * 4 + 2,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L 0 ${height}`,
                start: { x: width, y: height },
                end: { x: 0, y: height },
            },
            {
                id: id * 4 + 3,
                mateEdgeId: -1,
                matePieceId: -1,
                path: 'L 0 0',
                start: { x: 0, y: height },
                end: { x: 0, y: 0 },
            },
        ],
        shape: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        imageOffset: { x: -col * width, y: -row * height },
    };
}

function makeGroup(id: number, pieceIds: number[], x = 0, y = 0): PieceGroup {
    return {
        id,
        pieces: new Map(pieceIds.map((pid, i) => [pid, { x: i * 100, y: 0 }])),
        position: { x, y },
    };
}

function make2x2State(): GameState {
    const pw = 100;
    const ph = 100;

    return {
        pieces: [
            makePiece(0, pw, ph, 0, 0),
            makePiece(1, pw, ph, 1, 0),
            makePiece(2, pw, ph, 0, 1),
            makePiece(3, pw, ph, 1, 1),
        ],
        groups: [
            makeGroup(0, [0], 50, 50),
            makeGroup(1, [1], 200, 50),
            makeGroup(2, [2], 50, 200),
            makeGroup(3, [3], 200, 200),
        ],
        imageUrl: 'test-puzzle.jpg',
        imageSize: { width: 200, height: 200 },
        gridSize: { cols: 2, rows: 2 },
        completed: false,
    };
}

describe('SvgDomRenderer', () => {
    let container: HTMLElement;
    let renderer: SvgDomRenderer;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        renderer = new SvgDomRenderer();
    });

    afterEach(() => {
        renderer.destroy();
        container.remove();
    });

    describe('init', () => {
        it('creates a table div inside the container', () => {
            renderer.init(container);

            const table = container.querySelector('div');
            expect(table).not.toBeNull();
            expect(table!.style.position).toBe('relative');
            expect(table!.style.touchAction).toBe('none');
        });
    });

    describe('renderState', () => {
        it('creates a group div for each group', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            const groups = container.querySelectorAll('[data-group-id]');
            expect(groups).toHaveLength(4);
        });

        it('creates an SVG element for each piece', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            const svgs = container.querySelectorAll('svg[data-piece-id]');
            expect(svgs).toHaveLength(4);
        });

        it('places pieces inside their group containers', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            for (const group of state.groups) {
                const groupEl = container.querySelector(
                    `[data-group-id="${group.id}"]`,
                );
                expect(groupEl).not.toBeNull();

                for (const pieceId of group.pieces.keys()) {
                    const pieceEl = groupEl!.querySelector(
                        `[data-piece-id="${pieceId}"]`,
                    );
                    expect(
                        pieceEl,
                        `Piece ${pieceId} should be in group ${group.id}`,
                    ).not.toBeNull();
                }
            }
        });

        it('sets group position via CSS transform', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            const groupEl = container.querySelector(
                '[data-group-id="0"]',
            ) as HTMLElement;

            expect(groupEl.style.transform).toBe('translate(50px, 50px)');
        });

        it('each piece SVG has a clip-path in its defs', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            for (const piece of state.pieces) {
                const svg = container.querySelector(
                    `svg[data-piece-id="${piece.id}"]`,
                );
                expect(svg).not.toBeNull();

                const clipPath = svg!.querySelector(
                    `clipPath#clip-piece-${piece.id}`,
                );
                expect(
                    clipPath,
                    `Piece ${piece.id} should have a clip-path`,
                ).not.toBeNull();

                const path = clipPath!.querySelector('path');
                expect(path).not.toBeNull();
                expect(path!.getAttribute('d')).toBe(piece.shape);
            }
        });

        it('each piece SVG has an image element', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            for (const piece of state.pieces) {
                const svg = container.querySelector(
                    `svg[data-piece-id="${piece.id}"]`,
                );
                const image = svg!.querySelector('image');
                expect(image).not.toBeNull();
                expect(image!.getAttribute('clip-path')).toBe(
                    `url(#clip-piece-${piece.id})`,
                );
            }
        });

        it('removes groups that no longer exist', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);
            expect(
                container.querySelectorAll('[data-group-id]'),
            ).toHaveLength(4);

            // Merge group 0 and 1 into a new group
            const mergedGroup: PieceGroup = {
                id: 10,
                pieces: new Map([
                    [0, { x: 0, y: 0 }],
                    [1, { x: 100, y: 0 }],
                ]),
                position: { x: 50, y: 50 },
            };

            const newState: GameState = {
                ...state,
                groups: [mergedGroup, state.groups[2], state.groups[3]],
            };

            renderer.renderState(newState);

            const groups = container.querySelectorAll('[data-group-id]');
            expect(groups).toHaveLength(3);

            // Old groups 0 and 1 should be gone
            expect(
                container.querySelector('[data-group-id="0"]'),
            ).toBeNull();
            expect(
                container.querySelector('[data-group-id="1"]'),
            ).toBeNull();

            // New merged group should exist with both pieces
            const mergedEl = container.querySelector(
                '[data-group-id="10"]',
            );
            expect(mergedEl).not.toBeNull();
            expect(
                mergedEl!.querySelector('[data-piece-id="0"]'),
            ).not.toBeNull();
            expect(
                mergedEl!.querySelector('[data-piece-id="1"]'),
            ).not.toBeNull();
        });

        it('updates group positions on re-render', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            // Move group 0
            state.groups[0] = {
                ...state.groups[0],
                position: { x: 300, y: 400 },
            };

            renderer.renderState(state);

            const groupEl = container.querySelector(
                '[data-group-id="0"]',
            ) as HTMLElement;
            expect(groupEl.style.transform).toBe('translate(300px, 400px)');
        });

        it('does nothing if init was not called', () => {
            const state = make2x2State();

            // Should not throw
            renderer.renderState(state);
        });
    });

    describe('onPiecePointerDown', () => {
        it('calls the registered callback on pointerdown', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            const callback = vi.fn();
            renderer.onPiecePointerDown(callback);

            const svg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;

            const hitArea = svg.querySelector('[data-hit-area]') as SVGPathElement;
            const event = new PointerEvent('pointerdown', {
                bubbles: true,
            });
            hitArea.dispatchEvent(event);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(0, expect.any(PointerEvent));
        });

        it('passes the correct piece id for different pieces', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            const callback = vi.fn();
            renderer.onPiecePointerDown(callback);

            const svg2 = container.querySelector(
                'svg[data-piece-id="2"]',
            ) as SVGSVGElement;
            const hitArea2 = svg2.querySelector('[data-hit-area]') as SVGPathElement;
            hitArea2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

            expect(callback).toHaveBeenCalledWith(
                2,
                expect.any(PointerEvent),
            );
        });

        it('does not fire if no callback is registered', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            const svg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;

            // Should not throw
            svg.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true }),
            );
        });
    });

    describe('bringGroupToFront', () => {
        it('moves the group element to the end of its parent', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            const table = container.querySelector('div')!;
            const firstChild = table.firstElementChild;
            expect(firstChild!.getAttribute('data-group-id')).toBe('0');

            // Bring group 0 to front — it should become the last child
            renderer.bringGroupToFront(0);

            const lastChild = table.lastElementChild;
            expect(lastChild!.getAttribute('data-group-id')).toBe('0');
        });

        it('is a no-op for non-existent group ids', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            // Should not throw
            renderer.bringGroupToFront(999);
        });
    });

    describe('setViewportTransform', () => {
        it('applies CSS transform to the table element', () => {
            renderer.init(container);

            renderer.setViewportTransform(2, 100, 50);

            const table = container.querySelector('div') as HTMLElement;
            expect(table.style.transform).toBe('translate(100px, 50px) scale(2)');
        });

        it('handles identity transform', () => {
            renderer.init(container);

            renderer.setViewportTransform(1, 0, 0);

            const table = container.querySelector('div') as HTMLElement;
            expect(table.style.transform).toBe('translate(0px, 0px) scale(1)');
        });

        it('does nothing if init was not called', () => {
            // Should not throw
            renderer.setViewportTransform(2, 100, 50);
        });
    });

    describe('getTableElement', () => {
        it('returns the table element after init', () => {
            renderer.init(container);

            const table = renderer.getTableElement();
            expect(table).not.toBeNull();
            expect(table!.style.position).toBe('relative');
        });

        it('returns null before init', () => {
            expect(renderer.getTableElement()).toBeNull();
        });
    });

    describe('setGroupDragging', () => {
        it('adds the dragging class when dragging is true', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            renderer.setGroupDragging(0, true);

            const groupEl = container.querySelector('[data-group-id="0"]')!;
            expect(groupEl.classList.contains('dragging')).toBe(true);
        });

        it('removes the dragging class when dragging is false', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            renderer.setGroupDragging(0, true);
            renderer.setGroupDragging(0, false);

            const groupEl = container.querySelector('[data-group-id="0"]')!;
            expect(groupEl.classList.contains('dragging')).toBe(false);
        });

        it('is a no-op for non-existent group ids', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            // Should not throw
            renderer.setGroupDragging(999, true);
        });
    });

    describe('flashMergePulse', () => {
        it('adds the merge-pulse class to the group element', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            renderer.flashMergePulse(0);

            const groupEl = container.querySelector('[data-group-id="0"]')!;
            expect(groupEl.classList.contains('merge-pulse')).toBe(true);
        });

        it('is a no-op for non-existent group ids', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            // Should not throw
            renderer.flashMergePulse(999);
        });
    });

    describe('destroy', () => {
        it('removes the table element', () => {
            renderer.init(container);
            expect(container.children).toHaveLength(1);

            renderer.destroy();
            expect(container.children).toHaveLength(0);
        });

        it('can be called multiple times safely', () => {
            renderer.init(container);
            renderer.destroy();
            renderer.destroy(); // should not throw
        });
    });
});
