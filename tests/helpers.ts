import { SIM_DT } from '../src/config/balance';
import type { Simulation } from '../src/sim/simulation';
import type { InputIntent, SimEvent } from '../src/sim/types';
import { parseArena } from '../src/world/arena';

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

export const idle: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };

/** Runs the sim for `seconds` with a constant intent; presses are only sent on the first step. */
export function run(sim: Simulation, seconds: number, intent: Partial<InputIntent> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    sim.setInput({ ...idle, ...intent, dodge: i === 0 && !!intent.dodge, skill: i === 0 && !!intent.skill });
    sim.step(SIM_DT);
    events.push(...sim.drainEvents());
  }
  return events;
}
