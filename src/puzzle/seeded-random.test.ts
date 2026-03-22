import { describe, it, expect } from 'vitest';
import { createSeededRandom, generateSeed } from './seeded-random.js';

describe('createSeededRandom', () => {
    it('returns values in [0, 1)', () => {
        const random = createSeededRandom(42);

        for (let i = 0; i < 1000; i++) {
            const value = random();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('produces the same sequence for the same seed', () => {
        const random1 = createSeededRandom(12345);
        const random2 = createSeededRandom(12345);

        for (let i = 0; i < 100; i++) {
            expect(random1()).toBe(random2());
        }
    });

    it('produces different sequences for different seeds', () => {
        const random1 = createSeededRandom(1);
        const random2 = createSeededRandom(2);

        const seq1 = Array.from({ length: 10 }, () => random1());
        const seq2 = Array.from({ length: 10 }, () => random2());

        // Sequences should not be identical
        const allSame = seq1.every((v, i) => v === seq2[i]);
        expect(allSame).toBe(false);
    });

    it('handles seed of 0', () => {
        const random = createSeededRandom(0);
        const value = random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
    });

    it('handles negative seeds', () => {
        const random = createSeededRandom(-42);

        for (let i = 0; i < 100; i++) {
            const value = random();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('has reasonable distribution (not all values clustered)', () => {
        const random = createSeededRandom(777);
        const buckets = [0, 0, 0, 0, 0]; // 5 buckets for [0,0.2), [0.2,0.4), etc.
        const n = 5000;

        for (let i = 0; i < n; i++) {
            const value = random();
            const bucket = Math.min(4, Math.floor(value * 5));
            buckets[bucket]++;
        }

        // Each bucket should get roughly 20% of values
        // Allow ±8% tolerance (600-1400 out of 5000)
        for (const count of buckets) {
            expect(count).toBeGreaterThan(600);
            expect(count).toBeLessThan(1400);
        }
    });
});

describe('generateSeed', () => {
    it('returns a non-negative integer', () => {
        const seed = generateSeed();
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(seed)).toBe(true);
    });

    it('returns values within 32-bit unsigned range', () => {
        for (let i = 0; i < 100; i++) {
            const seed = generateSeed();
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThanOrEqual(4294967295);
        }
    });
});
