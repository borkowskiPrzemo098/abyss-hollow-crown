import type { SkillId } from './skills';

/**
 * Statuses on enemies, and the reactions between skills and statuses.
 * All numbers of the system live here; the logic is in src/sim/simulation.ts.
 *
 * Rules that keep it from running away:
 *  1. every status has a duration, a refresh rule and a stack limit (below);
 *  2. a reaction either *consumes* its status or is rate limited;
 *  3. damage that comes from a reaction never triggers another reaction;
 *  4. hard crowd control (stun, freeze) has a maximum length and a cool-off in which
 *     the enemy cannot be locked again — longer for bosses;
 *  5. spreading effects carry a generation counter and stop after a few hops.
 */
export type StatusId = 'burn' | 'bleed' | 'chill' | 'freeze' | 'mark';

export interface StatusDef {
  id: StatusId;
  name: string;
  /** What it does, in one line (shown in the character sheet). */
  text: string;
}

export const STATUS_LIST: readonly StatusDef[] = [
  { id: 'burn', name: 'Podpalenie', text: 'Obrażenia co 0,5 s przez 3 s. Ponowne podpalenie odnawia czas, nie sumuje się.' },
  { id: 'bleed', name: 'Krwawienie', text: 'Obrażenia co 0,5 s przez 4 s. Każde trafienie dodaje stos (maks. 3) i odnawia czas.' },
  { id: 'chill', name: 'Spowolnienie', text: 'Wróg porusza się wolniej. Ponowne nałożenie odnawia czas.' },
  { id: 'freeze', name: 'Zamrożenie', text: 'Wróg stoi w miejscu. Po zakończeniu jest chwilę odporny na kolejne.' },
  { id: 'mark', name: 'Oznaczenie', text: 'Trafienia pociskami w oznaczonego wroga wywołują łuki błyskawic. Maks. 4 oznaczonych naraz.' },
];

export const STATUS = {
  burn: {
    /** An ignition that was spread from another burning enemy is one generation further; the last generation cannot spread. */
    maxGeneration: 2,
  },
  bleed: {
    duration: 4,
    tick: 0.5,
    maxStacks: 3,
    /** Damage per second of one stack, as a share of the hero's attack damage. */
    dpsPerStack: 0.15,
    /** Bosses bleed for this share of the damage. */
    bossFactor: 0.5,
  },
  chill: {
    /** Walking speed of a chilled enemy (bosses: bossSlow). */
    slow: 0.65,
    bossSlow: 0.85,
    maxDuration: 4,
  },
  /** Stun and freeze. */
  cc: {
    /** Longest a single application can stun (bosses: bossMax). Stuns already running are never shortened. */
    max: 3,
    bossMax: 0.8,
    /** After a stun ends the enemy cannot be stunned for this long. */
    grace: 0.8,
    bossGrace: 5,
  },
  mark: {
    duration: 6,
    /** Marked enemies at once; marking another drops the oldest mark. */
    maxMarked: 4,
  },
} as const;

export type SynergyId = 'rend' | 'stoke' | 'storm' | 'shatter' | 'trap';

export interface SynergyDef {
  id: SynergyId;
  name: string;
  /** What happens, for the player. */
  text: string;
  /** Skills that take part (apply, consume or trigger). */
  skills: readonly SkillId[];
}

export const SYNERGIES: Record<SynergyId, SynergyDef> = {
  rend: {
    id: 'rend',
    name: 'Rozerwanie',
    text: 'Szarża, Rzut Toporem i Wir Ostrzy wywołują krwawienie. Rozłam i Miażdżący Cios zużywają je, zadając 60% obrażeń za każdy stos.',
    skills: ['charge', 'axe', 'whirl', 'sunder', 'crush'],
  },
  stoke: {
    id: 'stoke',
    name: 'Rozdmuchanie',
    text: 'Okrzyk Wojny roznosi podpalenie z płonących wrogów na tych obok (maks. 4 naraz; roznoszony ogień nie roznosi się dalej w nieskończoność).',
    skills: ['warcry'],
  },
  storm: {
    id: 'storm',
    name: 'Burza znaku',
    text: 'Strzał Przeszywający i Gwiezdny Deszcz oznaczają wrogów. Salwa, Strzał, Wartownik i Przeciążenie trafiające oznaczonego wroga wyzwalają łuk błyskawicy na dwóch pobliskich.',
    skills: ['snipe', 'starfall', 'volley', 'sentry', 'overload'],
  },
  shatter: {
    id: 'shatter',
    name: 'Rozbicie',
    text: 'Miażdżący Cios, Strzał Przeszywający i Mina trafiające zamrożonego wroga zadają o 60% więcej i rozbijają lód.',
    skills: ['frost', 'crush', 'snipe', 'mine'],
  },
  trap: {
    id: 'trap',
    name: 'Pułapka z uniku',
    text: 'Z ulepszeniem „Mina w Przewrocie” każdy unik zostawia za tobą minę Pustki (co 4 s).',
    skills: ['mine'],
  },
};

