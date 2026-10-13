import type { HeroId } from './heroes';

/**
 * Active skills. Every class has ten; the player wears up to three at once
 * (SKILL_RULES.maxSlots). Skills are unlocked by the hero's lasting progress
 * (UnlockReq), never bought. Numbers marked "mult" are multipliers of the
 * hero's current attack damage, so upgrades and gear scale skills too.
 */
export type SkillId =
  // Strażnik Popiołu
  | 'sunder'
  | 'charge'
  | 'crush'
  | 'bastion'
  | 'warcry'
  | 'axe'
  | 'hook'
  | 'banner'
  | 'whirl'
  | 'pact'
  // Wędrowiec Otchłani
  | 'volley'
  | 'seal'
  | 'snipe'
  | 'blink'
  | 'ward'
  | 'frost'
  | 'sentry'
  | 'mine'
  | 'starfall'
  | 'overload';

/** What a skill is for. Each class covers a spread of these, not ten flavours of one attack. */
export type SkillRole = 'aoe' | 'mobility' | 'single' | 'projectile' | 'defense' | 'control' | 'trap' | 'summon' | 'sustain' | 'buff' | 'support';

/** Lasting per-hero progress that gates skills. Filled in by finished runs. */
export interface HeroProgress {
  runs: number;
  kills: number;
  /** Deepest floor reached. */
  bestFloor: number;
  wins: number;
}

export type UnlockReq = { type: 'start' } | { type: 'runs' | 'kills' | 'floor' | 'wins'; n: number };

export const SKILL_RULES = {
  /** Skills worn at once. */
  maxSlots: 3,
  /** After any cast, every slot is locked for this long (stops three buttons firing in one frame). Longer than the input buffer, so a press made in the same instant is dropped, but one made a beat later still fires. */
  globalCooldown: 0.2,
  /** Skills that do nothing without an enemy nearby refuse to fire (and keep their cooldown). */
  needsTarget: ['crush', 'snipe', 'starfall'] as readonly SkillId[],
} as const;

interface SkillBase {
  id: SkillId;
  name: string;
  description: string;
  cooldown: number;
  hero: HeroId;
  role: SkillRole;
  unlock: UnlockReq;
}

// ─────────────── Strażnik Popiołu ───────────────

export interface SunderDef extends SkillBase {
  id: 'sunder';
  /** Rooted cast before impact. Cannot be cancelled — it is a commitment. */
  castTime: number;
  radius: number;
  damageMult: number;
  knockback: number;
  stun: number;
}

export interface ChargeDef extends SkillBase {
  id: 'charge';
  distance: number;
  duration: number;
  /** Width of the path that hits enemies (tiles, each side of the centre line). */
  width: number;
  damageMult: number;
  knockback: number;
  stun: number;
}

/** One enormous blow on the nearest enemy in reach. */
export interface CrushDef extends SkillBase {
  id: 'crush';
  castTime: number;
  reach: number;
  damageMult: number;
  knockback: number;
  stun: number;
  /** Share of the cooldown given back when the target is gone by the time the blow lands. */
  missRefund: number;
}

/** A timed wall of damage reduction. */
export interface BastionDef extends SkillBase {
  id: 'bastion';
  duration: number;
  /** Share of incoming damage removed on top of armour. */
  reduction: number;
}

/** Shoves everything away and breaks wind-ups: breathing room, no damage. */
export interface WarcryDef extends SkillBase {
  id: 'warcry';
  radius: number;
  knockback: number;
  stun: number;
}

/** A heavy axe that flies in a line and goes through several enemies. */
export interface AxeDef extends SkillBase {
  id: 'axe';
  damageMult: number;
  pierce: number;
  speed: number;
  range: number;
  size: number;
}

/** Drags nearby enemies into a pile at your feet. */
export interface HookDef extends SkillBase {
  id: 'hook';
  radius: number;
  /** Enemies end up about this far from you. */
  stopAt: number;
  damageMult: number;
  stun: number;
}

