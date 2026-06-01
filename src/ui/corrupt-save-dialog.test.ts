/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createCorruptSaveDialog,
    buildCorruptSaveDownload,
} from './corrupt-save-dialog.js';
import type { CorruptSaveData } from '../persistence/index.js';

const RAW: CorruptSaveData = { geometry: '{bad json', progress: 'progress-blob' };

function mount(overrides?: {
    raw?: CorruptSaveData;
    onDismiss?: () => void;
    triggerDownload?: (filename: string, contents: string) => void;
    now?: () => number;
}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onDismiss = overrides?.onDismiss ?? vi.fn();
    const dismiss = createCorruptSaveDialog({
        container,
        raw: overrides?.raw ?? RAW,
        onDismiss,
        triggerDownload: overrides?.triggerDownload,
        now: overrides?.now ?? (() => 1_700_000_000_000),
    });
    return { container, onDismiss, dismiss };
}

describe('buildCorruptSaveDownload', () => {
    it('produces a timestamped filename and pretty JSON with both blobs', () => {
        const { filename, contents } = buildCorruptSaveDownload(RAW, 1_700_000_000_000);
        expect(filename).toBe('puzzle-corrupt-save-1700000000000.json');

        const parsed = JSON.parse(contents);
        expect(parsed.app).toBe('puzzle');
        expect(parsed.kind).toBe('corrupt-save-backup');
        expect(parsed.geometry).toBe(RAW.geometry);
        expect(parsed.progress).toBe(RAW.progress);
        expect(parsed.savedAt).toBe(new Date(1_700_000_000_000).toISOString());
    });

    it('preserves a null blob as JSON null', () => {
        const { contents } = buildCorruptSaveDownload(
            { geometry: 'g', progress: null },
            1,
        );
        expect(JSON.parse(contents).progress).toBeNull();
    });
});

describe('createCorruptSaveDialog', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('renders a dialog with a title, body and two buttons', () => {
        const { container } = mount();
        const dialog = container.querySelector('.corrupt-save-dialog');
        expect(dialog).not.toBeNull();
        expect(container.querySelector('.corrupt-save-title')!.textContent).toContain(
            "Couldn't restore",
        );
        const buttons = container.querySelectorAll('.corrupt-save-btn');
        expect(buttons.length).toBe(2);
    });

    it('downloads the raw blobs and keeps the dialog open', () => {
        const triggerDownload = vi.fn();
        const { container, onDismiss } = mount({ triggerDownload });

        const downloadBtn = container.querySelector(
            '.corrupt-save-btn--primary',
        ) as HTMLButtonElement;
        downloadBtn.click();

        expect(triggerDownload).toHaveBeenCalledOnce();
        const [filename, contents] = triggerDownload.mock.calls[0];
        expect(filename).toBe('puzzle-corrupt-save-1700000000000.json');
        expect(JSON.parse(contents).geometry).toBe(RAW.geometry);

        // Dialog stays open after download; the button reflects the action.
        expect(container.querySelector('.corrupt-save-dialog')).not.toBeNull();
        expect(downloadBtn.disabled).toBe(true);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('"Start new game" dismisses the dialog and fires onDismiss', () => {
        const { container, onDismiss } = mount();
        const newGameBtn = Array.from(
            container.querySelectorAll<HTMLButtonElement>('.corrupt-save-btn'),
        ).find((b) => b.textContent === 'Start new game')!;

        newGameBtn.click();

        expect(onDismiss).toHaveBeenCalledOnce();
        expect(container.querySelector('.corrupt-save-dialog')).toBeNull();
    });

    it('Escape dismisses and fires onDismiss', () => {
        const { container, onDismiss } = mount();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onDismiss).toHaveBeenCalledOnce();
        expect(container.querySelector('.corrupt-save-dialog')).toBeNull();
    });

    it('a backdrop click does NOT dismiss (data loss guard)', () => {
        const { container, onDismiss } = mount();
        const overlay = container.querySelector('.corrupt-save-overlay') as HTMLElement;
        overlay.click();
        expect(onDismiss).not.toHaveBeenCalled();
        expect(container.querySelector('.corrupt-save-dialog')).not.toBeNull();
    });

    it('fires onDismiss at most once across button + Escape', () => {
        const { container, onDismiss } = mount();
        const newGameBtn = Array.from(
            container.querySelectorAll<HTMLButtonElement>('.corrupt-save-btn'),
        ).find((b) => b.textContent === 'Start new game')!;

        newGameBtn.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(onDismiss).toHaveBeenCalledOnce();
    });
});
