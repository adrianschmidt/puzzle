import { describe, it, expect } from 'vitest';
import { elapsedMsSince } from './game-clock.js';

describe('elapsedMsSince', () => {
    it('returns the wall-clock time since the start', () => {
        expect(elapsedMsSince(1_000, 91_000)).toBe(90_000);
    });

    it('is unknown when the start is', () => {
        expect(elapsedMsSince(undefined, 91_000)).toBeUndefined();
    });

    it('is unknown when the clock has gone backwards since the start', () => {
        expect(elapsedMsSince(91_000, 1_000)).toBeUndefined();
    });
});
