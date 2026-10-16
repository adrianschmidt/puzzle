/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { collectMoveEntries, runMoveHandoff } from './move-sender.js';
import { encodeMoveMessage } from './move-protocol.js';
import { MOVED_TO_KEY } from './move-config.js';

const TARGET_URL = 'https://puzzlewise.github.io/';
const TARGET_ORIGIN = 'https://puzzlewise.github.io';

function messageFrom(source: unknown, origin: string, data: unknown): MessageEvent {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

function start(options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    const popup = { postMessage: vi.fn() };
    const open = vi.fn(() => popup as unknown as Window);
    const result = runMoveHandoff({ targetUrl: TARGET_URL, open, ...options });
    const send = (data: unknown, origin = TARGET_ORIGIN, source: unknown = popup): void => {
        window.dispatchEvent(messageFrom(source, origin, data));
    };
    return { popup, open, result, send };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
});

describe('collectMoveEntries', () => {
    it('collects puzzle-* keys except the moved marker', () => {
        localStorage.setItem('puzzle-cut-style', 'wavy');
        localStorage.setItem('puzzle-game-state', 'g');
        localStorage.setItem(MOVED_TO_KEY, TARGET_URL);
        localStorage.setItem('other', 'x');

        expect(collectMoveEntries(localStorage)).toEqual({
            'puzzle-cut-style': 'wavy',
            'puzzle-game-state': 'g',
        });
    });
});

describe('runMoveHandoff', () => {
    it('opens the receive URL', () => {
        const { open } = start();
        expect(open).toHaveBeenCalledWith('https://puzzlewise.github.io/?receive-move');
    });

    it('opens one named window so a retry reuses it', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await runMoveHandoff({ targetUrl: TARGET_URL });
        expect(open).toHaveBeenCalledWith('https://puzzlewise.github.io/?receive-move', 'puzzle-move');
        open.mockRestore();
    });

    it('reports a blocked popup', async () => {
        await expect(runMoveHandoff({ targetUrl: TARGET_URL, open: () => null }))
            .resolves.toEqual({ status: 'popup-blocked' });
    });

    it('sends the entries to the target origin on ready, then records done', async () => {
        localStorage.setItem('puzzle-cut-style', 'wavy');
        const { popup, result, send } = start();

        send(encodeMoveMessage({ kind: 'ready' }));
        expect(popup.postMessage).toHaveBeenCalledWith(
            encodeMoveMessage({ kind: 'payload', entries: { 'puzzle-cut-style': 'wavy' } }),
            TARGET_ORIGIN,
        );

        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'done' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBe(TARGET_URL);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('wavy');
    });

    it('ignores messages from another origin or window', () => {
        const { popup, send } = start();
        send(encodeMoveMessage({ kind: 'ready' }), 'https://evil.example');
        send(encodeMoveMessage({ kind: 'ready' }), TARGET_ORIGIN, {});
        expect(popup.postMessage).not.toHaveBeenCalled();
    });

    it('ignores a result that arrives before ready', async () => {
        const { result, send } = start();
        send(encodeMoveMessage({ kind: 'done' }));
        send(encodeMoveMessage({ kind: 'ready' }));
        send(encodeMoveMessage({ kind: 'declined' }));
        await expect(result).resolves.toEqual({ status: 'declined' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });

    it('relays a failure reason without recording the move', async () => {
        const { result, send } = start();
        send(encodeMoveMessage({ kind: 'ready' }));
        send(encodeMoveMessage({ kind: 'failed', reason: 'write-failed' }));
        await expect(result).resolves.toEqual({ status: 'failed', reason: 'write-failed' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });

    it('times out when ready never arrives', async () => {
        vi.useFakeTimers();
        const { result } = start({ timeoutMs: 1000 });
        vi.advanceTimersByTime(1000);
        await expect(result).resolves.toEqual({ status: 'timeout' });
    });

    it('does not count the ready timeout while this page is hidden', async () => {
        vi.useFakeTimers();
        const setVisibility = (state: DocumentVisibilityState): void => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        };
        setVisibility('hidden');
        try {
            const { result } = start({ timeoutMs: 1000 });
            let settled = false;
            void result.then(() => { settled = true; });

            vi.advanceTimersByTime(5000);
            await Promise.resolve();
            expect(settled).toBe(false);

            setVisibility('visible');
            vi.advanceTimersByTime(1000);
            await expect(result).resolves.toEqual({ status: 'timeout' });
        } finally {
            Reflect.deleteProperty(document, 'visibilityState');
        }
    });

    describe('when the page is hidden after the move starts', () => {
        const setVisibility = (state: DocumentVisibilityState): void => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        };

        afterEach(() => {
            Reflect.deleteProperty(document, 'visibilityState');
        });

        it('stops the ready timeout until the page is visible again', async () => {
            vi.useFakeTimers();
            const { result } = start({ timeoutMs: 1000 });
            let settled = false;
            void result.then(() => { settled = true; });

            setVisibility('hidden');
            vi.advanceTimersByTime(5000);
            await Promise.resolve();
            expect(settled).toBe(false);
        });

        it('does not restart the timeout once ready has arrived', async () => {
            vi.useFakeTimers();
            const { result, send } = start({ timeoutMs: 1000 });
            send(encodeMoveMessage({ kind: 'ready' }));

            setVisibility('hidden');
            setVisibility('visible');
            vi.advanceTimersByTime(5000);
            send(encodeMoveMessage({ kind: 'done' }));

            await expect(result).resolves.toEqual({ status: 'done' });
        });
    });

    it('sends the entries again when a reloaded new-site tab announces itself again', () => {
        const { popup, send } = start();
        send(encodeMoveMessage({ kind: 'ready' }));
        send(encodeMoveMessage({ kind: 'ready' }));
        expect(popup.postMessage).toHaveBeenCalledTimes(2);
    });

    it('stops waiting for the ready timeout once ready arrives', async () => {
        vi.useFakeTimers();
        const { result, send } = start({ timeoutMs: 1000 });
        send(encodeMoveMessage({ kind: 'ready' }));
        vi.advanceTimersByTime(5000);
        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'done' });
    });

    it('reports a popup closed before the move finished', async () => {
        vi.useFakeTimers();
        const popup = { postMessage: vi.fn(), closed: false };
        const result = runMoveHandoff({ targetUrl: TARGET_URL, open: () => popup as unknown as Window });
        window.dispatchEvent(messageFrom(popup, TARGET_ORIGIN, encodeMoveMessage({ kind: 'ready' })));
        popup.closed = true;
        vi.advanceTimersByTime(1000);
        await expect(result).resolves.toEqual({ status: 'closed' });
    });

    it('resolves canceled on abort and ignores a later done', async () => {
        const controller = new AbortController();
        const { result, send } = start({ signal: controller.signal });
        send(encodeMoveMessage({ kind: 'ready' }));
        controller.abort();
        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'canceled' });
        expect(localStorage.getItem(MOVED_TO_KEY)).toBeNull();
    });
});
