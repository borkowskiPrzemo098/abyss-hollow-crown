import { HEROES, type HeroId } from '../config/heroes';
import { isSkillUpgradeId, SKILL_UPGRADES } from '../config/skillUpgrades';
import { RUN } from '../config/progression';
import { SKILLS, SKILL_RULES, type SkillId } from '../config/skills';
import { UPGRADES } from '../config/upgrades';
import type { DungeonDirector, DirectorSnapshot, RoomState } from '../sim/director';
import { isItem } from '../sim/loot';
import type { Simulation, SimSnapshot } from '../sim/simulation';
import { isWalkable } from '../world/arena';
import type { Dungeon } from '../world/dungeon';

/**
 * A long run can be put down and picked up again. A floor is rebuilt from its seed, so only what the
 * player did to it is stored: the hero, the counters, which rooms are cleared and seen, which chests are
 * opened, and what lies on the floor. It is taken at calm moments only (nothing mid-fight), so a resumed run
 * goes back to the last quiet point — never to the middle of a fight.
 */
export const RUN_SAVE_VERSION = 1;

/** Bump whenever the dungeon generator changes: a saved run only fits the layout it was made on. */
export const LAYOUT_VERSION = 2;

/** What one floor of one run came to: the real-play measurement of how long a floor takes. */
export interface FloorRecord {
  hero: HeroId;
  depth: number;
  /** Seconds the player spent on the floor (paused time is not counted). */
  seconds: number;
  roomsVisited: number;
  roomsTotal: number;
  /** Fights won (rooms with enemies, boss included). */
  fights: number;
  kills: number;
  /** Left by the stairs, as opposed to dying or giving up on it. */
  completed: boolean;
  at: number;
}

/** The floor's running totals, kept with the run so a resumed floor goes on counting. */
export interface FloorProgress {
  seconds: number;
  fights: number;
  kills0: number;
}

export function parseFloorRecord(r: unknown): FloorRecord | null {
  if (!isObj(r)) return null;
  if (typeof r.hero !== 'string' || !(r.hero in HEROES) || !int(r.depth, 1, RUN.floors) || !num(r.seconds, 0, 1e7)) return null;
  if (!int(r.roomsVisited, 0, MAX_LIST) || !int(r.roomsTotal, 0, MAX_LIST) || !int(r.fights, 0, MAX_LIST) || !int(r.kills, 0, 1e7) || typeof r.completed !== 'boolean' || !num(r.at, 0, 1e15)) return null;
  return r as unknown as FloorRecord;
}

export interface RunSave {
  floor: FloorProgress;
  v: number;
  layout: number;
  savedAt: number;
  seed: number;
  depth: number;
  /** Seconds played in this run so far. */
  time: number;
  heroId: HeroId;
  skills: SkillId[];
  sim: SimSnapshot;
  director: DirectorSnapshot;
}

/** Seed of a floor: the first uses the run's seed, deeper ones are derived from it. */
export function floorSeed(seed: number, depth: number): number {
  return depth === 1 ? seed >>> 0 : (seed + depth * 7349) >>> 0;
}

/** Takes a snapshot of the run, or null when this is not a calm moment. */
export function makeRunSave(
  sim: Simulation,
  dir: DungeonDirector,
  info: { seed: number; depth: number; time: number; heroId: HeroId; skills: readonly SkillId[]; floor?: FloorProgress },
  now: number = Date.now(),
): RunSave | null {
  if (!dir.isCalm()) return null;
  return {
    v: RUN_SAVE_VERSION,
    layout: LAYOUT_VERSION,
    savedAt: now,
    seed: info.seed >>> 0,
    depth: info.depth,
    time: info.time,
    heroId: info.heroId,
    skills: [...info.skills],
    floor: info.floor ?? { seconds: 0, fights: 0, kills0: 0 },
    sim: sim.snapshot(),
    director: dir.snapshot(),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);
const MAX_LIST = 400;

/** Validates stored run data. Anything that is not a well-formed, current run save gives null. */
export function parseRunSave(raw: unknown): RunSave | null {
  if (!isObj(raw)) return null;
  if (raw.v !== RUN_SAVE_VERSION || raw.layout !== LAYOUT_VERSION) return null;
  if (!num(raw.savedAt, 0, 1e15) || !int(raw.seed, 0, 2 ** 32 - 1) || !int(raw.depth, 1, RUN.floors) || !num(raw.time, 0, 1e7)) return null;
  const heroId = raw.heroId;
  if (typeof heroId !== 'string' || !(heroId in HEROES)) return null;
  if (!Array.isArray(raw.skills) || raw.skills.length < 1 || raw.skills.length > SKILL_RULES.maxSlots) return null;
  const skills: SkillId[] = [];
  for (const id of raw.skills) {
    if (typeof id !== 'string' || !(id in SKILLS) || SKILLS[id as SkillId].hero !== heroId || skills.includes(id as SkillId)) return null;
    skills.push(id as SkillId);
  }
  const fl = raw.floor;
  if (!isObj(fl) || !num(fl.seconds, 0, 1e7) || !int(fl.fights, 0, MAX_LIST) || !int(fl.kills0, 0, 1e7)) return null;
  const sim = parseSim(raw.sim, raw.depth);
  const director = parseDirector(raw.director);
  if (!sim || !director) return null;
  return { v: RUN_SAVE_VERSION, layout: LAYOUT_VERSION, savedAt: raw.savedAt, seed: raw.seed, depth: raw.depth, time: raw.time, heroId: heroId as HeroId, skills, floor: { seconds: fl.seconds, fights: fl.fights, kills0: fl.kills0 }, sim, director };
}

function levels(raw: unknown, valid: (id: string) => number): Record<string, number> | null {
  if (!isObj(raw)) return null;
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(raw)) {
    const max = valid(id);
    if (max <= 0 || !int(n, 0, max)) return null;
    if (n > 0) out[id] = n;
  }
  return out;
}

