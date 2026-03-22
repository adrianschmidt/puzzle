import './style.css';
import type { GameState } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { setupDragHandling } from './interaction/index.js';
import { createNewGame, processDrop, checkAndMarkWin } from './game/index.js';
import { loadState, createDebouncedSave } from './persistence/index.js';

const PUZZLE_IMAGE_URL = 'puzzle-image.jpg';
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 600;

const app = document.querySelector<HTMLDivElement>('#app')!;

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
    });
}

function startNewGame(): void {
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

// On load: try to restore a saved game, otherwise start fresh
const savedState = loadState();

if (savedState) {
    initGame(savedState);
} else {
    startNewGame();
}
