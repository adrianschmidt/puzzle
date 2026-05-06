import './style.css';
import { diagnostics } from './diagnostics.js';
import type { GameState, GridSize } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { setupInteraction, ViewportTransform, RotationFocus } from './interaction/index.js';
import {
    createNewGame,
    processDrop,
    checkAndMarkWin,
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupLocalBounds,
    getGroupVisualBounds,
    type MergeResult,
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
    createSelectToolButton,
    createDeselectButton,
    createRotateButtons,
    createRotateHandle,
    getActiveTolerance,
    createAttributionElement,
    removeAttribution,
    createNewGameDialog,
    showCompletionOverlay as renderCompletionOverlay,
    showToast,
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
    type FractalDialogConfig,
} from './ui/index.js';
import { SelectionManager } from './interaction/selection-manager.js';
import { rotateGroup } from './game/rotate-group.js';
import { buildGroupIndexes, rotatePoint, localToWorld } from './model/helpers.js';
import { reorderGroupsAfterDrop } from './game/z-order.js';
import { fetchRandomImage, getUnsplashAccessKey } from './images/index.js';
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
} from './game/cut-styles.js';
import type { CutStyle } from './game/cut-styles.js';
import {
    loadComposableConfigPreference,
    saveComposableConfigPreference,
} from './game/composable-config.js';
import {
    loadFractalConfigPreference,
    saveFractalConfigPreference,
} from './game/fractal-config.js';
import {
    loadImageSourcePreference,
    saveImageSourcePreference,
} from './game/image-source.js';
import {
    loadImageCategoryPreference,
    saveImageCategoryPreference,
    findImageCategory,
    loadVibrantPreference,
    saveVibrantPreference,
    buildImageQuery,
} from './game/image-categories.js';
import {
    parseLocationHash,
    type SharePayload,
} from './sharing/index.js';
import { applyProgress } from './game/reconstruct-groups.js';
import { initAnalytics, track } from './analytics/index.js';
import type { NewGameData, PuzzleCompletedData } from './analytics/index.js';

/** Fallback image used when Unsplash is unavailable. */
const FALLBACK_IMAGE_URL = 'puzzle-image.jpg';
const FALLBACK_IMAGE_SIZE = { width: 800, height: 600 };

const app = document.querySelector<HTMLDivElement>('#app')!;

// Suppress the browser context menu on the puzzle container.
// On touch devices (especially iPad), long-pressing a piece would
// otherwise trigger the context menu, interfering with drag.
app.addEventListener('contextmenu', (e) => e.preventDefault());

initAnalytics();

// Display app version in bottom-right corner.
// Injected at build time by the deploy workflow via VITE_APP_VERSION.
const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
if (appVersion) {
    const versionEl = document.createElement('div');
    versionEl.className = 'app-version';
    versionEl.textContent = appVersion;
    app.appendChild(versionEl);
}

let currentCompletionHide: (() => void) | null = null;

function showCompletionOverlay(): void {
    if (currentCompletionHide) return;
    // Clear focus so any visible rotate buttons quick-fade out before the
    // celebratory zoom; without this the buttons would linger in front
    // of (or under) the completion overlay during the animation.
    rotationFocus.clearFocus();
    currentCompletionHide = renderCompletionOverlay({
        container: app,
        state: gameState,
        onDismiss: () => {
            currentCompletionHide = null;
        },
    });
}

function removeCompletionOverlay(): void {
    currentCompletionHide?.();
    currentCompletionHide = null;
}

/**
 * Analytics metadata for the currently-playing puzzle.
 *
 * Populated when a puzzle starts (fresh or shared). Stays null when
 * the user resumes a previous session from localStorage — in that
 * case `puzzle-completed` falls back to deriving fields from
 * gameState alone.
 */
let currentGameAnalytics: NewGameData | null = null;

/**
 * Heuristically classify a puzzle image URL into one of the three
 * sources we care about for analytics. Used when the puzzle origin
 * (a share payload, or a resumed save) only carries the URL — not
 * the choice that produced it.
 */
