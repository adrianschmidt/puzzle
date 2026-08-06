import { type SharePayload, shareCfToComposableConfig } from '../sharing/index.js';
import type { InitOptions } from '../game/init.js';

/**
 * Narrower than the `payload.clf ?` truthiness check the config
 * reconstruction below uses, deliberately: the two agree on every decoded
 * payload (`decodePayload` deletes a `clf` whose `tv` doesn't clamp), but
 * checking `tv` here also spares a crafted link with a falsy `clf`
 * (null / 0 / "") a chunk fetch it will never use.
 */
export function needsTracedTabChunk(payload: SharePayload): boolean {
    return payload.cf?.tg === 'traced'
        || (payload.c === 'wavy' && payload.wf?.tv !== undefined)
        || payload.c === 'triangles'
        || (payload.c === 'classic' && payload.clf?.tv !== undefined);
}

export function shareInitOptions(payload: SharePayload): InitOptions {
    return {
        cutStyle: payload.c,
        seed: payload.s,
        rotationMode: payload.r,
        fractalConfig: payload.ff ? { borderless: payload.ff.bl } : undefined,
        wavyConfig: payload.wf
            ? { borderless: payload.wf.bl, traceSetVersion: payload.wf.tv }
            : undefined,
        trianglesConfig: payload.tf
            ? { traceSetVersion: payload.tf.tv }
            : undefined,
        classicConfig: payload.clf
            ? { traceSetVersion: payload.clf.tv }
            : undefined,
        composableConfig: payload.cf
            ? shareCfToComposableConfig(payload.cf)
            : undefined,
    };
}
