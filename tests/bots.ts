import type { Simulation } from '../src/sim/simulation';
import type { InputIntent } from '../src/sim/types';

export type Bot = (sim: Simulation) => InputIntent;

export const idleBot: Bot = () => ({ moveX: 0, moveY: 0, dodge: false, skill: false });

/** Reacts like an attentive (not perfect) player: dodges late telegraphs, kites a little, slams packs. */
export const playerBot: Bot = (sim) => {
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
  // melee closes to contact; ranged holds at ~70% of its reach and backs off when crowded
  const ranged = h.stats.attackRange > 3;
  const go = ranged ? (l > h.stats.attackRange * 0.75 ? 1 : l < 2.6 ? -1 : 0) : l > 1.1 ? 1 : 0;
  return { moveX: (dx / l) * go, moveY: (dy / l) * go, dodge: false, skill: false };
};
