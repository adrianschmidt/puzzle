import { describe, it, expect } from 'vitest';
import { encodeMoveMessage, readMoveMessage, type MoveMessage } from './move-protocol.js';

describe('move protocol', () => {
    const messages: MoveMessage[] = [
        { kind: 'ready' },
        { kind: 'payload', entries: { 'puzzle-cut-style': 'classic' } },
        { kind: 'done' },
        { kind: 'declined' },
        { kind: 'failed', reason: 'unloadable-save' },
    ];

    it.each(messages)('round-trips %o', (message) => {
        expect(readMoveMessage(encodeMoveMessage(message))).toEqual(message);
    });

    it('uses the documented envelope', () => {
        expect(encodeMoveMessage({ kind: 'ready' })).toEqual({ type: 'puzzle-move/ready', v: 1 });
    });

    it.each([
        null,
        'puzzle-move/ready',
        { type: 'puzzle-move/ready' },
        { type: 'puzzle-move/ready', v: 2 },
        { type: 'other/ready', v: 1 },
        { type: 'puzzle-move/unknown', v: 1 },
    ])('rejects %o', (data) => {
        expect(readMoveMessage(data)).toBeUndefined();
    });

    it('reads a failure with a reason it does not know as a generic failure', () => {
        expect(readMoveMessage({ type: 'puzzle-move/failed', v: 1, reason: 'quota' }))
            .toEqual({ kind: 'failed', reason: 'unknown' });
    });
});

describe('wire format the frozen legacy deploy depends on', () => {
    it.each<[MoveMessage, Record<string, unknown>]>([
        [{ kind: 'ready' }, { type: 'puzzle-move/ready', v: 1 }],
        [
            { kind: 'payload', entries: { 'puzzle-cut-style': 'wavy' } },
            { type: 'puzzle-move/payload', v: 1, entries: { 'puzzle-cut-style': 'wavy' } },
        ],
        [{ kind: 'done' }, { type: 'puzzle-move/done', v: 1 }],
        [{ kind: 'declined' }, { type: 'puzzle-move/declined', v: 1 }],
        [
            { kind: 'failed', reason: 'invalid-payload' },
            { type: 'puzzle-move/failed', v: 1, reason: 'invalid-payload' },
        ],
        [
            { kind: 'failed', reason: 'unloadable-save' },
            { type: 'puzzle-move/failed', v: 1, reason: 'unloadable-save' },
        ],
        [
            { kind: 'failed', reason: 'write-failed' },
            { type: 'puzzle-move/failed', v: 1, reason: 'write-failed' },
        ],
    ])('encodes %o exactly as %o', (message, wire) => {
        expect(encodeMoveMessage(message)).toEqual(wire);
        expect(readMoveMessage(wire)).toEqual(message);
    });
});
