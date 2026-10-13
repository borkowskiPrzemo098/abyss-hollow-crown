import type { EnemyKind } from './balance';

/** Procedural dungeon tuning. A floor is a grid of cells; each used cell holds one room. */
export const DUNGEON = {
  /** Macro grid size (cells per side). */
  grid: 4,
  /** Tiles per cell side. Rooms sit inside their cell with a wall margin. */
  cell: 16,
  /** Room interior size range (tiles). 10..12 guarantees every room contains its cell core (rows/cols 6..9). */
  roomMin: 10,
  roomMax: 12,
  /** Corridor width in tiles (odd). */
  corridorWidth: 3,
  /** Room count per floor depth (index = depth - 1, last value repeats). */
  rooms: [7, 8, 9],
  /** Extra connections beyond the spanning tree, for loops. */
  extraLinks: 1,
  /** Enemy budget per room: base + perDepth × (depth − 1); elite ×1.6, guardian ×2.2. */
  budgetBase: 3.4,
  budgetPerDepth: 1.6,
  eliteMult: 1.6,
  guardianMult: 2.2,
  /** Enemies never spawn closer than this to the hero. */
  minSpawnDistance: 3.6,
  /** Pause between waves inside one room. */
  waveGap: 1.2,
} as const;

export const ENEMY_COST: Record<EnemyKind, number> = { thrall: 1, acolyte: 1.5, brute: 3, hound: 2, pyre: 1.6, bossCrypt: 0, bossFrost: 0, bossKing: 0 };
