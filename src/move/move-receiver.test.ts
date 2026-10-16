/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    loadSavedGame,
    saveNewPuzzle,
    serializeState,
    STORAGE_KEY,
    PROGRESS_KEY,
} from '../persistence/index.js';
import { GEOMETRY_SEED_KEY } from '../persistence/storage.js';
import type { GameState } from '../model/types.js';
import { makeGameState, makeRectPiece } from '../test-helpers/fixtures.js';
import {
    applyMoveEntries,
    isReceiveMode,
    runMoveReceiver,
    REPLACE_PROMPT,
} from './move-receiver.js';
import { encodeMoveMessage } from './move-protocol.js';

/** Written by the build that becomes the frozen legacy deploy. Never regenerate. */
const LEGACY_SAVE = {
    geometry: '{"version":13,"pieces":[{"id":0,"edges":[{"id":0,"mateEdgeId":-1,"matePieceId":-1,"path":"L100,0","start":{"x":0,"y":0},"end":{"x":100,"y":0}},{"id":1,"mateEdgeId":-1,"matePieceId":-1,"path":"L100,100","start":{"x":100,"y":0},"end":{"x":100,"y":100}},{"id":2,"mateEdgeId":-1,"matePieceId":-1,"path":"L0,100","start":{"x":100,"y":100},"end":{"x":0,"y":100}},{"id":3,"mateEdgeId":-1,"matePieceId":-1,"path":"L0,0","start":{"x":0,"y":100},"end":{"x":0,"y":0}}],"shape":"M0,0 L100,0 L100,100 L0,100 Z","imageOffset":{"x":0,"y":0},"bounds":{"minX":0,"minY":0,"maxX":100,"maxY":100}},{"id":1,"edges":[{"id":4,"mateEdgeId":-1,"matePieceId":-1,"path":"L100,0","start":{"x":0,"y":0},"end":{"x":100,"y":0}},{"id":5,"mateEdgeId":-1,"matePieceId":-1,"path":"L100,100","start":{"x":100,"y":0},"end":{"x":100,"y":100}},{"id":6,"mateEdgeId":-1,"matePieceId":-1,"path":"L0,100","start":{"x":100,"y":100},"end":{"x":0,"y":100}},{"id":7,"mateEdgeId":-1,"matePieceId":-1,"path":"L0,0","start":{"x":0,"y":100},"end":{"x":0,"y":0}}],"shape":"M0,0 L100,0 L100,100 L0,100 Z","imageOffset":{"x":-100,"y":0},"bounds":{"minX":0,"minY":0,"maxX":100,"maxY":100}}],"imageSize":{"width":800,"height":600},"gridSize":{"cols":8,"rows":6},"imageUrl":"test.jpg","seed":4242}',
    progress: '{"version":13,"groups":[{"id":0,"pieces":[[0,{"x":0,"y":0}]],"position":{"x":0,"y":0},"rotation":0},{"id":1,"pieces":[[1,{"x":0,"y":0}]],"position":{"x":150,"y":0},"rotation":0}],"completed":false,"seed":4242}',
};

