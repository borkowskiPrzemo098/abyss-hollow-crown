/**
 * Core tunables shared by every hero and enemy. Units: distances in tiles,
 * times in seconds, speeds in tiles/second, angles in degrees.
 * Hero classes: heroes.ts · skills: skills.ts · upgrades: upgrades.ts ·
 * XP / ash / sanctuary: progression.ts · dungeon layout: dungeon.ts
 */

/** Fixed simulation step. Gameplay never depends on render frame rate. */
export const SIM_DT = 1 / 60;
/** Max sim steps per rendered frame (prevents a death spiral after a hitch). */
export const MAX_STEPS_PER_FRAME = 6;

export const COMMON = {
  heroRadius: 0.3,
  /** Share of a body overlap the hero resolves (enemies take the rest, weighted by mass). */
  heroMass: 1.2,
  /** Mercy invulnerability after taking a hit, so overlapping attacks don't chain-delete the hero. */
  hurtIframes: 0.45,
  /** A dodge / skill press this early before it is ready is remembered. */
  inputBuffer: 0.15,
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
  /**
   * Hit-stop (world freeze) gives weight to big hits. Regular auto-attacks get none:
   * they land every ~0.7 s and freezing on each one made walking stutter.
   */
  hitstop: { crit: 0.04, skill: 0.07 },
  /**
   * Walking speed is evened out across screen directions. In a 2:1 isometric view a
   * world tile is 45 px wide on screen but only 23 px tall, so a constant world speed
   * looks twice as fast sideways as up/down. Movement is scaled by
   * (screenLength / axisLength) ^ -isoCompensation; 0 = none, 1 = equal screen speed.
   * Applied identically to the hero and enemies, so chases stay fair.
   */
  isoCompensation: 0.7,
} as const;

/** Exponential decay rate of enemy knockback velocity (higher = shorter slide). */
export const ENEMY_FRICTION = 9;

export type StrikeShape =
  | { kind: 'cone'; radius: number; arcDeg: number }
  | { kind: 'circle'; offset: number; radius: number }
  /** A projectile fired along the locked aim; the telegraph is a line of `range` tiles. */
  | { kind: 'bolt'; speed: number; radius: number; range: number };

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
  xp: number;
  ash: number;
  /** Ranged enemies try to hold this distance band from the hero instead of closing in. */
  keepAway?: { min: number; max: number };
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

export type EnemyKind = 'thrall' | 'brute' | 'acolyte';

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
    xp: 3,
    ash: 1,
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
    xp: 10,
    ash: 4,
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
  /** Fragile caster. Keeps its distance and lobs slow embers along a telegraphed line. */
  acolyte: {
    name: 'Akolita Popiołu',
    maxHp: 34,
    radius: 0.3,
    speed: 2.1,
    mass: 0.9,
    poise: 0,
    stunTaken: 1.2,
    spawnTime: 1.0,
    xp: 5,
    ash: 2,
    keepAway: { min: 3.2, max: 5.5 },
    attack: {
      triggerRange: 6.5,
      windup: 0.85,
      trackFraction: 0.45,
      turnRate: 160,
      recovery: 0.5,
      cooldown: 2.4,
      damage: 11,
      shape: { kind: 'bolt', speed: 6.5, radius: 0.24, range: 9 },
    },
  },
};
