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

    it('stops waiting for the ready timeout once ready arrives', async () => {
        vi.useFakeTimers();
        const { result, send } = start({ timeoutMs: 1000 });
        send(encodeMoveMessage({ kind: 'ready' }));
        vi.advanceTimersByTime(5000);
        send(encodeMoveMessage({ kind: 'done' }));
        await expect(result).resolves.toEqual({ status: 'done' });
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
