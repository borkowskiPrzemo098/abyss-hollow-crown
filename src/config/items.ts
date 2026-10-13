import type { HeroId } from './heroes';

/**
 * Equipment. Items are kept between expeditions (saved), and every one is
 * rolled from a base type + rarity + item level. Legendaries are hand-made
 * uniques with an effect that changes how you play.
 */
export type Slot = 'weapon' | 'helmet' | 'armor' | 'amulet' | 'ring';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type StatKey =
  | 'maxHp'
  | 'damagePct'
  | 'attackSpeedPct'
  | 'armor'
  | 'critChance'
  | 'critMult'
  | 'movePct'
  | 'cdr'
  | 'lifeOnKill'
  | 'range';
export type EffectId =
  | 'burn'
  | 'frostShell'
  | 'chain'
  | 'leech'
  | 'thorns'
  | 'barrier'
  | 'emberStep'
  | 'critNova'
  | 'frenzy'
  | 'executioner';

export type StatMods = Partial<Record<StatKey, number>>;

export interface Item {
  uid: string;
  base: string;
  rarity: Rarity;
  /** Item level = dungeon depth it dropped on. Scales every number. */
  ilvl: number;
  name: string;
  stats: StatMods;
  effect?: EffectId;
  unique?: string;
}

export const SLOTS: readonly Slot[] = ['weapon', 'helmet', 'armor', 'amulet', 'ring'];

export const SLOT_NAMES: Record<Slot, string> = {
  weapon: 'Broń',
  helmet: 'Hełm',
  armor: 'Zbroja',
  amulet: 'Amulet',
  ring: 'Pierścień',
};

export const RARITY: Record<Rarity, { name: string; color: number; css: string; affixes: number; mult: number; salvage: number }> = {
  common: { name: 'Zwykły', color: 0xcfc8b8, css: '#cfc8b8', affixes: 1, mult: 0.75, salvage: 3 },
  rare: { name: 'Rzadki', color: 0x6aa8ff, css: '#6aa8ff', affixes: 2, mult: 1, salvage: 8 },
  epic: { name: 'Epicki', color: 0xb57bff, css: '#b57bff', affixes: 3, mult: 1.25, salvage: 18 },
  legendary: { name: 'Legendarny', color: 0xffb347, css: '#ffb347', affixes: 3, mult: 1.4, salvage: 40 },
};

export const STAT_NAMES: Record<StatKey, string> = {
  maxHp: 'Zdrowie',
  damagePct: 'Obrażenia',
  attackSpeedPct: 'Szybkość ataku',
  armor: 'Redukcja obrażeń',
  critChance: 'Szansa na krytyk',
  critMult: 'Obrażenia krytyczne',
  movePct: 'Szybkość ruchu',
  cdr: 'Odnowienie umiejętności',
  lifeOnKill: 'Zdrowie za zabójstwo',
  range: 'Zasięg ataku',
};

/** How a stat value is printed. */
export function formatStat(k: StatKey, v: number): string {
  const sign = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  switch (k) {
    case 'maxHp':
    case 'lifeOnKill':
      return `${sign}${Math.round(a)}`;
    case 'range':
      return `${sign}${a.toFixed(1)}`;
    case 'critMult':
      return `${sign}${Math.round(a * 100)}%`;
    default:
      return `${sign}${Math.round(a * 100)}%`;
  }
}

/** Per-affix roll range at item level 1, rarity multiplier 1. */
export const AFFIX_RANGE: Record<StatKey, [number, number]> = {
  maxHp: [10, 18],
  damagePct: [0.06, 0.12],
  attackSpeedPct: [0.05, 0.1],
  armor: [0.03, 0.06],
  critChance: [0.03, 0.06],
  critMult: [0.15, 0.3],
  movePct: [0.03, 0.06],
  cdr: [0.05, 0.1],
  lifeOnKill: [1, 2],
  range: [0.15, 0.3],
};

/** Every number on an item grows with its level. */
export const ilvlMult = (ilvl: number): number => 1 + 0.3 * (ilvl - 1);

export interface ItemBaseDef {
  id: string;
  slot: Slot;
  name: string;
  /** SVG symbol id used by the UI. */
  icon: string;
  /** Weapons belong to one class. */
  hero?: HeroId;
  implicit: StatMods;
}

