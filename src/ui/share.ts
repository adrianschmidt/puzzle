/**
 * OS share sheet if available, else copy to clipboard. A cancelled native share
 * (AbortError) is a silent no-op — it does NOT fall through to clipboard.
 */

export interface SharePuzzleOptions {
    url: string;
    title: string;
    text: string;
    /**
     * Fires only on the successful clipboard-fallback path (share unavailable or
     * threw non-AbortError, then clipboard write succeeded). Native share success
     * and AbortError cancel both fire nothing.
     */
    onClipboardFallback: () => void;
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
    const { url, title, text, onClipboardFallback, onError } = opts;

    if (isWebShareAvailable()) {
        try {
            await navigator.share({ url, title, text });
            return;
        } catch (e) {
            // Older WebKit throws a DOMException for AbortError that doesn't
            // inherit from Error; match by duck-typed name to cover both.
            if ((e as { name?: string } | null)?.name === 'AbortError') return;
        }
    }

    const clipboard = getClipboard();
    if (clipboard) {
        try {
            await clipboard.writeText(url);
            onClipboardFallback();
            return;
        } catch (e) {
            onError(e instanceof Error ? e : new Error(String(e)));
            return;
        }
    }

    onError(new Error('No share mechanism available'));
}
