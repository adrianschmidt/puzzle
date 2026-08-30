/**
 * Lives alone so `src/pwa/sw.ts` can import it: the worker is type-checked
 * under `tsconfig.sw.json`'s WebWorker lib, so anything it pulls in must stay
 * free of DOM references.
 */
export const OFFLINE_STASH_CACHE = 'puzzle-offline-images';