export const BASES: Record<string, ItemBaseDef> = {
  sword: { id: 'sword', slot: 'weapon', name: 'Miecz', icon: 'it-sword', hero: 'warden', implicit: { damagePct: 0.1 } },
  axe: { id: 'axe', slot: 'weapon', name: 'Topór', icon: 'it-axe', hero: 'warden', implicit: { damagePct: 0.2, attackSpeedPct: -0.08 } },
  mace: { id: 'mace', slot: 'weapon', name: 'Buzdygan', icon: 'it-mace', hero: 'warden', implicit: { damagePct: 0.08, critMult: 0.3 } },
  staff: { id: 'staff', slot: 'weapon', name: 'Laska', icon: 'it-staff', hero: 'wanderer', implicit: { damagePct: 0.1 } },
  wand: { id: 'wand', slot: 'weapon', name: 'Różdżka', icon: 'it-wand', hero: 'wanderer', implicit: { damagePct: 0.04, attackSpeedPct: 0.12 } },
  crystal: { id: 'crystal', slot: 'weapon', name: 'Kostur', icon: 'it-crystal', hero: 'wanderer', implicit: { damagePct: 0.2, range: 0.5, attackSpeedPct: -0.08 } },
  hood: { id: 'hood', slot: 'helmet', name: 'Kaptur', icon: 'it-hood', implicit: { critChance: 0.04 } },
  helm: { id: 'helm', slot: 'helmet', name: 'Hełm', icon: 'it-helm', implicit: { maxHp: 12, armor: 0.03 } },
  mail: { id: 'mail', slot: 'armor', name: 'Kolczuga', icon: 'it-mail', implicit: { armor: 0.06 } },
  plate: { id: 'plate', slot: 'armor', name: 'Napierśnik', icon: 'it-plate', implicit: { armor: 0.09, maxHp: 15, movePct: -0.04 } },
  cloak: { id: 'cloak', slot: 'armor', name: 'Płaszcz', icon: 'it-cloak', implicit: { movePct: 0.05, armor: 0.02 } },
  talisman: { id: 'talisman', slot: 'amulet', name: 'Talizman', icon: 'it-talisman', implicit: { cdr: 0.08 } },
  eye: { id: 'eye', slot: 'amulet', name: 'Oko', icon: 'it-eye', implicit: { critChance: 0.04 } },
  signet: { id: 'signet', slot: 'ring', name: 'Sygnet', icon: 'it-signet', implicit: { damagePct: 0.06 } },
  band: { id: 'band', slot: 'ring', name: 'Obrączka', icon: 'it-band', implicit: { maxHp: 15 } },
};

/** Adjectives for generated (non-unique) item names, by rarity. */
export const NAME_PREFIX: Record<Exclude<Rarity, 'legendary'>, readonly string[]> = {
  common: ['Zużyty', 'Prosty', 'Stary'],
  rare: ['Hartowany', 'Runiczny', 'Ostry', 'Solidny'],
  epic: ['Popielny', 'Przeklęty', 'Królewski', 'Otchłanny'],
};

export interface EffectDef {
  id: EffectId;
  name: string;
  /** Effect text for the item card. */
  text: string;
}

/** Effect tuning. Effects never stack with themselves (the strongest copy wins). */
export const EFFECT = {
  burn: { dpsOfDamage: 0.35, duration: 3, tick: 0.5 },
  frostShell: { radius: 3, freeze: 1.6, cooldown: 10 },
  chain: { every: 4, targets: 2, damage: 0.6, range: 3.2 },
  leech: { fraction: 0.04 },
  thorns: { damage: 1.5 },
  barrier: { amount: 25, perIlvl: 10, delay: 5 },
  emberStep: { damage: 0.9, radius: 1.7 },
  critNova: { damage: 0.6, radius: 1.4, cooldown: 0.4 },
  frenzy: { attackSpeed: 0.3, move: 0.15, duration: 3 },
  executioner: { bonus: 0.6, threshold: 0.35 },
} as const;

