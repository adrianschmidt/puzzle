/**
 * Deterministic color quantization for silhouette segmentation.
 *
 * sRGB → Oklab (perceptual), then median-cut to a small palette.
 * Median-cut is deterministic by construction (no seeding, no
 * iterative convergence), which is why it was chosen over k-means —
 * see the design spec's reproducibility section.
 */
import type { Raster } from './types.js';

/** sRGB (0–255 per channel) → Oklab [L, a, b]. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
    // sRGB → linear
    const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lr = lin(r), lg = lin(g), lb = lin(b);
    // linear sRGB → LMS (Oklab M1), cube root, → Oklab (M2)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

interface Bucket {
    /** Pixel indices (into width*height space) in this bucket. */
    pixels: number[];
}

/**
 * Median-cut quantization in Oklab space.
 *
 * Repeatedly splits the bucket with the widest Oklab channel range at
 * that channel's median until `levels` buckets exist (or no bucket is
 * splittable). Ties are broken by lowest bucket index — deterministic.
 */
export function quantize(
    raster: Raster,
    levels: number,
): { labels: Int32Array; palette: Array<[number, number, number]> } {
    const n = raster.width * raster.height;
    // Precompute Oklab per pixel (3 floats per pixel).
    const lab = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
        const [L, a, b] = rgbToOklab(
            raster.data[i * 4], raster.data[i * 4 + 1], raster.data[i * 4 + 2],
        );
        lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
    }

    const buckets: Bucket[] = [{ pixels: Array.from({ length: n }, (_, i) => i) }];

    const channelRange = (bucket: Bucket, ch: number): number => {
        let min = Infinity, max = -Infinity;
        for (const p of bucket.pixels) {
            const v = lab[p * 3 + ch];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return max - min;
    };

    while (buckets.length < levels) {
        // Pick the bucket×channel with the widest range (first wins ties).
        let bestBucket = -1, bestChannel = 0, bestRange = 1e-9;
        for (let bi = 0; bi < buckets.length; bi++) {
            if (buckets[bi].pixels.length < 2) continue;
            for (let ch = 0; ch < 3; ch++) {
                const range = channelRange(buckets[bi], ch);
                if (range > bestRange) {
                    bestRange = range; bestBucket = bi; bestChannel = ch;
                }
            }
        }
        if (bestBucket < 0) break; // nothing splittable

        const bucket = buckets[bestBucket];
        const ch = bestChannel;
        // Sort by channel value with pixel index as deterministic tiebreak.
        bucket.pixels.sort((a, b) =>
            (lab[a * 3 + ch] - lab[b * 3 + ch]) || (a - b));
        const mid = bucket.pixels.length >> 1;
        buckets.splice(bestBucket, 1,
            { pixels: bucket.pixels.slice(0, mid) },
            { pixels: bucket.pixels.slice(mid) });
    }

    const labels = new Int32Array(n);
    const palette: Array<[number, number, number]> = [];
    for (let bi = 0; bi < buckets.length; bi++) {
        let sl = 0, sa = 0, sb = 0;
        for (const p of buckets[bi].pixels) {
            labels[p] = bi;
            sl += lab[p * 3]; sa += lab[p * 3 + 1]; sb += lab[p * 3 + 2];
        }
        const count = buckets[bi].pixels.length || 1;
        palette.push([sl / count, sa / count, sb / count]);
    }
    return { labels, palette };
}