/** A standard planted in the floor: fight beside it for faster attacks and slow healing. */
export interface BannerDef extends SkillBase {
  id: 'banner';
  radius: number;
  duration: number;
  /** Extra attack speed while standing inside. */
  haste: number;
  /** Share of max HP restored per second while inside. */
  regen: number;
}

/** A spinning storm of blades around you that you can walk through the room with. */
export interface WhirlDef extends SkillBase {
  id: 'whirl';
  duration: number;
  tick: number;
  radius: number;
  damageMult: number;
  /** Walking speed multiplier while it lasts. */
  moveMult: number;
}

/** Pay blood, deal more and drain it back. */
export interface PactDef extends SkillBase {
  id: 'pact';
  duration: number;
  /** Share of max HP paid on casting (never lethal). */
  selfCost: number;
  damageBonus: number;
  /** Share of damage dealt returned as health. */
  lifesteal: number;
}

// ─────────────── Wędrowiec Otchłani ───────────────

export interface VolleyDef extends SkillBase {
  id: 'volley';
  bolts: number;
  arcDeg: number;
  damageMult: number;
  pierce: number;
  speed: number;
  range: number;
}

export interface SealDef extends SkillBase {
  id: 'seal';
  radius: number;
  duration: number;
  tick: number;
  damageMult: number;
  /** Enemies inside move at this fraction of their speed. */
  slow: number;
}

/** One fast, hard-hitting piercing shot. */
export interface SnipeDef extends SkillBase {
  id: 'snipe';
  damageMult: number;
  pierce: number;
  speed: number;
  range: number;
  size: number;
}

/** Instant hop along the aim line, untouchable for a moment. */
export interface BlinkDef extends SkillBase {
  id: 'blink';
  distance: number;
  iframes: number;
}

/** A shield that soaks damage for a while. */
export interface WardDef extends SkillBase {
  id: 'ward';
  duration: number;
  /** Absorbed damage = flat + hpFraction × max HP. */
  flat: number;
  hpFraction: number;
}

/** A freezing ring: damage and a hard freeze around you. */
export interface FrostDef extends SkillBase {
  id: 'frost';
  radius: number;
  freeze: number;
  damageMult: number;
}

/** A crystal turret that shoots the nearest enemy while it lasts. */
export interface SentryDef extends SkillBase {
  id: 'sentry';
  duration: number;
  range: number;
  interval: number;
  damageMult: number;
  speed: number;
}

/** A hidden charge that blows up when an enemy walks over it. */
export interface MineDef extends SkillBase {
  id: 'mine';
  /** Blast radius. */
  radius: number;
  /** Enemy distance that sets it off, once armed. */
  trigger: number;
  arm: number;
  duration: number;
  damageMult: number;
  stun: number;
  /** Mines alive at once; the oldest fizzles out when a new one is laid. */
  max: number;
}

/** Marks several enemies; after a short delay a star falls on each. */
export interface StarfallDef extends SkillBase {
  id: 'starfall';
  count: number;
  range: number;
  delay: number;
  radius: number;
  damageMult: number;
}

/** A burst of speed: shoots faster and pierces further. */
export interface OverloadDef extends SkillBase {
  id: 'overload';
  duration: number;
  haste: number;
  pierce: number;
}

export type SkillDef =
  | SunderDef
  | ChargeDef
  | CrushDef
  | BastionDef
  | WarcryDef
  | AxeDef
  | HookDef
  | BannerDef
  | WhirlDef
  | PactDef
  | VolleyDef
  | SealDef
  | SnipeDef
  | BlinkDef
  | WardDef
  | FrostDef
  | SentryDef
  | MineDef
  | StarfallDef
  | OverloadDef;

type SkillRecord = { [K in SkillId]: Extract<SkillDef, { id: K }> };

