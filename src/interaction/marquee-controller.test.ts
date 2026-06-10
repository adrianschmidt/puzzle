/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    MarqueeController,
    groupScreenRect,
    type ScreenRect,
} from './marquee-controller.js';
import { SelectionManager } from './selection-manager.js';
import type { PieceGroup, Point } from '../model/types.js';
import { makeRectPiece, buildPiecesById } from '../test-helpers/fixtures.js';

function evt(clientX: number, clientY: number): PointerEvent {
    return { clientX, clientY } as PointerEvent;
}

function makeController(opts: {
    rects: ReadonlyArray<{ id: number; rect: ScreenRect }>;
    contain?: boolean;
    selection: SelectionManager;
    committed: () => void;
    container: HTMLElement;
}): MarqueeController {
    return new MarqueeController({
        container: opts.container,
        selectionManager: opts.selection,
        isContainMode: () => opts.contain ?? false,
        getGroupScreenRects: () => opts.rects,
        onSelectionCommitted: opts.committed,
    });
}

describe('MarqueeController', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('creates an overlay on start and removes it on end', () => {
        const selection = new SelectionManager();
        const c = makeController({ rects: [], selection, committed: vi.fn(), container });

        c.start(evt(10, 10));
        expect(container.querySelector('.marquee-box')).not.toBeNull();

        c.end(evt(20, 20));
        expect(container.querySelector('.marquee-box')).toBeNull();
    });

    it('removes the overlay on cancel without changing selection', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [{ id: 1, rect: { left: 0, top: 0, right: 10, bottom: 10 } }],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.move(evt(100, 100));
        c.cancel();

        expect(container.querySelector('.marquee-box')).toBeNull();
        expect(selection.hasSelection).toBe(false);
        expect(committed).not.toHaveBeenCalled();
    });

    it('intersect mode selects every group the box touches', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [
                { id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } },   // overlaps
                { id: 2, rect: { left: 500, top: 500, right: 510, bottom: 510 } }, // far away
            ],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20)); // box (0,0)-(20,20)

        expect([...selection.selectedGroupIds]).toEqual([1]);
        expect(committed).toHaveBeenCalledTimes(1);
    });

    it('contain mode selects only fully-enclosed groups', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const c = makeController({
            contain: true,
            rects: [
                { id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } },   // inside
                { id: 2, rect: { left: 15, top: 15, right: 25, bottom: 25 } }, // pokes out
            ],
            selection, committed: vi.fn(), container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20)); // box (0,0)-(20,20)

        expect([...selection.selectedGroupIds]).toEqual([1]);
    });

    it('is additive — keeps prior selection and adds matches', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        selection.select(9);
        const c = makeController({
            rects: [{ id: 1, rect: { left: 5, top: 5, right: 15, bottom: 15 } }],
            selection, committed: vi.fn(), container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20));

        expect([...selection.selectedGroupIds].sort()).toEqual([1, 9]);
    });

    it('does not commit when the box matches nothing new', () => {
        const selection = new SelectionManager();
        selection.toolActive = true;
        const committed = vi.fn();
        const c = makeController({
            rects: [{ id: 1, rect: { left: 500, top: 500, right: 510, bottom: 510 } }],
            selection, committed, container,
        });

        c.start(evt(0, 0));
        c.end(evt(20, 20));

        expect(selection.hasSelection).toBe(false);
        expect(committed).not.toHaveBeenCalled();
    });
});

describe('groupScreenRect', () => {
    const identity = (p: Point): Point => p;

    function makeGroup(id: number, x: number, y: number): PieceGroup {
        return { id, pieces: new Map([[1, { x: 0, y: 0 }]]), position: { x, y }, rotation: 0 };
    }

    it('projects a group\'s world bounds through worldToScreen', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(7, 10, 20);

        const rect = groupScreenRect(group, buildPiecesById([piece]), identity);

        expect(rect).not.toBeNull();
        expect(rect!.left).toBeCloseTo(10);
        expect(rect!.top).toBeCloseTo(20);
        expect(rect!.right).toBeCloseTo(110);
        expect(rect!.bottom).toBeCloseTo(60);
    });

    it('applies scale and offset from worldToScreen', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(7, 0, 0);
        const w2s = (p: Point): Point => ({ x: p.x * 2 + 5, y: p.y * 2 + 5 });

        const rect = groupScreenRect(group, buildPiecesById([piece]), w2s);

        expect(rect!.left).toBeCloseTo(5);
        expect(rect!.right).toBeCloseTo(205);
        expect(rect!.bottom).toBeCloseTo(85);
    });

    it('returns null for an empty group', () => {
        const group: PieceGroup = { id: 1, pieces: new Map(), position: { x: 0, y: 0 }, rotation: 0 };
        expect(groupScreenRect(group, buildPiecesById([]), identity)).toBeNull();
    });
});
