import { describe, expect, it } from 'vitest';
import { COMMON, ENEMIES } from '../src/config/balance';
import { HEROES } from '../src/config/heroes';
import { SKILLS } from '../src/config/skills';
import { Rng } from '../src/core/rng';
import { applyReduction, rollDamage } from '../src/sim/damage';
import type { Simulation } from '../src/sim/simulation';
import { ANTECHAMBER_LAYOUT, parseArena } from '../src/world/arena';
import { openRoom, run, sandbox, withWaves } from './helpers';

const W = HEROES.warden;

describe('damage formula', () => {
  it('applies crit multiplier and reduction', () => {
    const always = new Rng(1);
    expect(rollDamage(10, 1, 2, 0, always)).toEqual({ amount: 20, crit: true });
    expect(rollDamage(10, 0, 2, 0.5, always)).toEqual({ amount: 5, crit: false });
  });
  it('caps reduction at 80% and never deals less than 1', () => {
    expect(applyReduction(100, 5)).toBe(20);
    expect(applyReduction(1, 0.8)).toBe(1);
  });
  it('crit rate converges on the configured chance', () => {
    const rng = new Rng(42);
    let crits = 0;
    for (let i = 0; i < 20000; i++) if (rollDamage(10, 0.12, 1.8, 0, rng).crit) crits++;
    expect(crits / 20000).toBeGreaterThan(0.11);
    expect(crits / 20000).toBeLessThan(0.13);
  });
});

describe('dodge', () => {
  it('moves the hero the configured distance in the input direction', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    const x0 = sim.hero.x;
    run(sim, W.dodge.duration + 0.05, { moveX: 1, moveY: 0, dodge: true });
    // dodge distance + a little walking after the roll ends
    expect(sim.hero.x - x0).toBeGreaterThan(W.dodge.distance - 0.01);
    expect(sim.hero.x - x0).toBeLessThan(W.dodge.distance + 0.05 * W.moveSpeed + 0.02);
  });

  it('cannot be spammed: a second press during cooldown does nothing', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    const ev1 = run(sim, 0.4, { dodge: true });
    expect(ev1.filter((e) => e.type === 'dodge').length).toBe(1);
    const ev2 = run(sim, 0.2, { dodge: true });
    expect(ev2.filter((e) => e.type === 'dodge').length).toBe(0);
    run(sim, W.dodge.cooldown);
    const ev3 = run(sim, 0.1, { dodge: true });
    expect(ev3.filter((e) => e.type === 'dodge').length).toBe(1);
  });

  it('a press slightly before the cooldown ends is buffered', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    run(sim, W.dodge.cooldown - 0.08, { dodge: true });
    const ev = run(sim, 0.2, { dodge: true });
    expect(ev.filter((e) => e.type === 'dodge').length).toBe(1);
  });

  it('grants invulnerability during the i-frame window only', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    run(sim, 0.05, { dodge: true });
    expect(sim.damageHero(50)).toBe(false);
    expect(sim.hero.hp).toBe(W.maxHp);
    run(sim, W.dodge.iframes);
    expect(sim.damageHero(10)).toBe(true);
    expect(sim.hero.hp).toBe(W.maxHp - 10);
  });

  it('cannot pass through walls', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    sim.hero.x = 2;
    run(sim, 0.5, { moveX: -1, dodge: true });
    expect(sim.hero.x).toBeGreaterThanOrEqual(1 + COMMON.heroRadius - 1e-6);
  });
});