/** `LEGACY_SAVE.geometry` as `writeWithOverflow` stores it once the plain write hits the quota. */
const LEGACY_COMPRESSED_GEOMETRY =
    '\u0001LZ\u1be1\u083b\u416c\u0500\u6724\u583e\u605b\u0825\u6043\u00ec\u00f0\u4027\u1c30\u0650\u433a\u01d5\u21e0\u04ed,\u5c46\u5059\u54aa\u56fa\u41b0\u02f8\u0450\u0190\u402a\u11812\u29e0\u16bd\u175f\u10a0\u0562\u12b2\u6886\u7204\u0821\u3362&\u2eae\u41bd\u087c\u1822\u7cc0\u05c5!\u77cb\u4033\u6f60\u17f1\u4947\u1dd4\u43fd\u4ed8\u5dd8\u39dc\u72a2\u1151\u2aca\u1d77\u4a34\u5640\u4b6a\u6611\u5ada\u0343\u362f\u54e4\u0e89\u36d5\u2198\u30f2\u209e\u3a57\u0824\u03e6\u622f\u304d\u7b99\u0c23\u5861\u5420\u1328\u2874\u2ae1\u0aaf\u4862\u6274\u093a\u64f4\u3ea3\u034c\u6185\u34ce\u5519\u1d0a\u260e\u4f4a\u43b1\u2e81\u54f3\u46af\u37a4\u0757\u3dea\u78d5\u2286\u4067\u2c57\u5654\u6786\u2712\u4b7c\u59ba\u6999\u319a\u5b7f\u7190\u0309\u4cd4\u7c98\u087dL\u58e02\u52e0\u685d\u1250\u41c3\u2440\u02f4\u6500\u7e4b\'\u4820\u6648\u4c22\u05eb\u72cf\u3ce4!\u0c30K\u43e6\u20fc\u3c58\u0920\u008b\u1704\u5220\u04f1\u5318\u5b55\u1371\u058c\u0663\u6831\u0088\u60b9\u2645\u1348\u6e87!\u31d4\u616e\u4783\u6a14\u0768\u4904\u1c08\u3333\u1c83\u496d\u4b82\u5201\u28fd\u5362\u5d75\u6513\u2820\u15ac\u2908\u65fd\u0c7f\u3309\u6547\u0a66\u3339\u3233\u1656\u71b8\u571e\u02f5\u2d84\u5d5e\u1ae8\u2b60\u008c\u6396\u6893\u0bc5\u4b80\u6d8b\u1dc1\u259d\u52ca\u6b06\u7bb7\u570d\u470e\u4f9d\u27cc\u7020\u7620\u6274\u0f0c\u21bd\u590a\u38ad\u5848\u6b08\u74dd\u721a\u515d\u47fc\u252f\u4c03\u7a1d\u4360\u38d2\u064b\u2dd4\u47e5\u0462\u7440\u2e3b\u4042\u7c84\u2d31\u45b7\u073d\u35eb\u4033\u450a\u14ba\u02f2\u2d0e\u16b1\u664e\u4cb6\u39ff\u63d3\u2b5a\u7bb8\u4460\u0085\u1c20\u0314\u3760[\u46ae\u0c20\u1ca5\u16a2\u03a3\u187a\u2e77\u6ccc\u40ec\u1426\u405f\u0fb5\u1121 \u6d69\u4bf7\u0160\u0434\u7ab2\u5f74\u502e\u5620\u02c9\u207f\u6bc1\u0493!\u6820\u15be\u0681\u1724\u0280\u6850\u5688\u386b\u4220 ';

const SOURCE_ORIGIN = 'https://adrianschmidt.github.io';

function makeTwoPieceState(seed: number): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups = pieces.map((piece) => ({
        id: piece.id,
        pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
        position: { x: 0, y: 0 },
        rotation: 0,
    }));
    return makeGameState({ pieces, groups, seed });
}

function makeSaveBlobs(seed: number): { geometry: string; progress: string } {
    saveNewPuzzle(makeTwoPieceState(seed));
    const blobs = {
        geometry: localStorage.getItem(STORAGE_KEY)!,
        progress: localStorage.getItem(PROGRESS_KEY)!,
    };
    localStorage.clear();
    return blobs;
}

function messageFrom(source: unknown, origin: string, data: unknown): MessageEvent {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    localStorage.clear();
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
    Reflect.deleteProperty(window, 'opener');
});

