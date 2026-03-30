import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import { createSeededRandom } from '../src/puzzle/seeded-random.js';

let totalMaxY = 0, totalXRange = 0, count = 0;
let minRatio = Infinity, maxRatio = 0;
for (let seed = 0; seed < 50; seed++) {
    const r = createSeededRandom(seed);
    const path = classicTabTemplate.generate(r);
    const xRange = path[path.length - 1].x - path[0].x;
    const maxY = Math.max(...path.map(p => Math.abs(p.y)));
    const ratio = maxY / xRange;
    totalMaxY += maxY; totalXRange += xRange; count++;
    if (ratio < minRatio) minRatio = ratio;
    if (ratio > maxRatio) maxRatio = ratio;
}
const avgXRange = totalXRange / count;
const avgMaxY = totalMaxY / count;
console.log('Template stats (50 seeds):');
console.log(`  xRange: ${avgXRange.toFixed(4)} (neck-to-neck)`);
console.log(`  maxY: avg=${avgMaxY.toFixed(4)}`);
console.log(`  height/width ratio: min=${minRatio.toFixed(2)} avg=${(avgMaxY / avgXRange).toFixed(2)} max=${maxRatio.toFixed(2)}`);

console.log('\nTab dimensions on a 200px edge:');
for (const frac of [0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30, 0.40]) {
    const chordPx = frac * 200;
    const minH = chordPx * minRatio;
    const avgH = chordPx * avgMaxY / avgXRange;
    const maxH = chordPx * maxRatio;
    console.log(`  frac=${frac.toFixed(2)} → chord=${chordPx.toFixed(0)}px, height: ${minH.toFixed(0)}-${maxH.toFixed(0)}px (avg ${avgH.toFixed(0)}px)`);
}
