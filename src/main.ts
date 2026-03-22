import './style.css';
import type { GameState } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { setupDragHandling, ViewportTransform, ViewportController } from './interaction/index.js';
import { createNewGame, processDrop, checkAndMarkWin } from './game/index.js';
import { loadState, clearSavedState, createDebouncedSave } from './persistence/index.js';
import { createNewGameButton } from './ui/index.js';

const PUZZLE_IMAGE_URL = 'puzzle-image.jpg';
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 600;

const app = document.querySelector<HTMLDivElement>('#app')!;

// Suppress the browser context menu on the puzzle container.
// On touch devices (especially iPad), long-pressing a piece would
// otherwise trigger the context menu, interfering with drag.
app.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Show a "Puzzle Complete!" overlay on top of the puzzle.
 * A simple centered message that fades in.
 */
function showCompletionOverlay(): void {
    // Guard against multiple overlays
    if (document.querySelector('.completion-overlay')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'completion-overlay';
    overlay.innerHTML = `
        <div class="completion-message">
            <h1>🧩 Puzzle Complete!</h1>
        </div>
    `;

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
}

let gameState: GameState;
let cleanupDrag: (() => void) | null = null;

const renderer = new SvgDomRenderer();
renderer.init(app);

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
 * Check if an event target is a puzzle piece hit-area element.
 */
function isPieceElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) {
        return false;
    }

    // Piece hit-areas have data-hit-area="true"
    if ((target as HTMLElement).dataset?.hitArea === 'true') {
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
            const result = processDrop(groupId, gameState);
            if (result) {
                renderer.renderState(gameState);
                autoSave();

                if (checkAndMarkWin(gameState)) {
                    showCompletionOverlay();
                    autoSave();
                }
            }
        },
        screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
    });
}

function startNewGame(): void {
    // Reset viewport transform so pieces are randomized in unzoomed coordinates
    viewportTransform.reset();
    applyViewportTransform();

    const viewport = {
        width: app.clientWidth || window.innerWidth,
        height: app.clientHeight || window.innerHeight,
    };

    const state = createNewGame(
        PUZZLE_IMAGE_URL,
        { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        viewport,
    );

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
        clearSavedState();
        startNewGame();
    },
});

// On load: try to restore a saved game, otherwise start fresh
const savedState = loadState();

if (savedState) {
    initGame(savedState);
} else {
    startNewGame();
}
