import { SIM_DT, type EnemyKind } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import { NO_RANKS } from '../src/config/progression';
import type { SkillId } from '../src/config/skills';
import { dist } from '../src/core/math';
import { Simulation, type Director } from '../src/sim/simulation';
import type { HeroBuild, InputIntent, SimEvent } from '../src/sim/types';
import { parseArena, type ArenaMap } from '../src/world/arena';

/** Open 16x16 room with a hero start in the middle and spawn points in the corners. */
export function openRoom(extraRows?: Record<number, string>) {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    if (y === 0 || y === 15) rows.push('#'.repeat(16));
    else rows.push('#' + '.'.repeat(14) + '#');
  }
  if (extraRows) for (const [k, v] of Object.entries(extraRows)) rows[Number(k)] = v;
  rows[2] = rows[2]!.slice(0, 2) + 'S' + rows[2]!.slice(3);
  rows[8] = rows[8]!.slice(0, 8) + 'H' + rows[8]!.slice(9);
  return parseArena(rows);
}

export function build(heroId: HeroId = 'warden', skillId?: SkillId): HeroBuild {
  return { heroId, skillId: skillId ?? (heroId === 'warden' ? 'sunder' : 'volley'), ranks: { ...NO_RANKS } };
}

/** A sandbox simulation; armour is zeroed by default so damage numbers are exact. */
export function sandbox(map: ArenaMap = openRoom(), opts: { seed?: number; hero?: HeroId; skill?: SkillId; armor?: boolean } = {}): Simulation {
  const sim = new Simulation(map, { seed: opts.seed ?? 1, build: build(opts.hero, opts.skill) });
  if (!opts.armor) sim.hero.stats.armor = 0;
  return sim;
}

export const idle: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };

/** Runs the sim for `seconds` with a constant intent; presses are only sent on the first step. */
export function run(sim: Simulation, seconds: number, intent: Partial<InputIntent> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    sim.setInput({ ...idle, ...intent, dodge: i === 0 && !!intent.dodge, skill: i === 0 && !!intent.skill });
    sim.step(SIM_DT);
    events.push(...sim.drainEvents());
    autoChoose(sim);
  }
  return events;
}

/** Picks the first offered upgrade whenever a choice is pending (so tests never stall). */
export function autoChoose(sim: Simulation): void {
  while (sim.choices.length > 0) sim.applyChoice(sim.choices[0]!.options[0]!);
}

export function withWaves(sim: Simulation): Simulation {
  sim.director = new WaveHarness(sim);
  return sim;
}

/**
 * Endless escalating waves in a single arena — a test harness for combat-feel
 * bots (the game itself runs dungeon floors through DungeonDirector).
 */
export class WaveHarness implements Director {
  wave = 0;
  private breakT = 1;

  constructor(private readonly sim: Simulation) {}

  update(dt: number): void {
    if (this.sim.hero.state === 'dead' || this.sim.livingEnemyCount() > 0) return;
    this.breakT -= dt;
    if (this.breakT > 0) return;
    this.wave++;
    this.breakT = 2.5;
    const kinds = waveComposition(this.wave);
    const h = this.sim.hero;
    const far = this.sim.map.spawns.filter((s) => dist(s.x, s.y, h.x, h.y) >= 4.5);
    const pool = far.length > 0 ? far : this.sim.map.spawns;
    const hpScale = 1 + Math.max(0, this.wave - 3) * 0.08;
    kinds.forEach((k, i) => {
      const s = this.sim.rng.pick(pool);
      this.sim.spawnEnemy(k, s.x + this.sim.rng.range(-0.4, 0.4), s.y + this.sim.rng.range(-0.4, 0.4), { hpScale, delay: i * 0.15 });
    });
  }
}

function waveComposition(wave: number): EnemyKind[] {
  const table: EnemyKind[][] = [
    ['thrall', 'thrall', 'thrall'],
    ['thrall', 'thrall', 'thrall', 'acolyte', 'thrall'],
    ['brute', 'thrall', 'thrall', 'thrall'],
    ['brute', 'thrall', 'acolyte', 'thrall', 'thrall', 'thrall'],
    ['brute', 'brute', 'thrall', 'acolyte', 'thrall', 'thrall'],
  ];
  const fixed = table[wave - 1];
  if (fixed) return [...fixed];
  const brutes = Math.min(4, 2 + Math.floor((wave - 5) / 2));
  const thralls = Math.min(12, 5 + (wave - 5));
  return [...Array<EnemyKind>(brutes).fill('brute'), ...Array<EnemyKind>(thralls).fill('thrall'), 'acolyte'];
}
