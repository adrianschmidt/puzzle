import './style.css';
import type { GameState, GridSize } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { setupDragHandling, ViewportTransform, ViewportController } from './interaction/index.js';
import {
    createNewGame,
    processDrop,
    checkAndMarkWin,
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupLocalBounds,
    getGroupVisualBounds,
} from './game/index.js';
import { loadState, clearSavedState, createDebouncedSave } from './persistence/index.js';
import {
    createNewGameButton,
    createCentreViewButton,
    createGatherPiecesButton,
    loadColourPreference,
    saveColourPreference,
    applyBackgroundColour,
    createBackgroundColourPicker,
    createInfoButton,
    createInfoModal,
} from './ui/index.js';
import { SelectionManager } from './interaction/selection-manager.js';
import { createSelectToolButton } from './ui/select-tool-button.js';
import { createDeselectButton } from './ui/deselect-button.js';
import { createRotateButtons } from './ui/rotate-buttons.js';
import { rotateGroup } from './game/rotate-group.js';
import { rotatePoint } from './model/helpers.js';
import { getActiveTolerance } from './ui/merge-tolerance.js';
import { reorderGroupsAfterDrop } from './game/pile-detection.js';
import { fetchRandomImage, getUnsplashAccessKey } from './images/index.js';
import { createAttributionElement, removeAttribution } from './ui/attribution.js';
import {
    loadSizePreference,
    saveSizePreference,
    getSizeOption,
    toGridSize,
} from './game/puzzle-sizes.js';
import {
    loadCutStylePreference,
    saveCutStylePreference,
    getCutStyleOption,
    loadComposableConfigPreference,
    saveComposableConfigPreference,
    loadFractalConfigPreference,
    saveFractalConfigPreference,
    loadImageSourcePreference,
    saveImageSourcePreference,
} from './game/cut-styles.js';
import type { CutStyle } from './game/cut-styles.js';
import {
    loadImageCategoryPreference,
    saveImageCategoryPreference,
    findImageCategory,
} from './game/image-categories.js';
import { createSizePickerDialog, type FractalDialogConfig } from './ui/size-picker.js';

/** Fallback image used when Unsplash is unavailable. */
const FALLBACK_IMAGE_URL = 'puzzle-image.jpg';
const FALLBACK_IMAGE_SIZE = { width: 800, height: 600 };

const app = document.querySelector<HTMLDivElement>('#app')!;

// Suppress the browser context menu on the puzzle container.
// On touch devices (especially iPad), long-pressing a piece would
// otherwise trigger the context menu, interfering with drag.
app.addEventListener('contextmenu', (e) => e.preventDefault());

// Display app version in bottom-right corner.
// Injected at build time by the deploy workflow via VITE_APP_VERSION.
const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
if (appVersion) {
    const versionEl = document.createElement('div');
    versionEl.className = 'app-version';
    versionEl.textContent = appVersion;
    app.appendChild(versionEl);
}

/**
 * Show a "Puzzle Complete!" overlay on top of the puzzle.
 * A simple centered message that fades in.
 * The overlay can be dismissed by clicking/tapping anywhere on it.
 */
function showCompletionOverlay(): void {
    // Guard against multiple overlays
    if (document.querySelector('.completion-overlay')) {
        return;
    }

    // Add a glow effect to the completed puzzle
    app.classList.add('completion-glow');

    const overlay = document.createElement('div');
    overlay.className = 'completion-overlay';
    overlay.innerHTML = `
        <div class="completion-message">
            <h1>🧩 Puzzle Complete!</h1>
            <p>Well done!</p>
            <p class="completion-dismiss-hint">Tap anywhere to dismiss</p>
        </div>
    `;

    // Add click handler to dismiss the overlay
    overlay.addEventListener('click', removeCompletionOverlay, { once: true });

    app.appendChild(overlay);
}

/**
 * Remove the completion overlay if it exists.
 */
function removeCompletionOverlay(): void {
    const overlay = document.querySelector('.completion-overlay');
    if (overlay) {
        overlay.remove();
    }

    app.classList.remove('completion-glow');
}

let gameState: GameState;
let cleanupDrag: (() => void) | null = null;

const renderer = new SvgDomRenderer();
renderer.init(app);

// Multi-select tool
const selectionManager = new SelectionManager();

// When selection changes, update group visuals
selectionManager.onChange((selectedIds) => {
    // Remove highlight from all groups, then re-apply to selected
    for (const group of gameState?.groups ?? []) {
        renderer.setGroupSelected(group.id, selectedIds.has(group.id));
    }
});

