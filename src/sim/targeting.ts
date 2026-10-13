import { dist } from '../core/math';
import type { Enemy } from './types';

export interface TargetingParams {
  attackRange: number;
  acquireMargin: number;
  leashMargin: number;
  switchRatio: number;
  minLock: number;
}

export type SightTest = (x: number, y: number) => boolean;

export function isTargetable(e: Enemy): boolean {
  return e.state !== 'dead' && e.state !== 'spawning' && e.hp > 0;
}

/**
 * Stable auto-targeting. Rules, in order:
 *  1. The current target is dropped if it died, became untargetable, lost line of
 *     sight, or moved beyond attack range + leash margin.
 *  2. Candidates: targetable enemies within attack range + acquire margin with line of sight.
 *     Ordered by distance, ties broken by id so the choice is deterministic.
 *  3. With no current target, take the nearest candidate.
 *  4. If the current target is out of attack range but a candidate is inside it, switch
 *     immediately (never stand idle next to a reachable enemy).
 *  5. Otherwise only switch when a candidate is much closer (switchRatio) AND the
 *     current lock has lasted minLock seconds. This prevents per-frame flicker.
 */
export function chooseTarget(
  hx: number,
  hy: number,
  currentId: number | null,
  lockT: number,
  enemies: readonly Enemy[],
  p: TargetingParams,
  sight: SightTest,
): number | null {
  const acquire = p.attackRange + p.acquireMargin;
  const leash = p.attackRange + p.leashMargin;

  let current: Enemy | null = null;
  let currentDist = Infinity;
  if (currentId !== null) {
    const c = enemies.find((e) => e.id === currentId);
    if (c && isTargetable(c)) {
      const d = dist(hx, hy, c.x, c.y);
      if (d <= leash && sight(c.x, c.y)) {
        current = c;
        currentDist = d;
      }
    }
  }

  let best: Enemy | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (!isTargetable(e)) continue;
    const d = dist(hx, hy, e.x, e.y);
    if (d > acquire) continue;
    if (d > bestDist || (d === bestDist && best !== null && e.id > best.id)) continue;
    if (!sight(e.x, e.y)) continue;
    best = e;
    bestDist = d;
  }

  if (!current) return best ? best.id : null;
  if (!best || best.id === current.id) return current.id;
  if (currentDist > p.attackRange && bestDist <= p.attackRange) return best.id;
  if (lockT >= p.minLock && bestDist < currentDist * p.switchRatio) return best.id;
  return current.id;
}
