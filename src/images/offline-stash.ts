/**
 * Player-triggered offline image stash: a batch of Unsplash photos downloaded
 * ahead of going offline, so new puzzles can still start on real photos.
 *
 * Blobs are cached under their real `images.unsplash.com` URLs and served by a
 * cache-first service-worker route (`src/pwa/sw.ts`), so saves, share links,
 * attribution, and image-source analytics treat a stashed photo exactly like a
 * network one. The metadata below keeps the previous generation alongside the
 * current one: pruning it on refresh would evict the image under a puzzle
 * created from the last stash, breaking its offline reload.
 */

import { diagnostics } from '../diagnostics.js';
import type { Orientation } from '../model/types.js';
import { OFFLINE_STASH_CACHE } from './offline-stash-cache.js';
import { toDisplayImage, type CandidateImage } from './unsplash-display-image.js';
import { fetchRandomImages, triggerPhotoDownload } from './unsplash.js';

export const OFFLINE_STASH_KEY = 'puzzle-offline-image-stash';

export const OFFLINE_STASH_COUNT = 8;

export interface StashedImage extends CandidateImage {
    orientation: Orientation;
}

interface StashRecord {
    v: 1;
    images: StashedImage[];
    previous: StashedImage[];
}

function emptyRecord(): StashRecord {
    return { v: 1, images: [], previous: [] };
}

function isStashedImage(value: unknown): value is StashedImage {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    const attribution = entry.attribution as Record<string, unknown> | undefined;
    const imageSize = entry.imageSize as Record<string, unknown> | undefined;
    return (
        typeof entry.imageUrl === 'string'
        && typeof entry.thumbUrl === 'string'
        && typeof entry.downloadLocation === 'string'
        && (entry.orientation === 'landscape' || entry.orientation === 'portrait')
        && (entry.description === undefined || typeof entry.description === 'string')
        && typeof imageSize === 'object' && imageSize !== null
        && typeof imageSize.width === 'number'
        && typeof imageSize.height === 'number'
        && typeof attribution === 'object' && attribution !== null
        && typeof attribution.photographerName === 'string'
        && typeof attribution.photographerUrl === 'string'
        && typeof attribution.photoUrl === 'string'
    );
}

function loadRecord(): StashRecord {
    const raw = localStorage.getItem(OFFLINE_STASH_KEY);
    if (raw === null) return emptyRecord();

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return emptyRecord();
    }

    if (typeof parsed !== 'object' || parsed === null) return emptyRecord();
    const record = parsed as Record<string, unknown>;
    if (
        record.v !== 1
        || !Array.isArray(record.images)
        || !Array.isArray(record.previous)
        || !record.images.every(isStashedImage)
        || !record.previous.every(isStashedImage)
    ) {
        return emptyRecord();
    }

    return { v: 1, images: record.images, previous: record.previous };
}

export function loadStash(): StashedImage[] {
    return loadRecord().images;
}

export function stashCount(): number {
    return loadStash().length;
}

export function isOfflineStashSupported(): boolean {
    return globalThis.caches !== undefined;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function byOrientation(
    images: readonly StashedImage[],
    orientation: Orientation,
    random: () => number,
): StashedImage[] {
    const matching = images.filter((image) => image.orientation === orientation);
    const rest = images.filter((image) => image.orientation !== orientation);
    return [...shuffled(matching, random), ...shuffled(rest, random)];
}

export function pickStashImage(
    orientation: Orientation,
    random: () => number = Math.random,
): StashedImage | null {
    return byOrientation(loadStash(), orientation, random)[0] ?? null;
}

export function stashCandidates(
    orientation: Orientation,
    count: number,
    random: () => number = Math.random,
): StashedImage[] {
    return byOrientation(loadStash(), orientation, random).slice(0, count);
}

export interface DownloadOfflineImagesOptions {
    proxyBaseUrl: string;
    query: string | undefined;
    orientation: Orientation;
    onProgress?: (done: number, total: number) => void;
    fetchFn?: typeof fetch;
    cacheStorage?: CacheStorage;
}

/**
 * Resolves to the number of photos saved; 0 means the stash was left as it
 * was. Reports each saved photo as an Unsplash download here, at the moment
 * the raw file is actually fetched — the puzzle it later starts is created
 * offline, where the usual use-time report cannot reach Unsplash.
 */
export async function downloadOfflineImages(
    options: DownloadOfflineImagesOptions,
): Promise<number> {
    const {
        proxyBaseUrl,
        query,
        orientation,
        onProgress,
        fetchFn = fetch,
        cacheStorage = globalThis.caches,
    } = options;

    if (cacheStorage === undefined) return 0;

    let results;
    try {
        results = await fetchRandomImages(
            proxyBaseUrl,
            OFFLINE_STASH_COUNT,
            fetchFn,
            query,
            orientation,
        );
    } catch (error) {
        diagnostics.warn('Offline image download failed:', error);
        return 0;
    }

    if (!results || results.length === 0) return 0;

    let cache: Cache;
    try {
        cache = await cacheStorage.open(OFFLINE_STASH_CACHE);
    } catch (error) {
        diagnostics.warn('Offline image cache unavailable:', error);
        return 0;
    }

    const seen = new Set<string>();
    const unique = results.filter((result) => {
        if (seen.has(result.imageUrl)) return false;
        seen.add(result.imageUrl);
        return true;
    });

    const stored: StashedImage[] = [];
    let done = 0;

    for (const result of unique) {
        try {
            const image = await fetchFn(result.imageUrl);
            if (image.ok) {
                await cache.put(result.imageUrl, image);
                try {
                    const thumb = await fetchFn(result.thumbUrl);
                    if (thumb.ok) await cache.put(result.thumbUrl, thumb);
                } catch (error) {
                    diagnostics.warn('Offline thumbnail download failed:', error);
                }
                triggerPhotoDownload(result.downloadLocation, proxyBaseUrl, fetchFn)
                    .catch(() => {});
                const entry: StashedImage = {
                    ...toDisplayImage(result),
                    thumbUrl: result.thumbUrl,
                    orientation,
                };
                if (result.description !== undefined) {
                    entry.description = result.description;
                }
                stored.push(entry);
            }
        } catch (error) {
            diagnostics.warn('Offline image download failed:', error);
        }
        done++;
        onProgress?.(done, unique.length);
    }

    if (stored.length === 0) return 0;

    const record: StashRecord = {
        v: 1,
        images: stored,
        previous: loadRecord().images,
    };
    try {
        localStorage.setItem(OFFLINE_STASH_KEY, JSON.stringify(record));
    } catch (error) {
        diagnostics.warn('Offline stash metadata write failed:', error);
        return 0;
    }

    await pruneCache(cache, record);

    return stored.length;
}

async function pruneCache(cache: Cache, record: StashRecord): Promise<void> {
    const keep = new Set<string>();
    for (const entry of [...record.images, ...record.previous]) {
        keep.add(entry.imageUrl);
        keep.add(entry.thumbUrl);
    }
    for (const request of await cache.keys()) {
        if (!keep.has(request.url)) {
            await cache.delete(request.url);
        }
    }
}