function classifyImageSource(imageUrl: string): 'unsplash' | 'blank' | 'fallback' {
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
    try {
        const host = new URL(imageUrl, window.location.href).host;
        if (host === 'images.unsplash.com') {
            return 'unsplash';
        }
    } catch {
        // Fall through to 'fallback' on malformed URLs.
    }
    return 'fallback';
}

/**
 * Build the analytics payload for a puzzle completion.
 *
 * Always derives geometry/style fields from gameState (so resumed
 * games still get a useful event), then merges in any cached
 * NewGameData fields the user wouldn't be able to recover otherwise
 * (source, imageCategory, vibrant, etc.).
 */
function buildPuzzleCompletedData(state: GameState): PuzzleCompletedData {
    const derived: PuzzleCompletedData = {
        cutStyle: state.cutStyle ?? 'classic',
        rotationMode: state.rotationMode ?? 'none',
        cols: state.gridSize.cols,
        rows: state.gridSize.rows,
        pieceCount: state.pieces.length,
        imageSource: classifyImageSource(state.imageUrl),
    };

    if (currentGameAnalytics) {
        return { ...derived, ...currentGameAnalytics };
    }

    return derived;
}

let gameState: GameState;
let cleanupDrag: (() => void) | null = null;

const renderer = new SvgDomRenderer();
renderer.init(app);

// Multi-select tool
const selectionManager = new SelectionManager();

// Floating rotate-buttons focus tracker
const rotationFocus = new RotationFocus();

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
        gameState.piecesById,
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
        const localBounds = getGroupLocalBounds(completedGroup, gameState.piecesById);
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
    const groupBounds = getGroupVisualBounds(completedGroup, gameState.piecesById);

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
    const solvedIndexes = buildGroupIndexes(gameState.groups);
    gameState.groupsById = solvedIndexes.groupsById;
    gameState.pieceToGroup = solvedIndexes.pieceToGroup;
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

const debouncedSave = createDebouncedSave();

/**
 * Project the visual bounds of the given group from world space into
 * screen space, using the current viewport transform. Returns `null` if
 * the group is no longer in the game state.
 */
