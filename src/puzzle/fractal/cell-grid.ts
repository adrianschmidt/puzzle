/**
 * CellGrid — tracks visited tiles and occupied cells during piece growth.
 */

import type { Tile } from './types.js';
import { makeTile } from './tile.js';

export class CellGrid {
    private readonly nrow: number;
    private readonly ncol: number;
    private readonly visited: boolean[];
    private readonly cellmap: boolean[];
    private _nunvisited: number;

    constructor(nrow: number, ncol: number) {
        this.nrow = nrow;
        this.ncol = ncol;
        this.visited = new Array(ncol * nrow).fill(false);
        this.cellmap = new Array((ncol - 1) * (nrow - 1)).fill(false);
        this._nunvisited = ncol * nrow;
    }

    get nunvisited(): number {
        return this._nunvisited;
    }

    randomEmptyTile(random: () => number): Tile {
        const empty: number[] = [];
        for (let i = 0; i < this.visited.length; i++) {
            if (!this.visited[i]) empty.push(i);
        }

        const idx = empty[Math.floor(random() * empty.length)];
        const y = Math.floor(idx / this.nrow);
        const x = idx % this.nrow;

        return makeTile(x, y);
    }

    reset(): void {
        this.visited.fill(false);
        this.cellmap.fill(false);
        this._nunvisited = this.ncol * this.nrow;
    }

    isTileValid(v: Tile): boolean {
        return v.x >= 0 && v.x < this.nrow && v.y >= 0 && v.y < this.ncol;
    }

    isTileVisited(v: Tile): boolean {
        return this.visited[v.y * this.nrow + v.x];
    }

    isCellEmpty(c: { x: number; y: number }): boolean {
        return !this.cellmap[c.y * (this.nrow - 1) + c.x];
    }

    visitTile(v: Tile): void {
        const idx = v.y * this.nrow + v.x;
        if (!this.visited[idx]) {
            this.visited[idx] = true;
            this._nunvisited--;
        }
    }

    occupyCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * (this.nrow - 1) + c.x] = true;
    }

    liberateCell(c: { x: number; y: number }): void {
        this.cellmap[c.y * (this.nrow - 1) + c.x] = false;
    }
}
