import { blocksMove, blocksSight, tileAt, type ArenaMap } from './arena';
import type { Vec2 } from '../core/math';

/**
 * Pushes a circle out of every movement-blocking tile it overlaps.
 * Returns true if any correction happened.
 */
export function resolveCircleVsGrid(map: ArenaMap, p: Vec2, r: number): boolean {
  let hit = false;
  // Resolve the deepest contact first, then re-evaluate. Resolving tiles in grid order
  // instead would let the corner of a neighbouring tile in a straight wall "bump" the
  // body sideways while it slides along the wall.
  for (let iter = 0; iter < 4; iter++) {
    const minX = Math.floor(p.x - r);
    const maxX = Math.floor(p.x + r);
    const minY = Math.floor(p.y - r);
    const maxY = Math.floor(p.y + r);
    let bestPen = 0;
    let bestTx = 0;
    let bestTy = 0;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!blocksMove(tileAt(map, tx, ty))) continue;
        const cx = p.x < tx ? tx : p.x > tx + 1 ? tx + 1 : p.x;
        const cy = p.y < ty ? ty : p.y > ty + 1 ? ty + 1 : p.y;
        const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (d2 >= r * r) continue;
        const pen = d2 > 1e-12 ? r - Math.sqrt(d2) : r + 1; // centre inside a tile = deepest
        if (pen > bestPen) {
          bestPen = pen;
          bestTx = tx;
          bestTy = ty;
        }
      }
    }
    if (bestPen <= 0) break;
    hit = true;
    const tx = bestTx;
    const ty = bestTy;
    const cx = p.x < tx ? tx : p.x > tx + 1 ? tx + 1 : p.x;
    const cy = p.y < ty ? ty : p.y > ty + 1 ? ty + 1 : p.y;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      const push = r - d;
      p.x += (dx / d) * push;
      p.y += (dy / d) * push;
    } else {
      // Centre is inside the tile: eject along the shortest axis.
      const left = p.x - tx;
      const right = tx + 1 - p.x;
      const up = p.y - ty;
      const down = ty + 1 - p.y;
      const m = Math.min(left, right, up, down);
      if (m === left) p.x = tx - r;
      else if (m === right) p.x = tx + 1 + r;
      else if (m === up) p.y = ty - r;
      else p.y = ty + 1 + r;
    }
  }
  return hit;
}

/**
 * Moves a circle by (dx, dy) with wall sliding. Long moves are sub-stepped so
 * fast motion (dodge, knockback) can never tunnel through a one-tile wall.
 */
export function moveCircle(map: ArenaMap, p: Vec2, dx: number, dy: number, r: number): boolean {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  let hit = false;
  for (let i = 0; i < steps; i++) {
    p.x += sx;
    p.y += sy;
    if (resolveCircleVsGrid(map, p, r)) hit = true;
  }
  return hit;
}

/**
 * Line of sight between two world points using grid traversal (Amanatides & Woo).
 * Walls and pillars block; floor and braziers do not. A ray passing exactly
 * through a tile corner is blocked if either side cell blocks (no peeking
 * through diagonal gaps).
 */
export function hasLineOfSight(map: ArenaMap, ax: number, ay: number, bx: number, by: number): boolean {
  return traceGrid(map, ax, ay, bx, by, blocksSight);
}

/**
 * True when a body of radius `r` could walk straight from A to B: the centre line
 * and both edge lines are free of movement blockers (walls, pillars, braziers).
 * Seeing a target does not mean you can walk to it — braziers block bodies, not sight.
 */
export function hasClearPath(map: ArenaMap, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return true;
  const nx = (-dy / l) * r * 0.95;
  const ny = (dx / l) * r * 0.95;
  return (
    traceGrid(map, ax, ay, bx, by, blocksMove) &&
    traceGrid(map, ax + nx, ay + ny, bx + nx, by + ny, blocksMove) &&
    traceGrid(map, ax - nx, ay - ny, bx - nx, by - ny, blocksMove)
  );
}

function traceGrid(
  map: ArenaMap,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocks: (t: ReturnType<typeof tileAt>) => boolean,
): boolean {
  let tx = Math.floor(ax);
  let ty = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (tx + 1 - ax) * tDeltaX : stepX < 0 ? (ax - tx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (ty + 1 - ay) * tDeltaY : stepY < 0 ? (ay - ty) * tDeltaY : Infinity;
  // Number of cell boundaries the segment crosses bounds the walk.
  const maxSteps = Math.abs(endX - tx) + Math.abs(endY - ty);

  for (let i = 0; i <= maxSteps; i++) {
    if (blocks(tileAt(map, tx, ty))) return false;
    if (tx === endX && ty === endY) return true;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      tx += stepX;
    } else if (tMaxY < tMaxX) {
      tMaxY += tDeltaY;
      ty += stepY;
    } else {
      if (blocks(tileAt(map, tx + stepX, ty)) || blocks(tileAt(map, tx, ty + stepY))) return false;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      tx += stepX;
      ty += stepY;
      i++; // a corner crossing consumes two boundaries
    }
  }
  return !blocks(tileAt(map, endX, endY));
}
