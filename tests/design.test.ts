import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import { WaveHarness, autoChoose, sandbox } from './helpers';
import { idleBot, playerBot, type Bot } from './bots';
import { ANTECHAMBER_LAYOUT, parseArena } from '../src/world/arena';

/**
 * Design guard-rails, not unit tests: the core promise is "auto-attack is not
 * auto-play". A hero that stands still must do clearly worse than one that
 * moves, dodges telegraphs and uses the skill.
 */
function survive(bot: Bot, seed: number, hero: HeroId, limit = 150): { seconds: number; wave: number; kills: number; level: number } {
  const sim = sandbox(parseArena(ANTECHAMBER_LAYOUT), { seed, hero, armor: true });
  const waves = new WaveHarness(sim);
  sim.director = waves;
  const steps = Math.round(limit / SIM_DT);
  let prev = { dodge: false, skill: false };
  const result = () => ({ seconds: Math.round(sim.time), wave: waves.wave, kills: sim.kills, level: sim.hero.level });
  for (let i = 0; i < steps; i++) {
    const intent = bot(sim);
    // a bot "holding" a button only counts as one press, like a real tap
    sim.setInput({ ...intent, dodge: intent.dodge && !prev.dodge, skill: intent.skill && !prev.skill });
    prev = { dodge: intent.dodge, skill: intent.skill };
    sim.step(SIM_DT);
    sim.drainEvents();
    autoChoose(sim);
    if (sim.hero.state === 'dead') return result();
  }
  return result();
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

for (const hero of ['warden', 'wanderer'] as const) {
  describe(`combat design guard-rails: ${hero}`, () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const idle = seeds.map((s) => survive(idleBot, s, hero));
    const active = seeds.map((s) => survive(playerBot, s, hero));

    it('standing still is not a strategy: an idle hero falls within the first few waves', () => {
      expect(avg(idle.map((r) => r.seconds))).toBeLessThan(110);
      for (const r of idle) expect(r.wave).toBeLessThanOrEqual(5);
    });

    it('moving, dodging and using the skill survives clearly longer and reaches later waves', () => {
      expect(avg(active.map((r) => r.seconds))).toBeGreaterThan(avg(idle.map((r) => r.seconds)) * 1.4);
      expect(avg(active.map((r) => r.wave))).toBeGreaterThan(avg(idle.map((r) => r.wave)));
    });

    it('report', () => {
      console.log(hero, 'idle  ', JSON.stringify(idle));
      console.log(hero, 'active', JSON.stringify(active));
    });
  });
}
