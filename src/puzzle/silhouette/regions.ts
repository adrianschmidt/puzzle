/**
 * Connected-component analysis over a quantized label map.
 *
 * 4-connectivity flood fill in scan order (deterministic ids), then
 * per-component stats: area, frame contact, neighbor set, and a
 * contrast score (mean Oklab distance to surrounding components,
 * weighted by shared-border length) used by the selection stage to
 * rank "salient" blobs above same-size background patches.
 */

export interface Region {
    id: number;
    area: number;
    meanColor: [number, number, number];
    touchesFrame: boolean;
    neighbors: Set<number>;
    contrast: number;
}

export function findRegions(
    width: number,
    height: number,
    labels: Int32Array,
    palette: Array<[number, number, number]>,
): { regions: Region[]; componentMap: Int32Array } {
    const n = width * height;
    const componentMap = new Int32Array(n).fill(-1);
    const regions: Region[] = [];
    const stack: number[] = [];

    for (let start = 0; start < n; start++) {
        if (componentMap[start] !== -1) continue;
        const id = regions.length;
        const label = labels[start];
        let area = 0;
        let touchesFrame = false;
        stack.push(start);
        componentMap[start] = id;
        while (stack.length > 0) {
            const p = stack.pop()!;
            area++;
            const x = p % width, y = (p / width) | 0;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                touchesFrame = true;
            }
            // 4-neighbors
            if (x > 0)          visit(p - 1);
            if (x < width - 1)  visit(p + 1);
            if (y > 0)          visit(p - width);
            if (y < height - 1) visit(p + width);
        }
        regions.push({
            id, area,
            meanColor: palette[label],
            touchesFrame,
            neighbors: new Set<number>(),
            contrast: 0,
        });

        function visit(q: number): void {
            if (componentMap[q] === -1 && labels[q] === label) {
                componentMap[q] = id;
                stack.push(q);
            }
        }
    }

    // Adjacency + border-weighted contrast in one pass over pixel pairs.
    const borderLen = new Map<string, number>(); // "a,b" a<b → shared border px
    const bump = (a: number, b: number): void => {
        if (a === b) return;
        regions[a].neighbors.add(b);
        regions[b].neighbors.add(a);
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        borderLen.set(key, (borderLen.get(key) ?? 0) + 1);
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (x < width - 1) bump(componentMap[p], componentMap[p + 1]);
            if (y < height - 1) bump(componentMap[p], componentMap[p + width]);
        }
    }
    for (const region of regions) {
        let weighted = 0, total = 0;
        for (const nb of region.neighbors) {
            const key = region.id < nb ? `${region.id},${nb}` : `${nb},${region.id}`;
            const w = borderLen.get(key) ?? 0;
            weighted += w * oklabDist(region.meanColor, regions[nb].meanColor);
            total += w;
        }
        region.contrast = total > 0 ? weighted / total : 0;
    }

    return { regions, componentMap };
}

function oklabDist(a: [number, number, number], b: [number, number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