/**
 * Gather all groups into a compact layout and zoom the viewport to fit.
 * Reusable by the gather button, the solver, and new game initialization.
 */
function gatherAndZoomToFit(): void {
    const screenWidth = app.clientWidth || window.innerWidth;
    const screenHeight = app.clientHeight || window.innerHeight;
    const aspectRatio = screenWidth / screenHeight;

    const { positions, layoutBounds } = computeGatheredPositions(
        gameState.groups,
        aspectRatio,
        gameState.pieces,
    );

    applyGatheredPositions(gameState.groups, positions);

    const scaleX = screenWidth / layoutBounds.width;
    const scaleY = screenHeight / layoutBounds.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    const layoutCentreX = layoutBounds.x + layoutBounds.width / 2;
    const layoutCentreY = layoutBounds.y + layoutBounds.height / 2;

    viewportTransform.setState({
        scale,
        offset: {
            x: screenWidth / 2 - layoutCentreX * scale,
            y: screenHeight / 2 - layoutCentreY * scale,
        },
    });

    applyViewportTransform();
}

/**
 * Animate the viewport to centre and zoom-to-fit a single completed group.
 * Unlike gatherAndZoomToFit(), this doesn't move pieces — it just smoothly
 * animates the viewport to frame the completed puzzle nicely.
 *
 * @param completedGroup - The single group containing all pieces
 * @param onComplete - Callback to run after the animation finishes
 */
function zoomToFitCompletedPuzzle(
    completedGroup: import('./model/types.js').PieceGroup,
    onComplete: () => void
): void {
    const screenWidth = app.clientWidth || window.innerWidth;
    const screenHeight = app.clientHeight || window.innerHeight;

    // If the puzzle was completed at a non-zero rotation, rotate the group
    // back to 0° in parallel with the viewport zoom. Preserve the group's
    // visual bbox centre in world space so the animation stays smooth.
    let groupTransitionCleanup: (() => void) | null = null;
    if (completedGroup.rotation !== 0) {
        const localBounds = getGroupLocalBounds(completedGroup, gameState.pieces);
        const centreLocal = {
            x: localBounds.minX + localBounds.width / 2,
            y: localBounds.minY + localBounds.height / 2,
        };
        const rotatedCentre = rotatePoint(centreLocal, completedGroup.rotation);

        completedGroup.position = {
            x: completedGroup.position.x + rotatedCentre.x - centreLocal.x,
            y: completedGroup.position.y + rotatedCentre.y - centreLocal.y,
        };
        completedGroup.rotation = 0;

        const groupEl = app.querySelector(
            `[data-group-id="${completedGroup.id}"]`,
        ) as HTMLElement | null;
        if (groupEl) {
            groupEl.style.transition = 'transform 0.8s ease-in-out';
            groupTransitionCleanup = () => {
                groupEl.style.transition = '';
            };
        }

        renderer.renderState(gameState);
    }

    // Compute the visual bounds of the completed group in its current position
    const groupBounds = getGroupVisualBounds(completedGroup, gameState.pieces);

    // Convert to world-space bounds (group-local space + group position)
    const worldBounds = {
        x: completedGroup.position.x + groupBounds.minX,
        y: completedGroup.position.y + groupBounds.minY,
        width: groupBounds.width,
        height: groupBounds.height,
    };

    // Calculate target scale to fit the completed puzzle with padding
    const scaleX = screenWidth / worldBounds.width;
    const scaleY = screenHeight / worldBounds.height;
    const targetScale = Math.min(scaleX, scaleY) * 0.9; // 10% padding like gatherAndZoomToFit

    // Calculate target offset to centre the completed puzzle
    const worldCentreX = worldBounds.x + worldBounds.width / 2;
    const worldCentreY = worldBounds.y + worldBounds.height / 2;
    const targetOffset = {
        x: screenWidth / 2 - worldCentreX * targetScale,
        y: screenHeight / 2 - worldCentreY * targetScale,
    };

    // Enable transition before applying the new transform
    renderer.enableViewportTransition();

    // Apply the target transform on next frame to ensure transition is set
    requestAnimationFrame(() => {
        viewportTransform.setState({
            scale: targetScale,
            offset: targetOffset,
        });

        applyViewportTransform();

        // Listen for the transition to complete
        const tableEl = app.querySelector('[data-puzzle-table]') as HTMLElement;
        if (tableEl) {
            const handleTransitionEnd = (event: TransitionEvent) => {
                // Make sure it's the transform property and not some other transition
                if (event.propertyName === 'transform' && event.target === tableEl) {
                    tableEl.removeEventListener('transitionend', handleTransitionEnd);
                    renderer.disableViewportTransition();
                    groupTransitionCleanup?.();
                    onComplete();
                }
            };
            tableEl.addEventListener('transitionend', handleTransitionEnd);
        } else {
            // Fallback: disable transition and run callback after expected duration
            setTimeout(() => {
                renderer.disableViewportTransition();
                groupTransitionCleanup?.();
                onComplete();
            }, 800);
        }
    });
}

