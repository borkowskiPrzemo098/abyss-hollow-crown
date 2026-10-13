import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/balance';
import { HEROES } from '../src/config/heroes';
import { NO_RANKS } from '../src/config/progression';
import { SKILLS } from '../src/config/skills';
import { LAYOUT_VERSION, describeRun, fitsDungeon, floorSeed, makeRunSave, parseRunSave, type RunSave } from '../src/meta/runSave';
import { SAVE_VERSION, defaultSave, parseSave } from '../src/meta/save';
import { DungeonDirector } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';
import { generateDungeon, type Dungeon } from '../src/world/dungeon';
import { playerBot } from './bots';
import { autoChoose } from './helpers';

/** Plays the first `count` rooms of the main route (teleporting between them, as the balance tests do) and returns to a calm moment. */
function playRooms(seed: number, depth: number, count: number, hero: 'warden' | 'wanderer' = 'warden') {
  const d = generateDungeon(floorSeed(seed, depth), depth);
  const skills = hero === 'warden' ? (['sunder', 'charge'] as const) : (['volley', 'seal'] as const);
  const sim = new Simulation(d.map, { seed, build: { heroId: hero, skills: [...skills], ranks: { ...NO_RANKS }, gear: [] } });
  const dir = new DungeonDirector(sim, d);
  sim.director = dir;
  const step = () => {
    // a hero that is never allowed to die: these tests are about saving, not about surviving the third floor
    if (sim.hero.hp < sim.hero.stats.maxHp * 0.4) sim.hero.hp = sim.hero.stats.maxHp;
    sim.setInput(playerBot(sim));
    sim.step(SIM_DT);
    sim.drainEvents();
    autoChoose(sim);
  };
  for (const id of d.mainRoute.slice(1, count + 1)) {
    const r = d.rooms[id]!;
    sim.hero.x = sim.hero.px = r.x0 + 1.5;
    sim.hero.y = sim.hero.py = r.y0 + 1.5;
    for (let t = 0; t < 120 / SIM_DT; t++) {
      step();
      if (dir.states[id] === 'cleared' && sim.livingEnemyCount() === 0) break;
    }
    const obj = sim.objects.find((o) => o.roomId === id && !o.used && o.active && o.kind !== 'stairs');
    if (obj) {
      sim.hero.x = obj.x;
      sim.hero.y = obj.y;
      step();
    }
  }
  // a fight the bot could not finish within its time (rare, on the deeper floors) is ended by hand
  for (let i = 0; i < 60 && dir.activeRoom; i++) {
    for (const e of sim.enemies) if (e.state !== 'dead' && e.state !== 'spawning') sim.damageEnemy(e, { amount: 1e6, crit: false }, 'attack', 0, 0);
    for (let t = 0; t < 30; t++) {
      sim.setInput({ moveX: 0, moveY: 0, dodge: false, skill: false });
      sim.step(SIM_DT);
      sim.drainEvents();
      autoChoose(sim);
    }
  }
  // let timers run out and the loot settle
  for (let t = 0; t < 4 / SIM_DT; t++) {
    sim.setInput({ moveX: 0, moveY: 0, dodge: false, skill: false });
    sim.step(SIM_DT);
    sim.drainEvents();
    autoChoose(sim);
  }
  return { d, sim, dir, seed, depth };
}

/** A hash of the world that does not depend on entity ids (a restored run numbers its objects afresh). */
function worldHash(sim: Simulation, dir: DungeonDirector): string {
  const r = (v: number) => Math.round(v * 100);
  const h = sim.hero;
  const e = sim.enemies
    .filter((q) => q.state !== 'dead')
    .map((q) => `${q.kind}@${r(q.x)},${r(q.y)}:${Math.round(q.hp)}`)
    .sort();
  return [r(h.x), r(h.y), Math.round(h.hp), h.level, Math.round(h.xp), sim.kills, sim.ash, dir.states.join(''), e.join(';'), sim.rng.getState()].join('|');
}

