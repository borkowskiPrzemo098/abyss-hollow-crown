import type { SkillId } from './skills';

/**
 * Upgrades of single skills, found during a run (offered next to the general
 * stat upgrades on level-ups and in chests).
 *
 * Every upgrade is data: a list of levels, and each level is the *total* set of
 * modifiers it grants at that level (not a step). The simulation understands each
 * modifier once (src/sim/simulation.ts, `mods()`), so a new upgrade is a new entry
 * here — no new code — as long as it is built from the modifiers below.
 * Nothing stacks without limit: an upgrade has as many levels as listed, and the
 * sum of all upgrades of one skill is clamped by MOD_CAPS.
 */
export interface SkillMods {
  /** +% damage of the skill's hits (negative = weaker). */
  damage: number;
  /** Adds this many × attack damage to the skill's hit (for skills that deal none at first). */
  flat: number;
  /** Shorter cooldown (fraction removed). */
  cooldown: number;
  /** +% area / reach. */
  radius: number;
  /** +% duration of timed effects. */
  duration: number;
  /** +% strength of the main effect of a buff or shield. */
  potency: number;
  /** Extra projectiles / marks / mines / targets. */
  projectiles: number;
  /** Extra enemies a shot passes through. */
  pierce: number;
  /** Explosion on hit, in × attack damage. */
  blast: number;
  /** Leaves burning / freezing ground: × attack damage per half second. */
  ground: number;
  /** Hits set enemies on fire: share of attack damage per second, for 3 s. */
  ignite: number;
  /** Hits slow enemies for this many seconds. */
  chill: number;
  /** +seconds of stun / freeze. */
  stun: number;
  /** +% damage against enemies below 35% health. */
  execute: number;
  /** +% damage against stunned, frozen or slowed enemies. */
  control: number;
  /** Each enemy hit takes this many seconds off the cooldown. */
  refund: number;
  /** When you are hit while the effect lasts, a blast of × attack damage. */
  retaliate: number;
  /** Repeats the effect later at this share of its power. */
  echo: number;
  /** Explosion when the effect ends, in × attack damage. */
  finale: number;
  /** Health restored per enemy hit, as a share of max health. */
  heal: number;
  /** Share of damage dealt that returns as health. */
  lifesteal: number;
  /** Mines left behind by every dodge (on the cooldown of SYNERGY.trap). */
  dodgeTrap: number;
}

export type ModKey = keyof SkillMods;

export const MOD_KEYS: readonly ModKey[] = [
  'damage', 'flat', 'cooldown', 'radius', 'duration', 'potency', 'projectiles', 'pierce', 'blast', 'ground', 'ignite',
  'chill', 'stun', 'execute', 'control', 'refund', 'retaliate', 'echo', 'finale', 'heal', 'lifesteal', 'dodgeTrap',
];

export const ZERO_MODS: Readonly<SkillMods> = Object.freeze(Object.fromEntries(MOD_KEYS.map((k) => [k, 0])) as unknown as SkillMods);

/** Upper (and lower) bound of the summed modifier of one skill. */
export const MOD_CAPS: Record<ModKey, readonly [number, number]> = {
  damage: [-0.5, 1],
  flat: [0, 3],
  cooldown: [0, 0.5],
  radius: [0, 1],
  duration: [0, 1.5],
  potency: [0, 1],
  projectiles: [0, 6],
  pierce: [0, 4],
  blast: [0, 3],
  ground: [0, 1],
  ignite: [0, 1],
  chill: [0, 4],
  stun: [0, 2],
  execute: [0, 1.5],
  control: [0, 1.5],
  refund: [0, 2],
  retaliate: [0, 3],
  echo: [0, 1],
  finale: [0, 5],
  heal: [0, 0.06],
  lifesteal: [0, 0.25],
  dodgeTrap: [0, 2],
};

/** Shared numbers of the upgrade system. */
export const SKILL_UPGRADE_RULES = {
  /** How many of the offered cards are skill upgrades (when any are available). */
  offer: { level: 1, chest: 2 },
  /** The shortest a cooldown may get, as a share of the base value (all sources together). */
  minCooldownShare: 0.3,
  executeBelow: 0.35,
  /** Total seconds a single cast can take off its own cooldown through `refund`. */
  refundCap: 3,
  blastRadius: 1.5,
  retaliateRadius: 2,
  retaliateCooldown: 0.5,
  groundTick: 0.5,
  groundLife: 3,
  /** Burning / freezing ground patches alive at once; the oldest fade first. */
  groundMax: 24,
  echoDelay: { sunder: 0.55, frost: 0.8 },
  hookDetonateDelay: 0.4,
  hookDetonateRadius: 1.9,
  /** Spacing of extra axes / shots, radians. */
  fan: 0.3,
} as const;

