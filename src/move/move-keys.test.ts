import { describe, it, expect } from 'vitest';
import { MOVED_KEYS, NOT_MOVED_KEYS } from './move-keys.js';

const SOURCES = import.meta.glob('/src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const KEY_DECLARATION = /\b[A-Z][A-Z0-9_]*KEY\s*=\s*'([^']+)'/g;

function declaredStorageKeys(): Set<string> {
    const keys = new Set<string>();
    for (const [path, source] of Object.entries(SOURCES)) {
        if (path.endsWith('.test.ts')) continue;
        for (const match of source.matchAll(KEY_DECLARATION)) keys.add(match[1]);
    }
    return keys;
}

describe('moved storage keys', () => {
    it('classifies every storage key the app declares', () => {
        const classified = new Set([...MOVED_KEYS, ...NOT_MOVED_KEYS]);
        const unclassified = [...declaredStorageKeys()].filter((key) => !classified.has(key));
        expect(unclassified, 'add each new key to MOVED_KEYS or NOT_MOVED_KEYS').toEqual([]);
    });

    it('lists only keys the app declares', () => {
        const declared = declaredStorageKeys();
        const stale = [...MOVED_KEYS, ...NOT_MOVED_KEYS].filter((key) => !declared.has(key));
        expect(stale).toEqual([]);
    });

    it('moves only keys the sender collects', () => {
        expect(MOVED_KEYS.filter((key) => !key.startsWith('puzzle-'))).toEqual([]);
    });

    it('never lists a key as both moved and not moved', () => {
        expect(MOVED_KEYS.filter((key) => NOT_MOVED_KEYS.includes(key))).toEqual([]);
    });
});