/** For a readable failure: what is going on that makes this not a calm moment. */
function whyNotCalm(sim: Simulation, dir: DungeonDirector): string {
  const out: string[] = [];
  if (sim.hero.state === 'dead') out.push('hero dead');
  if (dir.activeRoom) out.push(`room ${dir.activeRoom.id} active`);
  if (sim.choices.length) out.push('choice open');
  if (sim.livingEnemyCount()) out.push(`${sim.livingEnemyCount()} enemies`);
  if (sim.projectiles.length) out.push('projectiles');
  if (sim.hazards.length) out.push('hazards');
  return out.join(', ');
}

function roundTrip(rs: RunSave): RunSave {
  return JSON.parse(JSON.stringify(rs)) as RunSave;
}

function resume(rs: RunSave, d: Dungeon, hero: 'warden' | 'wanderer' = 'warden') {
  const sim = new Simulation(d.map, { seed: rs.seed, build: { heroId: hero, skills: rs.skills, ranks: { ...NO_RANKS }, gear: [] } });
  const dir = new DungeonDirector(sim, d);
  sim.director = dir;
  sim.restore(rs.sim);
  dir.restore(rs.director);
  return { sim, dir };
}

describe('saving a run at a calm moment', () => {
  it('takes no snapshot in the middle of a fight, and one when it is quiet again', () => {
    const { d, sim, dir, seed, depth } = playRooms(5, 1, 3);
    const info = { seed, depth, time: 321, heroId: 'warden' as const, skills: ['sunder', 'charge'] as const };
    expect(dir.isCalm()).toBe(true);
    expect(makeRunSave(sim, dir, info)).not.toBeNull();
    // walk into the next fighting room: the snapshot is refused until it is cleared
    const next = d.rooms[d.mainRoute.find((id) => dir.states[id] === 'unvisited' && d.rooms[id]!.type === 'combat')!]!;
    sim.hero.x = sim.hero.px = next.x0 + 2.5;
    sim.hero.y = sim.hero.py = next.y0 + 2.5;
    sim.step(SIM_DT);
    expect(dir.states[next.id]).toBe('active');
    expect(dir.isCalm()).toBe(false);
    expect(makeRunSave(sim, dir, info)).toBeNull();
  });

  it('is refused while an upgrade choice is open, and for a dead hero', () => {
    const { sim, dir, seed, depth } = playRooms(5, 1, 2);
    const info = { seed, depth, time: 1, heroId: 'warden' as const, skills: ['sunder'] as const };
    sim.queueChoice('level');
    expect(makeRunSave(sim, dir, info)).toBeNull();
    sim.choices.length = 0;
    expect(makeRunSave(sim, dir, info)).not.toBeNull();
    sim.hero.state = 'dead';
    expect(makeRunSave(sim, dir, info)).toBeNull();
  });

  it('survives JSON exactly, stays small on a big floor, and describes itself', () => {
    const { sim, dir, seed, depth } = playRooms(9, 3, 7);
    const rs = makeRunSave(sim, dir, { seed, depth, time: 905, heroId: 'warden', skills: ['sunder', 'charge'] }, 1234)!;
    expect(rs).not.toBeNull();
    expect(parseRunSave(roundTrip(rs))).toEqual(rs);
    const size = JSON.stringify(rs).length;
    expect(size).toBeLessThan(60_000);
    expect(describeRun(rs)).toContain('piętro 3');
    expect(describeRun(rs)).toContain('15:05');
    expect(rs.layout).toBe(LAYOUT_VERSION);
  });
});

