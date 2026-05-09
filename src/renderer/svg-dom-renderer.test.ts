/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SvgDomRenderer } from './svg-dom-renderer.js';
import type { GameState, PieceGroup } from '../model/types.js';
import { makeGameState, makeRectPiece } from '../test-helpers/fixtures.js';

function makeGroup(id: number, pieceIds: number[], x = 0, y = 0): PieceGroup {
    return {
        id,
        pieces: new Map(pieceIds.map((pid, i) => [pid, { x: i * 100, y: 0 }])),
        position: { x, y },
        rotation: 0,
    };
}

function make2x2State(): GameState {
    const pw = 100;
    const ph = 100;

    return makeGameState({
        pieces: [
            makeRectPiece({ id: 0, width: pw, height: ph, col: 0, row: 0 }),
            makeRectPiece({ id: 1, width: pw, height: ph, col: 1, row: 0 }),
            makeRectPiece({ id: 2, width: pw, height: ph, col: 0, row: 1 }),
            makeRectPiece({ id: 3, width: pw, height: ph, col: 1, row: 1 }),
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
    });
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

            expect(groupEl.style.transform).toBe('translate(50px, 50px) rotate(0deg)');
        });

        it('renders a group at non-zero degree rotation', () => {
            renderer.init(container);
            const state = make2x2State();
            state.groups[0] = { ...state.groups[0], rotation: 90 };

            renderer.renderState(state);

            const groupEl = container.querySelector(
                '[data-group-id="0"]',
            ) as HTMLElement;
            expect(groupEl).not.toBeNull();
            expect(groupEl.style.transform).toContain('rotate(90deg)');
            expect(groupEl.style.transform).not.toContain('rotate(8100deg)');
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
                rotation: 0,
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

        it('recreates piece SVGs when the image URL changes', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            // Grab a reference to the original SVG element for piece 0
            const originalSvg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;
            expect(originalSvg).not.toBeNull();

            const originalImage = originalSvg.querySelector('image')!;
            expect(originalImage.getAttributeNS(
                'http://www.w3.org/1999/xlink',
                'href',
            )).toBe('test-puzzle.jpg');

            // Render a new state with a different image URL
            const newState: GameState = {
                ...state,
                imageUrl: 'new-puzzle-image.jpg',
            };

            renderer.renderState(newState);

            // The SVG for piece 0 should be a new element
            const newSvg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;
            expect(newSvg).not.toBeNull();
            expect(newSvg).not.toBe(originalSvg);

            // And it should reference the new image
            const newImage = newSvg.querySelector('image')!;
            expect(newImage.getAttributeNS(
                'http://www.w3.org/1999/xlink',
                'href',
            )).toBe('new-puzzle-image.jpg');
        });

        it('keeps piece SVGs when re-rendering with the same image URL', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            const originalSvg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;

            // Re-render with same state (e.g. after a drag)
            renderer.renderState(state);

            const sameSvg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;

            // Should be the exact same DOM element (not recreated)
            expect(sameSvg).toBe(originalSvg);
        });

        it('cleans up old group elements when image URL changes', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);
            expect(
                container.querySelectorAll('[data-group-id]'),
            ).toHaveLength(4);

            // Render a new state with a different image and fewer groups
            const newState: GameState = {
                ...state,
                imageUrl: 'different.jpg',
                groups: [makeGroup(10, [0, 1], 0, 0)],
                pieces: [state.pieces[0], state.pieces[1]],
            };

            renderer.renderState(newState);

            // Old groups should be gone, only the new one remains
            expect(
                container.querySelectorAll('[data-group-id]'),
            ).toHaveLength(1);
            expect(
                container.querySelector('[data-group-id="10"]'),
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
            expect(groupEl.style.transform).toBe('translate(300px, 400px) rotate(0deg)');
        });

        it('does nothing if init was not called', () => {
            const state = make2x2State();

            // Should not throw
            renderer.renderState(state);
        });
    });

    describe('fill-rule for pieces with holes', () => {
        it('sets fill-rule=evenodd on clip-path, hit-area, and debug fill for a piece with nested subpaths', () => {
            renderer.init(container);

            // Create a piece with a hole: outer square M..Z and inner triangle M..Z
            // This creates two subpaths, which with evenodd fill-rule should produce a hole
            const pieceWithHole = {
                id: 0,
                edges: [],
                shape: 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 40 40 L 60 40 L 50 60 Z',
                imageOffset: { x: 0, y: 0 },
            };

            const state = makeGameState({
                pieces: [pieceWithHole],
                groups: [makeGroup(0, [0], 0, 0)],
                imageUrl: 'test.jpg',
                imageSize: { width: 200, height: 200 },
                gridSize: { cols: 2, rows: 2 },
            });

            renderer.renderState(state);

            const svg = container.querySelector('svg[data-piece-id="0"]') as SVGSVGElement;
            expect(svg).not.toBeNull();

            // Check clip-path has fill-rule=evenodd
            const clipPath = svg.querySelector('clipPath#clip-piece-0') as SVGClipPathElement;
            expect(clipPath).not.toBeNull();
            const clipPathPath = clipPath.querySelector('path') as SVGPathElement;
            expect(clipPathPath.getAttribute('fill-rule')).toBe('evenodd');

            // Check hit-area has fill-rule=evenodd
            const hitArea = svg.querySelector('[data-hit-area="true"]') as SVGPathElement;
            expect(hitArea).not.toBeNull();
            expect(hitArea.getAttribute('fill-rule')).toBe('evenodd');

            // Check debug fill has fill-rule=evenodd
            const debugFill = svg.querySelector('[data-piece-fill="true"]') as SVGPathElement;
            expect(debugFill).not.toBeNull();
            expect(debugFill.getAttribute('fill-rule')).toBe('evenodd');
        });

        it('sets fill-rule=evenodd on hit-area for a simple rectangular piece too', () => {
            renderer.init(container);
            const state = make2x2State();

            renderer.renderState(state);

            const svg = container.querySelector('svg[data-piece-id="0"]') as SVGSVGElement;
            const hitArea = svg.querySelector('[data-hit-area="true"]') as SVGPathElement;
            expect(hitArea.getAttribute('fill-rule')).toBe('evenodd');
        });
    });

    describe('expanded hit area', () => {
        it('creates an expanded hit-area path for each piece', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            for (const piece of state.pieces) {
                const svg = container.querySelector(
                    `svg[data-piece-id="${piece.id}"]`,
                ) as SVGSVGElement;

                const expandedHitArea = svg.querySelector(
                    '[data-hit-area-expanded]',
                ) as SVGPathElement;
                expect(
                    expandedHitArea,
                    `Piece ${piece.id} should have an expanded hit area`,
                ).not.toBeNull();

                // Should use the same shape as the piece
                expect(expandedHitArea.getAttribute('d')).toBe(piece.shape);

                // Should have a transparent stroke for the expansion
                expect(expandedHitArea.getAttribute('stroke')).toBe(
                    'rgba(0,0,0,0)',
                );
                expect(
                    Number(expandedHitArea.getAttribute('stroke-width')),
                ).toBeGreaterThan(0);

                // Should respond to stroke pointer events only
                expect(expandedHitArea.getAttribute('pointer-events')).toBe(
                    'stroke',
                );
            }
        });

        it('places expanded hit-area before exact hit-area in DOM order', () => {
            renderer.init(container);
            const state = make2x2State();
            renderer.renderState(state);

            const svg = container.querySelector(
                'svg[data-piece-id="0"]',
            ) as SVGSVGElement;

            const expanded = svg.querySelector(
                '[data-hit-area-expanded]',
            ) as SVGPathElement;
            const exact = svg.querySelector(
                '[data-hit-area]',
            ) as SVGPathElement;

            // Expanded should come before exact in DOM siblings
            const children = Array.from(svg.children);
            const expandedIndex = children.indexOf(expanded);
            const exactIndex = children.indexOf(exact);
            expect(expandedIndex).toBeLessThan(exactIndex);
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

    describe('pieceIdFromTarget', () => {
        it('returns the piece id when target is the SVG element itself', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            const svg = container.querySelector('svg[data-piece-id="0"]') as SVGSVGElement;
            expect(renderer.pieceIdFromTarget(svg)).toBe(0);
        });

        it('returns the piece id when target is a hit-area child of the SVG', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            const svg = container.querySelector('svg[data-piece-id="1"]') as SVGSVGElement;
            const hitArea = svg.querySelector('[data-hit-area="true"]') as SVGPathElement;
            expect(renderer.pieceIdFromTarget(hitArea)).toBe(1);
        });

        it('returns the piece id when target is an expanded-hit-area child', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            const svg = container.querySelector('svg[data-piece-id="2"]') as SVGSVGElement;
            const expandedHitArea = svg.querySelector('[data-hit-area-expanded="true"]') as SVGPathElement;
            expect(renderer.pieceIdFromTarget(expandedHitArea)).toBe(2);
        });

        it('returns null for an unrelated DOM node', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            const unrelated = document.createElement('div');
            expect(renderer.pieceIdFromTarget(unrelated)).toBeNull();
        });

        it('returns null for a null target', () => {
            renderer.init(container);
            renderer.renderState(make2x2State());

            expect(renderer.pieceIdFromTarget(null)).toBeNull();
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
