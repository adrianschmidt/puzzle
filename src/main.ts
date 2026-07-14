import './palette.css';
import './style.css';
import { diagnostics } from './diagnostics.js';
import type { GameState, GridSize } from './model/types.js';
import { SvgDomRenderer, applyGroupTransform } from './renderer/index.js';
import { setupInteraction, ViewportTransform, RotationFocus } from './interaction/index.js';
import {
    createNewGame,
    processDrop,
    checkAndMarkWin,
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupLocalBounds,
    getGroupVisualBounds,
    getGroupImageCenter,
    type MergeResult,
} from './game/index.js';
import {
    loadState,
    loadSavedGame,
    clearSavedState,
    createDebouncedSave,
    saveNewPuzzle,
} from './persistence/index.js';
import {
    createNewGameButton,
    createGatherPiecesButton,
    loadColorPreference,
    saveColorPreference,
    applyBackgroundColor,
    onColorSchemeChange,
    installPieceOutlineFilter,
    loadPieceOutlinePreference,
    applyPieceOutline,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
    createBackgroundColorPicker,
    createInfoButton,
    createInfoModal,
    createSelectToolButton,
    createMarqueeToolButton,
    createDeselectButton,
    createRotateButtons,
    createRotateHandle,
    getActiveTolerance,
    getActiveRotationTolerance,
    createAttributionElement,
    removeAttribution,
    createNewGameDialog,
    createCorruptSaveDialog,
    showCompletionOverlay as renderCompletionOverlay,
    showToast,
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
    type FractalDialogConfig,
    type WavyDialogConfig,
} from './ui/index.js';
import { SelectionManager } from './interaction/selection-manager.js';
import { rotateGroup } from './game/rotate-group.js';
import type { SnapTolerances } from './game/snap-proximity-rotation.js';
import {
    buildGroupIndexes,
    rotatePoint,
    localToWorld,
    signedAngularDelta,
} from './model/helpers.js';
import { reorderGroupsAfterDrop } from './game/z-order.js';
import { getUnsplashAccessKey } from './images/index.js';
import {
    loadSizePreference,
    saveSizePreference,
    getSizeOption,
    toGridSize,
} from './game/puzzle-sizes.js';
import {
    loadCutStylePreference,
    saveCutStylePreference,
    rotationModeForNewGame,
} from './game/cut-styles.js';
import type { CutStyle } from './game/cut-styles.js';
import {
    loadComposableConfigPreference,
    saveComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from './game/composable-config.js';
import {
    loadFractalConfigPreference,
    saveFractalConfigPreference,
} from './game/fractal-config.js';
import {
    loadWavyConfigPreference,
    saveWavyConfigPreference,
} from './game/wavy-config.js';
import {
    loadImageSourcePreference,
    saveImageSourcePreference,
    imageSourcePreferenceExists,
} from './game/image-source.js';
import {
    loadImageCategoryPreference,
    saveImageCategoryPreference,
    loadVibrantPreference,
    saveVibrantPreference,
    imageCategoryPreferenceExists,
} from './game/image-categories.js';
import {
    parseLocationHash,
    shareCfToComposableConfig,
    type SharePayload,
} from './sharing/index.js';
import { applyProgress } from './game/reconstruct-groups.js';
import { preloadTracedTabGenerator } from './puzzle/topology/traced-tab-loader.js';
import { CURRENT_TRACE_SET_VERSION } from './puzzle/composable/traces/trace-set-version.js';
import { getBaseCutGenerator } from './puzzle/topology/generator-registry.js';
import { initAnalytics, initErrorTracking, track } from './analytics/index.js';
import type { NewGameData, PuzzleCompletedData } from './analytics/index.js';
import { runWithErrorReport } from './app/run-with-error-report.js';
import { resolveUnsplashImage } from './app/resolve-image.js';
import { classifyImageSource, resolveNewGameImageSource } from './app/classify-image-source.js';
import {
    BUNDLED_IMAGE_URL,
    BUNDLED_IMAGE_SIZE,
    BUNDLED_IMAGE_ATTRIBUTION,
} from './app/bundled-image.js';
import { initPwaUpdates } from './pwa/register.js';
import { initSwErrorReporting } from './pwa/sw-error-bridge.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

// Suppress the browser context menu on the puzzle table only.
// On touch devices (especially iPad), long-pressing a piece would
// otherwise trigger the context menu, interfering with drag. We
// can't target the table directly here because it's created later
// by renderer.init; delegate from #app and check the event target
// so context menus inside the info modal / debug panels still
// reach the browser (otherwise the user can't copy share links
// or reproduction parameters via long-press).
app.addEventListener('contextmenu', (e) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-puzzle-table]')) {
        e.preventDefault();
    }
});

