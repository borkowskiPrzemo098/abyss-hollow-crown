import { describe, expect, it } from 'vitest';
import { ANTECHAMBER_LAYOUT, isWalkable, parseArena } from '../src/world/arena';
import { hasLineOfSight, moveCircle } from '../src/world/collision';
import { FlowField } from '../src/world/flowField';
import { screenDirToWorld, worldToScreenX, worldToScreenY } from '../src/core/iso';
import { openRoom } from './helpers';

describe('arena parsing', () => {
  it('parses the antechamber layout', () => {
    const m = parseArena(ANTECHAMBER_LAYOUT);
    expect(m.w).toBe(22);
    expect(m.h).toBe(22);
    expect(m.spawns.length).toBeGreaterThanOrEqual(4);
    expect(isWalkable(m, Math.floor(m.heroStart.x), Math.floor(m.heroStart.y))).toBe(true);
  });

  it('rejects ragged rows and unknown tiles', () => {
    expect(() => parseArena(['###', '#H', '###'])).toThrow();
    expect(() => parseArena(['####', '#HZ#', '####'])).toThrow();
  });

  it('every floor tile of the antechamber is reachable from the hero start', () => {
    const m = parseArena(ANTECHAMBER_LAYOUT);
    const f = new FlowField(m);
    f.setGoal(Math.floor(m.heroStart.x), Math.floor(m.heroStart.y));
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) if (isWalkable(m, x, y)) expect(f.isReachable(x, y), `${x},${y}`).toBe(true);
    for (const s of m.spawns) expect(f.isReachable(Math.floor(s.x), Math.floor(s.y))).toBe(true);
  });
});

describe('collision', () => {
  it('blocks movement into a wall and keeps the radius gap', () => {
    const m = openRoom();
    const p = { x: 2.0, y: 5.5 };
    moveCircle(m, p, -3, 0, 0.3); // west wall occupies x in [0,1)
    expect(p.x).toBeCloseTo(1.3, 5);
    expect(p.y).toBeCloseTo(5.5, 5);
  });

  it('slides along a wall instead of sticking', () => {
    const m = openRoom();
    const p = { x: 1.3, y: 5.5 };
    moveCircle(m, p, -1, 1, 0.3);
    expect(p.x).toBeCloseTo(1.3, 5);
    expect(p.y).toBeCloseTo(6.5, 5);
  });

  it('never tunnels through a one-tile wall on a very fast move', () => {
    const m = openRoom({ 6: '#......#.......#' });
    const p = { x: 5.5, y: 6.5 };
    moveCircle(m, p, 6, 0, 0.3); // wall tile at x=7
    expect(p.x).toBeLessThanOrEqual(7 - 0.3 + 1e-6);
  });
});

describe('line of sight', () => {
  const m = openRoom({ 6: '#......#.......#' });
  it('is clear in the open', () => {
    expect(hasLineOfSight(m, 2.5, 3.5, 12.5, 4.5)).toBe(true);
  });
  it('is blocked by a wall tile', () => {
    expect(hasLineOfSight(m, 5.5, 6.5, 9.5, 6.5)).toBe(false);
  });
  it('is symmetric', () => {
    expect(hasLineOfSight(m, 9.5, 6.5, 5.5, 6.5)).toBe(false);
    expect(hasLineOfSight(m, 12.5, 4.5, 2.5, 3.5)).toBe(true);
  });
  it('does not peek through a diagonal gap between two walls', () => {
    const d = openRoom({ 5: '#......#.......#', 6: '#.......#......#' });
    // Corner shared by (7,5) and (8,6): ray passes exactly through (8,6) corner point.
    expect(hasLineOfSight(d, 7.5, 6.5, 8.5, 5.5)).toBe(false);
  });
  it('braziers do not block sight', () => {
    const b = openRoom({ 6: '#......B.......#' });
    expect(hasLineOfSight(b, 5.5, 6.5, 9.5, 6.5)).toBe(true);
  });
});

describe('isometric projection', () => {
  it('maps the world axes to screen diagonals', () => {
    expect(worldToScreenX(1, 0)).toBe(32);
    expect(worldToScreenY(1, 0)).toBe(16);
    expect(worldToScreenX(0, 1)).toBe(-32);
    expect(worldToScreenY(1, 1)).toBe(32);
  });
  it('screen up becomes a world direction that moves up on screen, keeping magnitude', () => {
    const w = screenDirToWorld(0, -0.5);
    expect(Math.hypot(w.x, w.y)).toBeCloseTo(0.5, 6);
    expect(worldToScreenY(w.x, w.y)).toBeLessThan(0);
    expect(Math.abs(worldToScreenX(w.x, w.y))).toBeLessThan(1e-9);
  });
});