function getFocusedGroupScreenBounds(
    groupId: number,
): { left: number; right: number; top: number; bottom: number } | null {
    const group = gameState?.groupsById.get(groupId);
    if (!group) return null;
    const local = getGroupVisualBounds(group, gameState.piecesById);
    const worldLeft = group.position.x + local.minX;
    const worldTop = group.position.y + local.minY;
    const worldRight = worldLeft + local.width;
    const worldBottom = worldTop + local.height;
    const tl = viewportTransform.worldToScreen({ x: worldLeft, y: worldTop });
    const br = viewportTransform.worldToScreen({ x: worldRight, y: worldBottom });
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

/**
 * Trigger a debounced auto-save of the current game state.
 */
function autoSave(): void {
    debouncedSave.save(gameState);
}

/**
 * Post-commit handling shared by piece-drag drops and rotate-handle commits.
 * Both flows produce a `MergeResult`, then need the same selection prune,
 * re-render, z-reorder, and win-detection sequence.
 *
 * `droppedGroupIds` is the caller-supplied list of groups whose z-order
 * should be refreshed; absorbed IDs are remapped to the surviving merged
 * group. Drag flows pass the multi-select expansion; rotate-handle
 * commits pass just the result group.
 */
function applyMergeResult(
    result: MergeResult,
    droppedGroupIds: readonly number[],
): void {
    // Prune absorbed groups from selection. The surviving merged group
    // inherits selection if any absorbed group was selected.
    const validIds = new Set(gameState.groups.map(g => g.id));
    const hadSelectedAbsorbed = [...selectionManager.selectedGroupIds]
        .some(id => !validIds.has(id));
    selectionManager.pruneStale(validIds);
    if (hadSelectedAbsorbed) {
        selectionManager.select(result.group.id);
    }

    // If the rotate-handle's anchor group was absorbed (free-rotation
    // commit-merge), retarget focus to the survivor — otherwise the
    // handle stays anchored to a now-deleted group until the idle timer
    // expires, and the next pointerdown silently no-ops.
    const focused = rotationFocus.focusedGroupId;
    if (focused !== null && !validIds.has(focused)) {
        rotationFocus.setFocus(result.group.id);
    }

    renderer.renderState(gameState);
    renderer.flashMergePulse(result.group.id);
    for (const selectedId of selectionManager.selectedGroupIds) {
        renderer.setGroupSelected(selectedId, true);
    }

    // Remap absorbed IDs from the caller-supplied list to the surviving
    // merged group so every entry still names a real group.
    const remapped = droppedGroupIds.map(id =>
        gameState.groups.some(g => g.id === id) ? id : result.group.id,
    );
    const unique = [...new Set(remapped)];
    reorderGroupsAfterDrop(unique, gameState, (gId) => renderer.bringGroupToFront(gId));

    if (checkAndMarkWin(gameState)) {
        track('puzzle-completed', buildPuzzleCompletedData(gameState));
        if (gameState.groups.length === 1) {
            zoomToFitCompletedPuzzle(gameState.groups[0], () => {
                showCompletionOverlay();
            });
        } else {
            // Fallback: shouldn't happen if the puzzle just completed.
            showCompletionOverlay();
        }
    }
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
    rotationFocus.clearFocus();

    if (cleanupDrag) {
        cleanupDrag();
        cleanupDrag = null;
    }

    gameState = state;
    renderer.renderState(gameState);
    updateAttribution();
    updateRotationUiVisibility();

    if (gameState.completed) {
        showCompletionOverlay();
    }

    cleanupDrag = setupInteraction({
        container: app,
        renderer,
        viewportTransform,
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

            // Primary dragged group + any selected groups (multi-select mode).
            const droppedGroupIds = [...selectionManager.expandToSelectionIfActive(groupId)];

            const result = processDrop(groupId, gameState, tolerance);
            if (result) {
                applyMergeResult(result, droppedGroupIds);
                autoSave();
            } else {
                // No merge: z-reorder the original dropped groups as-is.
                reorderGroupsAfterDrop(droppedGroupIds, gameState, (gId) => renderer.bringGroupToFront(gId));
            }
        },
        onViewportChanged: applyViewportTransform,
        screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
        panViewport: (screenDelta) => {
            viewportTransform.pan(screenDelta);
            applyViewportTransform();
        },
        selectionManager,
        rotationFocus,
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
    vibrant: boolean = false,
    rotationEnabled: boolean = false,
    freeRotation: boolean = false,
): Promise<void> {
    showLoadingOverlay();
    try {
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
                const query = buildImageQuery(category.query, vibrant);
                const result = await fetchRandomImage(accessKey, fetch, query);

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
                diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
            }
        }

        let rotationMode: 'none' | 'quarter-turn' | 'free';
        if (!rotationEnabled) {
            rotationMode = 'none';
        } else if (freeRotation && cutStyle === 'composable') {
            rotationMode = 'free';
        } else {
            rotationMode = 'quarter-turn';
        }

        const generatorFractalConfig = fractalConfig
            ? { borderless: fractalConfig.borderless }
            : undefined;

        // Let the overlay paint before the synchronous piece-generation burst.
        await yieldForPaint();

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

        const data: NewGameData = {
            source: 'fresh',
            cutStyle,
            rotationMode,
            cols: gridSize.cols,
            rows: gridSize.rows,
            pieceCount: state.pieces.length,
            imageSource: classifyImageSource(state.imageUrl),
        };
        if (data.imageSource === 'unsplash') {
            data.imageCategory = imageCategory ?? 'any';
            data.vibrant = vibrant;
        }
        currentGameAnalytics = data;
        track('new-game-started', currentGameAnalytics);
    } finally {
        hideLoadingOverlay();
    }
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
        const savedRotationEnabled = loadRotationEnabledPreference();
        const savedFreeRotationEnabled = loadFreeRotationEnabledPreference();
        const savedImageSource = loadImageSourcePreference();
        const savedImageCategory = loadImageCategoryPreference();
        const savedVibrant = loadVibrantPreference();
        createNewGameDialog({
            container: app,
            selectedIndex: preferredIndex,
            selectedCutStyleIndex: preferredCutStyleIndex,
            savedComposableConfig: savedComposableConfig,
            savedFractalConfig: savedFractalConfig,
            savedRotationEnabled: savedRotationEnabled,
            savedFreeRotationEnabled: savedFreeRotationEnabled,
            savedImageSource: savedImageSource,
            savedImageCategory: savedImageCategory,
            savedVibrant: savedVibrant,
            onSelect: ({ sizeIndex, cutStyleIndex, composableConfig, fractalConfig, rotationEnabled, freeRotation, imageSource, imageCategory, vibrant }) => {
                saveSizePreference(sizeIndex);
                saveCutStylePreference(cutStyleIndex);
                if (composableConfig) {
                    saveComposableConfigPreference(composableConfig);
                }
                if (fractalConfig) {
                    saveFractalConfigPreference(fractalConfig);
                }
                saveRotationEnabledPreference(rotationEnabled);
                saveFreeRotationEnabledPreference(freeRotation);
                saveImageSourcePreference(imageSource);
                saveImageCategoryPreference(imageCategory);
                saveVibrantPreference(vibrant);
                const option = getSizeOption(sizeIndex);
                const cutStyle = getCutStyleOption(cutStyleIndex).id;
                clearSavedState();
                void startNewGame(
                    toGridSize(option),
                    cutStyle,
                    composableConfig,
                    imageSource,
                    imageCategory,
                    fractalConfig,
                    vibrant,
                    rotationEnabled,
                    freeRotation,
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
    rotationFocus,
    onRotate: (groupId, direction) => {
        if (!gameState) return;
        const group = gameState.groupsById.get(groupId);
        if (!group) return;

        const deltaDeg = direction === 'cw' ? 90 : -90;
        rotateGroup(group, gameState.piecesById, deltaDeg);

        renderer.renderState(gameState);
        // Re-apply selection visuals after re-render (rotation re-renders the group).
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        autoSave();
    },
    getFocusedGroupScreenBounds,
});

const rotateHandle = createRotateHandle({
    container: app,
    rotationFocus,
    onRotate: (groupId, deltaDegrees) => {
        if (!gameState) return;
        const group = gameState.groupsById.get(groupId);
        if (!group) return;
        rotateGroup(group, gameState.piecesById, deltaDegrees);
        renderer.renderState(gameState);
        // Re-apply selection visuals after re-render.
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        // Don't autoSave on every drag tick — autoSave fires on commit.
    },
    onCommit: (groupId) => {
        if (!gameState) return;

        const tolerance = getActiveTolerance(
            gameState.imageSize.width,
            gameState.gridSize.cols,
            gameState.cutStyle,
        );

        const result = processDrop(groupId, gameState, tolerance);
        if (result) {
            applyMergeResult(result, [result.group.id]);
        }
        autoSave();
    },
    getFocusedGroupScreenBounds,
    getGroupRotation: (groupId) => gameState?.groupsById.get(groupId)?.rotation ?? null,
    getGroupPivotWorld: (groupId) => {
        const group = gameState?.groupsById.get(groupId);
        if (!group || !gameState) return null;
        const bounds = getGroupLocalBounds(group, gameState.piecesById);
        const centreLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        return localToWorld(centreLocal, group);
    },
    screenToWorld: (clientX, clientY) => viewportTransform.screenToWorld({ x: clientX, y: clientY }),
});

function updateRotationUiVisibility(): void {
    if (gameState?.rotationMode === 'quarter-turn') {
        rotateButtons.show();
        rotateHandle.hide();
    } else if (gameState?.rotationMode === 'free') {
        rotateButtons.hide();
        rotateHandle.show();
    } else {
        rotateButtons.hide();
        rotateHandle.hide();
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
            getState: () => gameState,
            state: gameState,
            onSolve: () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__solvePuzzle?.();
            },
        });
    },
});

