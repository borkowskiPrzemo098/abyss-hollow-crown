/**
 * Active skills. Each hero chooses one of two before a run. Numbers are
 * multipliers of the hero's current attack damage, so upgrades scale skills too.
 */
export type SkillId = 'sunder' | 'charge' | 'volley' | 'seal';

interface SkillBase {
  id: SkillId;
  name: string;
  description: string;
  cooldown: number;
}

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

export type SkillDef = SunderDef | ChargeDef | VolleyDef | SealDef;

export const SKILLS: { sunder: SunderDef; charge: ChargeDef; volley: VolleyDef; seal: SealDef } = {
  sunder: {
    id: 'sunder',
    name: 'Rozłam',
    description: 'Uderzasz w ziemię wokół siebie: obrażenia, odrzut i ogłuszenie. Przerywa ataki wrogów.',
    cooldown: 7.5,
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
    distance: 4.2,
    duration: 0.32,
    width: 0.75,
    damageMult: 1.8,
    knockback: 6,
    stun: 0.5,
  },
  volley: {
    id: 'volley',
    name: 'Salwa Odłamków',
    description: 'Wachlarz siedmiu odłamków przebijających wrogów. Najlepsza na grupę z bliska.',
    cooldown: 6,
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
    radius: 2.3,
    duration: 4,
    tick: 0.5,
    damageMult: 0.5,
    slow: 0.5,
  },
};
