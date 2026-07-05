/**
 * Region selection for silhouette tracing.
 *
 * Score = area × contrast (a mid-sized high-contrast parrot must
 * outrank a huge low-contrast sky patch). Frame-touching regions are
 * dropped outright (their contours would run near-parallel to the
 * border lines and produce sliver faces — see the spec's hazards
 * table). With `allowAdjacent` off, a region adjacent to an already-
 * selected one is skipped for the same sliver reason.
 */
import type { Region } from './regions.js';
import type { SilhouetteParams } from './types.js';

export function selectRegions(
    regions: Region[],
    rasterArea: number,
    params: SilhouetteParams,
): Region[] {
    const minArea = params.minRegionFrac * rasterArea;
    const maxArea = params.maxRegionFrac * rasterArea;

    const candidates = regions
        .filter(r => !r.touchesFrame && r.area >= minArea && r.area <= maxArea)
        // Deterministic ordering: score desc, id asc as tiebreak.
        .sort((a, b) => (b.area * b.contrast - a.area * a.contrast) || (a.id - b.id));

    const picked: Region[] = [];
    const blocked = new Set<number>();
    for (const candidate of candidates) {
        if (picked.length >= params.maxRegions) break;
        if (!params.allowAdjacent && blocked.has(candidate.id)) continue;
        picked.push(candidate);
        for (const nb of candidate.neighbors) blocked.add(nb);
    }
    return picked;
}
