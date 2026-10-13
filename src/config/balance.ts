/**
 * Every tunable gameplay number lives here. Units: distances in tiles,
 * times in seconds, speeds in tiles/second, angles in degrees.
 */

/** Fixed simulation step. Gameplay never depends on render frame rate. */
export const SIM_DT = 1 / 60;
/** Max sim steps per rendered frame (prevents a death spiral after a hitch). */
export const MAX_STEPS_PER_FRAME = 6;

export const HERO = {
  maxHp: 100,
  radius: 0.3,
  moveSpeed: 4.2,
  /** Share of a body overlap the hero resolves (enemies take the rest, weighted by mass). */
  mass: 1.2,
  damageReduction: 0,
  crit: { chance: 0.12, mult: 1.8 },
  attack: {
    damage: 14,
    /** Time between attack starts. */
    interval: 0.72,
    /** Swing wind-up before the hit lands. Dodging cancels it. */
    windup: 0.11,
    /** Max centre-to-centre distance to start an attack. */
    range: 1.45,
    /** Extra reach while the swing is in progress (forgives a target stepping back slightly). */
    landSlack: 0.3,
    /** Enemies inside this arc around the swing direction also take cleave damage. */
    cleaveArcDeg: 80,
    cleaveRatio: 0.5,
    /** Knockback impulse on regular enemies (tiles/s, decays by ENEMY_FRICTION). */
    knockback: 1.6,
    hitstop: 0.035,
    critHitstop: 0.065,
  },
  targeting: {
    /** Candidates are considered slightly beyond attack range so the marker appears before contact. */
    acquireMargin: 0.35,
    /** The current target is kept until it is this far beyond attack range. */
    leashMargin: 0.9,
    /** A new candidate must be this much closer (ratio) than the current target to steal focus... */
    switchRatio: 0.6,
    /** ...and only after the current lock has lasted this long. */
    minLock: 0.5,
  },
  dodge: {
    duration: 0.3,
    distance: 2.7,
    /** Invulnerability from the start of the roll. */
    iframes: 0.24,
    cooldown: 1.05,
    /** A press this early before the dodge is ready is remembered. */
    buffer: 0.15,
  },
  /** Mercy invulnerability after taking a hit, so overlapping attacks don't chain-delete the hero. */
  hurtIframes: 0.45,
} as const;

export const SKILLS = {
  sunder: {
    id: 'sunder',
    name: 'Rozłam',
    description: 'Uderzasz w ziemię. Odrzuca, ogłusza i przerywa ataki wrogów wokół ciebie.',
    /** Rooted cast before impact. Cannot be cancelled — it is a commitment. */
    castTime: 0.28,
    radius: 2.4,
    damageMult: 2.6,
    knockback: 9,
    stun: 1.1,
    cooldown: 7.5,
    buffer: 0.15,
    hitstop: 0.08,
  },
} as const;

/** Exponential decay rate of enemy knockback velocity (higher = shorter slide). */
export const ENEMY_FRICTION = 9;

export type StrikeShape =
  | { kind: 'cone'; radius: number; arcDeg: number }
  | { kind: 'circle'; offset: number; radius: number };

export interface EnemyDef {
  name: string;
  maxHp: number;
  radius: number;
  speed: number;
  mass: number;
  /** 0 = flinches and slides freely, 1 = immovable and never flinches. */
  poise: number;
  /** Multiplier on stun durations. */
  stunTaken: number;
  spawnTime: number;
  attack: {
    /** Distance at which the enemy commits to an attack. */
    triggerRange: number;
    windup: number;
    /** Fraction of the wind-up during which aim still follows the hero; then it locks. */
    trackFraction: number;
    /** Max aim turn speed while tracking (deg/s). */
    turnRate: number;
    recovery: number;
    cooldown: number;
    damage: number;
    shape: StrikeShape;
  };
}

export type EnemyKind = 'thrall' | 'brute';

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  /** Fast, fragile melee swarmer. Telegraphs a short claw cone. */
  thrall: {
    name: 'Wydrążony',
    maxHp: 42,
    radius: 0.32,
    speed: 2.6,
    mass: 1,
    poise: 0,
    stunTaken: 1,
    spawnTime: 0.9,
    attack: {
      triggerRange: 1.2,
      windup: 0.6,
      trackFraction: 0.35,
      turnRate: 240,
      recovery: 0.6,
      cooldown: 1.8,
      damage: 10,
      shape: { kind: 'cone', radius: 1.6, arcDeg: 100 },
    },
  },
  /** Slow, armoured bruiser. Long wind-up maul slam that hurts. Doesn't flinch. */
  brute: {
    name: 'Popielny Kolos',
    maxHp: 170,
    radius: 0.5,
    speed: 1.55,
    mass: 3.5,
    poise: 0.8,
    stunTaken: 0.6,
    spawnTime: 1.2,
    attack: {
      triggerRange: 1.75,
      windup: 1.0,
      trackFraction: 0.3,
      turnRate: 120,
      recovery: 1.1,
      cooldown: 2.6,
      damage: 28,
      shape: { kind: 'circle', offset: 1.25, radius: 1.2 },
    },
  },
};

export const WAVES = {
  /** Pause between a cleared wave and the next spawn. */
  breakTime: 2.6,
  /** Enemies never spawn closer than this to the hero. */
  minSpawnDistance: 4.5,
  /** Per-wave HP growth beyond wave 3, so endless play keeps escalating. */
  hpGrowthPerWave: 0.08,
};

/** Enemy roster for a wave number (1-based). Hand-tuned early, then formulaic. */
export function waveComposition(wave: number): EnemyKind[] {
  const table: EnemyKind[][] = [
    ['thrall', 'thrall', 'thrall'],
    ['thrall', 'thrall', 'thrall', 'thrall', 'thrall'],
    ['brute', 'thrall', 'thrall', 'thrall'],
    ['brute', 'thrall', 'thrall', 'thrall', 'thrall', 'thrall'],
    ['brute', 'brute', 'thrall', 'thrall', 'thrall', 'thrall'],
  ];
  const fixed = table[wave - 1];
  if (fixed) return [...fixed];
  const brutes = Math.min(4, 2 + Math.floor((wave - 5) / 2));
  const thralls = Math.min(12, 5 + (wave - 5));
  return [...Array<EnemyKind>(brutes).fill('brute'), ...Array<EnemyKind>(thralls).fill('thrall')];
}
