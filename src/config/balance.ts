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
  | { kind: 'bolt'; speed: number; radius: number; range: number }
  /** The attacker itself dashes along the locked aim; the telegraph is the dash lane. */
  | { kind: 'charge'; distance: number; width: number; speed: number }
  /** A ring of projectiles fired in every direction. */
  | { kind: 'radial'; bolts: number; speed: number; radius: number; range: number }
  /** Delayed blasts scattered around the hero; each shows its circle until it lands. */
  | { kind: 'meteors'; count: number; radius: number; spread: number; delay: number }
  /** One delayed blast on the hero's position (a lobbed bomb). */
  | { kind: 'lob'; radius: number; delay: number }
  /** Calls minions; their spawn sigils are the telegraph. */
  | { kind: 'summon'; kinds: readonly EnemyKind[] };

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
  /** Regular enemies have one attack; bosses rotate through their phase lists instead. */
  attack: EnemyAttack;
  boss?: BossDef;
  /** Visual scale of the rig. */
  scale?: number;
}

export type EnemyKind = 'thrall' | 'brute' | 'acolyte' | 'hound' | 'pyre' | 'bossCrypt' | 'bossFrost' | 'bossKing';

export interface EnemyAttack {
  /** Distance at which the enemy commits to this attack. */
  triggerRange: number;
  windup: number;
  trackFraction: number;
  turnRate: number;
  recovery: number;
  cooldown: number;
  damage: number;
  shape: StrikeShape;
}

