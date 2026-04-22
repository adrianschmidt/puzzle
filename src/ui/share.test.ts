import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sharePuzzle } from './share.js';

function stubNavigator(stub: Partial<Navigator>): void {
    Object.defineProperty(globalThis, 'navigator', {
        value: stub,
        configurable: true,
    });
}

describe('sharePuzzle', () => {
    let onCopied: ReturnType<typeof vi.fn<() => void>>;
    let onError: ReturnType<typeof vi.fn<(e: Error) => void>>;

    beforeEach(() => {
        onCopied = vi.fn<() => void>();
        onError = vi.fn<(e: Error) => void>();
    });

    it('prefers navigator.share when available', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ share } as unknown as Navigator);

        await sharePuzzle({
            url: 'https://example/#p=x',
            title: 't', text: 'd',
            onCopied, onError,
        });

        expect(share).toHaveBeenCalledWith({
            url: 'https://example/#p=x', title: 't', text: 'd',
        });
        expect(onCopied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('swallows AbortError without falling back', async () => {
        const share = vi.fn().mockRejectedValue(
            Object.assign(new Error('cancelled'), { name: 'AbortError' }),
        );
        const writeText = vi.fn();
        stubNavigator({ share, clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).not.toHaveBeenCalled();
        expect(onCopied).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('falls back to clipboard when navigator.share is missing', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).toHaveBeenCalledWith('u');
        expect(onCopied).toHaveBeenCalledTimes(1);
    });

    it('falls back to clipboard on a non-Abort share error', async () => {
        const share = vi.fn().mockRejectedValue(new Error('boom'));
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubNavigator({ share, clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(writeText).toHaveBeenCalledWith('u');
        expect(onCopied).toHaveBeenCalledTimes(1);
    });

    it('calls onError when clipboard fails', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('no clip'));
        stubNavigator({ clipboard: { writeText } } as unknown as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('calls onError when neither share nor clipboard is available', async () => {
        stubNavigator({} as Navigator);

        await sharePuzzle({
            url: 'u', title: 't', text: 'd',
            onCopied, onError,
        });

        expect(onError).toHaveBeenCalledTimes(1);
    });
});