export const SKILLS: SkillRecord = {
  // ── Strażnik Popiołu ──
  sunder: {
    id: 'sunder',
    name: 'Rozłam',
    description: 'Uderzasz w ziemię wokół siebie: obrażenia, odrzut i ogłuszenie. Przerywa ataki wrogów.',
    cooldown: 7.5,
    hero: 'warden',
    role: 'aoe',
    unlock: { type: 'start' },
    castTime: 0.28,
    radius: 2.4,
    damageMult: 2.6,
    knockback: 9,
    stun: 1.1,
  },
  charge: {
    id: 'charge',
    name: 'Szarża',
    description: 'Taranujesz wszystko na linii ruchu. Nietykalny w trakcie, odrzuca i krótko ogłusza.',
    cooldown: 6,
    hero: 'warden',
    role: 'mobility',
    unlock: { type: 'start' },
    distance: 4.2,
    duration: 0.32,
    width: 0.75,
    damageMult: 1.8,
    knockback: 6,
    stun: 0.5,
  },
  crush: {
    id: 'crush',
    name: 'Miażdżący Cios',
    description: 'Wolny, potężny cios w najbliższego wroga. Nie działa, gdy nikogo nie ma w zasięgu.',
    cooldown: 8,
    hero: 'warden',
    role: 'single',
    unlock: { type: 'runs', n: 2 },
    castTime: 0.4,
    reach: 2.6,
    damageMult: 4.5,
    knockback: 6,
    stun: 0.5,
    missRefund: 0.5,
  },
  warcry: {
    id: 'warcry',
    name: 'Okrzyk Wojny',
    description: 'Odrzuca wszystkich wokół i przerywa ich ataki. Nie rani — daje chwilę oddechu.',
    cooldown: 10,
    hero: 'warden',
    role: 'control',
    unlock: { type: 'kills', n: 60 },
    radius: 4.4,
    knockback: 12,
    stun: 0.4,
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion',
    description: 'Przez 4 s przyjmujesz o 55% mniej obrażeń.',
    cooldown: 14,
    hero: 'warden',
    role: 'defense',
    unlock: { type: 'floor', n: 2 },
    duration: 4,
    reduction: 0.55,
  },
  axe: {
    id: 'axe',
    name: 'Rzut Toporem',
    description: 'Ciężki topór leci po linii i przebija do pięciu wrogów.',
    cooldown: 7,
    hero: 'warden',
    role: 'projectile',
    unlock: { type: 'runs', n: 4 },
    damageMult: 2.4,
    pierce: 4,
    speed: 13,
    range: 8.5,
    size: 0.4,
  },
  hook: {
    id: 'hook',
    name: 'Łańcuch Popiołu',
    description: 'Przyciąga wrogów z odległości do twoich stóp i na chwilę ogłusza. Dobrze łączy się z Rozłamem.',
    cooldown: 11,
    hero: 'warden',
    role: 'control',
    unlock: { type: 'kills', n: 150 },
    radius: 5.5,
    stopAt: 1.2,
    damageMult: 0.8,
    stun: 0.5,
  },
  banner: {
    id: 'banner',
    name: 'Sztandar Popiołu',
    description: 'Wbijasz sztandar: stojąc przy nim atakujesz szybciej i powoli odzyskujesz zdrowie.',
    cooldown: 16,
    hero: 'warden',
    role: 'support',
    unlock: { type: 'floor', n: 3 },
    radius: 2.8,
    duration: 8,
    haste: 0.3,
    regen: 0.02,
  },
  whirl: {
    id: 'whirl',
    name: 'Wir Ostrzy',
    description: 'Przez 2,4 s kręcisz się, tnąc wszystko wokół. Możesz się przy tym poruszać, ale wolniej.',
    cooldown: 11,
    hero: 'warden',
    role: 'sustain',
    unlock: { type: 'kills', n: 350 },
    duration: 2.4,
    tick: 0.3,
    radius: 1.9,
    damageMult: 0.6,
    moveMult: 0.65,
  },
  pact: {
    id: 'pact',
    name: 'Krwawy Pakt',
    description: 'Płacisz 12% zdrowia (nigdy śmiertelnie). Przez 7 s zadajesz o 45% więcej i odzyskujesz 8% zadanych obrażeń.',
    cooldown: 16,
    hero: 'warden',
    role: 'buff',
    unlock: { type: 'wins', n: 1 },
    duration: 7,
    selfCost: 0.12,
    damageBonus: 0.45,
    lifesteal: 0.08,
  },

  // ── Wędrowiec Otchłani ──
  volley: {
    id: 'volley',
    name: 'Salwa Odłamków',
    description: 'Wachlarz siedmiu odłamków przebijających wrogów. Najlepsza na grupę z bliska.',
    cooldown: 6,
    hero: 'wanderer',
    role: 'projectile',
    unlock: { type: 'start' },
    bolts: 7,
    arcDeg: 70,
    damageMult: 1.2,
    pierce: 1,
    speed: 15,
    range: 7,
  },
  seal: {
    id: 'seal',
    name: 'Pieczęć Pustki',
    description: 'Kładziesz pieczęć pod stopami: spowalnia wrogów o połowę i rani ich co chwilę przez 4 s.',
    cooldown: 9,
    hero: 'wanderer',
    role: 'aoe',
    unlock: { type: 'start' },
    radius: 2.3,
    duration: 4,
    tick: 0.5,
    damageMult: 0.5,
    slow: 0.5,
  },
  snipe: {
    id: 'snipe',
    name: 'Strzał Przeszywający',
    description: 'Jeden błyskawiczny, mocny pocisk w najbliższego wroga. Przebija do czterech celów.',
    cooldown: 8,
    hero: 'wanderer',
    role: 'single',
    unlock: { type: 'runs', n: 2 },
    damageMult: 4.2,
    pierce: 3,
    speed: 26,
    range: 11,
    size: 0.24,
  },
  blink: {
    id: 'blink',
    name: 'Krok Otchłani',
    description: 'Natychmiast przeskakujesz o prawie pięć kroków w kierunku ruchu i na moment stajesz się nietykalny.',
    cooldown: 7,
    hero: 'wanderer',
    role: 'mobility',
    unlock: { type: 'kills', n: 60 },
    distance: 4.8,
    iframes: 0.35,
  },
  ward: {
    id: 'ward',
    name: 'Bariera Pustki',
    description: 'Tarcza pochłania obrażenia przez 8 s lub do wyczerpania. Wielkość zależy od twojego zdrowia.',
    cooldown: 16,
    hero: 'wanderer',
    role: 'defense',
    unlock: { type: 'floor', n: 2 },
    duration: 8,
    flat: 20,
    hpFraction: 0.25,
  },
  frost: {
    id: 'frost',
    name: 'Szron Otchłani',
    description: 'Mroźny pierścień wokół ciebie: obrażenia i zamrożenie wrogów na prawie dwie sekundy.',
    cooldown: 11,
    hero: 'wanderer',
    role: 'control',
    unlock: { type: 'runs', n: 4 },
    radius: 3.2,
    freeze: 1.8,
    damageMult: 0.9,
  },
  sentry: {
    id: 'sentry',
    name: 'Kryształowy Wartownik',
    description: 'Stawiasz wieżyczkę, która przez 9 s strzela do najbliższego wroga.',
    cooldown: 14,
    hero: 'wanderer',
    role: 'summon',
    unlock: { type: 'kills', n: 150 },
    duration: 9,
    range: 6.5,
    interval: 0.7,
    damageMult: 0.8,
    speed: 15,
  },
  mine: {
    id: 'mine',
    name: 'Mina Pustki',
    description: 'Zostawiasz ukryty ładunek, który wybucha, gdy wróg podejdzie. Maksymalnie trzy naraz.',
    cooldown: 8,
    hero: 'wanderer',
    role: 'trap',
    unlock: { type: 'floor', n: 3 },
    radius: 2.2,
    trigger: 1.1,
    arm: 0.7,
    duration: 25,
    damageMult: 3.4,
    stun: 0.6,
    max: 3,
  },
  starfall: {
    id: 'starfall',
    name: 'Gwiezdny Deszcz',
    description: 'Oznacza do pięciu wrogów w pobliżu; po chwili na każdego spada gwiazda.',
    cooldown: 12,
    hero: 'wanderer',
    role: 'aoe',
    unlock: { type: 'kills', n: 350 },
    count: 5,
    range: 8,
    delay: 0.7,
    radius: 1.5,
    damageMult: 2.2,
  },
  overload: {
    id: 'overload',
    name: 'Przeciążenie',
    description: 'Przez 6 s strzelasz o połowę szybciej, a każdy pocisk przebija jeszcze jednego wroga.',
    cooldown: 18,
    hero: 'wanderer',
    role: 'buff',
    unlock: { type: 'wins', n: 1 },
    duration: 6,
    haste: 0.5,
    pierce: 1,
  },
};