describe('what a saved run is checked against', () => {
  const make = () => {
    const { sim, dir, seed, depth, d } = playRooms(5, 2, 4);
    return { rs: makeRunSave(sim, dir, { seed, depth, time: 60, heroId: 'warden', skills: ['sunder', 'charge'] })!, d };
  };

  it('rejects anything that is not a well-formed, current run', () => {
    const { rs } = make();
    const bad = (mut: (x: Record<string, any>) => void) => {
      const x = roundTrip(rs) as unknown as Record<string, any>;
      mut(x);
      return parseRunSave(x);
    };
    expect(parseRunSave(roundTrip(rs))).not.toBeNull();
    expect(parseRunSave(null)).toBeNull();
    expect(parseRunSave('run')).toBeNull();
    expect(bad((x) => (x.layout = LAYOUT_VERSION - 1))).toBeNull();
    expect(bad((x) => (x.v = 99))).toBeNull();
    expect(bad((x) => (x.depth = 9))).toBeNull();
    expect(bad((x) => (x.depth = 0))).toBeNull();
    expect(bad((x) => (x.heroId = 'rogue'))).toBeNull();
    expect(bad((x) => (x.skills = []))).toBeNull();
    expect(bad((x) => (x.skills = ['sunder', 'sunder']))).toBeNull();
    expect(bad((x) => (x.skills = ['volley']))).toBeNull(); // the other class's skill
    expect(bad((x) => (x.skills = ['sunder', 'charge', 'crush', 'pact']))).toBeNull();
    expect(bad((x) => (x.seed = -1))).toBeNull();
    expect(bad((x) => (x.time = Number.NaN))).toBeNull();
    expect(bad((x) => (x.sim.depth = 1))).toBeNull(); // does not match the run's depth
    expect(bad((x) => (x.sim.hero.hp = 0))).toBeNull();
    expect(bad((x) => (x.sim.hero.level = 500))).toBeNull();
    expect(bad((x) => (x.sim.hero.upgrades = { power: 99 }))).toBeNull();
    expect(bad((x) => (x.sim.hero.upgrades = { nonsense: 1 }))).toBeNull();
    expect(bad((x) => (x.sim.hero.skillUpgrades = { 'sunder.wide': 9 }))).toBeNull();
    expect(bad((x) => (x.sim.rng = 'x'))).toBeNull();
    expect(bad((x) => (x.sim.loot = [{ not: 'an item' }]))).toBeNull();
    expect(bad((x) => (x.sim.objects = [{ kind: 'door', x: 1, y: 1, roomId: 0, active: true, used: false, loot: 'treasure' }]))).toBeNull();
    expect(bad((x) => (x.sim.pickups = [{ kind: 'item', x: 1, y: 1, amount: 1 }]))).toBeNull();
    expect(bad((x) => (x.director.states = ['cleared', 'weird']))).toBeNull();
    expect(bad((x) => (x.director.revealedRooms = [-1]))).toBeNull();
    expect(bad((x) => (x.director.currentRoom = 'start'))).toBeNull();
  });

  it('fits only the floor it was made on', () => {
    const { rs, d } = make();
    expect(fitsDungeon(rs, d)).toBe(true);
    expect(fitsDungeon(rs, generateDungeon(floorSeed(rs.seed + 1, rs.depth), rs.depth))).toBe(false);
    const wall = roundTrip(rs);
    wall.sim.hero.x = 0.5;
    wall.sim.hero.y = 0.5;
    expect(fitsDungeon(wall, d)).toBe(false);
    const short = roundTrip(rs);
    short.director.states.pop();
    expect(fitsDungeon(short, d)).toBe(false);
  });

  it('lives in the save: a good run is kept, a damaged one is dropped without touching the rest', () => {
    const { rs } = make();
    const save = defaultSave();
    save.ash = 321;
    save.run = rs;
    const back = parseSave(JSON.parse(JSON.stringify(save)))!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.run).toEqual(rs);
    expect(back).toEqual(save);
    const broken = JSON.parse(JSON.stringify(save)) as Record<string, any>;
    broken.run.sim.hero.hp = -5;
    const kept = parseSave(broken)!;
    expect(kept.run).toBeNull();
    expect(kept.ash).toBe(321);
    // saves from before the run was stored have none
    const old = JSON.parse(JSON.stringify(defaultSave())) as Record<string, any>;
    old.version = 4;
    delete old.run;
    expect(parseSave(old)!.run).toBeNull();
  });
});

