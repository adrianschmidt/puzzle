/**
 * Corrupt-save dialog — modal shown at startup when a saved puzzle was found
 * but could not be restored (corruption, unsupported version, torn pair).
 *
 * Rather than silently regenerating over the unreadable data, the app stops
 * and offers the player a chance to download a verbatim copy of the raw save
 * blobs (for recovery or a bug report) before starting a new game. Any
 * dismissal path — the "Start new game" button or Escape — resolves through
 * `onDismiss`, which the host uses to proceed with the fresh-start boot.
 */

import type { CorruptSaveData } from '../persistence/index.js';
import { createDismissableOverlay } from './dismissable-overlay.js';

export interface CorruptSaveDialogOptions {
    /** Container to append the dialog to. */
    container: HTMLElement;
    /** Raw blobs captured from the unreadable save, offered for download. */
    raw: CorruptSaveData;
    /**
     * Fires once when the player closes the dialog (via "Start new game" or
     * Escape). The host proceeds with a fresh puzzle from here. `downloaded`
     * reports whether the player took a copy of the raw data first, for
     * recovery-usage telemetry.
     */
    onDismiss: (info: { downloaded: boolean }) => void;
    /**
     * Injectable download trigger. Defaults to an anchor-click download of a
     * JSON file. Overridden in tests to capture the filename/contents without
     * touching the real download machinery.
     */
    triggerDownload?: (filename: string, contents: string) => void;
    /** Injectable clock for the download filename/timestamp. Defaults to Date.now. */
    now?: () => number;
}

/** Default download mechanism: a JSON blob saved via a transient anchor. */
function anchorDownload(filename: string, contents: string): void {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Build the JSON payload and filename for a corrupt-save download. */
export function buildCorruptSaveDownload(
    raw: CorruptSaveData,
    timestamp: number,
): { filename: string; contents: string } {
    const contents = JSON.stringify(
        {
            app: 'puzzle',
            kind: 'corrupt-save-backup',
            savedAt: new Date(timestamp).toISOString(),
            geometry: raw.geometry,
            progress: raw.progress,
        },
        null,
        2,
    );
    return { filename: `puzzle-corrupt-save-${timestamp}.json`, contents };
}

export function createCorruptSaveDialog(options: CorruptSaveDialogOptions): () => void {
    const {
        container,
        raw,
        onDismiss,
        triggerDownload = anchorDownload,
        now = Date.now,
    } = options;

    let downloaded = false;
    let proceeded = false;
    function proceed(): void {
        if (proceeded) return;
        proceeded = true;
        onDismiss({ downloaded });
    }

    // No backdrop dismissal: losing the only copy of the data to a stray
    // click would defeat the point. Escape still works (it routes through
    // onDismiss, same as "Start new game").
    const { overlay, dismiss } = createDismissableOverlay({
        container,
        className: 'corrupt-save-overlay',
        dismissOn: 'none',
        onDismiss: proceed,
    });

    const dialog = document.createElement('div');
    dialog.className = 'corrupt-save-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Saved puzzle could not be restored');

    const title = document.createElement('h2');
    title.className = 'corrupt-save-title';
    title.textContent = "Couldn't restore your saved puzzle";
    dialog.appendChild(title);

    const body = document.createElement('p');
    body.className = 'corrupt-save-body';
    body.textContent =
        'Your saved puzzle is present but could not be read, so a new one will ' +
        'be started. You can download a copy of the unreadable data first — to ' +
        'recover it later or to report the problem.';
    dialog.appendChild(body);

    const buttons = document.createElement('div');
    buttons.className = 'corrupt-save-buttons';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'corrupt-save-btn corrupt-save-btn--primary';
    downloadBtn.textContent = 'Download a copy';
    downloadBtn.addEventListener('click', () => {
        const { filename, contents } = buildCorruptSaveDownload(raw, now());
        triggerDownload(filename, contents);
        downloaded = true;
        // Keep the dialog open after a download so the player can read it and
        // then dismiss deliberately; mark the button as done for feedback.
        downloadBtn.textContent = 'Downloaded ✓';
        downloadBtn.disabled = true;
        // Disabling the focused button would drop focus to <body>; move it to
        // the remaining action so keyboard/screen-reader users keep a focus
        // anchor and hear the next step announced.
        newGameBtn.focus();
    });
    buttons.appendChild(downloadBtn);

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'corrupt-save-btn';
    newGameBtn.textContent = 'Start new game';
    newGameBtn.addEventListener('click', () => {
        dismiss();
        proceed();
    });
    buttons.appendChild(newGameBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    return dismiss;
}
