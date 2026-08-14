/**
 * Worker entry for off-thread puzzle generation. A bare message-loop shell —
 * all logic lives in `generation-worker-core.ts` (importing this file in jsdom
 * would register a message listener on the shared window).
 */

import { handleGenerationRequest, describeFailure } from './generation-worker-core.js';
import type { GenerationRequest } from './generation-core.js';
import type { GenerationResponse } from './generation-worker-core.js';

/**
 * Runs in a `DedicatedWorkerGlobalScope` but is type-checked under the app's
 * DOM `lib`, so `self` is typed as `Window` and the worker `postMessage`/message
 * types don't line up. The cast narrows `self` to the two members used, with the
 * real worker-scope types. (`tsconfig.sw.json` fixes this properly for
 * `src/pwa/sw.ts` under `lib: WebWorker`; not an option here because this import
 * graph reaches the DOM-typed `analytics/umami.ts`.)
 */
const workerScope = self as unknown as {
    addEventListener(
        type: 'message',
        listener: (event: MessageEvent<GenerationRequest>) => void,
    ): void;
    postMessage(message: GenerationResponse): void;
};

workerScope.addEventListener('message', (event) => {
    void handleGenerationRequest(event.data)
        .then((response) => {
            workerScope.postMessage(response);
        })
        .catch((err: unknown) => {
            // `handleGenerationRequest` catches everything, so the only way here
            // is `postMessage` itself throwing — a `DataCloneError` on a result
            // structured-clone rejects. An unhandled rejection in a worker does
            // NOT fire `error` on the parent's `Worker`, so the client's promise
            // would never settle and the overlay would hang until reload. Report
            // it as an infrastructure failure, which routes to the fallback.
            workerScope.postMessage(describeFailure('infrastructure', err));
        });
});
