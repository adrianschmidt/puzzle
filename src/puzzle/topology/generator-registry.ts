/**
 * Registry of base-cut and tab generator plug-ins, keyed by id.
 *
 * Pre-registers `sine` and `classic` as the framework defaults.
 * Other plug-ins (Venn etc.) register themselves at module import.
 */

import type { BaseCutGenerator, TabGenerator } from './plugin-types.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { classicTabGenerator } from './classic-tab-generator.js';

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

// Pre-register the framework defaults
registerBaseCutGenerator(sineCutGenerator);
registerTabGenerator(classicTabGenerator);