// Debug helper: solve the puzzle by placing all pieces in their correct positions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__solvePuzzle = () => {
    if (!gameState) return;

    const solvedGroup: import('./model/types.js').PieceGroup = {
        id: 0,
        pieces: new Map(),
        position: { x: 0, y: 0 },
        rotation: 0,
    };

    for (const piece of gameState.pieces) {
        solvedGroup.pieces.set(piece.id, {
            x: -piece.imageOffset.x,
            y: -piece.imageOffset.y,
        });
    }

    gameState.groups = [solvedGroup];
    gameState.completed = true;
    renderer.renderState(gameState);

    // Use the same animated zoom as normal completion
    zoomToFitCompletedPuzzle(solvedGroup, () => {
        showCompletionOverlay();
    });
};

// Viewport transform for zoom & pan
const viewportTransform = new ViewportTransform();

/**
 * Apply the current viewport transform to the renderer.
 */
function applyViewportTransform(): void {
    const state = viewportTransform.getState();
    renderer.setViewportTransform(state.scale, state.offset.x, state.offset.y);
}

/**
 * Check if an event target is a puzzle piece hit-area element
 * (either exact or expanded).
 */
function isPieceElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) {
        return false;
    }

    const dataset = (target as HTMLElement).dataset;

    // Piece hit-areas have data-hit-area="true" or data-hit-area-expanded="true"
    if (dataset?.hitArea === 'true' || dataset?.hitAreaExpanded === 'true') {
        return true;
    }

    // Also check parent SVG (clicking the image clipped to the piece)
    const svg = target.closest('svg[data-piece-id]');

    return svg !== null;
}

// Set up viewport controller (zoom & pan).
// The constructor registers event listeners on the container.
// The controller lives for the app lifetime — no cleanup needed.
void new ViewportController({
    container: app,
    transform: viewportTransform,
    onViewportChanged: applyViewportTransform,
    isPieceElement,
});

const debouncedSave = createDebouncedSave();

/**
 * Trigger a debounced auto-save of the current game state.
 */
function autoSave(): void {
    debouncedSave.save(gameState);
}

/**
 * Update the attribution display based on the current game state.
 */
function updateAttribution(): void {
    removeAttribution(app);

    if (gameState.attribution) {
        const el = createAttributionElement(gameState.attribution);
        app.appendChild(el);
    }
}

/**
 * Set up the game with a given state: render it and wire up interaction.
 */
