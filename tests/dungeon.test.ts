import { describe, expect, it } from 'vitest';
import { NO_RANKS } from '../src/config/progression';
import { Rng } from '../src/core/rng';
import { DungeonDirector, composeEncounter } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/types';
import { Tile } from '../src/world/arena';
import { generateDungeon, validateDungeon, type Room } from '../src/world/dungeon';
import { autoChoose, run } from './helpers';

describe('dungeon generator', () => {
  it('produces valid, connected floors for many seeds and depths', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const depth of [1, 2, 3]) {
        const d = generateDungeon(seed * 977, depth);
        expect(validateDungeon(d), `seed ${seed} depth ${depth}`).toEqual([]);
        expect(d.rooms.filter((r) => r.type === 'exit')).toHaveLength(1);
        expect(d.rooms.filter((r) => r.type === 'treasure').length).toBeGreaterThanOrEqual(1);
        expect(d.rooms.filter((r) => r.type === 'combat').length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('is deterministic for the same seed and depth', () => {
    const a = generateDungeon(4242, 2);
    const b = generateDungeon(4242, 2);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(a.rooms.map((r) => r.type)).toEqual(b.rooms.map((r) => r.type));
    const c = generateDungeon(4243, 2);
    expect(Array.from(c.map.tiles)).not.toEqual(Array.from(a.map.tiles));
  });

  it('puts the exit as deep in the room graph as possible', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = generateDungeon(seed, 1);
      const maxDepth = Math.max(...d.rooms.map((r) => r.depth));
      expect(d.rooms[d.exitRoom]!.depth).toBe(maxDepth);
    }
  });

  it('every door sits between a room and a corridor', () => {
    const d = generateDungeon(99, 1);
    for (const r of d.rooms) {
      for (const dr of r.doors) {
        expect(d.map.tiles[dr.ty * d.map.w + dr.tx]).toBe(Tile.Floor);
        expect(d.region[dr.ty * d.map.w + dr.tx]).toBe(r.id);
      }
    }
  });
});

describe('encounters', () => {
  const room = (type: Room['type']): Room =>
    ({ type, x0: 0, y0: 0, x1: 10, y1: 10 }) as Room;

  it('scales with depth and room type', () => {
    const rng = new Rng(3);
    const count = (t: Room['type'], depth: number) => composeEncounter(room(t), depth, rng).flat().length;
    let combat1 = 0;
    let combat3 = 0;
    let elite1 = 0;
    for (let i = 0; i < 30; i++) {
      combat1 += count('combat', 1);
      combat3 += count('combat', 3);
      elite1 += count('elite', 1);
    }
    expect(combat3).toBeGreaterThan(combat1);
    expect(elite1).toBeGreaterThan(combat1);
  });

  it('elite rooms always bring a brute; each floor uses its own roster', () => {
    const rng = new Rng(8);
    for (let i = 0; i < 20; i++) expect(composeEncounter(room('elite'), 1, rng).flat()).toContain('brute');
    const floor1 = new Set<string>();
    const floor2 = new Set<string>();
    const floor3 = new Set<string>();
    for (let i = 0; i < 60; i++) {
      composeEncounter(room('combat'), 1, rng).flat().forEach((k) => floor1.add(k));
      composeEncounter(room('combat'), 2, rng).flat().forEach((k) => floor2.add(k));
      composeEncounter(room('combat'), 3, rng).flat().forEach((k) => floor3.add(k));
    }
    expect(floor1.has('hound') || floor1.has('pyre')).toBe(false);
    expect(floor2.has('hound')).toBe(true);
    expect(floor3.has('pyre')).toBe(true);
  });
});

function dungeonRun(seed = 7) {
  const d = generateDungeon(seed, 1);
  const sim = new Simulation(d.map, { seed, build: { heroId: 'warden', skills: ['sunder'], ranks: { ...NO_RANKS }, gear: [] } });
  const director = new DungeonDirector(sim, d);
  sim.director = director;
  return { d, sim, director };
}

/** Teleports the hero into a room (off its centre object) and lets the director react. */
function enterRoom(sim: Simulation, r: Room): SimEvent[] {
  sim.hero.x = sim.hero.px = r.x0 + 2.5;
  sim.hero.y = sim.hero.py = r.y0 + 2.5;
  return run(sim, 0.1);
}