describe('picking a run up again', () => {
  it('restores the hero, the floor and what lies on it exactly', () => {
    const { sim, dir, d, seed, depth } = playRooms(21, 2, 6);
    sim.hero.upgrades.power = 2;
    sim.setSkillUpgrades({ 'sunder.wide': 1 });
    sim.recomputeStats();
    sim.hero.hp = Math.min(sim.hero.hp, sim.hero.stats.maxHp - 7);
    sim.hero.skills[0]!.cd = 3.5;
    const rs = roundTrip(makeRunSave(sim, dir, { seed, depth, time: 700, heroId: 'warden', skills: ['sunder', 'charge'] })!);
    const { sim: b, dir: db } = resume(rs, d);
    expect(b.hero.level).toBe(sim.hero.level);
    expect(b.hero.xp).toBe(sim.hero.xp);
    expect(b.hero.x).toBeCloseTo(sim.hero.x, 9);
    expect(b.hero.hp).toBeCloseTo(sim.hero.hp, 9);
    expect(b.hero.upgrades).toEqual(sim.hero.upgrades);
    expect(b.hero.skillUpgrades).toEqual({ 'sunder.wide': 1 });
    expect(b.hero.skills[0]!.cd).toBeCloseTo(3.5, 9);
    expect(b.hero.stats.maxHp).toBe(sim.hero.stats.maxHp);
    expect(b.kills).toBe(sim.kills);
    expect(b.ash).toBe(sim.ash);
    expect(b.time).toBe(sim.time);
    expect(b.depth).toBe(depth);
    expect(b.loot.length).toBe(sim.loot.length);
    expect(db.states).toEqual(dir.states);
    expect(Array.from(db.revealedRooms)).toEqual(Array.from(dir.revealedRooms));
    expect(Array.from(db.revealedCorridors)).toEqual(Array.from(dir.revealedCorridors));
    expect(db.currentRoom).toBe(dir.currentRoom);
    expect(b.objects.map((o) => [o.kind, o.roomId, o.used, o.active])).toEqual(sim.objects.map((o) => [o.kind, o.roomId, o.used, o.active]));
    expect(b.pickups.length).toBe(sim.pickups.length);
    expect(b.traps.map((t) => t.phase)).toEqual(sim.traps.map((t) => t.phase));
    expect(b.rng.getState()).toBe(sim.rng.getState());
    // no door is left shut, no enemy left over
    expect(b.livingEnemyCount()).toBe(0);
    for (const r of d.rooms) for (const dr of r.doors) expect(d.map.tiles[dr.ty * d.map.w + dr.tx]).not.toBe(3);
  });

  it('keeps the items lying on the floor, and cleared and opened things stay that way', () => {
    const { sim, dir, d, seed, depth } = playRooms(33, 1, 5);
    sim.dropItem('boss', sim.hero.x + 2, sim.hero.y);
    sim.dropItem('elite', sim.hero.x - 2, sim.hero.y);
    const before = sim.pickups.filter((p) => p.kind === 'item').map((p) => p.item!.uid);
    expect(before.length).toBeGreaterThanOrEqual(2);
    sim.step(SIM_DT);
    const rs = roundTrip(makeRunSave(sim, dir, { seed, depth, time: 5, heroId: 'warden', skills: ['sunder'] })!);
    const { sim: b } = resume(rs, d);
    expect(b.pickups.filter((p) => p.kind === 'item').map((p) => p.item!.uid).sort()).toEqual(before.sort());
    const opened = sim.objects.filter((o) => o.used).length;
    expect(b.objects.filter((o) => o.used).length).toBe(opened);
  });

  it('carries on exactly as the original would have: same fights, same drops, same end', () => {
    for (const hero of ['warden', 'wanderer'] as const) {
      const seed = hero === 'warden' ? 77 : 78;
      const { sim: a, dir: da, d, depth } = playRooms(seed, 2, 5, hero);
      const rs = roundTrip(makeRunSave(a, da, { seed, depth, time: 400, heroId: hero, skills: hero === 'warden' ? ['sunder', 'charge'] : ['volley', 'seal'] })!);
      const { sim: b, dir: db } = resume(rs, d, hero);
      expect(worldHash(b, db)).toBe(worldHash(a, da));
      // both play the next rooms of the route, the same way
      const play = (sim: Simulation, dir: DungeonDirector) => {
        for (const id of d.mainRoute.slice(6, 10)) {
          const r = d.rooms[id]!;
          sim.hero.x = sim.hero.px = r.x0 + 1.5;
          sim.hero.y = sim.hero.py = r.y0 + 1.5;
          for (let t = 0; t < 120 / SIM_DT; t++) {
            sim.setInput(playerBot(sim));
            sim.step(SIM_DT);
            sim.drainEvents();
            autoChoose(sim);
            if (dir.states[id] === 'cleared' && sim.livingEnemyCount() === 0) break;
          }
        }
        return worldHash(sim, dir);
      };
      const ha = play(a, da);
      const hb = play(b, db);
      expect(hb).toBe(ha);
      expect(a.kills).toBeGreaterThan(rs.sim.kills); // it really did play on
    }
  });

  it('can be resumed on every floor of the expedition', () => {
    for (const depth of [1, 2, 3]) {
      const { sim, dir, d, seed } = playRooms(41, depth, 4);
      expect(whyNotCalm(sim, dir), `depth ${depth}`).toBe('');
      const rs = roundTrip(makeRunSave(sim, dir, { seed, depth, time: 100, heroId: 'warden', skills: ['sunder'] })!);
      expect(fitsDungeon(rs, d)).toBe(true);
      const { sim: b } = resume(rs, d);
      expect(b.depth).toBe(depth);
      expect(b.hero.state).toBe('idle');
      for (let i = 0; i < 120; i++) b.step(SIM_DT);
      expect(b.hero.hp).toBeGreaterThan(0);
    }
  });

  it('knows each skill by name when a run is resumed (the loadout is part of the save)', () => {
    const { sim, dir, d, seed, depth } = playRooms(5, 1, 2);
    const rs = roundTrip(makeRunSave(sim, dir, { seed, depth, time: 1, heroId: 'warden', skills: ['sunder', 'charge', 'crush'] })!);
    const { sim: b } = resume(rs, d);
    expect(b.hero.skills.map((s) => s.def.id)).toEqual(['sunder', 'charge', 'crush']);
    expect(HEROES.warden.skills).toContain('sunder');
    expect(SKILLS.crush.hero).toBe('warden');
  });
});

