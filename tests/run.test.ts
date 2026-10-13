import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import { NO_RANKS, RUN } from '../src/config/progression';
import { DungeonDirector } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';
import type { InputIntent } from '../src/sim/types';
import { generateDungeon } from '../src/world/dungeon';
import { autoChoose } from './helpers';
import { idleBot, playerBot } from './bots';

/**
 * Whole-expedition balance check: the bot visits every room of every floor in
 * graph order (teleporting between rooms instead of walking corridors), fights
 * each encounter, uses shrines and chests, and descends. Not a unit test — a
 * guard that the run is neither trivial when idle nor impossible when played.
 */
function expedition(hero: HeroId, seed: number, bot: (s: Simulation) => InputIntent) {
  const skill = hero === 'warden' ? 'sunder' : 'volley';
  let d = generateDungeon(seed, 1);
  const sim = new Simulation(d.map, { seed, build: { heroId: hero, skillId: skill, ranks: { ...NO_RANKS } } });
  let floorsCleared = 0;
  let prev = { dodge: false, skill: false };
  const step = () => {
    const i = bot(sim);
    sim.setInput({ ...i, dodge: i.dodge && !prev.dodge, skill: i.skill && !prev.skill });
    prev = { dodge: i.dodge, skill: i.skill };
    sim.step(SIM_DT);
    sim.drainEvents();
    autoChoose(sim);
  };
  for (let depth = 1; depth <= RUN.floors; depth++) {
    if (depth > 1) {
      d = generateDungeon(seed + depth * 7349, depth);
      sim.loadMap(d.map);
    }
    const dir = new DungeonDirector(sim, d);
    sim.director = dir;
    const order = [...d.rooms].sort((a, b) => a.depth - b.depth).filter((r) => r.type !== 'start');
    for (const r of order) {
      sim.hero.x = sim.hero.px = r.x0 + 1.5;
      sim.hero.y = sim.hero.py = r.y0 + 1.5;
      for (let t = 0; t < 120 / SIM_DT; t++) {
        step();
        if (sim.hero.state === 'dead') return { floorsCleared, depth, level: sim.hero.level, kills: sim.kills };
        if (dir.states[r.id] === 'cleared' && sim.livingEnemyCount() === 0) break;
      }
      // touch the room's object (chest / shrine), if any
      const obj = sim.objects.find((o) => o.roomId === r.id && !o.used && o.active && o.kind !== 'stairs');
      if (obj) {
        sim.hero.x = obj.x;
        sim.hero.y = obj.y;
        step();
      }
    }
    floorsCleared++;
  }
  return { floorsCleared, depth: RUN.floors, level: sim.hero.level, kills: sim.kills };
}

for (const hero of ['warden', 'wanderer'] as const) {
  describe(`expedition balance: ${hero}`, () => {
    const seeds = [11, 22, 33, 44, 55, 66];
    const idle = seeds.map((s) => expedition(hero, s, idleBot));
    const active = seeds.map((s) => expedition(hero, s, playerBot));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    it('an idle hero rarely gets past the first floor and never finishes', () => {
      expect(avg(idle.map((r) => r.floorsCleared))).toBeLessThan(0.5);
      for (const r of idle) expect(r.floorsCleared).toBeLessThanOrEqual(1);
    });

    it('an engaged player clears floors; the full run is reachable but not guaranteed', () => {
      expect(avg(active.map((r) => r.floorsCleared))).toBeGreaterThanOrEqual(1);
      expect(avg(active.map((r) => r.floorsCleared))).toBeGreaterThan(avg(idle.map((r) => r.floorsCleared)) + 0.6);
      expect(avg(active.map((r) => r.floorsCleared))).toBeLessThanOrEqual(3);
    });

    it('report', () => {
      console.log(hero, 'idle  ', JSON.stringify(idle));
      console.log(hero, 'active', JSON.stringify(active));
    });
  });
}
