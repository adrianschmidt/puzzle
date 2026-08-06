/**
 * Boot flow: on load, a `#p=` share link wins over a saved game, which wins
 * over a fresh start.
 *
 * `index.html` renders the loading overlay up front so the player sees
 * feedback before JS finishes booting.
 *
 * An unreadable save (present but not restorable) stops the flow before a
 * fresh puzzle can overwrite it: the player is shown a recovery dialog with
 * the raw blobs and boot only continues once they dismiss it, so a fresh
 * start can never race ahead of that decision.
 */

import type { GridSize } from '../model/types.js';
import type { GameSession } from './game-session.js';
import type { ViewportTransform } from '../interaction/index.js';
import type { StartNewGameOptions } from './start-new-game.js';
import type { CutStyle } from '../game/cut-styles.js';
import { loadSavedGame } from '../persistence/index.js';
import {
    createCorruptSaveDialog,
    hideLoadingOverlay,
    loadRotationEnabledPreference,
} from '../ui/index.js';
import { startWithBootFallback } from './start-with-boot-fallback.js';
import { loadSizePreference, getSizeOption, toGridSize } from '../game/puzzle-sizes.js';
import { loadCutStylePreference } from '../game/cut-styles.js';
import {
    loadComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from '../game/composable-config.js';
import { loadFractalConfigPreference } from '../game/fractal-config.js';
import { loadWavyConfigPreference } from '../game/wavy-config.js';
import {
    loadImageSourcePreference,
    imageSourcePreferenceExists,
} from '../game/image-source.js';
import {
    loadImageCategoryPreference,
    loadVibrantPreference,
    imageCategoryPreferenceExists,
} from '../game/image-categories.js';
import { track } from '../analytics/index.js';

export interface BootSequenceDeps {
    container: HTMLElement;
    /**
     * Deliberately not `current` — the fallback gate turns on `hasGame`,
     * and the two are not interchangeable (see `game-session.ts`).
     */
    session: Pick<GameSession, 'install' | 'restoreSelection' | 'hasGame'>;
    viewportTransform: ViewportTransform;
    /** Push the viewport transform to the renderer without persisting it. */
    applyTransform: () => void;
    /** Handle a `#p=` link; true means the boot flow must not start a puzzle. */
    tryLoadShared: () => Promise<boolean>;
    /** True when a rescue reload is imminent — leave the overlay up. */
    isRescueReloadPending: () => boolean;
    start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
}

/**
 * Always tears down the pre-boot loading overlay — except when a share-link
 * rescue reload is about to land, in which case leaving the overlay up
 * avoids a blank-page flash for the up-to-3s gap before the reload fires.
 */
export async function runBootSequence(deps: BootSequenceDeps): Promise<void> {
    try {
        const loadedFromShare = await deps.tryLoadShared();
        if (loadedFromShare) return;

        const saved = loadSavedGame();
        if (saved.status === 'ok') {
            deps.session.install(saved.state);
            deps.session.restoreSelection(saved.selection);
            if (saved.viewport) {
                // Restore the zoom/pan the player last had (#420). Absent on
                // pre-feature saves — those keep the default view, as before.
                deps.viewportTransform.setState(saved.viewport);
                deps.applyTransform();
            }
            return;
        }
        if (saved.status === 'unreadable') {
            // Stop before the fresh puzzle overwrites the unreadable save:
            // let the player download the raw (in-memory) blobs for
            // recovery. The pre-boot loading overlay (z-index above the
            // dialog) is hidden so the modal is visible.
            track('save-unreadable', { reason: saved.reason });
            hideLoadingOverlay();
            await new Promise<void>((resolve) => {
                createCorruptSaveDialog({
                    container: deps.container,
                    raw: saved.raw,
                    onDismiss: ({ downloaded }) => {
                        track('save-recovery', { downloaded });
                        resolve();
                    },
                });
            });
        }

        // Mirror the New Game dialog path so a first-load (or post-regeneration) puzzle
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
        const gridSize = toGridSize(option);
        const imageSource = firstRun ? 'first-run' : loadImageSourcePreference();
        const imageCategory = loadImageCategoryPreference();
        const vibrant = loadVibrantPreference();

        await startWithBootFallback({
            cutStyle: preferredCutStyle,
            start: () => deps.start(gridSize, {
                cutStyle: preferredCutStyle,
                composableConfig: preferredCutStyle === 'composable' && preferredComposable
                    ? composableSliderToGeneratorConfig(preferredComposable)
                    : undefined,
                imageSource,
                imageCategory,
                fractalConfig: preferredFractalConfig,
                wavyConfig: preferredWavyConfig,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // Everything except the cut is kept: same size, image source,
            // category, vibrancy, rotation. The per-style configs are
            // deliberately dropped — with the style forced to Classic they
            // are dead weight, and a saved Composable config the build
            // cannot generate is one of the failures being recovered from.
            startFallback: () => deps.start(gridSize, {
                bootFallback: true,
                imageSource,
                imageCategory,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // Deliberately not `deps.session.current() !== undefined`:
            // `GameSession.install` makes the state current before it
            // renders and wires interaction, so a throw inside that window
            // would report "a puzzle reached the screen" over a blank or
            // undraggable canvas — the fallback skipped and no toast shown,
            // which is the #488 symptom again. `hasGame()` is false until
            // the interaction teardown handle is assigned, which is
            // `install`'s last statement, so it means exactly what this
            // predicate has to mean. (A throw in that window makes the
            // fallback re-run `install` and most likely fail the same way —
            // but then the player gets told.)
            hasGame: () => deps.session.hasGame(),
        });
    } finally {
        if (!deps.isRescueReloadPending()) hideLoadingOverlay();
    }
}
