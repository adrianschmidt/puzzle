/**
 * Wire PointerRouter + DragController + ViewportController + AutoPanController
 * into the running app.
 *
 * Replaces setup-drag.ts. The router owns container listeners; this file
 * builds the four collaborators and connects them via the router's hooks.
 */

import type { GameState, Point } from '../model/types.js';
import { getGroupForPiece, moveGroup, tryGetGroup } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';
import { ViewportController } from './viewport-controller.js';
import type { ViewportTransform } from './viewport-transform.js';
import { AutoPanController } from './auto-pan.js';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';
import { probeNearbyPieceId } from './hit-probe.js';
import type { SelectionManager } from './selection-manager.js';
import type { RotationFocus } from './rotation-focus.js';
import { MarqueeController, groupScreenRect } from './marquee-controller.js';
import type { ScreenRect } from './marquee-controller.js';
import { loadOffsetDragPreference, loadMarqueeContainPreference } from '../ui/index.js';

export interface InteractionSetupOptions {
    container: HTMLElement;
    renderer: Renderer;
    viewportTransform: ViewportTransform;
    getState: () => GameState;
    onStateChanged: () => void;
    onDrop: (groupId: number) => void;
    onViewportChanged: () => void;
    screenDeltaToWorld?: ScreenDeltaToWorld;
    panViewport?: (screenDelta: Point) => void;
    selectionManager?: SelectionManager;
    rotationFocus?: RotationFocus;
}

const OFFSET_DRAG_SCREEN_PX = 50;

