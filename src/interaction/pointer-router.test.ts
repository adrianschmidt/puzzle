/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';

interface FakeWheelInit {
    deltaY?: number;
    clientX?: number;
    clientY?: number;
    target?: EventTarget | null;
}

function fakeWheelEvent(o: FakeWheelInit = {}): WheelEvent {
    return {
        deltaY: o.deltaY ?? 0,
        clientX: o.clientX ?? 0,
        clientY: o.clientY ?? 0,
        target: o.target ?? null,
        preventDefault: vi.fn(),
    } as unknown as WheelEvent;
}

interface RouterHarness {
    container: HTMLElement;
    classifyTarget: ReturnType<typeof vi.fn>;
    fire: (type: string, evt: Event) => void;
    callbacks: {
        onPieceTap: ReturnType<typeof vi.fn>;
        onPieceDrag: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onBackgroundPan: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
        onPinch: { start: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        onWheelZoom: ReturnType<typeof vi.fn>;
    };
    nowMock: ReturnType<typeof vi.fn>;
    router: PointerRouter;
}

function createHarness(opts: { classifyTarget?: ClassifyTarget } = {}): RouterHarness {
    const handlers: Record<string, Array<(e: Event) => void>> = {};
    const container = document.createElement('div');
    container.addEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        (handlers[type] ??= []).push(cb as (e: Event) => void);
    }) as typeof container.addEventListener;
    container.removeEventListener = vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        const arr = handlers[type] ?? [];
        const idx = arr.indexOf(cb as (e: Event) => void);
        if (idx >= 0) arr.splice(idx, 1);
    }) as typeof container.removeEventListener;
    container.setPointerCapture = vi.fn();
    container.hasPointerCapture = vi.fn(() => false);
    container.releasePointerCapture = vi.fn();

    const classifyTarget = vi.fn(opts.classifyTarget ?? ((_t) => ({ kind: 'ignore' as const })));

    const callbacks = {
        onPieceTap: vi.fn(),
        onPieceDrag: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onBackgroundPan: { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() },
        onPinch: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
        onWheelZoom: vi.fn(),
    };

    let nowValue = 0;
    const nowMock = vi.fn(() => nowValue);
    (nowMock as unknown as { advance: (ms: number) => void }).advance = (ms: number) => { nowValue += ms; };

    const router = new PointerRouter({
        container,
        classifyTarget,
        now: nowMock,
        ...callbacks,
    });

    return {
        container,
        classifyTarget,
        fire: (type, evt) => { for (const cb of handlers[type] ?? []) cb(evt); },
        callbacks,
        nowMock,
        router,
    };
}

describe('PointerRouter — construction & wheel', () => {
    it('attaches container listeners on construction', () => {
        const h = createHarness();
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), expect.objectContaining({ passive: false }));
    });

    it('removes listeners on destroy', () => {
        const h = createHarness();
        h.router.destroy();
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
        expect(h.container.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    });

    it('dispatches onWheelZoom for wheel events on a piece target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'piece', pieceId: 1 }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('dispatches onWheelZoom for wheel events on a background target and prevents default', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'background' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).toHaveBeenCalledWith(evt);
        expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('does NOT dispatch onWheelZoom or call preventDefault for ignore targets', () => {
        const h = createHarness({ classifyTarget: () => ({ kind: 'ignore' }) });
        const evt = fakeWheelEvent();
        h.fire('wheel', evt);
        expect(h.callbacks.onWheelZoom).not.toHaveBeenCalled();
        expect(evt.preventDefault).not.toHaveBeenCalled();
    });
});
