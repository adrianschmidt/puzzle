import poolJson from './backup-pool.json';
import { toDisplayImage, type DisplayImage } from './unsplash-display-image.js';
import type { UnsplashImageResult } from './unsplash.js';
import type { ImageCategoryId } from '../game/image-categories.js';
import type { Orientation } from '../model/types.js';

export interface BackupPoolRecord extends UnsplashImageResult {
    id: string;
    category: ImageCategoryId;
    vibrant: boolean;
    orientation: Orientation;
}

const BACKUP_POOL_RECORDS = poolJson as unknown as readonly BackupPoolRecord[];

export function selectPoolRecord(
    records: readonly BackupPoolRecord[],
    category: ImageCategoryId,
    vibrant: boolean,
    orientation: Orientation,
    random: () => number = Math.random,
): BackupPoolRecord | null {
    const matches = records.filter((r) =>
        r.orientation === orientation
        && r.vibrant === vibrant
        && (category === 'any' || r.category === category));

    if (matches.length === 0) return null;

    return matches[Math.floor(random() * matches.length)] ?? null;
}

export function resolveFromPool(
    category: ImageCategoryId,
    vibrant: boolean,
    orientation: Orientation,
): DisplayImage | null {
    const record = selectPoolRecord(BACKUP_POOL_RECORDS, category, vibrant, orientation);
    return record ? toDisplayImage(record) : null;
}
