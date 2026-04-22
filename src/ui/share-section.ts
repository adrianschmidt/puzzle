/**
 * Build and wire the "Share this puzzle" section for the info modal.
 * DOM-building is done via createElement so we don't hand-build HTML
 * strings here; the parent modal owns its HTML template.
 */

import type { GameState } from '../model/types.js';
import {
    buildShareUrl,
    gameStateToPayload,
    hasShareableProgress,
} from '../sharing/index.js';
import { sharePuzzle } from './share.js';
import { showToast } from './toast.js';

export function attachShareSection(
    parent: HTMLElement,
    state: GameState,
    baseUrl: string,
): void {
    const webShareAvailable =
        typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const section = document.createElement('section');
    section.className = 'info-section share-section';

    const h = document.createElement('h3');
    h.textContent = 'Share this puzzle';
    section.appendChild(h);

    const explainer = document.createElement('p');
    explainer.textContent = 'Send this link to share the same puzzle with a friend.';
    section.appendChild(explainer);

    // Checkbox row
    const label = document.createElement('label');
    label.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.testid = 'share-include-progress';

    const labelText = document.createElement('span');
    labelText.className = 'info-setting-label';
    labelText.textContent = 'Include my current progress';

    label.appendChild(checkbox);
    label.appendChild(labelText);
    section.appendChild(label);

    const hint = document.createElement('p');
    hint.className = 'info-setting-description';
    hint.dataset.testid = 'share-progress-hint';
    section.appendChild(hint);

    // Primary button
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'share-primary-btn';
    button.dataset.testid = 'share-primary-btn';
    button.textContent = webShareAvailable ? 'Share\u2026' : 'Copy link';
    section.appendChild(button);

    // URL preview
    const preview = document.createElement('div');
    preview.className = 'share-url-preview';
    preview.dataset.testid = 'share-url-preview';
    section.appendChild(preview);

    // Wiring
    const progressAvailable = hasShareableProgress(state);
    const completed = !!state.completed;
    if (!progressAvailable && completed) {
        checkbox.disabled = true;
        hint.textContent = 'Puzzle is already complete.';
    } else if (!progressAvailable) {
        checkbox.disabled = true;
        hint.textContent = 'Make some progress first, then you can share it.';
    } else {
        checkbox.disabled = false;
        hint.textContent = 'Off by default. Turning this on makes the link longer.';
    }

    function currentUrl(): string {
        const payload = gameStateToPayload(state, {
            includeProgress: checkbox.checked && !checkbox.disabled,
        });
        return buildShareUrl(baseUrl, payload);
    }

    function refreshPreview(): void {
        preview.textContent = currentUrl();
    }
    refreshPreview();
    checkbox.addEventListener('change', refreshPreview);

    button.addEventListener('click', () => {
        void sharePuzzle({
            url: currentUrl(),
            title: 'Puzzle',
            text: 'Have a go at this puzzle!',
            onCopied: () => showToast('Link copied to clipboard'),
            onError: (e) => showToast(`Couldn't share: ${e.message}`),
        });
    });

    parent.appendChild(section);
}