describe('applyMoveEntries', () => {
    const never = (): boolean => {
        throw new Error('confirm should not be called');
    };

    it('writes the save and moved settings, skipping unlisted keys', () => {
        const save = makeSaveBlobs(7);
        const result = applyMoveEntries({
            [STORAGE_KEY]: save.geometry,
            [PROGRESS_KEY]: save.progress,
            'puzzle-cut-style': 'wavy',
            'puzzle-offline-image-stash': '{"v":1}',
            'puzzle-geometry-seed': '999',
            'unrelated': 'x',
        }, never);

        expect(result).toEqual({ status: 'done' });
        expect(loadSavedGame().status).toBe('ok');
        expect(localStorage.getItem('puzzle-cut-style')).toBe('wavy');
        expect(localStorage.getItem('puzzle-offline-image-stash')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBeNull();
    });

    it('loads a save written by the legacy build', () => {
        const result = applyMoveEntries({
            [STORAGE_KEY]: LEGACY_SAVE.geometry,
            [PROGRESS_KEY]: LEGACY_SAVE.progress,
        }, never);

        expect(result).toEqual({ status: 'done' });
        const outcome = loadSavedGame();
        expect(outcome.status).toBe('ok');
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(4242);
    });

    it('loads a compressed save written by the legacy build', () => {
        expect(LEGACY_COMPRESSED_GEOMETRY.startsWith('\x01LZ')).toBe(true);

        const result = applyMoveEntries({
            [STORAGE_KEY]: LEGACY_COMPRESSED_GEOMETRY,
            [PROGRESS_KEY]: LEGACY_SAVE.progress,
        }, never);

        expect(result).toEqual({ status: 'done' });
        const outcome = loadSavedGame();
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(4242);
    });

    it('moves settings alone without asking when no save comes along', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);

        const result = applyMoveEntries({ 'puzzle-cut-style': 'fractal' }, never);

        expect(result).toEqual({ status: 'done' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('fractal');
    });

    it('moves the game analytics context only together with its save', () => {
        localStorage.setItem('puzzle-game-analytics', 'target context');

        applyMoveEntries({ 'puzzle-game-analytics': 'source context' }, never);
        expect(localStorage.getItem('puzzle-game-analytics')).toBe('target context');

        const save = makeSaveBlobs(5);
        applyMoveEntries({
            [STORAGE_KEY]: save.geometry,
            [PROGRESS_KEY]: save.progress,
            'puzzle-game-analytics': 'source context',
        }, never);
        expect(localStorage.getItem('puzzle-game-analytics')).toBe('source context');
    });

    it('asks before replacing an existing save and writes nothing when declined', () => {
        const existing = makeSaveBlobs(1);
        const incoming = makeSaveBlobs(2);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        const confirm = vi.fn(() => false);

        const result = applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
            'puzzle-cut-style': 'wavy',
        }, confirm);

        expect(confirm).toHaveBeenCalledWith(REPLACE_PROMPT);
        expect(result).toEqual({ status: 'declined' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem('puzzle-cut-style')).toBeNull();
    });

    it('replaces an existing save when confirmed', () => {
        const existing = makeSaveBlobs(1);
        const incoming = makeSaveBlobs(2);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);

        const result = applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, () => true);

        expect(result).toEqual({ status: 'done' });
        const outcome = loadSavedGame();
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(2);
    });

    it('drops stale target progress when the incoming save is a legacy single-key blob', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        const legacy = JSON.stringify(serializeState(makeTwoPieceState(2)));

        const result = applyMoveEntries({ [STORAGE_KEY]: legacy }, () => true);

        expect(result).toEqual({ status: 'done' });
        expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
        const outcome = loadSavedGame();
        expect(outcome.status === 'ok' && outcome.state.seed).toBe(2);
    });

    it('re-anchors the geometry token to the moved save', () => {
        localStorage.setItem(GEOMETRY_SEED_KEY, '1');
        const incoming = makeSaveBlobs(2);

        applyMoveEntries({
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, never);

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('2');
    });

    it.each([null, 'x', ['a'], { [STORAGE_KEY]: 5 }])('rejects malformed entries %o', (entries) => {
        expect(applyMoveEntries(entries, never)).toEqual({ status: 'failed', reason: 'invalid-payload' });
        expect(localStorage.length).toBe(0);
    });

    it('rolls back when the save does not load', () => {
        const existing = makeSaveBlobs(1);
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        localStorage.setItem('puzzle-cut-style', 'classic');

        const result = applyMoveEntries({
            [STORAGE_KEY]: '{not json',
            [PROGRESS_KEY]: '{}',
            'puzzle-cut-style': 'wavy',
        }, () => true);

        expect(result).toEqual({ status: 'failed', reason: 'unloadable-save' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem(PROGRESS_KEY)).toBe(existing.progress);
        expect(localStorage.getItem('puzzle-cut-style')).toBe('classic');
    });

    it('restores the geometry token when a seed-mismatched save is rolled back', () => {
        const existing = makeSaveBlobs(1);
        const otherGeometry = makeSaveBlobs(2).geometry;
        const otherProgress = makeSaveBlobs(3).progress;
        localStorage.setItem(STORAGE_KEY, existing.geometry);
        localStorage.setItem(PROGRESS_KEY, existing.progress);
        localStorage.setItem(GEOMETRY_SEED_KEY, '1');

        const result = applyMoveEntries({
            [STORAGE_KEY]: otherGeometry,
            [PROGRESS_KEY]: otherProgress,
        }, () => true);

        expect(result).toEqual({ status: 'failed', reason: 'unloadable-save' });
        expect(localStorage.getItem(STORAGE_KEY)).toBe(existing.geometry);
        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBe('1');
    });

    it('rolls back when a write throws', () => {
        const incoming = makeSaveBlobs(2);
        localStorage.setItem('puzzle-cut-style', 'classic');
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key === STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
            setItem.call(this, key, value);
        });

        const result = applyMoveEntries({
            'puzzle-cut-style': 'wavy',
            [STORAGE_KEY]: incoming.geometry,
            [PROGRESS_KEY]: incoming.progress,
        }, () => true);
        vi.restoreAllMocks();

        expect(result).toEqual({ status: 'failed', reason: 'write-failed' });
        expect(localStorage.getItem('puzzle-cut-style')).toBe('classic');
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});

