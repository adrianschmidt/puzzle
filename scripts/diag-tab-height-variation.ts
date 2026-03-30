import { classicTabTemplate } from '../src/puzzle/composable/tab-shapes.js';
import { createSeededRandom } from '../src/puzzle/seeded-random.js';

console.log('seed  xRange   maxY  height@35px  neckWidth@35');
for (let seed = 0; seed < 30; seed++) {
    const r = createSeededRandom(seed);
    const path = classicTabTemplate.generate(r);
    const xRange = path[path.length - 1].x - path[0].x;
    const maxY = Math.max(...path.map(p => Math.abs(p.y)));
    const height35 = maxY * 35;
    // neck width = chord = 35px always now
    console.log(`  ${seed.toString().padStart(2)}    ${xRange.toFixed(4)}  ${maxY.toFixed(4)}    ${height35.toFixed(1).padStart(5)}px      35px`);
}