async function loadSharedPuzzle(
    payload: SharePayload,
    recipientHadSavedState: boolean,
): Promise<void> {
    showLoadingOverlay();
    try {
        const imageSize = { width: payload.is[0], height: payload.is[1] };

        // If the sentinel is the blank canvas, regenerate it locally.
        let imageUrl = payload.i;
        if (imageUrl === 'blank') {
            const canvas = document.createElement('canvas');
            canvas.width = imageSize.width;
            canvas.height = imageSize.height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, imageSize.width, imageSize.height);
            imageUrl = canvas.toDataURL('image/png');
        }

        const viewport = {
            width: app.clientWidth || window.innerWidth,
            height: app.clientHeight || window.innerHeight,
        };

        // Let the overlay paint before the synchronous piece-generation burst.
        await yieldForPaint();

        const state = createNewGame(imageUrl, imageSize, viewport, { cols: payload.g[0], rows: payload.g[1] }, {
            cutStyle: payload.c,
            seed: payload.s,
            rotationMode: payload.r,
            fractalConfig: payload.ff ? { borderless: payload.ff.bl } : undefined,
            composableConfig: payload.cf
                ? {
                    horizontalAmplitude: payload.cf.ha,
                    horizontalFrequency: payload.cf.hf,
                    verticalAmplitude: payload.cf.va,
                    verticalFrequency: payload.cf.vf,
                    disableTabs: payload.cf.dt,
                  }
                : undefined,
        });

        if (payload.a) {
            state.attribution = {
                photographerName: payload.a.n,
                photographerUrl: payload.a.u,
                photoUrl: payload.a.p,
            };
        }

        if (payload.pr) {
            const ok = applyProgress(state, payload.pr);
            if (!ok) {
                showToast("Couldn't load progress — starting from scratch");
            }
        }

        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        autoSave();

        const data: NewGameData = {
            source: 'shared',
            cutStyle: state.cutStyle ?? 'classic',
            rotationMode: state.rotationMode ?? 'none',
            cols: state.gridSize.cols,
            rows: state.gridSize.rows,
            pieceCount: state.pieces.length,
            imageSource: classifyImageSource(state.imageUrl),
            includesProgress: payload.pr !== undefined,
            recipientHadSavedState,
        };
        currentGameAnalytics = data;
        track('new-game-started', currentGameAnalytics);
    } finally {
        hideLoadingOverlay();
    }
}