function initGame(state: GameState): void {
    removeCompletionOverlay();
    selectionManager.clearAll();

    if (cleanupDrag) {
        cleanupDrag();
        cleanupDrag = null;
    }

    gameState = state;
    renderer.renderState(gameState);
    updateAttribution();
    updateRotateButtonsVisibility();

    if (gameState.completed) {
        showCompletionOverlay();
    }

    cleanupDrag = setupDragHandling({
        container: app,
        renderer,
        getState: () => gameState,
        onStateChanged: () => {
            renderer.renderState(gameState);
            // Re-apply selection visuals after re-render (renderState may recreate elements)
            if (selectionManager.hasSelection) {
                for (const selectedId of selectionManager.selectedGroupIds) {
                    renderer.setGroupSelected(selectedId, true);
                }
            }
            autoSave();
        },
        onDrop: (groupId: number) => {
            const tolerance = getActiveTolerance(
                gameState.imageSize.width,
                gameState.gridSize.cols,
                gameState.cutStyle,
            );

            // Determine all groups involved in this drop operation
            // (primary dragged group + any selected groups in multi-select mode)
            const droppedGroupIds = [groupId];
            if (selectionManager.toolActive && selectionManager.isSelected(groupId)) {
                // Add all other selected groups
                for (const selectedId of selectionManager.selectedGroupIds) {
                    if (selectedId !== groupId) {
                        droppedGroupIds.push(selectedId);
                    }
                }
            }

            const result = processDrop(groupId, gameState, tolerance);
            if (result) {
                // Prune stale group IDs from selection (absorbed groups no longer exist).
                // The surviving group inherits selection if any merged group was selected.
                const validIds = new Set(gameState.groups.map(g => g.id));
                const hadSelectedAbsorbed = [...selectionManager.selectedGroupIds]
                    .some(id => !validIds.has(id));
                selectionManager.pruneStale(validIds);
                if (hadSelectedAbsorbed) {
                    selectionManager.select(result.group.id);
                }

                renderer.renderState(gameState);
                renderer.flashMergePulse(result.group.id);
                // Re-apply selection visuals after re-render
                for (const selectedId of selectionManager.selectedGroupIds) {
                    renderer.setGroupSelected(selectedId, true);
                }

                // Update the dropped groups list to use the merged result group
                const finalDroppedGroupIds = droppedGroupIds.map(id => {
                    // If this group was absorbed into the merged result, use the result group
                    if (!gameState.groups.some(g => g.id === id)) {
                        return result.group.id;
                    }
                    return id;
                });

                // Remove duplicates
                const uniqueDroppedGroupIds = [...new Set(finalDroppedGroupIds)];

                // Apply z-reorder after merge
                reorderGroupsAfterDrop(uniqueDroppedGroupIds, gameState, (gId) => renderer.bringGroupToFront(gId));

                autoSave();

                if (checkAndMarkWin(gameState)) {
                    // Animate zoom to fit the completed puzzle, then show overlay
                    if (gameState.groups.length === 1) {
                        zoomToFitCompletedPuzzle(gameState.groups[0], () => {
                            showCompletionOverlay();
                        });
                    } else {
                        // Fallback: show overlay immediately if multiple groups (shouldn't happen)
                        showCompletionOverlay();
                    }
                    autoSave();
                }
            } else {
                // No merge occurred, apply z-reorder to the original dropped groups
                reorderGroupsAfterDrop(droppedGroupIds, gameState, (gId) => renderer.bringGroupToFront(gId));
            }
        },
        screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
        panViewport: (screenDelta) => {
            viewportTransform.pan(screenDelta);
            applyViewportTransform();
        },
        selectionManager,
    });
}

/**
 * Start a new game, fetching a random Unsplash image if available.
 * Falls back to the default image if the API key is missing or fetch fails.
 *
 * @param gridSize - Grid dimensions (cols × rows) for the puzzle
 * @param cutStyle - Cut style to use for piece generation
 */
async function startNewGame(
    gridSize: GridSize,
    cutStyle: CutStyle = 'classic',
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig,
    imageSource?: string,
    imageCategory?: string,
    fractalConfig?: FractalDialogConfig,
): Promise<void> {
    // Reset viewport transform so pieces are randomized in unzoomed coordinates
    viewportTransform.reset();
    applyViewportTransform();

    const viewport = {
        width: app.clientWidth || window.innerWidth,
        height: app.clientHeight || window.innerHeight,
    };

    let imageUrl = FALLBACK_IMAGE_URL;
    let imageSize = FALLBACK_IMAGE_SIZE;
    let attribution: GameState['attribution'];

    // Blank puzzle: white image, no photo
    if (imageSource === 'blank') {
        // Create a white 1080×720 image via canvas data URL
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 720;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1080, 720);
        imageUrl = canvas.toDataURL('image/png');
        imageSize = { width: 1080, height: 720 };
    }

    // Try to fetch a random Unsplash image (unless blank was selected)
    const accessKey = imageSource !== 'blank' ? getUnsplashAccessKey() : null;

    if (accessKey) {
        try {
            const category = findImageCategory(imageCategory ?? 'any');
            const result = await fetchRandomImage(
                accessKey,
                fetch,
                category.query,
            );

            if (result) {
                imageUrl = result.imageUrl;
                attribution = {
                    photographerName: result.photographerName,
                    photographerUrl: result.photographerUrl,
                    photoUrl: result.photoUrl,
                };

                // The Unsplash "regular" URL delivers images scaled to 1080px
                // wide. Compute the height from the original aspect ratio so
                // the puzzle generator produces correctly proportioned pieces.
                const aspectRatio = result.height / result.width;
                const displayWidth = 1080;
                imageSize = {
                    width: displayWidth,
                    height: Math.round(displayWidth * aspectRatio),
                };
            }
        } catch (error) {
            console.warn('Failed to fetch Unsplash image, using fallback:', error);
        }
    }

    const rotationMode: 'none' | 'quarter-turn' =
        cutStyle === 'fractal' && fractalConfig?.rotationEnabled
            ? 'quarter-turn'
            : 'none';

    const generatorFractalConfig = fractalConfig
        ? { borderless: fractalConfig.borderless }
        : undefined;

    const state = createNewGame(imageUrl, imageSize, viewport, gridSize, {
        cutStyle,
        composableConfig,
        fractalConfig: generatorFractalConfig,
        rotationMode,
    });

    if (attribution) {
        state.attribution = attribution;
    }

    initGame(state);
    gatherAndZoomToFit();
    renderer.renderState(gameState);
    autoSave();
}

