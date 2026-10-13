import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/balance';
import { Simulation } from '../src/sim/simulation';
import type { InputIntent } from '../src/sim/types';
import { ANTECHAMBER_LAYOUT, parseArena } from '../src/world/arena';

/**
 * Design guard-rails, not unit tests: the core promise is "auto-attack is not
 * auto-play". A hero that stands still must do clearly worse than one that
 * moves, dodges telegraphs and uses the skill.
 */
type Bot = (sim: Simulation) => InputIntent;

const idleBot: Bot = () => ({ moveX: 0, moveY: 0, dodge: false, skill: false });

/** Reacts like an attentive (not perfect) player: dodges late telegraphs, kites a little, slams packs. */
const playerBot: Bot = (sim) => {
  const h = sim.hero;
  let threat: { x: number; y: number } | null = null;
  let near = 0;
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const e of sim.enemies) {
    if (e.state === 'dead' || e.state === 'spawning') continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    cx += e.x;
    cy += e.y;
    count++;
    if (d < 2.4) near++;
    if (e.state === 'windup' && d < 2.8 && e.stateT < 0.32) threat = e;
  }
  if (threat) {
    // roll perpendicular-ish away from the attacker
    const ax = h.x - threat.x;
    const ay = h.y - threat.y;
    const l = Math.hypot(ax, ay) || 1;
    return { moveX: (ax / l) * 0.8 - (ay / l) * 0.6, moveY: (ay / l) * 0.8 + (ax / l) * 0.6, dodge: true, skill: false };
  }
  if (near >= 3) return { moveX: 0, moveY: 0, dodge: false, skill: true };
  if (count === 0) return { moveX: 0, moveY: 0, dodge: false, skill: false };
  cx /= count;
  cy /= count;
  if (near >= 2) {
    // crowded: back away from the pack centre
    const dx = h.x - cx;
    const dy = h.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { moveX: dx / l, moveY: dy / l, dodge: false, skill: false };
  }
  // otherwise close in on the nearest enemy — especially one recovering from a swing
  let best = null as null | { x: number; y: number; d: number };
  for (const e of sim.enemies) {
    if (e.state === 'dead' || e.state === 'spawning') continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y) - (e.state === 'recover' ? 3 : 0);
    if (!best || d < best.d) best = { x: e.x, y: e.y, d };
  }
  if (!best) return { moveX: 0, moveY: 0, dodge: false, skill: false };
  const dx = best.x - h.x;
  const dy = best.y - h.y;
  const l = Math.hypot(dx, dy) || 1;
  const go = l > 1.1 ? 1 : 0;
  return { moveX: (dx / l) * go, moveY: (dy / l) * go, dodge: false, skill: false };
};

function survive(bot: Bot, seed: number, limit = 150): { seconds: number; wave: number; kills: number } {
  const sim = new Simulation(parseArena(ANTECHAMBER_LAYOUT), { seed, waves: true });
  const steps = Math.round(limit / SIM_DT);
  let prev = { dodge: false, skill: false };
  for (let i = 0; i < steps; i++) {
    const intent = bot(sim);
    // a bot "holding" a button only counts as one press, like a real tap
    sim.setInput({ ...intent, dodge: intent.dodge && !prev.dodge, skill: intent.skill && !prev.skill });
    prev = { dodge: intent.dodge, skill: intent.skill };
    sim.step(SIM_DT);
    sim.drainEvents();
    if (sim.hero.state === 'dead') return { seconds: i * SIM_DT, wave: sim.wave, kills: sim.kills };
  }
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PROBE) {
    const r = (v: number) => Math.round(v * 100) / 100;
    console.log('STALL seed', seed, 'hero', r(sim.hero.x), r(sim.hero.y), sim.hero.hp, sim.hero.state, 'target', sim.hero.targetId);
    for (const e of sim.enemies) console.log('  ', e.id, e.kind, e.state, r(e.x), r(e.y), e.hp, 'cd', r(e.attackCd));
  }
  return { seconds: limit, wave: sim.wave, kills: sim.kills };
}

describe('combat design guard-rails', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const idle = seeds.map((s) => survive(idleBot, s));
  const active = seeds.map((s) => survive(playerBot, s));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('standing still is not a strategy: an idle hero falls within the first few waves', () => {
    expect(avg(idle.map((r) => r.seconds))).toBeLessThan(110);
    for (const r of idle) expect(r.wave).toBeLessThanOrEqual(5);
  });

  it('moving, dodging and using the skill survives clearly longer and reaches later waves', () => {
    expect(avg(active.map((r) => r.seconds))).toBeGreaterThan(avg(idle.map((r) => r.seconds)) * 1.4);
    expect(avg(active.map((r) => r.wave))).toBeGreaterThan(avg(idle.map((r) => r.wave)));
  });

  it('report', () => {
    console.log('idle  ', idle);
    console.log('active', active);
  });
});