describe('dungeon director', () => {
  it('starts in a cleared start room and reveals it', () => {
    const { d, director } = dungeonRun();
    expect(director.states[d.startRoom]).toBe('cleared');
    expect(director.revealedRooms[d.startRoom]).toBe(1);
  });

  it('entering a combat room locks its doors and spawns enemies; clearing it unlocks them', () => {
    const { d, sim, director } = dungeonRun();
    const r = d.rooms.find((x) => x.type === 'combat')!;
    const ev = enterRoom(sim, r);
    expect(ev.some((e) => e.type === 'roomEnter' && e.roomId === r.id)).toBe(true);
    expect(director.states[r.id]).toBe('active');
    for (const dr of r.doors) expect(d.map.tiles[dr.ty * d.map.w + dr.tx]).toBe(Tile.Door);
    expect(sim.livingEnemyCount()).toBeGreaterThan(0);
    // kill every wave
    sim.hero.hp = 1e9;
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && director.states[r.id] === 'active'; i++) {
      for (const e of sim.enemies) if (e.state !== 'dead') e.hp = 1;
      events.push(...run(sim, 0.5, { skill: true }));
      for (const e of sim.enemies) if (e.state !== 'dead' && e.state !== 'spawning') e.hp = 0, (e.state = 'dead');
      events.push(...run(sim, 1.5));
      autoChoose(sim);
    }
    expect(director.states[r.id]).toBe('cleared');
    for (const dr of r.doors) expect(d.map.tiles[dr.ty * d.map.w + dr.tx]).toBe(Tile.Floor);
    expect(events.some((e) => e.type === 'roomClear')).toBe(true);
  });

  it('a treasure chest opens an upgrade choice exactly once', () => {
    const { d, sim } = dungeonRun();
    const r = d.rooms.find((x) => x.type === 'treasure')!;
    enterRoom(sim, r);
    const chest = sim.objects.find((o) => o.kind === 'chest')!;
    expect(chest.used).toBe(false);
    sim.hero.x = chest.x;
    sim.hero.y = chest.y;
    sim.step(1 / 60);
    expect(chest.used).toBe(true);
    // the open choice freezes the world until answered
    const pending = sim.choices.length;
    expect(pending).toBeGreaterThan(0);
    const t = sim.time;
    sim.step(1 / 60);
    expect(sim.hero.x).toBe(chest.x);
    expect(sim.time).toBeGreaterThan(t);
    autoChoose(sim);
    run(sim, 1);
    expect(sim.objects.filter((o) => o.kind === 'chest' && !o.used)).toHaveLength(0);
  });

  it('stairs only work after the exit room is cleared, then end the floor', () => {
    const { d, sim, director } = dungeonRun(11);
    const exit = d.rooms[d.exitRoom]!;
    const stairs = sim.objects.find((o) => o.kind === 'stairs')!;
    expect(stairs.active).toBe(false);
    enterRoom(sim, exit);
    expect(director.states[exit.id]).toBe('active');
    sim.hero.hp = 1e9;
    let all: SimEvent[] = [];
    for (let i = 0; i < 60 && director.states[exit.id] === 'active'; i++) {
      for (const e of sim.enemies) if (e.state !== 'dead' && e.state !== 'spawning') e.hp = 0, (e.state = 'dead');
      all = all.concat(run(sim, 1));
    }
    expect(stairs.active).toBe(true);
    expect(all.some((e) => e.type === 'stairsOpen')).toBe(true);
    expect(all.some((e) => e.type === 'floorExit')).toBe(false);
    sim.hero.x = stairs.x;
    sim.hero.y = stairs.y;
    const ev = run(sim, 0.1);
    expect(ev.some((e) => e.type === 'floorExit')).toBe(true);
  });

  it('a shrine heals once', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { d, sim } = dungeonRun(seed);
      const r = d.rooms.find((x) => x.type === 'shrine');
      if (!r) continue;
      sim.hero.hp = 10;
      enterRoom(sim, r);
      const shrine = sim.objects.find((o) => o.kind === 'shrine')!;
      sim.hero.x = shrine.x;
      sim.hero.y = shrine.y;
      run(sim, 0.1);
      expect(sim.hero.hp).toBeGreaterThan(10);
      const hp = sim.hero.hp;
      run(sim, 0.5);
      expect(sim.hero.hp).toBe(hp);
      return;
    }
    throw new Error('no shrine in 40 seeds');
  });
});
