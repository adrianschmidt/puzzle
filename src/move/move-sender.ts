import { markMoved, MOVED_TO_KEY, receiveMoveUrl } from './move-config.js';
import { encodeMoveMessage, readMoveMessage, type MoveFailureReason } from './move-protocol.js';

export const READY_TIMEOUT_MS = 30_000;

const CLOSED_POLL_MS = 500;

export type MoveOutcome =
    | { status: 'done' }
    | { status: 'declined' }
    | { status: 'failed'; reason: MoveFailureReason }
    | { status: 'popup-blocked' }
    | { status: 'timeout' }
    | { status: 'closed' }
    | { status: 'canceled' };

export interface MoveHandoffDeps {
    targetUrl: string;
    open?: (url: string) => Window | null;
    win?: Window;
    storage?: Storage;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export function collectMoveEntries(storage: Storage): Record<string, string> {
    const entries: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null || !key.startsWith('puzzle-') || key === MOVED_TO_KEY) continue;
        const value = storage.getItem(key);
        if (value !== null) entries[key] = value;
    }
    return entries;
}

export function runMoveHandoff(deps: MoveHandoffDeps): Promise<MoveOutcome> {
    const {
        targetUrl,
        win = window,
        storage = localStorage,
        timeoutMs = READY_TIMEOUT_MS,
        signal,
    } = deps;
    const open = deps.open ?? ((url: string) => win.open(url, '_blank'));
    const targetOrigin = new URL(targetUrl).origin;

    const opened = open(receiveMoveUrl(targetUrl));
    if (opened === null) return Promise.resolve({ status: 'popup-blocked' });
    const popup: Window = opened;

    return new Promise((resolve) => {
        let sent = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const closedPoll = setInterval(() => {
            if (popup.closed) finish({ status: 'closed' });
        }, CLOSED_POLL_MS);

        function stopTimer(): void {
            clearTimeout(timer);
            timer = undefined;
        }

        function onVisibilityChange(): void {
            if (sent) return;
            if (win.document.visibilityState === 'hidden') {
                stopTimer();
            } else if (timer === undefined) {
                timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
            }
        }

        function finish(outcome: MoveOutcome): void {
            stopTimer();
            clearInterval(closedPoll);
            win.document.removeEventListener('visibilitychange', onVisibilityChange);
            win.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
            resolve(outcome);
        }

        function onAbort(): void {
            finish({ status: 'canceled' });
        }

        function onMessage(event: MessageEvent): void {
            if (event.origin !== targetOrigin || event.source !== popup) return;
            const message = readMoveMessage(event.data);
            if (message === undefined) return;
            if (message.kind === 'ready') {
                sent = true;
                stopTimer();
                popup.postMessage(
                    encodeMoveMessage({ kind: 'payload', entries: collectMoveEntries(storage) }),
                    targetOrigin,
                );
                return;
            }
            if (!sent) return;
            switch (message.kind) {
                case 'done':
                    markMoved(targetUrl);
                    finish({ status: 'done' });
                    return;
                case 'declined':
                    finish({ status: 'declined' });
                    return;
                case 'failed':
                    finish({ status: 'failed', reason: message.reason });
                    return;
                case 'payload':
                    return;
            }
        }

        win.addEventListener('message', onMessage);
        win.document.addEventListener('visibilitychange', onVisibilityChange);
        signal?.addEventListener('abort', onAbort);
        onVisibilityChange();
    });
}
