/**
 * Worker entry for off-thread puzzle generation. Kept to a bare
 * message-loop shell — all logic lives in `generation-worker-core.ts`,
 * which the tests import instead (importing this file in jsdom would
 * assign `self.onmessage` on the shared window).
 */

import { handleGenerationRequest, describeFailure } from './generation-worker-core.js';
import type { GenerationRequest } from './generation-core.js';
import type { GenerationResponse } from './generation-worker-core.js';

/**
 * This file runs in a `DedicatedWorkerGlobalScope`, but it is type-checked
 * by the app's tsconfig, whose `lib` is the DOM — so `self` is typed as
 * `Window` here and neither `onmessage`'s payload type nor `postMessage`'s
 * single-argument worker overload lines up. The cast narrows `self` to the
 * two members this file actually uses, with the types the real worker scope
 * has. (`tsconfig.sw.json` solves the same problem properly for
 * `src/pwa/sw.ts` by type-checking it under `lib: WebWorker`; that is not
 * an option here because this entry's import graph reaches
 * `analytics/umami.ts`, which is legitimately DOM-typed.)
 */
const workerScope = self as unknown as {
    onmessage: ((event: MessageEvent<GenerationRequest>) => void) | null;
    postMessage(message: GenerationResponse): void;
};

workerScope.onmessage = (event) => {
    void handleGenerationRequest(event.data)
        .then((response) => {
            workerScope.postMessage(response);
        })
        .catch((err: unknown) => {
            // `handleGenerationRequest` catches everything internally, so the
            // only way to land here is `postMessage` itself throwing — a
            // `DataCloneError` on a result the structured-clone algorithm
            // rejects. Left as an unhandled rejection it would be invisible
            // to the parent: an unhandled rejection inside a worker does NOT
            // fire `error` on the parent's `Worker` object, so the client's
            // promise would never settle, the sync fallback would never run,
            // and the loading overlay would stay up until the page reloads.
            // Report it as an ordinary infrastructure failure instead, which
            // the client already routes to its main-thread fallback.
            workerScope.postMessage(describeFailure('infrastructure', err));
        });
};