describe('enemy telegraphed attacks', () => {
  it('a thrall winds up before striking; standing still gets you hit', () => {
    const sim = sandbox(openRoom(), { seed: 5 });
    const h = sim.hero;
    const e = sim.spawnEnemy('thrall', h.x + 1.0, h.y, { instant: true });
    h.hp = 1000; // stay alive
    const ev = run(sim, ENEMIES.thrall.attack.windup + 0.1);
    const windupIdx = ev.findIndex((x) => x.type === 'windup' && x.id === e.id);
    const strikeIdx = ev.findIndex((x) => x.type === 'strike' && x.id === e.id);
    expect(windupIdx).toBeGreaterThanOrEqual(0);
    expect(strikeIdx).toBeGreaterThan(windupIdx);
    expect(ev.some((x) => x.type === 'heroHurt')).toBe(true);
  });

  it('walking out of the telegraphed area avoids the hit', () => {
    const sim = sandbox(openRoom(), { seed: 5 });
    const h = sim.hero;
    const e = sim.spawnEnemy('brute', h.x + 1.5, h.y, { instant: true });
    run(sim, 0.05);
    expect(e.state).toBe('windup');
    // run away from the brute for the rest of the wind-up
    const ev = run(sim, ENEMIES.brute.attack.windup, { moveX: -1, moveY: 0 });
    expect(ev.find((x) => x.type === 'strike')).toMatchObject({ hit: false });
    expect(h.hp).toBe(W.maxHp);
  });

  it('dodging through the strike avoids damage via i-frames', () => {
    const sim = sandbox(openRoom(), { seed: 5 });
    const h = sim.hero;
    const e = sim.spawnEnemy('thrall', h.x + 1.0, h.y, { instant: true });
    run(sim, ENEMIES.thrall.attack.windup - 0.1);
    expect(e.state).toBe('windup');
    // dodge INTO the enemy: still safe thanks to i-frames
    const ev = run(sim, 0.2, { moveX: 1, dodge: true });
    expect(ev.some((x) => x.type === 'evade') || ev.some((x) => x.type === 'strike' && !x.hit)).toBe(true);
    expect(h.hp).toBe(W.maxHp);
  });

  it('walks around a brazier instead of pushing into it (sight is clear, path is not)', () => {
    const sim = sandbox(openRoom({ 8: '#........B.....#' }), { seed: 5 });
    const h = sim.hero;
    h.x = 8.5;
    h.y = 8.5;
    const e = sim.spawnEnemy('thrall', 10.6, 8.5, { instant: true });
    e.attackCd = 99;
    let closest = Infinity;
    for (let i = 0; i < 12; i++) {
      run(sim, 0.25);
      closest = Math.min(closest, Math.hypot(e.x - h.x, e.y - h.y));
    }
    expect(closest).toBeLessThan(1.2);
    expect(e.hp).toBeLessThan(e.maxHp); // it came into reach and the auto-attack connected
  });

  it('enemies do not hit through walls', () => {
    const sim = sandbox(openRoom({ 8: '#........#.....#' }), { seed: 5 });
    const h = sim.hero;
    h.x = 8.7;
    h.y = 8.5;
    const e = sim.spawnEnemy('thrall', 10.4, 8.5, { instant: true });
    e.attackCd = 0;
    const ev = run(sim, 0.2);
    expect(ev.some((x) => x.type === 'windup')).toBe(false);
  });
});