async function tryLoadSharedPuzzle(): Promise<boolean> {
    const payload = parseLocationHash(window.location.hash);
    if (!payload) {
        if (window.location.hash.startsWith('#p=')) {
            showToast('Invalid share link');
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return false;
    }

    const hasExistingProgress = !!loadState();
    if (hasExistingProgress) {
        const ok = window.confirm('Load shared puzzle? Your current progress will be lost.');
        if (!ok) {
            // Leave the hash in place so the user can reload to retry.
            return false;
        }
    }

    clearSavedState();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await loadSharedPuzzle(payload, hasExistingProgress);
    return true;
}

// On load: shared-link (hash) > saved game > fresh start.
// index.html renders the loading overlay up front so users see feedback
// before JS finishes booting. `startNewGame` / `loadSharedPuzzle` manage
// the overlay themselves; the saved-state branch hides it manually.
void (async () => {
    try {
        const loadedFromShare = await tryLoadSharedPuzzle();
        if (loadedFromShare) return;

        const savedState = loadState();
        if (savedState) {
            initGame(savedState);
            return;
        }

        // First load with no saved game: use the preferred size and cut style
        const preferredIndex = loadSizePreference();
        const option = getSizeOption(preferredIndex);
        const preferredCutStyle = getCutStyleOption(loadCutStylePreference()).id;
        const preferredFractalConfig = loadFractalConfigPreference();
        const preferredRotationEnabled = loadRotationEnabledPreference();
        const preferredFreeRotationEnabled = loadFreeRotationEnabledPreference();
        await startNewGame(
            toGridSize(option),
            preferredCutStyle,
            undefined,
            undefined,
            undefined,
            preferredFractalConfig,
            undefined,
            preferredRotationEnabled,
            preferredFreeRotationEnabled,
        );
    } finally {
        hideLoadingOverlay();
    }
})();

// Handle share links pasted into the address bar of a tab that already
// has the app loaded. Without this, the hash changes but nothing reacts
// until the user reloads. `history.replaceState` calls inside
// tryLoadSharedPuzzle don't fire hashchange, so there's no loop risk.
window.addEventListener('hashchange', () => {
    void tryLoadSharedPuzzle();
});
