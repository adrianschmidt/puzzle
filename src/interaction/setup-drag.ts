/**
 * Wire up the DragController to a Renderer and the DOM container.
 *
 * This is the glue between the pure-logic DragController and the
 * browser APIs (pointer capture, DOM events). Separated from the
 * controller to keep it testable.
 */

import type { GameState, Point } from '../model/types.js';
import { moveGroup, findGroupForPiece } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';
import { AutoPanController } from './auto-pan.js';
import type { SelectionManager } from './selection-manager.js';
import { loadOffsetDragPreference } from '../ui/offset-drag.js';

export interface DragSetupOptions {
    /** The DOM container for the puzzle table (receives move/up events). */
    container: HTMLElement;
    /** The renderer to wire pointer events to. */
    renderer: Renderer;
    /** Returns the current game state (must be a live reference). */
    getState: () => GameState;
    /** Called after each state mutation to re-render. */
    onStateChanged: () => void;
    /** Called when a group is dropped (for merge detection). */
    onDrop: (groupId: number) => void;
    /**
     * Convert a screen-space delta to world-space.
     * Needed when a viewport transform (zoom) is active.
     */
    screenDeltaToWorld?: ScreenDeltaToWorld;
    /**
     * Pan the viewport by a screen-space delta.
     * Required for auto-pan when dragging to viewport edges.
     */
    panViewport?: (screenDelta: Point) => void;
    /**
     * Selection manager for multi-select tool.
     * When provided and the tool is active, clicking toggles selection
     * and dragging a selected piece moves all selected groups.
     */
    selectionManager?: SelectionManager;
}

/**
 * Find a group by its id in the game state.
 * Throws if the group is not found.
 */
function findGroup(groupId: number, state: GameState) {
    const group = state.groups.find((g) => g.id === groupId);

    if (!group) {
        throw new Error(`Group ${groupId} not found`);
    }

    return group;
}

/**
 * Set up drag handling for the puzzle.
 *
 * Returns a cleanup function that removes all event listeners.
 */