export interface SkillUpgradeDef {
  /** `<skill>.<name>`. */
  id: string;
  skill: SkillId;
  name: string;
  /** One sentence: what changes about the skill, in words. The numbers are printed from `levels`. */
  summary: string;
  /** Total modifiers at level 1, 2, … — the length is the number of levels. */
  levels: readonly Partial<SkillMods>[];
  /** Display names that fit this skill better than the generic ones (e.g. "Dodatkowe topory"). */
  names?: Partial<Record<ModKey, string>>;
  /** Relative chance to be offered. */
  weight?: number;
}

const U = (
  id: string,
  skill: SkillId,
  name: string,
  summary: string,
  levels: readonly Partial<SkillMods>[],
  names?: Partial<Record<ModKey, string>>,
  weight = 10,
): SkillUpgradeDef => ({ id: `${skill}.${id}`, skill, name, summary, levels, names, weight });

export const SKILL_UPGRADE_LIST: readonly SkillUpgradeDef[] = [
  // ───────── Strażnik Popiołu ─────────
  U('wide', 'sunder', 'Szeroki Wstrząs', 'Uderzenie obejmuje większy obszar.', [{ radius: 0.2 }, { radius: 0.4 }]),
  U('embers', 'sunder', 'Żarzące Szczeliny', 'Ziemia po uderzeniu pęka i pali wrogów przez 3 s.', [{ ground: 0.3 }, { ground: 0.5 }]),
  U('aftershock', 'sunder', 'Drugi Wstrząs', 'Po chwili ziemia uderza jeszcze raz w to samo miejsce.', [{ echo: 0.5 }, { echo: 0.8 }]),
  U('rush', 'sunder', 'Pośpiech', 'Odnawia się dużo szybciej, ale uderza słabiej.', [{ cooldown: 0.3, damage: -0.2 }]),

  U('reach', 'charge', 'Dłuższy Rozbieg', 'Szarża pokonuje większy dystans i jest szersza.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('trail', 'charge', 'Ognisty Ślad', 'Za tobą zostaje płonąca ścieżka.', [{ ground: 0.3 }, { ground: 0.5 }]),
  U('momentum', 'charge', 'Pęd Bitewny', 'Każdy staranowany wróg skraca odnowienie.', [{ refund: 0.6 }, { refund: 1 }]),
  U('ram', 'charge', 'Taran', 'Staranowani wrogowie są ogłuszeni dłużej.', [{ stun: 0.5 }, { stun: 1 }]),

  U('weight', 'crush', 'Ciężar Korony', 'Cios zadaje znacznie więcej obrażeń.', [{ damage: 0.25 }, { damage: 0.5 }]),
  U('verdict', 'crush', 'Wyrok', 'Dobija osłabionych: więcej obrażeń wobec wrogów poniżej 35% zdrowia.', [{ execute: 0.5 }, { execute: 1 }]),
  U('shock', 'crush', 'Fala Uderzeniowa', 'Trafiony wróg wybucha, raniąc tych obok.', [{ blast: 1 }, { blast: 1.8 }]),

  U('thunder', 'warcry', 'Grzmot', 'Okrzyk rani wszystkich, których odrzuca.', [{ flat: 1 }, { flat: 1.8 }]),
  U('terror', 'warcry', 'Przerażenie', 'Wrogowie są ogłuszeni dłużej.', [{ stun: 0.5 }, { stun: 1 }]),
  U('far', 'warcry', 'Daleki Okrzyk', 'Okrzyk sięga dalej.', [{ radius: 0.25 }, { radius: 0.5 }]),

  U('long', 'bastion', 'Długi Bastion', 'Osłona trwa dłużej.', [{ duration: 0.5 }, { duration: 1 }]),
  U('iron', 'bastion', 'Żelazna Wola', 'Osłona tłumi jeszcze więcej obrażeń.', [{ potency: 0.15 }, { potency: 0.3 }]),
  U('thorns', 'bastion', 'Kolce Bastionu', 'Gdy ktoś cię trafi pod osłoną, wokół ciebie wybucha fala.', [{ retaliate: 1 }, { retaliate: 1.8 }]),

  U('twin', 'axe', 'Bliźniacze Topory', 'Rzucasz kilka toporów naraz, w wachlarz.', [{ projectiles: 1 }, { projectiles: 2 }], { projectiles: 'Dodatkowe topory' }),
  U('molten', 'axe', 'Rozżarzony Topór', 'Topór podpala trafionych wrogów.', [{ ignite: 0.3 }, { ignite: 0.5 }]),
  U('splitter', 'axe', 'Łamacz', 'Topór wybucha w trafionym wrogu.', [{ blast: 0.8 }, { blast: 1.4 }]),

  U('reach', 'hook', 'Dłuższy Łańcuch', 'Łańcuch sięga dalej.', [{ radius: 0.2 }, { radius: 0.4 }]),
  U('crushing', 'hook', 'Zgniecenie', 'Zebrani wrogowie zostają zmiażdżeni wybuchem u twoich stóp.', [{ blast: 0.8 }, { blast: 1.4 }]),
  U('shackles', 'hook', 'Kajdany', 'Przyciągnięci wrogowie są ogłuszeni dłużej.', [{ stun: 0.6 }, { stun: 1.2 }]),

  U('long', 'banner', 'Trwały Sztandar', 'Sztandar stoi dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),
  U('wide', 'banner', 'Szeroki Sztandar', 'Sztandar obejmuje większy obszar.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('rally', 'banner', 'Okrzyk Zbiórki', 'Sztandar przyspiesza ataki i leczy mocniej.', [{ potency: 0.3 }, { potency: 0.6 }]),

  U('long', 'whirl', 'Długi Wir', 'Wir trwa dłużej.', [{ duration: 0.3 }, { duration: 0.6 }]),
  U('wide', 'whirl', 'Szeroki Wir', 'Ostrza sięgają dalej.', [{ radius: 0.2 }, { radius: 0.4 }]),
  U('sear', 'whirl', 'Rozżarzone Ostrza', 'Ostrza podpalają wrogów.', [{ ignite: 0.3 }, { ignite: 0.5 }]),
  U('fleet', 'whirl', 'Lekki Wir', 'Podczas wiru poruszasz się szybciej.', [{ potency: 0.3 }, { potency: 0.6 }]),

  U('greed', 'pact', 'Zachłanność', 'Więcej zadanych obrażeń wraca jako zdrowie.', [{ lifesteal: 0.05 }, { lifesteal: 0.1 }]),
  U('fury', 'pact', 'Szał Krwi', 'Pakt daje większy bonus do obrażeń.', [{ potency: 0.2 }, { potency: 0.4 }]),
  U('long', 'pact', 'Długi Pakt', 'Pakt trwa dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),

  // ───────── Wędrowiec Otchłani ─────────
  U('more', 'volley', 'Więcej Odłamków', 'Salwa rzuca więcej odłamków w szerszym wachlarzu.', [{ projectiles: 2 }, { projectiles: 4 }], { projectiles: 'Dodatkowe odłamki' }),
  U('pierce', 'volley', 'Przebijanie', 'Odłamki przechodzą przez kolejnych wrogów.', [{ pierce: 1 }, { pierce: 2 }]),
  U('burst', 'volley', 'Wybuchowe Odłamki', 'Odłamek wybucha w trafionym wrogu.', [{ blast: 0.45 }, { blast: 0.8 }]),
  U('fire', 'volley', 'Ogniste Odłamki', 'Odłamki podpalają wrogów.', [{ ignite: 0.3 }, { ignite: 0.5 }]),

  U('wide', 'seal', 'Szeroka Pieczęć', 'Pieczęć obejmuje większy obszar.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('deep', 'seal', 'Trwała Pieczęć', 'Pieczęć działa dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),
  U('drain', 'seal', 'Pożeranie', 'Każdy ruch pieczęci w wroga leczy cię.', [{ heal: 0.01 }, { heal: 0.02 }]),
  U('detonate', 'seal', 'Detonacja Pieczęci', 'Gdy pieczęć wygasa, wybucha.', [{ finale: 1.5 }, { finale: 2.5 }]),

  U('pierce', 'snipe', 'Przebijanie', 'Strzał przechodzi przez kolejnych wrogów.', [{ pierce: 1 }, { pierce: 2 }]),
  U('blast', 'snipe', 'Pocisk Burzący', 'Strzał wybucha w trafionym wrogu.', [{ blast: 1 }, { blast: 1.8 }]),
  U('twin', 'snipe', 'Podwójny Strzał', 'Oddajesz kolejne strzały w następnych wrogów.', [{ projectiles: 1 }, { projectiles: 2 }], { projectiles: 'Dodatkowe strzały' }),
  U('finisher', 'snipe', 'Dobijanie', 'Więcej obrażeń wobec wrogów poniżej 35% zdrowia.', [{ execute: 0.5 }, { execute: 1 }]),

  U('far', 'blink', 'Dalszy Krok', 'Skok jest dłuższy.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('nova', 'blink', 'Wybuch Przejścia', 'Wybuch w miejscu, z którego znikasz, i w miejscu, gdzie lądujesz.', [{ blast: 1 }, { blast: 1.8 }]),
  U('frost', 'blink', 'Mroźny Ślad', 'Miejsce startu zamarza i spowalnia wrogów.', [{ ground: 0.25, chill: 1.5 }, { ground: 0.4, chill: 2.5 }]),
  U('swift', 'blink', 'Lekki Krok', 'Odnawia się szybciej.', [{ cooldown: 0.2 }, { cooldown: 0.35 }]),

  U('big', 'ward', 'Gruba Bariera', 'Tarcza pochłania więcej obrażeń.', [{ potency: 0.3 }, { potency: 0.6 }]),
  U('long', 'ward', 'Trwała Bariera', 'Tarcza trzyma się dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),
  U('reflect', 'ward', 'Odbicie', 'Gdy tarcza przyjmie cios, wokół ciebie wybucha fala.', [{ retaliate: 1 }, { retaliate: 1.8 }]),

  U('wide', 'frost', 'Szeroki Szron', 'Pierścień sięga dalej.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('deep', 'frost', 'Głęboki Mróz', 'Wrogowie są zamrożeni dłużej.', [{ stun: 0.6 }, { stun: 1.2 }]),
  U('echo', 'frost', 'Echo Mrozu', 'Po chwili pierścień pulsuje drugi raz.', [{ echo: 0.5 }, { echo: 0.8 }]),
  U('shatter', 'frost', 'Kruszenie', 'Więcej obrażeń wobec zamrożonych i spowolnionych wrogów.', [{ control: 0.5 }, { control: 1 }]),

  U('twin', 'sentry', 'Podwójny Ogień', 'Wartownik strzela do kilku wrogów naraz.', [{ projectiles: 1 }, { projectiles: 2 }], { projectiles: 'Dodatkowe cele' }),
  U('long', 'sentry', 'Trwały Wartownik', 'Wartownik stoi dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),
  U('fire', 'sentry', 'Ognisty Kryształ', 'Pociski wartownika podpalają.', [{ ignite: 0.3 }, { ignite: 0.5 }]),
  U('overload', 'sentry', 'Samozniszczenie', 'Gdy znika, wybucha.', [{ finale: 2 }, { finale: 3.5 }]),

  U('cluster', 'mine', 'Pole Minowe', 'Kładziesz kilka min naraz, a limit rośnie o tyle samo.', [{ projectiles: 1 }, { projectiles: 2 }], { projectiles: 'Dodatkowe miny' }),
  U('big', 'mine', 'Duży Ładunek', 'Wybuch obejmuje większy obszar.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('trapdodge', 'mine', 'Mina w Przewrocie', 'Każdy unik zostawia za tobą minę (co 4 s).', [{ dodgeTrap: 1 }, { dodgeTrap: 2 }]),
  U('heavy', 'mine', 'Ciężki Ładunek', 'Wybuch zadaje więcej obrażeń.', [{ damage: 0.3 }, { damage: 0.6 }]),

  U('more', 'starfall', 'Gęsty Deszcz', 'Spada więcej gwiazd.', [{ projectiles: 2 }, { projectiles: 3 }], { projectiles: 'Dodatkowe gwiazdy' }),
  U('wide', 'starfall', 'Wielkie Gwiazdy', 'Każda gwiazda uderza w większym obszarze.', [{ radius: 0.25 }, { radius: 0.5 }]),
  U('ember', 'starfall', 'Żar Gwiazd', 'Gwiazdy zostawiają płonącą ziemię.', [{ ground: 0.3 }, { ground: 0.5 }]),
  U('quick', 'starfall', 'Szybki Deszcz', 'Odnawia się szybciej, ale gwiazdy są słabsze.', [{ cooldown: 0.25, damage: -0.15 }]),

  U('long', 'overload', 'Długie Przeciążenie', 'Przeciążenie trwa dłużej.', [{ duration: 0.4 }, { duration: 0.8 }]),
  U('power', 'overload', 'Mocniejszy Zryw', 'Strzelasz jeszcze szybciej.', [{ potency: 0.3 }, { potency: 0.6 }]),
  U('explosive', 'overload', 'Wybuchowe Strzały', 'Podczas Przeciążenia pociski wybuchają.', [{ blast: 0.4 }, { blast: 0.7 }]),
  U('fire', 'overload', 'Żar Przeciążenia', 'Podczas Przeciążenia pociski podpalają.', [{ ignite: 0.3 }, { ignite: 0.5 }]),
];

export const SKILL_UPGRADES: Readonly<Record<string, SkillUpgradeDef>> = Object.freeze(Object.fromEntries(SKILL_UPGRADE_LIST.map((u) => [u.id, u])));

export function isSkillUpgradeId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILL_UPGRADES, id);
}

export function upgradesOf(skill: SkillId): SkillUpgradeDef[] {
  return SKILL_UPGRADE_LIST.filter((u) => u.skill === skill);
}

export const maxLevel = (u: SkillUpgradeDef): number => u.levels.length;

/** Sums the modifiers of all upgrades of `skill` at the given levels, clamped by MOD_CAPS. */
export function resolveMods(skill: SkillId, levels: Readonly<Record<string, number>>): SkillMods {
  const out = { ...ZERO_MODS } as SkillMods;
  for (const u of SKILL_UPGRADE_LIST) {
    if (u.skill !== skill) continue;
    const given = levels[u.id];
    const lv = typeof given === 'number' && Number.isFinite(given) ? Math.min(maxLevel(u), Math.max(0, Math.floor(given))) : 0;
    if (lv === 0) continue;
    for (const [k, v] of Object.entries(u.levels[lv - 1]!) as [ModKey, number][]) out[k] += v;
  }
  for (const k of MOD_KEYS) out[k] = Math.min(MOD_CAPS[k][1], Math.max(MOD_CAPS[k][0], out[k]));
  return out;
}

// ───────────────────────────── text for the interface ─────────────────────────────

const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
const num = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('pl-PL');

/** How each modifier is named and printed. The value is always the total at that level. */
export const MOD_TEXT: Record<ModKey, { name: string; fmt: (v: number) => string }> = {
  damage: { name: 'Obrażenia', fmt: pct },
  flat: { name: 'Obrażenia bazowe', fmt: (v) => `+${num(v)}× ataku` },
  cooldown: { name: 'Odnowienie', fmt: (v) => `−${Math.round(v * 100)}%` },
  radius: { name: 'Obszar', fmt: pct },
  duration: { name: 'Czas trwania', fmt: pct },
  potency: { name: 'Siła efektu', fmt: pct },
  projectiles: { name: 'Dodatkowe pociski', fmt: (v) => `+${Math.round(v)}` },
  pierce: { name: 'Przebijanie', fmt: (v) => `+${Math.round(v)} wr.` },
  blast: { name: 'Wybuch przy trafieniu', fmt: (v) => `${num(v, 2)}× ataku` },
  ground: { name: 'Płonąca ziemia', fmt: (v) => `${num(v, 2)}× ataku co 0,5 s` },
  ignite: { name: 'Podpalenie', fmt: (v) => `${Math.round(v * 100)}% ataku / s przez 3 s` },
  chill: { name: 'Spowolnienie', fmt: (v) => `${num(v)} s` },
  stun: { name: 'Ogłuszenie', fmt: (v) => `+${num(v)} s` },
  execute: { name: 'Obrażenia poniżej 35% zdrowia wroga', fmt: pct },
  control: { name: 'Obrażenia wobec zamrożonych i ogłuszonych', fmt: pct },
  refund: { name: 'Skrócenie odnowienia za wroga', fmt: (v) => `−${num(v)} s` },
  retaliate: { name: 'Fala po otrzymanym ciosie', fmt: (v) => `${num(v, 2)}× ataku` },
  echo: { name: 'Powtórzenie', fmt: (v) => `${Math.round(v * 100)}% mocy` },
  finale: { name: 'Wybuch na końcu', fmt: (v) => `${num(v, 2)}× ataku` },
  heal: { name: 'Leczenie za trafienie', fmt: (v) => `${num(v * 100, 1)}% zdrowia` },
  lifesteal: { name: 'Kradzież życia', fmt: (v) => `+${Math.round(v * 100)}% zadanych obrażeń` },
  dodgeTrap: { name: 'Miny zostawiane przy uniku', fmt: (v) => `${Math.round(v)}` },
};

export interface ModLine {
  name: string;
  /** Value at the new level. */
  value: string;
  /** Value at the current level, when the upgrade already has one. */
  from?: string;
}

/** The lines shown on an upgrade card when going from level `from` (0 = new) to `to`. */
export function describeStep(u: SkillUpgradeDef, from: number, to: number): ModLine[] {
  const now = u.levels[to - 1] ?? {};
  const before = from > 0 ? (u.levels[from - 1] ?? {}) : {};
  const lines: ModLine[] = [];
  for (const k of MOD_KEYS) {
    const v = now[k];
    if (v === undefined) continue;
    const t = MOD_TEXT[k];
    const prev = before[k];
    lines.push({ name: u.names?.[k] ?? t.name, value: t.fmt(v), from: prev !== undefined ? t.fmt(prev) : undefined });
  }
  return lines;
}

// ───────────────────────────── validation ─────────────────────────────

/** Mistakes in the upgrade tables that would show up as a broken card or an effect that does nothing. */
export function validateSkillUpgradeData(skillIds: readonly SkillId[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const u of SKILL_UPGRADE_LIST) {
    if (seen.has(u.id)) problems.push(`${u.id}: duplicate id`);
    seen.add(u.id);
    if (!skillIds.includes(u.skill)) problems.push(`${u.id}: unknown skill ${u.skill}`);
    if (!u.id.startsWith(`${u.skill}.`)) problems.push(`${u.id}: id must start with "${u.skill}."`);
    if (!u.name || !u.summary) problems.push(`${u.id}: missing text`);
    if (u.levels.length < 1 || u.levels.length > 3) problems.push(`${u.id}: needs 1–3 levels, has ${u.levels.length}`);
    if (u.weight !== undefined && !(u.weight > 0)) problems.push(`${u.id}: weight must be positive`);
    u.levels.forEach((lv, i) => {
      const entries = Object.entries(lv);
      if (entries.length === 0) problems.push(`${u.id} level ${i + 1}: grants nothing`);
      for (const [k, v] of entries) {
        if (!MOD_KEYS.includes(k as ModKey)) problems.push(`${u.id} level ${i + 1}: unknown modifier ${k}`);
        else if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) problems.push(`${u.id} level ${i + 1}.${k}: must be a non-zero number`);
        else {
          const [lo, hi] = MOD_CAPS[k as ModKey];
          if (v > hi || v < lo) problems.push(`${u.id} level ${i + 1}.${k}: ${v} is outside the cap ${lo}..${hi}`);
          const prev = u.levels[i - 1]?.[k as ModKey];
          if (i > 0 && prev !== undefined && Math.abs(v) < Math.abs(prev)) problems.push(`${u.id} level ${i + 1}.${k}: level is weaker than the one before`);
        }
      }
      if (i > 0) for (const k of Object.keys(u.levels[i - 1]!)) if (!(k in lv)) problems.push(`${u.id} level ${i + 1}: drops ${k} from the previous level`);
    });
  }
  for (const s of skillIds) {
    const own = upgradesOf(s);
    if (own.length < 2) problems.push(`${s}: needs at least two upgrades, has ${own.length}`);
    // a skill must not be able to exceed any cap by taking everything
    const all: Record<string, number> = {};
    for (const u of own) all[u.id] = maxLevel(u);
    const raw = { ...ZERO_MODS } as SkillMods;
    for (const u of own) for (const [k, v] of Object.entries(u.levels[u.levels.length - 1] ?? {}) as [ModKey, number][]) raw[k] += v;
    for (const k of MOD_KEYS) if (raw[k] > MOD_CAPS[k][1] + 1e-9 || raw[k] < MOD_CAPS[k][0] - 1e-9) problems.push(`${s}: all upgrades together exceed the ${k} cap (${raw[k]})`);
  }
  return problems;
}
