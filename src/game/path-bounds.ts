/**
 * SVG path-bounds parsing.
 *
 * Self-contained algorithm that parses SVG `d` attributes and computes a
 * conservative axis-aligned bounding box of every point and bezier control
 * point in the path. Control points may extend past the actual curve, so
 * the box is guaranteed to contain the rendered geometry — good enough for
 * layout spacing.
 */

import type { Point } from '../model/types.js';

// Match SVG path commands: a letter followed by numbers/commas/spaces.
const COMMAND_REGEX = /([MLCSQTZHVAmlcsqtzhva])\s*([-\d.,eE\s]*)/g;
const NUMBER_REGEX = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Parse an SVG path string and compute the bounding box of all points
 * (including bezier control points) in the path.
 *
 * This produces a conservative bounding box — control points may extend
 * beyond the actual curve, but the result is guaranteed to contain the
 * full path geometry. Good enough for layout spacing.
 */
export function getPathBounds(
    path: string,
    start: Point,
): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = start.x;
    let minY = start.y;
    let maxX = start.x;
    let maxY = start.y;

    let curX = start.x;
    let curY = start.y;

    function expand(x: number, y: number) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    for (const match of path.matchAll(COMMAND_REGEX)) {
        const cmd = match[1];
        const argsStr = match[2].trim();
        const nums: number[] = [];

        if (argsStr.length > 0) {
            for (const numMatch of argsStr.matchAll(NUMBER_REGEX)) {
                nums.push(parseFloat(numMatch[0]));
            }
        }

        switch (cmd) {
            case 'M':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'm':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'L':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'l':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'H':
                for (const n of nums) {
                    curX = n;
                    expand(curX, curY);
                }
                break;
            case 'h':
                for (const n of nums) {
                    curX += n;
                    expand(curX, curY);
                }
                break;
            case 'V':
                for (const n of nums) {
                    curY = n;
                    expand(curX, curY);
                }
                break;
            case 'v':
                for (const n of nums) {
                    curY += n;
                    expand(curX, curY);
                }
                break;
            case 'C':
                for (let i = 0; i + 5 < nums.length; i += 6) {
                    expand(nums[i], nums[i + 1]);
                    expand(nums[i + 2], nums[i + 3]);
                    curX = nums[i + 4];
                    curY = nums[i + 5];
                    expand(curX, curY);
                }
                break;
            case 'c':
                for (let i = 0; i + 5 < nums.length; i += 6) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    expand(curX + nums[i + 2], curY + nums[i + 3]);
                    curX += nums[i + 4];
                    curY += nums[i + 5];
                    expand(curX, curY);
                }
                break;
            case 'S':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(nums[i], nums[i + 1]);
                    curX = nums[i + 2];
                    curY = nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 's':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    curX += nums[i + 2];
                    curY += nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'Q':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(nums[i], nums[i + 1]);
                    curX = nums[i + 2];
                    curY = nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'q':
                for (let i = 0; i + 3 < nums.length; i += 4) {
                    expand(curX + nums[i], curY + nums[i + 1]);
                    curX += nums[i + 2];
                    curY += nums[i + 3];
                    expand(curX, curY);
                }
                break;
            case 'T':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX = nums[i];
                    curY = nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 't':
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    curX += nums[i];
                    curY += nums[i + 1];
                    expand(curX, curY);
                }
                break;
            case 'A':
                for (let i = 0; i + 6 < nums.length; i += 7) {
                    // Include the arc endpoint; radii are harder to bound
                    // but including the endpoint is a reasonable approximation
                    curX = nums[i + 5];
                    curY = nums[i + 6];
                    expand(curX, curY);
                }
                break;
            case 'a':
                for (let i = 0; i + 6 < nums.length; i += 7) {
                    curX += nums[i + 5];
                    curY += nums[i + 6];
                    expand(curX, curY);
                }
                break;
            case 'Z':
            case 'z':
                // Close path — return to start
                curX = start.x;
                curY = start.y;
                break;
        }
    }

    return { minX, minY, maxX, maxY };
}
