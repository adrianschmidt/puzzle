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
import { getActiveTolerance } from './ui/merge-tolerance.js';
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
} from './game/cut-styles.js';
import type { CutStyle } from './game/cut-styles.js';
import { createSizePickerDialog } from './ui/size-picker.js';

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

// Debug helper: solve the puzzle by placing all pieces in their correct positions.
// Merges everything into a single group at (0,0).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__solvePuzzle = () => {
    if (!gameState) return;

    // Create a single group containing all pieces at their solved offsets
    const solvedGroup: import('./model/types.js').PieceGroup = {
        id: 0,
        pieces: new Map(),
        position: { x: 0, y: 0 },
    };

    for (const piece of gameState.pieces) {
        // Solved offset = negative of imageOffset (where the piece belongs in the image)
        solvedGroup.pieces.set(piece.id, {
            x: -piece.imageOffset.x,
            y: -piece.imageOffset.y,
        });
    }

    gameState.groups = [solvedGroup];
    gameState.completed = true;
    renderer.renderState(gameState);
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

    if (cleanupDrag) {
        cleanupDrag();
        cleanupDrag = null;
    }

    gameState = state;
    renderer.renderState(gameState);
    updateAttribution();

    if (gameState.completed) {
        showCompletionOverlay();
    }

    cleanupDrag = setupDragHandling({
        container: app,
        renderer,
        getState: () => gameState,
        onStateChanged: () => {
            renderer.renderState(gameState);
            autoSave();
        },
        onDrop: (groupId: number) => {
            const result = processDrop(groupId, gameState, getActiveTolerance());
            if (result) {
                renderer.renderState(gameState);
                renderer.flashMergePulse(result.group.id);
                autoSave();

                if (checkAndMarkWin(gameState)) {
                    showCompletionOverlay();
                    autoSave();
                }
            }
        },
        screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
        panViewport: (screenDelta) => {
            viewportTransform.pan(screenDelta);
            applyViewportTransform();
        },
    });
}

/**
 * Start a new game, fetching a random Unsplash image if available.
 * Falls back to the default image if the API key is missing or fetch fails.
 *
 * @param gridSize - Grid dimensions (cols × rows) for the puzzle
 * @param cutStyle - Cut style to use for piece generation
 */
async function startNewGame(gridSize: GridSize, cutStyle: CutStyle = 'classic'): Promise<void> {
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

    // Try to fetch a random Unsplash image
    const accessKey = getUnsplashAccessKey();

    if (accessKey) {
        try {
            const result = await fetchRandomImage(accessKey);

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

    const state = createNewGame(imageUrl, imageSize, viewport, gridSize, { cutStyle });

    if (attribution) {
        state.attribution = attribution;
    }

    initGame(state);
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
        createSizePickerDialog({
            container: app,
            selectedIndex: preferredIndex,
            selectedCutStyleIndex: preferredCutStyleIndex,
            onSelect: (index, cutStyleIndex) => {
                saveSizePreference(index);
                const resolvedCutStyleIndex = cutStyleIndex ?? preferredCutStyleIndex;
                saveCutStylePreference(resolvedCutStyleIndex);
                const option = getSizeOption(index);
                const cutStyle = getCutStyleOption(resolvedCutStyleIndex).id;
                clearSavedState();
                void startNewGame(toGridSize(option), cutStyle);
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
        // Compute the visible area in world coordinates
        const screenWidth = app.clientWidth || window.innerWidth;
        const screenHeight = app.clientHeight || window.innerHeight;

        const topLeft = viewportTransform.screenToWorld({ x: 0, y: 0 });
        const bottomRight = viewportTransform.screenToWorld({
            x: screenWidth,
            y: screenHeight,
        });

        const visibleArea = {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
        };

        const pieceWidth = gameState.imageSize.width / gameState.gridSize.cols;
        const pieceHeight = gameState.imageSize.height / gameState.gridSize.rows;

        const positions = computeGatheredPositions(
            gameState.groups,
            visibleArea,
            pieceWidth,
            pieceHeight,
            gameState.gridSize.cols,
            gameState.gridSize.rows,
        );

        applyGatheredPositions(gameState.groups, positions);
        renderer.renderState(gameState);
        autoSave();
    },
});

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
    void startNewGame(toGridSize(option), preferredCutStyle);
}
