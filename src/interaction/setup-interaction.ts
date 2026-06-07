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
import { loadOffsetDragPreference } from '../ui/index.js';

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

    function applyOffsetDragIfSinglePiece(groupId: number): void {
        const group = tryGetGroup(getState(), groupId);
        if (!group || group.pieces.size !== 1) return;
        if (expandToSelection(groupId).length > 1) return;
        if (!loadOffsetDragPreference()) return;
        const offset = deltaToWorld({ x: 0, y: -OFFSET_DRAG_SCREEN_PX });
        moveGroup(group, offset);
        onStateChanged();
    }

    // Maps a screen point to the piece directly under it (null for
    // background), used by the near-miss probe below. Guarded for
    // environments without layout-based hit testing (e.g. jsdom), where the
    // probe simply degrades to the plain piece-vs-background classification.
    const pieceIdAt = (p: Point): number | null => {
        if (typeof document.elementFromPoint !== 'function') return null;
        return renderer.pieceIdFromTarget(document.elementFromPoint(p.x, p.y));
    };

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
            const nearby = probeNearbyPieceId(point, pieceIdAt);
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
                applyOffsetDragIfSinglePiece(drag.groupId);
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
                viewportController.handlePanStart(evt);
            },
            move: (evt) => viewportController.handlePanMove(evt),
            end: () => viewportController.handlePanEnd(),
            cancel: () => viewportController.handlePanEnd(),
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