/** The ten skills of each class, in the order shown to the player (starters first, then by how soon they unlock). */
export const SKILL_ORDER: Record<HeroId, readonly SkillId[]> = {
  warden: ['sunder', 'charge', 'crush', 'warcry', 'bastion', 'axe', 'hook', 'banner', 'whirl', 'pact'],
  wanderer: ['volley', 'seal', 'snipe', 'blink', 'ward', 'frost', 'sentry', 'mine', 'starfall', 'overload'],
};

export const SKILLS_PER_CLASS = 10;

export const NO_PROGRESS: HeroProgress = { runs: 0, kills: 0, bestFloor: 0, wins: 0 };

/** The skills a hero may start with: unlocked from the first launch. */
export function starterSkills(hero: HeroId): SkillId[] {
  return SKILL_ORDER[hero].filter((id) => SKILLS[id].unlock.type === 'start');
}

/**
 * Checks the skill tables for mistakes that would otherwise show up as a
 * broken menu or an unreachable skill. Returns human-readable problems (empty = fine).
 */
export function validateSkillData(): string[] {
  const problems: string[] = [];
  const ids = Object.keys(SKILLS) as SkillId[];
  const listed = new Set<SkillId>();
  for (const hero of Object.keys(SKILL_ORDER) as HeroId[]) {
    const order = SKILL_ORDER[hero];
    if (order.length !== SKILLS_PER_CLASS) problems.push(`${hero}: ${order.length} skills, expected ${SKILLS_PER_CLASS}`);
    if (new Set(order).size !== order.length) problems.push(`${hero}: duplicate skill in SKILL_ORDER`);
    if (starterSkills(hero).length < 2) problems.push(`${hero}: needs at least two starter skills`);
    const roles = new Set(order.map((id) => SKILLS[id]?.role));
    if (roles.size < 7) problems.push(`${hero}: only ${roles.size} distinct roles — skills are too alike`);
    for (const id of order) {
      listed.add(id);
      const s = SKILLS[id];
      if (!s) problems.push(`${hero}: unknown skill ${id}`);
      else if (s.hero !== hero) problems.push(`${id}: belongs to ${s.hero} but is listed for ${hero}`);
    }
  }
  for (const id of ids) {
    const s = SKILLS[id];
    if (!listed.has(id)) problems.push(`${id}: not in SKILL_ORDER`);
    if (s.id !== id) problems.push(`${id}: id mismatch (${s.id})`);
    if (!s.name || !s.description) problems.push(`${id}: missing text`);
    if (!(s.cooldown > 0)) problems.push(`${id}: cooldown must be positive`);
    if (s.unlock.type !== 'start' && !(s.unlock.n > 0)) problems.push(`${id}: unlock threshold must be positive`);
    for (const [k, v] of Object.entries(s)) if (typeof v === 'number' && !(Number.isFinite(v) && v >= 0)) problems.push(`${id}.${k}: must be a finite number ≥ 0`);
  }
  for (const id of SKILL_RULES.needsTarget) if (!SKILLS[id]) problems.push(`needsTarget: unknown skill ${id}`);
  if (SKILL_RULES.maxSlots < 1) problems.push('maxSlots must be at least 1');
  return problems;
}