export const EFFECTS: Record<EffectId, EffectDef> = {
  burn: { id: 'burn', name: 'Ogień', text: 'Ataki podpalają: wróg płonie przez 3 s.' },
  frostShell: { id: 'frostShell', name: 'Skorupa mrozu', text: 'Gdy zostaniesz trafiony, zamrażasz wrogów wokół na 1,6 s. Odnawia się co 10 s.' },
  chain: { id: 'chain', name: 'Łańcuch błyskawic', text: 'Co 4. atak przeskakuje na 2 pobliskich wrogów.' },
  leech: { id: 'leech', name: 'Wysysanie', text: 'Leczy 4% zadanych obrażeń.' },
  thorns: { id: 'thorns', name: 'Ciernie', text: 'Wróg, który uderzy cię wręcz, sam obrywa.' },
  barrier: { id: 'barrier', name: 'Bariera', text: 'Tarcza pochłania obrażenia; odnawia się 5 s po ostatnim trafieniu.' },
  emberStep: { id: 'emberStep', name: 'Popielny krok', text: 'Unik zostawia wybuch żaru w miejscu startu.' },
  critNova: { id: 'critNova', name: 'Rozpad', text: 'Trafienia krytyczne wybuchają, raniąc wrogów obok.' },
  frenzy: { id: 'frenzy', name: 'Szał', text: 'Zabójstwo daje +30% szybkości ataku i +15% ruchu na 3 s.' },
  executioner: { id: 'executioner', name: 'Egzekucja', text: '+60% obrażeń przeciw wrogom poniżej 35% zdrowia.' },
};

export interface UniqueDef {
  id: string;
  base: string;
  name: string;
  effect: EffectId;
  bonus: StatMods;
  flavor: string;
}

export const UNIQUES: readonly UniqueDef[] = [
  { id: 'kiel', base: 'sword', name: 'Żarzący Kieł', effect: 'burn', bonus: { damagePct: 0.15 }, flavor: 'Kuty w ogniu, który nigdy nie zgasł.' },
  { id: 'kat', base: 'axe', name: 'Topór Kata', effect: 'executioner', bonus: { critMult: 0.3 }, flavor: 'Zna tylko jeden ruch. Ostatni.' },
  { id: 'burza', base: 'staff', name: 'Laska Burzy', effect: 'chain', bonus: { attackSpeedPct: 0.1 }, flavor: 'Kryształ wciąż trzeszczy od uwięzionej błyskawicy.' },
  { id: 'plomien', base: 'wand', name: 'Różdżka Płomieni', effect: 'burn', bonus: { damagePct: 0.1 }, flavor: 'Ciepła w dłoni nawet w Lodowych Grobach.' },
  { id: 'zima', base: 'plate', name: 'Kirys Wiecznej Zimy', effect: 'frostShell', bonus: { maxHp: 25 }, flavor: 'Kto go dotknie, zamarza.' },
  { id: 'ciernie', base: 'mail', name: 'Pancerz Cierni', effect: 'thorns', bonus: { armor: 0.05 }, flavor: 'Każde ogniwo zakończone kolcem.' },
  { id: 'szal', base: 'helm', name: 'Hełm Szału', effect: 'frenzy', bonus: { critChance: 0.04 }, flavor: 'Krew przyspiesza krok.' },
  { id: 'wieniec', base: 'hood', name: 'Wieniec Bariery', effect: 'barrier', bonus: { cdr: 0.08 }, flavor: 'Splot światła, którego nie widać, dopóki nie zaboli.' },
  { id: 'krok', base: 'talisman', name: 'Amulet Popielnego Kroku', effect: 'emberStep', bonus: { movePct: 0.05 }, flavor: 'Zostawia ślady, które płoną.' },
  { id: 'rozpad', base: 'eye', name: 'Oko Rozpadu', effect: 'critNova', bonus: { critChance: 0.05 }, flavor: 'Widzi pęknięcia w każdym ciele.' },
  { id: 'pijawka', base: 'band', name: 'Pierścień Pijawki', effect: 'leech', bonus: { maxHp: 20 }, flavor: 'Głodny. Zawsze głodny.' },
  { id: 'zar', base: 'signet', name: 'Sygnet Żaru', effect: 'burn', bonus: { damagePct: 0.08 }, flavor: 'Pieczęć dawnego kowala Korony.' },
];

export type DropSource = 'enemy' | 'elite' | 'treasure' | 'boss';

/** Rarity weights per source [common, rare, epic, legendary]; deeper floors shift them up. */
export const RARITY_WEIGHTS: Record<DropSource, [number, number, number, number]> = {
  enemy: [70, 26, 4, 0],
  elite: [0, 55, 35, 10],
  treasure: [0, 60, 32, 8],
  boss: [0, 0, 70, 30],
};

export const DROPS = {
  /** Chance a regular enemy drops an item (brutes and hounds use the higher value). */
  enemyChance: 0.03,
  toughEnemyChance: 0.1,
  bossItems: 2,
  bagSize: 30,
} as const;
