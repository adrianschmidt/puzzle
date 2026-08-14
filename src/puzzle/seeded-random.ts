/**
 * "mulberry32" — a fast 32-bit PRNG.
 * @see https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */

/**
 * @returns A function that returns the next pseudo-random number in [0, 1).
 */
export function createSeededRandom(seed: number): () => number {
    let state = seed | 0;

    return (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function generateSeed(): number {
    return (Math.random() * 4294967296) >>> 0;
}
