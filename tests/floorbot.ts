import { SIM_DT } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import { NO_RANKS } from '../src/config/progression';
import { Rng } from '../src/core/rng';
import { DungeonDirector } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';
import type { InputIntent, SimEvent } from '../src/sim/types';
import { isWalkable } from '../src/world/arena';
import { FlowField } from '../src/world/flowField';
import { generateDungeon, type Dungeon } from '../src/world/dungeon';
import { autoChoose } from './helpers';
import { playerBot } from './bots';

/**
 * A bot that really walks a floor (no teleporting between rooms): it follows the main route to the
 * exit, fights what it meets with the same tactics as `playerBot`, picks up chests and shrines, and
 * detours into a share of the optional rooms. It measures the floor — time, fights, kills, rooms —
 * which is what the length of a floor is judged by. It is a bot, not a person: it never hesitates,
 * never explores a dead end by accident and fights with perfect patience.
 */
export interface FloorMetrics {
  depth: number;
  completed: boolean;
  died: boolean;
  timedOut: boolean;
  /** Simulated seconds from entering the floor to leaving it (or dying). */
  seconds: number;
  fightSeconds: number;
  walkSeconds: number;
  roomsTotal: number;
  roomsVisited: number;
  mainTotal: number;
  mainVisited: number;
  optionalTotal: number;
  optionalVisited: number;
  /** Fights fought: rooms cleared that had enemies, boss included. */
  fights: number;
  kills: number;
  levelsGained: number;
  levelAtEnd: number;
  stuck: number;
}

export interface ExpeditionMetrics {
  hero: HeroId;
  seed: number;
  floors: FloorMetrics[];
}

interface Options {
  hero: HeroId;
  seed: number;
  floors?: number;
  /** Share of the optional rooms the bot detours into (0..1). */
  optionalShare?: number;
  /** Give up on a floor after this many simulated seconds. */
  maxFloorSeconds?: number;
}

/** The route from start to exit: the dungeon's own main route, or the shortest path in the room graph. */
export function mainRouteOf(d: Dungeon): number[] {
  const given = (d as { mainRoute?: number[] }).mainRoute;
  if (given && given.length > 1) return given;
  const prev = new Map<number, number>([[d.startRoom, -1]]);
  const q = [d.startRoom];
  while (q.length) {
    const id = q.shift()!;
    for (const n of d.rooms[id]!.links) if (!prev.has(n)) (prev.set(n, id), q.push(n));
  }
  const out: number[] = [];
  for (let at = d.exitRoom; at !== -1; at = prev.get(at) ?? -1) out.push(at);
  return out.reverse();
}

/** Rooms hanging off `from` that are not on the main route (the optional side branch), nearest first. */
function branchRooms(d: Dungeon, from: number, main: Set<number>): number[] {
  const seen = new Set<number>([from]);
  const out: number[] = [];
  const q = [from];
  while (q.length) {
    const id = q.shift()!;
    for (const n of d.rooms[id]!.links) {
      if (seen.has(n) || main.has(n)) continue;
      seen.add(n);
      out.push(n);
      q.push(n);
    }
  }
  return out;
}

export function runExpedition(o: Options): ExpeditionMetrics {
  const floors = o.floors ?? 3;
  const skill = o.hero === 'warden' ? 'sunder' : 'volley';
  let d = generateDungeon(o.seed, 1);
  const sim = new Simulation(d.map, { seed: o.seed, build: { heroId: o.hero, skills: [skill], ranks: { ...NO_RANKS }, gear: [] } });
  const pick = new Rng(o.seed ^ 0xabcdef);
  const out: FloorMetrics[] = [];

  for (let depth = 1; depth <= floors; depth++) {
    if (depth > 1) {
      d = generateDungeon((o.seed + depth * 7349) >>> 0, depth);
      sim.loadMap(d.map);
    }
    const dir = new DungeonDirector(sim, d);
    sim.director = dir;
    const m = playFloor(sim, d, dir, depth, o, pick);
    out.push(m);
    if (!m.completed) break;
  }
  return { hero: o.hero, seed: o.seed, floors: out };
}

