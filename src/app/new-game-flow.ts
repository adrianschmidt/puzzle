/**
 * The preference writes are kept as one flat sequence, not folded into a
 * helper, so each stays independently greppable against its `load*`
 * counterpart. A dropped write just reverts that setting next time.
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
import { isOfflineStashSupported, stashCount } from '../images/offline-stash.js';
import { getBaseCutGenerator } from '../puzzle/topology/generator-registry.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import {
    createNewGameDialog,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
} from '../ui/index.js';
import { downloadOfflineImagesForCategory } from './download-offline-images.js';
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
    const proxyBaseUrl = getImageProxyBaseUrl();

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
        offlineImages: (() => {
            if (!proxyBaseUrl || !isOfflineStashSupported()) return undefined;
            return {
                count: stashCount,
                download: (
                    imageCategory: string,
                    vibrant: boolean,
                    onProgress: (done: number, total: number) => void,
                ) =>
                    downloadOfflineImagesForCategory(
                        proxyBaseUrl,
                        imageCategory,
                        vibrant,
                        orientationForViewport({
                            width: deps.container.clientWidth || window.innerWidth,
                            height: deps.container.clientHeight || window.innerHeight,
                        }),
                        onProgress,
                    ),
            };
        })(),
        onPreloadTracedTabs: () => {
            // Fire-and-forget: `preloadTracedTabGenerator` is idempotent and
            // clears its cached promise on failure, so `startNewGame`'s await
            // retries and surfaces the real error. Swallow only to avoid an
            // unhandled-rejection warning.
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
            // No UI reads this preference, but first-run detection depends on
            // the key existing and analytics still classifies by it.
            saveImageSourcePreference(imageChoice.kind === 'blank' ? 'blank' : 'random');
            saveImageCategoryPreference(imageCategory);
            saveVibrantPreference(vibrant);

            const option = getSizeOption(sizeId);
            const cutStyle = cutStyleId as CutStyle;
            // The current save is left alone: `deps.start` persists the new
            // puzzle only once generation fully succeeds, so a cancel (#489) or
            // throw leaves the previous save intact, matching the in-memory
            // puzzle the player keeps. An eager clear used to destroy it on
            // those paths. Also, a puzzle exceeding the storage quota writes
            // nothing (#399), so the previous puzzle stays on disk and a reload
            // resumes it.
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
                // The traced-tab chunk load is the likeliest rejection here (a
                // network blip or stale deploy hash). The toast keeps the click
                // from silently doing nothing; `new-game-failed` records it.
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