describe('the log of how long floors take', () => {
  const rec = (depth: number, seconds: number) => ({ hero: 'warden' as const, depth, seconds, roomsVisited: 12, roomsTotal: 22, fights: 9, kills: 120, completed: true, at: 1_700_000_000_000 });

  it('keeps the newest floors, no more than the limit, and survives the save', async () => {
    const { FLOOR_LOG_MAX, logFloor } = await import('../src/meta/save');
    const save = defaultSave();
    for (let i = 0; i < FLOOR_LOG_MAX + 5; i++) logFloor(save, rec(1 + (i % 3), 100 + i));
    expect(save.floorLog.length).toBe(FLOOR_LOG_MAX);
    expect(save.floorLog[save.floorLog.length - 1]!.seconds).toBe(100 + FLOOR_LOG_MAX + 4);
    expect(parseSave(JSON.parse(JSON.stringify(save)))!.floorLog).toEqual(save.floorLog);
  });

  it('drops malformed records without losing the good ones', () => {
    const save = JSON.parse(JSON.stringify(defaultSave())) as Record<string, any>;
    save.floorLog = [rec(1, 600), { ...rec(2, 700), seconds: -4 }, { ...rec(2, 700), hero: 'rogue' }, 'junk', rec(3, 800)];
    const parsed = parseSave(save)!;
    expect(parsed.floorLog.map((f) => f.seconds)).toEqual([600, 800]);
  });

  it('is carried with a saved run, so a resumed floor keeps counting from where it was', () => {
    const { sim, dir, seed, depth } = playRooms(5, 1, 3);
    const rs = makeRunSave(sim, dir, { seed, depth, time: 500, heroId: 'warden', skills: ['sunder'], floor: { seconds: 321, fights: 4, kills0: 17 } })!;
    expect(roundTrip(rs).floor).toEqual({ seconds: 321, fights: 4, kills0: 17 });
    const bad = roundTrip(rs) as unknown as Record<string, any>;
    bad.floor.seconds = -1;
    expect(parseRunSave(bad)).toBeNull();
  });
});