describe('active skill: Sunder', () => {
  it('damages, stuns and interrupts enemies in radius, then goes on cooldown', () => {
    const sim = sandbox(openRoom(), { seed: 9 });
    const h = sim.hero;
    const e = sim.spawnEnemy('thrall', h.x + 1.2, h.y, { instant: true });
    run(sim, 0.05);
    expect(e.state).toBe('windup');
    const ev = run(sim, SKILLS.sunder.castTime + 0.1, { skill: true });
    expect(ev.some((x) => x.type === 'skillCast')).toBe(true);
    expect(ev.some((x) => x.type === 'interrupt' && x.id === e.id)).toBe(true);
    expect(e.state === 'stunned' || e.state === 'dead').toBe(true);
    expect(h.skills[0]!.cd).toBeGreaterThan(SKILLS.sunder.cooldown - 0.5);
    const again = run(sim, 0.2, { skill: true });
    expect(again.some((x) => x.type === 'skillCast')).toBe(false);
  });

  it('cannot be used while dodging or dead', () => {
    const sim = sandbox(openRoom(), { seed: 9 });
    run(sim, 0.05, { dodge: true });
    expect(sim.hero.state).toBe('dodge');
    // press skill once mid-dodge; buffer (0.15s) expires before the roll ends (0.3s)
    const ev = run(sim, 0.05, { skill: true });
    expect(ev.some((x) => x.type === 'skillCast')).toBe(false);
    sim.hero.hp = 1;
    sim.hero.iframeT = 0;
    sim.damageHero(10);
    expect(sim.hero.state).toBe('dead');
    const ev2 = run(sim, 0.3, { skill: true, dodge: true });
    expect(ev2.some((x) => x.type === 'skillCast' || x.type === 'dodge')).toBe(false);
  });

  it('roots the hero during the cast', () => {
    const sim = sandbox(openRoom(), { seed: 9 });
    const x0 = sim.hero.x;
    run(sim, SKILLS.sunder.castTime - 0.05, { moveX: 1, skill: true });
    expect(sim.hero.x).toBeCloseTo(x0, 6);
  });
});

describe('hero death and waves', () => {
  it('hero dies at 0 hp exactly once and stops acting', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    sim.hero.hp = 5;
    sim.damageHero(10);
    expect(sim.hero.hp).toBe(0);
    expect(sim.hero.state).toBe('dead');
    expect(sim.drainEvents().filter((e) => e.type === 'heroDeath').length).toBe(1);
    const ev = run(sim, 1, { moveX: 1 });
    expect(ev.filter((e) => e.type === 'heroDeath').length).toBe(0);
    expect(sim.hero.hp).toBe(0);
  });

  it('mercy i-frames stop two hits in a row', () => {
    const sim = sandbox(openRoom(), { seed: 1 });
    expect(sim.damageHero(10)).toBe(true);
    expect(sim.damageHero(10)).toBe(false);
    run(sim, COMMON.hurtIframes + 0.02);
    expect(sim.damageHero(10)).toBe(true);
  });

  it('spawns wave 1 on its own, away from the hero', () => {
    const map = parseArena(ANTECHAMBER_LAYOUT);
    const sim = withWaves(sandbox(map, { seed: 11 }));
    const ev = run(sim, 1.2);
    expect(ev.some((e) => e.type === 'spawn')).toBe(true);
    expect(sim.livingEnemyCount()).toBeGreaterThan(0);
    for (const e of sim.enemies) {
      expect(Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y)).toBeGreaterThan(3.5);
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const map = parseArena(ANTECHAMBER_LAYOUT);
    const script = (sim: Simulation) => {
      run(sim, 2, { moveX: 0.7, moveY: -0.3 });
      run(sim, 0.5, { dodge: true, moveX: -1 });
      run(sim, 3, { skill: true });
      run(sim, 4, { moveX: 0, moveY: 1 });
      return sim.stateHash();
    };
    const a = script(withWaves(sandbox(map, { seed: 77 })));
    const b = script(withWaves(sandbox(map, { seed: 77 })));
    const c = script(withWaves(sandbox(map, { seed: 78 })));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('enemies stay inside walkable space over a long fight', () => {
    const map = parseArena(ANTECHAMBER_LAYOUT);
    const sim = withWaves(sandbox(map, { seed: 5 }));
    sim.hero.hp = 1e9;
    for (let t = 0; t < 40; t++) {
      run(sim, 1, { moveX: Math.cos(t), moveY: Math.sin(t), dodge: t % 3 === 0, skill: t % 8 === 0 });
      for (const e of sim.enemies) {
        expect(e.x).toBeGreaterThan(1);
        expect(e.y).toBeGreaterThan(1);
        expect(e.x).toBeLessThan(map.w - 1);
        expect(e.y).toBeLessThan(map.h - 1);
      }
    }
    expect(sim.kills).toBeGreaterThan(0);
  });
});