function parseSim(raw: unknown, depth: number): SimSnapshot | null {
  if (!isObj(raw)) return null;
  if (!num(raw.time, 0, 1e7) || !int(raw.kills, 0, 1e7) || !int(raw.ash, 0, 1e8) || raw.depth !== depth) return null;
  if (!int(raw.rng, 0, 2 ** 32 - 1) || !int(raw.choiceRng, 0, 2 ** 32 - 1)) return null;
  const h = raw.hero;
  if (!isObj(h) || !num(h.x, 0, 1000) || !num(h.y, 0, 1000) || !num(h.facing, -10, 10) || !num(h.hp, 1, 1e5)) return null;
  if (!int(h.level, 1, 99) || !num(h.xp, 0, 1e7) || !num(h.dodgeCd, 0, 600)) return null;
  const upgrades = levels(h.upgrades, (id) => (id in UPGRADES ? UPGRADES[id as keyof typeof UPGRADES].maxStacks : 0));
  const skillUpgrades = levels(h.skillUpgrades, (id) => (isSkillUpgradeId(id) ? SKILL_UPGRADES[id]!.levels.length : 0));
  if (!upgrades || !skillUpgrades) return null;
  if (!Array.isArray(h.skillCd) || h.skillCd.length > SKILL_RULES.maxSlots || !h.skillCd.every((c) => num(c, 0, 600))) return null;
  if (!Array.isArray(raw.loot) || raw.loot.length > MAX_LIST || !raw.loot.every(isItem)) return null;
  if (!Array.isArray(raw.skillUpgradeLog) || raw.skillUpgradeLog.length > MAX_LIST || !raw.skillUpgradeLog.every((id) => isSkillUpgradeId(id))) return null;
  if (!Array.isArray(raw.trapPhases) || raw.trapPhases.length > 4000 || !raw.trapPhases.every((p) => num(p, 0, 100))) return null;
  if (!Array.isArray(raw.objects) || raw.objects.length > MAX_LIST) return null;
  for (const o of raw.objects) {
    if (!isObj(o) || !['chest', 'shrine', 'stairs', 'altar'].includes(o.kind as string) || !num(o.x, 0, 1000) || !num(o.y, 0, 1000) || !int(o.roomId, 0, MAX_LIST)) return null;
    if (typeof o.active !== 'boolean' || typeof o.used !== 'boolean' || !['enemy', 'elite', 'treasure', 'boss'].includes(o.loot as string)) return null;
  }
  if (!Array.isArray(raw.pickups) || raw.pickups.length > MAX_LIST) return null;
  for (const q of raw.pickups) {
    if (!isObj(q) || !['ash', 'heal', 'item'].includes(q.kind as string) || !num(q.x, 0, 1000) || !num(q.y, 0, 1000) || !num(q.amount, 0, 1e6)) return null;
    if (q.kind === 'item' && !isItem(q.item)) return null;
  }
  return raw as unknown as SimSnapshot;
}

function parseDirector(raw: unknown): DirectorSnapshot | null {
  if (!isObj(raw)) return null;
  const states = raw.states;
  if (!Array.isArray(states) || states.length < 2 || states.length > MAX_LIST || !states.every((s): s is RoomState => s === 'unvisited' || s === 'cleared' || s === 'active')) return null;
  const list = (v: unknown) => Array.isArray(v) && v.length <= MAX_LIST && v.every((i) => int(i, 0, MAX_LIST));
  if (!list(raw.revealedRooms) || !list(raw.revealedCorridors)) return null;
  if (raw.currentRoom !== null && !int(raw.currentRoom, 0, MAX_LIST)) return null;
  return raw as unknown as DirectorSnapshot;
}

/** Does this saved run belong to this very floor? (The generator is deterministic, so a mismatch means the data is stale or damaged.) */
export function fitsDungeon(rs: RunSave, d: Dungeon): boolean {
  if (rs.director.states.length !== d.rooms.length) return false;
  if (rs.director.revealedRooms.some((i) => i >= d.rooms.length) || rs.director.revealedCorridors.some((i) => i >= d.corridors.length)) return false;
  if (rs.director.currentRoom !== null && rs.director.currentRoom >= d.rooms.length) return false;
  if (rs.sim.objects.some((o) => o.roomId >= d.rooms.length)) return false;
  if (rs.sim.objects.length < d.objects.length) return false;
  if (rs.sim.trapPhases.length !== d.traps.length) return false;
  return isWalkable(d.map, Math.floor(rs.sim.hero.x), Math.floor(rs.sim.hero.y));
}

/** One line for the title screen: "Poziom 2 · poziom bohatera 7 · 14:32". */
export function describeRun(rs: RunSave): string {
  const m = Math.floor(rs.time / 60);
  const s = Math.floor(rs.time % 60);
  return `${HEROES[rs.heroId].name} · piętro ${rs.depth} · poz. ${rs.sim.hero.level} · ${m}:${String(s).padStart(2, '0')}`;
}