/** Numbers of the individual reactions. */
export const SYNERGY = {
  rend: {
    /** Skills that start bleeding on every hit. */
    applyBy: ['charge', 'axe', 'whirl'] as readonly SkillId[],
    /** Skills that consume it. */
    consumeBy: ['sunder', 'crush'] as readonly SkillId[],
    /** × attack damage per consumed stack. */
    perStack: 0.6,
  },
  stoke: {
    spreadRadius: 2.4,
    /** New ignitions per cast. */
    maxNew: 4,
    /** The spread fire burns at this share of its source's strength. */
    strength: 0.8,
  },
  storm: {
    /** Skills whose hits mark the enemy. */
    markBy: ['snipe', 'starfall'] as readonly SkillId[],
    /** Shots that trigger an arc when they hit a marked enemy. */
    triggerBy: ['volley', 'sentry', 'snipe', 'overload'] as readonly SkillId[],
    targets: 2,
    range: 3.5,
    /** × attack damage per arc. */
    damage: 0.5,
    /** A marked enemy arcs at most this often. */
    perMarkCooldown: 0.6,
    /** All arcs together: refill per second and the most that can be spent at once. */
    perSecond: 6,
    burst: 6,
  },
  shatter: {
    heavy: ['crush', 'snipe', 'mine'] as readonly SkillId[],
    bonus: 0.6,
    /** The shards chill the enemy for this long. */
    chill: 2,
  },
  trap: {
    cooldown: 4,
  },
} as const;

/** Synergies a skill takes part in (for the skill cards and the character sheet). */
export function synergiesOf(skill: SkillId): SynergyDef[] {
  return Object.values(SYNERGIES).filter((s) => s.skills.includes(skill));
}

/** Mistakes in the tables that would otherwise show up as a reaction that never happens. */
export function validateStatusData(skillIds: readonly SkillId[]): string[] {
  const problems: string[] = [];
  for (const s of Object.values(SYNERGIES)) {
    if (s.skills.length === 0) problems.push(`${s.id}: no skills`);
    for (const k of s.skills) if (!skillIds.includes(k)) problems.push(`${s.id}: unknown skill ${k}`);
    if (!s.name || !s.text) problems.push(`${s.id}: missing text`);
  }
  const listed = (ids: readonly SkillId[], where: string, syn: SynergyId) => {
    for (const k of ids) if (!SYNERGIES[syn].skills.includes(k)) problems.push(`${where}: ${k} is not listed as a participant of ${syn}`);
  };
  listed(SYNERGY.rend.applyBy, 'rend.applyBy', 'rend');
  listed(SYNERGY.rend.consumeBy, 'rend.consumeBy', 'rend');
  listed(SYNERGY.storm.markBy, 'storm.markBy', 'storm');
  listed(SYNERGY.storm.triggerBy, 'storm.triggerBy', 'storm');
  listed(SYNERGY.shatter.heavy, 'shatter.heavy', 'shatter');
  const positive: [string, number][] = [
    ['bleed.duration', STATUS.bleed.duration],
    ['bleed.tick', STATUS.bleed.tick],
    ['bleed.maxStacks', STATUS.bleed.maxStacks],
    ['mark.duration', STATUS.mark.duration],
    ['mark.maxMarked', STATUS.mark.maxMarked],
    ['cc.max', STATUS.cc.max],
    ['cc.bossMax', STATUS.cc.bossMax],
    ['cc.grace', STATUS.cc.grace],
    ['cc.bossGrace', STATUS.cc.bossGrace],
    ['storm.targets', SYNERGY.storm.targets],
    ['storm.perMarkCooldown', SYNERGY.storm.perMarkCooldown],
    ['storm.perSecond', SYNERGY.storm.perSecond],
    ['storm.burst', SYNERGY.storm.burst],
    ['stoke.maxNew', SYNERGY.stoke.maxNew],
    ['burn.maxGeneration', STATUS.burn.maxGeneration],
  ];
  for (const [k, v] of positive) if (!(v > 0)) problems.push(`${k} must be positive`);
  if (STATUS.cc.bossMax > STATUS.cc.max) problems.push('bosses must not be stunned for longer than other enemies');
  if (STATUS.cc.bossGrace < STATUS.cc.grace) problems.push('bosses must stay immune at least as long as other enemies');
  if (STATUS.chill.bossSlow < STATUS.chill.slow) problems.push('a boss must not be slowed more than other enemies');
  return problems;
}
