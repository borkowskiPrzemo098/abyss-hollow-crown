import { TRAPS } from '../src/config/biomes';
import type { Simulation } from '../src/sim/simulation';
import { isWalkable } from '../src/world/arena';
import type { InputIntent } from '../src/sim/types';

export type Bot = (sim: Simulation) => InputIntent;

/** Turns a desired direction aside when a wall is right there (no backing into corners). */
function steer(sim: Simulation, x: number, y: number): { moveX: number; moveY: number } {
  const h = sim.hero;
  const l = Math.hypot(x, y) || 1;
  const base = Math.atan2(y / l, x / l);
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
    const a = base + turn;
    if (isWalkable(sim.map, Math.floor(h.x + Math.cos(a) * 1.3), Math.floor(h.y + Math.sin(a) * 1.3))) return { moveX: Math.cos(a), moveY: Math.sin(a) };
  }
  return { moveX: x / l, moveY: y / l };
}

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
    if (e.state !== 'windup' || e.stateT > 0.32) continue;
    const S = e.atk.shape;
    const reach = S.kind === 'cone' ? S.radius + 0.7 : S.kind === 'circle' ? S.offset + S.radius + 0.7 : 0;
    if (reach > 0 && d < reach) threat = e;
    if (S.kind === 'charge') {
      // standing in the charge lane?
      const ax = Math.cos(e.aim);
      const ay = Math.sin(e.aim);
      const along = (h.x - e.x) * ax + (h.y - e.y) * ay;
      const side = Math.abs((h.x - e.x) * ay - (h.y - e.y) * ax);
      if (along > -0.5 && along < S.distance + 0.5 && side < S.width + 0.8) threat = e;
    }
  }
  // an enemy ember about to land
  for (const p of sim.projectiles) {
    if (p.team !== 'enemy') continue;
    const dx = h.x - p.x;
    const dy = h.y - p.y;
    const closing = (dx * p.vx + dy * p.vy) / (Math.hypot(p.vx, p.vy) || 1);
    if (closing > 0 && Math.hypot(dx, dy) < 1.4) threat = { x: p.x - p.vy, y: p.y + p.vx };
  }
  // standing on a trap that is warming up (or lava): step off it toward the room
  for (const t of sim.traps) {
    if (Math.floor(h.x) !== t.tx || Math.floor(h.y) !== t.ty) continue;
    const T = t.kind === 'spikes' ? TRAPS.spikes : t.kind === 'vent' ? TRAPS.vent : null;
    const local = T ? (sim.time + t.phase) % T.period : 0;
    if (t.kind === 'lava' || (T && local > T.warn - 0.3)) {
      const ox = h.x - (t.tx + 0.5) || 0.3;
      const oy = h.y - (t.ty + 0.5) || 0.3;
      const l = Math.hypot(ox, oy);
      return { moveX: ox / l, moveY: oy / l, dodge: false, skill: false };
    }
  }
  // a blast circle under our feet: walk out early, roll if it is about to go off
  for (const z of sim.hazards) {
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d > z.r + 0.6) continue;
    const l = d || 1;
    const out = steer(sim, d === 0 ? 1 : (h.x - z.x) / l, d === 0 ? 0 : (h.y - z.y) / l);
    return { ...out, dodge: z.delay - z.t < 0.35 && h.dodgeCd <= 0, skill: false };
  }
  if (threat) {
    // roll perpendicular-ish away from the attacker
    const ax = h.x - threat.x;
    const ay = h.y - threat.y;
    const l = Math.hypot(ax, ay) || 1;
    return { ...steer(sim, (ax / l) * 0.8 - (ay / l) * 0.6, (ay / l) * 0.8 + (ax / l) * 0.6), dodge: true, skill: false };
  }
  if (near >= 3) return { moveX: 0, moveY: 0, dodge: false, skill: true };
  if (count === 0) return { moveX: 0, moveY: 0, dodge: false, skill: false };
  cx /= count;
  cy /= count;
  if (near >= (h.stats.attackRange > 3 ? 2 : 3)) {
    // crowded: back away from the pack centre
    const dx = h.x - cx;
    const dy = h.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { ...steer(sim, dx / l, dy / l), dodge: false, skill: false };
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
  // melee closes to contact; ranged holds at ~75% of its reach, outside melee reach of the target
  const ranged = h.stats.attackRange > 3;
  const tgt = sim.enemies.find((e) => Math.abs(e.x - best!.x) < 1e-9 && Math.abs(e.y - best!.y) < 1e-9);
  const S = tgt?.atk.shape;
  const danger = S?.kind === 'cone' ? S.radius + 0.8 : S?.kind === 'circle' ? S.offset + S.radius + 0.8 : 2.6;
  const hold = Math.min(h.stats.attackRange * 0.9, Math.max(h.stats.attackRange * 0.75, danger));
  const go = ranged ? (l > hold + 0.4 ? 1 : l < danger ? -1 : 0) : l > 1.1 ? 1 : 0;
  if (go === 0) return { moveX: 0, moveY: 0, dodge: false, skill: false };
  return { ...steer(sim, (dx / l) * go, (dy / l) * go), dodge: false, skill: false };
};
