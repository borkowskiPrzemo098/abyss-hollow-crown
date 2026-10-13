import type { HeroId } from '../config/heroes';
import {
  AFFIX_RANGE,
  BASES,
  NAME_PREFIX,
  RARITY,
  RARITY_WEIGHTS,
  UNIQUES,
  ilvlMult,
  type DropSource,
  type Item,
  type Rarity,
  type StatKey,
  type StatMods,
} from '../config/items';
import type { Rng } from '../core/rng';

const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
const AFFIX_POOL: readonly StatKey[] = ['maxHp', 'damagePct', 'attackSpeedPct', 'armor', 'critChance', 'critMult', 'movePct', 'cdr', 'lifeOnKill'];

/** Rolls a rarity for a drop. Each floor below the first moves weight toward rarer tiers. */
export function rollRarity(rng: Rng, source: DropSource, depth: number): Rarity {
  const w = [...RARITY_WEIGHTS[source]];
  const shift = Math.max(0, depth - 1);
  // move a slice of each tier into the next one per extra floor
  for (let s = 0; s < shift; s++) {
    for (let i = 2; i >= 0; i--) {
      const moved = w[i]! * 0.2;
      w[i]! -= moved;
      w[i + 1]! += moved;
    }
  }
  let roll = rng.next() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i++) {
    if (roll < w[i]!) return RARITIES[i]!;
    roll -= w[i]!;
  }
  return 'common';
}

let uidCounter = 0;

function round(k: StatKey, v: number): number {
  return k === 'maxHp' || k === 'lifeOnKill' ? Math.max(1, Math.round(v)) : Math.round(v * 1000) / 1000;
}

function addMods(into: StatMods, from: StatMods, scale = 1): void {
  for (const [k, v] of Object.entries(from) as [StatKey, number][]) into[k] = (into[k] ?? 0) + v * scale;
}

/**
 * Creates an item. Weapons are always for `hero`'s class; other slots fit everyone.
 * Deterministic for a given rng state.
 */
export function generateItem(rng: Rng, hero: HeroId, ilvl: number, rarity: Rarity): Item {
  const L = ilvlMult(ilvl);
  uidCounter = (uidCounter + 1) % 1e6;
  const uid = `i${Date.now().toString(36)}${rng.int(0, 1e9).toString(36)}${uidCounter}`;
  if (rarity === 'legendary') {
    const pool = UNIQUES.filter((u) => {
      const b = BASES[u.base]!;
      return !b.hero || b.hero === hero;
    });
    const u = rng.pick(pool);
    const base = BASES[u.base]!;
    const stats: StatMods = {};
    addMods(stats, base.implicit, L);
    rollAffixes(rng, stats, base.slot === 'weapon', RARITY.legendary.affixes, RARITY.legendary.mult * L);
    addMods(stats, u.bonus, L);
    for (const k of Object.keys(stats) as StatKey[]) stats[k] = round(k, stats[k]!);
    return { uid, base: base.id, rarity, ilvl, name: u.name, stats, effect: u.effect, unique: u.id };
  }
  const bases = Object.values(BASES).filter((b) => !b.hero || b.hero === hero);
  // weapons are a bit more common: they matter most
  const weighted = bases.flatMap((b) => (b.slot === 'weapon' ? [b, b] : [b]));
  const base = rng.pick(weighted);
  const stats: StatMods = {};
  addMods(stats, base.implicit, L);
  rollAffixes(rng, stats, base.slot === 'weapon', RARITY[rarity].affixes, RARITY[rarity].mult * L);
  for (const k of Object.keys(stats) as StatKey[]) stats[k] = round(k, stats[k]!);
  const name = `${rng.pick(NAME_PREFIX[rarity])} ${base.name.toLowerCase()}`;
  return { uid, base: base.id, rarity, ilvl, name: name.charAt(0).toUpperCase() + name.slice(1), stats };
}

function rollAffixes(rng: Rng, stats: StatMods, weapon: boolean, count: number, scale: number): void {
  const pool = weapon ? [...AFFIX_POOL, 'range' as StatKey] : [...AFFIX_POOL];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const k = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    const [lo, hi] = AFFIX_RANGE[k];
    stats[k] = (stats[k] ?? 0) + rng.range(lo, hi) * scale;
  }
}

/** Ash gained from breaking an item down. */
export function salvageValue(item: Item): number {
  return Math.round(RARITY[item.rarity].salvage * ilvlMult(item.ilvl));
}

/** Validates an item read from storage. */
export function isItem(v: unknown): v is Item {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.uid === 'string' &&
    typeof o.base === 'string' &&
    o.base in BASES &&
    typeof o.rarity === 'string' &&
    o.rarity in RARITY &&
    typeof o.ilvl === 'number' &&
    o.ilvl >= 1 &&
    o.ilvl <= 50 &&
    typeof o.name === 'string' &&
    !!o.stats &&
    typeof o.stats === 'object'
  );
}