describe('isReceiveMode', () => {
    it('is false without the parameter', () => {
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(false);
    });

    it('is true with the parameter and an opener', () => {
        history.replaceState(null, '', '/?receive-move');
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(true);
    });

    it('strips the parameter and is false without an opener', () => {
        history.replaceState(null, '', '/?receive-move&userid=x#h');
        expect(isReceiveMode()).toBe(false);
        expect(location.search).toBe('?userid=x');
        expect(location.hash).toBe('#h');
    });

    it('strips the parameter from a path that starts with //', () => {
        const win = {
            location: { href: `${location.origin}//puzzle/?receive-move` },
            opener: null,
            history: window.history,
        } as unknown as Window;

        expect(isReceiveMode(win)).toBe(false);
        expect(location.href).toBe(`${location.origin}//puzzle/`);
    });

    it('is inert on the source origin itself', () => {
        vi.stubEnv('VITE_MOVED_FROM', location.origin);
        history.replaceState(null, '', '/?receive-move');
        Object.defineProperty(window, 'opener', { value: {}, configurable: true });
        expect(isReceiveMode()).toBe(false);
        expect(location.search).toBe('');
    });
});

describe('runMoveReceiver', () => {
    function setUp(timeoutMs = 30_000) {
        const opener = { postMessage: vi.fn() };
        Object.defineProperty(window, 'opener', { value: opener, configurable: true });
        history.replaceState(null, '', '/puzzle/?receive-move');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const navigate = vi.fn();
        const done = runMoveReceiver({ container, navigate, confirm: () => true, timeoutMs });
        return { opener, container, navigate, done };
    }

    it('announces ready to the source origin only', () => {
        const { opener } = setUp();
        expect(opener.postMessage).toHaveBeenCalledWith(encodeMoveMessage({ kind: 'ready' }), SOURCE_ORIGIN);
    });

    it('applies a payload, replies done, and continues to the app root', async () => {
        const { opener, navigate, done } = setUp();
        const save = makeSaveBlobs(3);

        window.dispatchEvent(messageFrom(opener, SOURCE_ORIGIN, encodeMoveMessage({
            kind: 'payload',
            entries: { [STORAGE_KEY]: save.geometry, [PROGRESS_KEY]: save.progress },
        })));

        await expect(done).resolves.toBe('done');
        expect(opener.postMessage).toHaveBeenLastCalledWith(encodeMoveMessage({ kind: 'done' }), SOURCE_ORIGIN);
        expect(navigate).toHaveBeenCalledWith(`${location.origin}/puzzle/`);
    });

    it('replies with a generic failure and reports the exception when applying throws', async () => {
        const { opener, container, done } = setUp();
        const failure = new DOMException('blocked', 'SecurityError');
        const reported: unknown[] = [];
        const onError = (event: ErrorEvent): void => {
            reported.push(event.error);
        };
        window.addEventListener('error', onError);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw failure;
        });

        window.dispatchEvent(messageFrom(opener, SOURCE_ORIGIN, encodeMoveMessage({
            kind: 'payload',
            entries: { 'puzzle-cut-style': 'wavy' },
        })));
        vi.restoreAllMocks();
        window.removeEventListener('error', onError);

        await expect(done).resolves.toBe('failed');
        expect(opener.postMessage).toHaveBeenLastCalledWith(
            encodeMoveMessage({ kind: 'failed', reason: 'unknown' }),
            SOURCE_ORIGIN,
        );
        expect(container.querySelector('.move-body')?.textContent).toMatch(/ran into a problem/);
        expect(reported).toEqual([failure]);
    });

    it('ignores payloads from another origin or window', () => {
        const { opener } = setUp();
        const payload = encodeMoveMessage({ kind: 'payload', entries: { 'puzzle-cut-style': 'wavy' } });

        window.dispatchEvent(messageFrom(opener, 'https://evil.example', payload));
        window.dispatchEvent(messageFrom({}, SOURCE_ORIGIN, payload));

        expect(localStorage.getItem('puzzle-cut-style')).toBeNull();
        expect(opener.postMessage).toHaveBeenCalledTimes(1);
    });

    it('reports a failure and offers to continue', async () => {
        const { opener, container, navigate, done } = setUp();

        window.dispatchEvent(messageFrom(opener, SOURCE_ORIGIN, encodeMoveMessage({
            kind: 'payload',
            entries: 'garbage',
        })));

        await expect(done).resolves.toBe('failed');
        expect(opener.postMessage).toHaveBeenLastCalledWith(
            encodeMoveMessage({ kind: 'failed', reason: 'invalid-payload' }),
            SOURCE_ORIGIN,
        );
        expect(navigate).not.toHaveBeenCalled();
        container.querySelector<HTMLButtonElement>('.move-btn--primary')!.click();
        expect(navigate).toHaveBeenCalledWith(`${location.origin}/puzzle/`);
    });

    it('times out with a message when nothing arrives', async () => {
        vi.useFakeTimers();
        const { container, done } = setUp(1000);
        vi.advanceTimersByTime(1000);
        await expect(done).resolves.toBe('timeout');
        expect(container.querySelector('.move-body')?.textContent).toMatch(/Nothing arrived/);
    });
});
