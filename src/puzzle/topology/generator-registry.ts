import type { BaseCutGenerator, TabGenerator } from './plugin-types.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { classicTabGenerator } from './classic-tab-generator.js';
import { vennCutGenerator } from './venn-cut-generator.js';
import { triangularCutGenerator } from './triangular-cut-generator.js';
import { noneTabGenerator } from './none-tab-generator.js';
import { tracedTabGeneratorStub } from './traced-tab-loader.js';

const baseCutGenerators = new Map<string, BaseCutGenerator>();
const tabGenerators = new Map<string, TabGenerator>();

export function registerBaseCutGenerator(generator: BaseCutGenerator): void {
    baseCutGenerators.set(generator.id, generator);
}

export function registerTabGenerator(generator: TabGenerator): void {
    tabGenerators.set(generator.id, generator);
}

export function getBaseCutGenerator(id: string): BaseCutGenerator {
    const g = baseCutGenerators.get(id);
    if (!g) throw new Error(`unknown BaseCutGenerator id: ${id}`);
    return g;
}

export function getTabGenerator(id: string): TabGenerator {
    const g = tabGenerators.get(id);
    if (!g) throw new Error(`unknown TabGenerator id: ${id}`);
    return g;
}

export function listBaseCutGeneratorIds(): string[] {
    return [...baseCutGenerators.keys()];
}

export function listTabGeneratorIds(): string[] {
    return [...tabGenerators.keys()];
}

registerBaseCutGenerator(sineCutGenerator);
registerTabGenerator(classicTabGenerator);

registerBaseCutGenerator(vennCutGenerator);
registerBaseCutGenerator(triangularCutGenerator);
registerTabGenerator(noneTabGenerator);
// Traced tabs register as a stub that throws until
// preloadTracedTabGenerator() is awaited. See traced-tab-loader.ts.
registerTabGenerator(tracedTabGeneratorStub);
