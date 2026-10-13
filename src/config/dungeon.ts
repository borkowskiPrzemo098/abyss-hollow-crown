import type { EnemyKind } from './balance';

/**
 * Procedural dungeon tuning. A floor is a grid of cells; each used cell holds one room.
 *
 * Shape of a floor: one winding MAIN ROUTE from the entrance to the boss lair (wide corridors), and optional
 * BRANCHES off it (narrow corridors) that end in a reward. Nothing on the way to the exit ever depends on a
 * branch, and there are no loops, so the exit is always the deepest room.
 */
export const DUNGEON = {
  /** Macro grid size (cells per side). */
  grid: 7,
  /** Tiles per cell side. Rooms sit inside their cell with a wall margin. */
  cell: 20,
  /**
   * Rooms always contain the cell's core band (rows / columns coreLo..coreHi), so a corridor between two
   * neighbouring cells always lines up with both rooms. cell 20 → 8..11.
   */
  coreLo: 8,
  coreHi: 11,
  /** The boss lair's side (always this size, so the boss fight is the same on every seed). */
  roomMax: 12,
  /** Interior side ranges by room kind (min, max). */
  sizes: {
    start: [10, 12],
    combat: [10, 13],
    arena: [14, 16],
    elite: [12, 14],
    treasure: [9, 11],
    shrine: [9, 11],
    altar: [9, 11],
    trial: [12, 14],
  } as const,
  /** Corridor width in tiles (odd): the main route is wide, side branches are narrow. */
  corridorWidth: 3,
  branchWidth: 1,
  /** Rooms on the main route, start and boss lair included (index = depth − 1, last value repeats). */
  mainRooms: [16, 16, 17],
  /** Side branches per floor, and their length range in rooms. */
  branches: [8, 8, 9],
  branchLength: [1, 3],
  /** Enemy budget per room: base + perDepth × (depth − 1), × room-kind multipliers below. */
  budgetBase: 9,
  budgetPerDepth: 3,
  eliteMult: 1.6,
  arenaMult: 1.9,
  guardianMult: 2.2,
  /** Budget rises along the route: × (1 + ramp × (progress − 0.5)), progress 0 at the entrance, 1 at the boss. */
  ramp: 0.7,
  /** Enemies never spawn closer than this to the hero. */
  minSpawnDistance: 3.6,
  /** Pause between waves inside one room. */
  waveGap: 1.2,
  /** Enemies per wave (rooms get more waves instead of bigger ones) and the most waves a room can have. */
  waveSize: 5,
  maxWaves: 3,
  arenaMinWaves: 3,
  /** Never more than this many enemies alive at once from one room's waves. */
  maxAlive: 9,
  /** Cost of the optional events: an altar takes this share of max HP. */
  altarCost: 0.25,
  /** Trial halls hold this many times the usual traps. */
  trialTrapMult: 3,
  /** An arena won is worth more: healing, and the chance of an item. */
  arenaHeal: 0.15,
  arenaItemChance: 0.5,
} as const;

export type EncounterStyle = 'standard' | 'swarm' | 'ranged' | 'brutes';

export const ENCOUNTER_STYLES: readonly EncounterStyle[] = ['standard', 'swarm', 'ranged', 'brutes'];

export const ENEMY_COST: Record<EnemyKind, number> = { thrall: 1, acolyte: 1.5, brute: 3, hound: 2, pyre: 1.6, bossCrypt: 0, bossFrost: 0, bossKing: 0 };