initAnalytics();

// Global backstop: report unhandled rejections / uncaught errors that
// no local try/catch handled. Observe-only; never swallows them.
initErrorTracking();

// Companion backstop for the service worker's own scope (#430): the
// `window` listeners above run in the page realm and never see exceptions
// thrown inside the worker, so the worker posts those here for reporting.
initSwErrorReporting();

// Resource Timing entries back the traced-chunk `cacheState` dimension
// (see detectCacheState in traced-tab-loader.ts). The 250-entry default
// buffer can evict the chunk's entry on long-lived PWA sessions, which
// would degrade the signal to `unknown`; a larger buffer keeps it
// reliable at negligible memory cost.
performance.setResourceTimingBufferSize?.(500);

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

    // The trace-set version survives in the per-style config on the saved
    // state, so resumed-then-completed Wavy/Triangles games can report it
    // just like fresh ones (where currentGameAnalytics carries it).
    const traceSetVersion =
        state.cutStyle === 'triangles'
            ? state.trianglesConfig?.traceSetVersion
            : state.cutStyle === 'wavy'
              ? state.wavyConfig?.traceSetVersion
              : undefined;
    if (traceSetVersion !== undefined) {
        derived.traceSetVersion = traceSetVersion;
    }

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

// When selection changes, update group visuals and persist it (debounced)
// so the selection survives a reload. The selection is stored alongside the
// game state, so it is cleared automatically when the user deselects all or
// starts a new game, and never leaks into share links.
selectionManager.onChange((selectedIds) => {
    // Remove highlight from all groups, then re-apply to selected
    for (const group of gameState?.groups ?? []) {
        renderer.setGroupSelected(group.id, selectedIds.has(group.id));
    }
    if (gameState) autoSave();
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

    const layoutCenterX = layoutBounds.x + layoutBounds.width / 2;
    const layoutCenterY = layoutBounds.y + layoutBounds.height / 2;

    viewportTransform.setState({
        scale,
        offset: {
            x: screenWidth / 2 - layoutCenterX * scale,
            y: screenHeight / 2 - layoutCenterY * scale,
        },
    });

    applyViewportTransform();
}

/**
 * Animate the viewport to center and zoom-to-fit a single completed group.
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

    // If the puzzle was completed at a non-zero rotation, spin the group
    // upright in parallel with the viewport zoom. Two things matter for how
    // this looks:
    //
    //   1. It should spin about the puzzle's own center, in place — not orbit.
    //      CSS interpolates `translate(...)` and `rotate(...)` independently,
    //      so animating both would swing the center along an arc. Instead we
    //      pin the rotation's `transform-origin` to the image center and
    //      animate the angle only, keeping the center fixed throughout.
    //   2. It should take the shortest path (≤180°): 350° spins +10° to land
    //      upright, not −350° the long way round.
    let groupTransitionCleanup: (() => void) | null = null;
    if (completedGroup.rotation !== 0) {
        const startRotation = completedGroup.rotation;

        // Pivot about the assembled image center (corner geometry only, so
        // asymmetric tabs don't offset it). `getGroupImageCenter` works in
        // un-rotated local space — the same frame `transform-origin` uses.
        const centerLocal = getGroupImageCenter(completedGroup, gameState.piecesById);

        // Compensate `position` so that, with the origin moved to the center,
        // the puzzle stays exactly where it was rendered. Same world point as
        // before; only its local-space pivot changed.
        const rotatedCenter = rotatePoint(centerLocal, startRotation);
        const finalPosition = {
            x: completedGroup.position.x + rotatedCenter.x - centerLocal.x,
            y: completedGroup.position.y + rotatedCenter.y - centerLocal.y,
        };

        // Shortest signed turn that lands on an upright (0°-equivalent) angle.
        // e.g. 350° → 360°, 10° → 0°, 200° → 360°.
        const targetRotation = startRotation + signedAngularDelta(0, startRotation);

        const groupEl = app.querySelector(
            `[data-group-id="${completedGroup.id}"]`,
        ) as HTMLElement | null;
        if (groupEl) {
            // Re-anchor to the center origin without moving the puzzle (same
            // angle, compensated position), then force a reflow so this state
            // becomes the transition's start frame rather than collapsing into
            // the spin below.
            groupEl.style.transition = 'none';
            applyGroupTransform(groupEl, finalPosition, startRotation, centerLocal);
            groupEl.getBoundingClientRect();

            // Spin about the center to upright.
            groupEl.style.transition = 'transform 0.8s ease-in-out';
            applyGroupTransform(groupEl, finalPosition, targetRotation, centerLocal);

            groupTransitionCleanup = () => {
                // Settle into the normal representation: origin back at 0,0 and
                // rotation normalized to 0. Visually identical to the spin's
                // final frame (targetRotation ≡ 0 mod 360), so no jump.
                groupEl.style.transition = '';
                renderer.renderState(gameState);
            };
        }

        // Commit the upright resting state. Used immediately below to frame the
        // viewport on the final orientation, and as the model's settled value.
        completedGroup.position = finalPosition;
        completedGroup.rotation = 0;
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

    // Calculate target offset to center the completed puzzle
    const worldCenterX = worldBounds.x + worldBounds.width / 2;
    const worldCenterY = worldBounds.y + worldBounds.height / 2;
    const targetOffset = {
        x: screenWidth / 2 - worldCenterX * targetScale,
        y: screenHeight / 2 - worldCenterY * targetScale,
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

/**
 * Dev-console hook for visual smoke-testing the experimental two-circle
 * Venn cut style. Not exposed in any UI. Removed before Plan 2 merges
 * if the cut style isn't promoted to a user-facing option.
 *
 * Usage (in browser dev console):
 *   __startVennPuzzle()
 *   __startVennPuzzle({ leftRadius: 200, rightCenter: { x: 700, y: 360 } })
 *   __startVennPuzzle({ tabs: true })   // classic tabs on the shared arcs
 *
 * Caveat: share-links and reloads don't yet preserve the venn config —
 * only the in-memory render is meaningful. After the page reloads, the
 * autosaved state falls back to sine defaults.
 */
(window as any).__startVennPuzzle = (overrides?: {
    leftCenter?: { x: number; y: number };
    leftRadius?: number;
    rightCenter?: { x: number; y: number };
    rightRadius?: number;
    tabs?: boolean;
}) => {
    const baseCutConfig = {
        leftCenter: overrides?.leftCenter ?? { x: 432, y: 360 },
        leftRadius: overrides?.leftRadius ?? 240,
        rightCenter: overrides?.rightCenter ?? { x: 648, y: 360 },
        rightRadius: overrides?.rightRadius ?? 240,
    };
    void startNewGame(
        { cols: 1, rows: 1 },
        'composable',
        {
            baseCutGenerator: 'venn',
            baseCutConfig,
            tabGenerator: overrides?.tabs ? 'classic' : 'none',
            tabConfig: {},
        },
        'blank',
    );
};

/**
 * Dev-console hook for launching a Composable puzzle with arbitrary
 * generator parameters. Exposed because Composable is hidden from the
 * production new-game dialog; power users can still reach the full
 * surface via this helper.
 *
 * Usage (browser console):
 *   __newComposableGame()
 *   __newComposableGame({ cols: 12, rows: 8 })
 *   __newComposableGame({
 *       baseCutConfig: { cols: 8, rows: 6, ha: 0.3, hf: 2, va: 0.3, vf: 1.5 },
 *       tabGenerator: 'none',
 *   })
 *   __newComposableGame({ rotation: 'free' })
 *   __newComposableGame({ seed: 1086655870 })   // reproduce a specific puzzle
 *
 * Defaults: 8×6 grid, sine base-cut generator with composable's stock
 * defaults, classic tabs, no rotation, current saved image-source
 * preference. Seed defaults to a fresh random value each call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__newComposableGame = (overrides?: {
    cols?: number;
    rows?: number;
    baseCutGenerator?: string;
    baseCutConfig?: Record<string, unknown>;
    tabGenerator?: string;
    tabConfig?: Record<string, unknown>;
    minPieceArea?: number;
    rotation?: 'none' | 'free';
    imageSource?: 'random' | 'blank';
    seed?: number;
}) => {
    const cols = overrides?.cols ?? 8;
    const rows = overrides?.rows ?? 6;
    const baseCutConfig = overrides?.baseCutConfig ?? {
        cols, rows, ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5,
    };
    const config: import('./puzzle/composable-generator.js').ComposableConfig = {
        baseCutGenerator: overrides?.baseCutGenerator ?? 'sine',
        baseCutConfig,
        tabGenerator: overrides?.tabGenerator ?? 'classic',
        tabConfig: overrides?.tabConfig ?? {},
    };
    if (overrides?.minPieceArea !== undefined) {
        config.minPieceArea = overrides.minPieceArea;
    }
    const rotation = overrides?.rotation ?? 'none';
    void startNewGame(
        { cols, rows },
        'composable',
        config,
        overrides?.imageSource ?? loadImageSourcePreference(),
        loadImageCategoryPreference(),
        undefined, // fractalConfig
        undefined, // wavyConfig
        loadVibrantPreference(),
        rotation !== 'none',
        overrides?.seed,
    );
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
 * React to a viewport (zoom/pan) change: re-apply the transform to the
 * renderer and persist the new view via the debounced auto-save, so the
 * player's zoom level and pan offset survive a reload (#420).
 */
function onViewportChanged(): void {
    applyViewportTransform();
    autoSave();
}

// Surface a save failure (quota exceeded even after compression). Every failure
// emits telemetry so the regression is observable; the user-facing toast is
// rate-limited so a fast debounced save loop can't spam it — and a suppressed
// repeat still leaves a diagnostic trail rather than vanishing silently.
let lastSaveFailedToastAt = 0;
function notifySaveFailed(op: 'progress' | 'new-puzzle'): void {
    track('save-failed', { op });
    const now = Date.now();
    if (now - lastSaveFailedToastAt < 10_000) {
        diagnostics.warn(`Save failed (${op}) within the toast-dedup window; toast suppressed.`);
        return;
    }
    lastSaveFailedToastAt = now;
    showToast("This puzzle is too large to save — your progress won't be kept across reloads.");
}

/**
 * Persist a freshly created or loaded puzzle: geometry (once) + initial progress.
 * Surfaces a failed write as a toast, and records when the geometry write crossed
 * into the compression regime (near-quota — one growth step from total failure).
 */
function persistNewPuzzle(): void {
    const result = saveNewPuzzle(
        gameState,
        selectionManager.selectedGroupIds,
        viewportTransform.getState(),
    );
    if (result === 'failed') {
        notifySaveFailed('new-puzzle');
    } else if (result === 'ok-compressed') {
        track('save-compressed', {
            cutStyle: gameState.cutStyle ?? 'classic',
            pieceCount: gameState.pieces.length,
        });
    }
}

const debouncedSave = createDebouncedSave({
    onSaveFailed: () => notifySaveFailed('progress'),
    // A cross-tab takeover refused this autosave (another tab started a new
    // puzzle on the same origin). Not a failure to warn the user about, but
    // worth measuring — this is the race that used to produce a torn save.
    onSaveSkipped: () =>
        track('progress-save-skipped', {
            cutStyle: gameState.cutStyle ?? 'classic',
            pieceCount: gameState.pieces.length,
        }),
});

// Persist any pending debounced save before the page goes away, so a change
// made within the 500ms debounce window (e.g. a just-tapped selection) is not
// lost on a fast reload or tab close. `pagehide` covers reloads, navigations
// and closes; `visibilitychange` → hidden additionally covers mobile
// app-switch / background-kill, where `pagehide` is not guaranteed to fire.
// `flush()` is a no-op when nothing is pending, so firing on both is safe.
window.addEventListener('pagehide', () => debouncedSave.flush());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') debouncedSave.flush();
});

