/**
 * The background-color state: the currently-selected preset id, the swatch
 * picker, the OS-theme re-apply, and the piece-outline setup that shares
 * this module because it's installed at the same point in boot.
 *
 * `currentColorId` has two independent readers — the OS-theme change
 * handler (which recomputes the luminance-derived chrome scheme on a
 * light/dark flip) and the share-link path (which offers a sharer's color
 * to a recipient who never picked one). Before this module existed, the
 * share path reached into the module global *and* the picker separately;
 * missing either half left the OS-theme handler re-applying a stale color
 * after adoption. Consolidating both readers behind one `adopt()` makes
 * that split impossible.
 */

import {
    loadColorPreference,
    saveColorPreference,
    applyBackgroundColor,
    adoptSharedBackgroundColor,
    onColorSchemeChange,
    createBackgroundColorPicker,
    installPieceOutlineFilter,
    loadPieceOutlinePreference,
    applyPieceOutline,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
} from '../ui/index.js';
import { track } from '../analytics/index.js';

/** The background-color module's public surface. */
export interface BackgroundColorControl {
    /**
     * Offer a sharer's color to a recipient who never picked one. Returns
     * the adoption outcome for analytics; 'none' (the link carried no
     * color at all) is the caller's business, not this module's.
     *
     * On `'adopted'`, updates both the closed-over id and the picker's
     * selection — the pair that keeps a later OS-theme re-apply correct.
     */
    adopt(id: string): 'adopted' | 'kept-own' | 'invalid';
}

/**
 * Install the background-color picker and the piece-outline setup, and
 * return the handle the share path uses to offer a sharer's color.
 */
export function installBackgroundColor(deps: {
    container: HTMLElement;
}): BackgroundColorControl {
    const { container } = deps;

    // Install the SVG filter used by the "Outline" piece-outline mode and
    // apply the saved style + color preferences. The color itself flips
    // with the OS theme via CSS, so (unlike the background) no re-apply on
    // theme change is needed.
    installPieceOutlineFilter();
    applyPieceOutline(loadPieceOutlinePreference());
    applyPieceOutlineColor(loadPieceOutlineColorPreference());

    let currentColorId = loadColorPreference();
    applyBackgroundColor(currentColorId);

    // The background color flips with the OS theme via CSS; re-apply only
    // to recompute the luminance-derived UI-chrome scheme on the flip.
    onColorSchemeChange(() => applyBackgroundColor(currentColorId));

    const picker = createBackgroundColorPicker({
        container,
        selectedId: currentColorId,
        onSelect: (id) => {
            // Re-selecting the current swatch is a no-op, not a switch.
            if (id !== currentColorId) {
                track('background-color-changed', { from: currentColorId, to: id });
            }
            currentColorId = id;
            saveColorPreference(id);
            applyBackgroundColor(id);
        },
    });

    return {
        adopt(id: string): 'adopted' | 'kept-own' | 'invalid' {
            const outcome = adoptSharedBackgroundColor(id);
            if (outcome === 'adopted') {
                currentColorId = id;
                picker.setSelected(id);
            }
            return outcome;
        },
    };
}