export function setupDragHandling(options: DragSetupOptions): () => void {
    const { container, renderer, getState, onStateChanged, onDrop, screenDeltaToWorld, panViewport, selectionManager } = options;

    const deltaToWorld = screenDeltaToWorld ?? ((d: Point) => d);

    // Auto-pan controller: pans viewport when dragging near edges
    const autoPan = panViewport
        ? new AutoPanController({
            panViewport,
            moveGroup(groupId: number, worldDelta: Point) {
                // Also compensate other selected groups during auto-pan
                if (selectionManager?.toolActive && selectionManager.isSelected(groupId)) {
                    for (const selectedId of selectionManager.selectedGroupIds) {
                        if (selectedId === groupId) continue;
                        const otherGroup = getState().groups.find(g => g.id === selectedId);
                        if (otherGroup) {
                            moveGroup(otherGroup, worldDelta);
                        }
                    }
                }
                const group = findGroup(groupId, getState());
                moveGroup(group, worldDelta);
            },
            screenDeltaToWorld: deltaToWorld,
            requestRender: onStateChanged,
            getViewportSize: () => ({
                width: window.visualViewport?.width ?? window.innerWidth,
                height: window.visualViewport?.height ?? window.innerHeight,
            }),
        })
        : null;

    const controller = new DragController(
        () => getState().groups,
        {
            moveGroup(groupId: number, delta: Point) {
                // If this group is part of a multi-selection, move all selected groups
                if (selectionManager?.toolActive && selectionManager.isSelected(groupId)) {
                    for (const selectedId of selectionManager.selectedGroupIds) {
                        if (selectedId === groupId) continue;
                        const otherGroup = getState().groups.find(g => g.id === selectedId);
                        if (otherGroup) {
                            moveGroup(otherGroup, delta);
                        }
                    }
                }
                // Always move the dragged group itself
                const group = findGroup(groupId, getState());
                moveGroup(group, delta);
            },
            bringToFront(groupId: number) {
                // Bring all selected groups to front when dragging one
                if (selectionManager?.toolActive && selectionManager.isSelected(groupId)) {
                    for (const selectedId of selectionManager.selectedGroupIds) {
                        if (selectedId === groupId) continue;
                        renderer.bringGroupToFront(selectedId);
                        renderer.setGroupDragging(selectedId, true);
                    }
                }
                renderer.bringGroupToFront(groupId);
                renderer.setGroupDragging(groupId, true);
            },
            onDrop(groupId: number) {
                autoPan?.stop();
                // Clear dragging visual from all selected groups
                if (selectionManager?.toolActive && selectionManager.isSelected(groupId)) {
                    for (const selectedId of selectionManager.selectedGroupIds) {
                        renderer.setGroupDragging(selectedId, false);
                    }
                }
                renderer.setGroupDragging(groupId, false);
                onDrop(groupId);
            },
            requestRender() {
                onStateChanged();
            },
        },
        undefined, // getViewportSize — use default
        screenDeltaToWorld,
    );

    // Track whether a pointerdown moved far enough to count as a drag
    // (vs a tap for selection toggle).
    let tapCandidate: { pieceId: number; x: number; y: number; pointerId: number } | null = null;
    const TAP_THRESHOLD_PX = 8;

    // Wire renderer's piece pointerdown to the controller.
    // The renderer calls this when any piece is clicked/touched.
    renderer.onPiecePointerDown((pieceId, event) => {
        if (selectionManager?.toolActive) {
            // In select mode: record this as a potential tap.
            // We still start the drag immediately (for smooth feel),
            // but if the pointer barely moves, we treat it as a tap
            // and toggle selection instead.
            tapCandidate = {
                pieceId,
                x: event.clientX,
                y: event.clientY,
                pointerId: event.pointerId,
            };
        }

        controller.handlePointerDown(pieceId, event);

        // Offset drag: shift single pieces upward so the finger doesn't
        // block the view. The offset is in screen pixels, converted to
        // world space so it stays consistent regardless of zoom level.
        const drag = controller.getActiveDrag();
        if (drag) {
            const group = findGroup(drag.groupId, getState());
            if (group.pieces.size === 1 && loadOffsetDragPreference()) {
                const OFFSET_SCREEN_PX = 50;
                const worldOffset = deltaToWorld({ x: 0, y: -OFFSET_SCREEN_PX });
                moveGroup(group, worldOffset);
                onStateChanged();
            }
        }

        // Start auto-pan tracking for this drag
        if (drag && autoPan) {
            autoPan.start(drag.groupId);
            autoPan.updatePointer({ x: event.clientX, y: event.clientY });
        }

        // Capture pointer on the container so we get move/up even
        // if the pointer leaves the piece element.
        container.setPointerCapture(event.pointerId);
    });

    // Attach move and up handlers to the container.
    const onPointerMove = (e: PointerEvent) => {
        // If we have a tap candidate, check if movement exceeds threshold
        if (tapCandidate && e.pointerId === tapCandidate.pointerId) {
            const dx = e.clientX - tapCandidate.x;
            const dy = e.clientY - tapCandidate.y;
            if (dx * dx + dy * dy > TAP_THRESHOLD_PX * TAP_THRESHOLD_PX) {
                // Moved too far — this is a drag, not a tap
                tapCandidate = null;
            }
        }

        controller.handlePointerMove(e);

        // Update auto-pan pointer position if dragging
        if (controller.getActiveDrag() && autoPan) {
            autoPan.updatePointer({ x: e.clientX, y: e.clientY });
        } else if (autoPan?.isActive()) {
            // Drag was cancelled (e.g. pinch-to-zoom) — stop auto-pan
            autoPan.stop();
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        // Check for tap-to-select before the controller clears drag state
        if (tapCandidate && e.pointerId === tapCandidate.pointerId && selectionManager?.toolActive) {
            // This was a tap, not a drag — toggle selection
            const group = findGroupForPiece(tapCandidate.pieceId, getState().groups);

            // Restore group to its pre-drag position (cancel the micro-drag)
            const drag = controller.getActiveDrag();
            if (drag) {
                const currentGroup = getState().groups.find(g => g.id === drag.groupId);
                if (currentGroup) {
                    const restoreDelta = {
                        x: drag.startPosition.x - currentGroup.position.x,
                        y: drag.startPosition.y - currentGroup.position.y,
                    };
                    moveGroup(currentGroup, restoreDelta);
                }
            }

            // Clear 'dragging' class from all groups that bringToFront marked
            // (this wasn't a real drag, so no group should look "lifted")
            for (const g of getState().groups) {
                renderer.setGroupDragging(g.id, false);
            }

            selectionManager.toggle(group.id);
            renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
            tapCandidate = null;

            // Still need to clean up the drag controller state
            controller.handlePointerUp(e);
            onStateChanged();

            if (container.hasPointerCapture(e.pointerId)) {
                container.releasePointerCapture(e.pointerId);
            }
            return;
        }

        tapCandidate = null;
        controller.handlePointerUp(e);

        // Stop auto-pan when drag ends
        if (!controller.getActiveDrag() && autoPan?.isActive()) {
            autoPan.stop();
        }

        if (container.hasPointerCapture(e.pointerId)) {
            container.releasePointerCapture(e.pointerId);
        }
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    // Return cleanup function
    return () => {
        autoPan?.stop();
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
    };
}
