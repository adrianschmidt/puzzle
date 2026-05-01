/**
 * Wire PointerRouter + DragController + ViewportController + AutoPanController
 * into the running app.
 *
 * Replaces setup-drag.ts. The router owns container listeners; this file
 * builds the four collaborators and connects them via the router's hooks.
 */

import type { GameState, Point } from '../model/types.js';
import { moveGroup, findGroupForPiece } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';
import { ViewportController } from './viewport-controller.js';
import type { ViewportTransform } from './viewport-transform.js';
import { AutoPanController } from './auto-pan.js';
import { PointerRouter } from './pointer-router.js';
import type { ClassifyTarget } from './pointer-router.js';
import type { SelectionManager } from './selection-manager.js';
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
}

const OFFSET_DRAG_SCREEN_PX = 50;

export function setupInteraction(options: InteractionSetupOptions): () => void {
    const {
        container, renderer, viewportTransform, getState, onStateChanged,
        onDrop, onViewportChanged, screenDeltaToWorld, panViewport, selectionManager,
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
                    const group = getState().groups.find(g => g.id === id);
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
        () => getState().groups,
        {
            moveGroup(groupId, delta) {
                for (const id of expandToSelection(groupId)) {
                    const group = getState().groups.find(g => g.id === id);
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
        const group = getState().groups.find(g => g.id === groupId);
        if (!group || group.pieces.size !== 1) return;
        if (!loadOffsetDragPreference()) return;
        const offset = deltaToWorld({ x: 0, y: -OFFSET_DRAG_SCREEN_PX });
        moveGroup(group, offset);
        onStateChanged();
    }

    const classifyTarget: ClassifyTarget = (target) => {
        const pieceId = renderer.pieceIdFromTarget(target);
        if (pieceId !== null) return { kind: 'piece', pieceId };
        if (target === container) return { kind: 'background' };
        if (target instanceof HTMLElement && target.dataset.puzzleTable === 'true') {
            return { kind: 'background' };
        }
        return { kind: 'ignore' };
    };

    const router = new PointerRouter({
        container,
        classifyTarget,

        onPieceTap: (pieceId, _evt) => {
            if (!selectionManager?.toolActive) return;
            const group = findGroupForPiece(pieceId, getState().groups);
            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            onStateChanged();
        },

        onPieceDrag: {
            start: (pieceId, evt) => {
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
            start: (evt) => viewportController.handlePanStart(evt),
            move: (evt) => viewportController.handlePanMove(evt),
            end: () => viewportController.handlePanEnd(),
            cancel: () => viewportController.handlePanEnd(),
        },

        onPinch: {
            start: (a, b) => viewportController.handlePinchStart(a, b),
            move: (a, b) => viewportController.handlePinchMove(a, b),
            end: () => viewportController.handlePinchEnd(),
        },

        onWheelZoom: (evt) => viewportController.handleWheel(evt),
    });

    return () => {
        autoPan?.stop();
        router.destroy();
    };
}