// Keep the installed PWA current: detect new versions while open and on
// reopen, and apply them at a safe moment (focus regain or a manual tap).
// `debouncedSave.flush` runs first so progress within the debounce window
// survives the reload.
initPwaUpdates(() => debouncedSave.flush());

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
 * Trigger a debounced auto-save of the current game state, including the
 * current multi-select selection so it survives a reload.
 */
function autoSave(): void {
    debouncedSave.save(gameState, selectionManager.selectedGroupIds, viewportTransform.getState());
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
 * The active snap tolerances for `state` — the single definition of "would
 * a drop merge?" thresholds, shared by drop/commit merge detection and
 * snap proximity rotation so they can never drift apart.
 */
function activeSnapTolerances(state: GameState): SnapTolerances {
    return {
        tolerancePx: getActiveTolerance(
            state.imageSize.width,
            state.gridSize.cols,
            state.cutStyle,
        ),
        rotationToleranceDeg: getActiveRotationTolerance(),
    };
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
            const { tolerancePx, rotationToleranceDeg } = activeSnapTolerances(gameState);

            // Primary dragged group + any selected groups (multi-select mode).
            const droppedGroupIds = [...selectionManager.expandToSelectionIfActive(groupId)];

            const result = processDrop(groupId, gameState, tolerancePx, rotationToleranceDeg);
            if (result) {
                applyMergeResult(result, droppedGroupIds);
                autoSave();
            } else {
                // No merge: z-reorder the original dropped groups as-is.
                reorderGroupsAfterDrop(droppedGroupIds, gameState, (gId) => renderer.bringGroupToFront(gId));
            }
        },
        getSnapTolerances: () => activeSnapTolerances(gameState),
        onViewportChanged,
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
 * Re-apply a multi-select selection persisted from a previous session.
 *
 * Called only on the saved-game restore path, after {@link initGame} has
 * installed the restored `gameState` (and cleared any in-memory selection).
 * Group ids are stable across a reload, so the saved ids map back to the
 * same groups; any id that no longer exists (defensive — shouldn't happen
 * on a pure reload) is dropped. When a non-empty selection is restored the
 * multi-select tool is switched on so the selection is visible and
 * draggable, mirroring the state the user left.
 */
function restorePersistedSelection(savedSelection: readonly number[]): void {
    if (savedSelection.length === 0) return;

    const validIds = new Set(gameState.groups.map((g) => g.id));
    const toSelect = savedSelection.filter((id) => validIds.has(id));

    if (toSelect.length < savedSelection.length) {
        // The saved selection comes from the same blob as the restored game,
        // so on a pure reload every id should still exist. A mismatch points
        // at a genuine inconsistency (id-allocation drift, a save/restore
        // ordering bug) worth surfacing in dev rather than dropping silently.
        const dropped = savedSelection.filter((id) => !validIds.has(id));
        diagnostics.warn(
            'restorePersistedSelection: dropped saved selection id(s) with no matching group',
            { dropped, liveGroupCount: validIds.size },
        );
    }

    if (toSelect.length === 0) return;

    selectionManager.toolActive = true;
    for (const id of toSelect) {
        selectionManager.select(id);
    }
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
    wavyConfig?: WavyDialogConfig,
    vibrant: boolean = false,
    rotationEnabled: boolean = false,
    seed?: number,
): Promise<void> {
    showLoadingOverlay();
    try {
        // Reset viewport transform so pieces are randomized in unzoomed coordinates
        viewportTransform.reset();
        applyViewportTransform();

        // Traced tabs live in a lazy chunk; the dialog kicked off the
        // preload when the user picked "Traced", so this await typically
        // resolves instantly. The await is the safety net for paths that
        // didn't go through the dialog (e.g. the __newComposableGame
        // console hook).
        if (composableConfig?.tabGenerator === 'traced' || cutStyle === 'wavy'
            || cutStyle === 'triangles') {
            await preloadTracedTabGenerator();
        }

        const viewport = {
            width: app.clientWidth || window.innerWidth,
            height: app.clientHeight || window.innerHeight,
        };

        let imageUrl: string = BUNDLED_IMAGE_URL;
        let imageSize = BUNDLED_IMAGE_SIZE;
        let attribution: GameState['attribution'] = BUNDLED_IMAGE_ATTRIBUTION;

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
            attribution = undefined;
        }

        // Try to fetch a random Unsplash image — unless the user picked a
        // blank puzzle, or this is the deterministic first-run puzzle
        // (which uses the bundled defaults set above).
        const accessKey =
            imageSource !== 'blank' && imageSource !== 'first-run'
                ? getUnsplashAccessKey()
                : null;

        if (accessKey) {
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant);
            if (resolved) {
                imageUrl = resolved.imageUrl;
                imageSize = resolved.imageSize;
                attribution = resolved.attribution;
            }
        }

        const rotationMode = rotationModeForNewGame(cutStyle, rotationEnabled);

        const generatorFractalConfig = fractalConfig
            ? { borderless: fractalConfig.borderless }
            : undefined;
        // Every new Wavy game uses traced tabs at the current trace-set
        // version. Older saves/links carry their own (or no) version and are
        // reproduced verbatim elsewhere; this path only ever creates fresh
        // puzzles, so stamping the current version is always correct.
        const generatorWavyConfig = cutStyle === 'wavy'
            ? {
                borderless: wavyConfig?.borderless ?? false,
                traceSetVersion: CURRENT_TRACE_SET_VERSION,
            }
            : undefined;

        // Every new Triangles game uses traced tabs at the current trace-set
        // version — same stamping rationale as generatorWavyConfig above.
        const generatorTrianglesConfig = cutStyle === 'triangles'
            ? { traceSetVersion: CURRENT_TRACE_SET_VERSION }
            : undefined;

        // Let the overlay paint before the synchronous piece-generation burst.
        await yieldForPaint();

        const state = createNewGame(imageUrl, imageSize, viewport, gridSize, {
            cutStyle,
            composableConfig,
            fractalConfig: generatorFractalConfig,
            wavyConfig: generatorWavyConfig,
            trianglesConfig: generatorTrianglesConfig,
            rotationMode,
            seed,
        });

        if (attribution) {
            state.attribution = attribution;
        }

        initGame(state);
        gatherAndZoomToFit();
        renderer.renderState(gameState);
        persistNewPuzzle();

        const data: NewGameData = {
            source: 'fresh',
            cutStyle,
            rotationMode,
            cols: gridSize.cols,
            rows: gridSize.rows,
            pieceCount: state.pieces.length,
            // resolveNewGameImageSource honors the 'first-run' sentinel, which
            // classifyImageSource can't distinguish from a fallback-after-
            // failed-fetch (both reuse the bundled URL).
            imageSource: resolveNewGameImageSource(imageSource, state.imageUrl),
        };
        if (generatorWavyConfig) {
            data.traceSetVersion = generatorWavyConfig.traceSetVersion;
        }
        if (generatorTrianglesConfig) {
            data.traceSetVersion = generatorTrianglesConfig.traceSetVersion;
        }
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
        const preferredSizeId = loadSizePreference();
        const preferredCutStyleId = loadCutStylePreference();
        const savedComposableConfig = loadComposableConfigPreference();
        const savedFractalConfig = loadFractalConfigPreference();
        const savedRotationEnabled = loadRotationEnabledPreference();
        const savedImageSource = loadImageSourcePreference();
        const savedImageCategory = loadImageCategoryPreference();
        const savedVibrant = loadVibrantPreference();
        createNewGameDialog({
            container: app,
            selectedSizeId: preferredSizeId,
            selectedCutStyleId: preferredCutStyleId,
            savedComposableConfig: savedComposableConfig,
            savedFractalConfig: savedFractalConfig,
            savedWavyConfig: loadWavyConfigPreference(),
            savedRotationEnabled: savedRotationEnabled,
            composableSupportsBorderless:
                getBaseCutGenerator('sine').supportsBorderless ?? false,
            savedImageSource: savedImageSource,
            savedImageCategory: savedImageCategory,
            savedVibrant: savedVibrant,
            onPreloadTracedTabs: () => {
                // Fire-and-forget — preloadTracedTabGenerator is
                // idempotent and clears its cached promise on failure,
                // so the eventual `await` in startNewGame triggers a
                // fresh attempt that surfaces the real error. Swallow
                // here only to stop the in-flight rejection from
                // surfacing as an unhandled-rejection warning.
                preloadTracedTabGenerator().catch(() => {});
            },
            onSelect: ({ sizeId, cutStyleId, composableConfig, fractalConfig, wavyConfig, rotationEnabled, imageSource, imageCategory, vibrant }) => {
                saveSizePreference(sizeId);
                saveCutStylePreference(cutStyleId);
                if (composableConfig) {
                    saveComposableConfigPreference(composableConfig);
                }
                if (fractalConfig) {
                    saveFractalConfigPreference(fractalConfig);
                }
                if (wavyConfig) {
                    saveWavyConfigPreference(wavyConfig);
                }
                saveRotationEnabledPreference(rotationEnabled);
                saveImageSourcePreference(imageSource);
                saveImageCategoryPreference(imageCategory);
                saveVibrantPreference(vibrant);
                const option = getSizeOption(sizeId);
                const cutStyle = cutStyleId as CutStyle;
                clearSavedState();
                const newGame = startNewGame(
                    toGridSize(option),
                    cutStyle,
                    composableConfig
                        ? composableSliderToGeneratorConfig(composableConfig)
                        : undefined,
                    imageSource,
                    imageCategory,
                    fractalConfig,
                    wavyConfig,
                    vibrant,
                    rotationEnabled,
                );
                void runWithErrorReport({
                    // The chunk-load path (traced tabs lazy import) is the most
                    // likely source of a rejection here — a network blip or
                    // stale deploy hash. The user gets a toast so the click
                    // doesn't silently do nothing; `new-game-failed` records it.
                    run: () => newGame,
                    warnMessage: 'Failed to start new game:',
                    event: 'new-game-failed',
                    toastMessage: "Couldn't start new game",
                    fallback: undefined,
                });
            },
        });
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

// Set up the marquee tool button, directly below the multi-select button
createMarqueeToolButton({
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

        const { tolerancePx, rotationToleranceDeg } = activeSnapTolerances(gameState);

        const result = processDrop(groupId, gameState, tolerancePx, rotationToleranceDeg);
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
        // Interactive rotation pivots about the tab-inclusive bounds center so
        // the handle tracks the visible footprint of a mid-assembly group with
        // exposed tabs/blanks. (The completion spin instead pivots about the
        // corner-only image center via getGroupImageCenter — a deliberately
        // different point, since a solved puzzle has a flat border.)
        const bounds = getGroupLocalBounds(group, gameState.piecesById);
        const centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        return localToWorld(centerLocal, group);
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

// Install the SVG filter used by the "Outline" piece-outline mode and
// apply the saved style + color preferences. The color itself flips
// with the OS theme via CSS, so (unlike the background) no re-apply on
// theme change is needed.
installPieceOutlineFilter();
applyPieceOutline(loadPieceOutlinePreference());
applyPieceOutlineColor(loadPieceOutlineColorPreference());

// Set up the Background Color picker
let currentColorId = loadColorPreference();
applyBackgroundColor(currentColorId);

// The background color flips with the OS theme via CSS; re-apply only
// to recompute the luminance-derived UI-chrome scheme on the flip.
onColorSchemeChange(() => applyBackgroundColor(currentColorId));

createBackgroundColorPicker({
    container: app,
    selectedId: currentColorId,
    onSelect: (id) => {
        currentColorId = id;
        saveColorPreference(id);
        applyBackgroundColor(id);
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
        // A share link with `cf.tg: "traced"` needs the lazy chunk before
        // generation runs. The await is short on warm caches and fits
        // inside the loading overlay the user already sees.
        if (payload.cf?.tg === 'traced'
            || (payload.c === 'wavy' && payload.wf?.tv !== undefined)
            || payload.c === 'triangles') {
            await preloadTracedTabGenerator();
        }

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
            wavyConfig: payload.wf
                ? { borderless: payload.wf.bl, traceSetVersion: payload.wf.tv }
                : undefined,
            trianglesConfig: payload.tf
                ? { traceSetVersion: payload.tf.tv }
                : undefined,
            composableConfig: payload.cf
                ? shareCfToComposableConfig(payload.cf)
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
        persistNewPuzzle();

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
        // Present for a traced-tab Wavy link or a Triangles link; a legacy
        // (classic-tab) Wavy link carries no wf.tv, matching the fresh path's
        // stamping conditions. Both branches check the cut style so a crafted
        // link carrying a stray foreign config block can't mis-attribute the
        // version.
        if (payload.c === 'wavy' && payload.wf?.tv !== undefined) {
            data.traceSetVersion = payload.wf.tv;
        }
        if (payload.c === 'triangles' && payload.tf?.tv !== undefined) {
            data.traceSetVersion = payload.tf.tv;
        }
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

    // An unreadable save reads as no progress here, so its recovery blobs are
    // not offered for download on this path — corrupt-save recovery is
    // deliberately startup-only. The user is explicitly navigating to a new
    // puzzle, and clearSavedState() below would overwrite the blobs anyway.
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
    // Surface-shape validation (`isValidComposableCf` etc.) catches most
    // malformed payloads at decode time, but a link can still satisfy the
    // schema and then trip the topology pipeline — e.g. a config combination
    // the current build doesn't support. Report it and toast rather than
    // letting it surface as an unhandled rejection.
    return runWithErrorReport({
        run: async () => {
            await loadSharedPuzzle(payload, hasExistingProgress);
            return true;
        },
        warnMessage: 'Failed to load shared puzzle:',
        event: 'shared-load-failed',
        toastMessage: "Couldn't load shared puzzle",
        fallback: false,
    });
}

// On load: shared-link (hash) > saved game > fresh start.
// index.html renders the loading overlay up front so users see feedback
// before JS finishes booting. `startNewGame` / `loadSharedPuzzle` manage
// the overlay themselves; the saved-state branch hides it manually.
void (async () => {
    try {
        const loadedFromShare = await tryLoadSharedPuzzle();
        if (loadedFromShare) return;

        const saved = loadSavedGame();
        if (saved.status === 'ok') {
            initGame(saved.state);
            restorePersistedSelection(saved.selection);
            if (saved.viewport) {
                // Restore the zoom/pan the player last had (#420). Absent on
                // pre-feature saves — those keep the default view, as before.
                viewportTransform.setState(saved.viewport);
                applyViewportTransform();
            }
            return;
        }
        if (saved.status === 'unreadable') {
            // A save was present but couldn't be restored. Stop before the
            // fresh puzzle overwrites it: let the player download the raw
            // (in-memory) blobs for recovery. Boot continues once they close
            // the dialog. The pre-boot loading overlay (z-index above the
            // dialog) is hidden so the modal is visible.
            track('save-unreadable', { reason: saved.reason });
            hideLoadingOverlay();
            await new Promise<void>((resolve) => {
                createCorruptSaveDialog({
                    container: app,
                    raw: saved.raw,
                    onDismiss: ({ downloaded }) => {
                        track('save-recovery', { downloaded });
                        resolve();
                    },
                });
            });
        }

        // No (readable) saved game: use the saved preferences. Mirror the
        // New Game dialog path so a first-load (or post-regeneration) puzzle
        // respects every remembered preference — otherwise composable cuts,
        // image source/category, and vibrancy silently fall back to defaults
        // and the resulting save (and any share link from it) wouldn't match
        // what the user last chose.
        const preferredSizeId = loadSizePreference();
        const option = getSizeOption(preferredSizeId);
        const preferredCutStyle = loadCutStylePreference() as CutStyle;
        const preferredComposable = loadComposableConfigPreference();
        const preferredFractalConfig = loadFractalConfigPreference();
        const preferredWavyConfig = loadWavyConfigPreference();
        const preferredRotationEnabled = loadRotationEnabledPreference();
        // A brand-new visitor (no save at all, never touched an image
        // preference) gets the hand-picked bundled image instead of a
        // random one, so the first impression works against the default
        // background. An unreadable save means a returning user — they
        // keep today's random-image behavior.
        const firstRun = saved.status === 'empty'
            && !imageSourcePreferenceExists()
            && !imageCategoryPreferenceExists();
        await startNewGame(
            toGridSize(option),
            preferredCutStyle,
            preferredCutStyle === 'composable' && preferredComposable
                ? composableSliderToGeneratorConfig(preferredComposable)
                : undefined,
            firstRun ? 'first-run' : loadImageSourcePreference(),
            loadImageCategoryPreference(),
            preferredFractalConfig,
            preferredWavyConfig,
            loadVibrantPreference(),
            preferredRotationEnabled,
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
