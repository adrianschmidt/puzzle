/**
 * A dropped preference write is not an error, it is a setting that
 * quietly reverts the next time the player opens the dialog. Keeping the
 * writes as one flat sequence — rather than folding some into a shared
 * helper — is deliberate: each one stays independently greppable against
 * its `load*` counterpart.
 */

import type { GridSize } from '../model/types.js';
import type { CutStyle } from '../game/cut-styles.js';
import { loadCutStylePreference, saveCutStylePreference } from '../game/cut-styles.js';
import {
    loadSizePreference,
    saveSizePreference,
    getSizeOption,
    toGridSize,
} from '../game/puzzle-sizes.js';
import {
    loadComposableConfigPreference,
    saveComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from '../game/composable-config.js';
import {
    loadFractalConfigPreference,
    saveFractalConfigPreference,
} from '../game/fractal-config.js';
import {
    loadWavyConfigPreference,
    saveWavyConfigPreference,
} from '../game/wavy-config.js';
import { saveImageSourcePreference } from '../game/image-source.js';
import {
    loadImageCategoryPreference,
    saveImageCategoryPreference,
    loadVibrantPreference,
    saveVibrantPreference,
} from '../game/image-categories.js';
import { getImageProxyBaseUrl } from '../images/index.js';
import { getBaseCutGenerator } from '../puzzle/topology/generator-registry.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import {
    createNewGameDialog,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
} from '../ui/index.js';
import { fetchCandidateImages } from './fetch-candidate-images.js';
import { orientationForViewport } from './orientation.js';
import { runWithErrorReport } from './run-with-error-report.js';
import type { StartNewGameOptions } from './start-new-game.js';

export interface OpenNewGameDialogDeps {
    container: HTMLElement;
    start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
}

export function openNewGameDialog(deps: OpenNewGameDialogDeps): void {
    const preferredSizeId = loadSizePreference();
    const preferredCutStyleId = loadCutStylePreference();
    const savedComposableConfig = loadComposableConfigPreference();
    const savedFractalConfig = loadFractalConfigPreference();
    const savedRotationEnabled = loadRotationEnabledPreference();
    const savedImageCategory = loadImageCategoryPreference();
    const savedVibrant = loadVibrantPreference();

    createNewGameDialog({
        container: deps.container,
        selectedSizeId: preferredSizeId,
        selectedCutStyleId: preferredCutStyleId,
        savedComposableConfig,
        savedFractalConfig,
        savedWavyConfig: loadWavyConfigPreference(),
        savedRotationEnabled,
        composableSupportsBorderless:
            getBaseCutGenerator('sine').supportsBorderless ?? false,
        savedImageCategory,
        savedVibrant,
        fetchImageCandidates: (() => {
            const proxyBaseUrl = getImageProxyBaseUrl();
            if (!proxyBaseUrl) return undefined;
            return (imageCategory: string, vibrant: boolean) =>
                fetchCandidateImages(
                    proxyBaseUrl,
                    imageCategory,
                    vibrant,
                    orientationForViewport({
                        width: deps.container.clientWidth || window.innerWidth,
                        height: deps.container.clientHeight || window.innerHeight,
                    }),
                );
        })(),
        onPreloadTracedTabs: () => {
            // Fire-and-forget — preloadTracedTabGenerator is
            // idempotent and clears its cached promise on failure,
            // so the eventual `await` in startNewGame triggers a
            // fresh attempt that surfaces the real error. Swallow
            // here only to stop the in-flight rejection from
            // surfacing as an unhandled-rejection warning.
            preloadTracedTabGenerator().catch(() => {});
        },
        onSelect: ({ sizeId, cutStyleId, composableConfig, fractalConfig, wavyConfig, rotationEnabled, imageChoice, imageCategory, vibrant }) => {
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
            // No UI reads this preference anymore, but first-run
            // detection depends on the key existing, and analytics
            // still classifies by it.
            saveImageSourcePreference(imageChoice.kind === 'blank' ? 'blank' : 'random');
            saveImageCategoryPreference(imageCategory);
            saveVibrantPreference(vibrant);

            const option = getSizeOption(sizeId);
            const cutStyle = cutStyleId as CutStyle;
            // The current save is deliberately left alone here — `deps.start`
            // (`startNewGame`) persists the new puzzle only once generation
            // fully succeeds, so a cancel (the loading overlay's Cancel
            // affordance, #489) or a throw leaves the previous save intact,
            // matching the in-memory puzzle the player is left with. An eager
            // clear here used to destroy that save on every one of those
            // paths — the same defect as `share-link-loader.ts`'s. Also: a
            // new puzzle whose geometry exceeds the storage quota writes
            // nothing at all (#399), so the PREVIOUS puzzle stays on disk
            // under a different puzzle on screen and a reload resumes it.
            const newGame = deps.start(toGridSize(option), {
                cutStyle,
                composableConfig: composableConfig
                    ? composableSliderToGeneratorConfig(composableConfig)
                    : undefined,
                imageSource: imageChoice.kind === 'blank' ? 'blank' : 'random',
                imageCategory,
                fractalConfig,
                wavyConfig,
                vibrant,
                rotationEnabled,
                // seed omitted — fresh random for every dialog game
                pickedImage: imageChoice.kind === 'photo' ? imageChoice.photo : undefined,
            });
            void runWithErrorReport({
                // The chunk-load path (traced tabs lazy import) is the most
                // likely source of a rejection here — a network blip or
                // stale deploy hash. The user gets a toast so the click
                // doesn't silently do nothing; `new-game-failed` records it.
                run: () => newGame,
                warnMessage: 'Failed to start new game:',
                event: 'new-game-failed',
                cutStyle,
                toastMessage: "Couldn't start new game",
                fallback: undefined,
            });
        },
    });
}
