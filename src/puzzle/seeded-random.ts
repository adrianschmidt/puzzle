/**
 * Seeded pseudo-random number generator (PRNG).
 *
 * Uses the "mulberry32" algorithm — a simple, fast, 32-bit PRNG
 * with good statistical properties for game use. Given the same
 * seed, it always produces the same sequence of numbers.
 *
 * @see https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */

/**
 * Create a seeded random number generator.
 *
 * @param seed - An integer seed value
 * @returns A function that returns the next pseudo-random number in [0, 1)
 */
export function createSeededRandom(seed: number): () => number {
    let state = seed | 0; // ensure integer

    return (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generate a random integer seed.
 *
 * Uses Math.random to create an initial seed for a seeded PRNG.
 * Call this once when starting a new game, then pass the seed
 * to `createSeededRandom` and store it in the game state.
 */
export function generateSeed(): number {
    return (Math.random() * 4294967296) >>> 0;
}
