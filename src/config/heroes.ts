import type { SkillId } from './skills';

export type HeroId = 'warden' | 'wanderer';

export interface HeroClassDef {
  id: HeroId;
  name: string;
  role: string;
  description: string;
  maxHp: number;
  moveSpeed: number;
  armor: number;
  crit: { chance: number; mult: number };
  attack: {
    kind: 'melee' | 'bolt';
    damage: number;
    /** Time between attack starts. */
    interval: number;
    /** Wind-up before the hit lands / the bolt leaves. Dodging cancels it. */
    windup: number;
    /** Max centre-to-centre distance to start an attack. */
    range: number;
    /** Melee: extra reach while the swing is in progress. */
    landSlack: number;
    /** Melee: other enemies in this arc take cleave damage. */
    cleaveArcDeg: number;
    cleaveRatio: number;
    knockback: number;
    /** Bolt: projectile speed, radius and enemies it passes through. */
    boltSpeed: number;
    boltRadius: number;
    pierce: number;
  };
  dodge: { duration: number; distance: number; iframes: number; cooldown: number };
  skills: readonly [SkillId, SkillId];
}

export const HEROES: Record<HeroId, HeroClassDef> = {
  /** Melee anchor: tough, cleaves groups, wins by standing in the right place. */
  warden: {
    id: 'warden',
    name: 'Strażnik Popiołu',
    role: 'Walka w zwarciu',
    description: 'Ciężka zbroja i miecz, który tnie kilku wrogów naraz. Wybacza błędy, ale musi podejść blisko.',
    maxHp: 120,
    moveSpeed: 4.0,
    armor: 0.1,
    crit: { chance: 0.1, mult: 1.8 },
    attack: {
      kind: 'melee',
      damage: 14,
      interval: 0.72,
      windup: 0.11,
      range: 1.45,
      landSlack: 0.3,
      cleaveArcDeg: 80,
      cleaveRatio: 0.5,
      knockback: 1.6,
      boltSpeed: 0,
      boltRadius: 0,
      pierce: 0,
    },
    dodge: { duration: 0.3, distance: 2.6, iframes: 0.24, cooldown: 1.1 },
    skills: ['sunder', 'charge'],
  },
  /** Ranged skirmisher: fragile and fast, lives or dies by distance. */
  wanderer: {
    id: 'wanderer',
    name: 'Wędrowiec Otchłani',
    role: 'Walka na dystans',
    description: 'Ciska odłamkami z kryształowej laski. Szybki i kruchy — musi trzymać wrogów na dystans.',
    maxHp: 95,
    moveSpeed: 4.5,
    armor: 0,
    crit: { chance: 0.15, mult: 1.9 },
    attack: {
      kind: 'bolt',
      damage: 11,
      interval: 0.52,
      windup: 0.07,
      range: 4.6,
      landSlack: 0,
      cleaveArcDeg: 0,
      cleaveRatio: 0,
      knockback: 0.8,
      boltSpeed: 14,
      boltRadius: 0.18,
      pierce: 0,
    },
    dodge: { duration: 0.28, distance: 3.1, iframes: 0.22, cooldown: 0.9 },
    skills: ['volley', 'seal'],
  },
};
