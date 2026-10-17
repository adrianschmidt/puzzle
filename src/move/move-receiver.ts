import { diagnostics } from '../diagnostics.js';
import { GAME_CONTEXT_KEY } from '../analytics/game-context.js';
import { loadSavedGame, STORAGE_KEY, PROGRESS_KEY } from '../persistence/index.js';
import { GEOMETRY_SEED_KEY } from '../persistence/storage.js';
import { createReceiveMoveScreen } from '../ui/receive-move-screen.js';
import { moveSourceOrigin, RECEIVE_MOVE_PARAM } from './move-config.js';
import { MOVED_KEYS } from './move-keys.js';
import {
    encodeMoveMessage,
    readMoveMessage,
    MOVE_FAILURE_TEXT,
    type MoveFailureReason,
} from './move-protocol.js';

export const PAYLOAD_TIMEOUT_MS = 30_000;

export const REPLACE_PROMPT =
    'This site already has a puzzle in progress. Replace it with the one you’re bringing?';

export type ApplyResult =
    | { status: 'done' }
    | { status: 'declined' }
    | { status: 'failed'; reason: MoveFailureReason };

export interface MoveReceiverDeps {
    container: HTMLElement;
    win?: Window;
    confirm?: (message: string) => boolean;
    navigate?: (url: string) => void;
    timeoutMs?: number;
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && Object.values(value).every((entry) => typeof entry === 'string');
}

function writeAll(writes: ReadonlyMap<string, string | null>): void {
    for (const [key, value] of writes) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }
}

function restore(snapshot: ReadonlyMap<string, string | null>): void {
    for (const [key, value] of snapshot) {
        try {
            writeAll(new Map([[key, value]]));
        } catch (error) {
            diagnostics.warn(`Could not restore "${key}" after a failed move:`, error);
        }
    }
}

export function applyMoveEntries(
    entries: unknown,
    confirm: (message: string) => boolean,
): ApplyResult {
    if (!isStringRecord(entries)) return { status: 'failed', reason: 'invalid-payload' };

    const bringsSave = Object.hasOwn(entries, STORAGE_KEY);
    if (bringsSave && localStorage.getItem(STORAGE_KEY) !== null && !confirm(REPLACE_PROMPT)) {
        return { status: 'declined' };
    }

    const writes = new Map<string, string | null>();
    for (const key of MOVED_KEYS) {
        if (key === STORAGE_KEY || key === PROGRESS_KEY) continue;
        if (key === GAME_CONTEXT_KEY && !bringsSave) continue;
        if (Object.hasOwn(entries, key)) writes.set(key, entries[key]);
    }
    if (bringsSave) {
        writes.set(STORAGE_KEY, entries[STORAGE_KEY]);
        writes.set(PROGRESS_KEY, Object.hasOwn(entries, PROGRESS_KEY) ? entries[PROGRESS_KEY] : null);
        writes.set(GEOMETRY_SEED_KEY, null);
    }

    const snapshot = new Map<string, string | null>(
        [...writes.keys()].map((key) => [key, localStorage.getItem(key)]),
    );
    try {
        writeAll(writes);
    } catch (error) {
        diagnostics.warn('Writing the moved puzzle failed; restoring the previous data:', error);
        restore(snapshot);
        return { status: 'failed', reason: 'write-failed' };
    }

    if (bringsSave && loadSavedGame().status !== 'ok') {
        restore(snapshot);
        return { status: 'failed', reason: 'unloadable-save' };
    }
    return { status: 'done' };
}

export function isReceiveMode(win: Window = window): boolean {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(RECEIVE_MOVE_PARAM)) return false;
    if (win.opener && url.origin !== moveSourceOrigin()) return true;
    url.searchParams.delete(RECEIVE_MOVE_PARAM);
    win.history.replaceState(win.history.state, '', url.href);
    return false;
}

export function runMoveReceiver(deps: MoveReceiverDeps): Promise<ApplyResult['status'] | 'timeout'> {
    const { container, win = window, timeoutMs = PAYLOAD_TIMEOUT_MS } = deps;
    const confirm = deps.confirm ?? ((message: string) => win.confirm(message));
    const navigate = deps.navigate ?? ((url: string) => win.location.replace(url));
    const sourceOrigin = moveSourceOrigin();
    const opener = win.opener as Window;
    const screen = createReceiveMoveScreen(container);
    const continueToApp = (): void => {
        const root = new URL(win.location.href);
        root.search = '';
        root.hash = '';
        navigate(root.href);
    };

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            screen.showMessage(
                'Nothing has arrived from the old site yet. Switch back to its tab to finish — your puzzle is still there.',
                continueToApp,
            );
            resolve('timeout');
        }, timeoutMs);

        function onMessage(event: MessageEvent): void {
            if (event.origin !== sourceOrigin || event.source !== opener) return;
            const message = readMoveMessage(event.data);
            if (message?.kind !== 'payload') return;
            clearTimeout(timer);
            win.removeEventListener('message', onMessage);

            let result: ApplyResult;
            try {
                result = applyMoveEntries(message.entries, confirm);
            } catch (error) {
                diagnostics.warn('Applying the moved puzzle failed:', error);
                win.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
                result = { status: 'failed', reason: 'unknown' };
            }
            opener.postMessage(
                encodeMoveMessage(
                    result.status === 'failed'
                        ? { kind: 'failed', reason: result.reason }
                        : { kind: result.status },
                ),
                sourceOrigin,
            );
            if (result.status === 'failed') {
                screen.showMessage(
                    `Couldn’t bring your puzzle over — ${MOVE_FAILURE_TEXT[result.reason]}. It’s still safe on the old site.`,
                    continueToApp,
                );
            } else {
                continueToApp();
            }
            resolve(result.status);
        }

        win.addEventListener('message', onMessage);
        opener.postMessage(encodeMoveMessage({ kind: 'ready' }), sourceOrigin);
    });
}
