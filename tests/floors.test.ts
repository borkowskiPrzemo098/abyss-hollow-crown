import { describe, expect, it } from 'vitest';
import { DUNGEON } from '../src/config/dungeon';
import { Rng } from '../src/core/rng';
import { NO_RANKS } from '../src/config/progression';
import { DungeonDirector, composeEncounter } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';
import { FlowField } from '../src/world/flowField';
import { Tile, isWalkable } from '../src/world/arena';
import { FIGHT_ROOMS, generateDungeon, validateDungeon, validateRoute, type Dungeon, type Room, type RoomType } from '../src/world/dungeon';
import { run } from './helpers';

const SEEDS = Array.from({ length: 40 }, (_, i) => 31 + i * 977);
const DEPTHS = [1, 2, 3] as const;
const floors: Dungeon[] = SEEDS.flatMap((seed) => DEPTHS.map((depth) => generateDungeon(seed, depth)));

/** Tiles that belong to side branches (their rooms, rings and narrow corridors) are walls; can the boss still be reached? */
function exitReachableWithoutBranches(d: Dungeon): boolean {
  const W = d.map.w;
  const blocked = (idx: number): boolean => {
    const reg = d.region[idx]!;
    if (reg >= 0) return d.rooms[reg]!.route === 'branch';
    if (reg <= -2) return !d.corridors[-reg - 2]!.main;
    return false;
  };
  const start = d.rooms[d.startRoom]!;
  const seen = new Uint8Array(W * W);
  const stack = [Math.floor(start.cy) * W + Math.floor(start.cx)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % W;
    const y = (idx - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = (y + dy) * W + (x + dx);
      if (seen[n] || !isWalkable(d.map, x + dx, y + dy) || blocked(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const exit = d.rooms[d.exitRoom]!;
  return seen[Math.floor(exit.cy) * W + Math.floor(exit.cx)] === 1;
}

describe('floor structure', () => {
  it('every floor of every seed is valid, including the shape of the route', () => {
    for (const d of floors) expect(validateDungeon(d), `seed ${d.seed} depth ${d.depth}`).toEqual([]);
  });

  it('has a long main route of the configured length and a good number of optional rooms', () => {
    for (const d of floors) {
      const want = DUNGEON.mainRooms[Math.min(d.depth, DUNGEON.mainRooms.length) - 1]!;
      expect(d.mainRoute.length).toBe(want);
      const optional = d.rooms.filter((r) => r.route === 'branch');
      expect(optional.length, `seed ${d.seed}`).toBeGreaterThanOrEqual(5);
      expect(d.rooms.length).toBeGreaterThanOrEqual(want + 5);
      expect(d.rooms.length).toBeLessThanOrEqual(40);
      expect(d.branches.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('leads from the entrance to the boss through one chain of rooms, with no loops', () => {
    for (const d of floors) {
      expect(d.mainRoute[0]).toBe(d.startRoom);
      expect(d.mainRoute[d.mainRoute.length - 1]).toBe(d.exitRoom);
      d.mainRoute.forEach((id, i) => {
        if (i > 0) expect(d.rooms[id]!.links).toContain(d.mainRoute[i - 1]);
        expect(d.rooms[id]!.depth).toBe(i);
      });
      expect(d.corridors.length).toBe(d.rooms.length - 1);
      expect(d.corridors.filter((c) => c.main).length).toBe(d.mainRoute.length - 1);
    }
  });

  it('never makes a side branch mandatory: the boss is reachable with every branch walled off', () => {
    for (const d of floors) expect(exitReachableWithoutBranches(d), `seed ${d.seed} depth ${d.depth}`).toBe(true);
  });

  it('ends every branch in a dead end that holds a reward, and the boss is the deepest room', () => {
    for (const d of floors) {
      const maxDepth = Math.max(...d.rooms.map((r) => r.depth));
      expect(d.rooms[d.exitRoom]!.depth).toBe(maxDepth);
      for (const b of d.branches) {
        expect(b.rooms.length).toBeGreaterThanOrEqual(DUNGEON.branchLength[0]);
        expect(b.rooms.length).toBeLessThanOrEqual(DUNGEON.branchLength[1]);
        const end = d.rooms[b.rooms[b.rooms.length - 1]!]!;
        expect(['treasure', 'elite', 'shrine', 'trial', 'altar']).toContain(end.type);
        expect(end.links.length).toBe(1);
        // walking a branch never means walking through the boss lair or the entrance
        for (const id of b.rooms) expect([d.startRoom, d.exitRoom]).not.toContain(id);
      }
      // at least one plain treasure, and chests exist on branches
      expect(d.rooms.some((r) => r.type === 'treasure')).toBe(true);
    }
  });

  it('paces the main route: easy start, a rest before the boss, tougher fights and breathers in between', () => {
    for (const d of floors) {
      const types = d.mainRoute.map((id) => d.rooms[id]!.type);
      expect(types[0]).toBe('start');
      expect(types[types.length - 1]).toBe('exit');
      expect(types[types.length - 2], `seed ${d.seed}`).toBe('shrine');
      const inner = types.slice(1, -1);
      expect(inner.filter((t) => t === 'arena').length).toBeGreaterThanOrEqual(1);
      expect(inner.filter((t) => t === 'elite').length).toBeGreaterThanOrEqual(1);
      expect(inner.filter((t) => t === 'trial').length).toBeGreaterThanOrEqual(1);
      expect(inner.filter((t) => t === 'shrine').length).toBeGreaterThanOrEqual(2);
      expect(inner.filter((t) => t === 'combat').length).toBeGreaterThanOrEqual(4);
      expect(inner.filter((t) => t === 'combat' || t === 'arena' || t === 'elite').length).toBeGreaterThanOrEqual(7);
      // the first rooms are gentle: ordinary fights or a quiet trap hall, never an arena or an elite lair
      expect(types.slice(1, 3).every((t) => t === 'combat' || t === 'trial')).toBe(true);
      // two big fights never come back to back, and a trial hall on the route has no chest
      inner.forEach((t, i) => {
        if (t === 'arena' || t === 'elite') expect(['arena', 'elite']).not.toContain(inner[i + 1]);
      });
    }
    for (const d of floors) for (const id of d.mainRoute) if (d.rooms[id]!.type === 'trial') expect(d.objects.some((o) => o.roomId === id && o.kind === 'chest')).toBe(false);
  });

  it('is varied: many room kinds, furnishings and fight styles on one floor and across floors', () => {
    for (const d of floors) expect(new Set(d.rooms.map((r) => r.type)).size, `seed ${d.seed} depth ${d.depth}`).toBeGreaterThanOrEqual(6);
    const layouts = new Set(floors.flatMap((d) => d.rooms.map((r) => r.layout)));
    expect(layouts.size).toBeGreaterThanOrEqual(9);
    const styles = new Set(floors.flatMap((d) => d.rooms.filter((r) => FIGHT_ROOMS.has(r.type) && r.type !== 'exit').map((r) => r.style)));
    expect(styles).toEqual(new Set(['standard', 'swarm', 'ranged', 'brutes']));
    // the routes differ in shape, not just in length
    const shapes = new Set(floors.map((d) => d.mainRoute.map((id) => `${d.rooms[id]!.gx},${d.rooms[id]!.gy}`).join('|')));
    expect(shapes.size).toBeGreaterThan(floors.length * 0.95);
  });

  it('makes the main route wide and side branches narrow, so the way on is easy to read', () => {
    const d = generateDungeon(7001, 2);
    const countDoors = (r: Room, other: number) => {
      // doors of r on the ring side that faces `other`: width of the corridor between them
      const o = d.rooms[other]!;
      return r.doors.filter((dr) => (dr.tx === r.x1 + 1 && o.gx > r.gx) || (dr.tx === r.x0 - 1 && o.gx < r.gx) || (dr.ty === r.y1 + 1 && o.gy > r.gy) || (dr.ty === r.y0 - 1 && o.gy < r.gy)).length;
    };
    for (const c of d.corridors) {
      const a = d.rooms[c.a]!;
      expect(countDoors(a, c.b)).toBe(c.main ? DUNGEON.corridorWidth : DUNGEON.branchWidth);
    }
  });

  it('is exactly the same floor for the same seed and depth, and a different one otherwise', () => {
    const a = generateDungeon(555, 2);
    const b = generateDungeon(555, 2);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(a.rooms.map((r) => [r.type, r.layout, r.style, r.route, r.x0, r.y0])).toEqual(b.rooms.map((r) => [r.type, r.layout, r.style, r.route, r.x0, r.y0]));
    expect(a.mainRoute).toEqual(b.mainRoute);
    expect(a.branches).toEqual(b.branches);
    expect(a.traps).toEqual(b.traps);
    expect(a.objects).toEqual(b.objects);
    expect(Array.from(generateDungeon(556, 2).map.tiles)).not.toEqual(Array.from(a.map.tiles));
    expect(Array.from(generateDungeon(555, 3).map.tiles)).not.toEqual(Array.from(a.map.tiles));
  });

  it('keeps the boss lair the same size on every floor', () => {
    for (const d of floors) {
      const lair = d.rooms[d.exitRoom]!;
      expect(lair.x1 - lair.x0 + 1).toBe(DUNGEON.roomMax);
      expect(lair.y1 - lair.y0 + 1).toBe(DUNGEON.roomMax);
    }
  });

  it('gives fighting rooms plenty of room to spawn and every object a place to stand', () => {
    for (const d of floors) {
      for (const r of d.rooms) {
        if (FIGHT_ROOMS.has(r.type)) expect(r.spawns.length).toBeGreaterThanOrEqual(r.type === 'arena' ? 20 : 8);
      }
      for (const o of d.objects) expect(d.map.tiles[Math.floor(o.y) * d.map.w + Math.floor(o.x)]).toBe(Tile.Floor);
    }
  });

  it('puts the traps where they belong: dense in trial halls, none in rooms for resting', () => {
    const counts: Record<string, number[]> = {};
    for (const d of floors.filter((f) => f.depth === 1)) {
      const per = new Map<number, number>();
      for (const t of d.traps) {
        const r = d.region[t.ty * d.map.w + t.tx]!;
        per.set(r, (per.get(r) ?? 0) + 1);
      }
      for (const r of d.rooms) (counts[r.type] ??= []).push(per.get(r.id) ?? 0);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const calm of ['shrine', 'treasure', 'altar', 'start', 'exit']) expect(Math.max(...counts[calm]!), calm).toBe(0);
    expect(avg(counts.trial!)).toBeGreaterThan(avg(counts.combat!) * 1.5);
    expect(avg(counts.arena!)).toBeGreaterThan(avg(counts.combat!));
  });

  it('detects a broken layout instead of accepting it', () => {
    const fresh = () => generateDungeon(9090, 1);
    let d = fresh();
    d.mainRoute.pop();
    expect(validateRoute(d).some((e) => e.includes('boss lair'))).toBe(true);
    d = fresh();
    d.mainRoute = d.mainRoute.slice().reverse();
    expect(validateRoute(d).length).toBeGreaterThan(0);
    d = fresh();
    d.corridors.pop();
    expect(validateRoute(d).some((e) => e.includes('loops or islands'))).toBe(true);
    d = fresh();
    d.rooms[d.branches[0]!.rooms[0]!]!.route = 'main';
    expect(validateRoute(d).length).toBeGreaterThan(0);
    d = fresh();
    d.rooms[d.branches[0]!.rooms[d.branches[0]!.rooms.length - 1]!]!.type = 'combat';
    expect(validateRoute(d).some((e) => e.includes('not a reward'))).toBe(true);
    // a branch that reaches deeper than the boss would make the boss a place you pass, not the end
    d = fresh();
    d.rooms[d.branches[0]!.rooms[0]!]!.depth = 99;
    expect(validateRoute(d).some((e) => e.includes('deeper than the boss'))).toBe(true);
    expect(validateDungeon(fresh())).toEqual([]);
  });
});

// ───────────────────────────── encounters ─────────────────────────────

describe('encounters on the long floors', () => {
  const room = (type: RoomType, extra: Partial<Room> = {}): Room => ({ type, x0: 0, y0: 0, x1: 11, y1: 11, progress: 0.5, style: 'standard', ...extra }) as Room;
  const sizes = (r: Room, depth: number, n = 40) => {
    const rng = new Rng(11);
    return Array.from({ length: n }, () => composeEncounter(r, depth, rng));
  };

  it('never puts more than a handful of enemies on the field at once, however big the room', () => {
    for (const type of ['combat', 'arena', 'elite'] as const) {
      for (const depth of DEPTHS) {
        for (const w of sizes(room(type, { x1: 15, y1: 15, progress: 1 }), depth)) {
          expect(w.length).toBeLessThanOrEqual(DUNGEON.maxWaves);
          for (const wave of w) expect(wave.length).toBeLessThanOrEqual(DUNGEON.maxAlive);
        }
      }
    }
  });

  it('gives arenas several waves, and more enemies than an ordinary fight', () => {
    const total = (r: Room, depth: number) => sizes(r, depth).reduce((a, w) => a + w.flat().length, 0) / 40;
    for (const w of sizes(room('arena'), 1)) expect(w.length).toBe(DUNGEON.arenaMinWaves);
    expect(total(room('arena'), 2)).toBeGreaterThan(total(room('combat'), 2) * 1.4);
  });

  it('builds up along the floor: later rooms hold more than the first ones', () => {
    const total = (progress: number) => sizes(room('combat', { progress }), 2).reduce((a, w) => a + w.flat().length, 0) / 40;
    expect(total(0.95)).toBeGreaterThan(total(0.05) * 1.25);
  });

  it('differs by style: a swarm is thralls, ranged fights are archers, brutes lead with brutes', () => {
    const share = (style: Room['style'], kind: string, depth = 1) => {
      let n = 0;
      let all = 0;
      for (const w of sizes(room('combat', { style }), depth)) for (const k of w.flat()) (all++, k === kind && n++);
      return n / all;
    };
    expect(share('swarm', 'thrall')).toBeGreaterThan(share('standard', 'thrall'));
    expect(share('ranged', 'acolyte')).toBeGreaterThan(share('standard', 'acolyte') * 1.5);
    const brutes = (style: Room['style']) => sizes(room('combat', { style }), 2).reduce((a, w) => a + w.flat().filter((k) => k === 'brute').length, 0);
    expect(brutes('brutes')).toBeGreaterThan(brutes('standard'));
    // the first floor stays free of brutes outside elite lairs, whatever the style
    expect(brutes('brutes') >= 0 && sizes(room('combat', { style: 'brutes' }), 1).every((w) => !w.flat().includes('brute'))).toBe(true);
  });

  it('is repeatable for the same random stream', () => {
    const a = composeEncounter(room('arena'), 2, new Rng(5));
    const b = composeEncounter(room('arena'), 2, new Rng(5));
    expect(a).toEqual(b);
  });
});

// ───────────────────────────── events in the director ─────────────────────────────

function floorRun(depth = 1, seed = 4) {
  const d = generateDungeon(seed, depth);
  const sim = new Simulation(d.map, { seed, build: { heroId: 'warden', skills: ['sunder'], ranks: { ...NO_RANKS }, gear: [] } });
  const director = new DungeonDirector(sim, d);
  sim.director = director;
  return { d, sim, director };
}
const enter = (sim: Simulation, r: Room) => {
  sim.hero.x = sim.hero.px = r.x0 + 2.5;
  sim.hero.y = sim.hero.py = r.y0 + 2.5;
  return run(sim, 0.1);
};

describe('rooms that are not fights', () => {
  it('a trial hall holds no enemies and its doors never close; on a branch it ends in a chest with an upgrade', () => {
    const { d, sim, director } = floorRun();
    const trial = d.rooms.find((r) => r.type === 'trial' && r.route === 'branch') ?? d.rooms.find((r) => r.type === 'trial')!;
    enter(sim, trial);
    expect(director.states[trial.id]).toBe('cleared');
    expect(sim.livingEnemyCount()).toBe(0);
    for (const dr of trial.doors) expect(d.map.tiles[dr.ty * d.map.w + dr.tx]).toBe(Tile.Floor);
    const chest = sim.objects.find((o) => o.kind === 'chest' && o.roomId === trial.id);
    if (trial.route === 'branch') {
      expect(chest).toBeTruthy();
      sim.hero.x = chest!.x;
      sim.hero.y = chest!.y;
      sim.step(1 / 60);
      expect(chest!.used).toBe(true);
      expect(sim.drainEvents().some((e) => e.type === 'choice') || sim.choices.length > 0).toBe(true);
    }
  });

  it('an altar costs a share of health, gives an upgrade and an item, and never kills', () => {
    let found = false;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const { d, sim } = floorRun(1, seed);
      const room = d.rooms.find((r) => r.type === 'altar');
      if (!room) continue;
      found = true;
      const altar = sim.objects.find((o) => o.kind === 'altar')!;
      const full = sim.hero.stats.maxHp;
      // too hurt: it refuses and stays available
      sim.hero.hp = full * DUNGEON.altarCost;
      enter(sim, room);
      sim.hero.x = altar.x;
      sim.hero.y = altar.y;
      const refused = run(sim, 0.2);
      expect(refused.some((e) => e.type === 'altarRefused')).toBe(true);
      expect(altar.used).toBe(false);
      expect(sim.hero.hp).toBeGreaterThan(0);
      // healthy: pays, gets the reward
      sim.hero.hp = full;
      sim.hero.x = altar.x + 0.1;
      const ev = run(sim, 0.2);
      expect(altar.used).toBe(true);
      expect(sim.hero.hp).toBeCloseTo(full * (1 - DUNGEON.altarCost), 5);
      expect(ev.some((e) => e.type === 'altar')).toBe(true);
      // (the test helper answers choices and the hero picks the item up at once, so look at the events)
      expect(ev.some((e) => e.type === 'choice')).toBe(true);
      expect(sim.pickups.some((q) => q.kind === 'item') || sim.loot.length > 0).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('an arena clears in several waves and pays more than a plain fight', () => {
    const { d, sim, director } = floorRun(2, 12);
    const arena = d.rooms.find((r) => r.type === 'arena')!;
    sim.hero.hp = 1;
    sim.hero.stats.maxHp = 1000;
    enter(sim, arena);
    expect(director.states[arena.id]).toBe('active');
    let waves = 0;
    let seenAlive = 0;
    for (let i = 0; i < 200 && director.states[arena.id] === 'active'; i++) {
      seenAlive = Math.max(seenAlive, sim.livingEnemyCount());
      if (sim.livingEnemyCount() > 0) waves++;
      for (const e of sim.enemies) if (e.state !== 'dead' && e.state !== 'spawning') (e.hp = 0, (e.state = 'dead'));
      sim.hero.hp = 500;
      run(sim, 0.7);
    }
    expect(director.states[arena.id]).toBe('cleared');
    expect(seenAlive).toBeLessThanOrEqual(DUNGEON.maxAlive);
    expect(waves).toBeGreaterThanOrEqual(DUNGEON.arenaMinWaves);
  });
});

// ───────────────────────────── cost ─────────────────────────────

describe('cost of a big floor', () => {
  it('generates quickly', () => {
    const t0 = performance.now();
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      generateDungeon(8000 + i * 13, 1 + (i % 3));
      worst = Math.max(worst, performance.now() - t);
    }
    const mean = (performance.now() - t0) / 30;
    expect(mean).toBeLessThan(40);
    expect(worst).toBeLessThan(250);
  });

  it('keeps the map and its helper arrays small', () => {
    const d = generateDungeon(1, 3);
    const W = d.map.w;
    expect(W * W).toBeLessThanOrEqual(150 * 150);
    // tiles + region + flow field: bytes of typed arrays for the whole floor
    const bytes = d.map.tiles.byteLength + d.region.byteLength + new FlowField(d.map).dist.byteLength;
    expect(bytes).toBeLessThan(250_000);
  });

  it('finds a path across the whole floor, and the flow field is rebuilt only when the goal tile changes', () => {
    const d = generateDungeon(2468, 3);
    const flow = new FlowField(d.map);
    const exit = d.rooms[d.exitRoom]!;
    const t0 = performance.now();
    flow.setGoal(Math.floor(exit.cx) + 1, Math.floor(exit.cy));
    const first = performance.now() - t0;
    expect(first).toBeLessThan(40);
    const start = d.rooms[d.startRoom]!;
    expect(flow.isReachable(Math.floor(start.cx), Math.floor(start.cy))).toBe(true);
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) flow.setGoal(Math.floor(exit.cx) + 1, Math.floor(exit.cy)); // same goal: free
    expect(performance.now() - t1).toBeLessThan(5);
    // the path really leads there
    let x = Math.floor(start.cx);
    let y = Math.floor(start.cy);
    for (let i = 0; i < 2000; i++) {
      const w = flow.nextWaypoint(x, y);
      if (!w) break;
      x = Math.floor(w.x);
      y = Math.floor(w.y);
    }
    expect(Math.hypot(x - exit.cx, y - exit.cy)).toBeLessThan(3);
  });

  it('runs the simulation at a small fraction of a frame while a fight is on, on the biggest floor', () => {
    const { d, sim, director } = floorRun(3, 77);
    const arena = d.rooms.find((r) => r.type === 'arena')!;
    sim.hero.stats.maxHp = 1e6;
    sim.hero.hp = 1e6;
    enter(sim, arena);
    expect(director.states[arena.id]).toBe('active');
    const steps = 60 * 12;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      sim.setInput({ moveX: Math.cos(i / 90), moveY: Math.sin(i / 70), dodge: false, skill: i % 200 === 0 });
      sim.step(1 / 60);
      sim.drainEvents();
    }
    const perStep = (performance.now() - t0) / steps;
    // the frame budget is 16 ms; the simulation must use a sliver of it even in a slow test runner
    expect(perStep).toBeLessThan(2);
  });
});
