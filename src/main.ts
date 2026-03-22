import './style.css';
import type { GameState } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { setupDragHandling } from './interaction/index.js';
import { createNewGame, processDrop, checkAndMarkWin } from './game/index.js';

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

function startNewGame(): void {
    removeCompletionOverlay();

    if (cleanupDrag) {
        cleanupDrag();
        cleanupDrag = null;
    }

    const viewport = {
        width: app.clientWidth || window.innerWidth,
        height: app.clientHeight || window.innerHeight,
    };

    gameState = createNewGame(
        PUZZLE_IMAGE_URL,
        { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        viewport,
    );

    renderer.renderState(gameState);

    cleanupDrag = setupDragHandling({
        container: app,
        renderer,
        getState: () => gameState,
        onStateChanged: () => renderer.renderState(gameState),
        onDrop: (groupId: number) => {
            const result = processDrop(groupId, gameState);
            if (result) {
                renderer.renderState(gameState);

                if (checkAndMarkWin(gameState)) {
                    showCompletionOverlay();
                }
            }
        },
    });
}

startNewGame();