// Set up the New Game button
createNewGameButton({
    container: app,
    isCompleted: () => gameState.completed,
    getGroupCount: () => gameState.groups.length,
    getPieceCount: () => gameState.pieces.length,
    onNewGame: () => {
        const preferredIndex = loadSizePreference();
        const preferredCutStyleIndex = loadCutStylePreference();
        const savedComposableConfig = loadComposableConfigPreference();
        const savedFractalConfig = loadFractalConfigPreference();
        const savedImageSource = loadImageSourcePreference();
        const savedImageCategory = loadImageCategoryPreference();
        createSizePickerDialog({
            container: app,
            selectedIndex: preferredIndex,
            selectedCutStyleIndex: preferredCutStyleIndex,
            savedComposableConfig: savedComposableConfig,
            savedFractalConfig: savedFractalConfig,
            savedImageSource: savedImageSource,
            savedImageCategory: savedImageCategory,
            onSelect: (index, cutStyleIndex, composableConfig, imageSource, imageCategory, fractalConfig) => {
                saveSizePreference(index);
                const resolvedCutStyleIndex = cutStyleIndex ?? preferredCutStyleIndex;
                saveCutStylePreference(resolvedCutStyleIndex);
                if (composableConfig) {
                    saveComposableConfigPreference(composableConfig);
                }
                if (fractalConfig) {
                    saveFractalConfigPreference(fractalConfig);
                }
                if (imageSource) {
                    saveImageSourcePreference(imageSource);
                }
                if (imageCategory) {
                    saveImageCategoryPreference(imageCategory);
                }
                const option = getSizeOption(index);
                const cutStyle = getCutStyleOption(resolvedCutStyleIndex).id;
                clearSavedState();
                void startNewGame(
                    toGridSize(option),
                    cutStyle,
                    composableConfig,
                    imageSource,
                    imageCategory,
                    fractalConfig,
                );
            },
        });
    },
});

// Set up the Centre View button
createCentreViewButton({
    container: app,
    onCentreView: () => {
        viewportTransform.reset();
        applyViewportTransform();
    },
});

// Set up the Gather Pieces button
createGatherPiecesButton({
    container: app,
    onGatherPieces: () => {
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();
    },
});

// Set up the multi-select tool button (top-left)
createSelectToolButton({
    container: app,
    selectionManager,
});

// Set up the deselect-all button (bottom-center, hidden until selection exists)
createDeselectButton({
    container: app,
    selectionManager,
});

// Set up the rotate buttons (bottom-left, fractal-only).
// Visibility is updated whenever initGame() runs.
const rotateButtons = createRotateButtons({
    container: app,
    selectionManager,
    onRotate: (direction) => {
        if (!gameState || !selectionManager.hasSelection) return;

        for (const groupId of selectionManager.selectedGroupIds) {
            const group = gameState.groups.find(g => g.id === groupId);
            if (group) {
                rotateGroup(group, gameState.pieces, direction);
            }
        }

        renderer.renderState(gameState);
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        autoSave();
    },
});

function updateRotateButtonsVisibility(): void {
    if (gameState?.rotationMode === 'quarter-turn') {
        rotateButtons.show();
    } else {
        rotateButtons.hide();
    }
}

// Set up the Background Colour picker
const initialColourIndex = loadColourPreference();
applyBackgroundColour(initialColourIndex);

createBackgroundColourPicker({
    container: app,
    selectedIndex: initialColourIndex,
    onSelect: (index) => {
        saveColourPreference(index);
        applyBackgroundColour(index);
    },
});

// Set up the Info button
createInfoButton({
    container: app,
    onShowInfo: () => {
        createInfoModal({
            container: app,
            onSolve: () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__solvePuzzle?.();
            },
        });
    },
});

// On load: try to restore a saved game, otherwise start fresh
const savedState = loadState();

if (savedState) {
    initGame(savedState);
} else {
    // First load with no saved game: use the preferred size and cut style
    const preferredIndex = loadSizePreference();
    const option = getSizeOption(preferredIndex);
    const preferredCutStyle = getCutStyleOption(loadCutStylePreference()).id;
    const preferredFractalConfig = loadFractalConfigPreference();
    void startNewGame(
        toGridSize(option),
        preferredCutStyle,
        undefined,
        undefined,
        undefined,
        preferredFractalConfig,
    );
}
