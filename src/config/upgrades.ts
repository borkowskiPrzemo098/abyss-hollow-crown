import type { HeroId } from './heroes';

/**
 * In-run upgrades, offered three at a time on level-up and from chests.
 * Every upgrade has a hard stack cap so power never grows without bound.
 * The numeric effect of each stack is applied in src/sim/stats.ts.
 */
export type UpgradeId =
  | 'power'
  | 'haste'
  | 'vigor'
  | 'swift'
  | 'keen'
  | 'brutal'
  | 'ward'
  | 'focus'
  | 'reach'
  | 'piercing'
  | 'wideArc'
  | 'feast'
  | 'shatter'
  | 'lastStand'
  | 'dodgeStrike';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Short effect line shown on the card. */
  text: string;
  maxStacks: number;
  /** Relative chance to be offered. Special upgrades are rarer than stat bumps. */
  weight: number;
  kind: 'stat' | 'special';
  /** Restrict to some heroes; undefined = everyone. */
  heroes?: readonly HeroId[];
}

export const UPGRADE_EFFECT = {
  power: 0.12, // +damage
  haste: 0.1, // +attack speed
  vigor: 20, // +max HP (and heals the same amount)
  swift: 0.07, // +move speed
  keen: 0.05, // +crit chance
  brutal: 0.3, // +crit multiplier
  ward: 0.06, // +armor
  focus: 0.88, // ×skill cooldown per stack
  reachMelee: 0.25,
  reachRanged: 1,
  wideArcDeg: 40,
  wideArcRatio: 0.25,
  feastHeal: 2, // HP per kill per stack
  shatterBase: 0.35, // death burst = this × damage (first stack)
  shatterPerStack: 0.2,
  shatterRadius: 1.4,
  lastStandBonus: 0.35, // +damage per stack while below threshold
  lastStandThreshold: 0.35,
  dodgeStrikeBonus: 1.0, // +100% on the empowered hit
  dodgeStrikeWindow: 2.0,
} as const;

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  power: { id: 'power', name: 'Żar w żyłach', text: '+12% obrażeń', maxStacks: 5, weight: 10, kind: 'stat' },
  haste: { id: 'haste', name: 'Rytm ostrza', text: '+10% szybkości ataku', maxStacks: 5, weight: 10, kind: 'stat' },
  vigor: { id: 'vigor', name: 'Twarda skóra', text: '+20 maks. zdrowia i leczenie o 20', maxStacks: 5, weight: 10, kind: 'stat' },
  swift: { id: 'swift', name: 'Lekki krok', text: '+7% szybkości ruchu', maxStacks: 3, weight: 7, kind: 'stat' },
  keen: { id: 'keen', name: 'Oko kata', text: '+5% szansy na trafienie krytyczne', maxStacks: 4, weight: 8, kind: 'stat' },
  brutal: { id: 'brutal', name: 'Okrucieństwo', text: '+30% obrażeń krytycznych', maxStacks: 3, weight: 6, kind: 'stat' },
  ward: { id: 'ward', name: 'Kamienna skóra', text: '+6% redukcji obrażeń', maxStacks: 4, weight: 7, kind: 'stat' },
  focus: { id: 'focus', name: 'Skupienie', text: 'Umiejętność odnawia się o 12% szybciej', maxStacks: 3, weight: 7, kind: 'stat' },
  reach: { id: 'reach', name: 'Dłuższe ramię', text: 'Większy zasięg ataku', maxStacks: 2, weight: 5, kind: 'stat' },
  piercing: {
    id: 'piercing',
    name: 'Przeszywające odłamki',
    text: 'Odłamki przebijają +1 wroga',
    maxStacks: 2,
    weight: 5,
    kind: 'special',
    heroes: ['wanderer'],
  },
  wideArc: {
    id: 'wideArc',
    name: 'Szeroki zamach',
    text: 'Cięcie obejmuje szerszy łuk i rani mocniej',
    maxStacks: 2,
    weight: 5,
    kind: 'special',
    heroes: ['warden'],
  },
  feast: { id: 'feast', name: 'Żarłoczny popiół', text: 'Każde zabójstwo leczy 2 HP', maxStacks: 3, weight: 5, kind: 'special' },
  shatter: {
    id: 'shatter',
    name: 'Kruche dusze',
    text: 'Pokonani wrogowie wybuchają, raniąc pobliskich',
    maxStacks: 2,
    weight: 4,
    kind: 'special',
  },
  lastStand: {
    id: 'lastStand',
    name: 'Ostatni bastion',
    text: '+35% obrażeń, gdy masz mniej niż 35% zdrowia',
    maxStacks: 2,
    weight: 4,
    kind: 'special',
  },
  dodgeStrike: {
    id: 'dodgeStrike',
    name: 'Kontra z przewrotu',
    text: 'Pierwszy atak po uniku zadaje +100% i zawsze jest krytyczny',
    maxStacks: 1,
    weight: 4,
    kind: 'special',
  },
};
