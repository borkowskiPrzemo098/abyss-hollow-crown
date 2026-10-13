import { describe, expect, it } from 'vitest';
import { COMMON } from '../src/config/balance';
import { HEROES } from '../src/config/heroes';
import { chooseTarget, type TargetingParams } from '../src/sim/targeting';
import type { Enemy } from '../src/sim/types';
import { openRoom, run, sandbox } from './helpers';

const W = HEROES.warden;

const P: TargetingParams = {
  attackRange: 1.5,
  acquireMargin: 0.3,
  leashMargin: 0.8,
  switchRatio: 0.6,
  minLock: 0.5,
};
const clear = () => true;

function fake(id: number, x: number, y: number, state: Enemy['state'] = 'chase'): Enemy {
  // Only the fields targeting reads matter here.
  return { id, x, y, hp: 10, state } as Enemy;
}

describe('chooseTarget (pure)', () => {
  it('picks the nearest enemy in range', () => {
    const es = [fake(1, 1.4, 0), fake(2, 0.9, 0), fake(3, 5, 0)];
    expect(chooseTarget(0, 0, null, 0, es, P, clear)).toBe(2);
  });

  it('returns null when nobody is in acquire range', () => {
    expect(chooseTarget(0, 0, null, 0, [fake(1, 3, 0)], P, clear)).toBeNull();
  });

  it('ignores spawning and dead enemies', () => {
    const es = [fake(1, 0.5, 0, 'spawning'), fake(2, 0.6, 0, 'dead'), fake(3, 1.2, 0)];
    expect(chooseTarget(0, 0, null, 0, es, P, clear)).toBe(3);
  });

  it('ignores enemies without line of sight', () => {
    const es = [fake(1, 0.5, 0), fake(2, 1.2, 0)];
    const sight = (x: number) => x !== 0.5;
    expect(chooseTarget(0, 0, null, 0, es, P, sight)).toBe(2);
  });

  it('keeps the current target when another is only slightly closer (no flicker)', () => {
    const es = [fake(1, 1.2, 0), fake(2, 1.0, 0)];
    expect(chooseTarget(0, 0, 1, 5, es, P, clear)).toBe(1);
  });

  it('switches to a much closer enemy only after the minimum lock time', () => {
    const es = [fake(1, 1.4, 0), fake(2, 0.5, 0)];
    expect(chooseTarget(0, 0, 1, 0.1, es, P, clear)).toBe(1);
    expect(chooseTarget(0, 0, 1, 0.6, es, P, clear)).toBe(2);
  });

  it('keeps a target that steps just outside attack range (leash) when nothing else is in range', () => {
    const es = [fake(1, 2.0, 0)];
    expect(chooseTarget(0, 0, 1, 1, es, P, clear)).toBe(1);
  });

  it('switches immediately when the current target is out of range and another is in range', () => {
    const es = [fake(1, 2.0, 0), fake(2, 0, 1.4)];
    expect(chooseTarget(0, 0, 1, 0, es, P, clear)).toBe(2);
  });

  it('drops a target beyond the leash', () => {
    expect(chooseTarget(0, 0, 1, 1, [fake(1, 2.5, 0)], P, clear)).toBeNull();
  });

  it('breaks distance ties deterministically by id', () => {
    const es = [fake(7, 1, 0), fake(3, -1, 0)];
    expect(chooseTarget(0, 0, null, 0, es, P, clear)).toBe(3);
  });
});

describe('auto-attack in the simulation', () => {
  it('attacks the nearest enemy without any button press and switches after its death', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    const h = sim.hero;
    const a = sim.spawnEnemy('thrall', h.x + 1.0, h.y, { instant: true });
    const b = sim.spawnEnemy('thrall', h.x, h.y + 1.3, { instant: true });
    a.attackCd = b.attackCd = 99; // keep enemies passive for this test
    a.hp = 1;
    const ev = run(sim, 0.4);
    expect(ev.find((e) => e.type === 'swing' && e.targetId === a.id)).toBeTruthy();
    expect(ev.find((e) => e.type === 'death' && e.id === a.id)).toBeTruthy();
    run(sim, 0.1);
    expect(h.targetId).toBe(b.id);
    const ev2 = run(sim, 1.0);
    expect(ev2.some((e) => e.type === 'damage' && e.targetId === b.id)).toBe(true);
  });

  it('never attacks through a wall, even when the enemy is within reach by distance', () => {
    // Wall tile (9,8). Hero left of it, enemy above-right: 1.34 tiles apart, segment crosses the wall.
    const sim = sandbox(openRoom({ 8: '#........#.....#' }), { seed: 2 });
    const h = sim.hero;
    h.x = 8.68;
    h.y = 8.2;
    const e = sim.spawnEnemy('thrall', 9.9, 7.6, { instant: true });
    e.state = 'stunned'; // keep it in place
    e.stateT = 99;
    expect(Math.hypot(e.x - h.x, e.y - h.y)).toBeLessThan(W.attack.range);
    const startHp = e.hp;
    const ev = run(sim, 2);
    expect(ev.some((x) => x.type === 'swing')).toBe(false);
    expect(e.hp).toBe(startHp);
    expect(h.targetId).toBeNull();
  });

  it('respects the attack interval (cooldown)', () => {
    const sim = sandbox(openRoom(), { seed: 3 });
    const h = sim.hero;
    const e = sim.spawnEnemy('brute', h.x + 1.2, h.y, { instant: true });
    e.state = 'stunned';
    e.stateT = 999;
    e.hp = e.maxHp = 100000;
    const swingTimes: number[] = [];
    for (let i = 0; i < 300; i++) {
      sim.step(1 / 60);
      for (const ev of sim.drainEvents()) if (ev.type === 'swing') swingTimes.push(sim.time);
    }
    expect(swingTimes.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < swingTimes.length; i++) {
      const gap = swingTimes[i]! - swingTimes[i - 1]!;
      // never faster than the interval; at most one step + hit-stop slower
      expect(gap).toBeGreaterThanOrEqual(W.attack.interval - 1e-9);
      expect(gap).toBeLessThanOrEqual(W.attack.interval + COMMON.hitstop.crit + 2 / 60);
    }
  });
});
