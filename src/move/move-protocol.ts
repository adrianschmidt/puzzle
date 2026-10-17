export type MoveFailureReason = 'invalid-payload' | 'unloadable-save' | 'write-failed' | 'unknown';

export type MoveMessage =
    | { kind: 'ready' }
    | { kind: 'payload'; entries: unknown }
    | { kind: 'done' }
    | { kind: 'declined' }
    | { kind: 'failed'; reason: MoveFailureReason };

export const MOVE_FAILURE_TEXT: Record<MoveFailureReason, string> = {
    'invalid-payload': 'the new site couldn’t read what was sent',
    'unloadable-save': 'the new site couldn’t open your saved puzzle',
    'write-failed': 'the new site couldn’t store it',
    'unknown': 'the new site ran into a problem',
};

const TYPE_PREFIX = 'puzzle-move/';
const VERSION = 1;
const FAILURE_REASONS: readonly MoveFailureReason[] = [
    'invalid-payload',
    'unloadable-save',
    'write-failed',
    'unknown',
];

export function encodeMoveMessage(message: MoveMessage): Record<string, unknown> {
    const { kind, ...rest } = message;
    return { type: TYPE_PREFIX + kind, v: VERSION, ...rest };
}

export function readMoveMessage(data: unknown): MoveMessage | undefined {
    if (typeof data !== 'object' || data === null) return undefined;
    const record = data as Record<string, unknown>;
    if (record.v !== VERSION || typeof record.type !== 'string') return undefined;
    if (!record.type.startsWith(TYPE_PREFIX)) return undefined;
    const kind = record.type.slice(TYPE_PREFIX.length);
    switch (kind) {
        case 'ready':
        case 'done':
        case 'declined':
            return { kind };
        case 'payload':
            return { kind, entries: record.entries };
        case 'failed': {
            const reason = FAILURE_REASONS.find((r) => r === record.reason) ?? 'unknown';
            return { kind, reason };
        }
        default:
            return undefined;
    }
}
