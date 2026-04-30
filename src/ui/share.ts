/**
 * sharePuzzle — invoke the OS share sheet if available, otherwise copy
 * the link to the clipboard. Users cancelling a native share sheet
 * (AbortError) do NOT fall through to clipboard — treat cancel as a
 * silent no-op.
 */

export interface SharePuzzleOptions {
    url: string;
    title: string;
    text: string;
    onCopied: () => void;
    onError: (e: Error) => void;
}

export function isWebShareAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function getClipboard(): Clipboard | null {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return null;
    return navigator.clipboard;
}

export async function sharePuzzle(opts: SharePuzzleOptions): Promise<void> {
    const { url, title, text, onCopied, onError } = opts;

    if (isWebShareAvailable()) {
        try {
            await navigator.share({ url, title, text });
            return;
        } catch (e) {
            // Older WebKit throws DOMException for AbortError, which didn't
            // inherit from Error. Match by duck-typed name to cover both.
            if ((e as { name?: string } | null)?.name === 'AbortError') return;
            // fall through to clipboard
        }
    }

    const clipboard = getClipboard();
    if (clipboard) {
        try {
            await clipboard.writeText(url);
            onCopied();
            return;
        } catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)));
            return;
        }
    }

    onError(new Error('No share mechanism available'));
}
