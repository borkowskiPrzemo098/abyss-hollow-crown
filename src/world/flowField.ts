import { isWalkable, type ArenaMap } from './arena';

const UNREACHED = 0x7fff;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Breadth-first distance field toward one goal tile. Enemies without a direct
 * line to the hero follow it downhill. Diagonal steps never cut wall corners.
 */
export class FlowField {
  readonly dist: Int16Array;
  private goalX = -1;
  private goalY = -1;
  private readonly queue: Int32Array;

  constructor(private readonly map: ArenaMap) {
    this.dist = new Int16Array(map.w * map.h);
    this.queue = new Int32Array(map.w * map.h);
  }

  /** Recomputes the field only when the goal tile actually changes. */
  setGoal(tx: number, ty: number): void {
    if (tx === this.goalX && ty === this.goalY) return;
    this.goalX = tx;
    this.goalY = ty;
    const { w, h } = this.map;
    this.dist.fill(UNREACHED);
    if (!isWalkable(this.map, tx, ty)) return;
    let head = 0;
    let tail = 0;
    this.dist[ty * w + tx] = 0;
    this.queue[tail++] = ty * w + tx;
    while (head < tail) {
      const idx = this.queue[head++] as number;
      const cx = idx % w;
      const cy = (idx - cx) / w;
      const nd = (this.dist[idx] as number) + 1;
      for (const [ox, oy] of NEIGHBOURS) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!this.canStep(cx, cy, ox, oy)) continue;
        const nIdx = ny * w + nx;
        if ((this.dist[nIdx] as number) <= nd) continue;
        this.dist[nIdx] = nd;
        this.queue[tail++] = nIdx;
      }
    }
  }

  distanceAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return UNREACHED;
    return this.dist[ty * this.map.w + tx] as number;
  }

  isReachable(tx: number, ty: number): boolean {
    return this.distanceAt(tx, ty) < UNREACHED;
  }

  /** Centre of the best neighbouring tile to step into, or null at the goal / without a path. */
  nextWaypoint(tx: number, ty: number): { x: number; y: number } | null {
    const here = this.distanceAt(tx, ty);
    if (here === 0 || here >= UNREACHED) return null;
    let best = here;
    let bx = 0;
    let by = 0;
    let found = false;
    for (const [ox, oy] of NEIGHBOURS) {
      if (!this.canStep(tx, ty, ox, oy)) continue;
      const d = this.distanceAt(tx + ox, ty + oy);
      if (d < best) {
        best = d;
        bx = tx + ox;
        by = ty + oy;
        found = true;
      }
    }
    return found ? { x: bx + 0.5, y: by + 0.5 } : null;
  }

  private canStep(cx: number, cy: number, ox: number, oy: number): boolean {
    if (!isWalkable(this.map, cx + ox, cy + oy)) return false;
    if (ox !== 0 && oy !== 0) {
      return isWalkable(this.map, cx + ox, cy) && isWalkable(this.map, cx, cy + oy);
    }
    return true;
  }
}