function playFloor(sim: Simulation, d: Dungeon, dir: DungeonDirector, depth: number, o: Options, pick: Rng): FloorMetrics {
  const maxSteps = Math.round((o.maxFloorSeconds ?? 2400) / SIM_DT);
  const main = mainRouteOf(d);
  const mainSet = new Set(main);
  const optional = d.rooms.filter((r) => !mainSet.has(r.id));
  const share = o.optionalShare ?? 0.6;

  // the order of goals: along the route, with detours into the branches that were chosen
  const goals: { room: number }[] = [];
  for (const id of main) {
    if (id !== d.startRoom) goals.push({ room: id });
    const side = branchRooms(d, id, mainSet);
    // a branch is visited all the way to its end or not at all; the choice is made per branch root
    const roots = side.filter((n) => d.rooms[n]!.links.some((l) => l === id || mainSet.has(l)));
    for (const root of roots) {
      if (!pick.chance(share)) continue;
      const branch = [root, ...branchRooms(d, root, new Set([...mainSet, id]))];
      for (const b of branch) goals.push({ room: b });
      // back to the route
      goals.push({ room: id });
    }
  }
  // the boss is last on the route; the stairs come after it
  const flow = new FlowField(d.map);
  const events: SimEvent[] = [];
  const m: FloorMetrics = {
    depth,
    completed: false,
    died: false,
    timedOut: false,
    seconds: 0,
    fightSeconds: 0,
    walkSeconds: 0,
    roomsTotal: d.rooms.length - 1,
    roomsVisited: 0,
    mainTotal: main.length - 1,
    mainVisited: 0,
    optionalTotal: optional.length,
    optionalVisited: 0,
    fights: 0,
    kills: 0,
    levelsGained: 0,
    levelAtEnd: sim.hero.level,
    stuck: 0,
  };
  const killsStart = sim.kills;
  const levelStart = sim.hero.level;
  let prevIntent = { dodge: false, skill: false };
  let goalIdx = 0;
  let target: { x: number; y: number } | null = null;
  let lastPos = { x: sim.hero.x, y: sim.hero.y };
  let lastProgress = 0;
  let stairsPhase = false;
  /** Where to go once an object that needs the hero to step off and on again has been left. */
  let comeBack: { x: number; y: number } | null = null;
  let waited = 0;

  /** The walkable tile nearest to a point (a room's centre may be a pillar). */
  const walkableTile = (x: number, y: number): [number, number] => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    for (let r = 0; r < 8; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && isWalkable(d.map, tx + dx, ty + dy)) return [tx + dx, ty + dy];
    return [tx, ty];
  };

  const aim = (x: number, y: number): InputIntent => {
    const h = sim.hero;
    const [gx, gy] = walkableTile(x, y);
    flow.setGoal(gx, gy);
    const wp = flow.nextWaypoint(Math.floor(h.x), Math.floor(h.y));
    const tx = wp ? wp.x : x;
    const ty = wp ? wp.y : y;
    const dx = tx - h.x;
    const dy = ty - h.y;
    const l = Math.hypot(dx, dy) || 1;
    return { moveX: dx / l, moveY: dy / l, dodge: false, skill: false };
  };

  for (let step = 0; step < maxSteps; step++) {
    const h = sim.hero;
    if (h.state === 'dead') {
      m.died = true;
      break;
    }
    const enemies = sim.livingEnemyCount() > 0;
    let intent: InputIntent;
    if (enemies) {
      intent = playerBot(sim);
      m.fightSeconds += SIM_DT;
      // fighting is not being stuck
      lastPos = { x: h.x, y: h.y };
      lastProgress = step;
    } else {
      // pick the next place to go
      if (!target) {
        if (!stairsPhase && goalIdx < goals.length) {
          const g = goals[goalIdx]!;
          const r = d.rooms[g.room]!;
          // chests and shrines of a room that is already cleared come first
          const obj = sim.objects.find((q) => q.roomId === r.id && !q.used && q.active && q.kind !== 'stairs' && dir.states[r.id] === 'cleared');
          const [rx, ry] = walkableTile(r.cx, r.cy);
          target = obj ? { x: obj.x, y: obj.y } : { x: rx + 0.5, y: ry + 0.5 };
          if (!obj && dir.states[r.id] === 'cleared') {
            goalIdx++;
            target = null;
            continue;
          }
        } else {
          const exit = d.rooms[d.exitRoom]!;
          const [ex, ey] = walkableTile(exit.cx, exit.cy);
          const stairs = sim.objects.find((q) => q.kind === 'stairs');
          if (stairs?.active) {
            stairsPhase = true;
            target = { x: stairs.x, y: stairs.y };
          } else if (dir.states[exit.id] !== 'cleared') target = { x: ex + 0.5, y: ey + 0.5 };
          else if (stairs) target = { x: stairs.x, y: stairs.y };
        }
      }
      if (target) {
        const arrived: boolean = Math.hypot(h.x - target.x, h.y - target.y) < 0.5;
        const gi = goals[goalIdx];
        const stop: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };
        const here: (typeof sim.objects)[number] | undefined = arrived ? sim.objects.find((q) => !q.used && q.active && Math.hypot(q.x - target!.x, q.y - target!.y) < 0.6) : undefined;
        if (arrived && comeBack) {
          // stepped away from an object that was armed under the hero's feet: now go back onto it
          target = comeBack;
          comeBack = null;
          waited = 0;
          intent = stop;
        } else if (here && here.kind === 'altar' && sim.hero.hp <= sim.hero.stats.maxHp * 0.25 + 1) {
          // too hurt for the altar: it will not take the offering, so a sensible player walks on
          target = null;
          waited = 0;
          if (gi) goalIdx++;
          intent = stop;
        } else if (here && ++waited > 30) {
          // the object ignores a hero who was already standing on it: step off, then come back
          const [ax, ay] = walkableTile(here.x + 2.6, here.y);
          comeBack = { x: here.x, y: here.y };
          target = { x: ax + 0.5, y: ay + 0.5 };
          waited = 0;
          intent = stop;
        } else if (here) {
          intent = stop;
        } else if (arrived) {
          target = null;
          // objects are used by standing on them; once done, move on to the next goal
          if (!stairsPhase && gi && !sim.objects.some((q) => q.roomId === gi.room && !q.used && q.active && q.kind !== 'stairs' && dir.states[gi.room] === 'cleared')) goalIdx++;
          intent = { moveX: 0, moveY: 0, dodge: false, skill: false };
        } else {
          if (step % 45 === 0) flow.invalidate();
          intent = aim(target.x, target.y);
        }
        m.walkSeconds += SIM_DT;
        // stuck: no progress for 20 s of walking
        const moved = Math.hypot(h.x - lastPos.x, h.y - lastPos.y);
        if (moved > 2) {
          lastPos = { x: h.x, y: h.y };
          lastProgress = step;
        } else if (step - lastProgress > 20 / SIM_DT && !dir.activeRoom) {
          m.stuck++;
          lastProgress = step;
          // unstick: step toward the target by hand
          if (target) {
            h.x = h.px = target.x;
            h.y = h.py = target.y;
          }
        }
      } else {
        intent = { moveX: 0, moveY: 0, dodge: false, skill: false };
        m.walkSeconds += SIM_DT;
      }
    }
    sim.setInput({ ...intent, dodge: intent.dodge && !prevIntent.dodge, skill: intent.skill && !prevIntent.skill });
    prevIntent = { dodge: intent.dodge, skill: intent.skill };
    sim.step(SIM_DT);
    for (const e of sim.drainEvents()) {
      events.push(e);
      if (e.type === 'roomClear' && e.roomType !== 'treasure' && e.roomType !== 'shrine' && e.roomType !== 'start') m.fights++;
    }
    autoChoose(sim);
    m.seconds += SIM_DT;
    if (events.some((e) => e.type === 'floorExit')) {
      m.completed = true;
      break;
    }
    if (step === maxSteps - 1) m.timedOut = true;
  }
  if (sim.hero.state === 'dead') m.died = true;
  m.kills = sim.kills - killsStart;
  m.levelAtEnd = sim.hero.level;
  m.levelsGained = sim.hero.level - levelStart;
  m.roomsVisited = d.rooms.filter((r) => r.type !== 'start' && dir.states[r.id] !== 'unvisited').length;
  m.mainVisited = main.filter((id) => id !== d.startRoom && dir.states[id] !== 'unvisited').length;
  m.optionalVisited = optional.filter((r) => dir.states[r.id] !== 'unvisited').length;
  return m;
}

/** Mean of a number list. */
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