export function setupInteraction(options: InteractionSetupOptions): () => void {
    const {
        container, renderer, viewportTransform, getState, onStateChanged,
        onDrop, onViewportChanged, screenDeltaToWorld, panViewport, selectionManager,
        rotationFocus,
    } = options;

    const deltaToWorld = screenDeltaToWorld ?? ((d: Point) => d);

    const expandToSelection = (groupId: number): readonly number[] =>
        selectionManager?.expandToSelectionIfActive(groupId) ?? [groupId];

    const viewportController = new ViewportController(viewportTransform, onViewportChanged);

    const autoPan = panViewport
        ? new AutoPanController({
            panViewport,
            moveGroup(groupId, worldDelta) {
                for (const id of expandToSelection(groupId)) {
                    const group = tryGetGroup(getState(), id);
                    if (group) moveGroup(group, worldDelta);
                }
            },
            screenDeltaToWorld: deltaToWorld,
            requestRender: onStateChanged,
            getViewportSize: () => ({
                width: window.visualViewport?.width ?? window.innerWidth,
                height: window.visualViewport?.height ?? window.innerHeight,
            }),
        })
        : null;

    const dragController = new DragController(
        {
            getGroupForPiece: (pieceId) => getGroupForPiece(getState(), pieceId),
            getGroupById: (id) => tryGetGroup(getState(), id),
        },
        {
            moveGroup(groupId, delta) {
                for (const id of expandToSelection(groupId)) {
                    const group = tryGetGroup(getState(), id);
                    if (group) moveGroup(group, delta);
                }
            },
            bringToFront(groupId) {
                const ids = expandToSelection(groupId);
                for (let i = ids.length - 1; i >= 0; i--) {
                    renderer.bringGroupToFront(ids[i]);
                    renderer.setGroupDragging(ids[i], true);
                }
            },
            requestRender: onStateChanged,
        },
        undefined,
        screenDeltaToWorld,
    );

    const marquee = selectionManager
        ? new MarqueeController({
            container,
            selectionManager,
            isContainMode: () => loadMarqueeContainPreference(),
            getGroupScreenRects: () => {
                const state = getState();
                const rects: Array<{ id: number; rect: ScreenRect }> = [];
                for (const group of state.groups) {
                    const rect = groupScreenRect(
                        group,
                        state.piecesById,
                        (p) => viewportTransform.worldToScreen(p),
                    );
                    if (rect) rects.push({ id: group.id, rect });
                }
                return rects;
            },
            onSelectionCommitted: onStateChanged,
        })
        : null;

    // Whether the in-progress background drag is a viewport pan or a marquee.
    // Decided once at drag start and held until the gesture resolves.
    let backgroundMode: 'pan' | 'marquee' = 'pan';

    function applyOffsetDragIfSingleGroup(groupId: number): void {
        const group = tryGetGroup(getState(), groupId);
        if (!group) return;
        if (expandToSelection(groupId).length > 1) return;
        if (!loadOffsetDragPreference()) return;
        const offset = deltaToWorld({ x: 0, y: -OFFSET_DRAG_SCREEN_PX });
        moveGroup(group, offset);
        onStateChanged();
    }

    // The renderer owns the point→piece hit-test; the probe samples around a
    // press with it. Defined once rather than per pointerdown.
    const probeHitTest = (p: Point): number | null => renderer.pieceIdAtPoint(p);

    const classifyTarget: ClassifyTarget = (target, point) => {
        const pieceId = renderer.pieceIdFromTarget(target);
        if (pieceId !== null) return { kind: 'piece', pieceId };

        const isBackground = target === container ||
            (target instanceof HTMLElement && target.dataset.puzzleTable === 'true');
        if (!isBackground) return { kind: 'ignore' };

        // Direct hit was background — widen the grab to a nearby piece so
        // small/slim pieces stay grabbable when zoomed out (screen-constant
        // tolerance; see hit-probe.ts). Only on events that carry a point.
        if (point) {
            const nearby = probeNearbyPieceId(point, probeHitTest);
            if (nearby !== null) return { kind: 'piece', pieceId: nearby };
        }

        return { kind: 'background' };
    };

    const router = new PointerRouter({
        container,
        classifyTarget,

        onPieceTap: (pieceId, _evt) => {
            const group = getGroupForPiece(getState(), pieceId);
            rotationFocus?.setFocus(group.id);
            if (!selectionManager?.toolActive) return;
            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            onStateChanged();
        },

        onPieceDrag: {
            start: (pieceId, evt) => {
                rotationFocus?.clearFocus();
                dragController.handlePointerDown(pieceId, evt);
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                applyOffsetDragIfSingleGroup(drag.groupId);
                autoPan?.start(drag.groupId);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
            move: (evt) => {
                dragController.handlePointerMove(evt);
                autoPan?.updatePointer({ x: evt.clientX, y: evt.clientY });
            },
            end: (evt) => {
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                const groupId = drag.groupId;
                dragController.handlePointerUp(evt);
                autoPan?.stop();
                for (const id of expandToSelection(groupId)) renderer.setGroupDragging(id, false);
                onDrop(groupId);
            },
            cancel: () => {
                const drag = dragController.getActiveDrag();
                if (!drag) return;
                const groupId = drag.groupId;
                dragController.cancel();
                autoPan?.stop();
                for (const id of expandToSelection(groupId)) renderer.setGroupDragging(id, false);
            },
        },

        onBackgroundPan: {
            start: (evt) => {
                rotationFocus?.clearFocus();
                // `start` fires from the move that crosses the drag threshold,
                // so `evt.shiftKey` reflects Shift state at that moment — a
                // press-then-hold-Shift still arms the marquee, which is fine.
                // This is the authoritative Shift read; the marquee button's
                // cosmetic `shiftHint` observes the key separately and may
                // briefly disagree without affecting the gesture.
                const wantMarquee =
                    !!marquee && !!selectionManager &&
                    (selectionManager.marqueeActive || evt.shiftKey);
                if (wantMarquee) {
                    backgroundMode = 'marquee';
                    // A marquee builds a multi-select selection, so the tool
                    // must be on. `marqueeActive` already implies it; the Shift
                    // shortcut may not, so enable it here (Shift+drag leaves
                    // multi-select on afterward, but does not arm the marquee).
                    if (!selectionManager.toolActive) {
                        selectionManager.toolActive = true;
                    }
                    marquee.start(evt);
                } else {
                    backgroundMode = 'pan';
                    viewportController.handlePanStart(evt);
                }
            },
            move: (evt) => {
                if (backgroundMode === 'marquee') marquee?.move(evt);
                else viewportController.handlePanMove(evt);
            },
            end: (evt) => {
                if (backgroundMode === 'marquee') marquee?.end(evt);
                else viewportController.handlePanEnd();
            },
            cancel: () => {
                if (backgroundMode === 'marquee') marquee?.cancel();
                else viewportController.handlePanEnd();
            },
        },

        onPinch: {
            start: (a, b) => {
                rotationFocus?.clearFocus();
                viewportController.handlePinchStart(a, b);
            },
            move: (a, b) => viewportController.handlePinchMove(a, b),
            end: () => viewportController.handlePinchEnd(),
        },

        onWheelZoom: (evt) => {
            rotationFocus?.clearFocus();
            viewportController.handleWheel(evt);
        },

        onBackgroundTap: () => {
            rotationFocus?.clearFocus();
        },
    });

    return () => {
        autoPan?.stop();
        router.destroy();
    };
}