export interface BossDef {
  title: string;
  /** Attack rotations for phase 1 and phase 2 (below half health). */
  phases: readonly [readonly EnemyAttack[], readonly EnemyAttack[]];
  /** Invulnerable roar when phase 2 begins. */
  roar: number;
}

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
  /** Frost hound (Lodowe Groby+): telegraphs a lane, then charges through it. */
  hound: {
    name: 'Ogar Szronu',
    maxHp: 58,
    radius: 0.36,
    speed: 2.9,
    mass: 1.4,
    poise: 0.2,
    stunTaken: 1,
    spawnTime: 0.9,
    xp: 6,
    ash: 2,
    attack: {
      triggerRange: 4.6,
      windup: 0.7,
      trackFraction: 0.35,
      turnRate: 200,
      recovery: 0.7,
      cooldown: 2.2,
      damage: 14,
      shape: { kind: 'charge', distance: 5, width: 0.55, speed: 13 },
    },
  },
  /** Pyre-keeper (Kuźnie Otchłani): keeps away and lobs fire bombs onto the hero's spot. */
  pyre: {
    name: 'Ogniomistrz',
    maxHp: 40,
    radius: 0.32,
    speed: 2.0,
    mass: 1,
    poise: 0,
    stunTaken: 1.1,
    spawnTime: 1.0,
    xp: 6,
    ash: 2,
    keepAway: { min: 3.5, max: 6.5 },
    attack: {
      triggerRange: 7.5,
      windup: 0.55,
      trackFraction: 1,
      turnRate: 360,
      recovery: 0.6,
      cooldown: 2.8,
      damage: 16,
      shape: { kind: 'lob', radius: 1.25, delay: 1.0 },
    },
  },
  /** Floor 1 boss: a giant in crypt armour. Sweeps, slams and charges; later calls the dead. */
  bossCrypt: {
    name: 'Strażnik Krypt',
    maxHp: 1100,
    radius: 0.78,
    speed: 1.75,
    mass: 40,
    poise: 1,
    stunTaken: 0.25,
    spawnTime: 1.6,
    xp: 60,
    ash: 30,
    scale: 1.7,
    attack: {
      triggerRange: 2.4,
      windup: 0.9,
      trackFraction: 0.3,
      turnRate: 120,
      recovery: 0.9,
      cooldown: 0.6,
      damage: 22,
      shape: { kind: 'cone', radius: 2.5, arcDeg: 140 },
    },
    boss: {
      title: 'Ten, który pilnuje zejścia',
      roar: 1.4,
      phases: [
        [
          { triggerRange: 2.4, windup: 0.9, trackFraction: 0.3, turnRate: 120, recovery: 0.9, cooldown: 0.6, damage: 22, shape: { kind: 'cone', radius: 2.5, arcDeg: 140 } },
          { triggerRange: 2.6, windup: 1.1, trackFraction: 0.25, turnRate: 100, recovery: 1.2, cooldown: 0.6, damage: 30, shape: { kind: 'circle', offset: 1.4, radius: 1.6 } },
          { triggerRange: 7, windup: 0.95, trackFraction: 0.4, turnRate: 140, recovery: 1.3, cooldown: 0.8, damage: 26, shape: { kind: 'charge', distance: 6.5, width: 0.85, speed: 11 } },
        ],
        [
          { triggerRange: 2.4, windup: 0.75, trackFraction: 0.3, turnRate: 140, recovery: 0.7, cooldown: 0.4, damage: 24, shape: { kind: 'cone', radius: 2.6, arcDeg: 150 } },
          { triggerRange: 9, windup: 0.9, trackFraction: 0, turnRate: 0, recovery: 1, cooldown: 0.6, damage: 12, shape: { kind: 'radial', bolts: 10, speed: 5, radius: 0.26, range: 9 } },
          { triggerRange: 7, windup: 0.8, trackFraction: 0.4, turnRate: 160, recovery: 1.1, cooldown: 0.6, damage: 28, shape: { kind: 'charge', distance: 7, width: 0.85, speed: 12 } },
          { triggerRange: 20, windup: 0.8, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.6, damage: 0, shape: { kind: 'summon', kinds: ['thrall', 'thrall', 'thrall'] } },
        ],
      ],
    },
  },
  /** Floor 2 boss: a frost queen who fights from a distance with shard rings and falling ice. */
  bossFrost: {
    name: 'Królowa Szronu',
    maxHp: 1250,
    radius: 0.6,
    speed: 2.0,
    mass: 40,
    poise: 1,
    stunTaken: 0.25,
    spawnTime: 1.6,
    xp: 80,
    ash: 40,
    scale: 1.6,
    keepAway: { min: 3.5, max: 6.5 },
    attack: {
      triggerRange: 9,
      windup: 0.9,
      trackFraction: 0,
      turnRate: 0,
      recovery: 0.8,
      cooldown: 0.7,
      damage: 12,
      shape: { kind: 'radial', bolts: 12, speed: 5.5, radius: 0.24, range: 10 },
    },
    boss: {
      title: 'Lód pamięta każde serce',
      roar: 1.4,
      phases: [
        [
          { triggerRange: 9, windup: 0.9, trackFraction: 0, turnRate: 0, recovery: 0.8, cooldown: 0.7, damage: 12, shape: { kind: 'radial', bolts: 12, speed: 5.5, radius: 0.24, range: 10 } },
          { triggerRange: 10, windup: 0.6, trackFraction: 0, turnRate: 0, recovery: 0.7, cooldown: 0.7, damage: 20, shape: { kind: 'meteors', count: 4, radius: 1.1, spread: 2.4, delay: 1.3 } },
          { triggerRange: 20, windup: 0.8, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.8, damage: 0, shape: { kind: 'summon', kinds: ['hound', 'hound'] } },
        ],
        [
          { triggerRange: 9, windup: 0.8, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.5, damage: 13, shape: { kind: 'radial', bolts: 18, speed: 5.5, radius: 0.24, range: 10 } },
          { triggerRange: 10, windup: 0.55, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.5, damage: 22, shape: { kind: 'meteors', count: 6, radius: 1.15, spread: 3, delay: 1.2 } },
          { triggerRange: 3.2, windup: 0.95, trackFraction: 0.35, turnRate: 140, recovery: 0.9, cooldown: 0.6, damage: 24, shape: { kind: 'cone', radius: 3.2, arcDeg: 70 } },
          { triggerRange: 20, windup: 0.8, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.8, damage: 0, shape: { kind: 'summon', kinds: ['hound', 'thrall', 'thrall'] } },
        ],
      ],
    },
  },
  /** Floor 3 boss: the Hollow King, wearer of the empty crown. Blade, fire and the dead. */
  bossKing: {
    name: 'Pusty Król',
    maxHp: 1600,
    radius: 0.7,
    speed: 2.05,
    mass: 40,
    poise: 1,
    stunTaken: 0.2,
    spawnTime: 1.8,
    xp: 120,
    ash: 60,
    scale: 1.75,
    attack: {
      triggerRange: 2.6,
      windup: 0.85,
      trackFraction: 0.3,
      turnRate: 140,
      recovery: 0.8,
      cooldown: 0.5,
      damage: 26,
      shape: { kind: 'cone', radius: 2.7, arcDeg: 150 },
    },
    boss: {
      title: 'Korona leży pusta. Tron — nie',
      roar: 1.6,
      phases: [
        [
          { triggerRange: 2.6, windup: 0.85, trackFraction: 0.3, turnRate: 140, recovery: 0.8, cooldown: 0.5, damage: 26, shape: { kind: 'cone', radius: 2.7, arcDeg: 150 } },
          { triggerRange: 10, windup: 0.7, trackFraction: 0, turnRate: 0, recovery: 0.7, cooldown: 0.6, damage: 24, shape: { kind: 'meteors', count: 5, radius: 1.2, spread: 3, delay: 1.2 } },
          { triggerRange: 7.5, windup: 0.85, trackFraction: 0.4, turnRate: 160, recovery: 1.1, cooldown: 0.6, damage: 30, shape: { kind: 'charge', distance: 7.5, width: 0.9, speed: 12.5 } },
        ],
        [
          { triggerRange: 2.6, windup: 0.7, trackFraction: 0.3, turnRate: 160, recovery: 0.6, cooldown: 0.4, damage: 28, shape: { kind: 'cone', radius: 2.8, arcDeg: 160 } },
          { triggerRange: 9, windup: 0.8, trackFraction: 0, turnRate: 0, recovery: 0.8, cooldown: 0.5, damage: 14, shape: { kind: 'radial', bolts: 14, speed: 6, radius: 0.26, range: 10 } },
          { triggerRange: 10, windup: 0.6, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.5, damage: 26, shape: { kind: 'meteors', count: 7, radius: 1.2, spread: 3.2, delay: 1.1 } },
          { triggerRange: 20, windup: 0.9, trackFraction: 0, turnRate: 0, recovery: 0.6, cooldown: 0.8, damage: 0, shape: { kind: 'summon', kinds: ['pyre', 'thrall', 'thrall'] } },
        ],
      ],
    },
  },
};
