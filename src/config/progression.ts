/**
 * Progression: in-run levels (XP) and the permanent Sanctuary ranks paid with ash.
 */

/**
 * XP needed to go from `level` to `level + 1`. Floors are long (a hundred and more kills each), so a level costs
 * more than it did on the short floors: about five to seven levels per floor, not nine.
 */
export function xpToNext(level: number): number {
  return 30 + (level - 1) * 22;
}

export const RUN = {
  /** Floors in a full expedition. Clearing the last one wins the run. */
  floors: 3,
  /** Share of the ash collected in a run that is kept after dying. Finishing keeps 100%. */
  ashKeptOnDeath: 0.6,
  victoryAshBonus: 40,
  roomClearAsh: 3,
  /** Clearing a room restores this share of max HP — a breather between fights. */
  roomClearHeal: 0.12,
  /** Pickups within this distance fly to the hero. */
  magnetRadius: 2.6,
  /** Chance an enemy also drops a small healing ember. */
  healDropChance: 0.1,
  healAmount: 10,
  shrineHealFraction: 0.5,
} as const;

/** Enemies get tougher every floor. */
export function floorScaling(depth: number): { hp: number; damage: number; xp: number } {
  const d = Math.max(0, depth - 1);
  return { hp: 1 + d * 0.3, damage: 1 + d * 0.15, xp: 1 + d * 0.25 };
}

export type RankId = 'vitality' | 'might' | 'haste' | 'agility' | 'guard' | 'precision';

export interface RankDef {
  id: RankId;
  name: string;
  /** Effect per rank, as shown in the Sanctuary. */
  text: string;
  costs: readonly number[];
}

/** Permanent upgrades bought in the Sanctuary between runs. Max rank = costs.length. */
export const RANKS: Record<RankId, RankDef> = {
  vitality: { id: 'vitality', name: 'Witalność', text: '+10 maks. zdrowia', costs: [15, 30, 50, 80, 120] },
  might: { id: 'might', name: 'Siła', text: '+6% obrażeń', costs: [20, 40, 65, 100, 150] },
  haste: { id: 'haste', name: 'Zręczność', text: '+5% szybkości ataku', costs: [20, 40, 65, 100, 150] },
  agility: { id: 'agility', name: 'Zwinność', text: '+4% szybkości ruchu', costs: [15, 35, 60] },
  guard: { id: 'guard', name: 'Hart', text: '+4% redukcji obrażeń', costs: [20, 45, 75, 110] },
  precision: { id: 'precision', name: 'Precyzja', text: '+3% szansy na krytyk', costs: [20, 45, 75, 110] },
};

export const RANK_EFFECT = {
  vitality: 10,
  might: 0.06,
  haste: 0.05,
  agility: 0.04,
  guard: 0.04,
  precision: 0.03,
} as const;

export type MetaRanks = Record<RankId, number>;

export const NO_RANKS: MetaRanks = { vitality: 0, might: 0, haste: 0, agility: 0, guard: 0, precision: 0 };
