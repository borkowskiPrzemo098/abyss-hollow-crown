import type { EnemyDef, EnemyKind } from '../config/balance';
import type { HeroClassDef, HeroId } from '../config/heroes';
import type { MetaRanks } from '../config/progression';
import type { SkillDef, SkillId } from '../config/skills';
import type { UpgradeId } from '../config/upgrades';
import type { ObjectKind, RoomType } from '../world/dungeon';

export type HeroState = 'idle' | 'move' | 'dodge' | 'dash' | 'cast' | 'dead';

/** What the player picked before the run, plus permanent Sanctuary ranks. */
export interface HeroBuild {
  heroId: HeroId;
  skillId: SkillId;
  ranks: MetaRanks;
}

/** Derived numbers. Recomputed from class + ranks + upgrades whenever one changes. */
export interface HeroStats {
  maxHp: number;
  moveSpeed: number;
  damage: number;
  /** Seconds between attack starts (lower = faster). */
  attackInterval: number;
  attackRange: number;
  critChance: number;
  critMult: number;
  /** Fraction of incoming damage removed (0..0.6). */
  armor: number;
  skillCooldownMult: number;
  pierce: number;
  cleaveArcDeg: number;
  cleaveRatio: number;
  lifeOnKill: number;
  /** Death-burst damage as a fraction of attack damage; 0 = none. */
  shatter: number;
  /** Extra damage while below the last-stand threshold. */
  lastStand: number;
  /** Extra damage on the first hit after a dodge; 0 = none. */
  dodgeStrike: number;
}

export interface Hero {
  x: number;
  y: number;
  /** Position at the previous sim step (render interpolation). */
  px: number;
  py: number;
  r: number;
  hp: number;
  cls: HeroClassDef;
  skill: SkillDef;
  build: HeroBuild;
  stats: HeroStats;
  level: number;
  xp: number;
  upgrades: Record<UpgradeId, number>;
  state: HeroState;
  /** Facing angle in world space (radians). */
  facing: number;
  /** Current movement velocity (tiles/s), for animation. */
  vx: number;
  vy: number;
  dodgeT: number;
  dodgeDirX: number;
  dodgeDirY: number;
  dodgeCd: number;
  dodgeBuffer: number;
  /** Dodge / dash invulnerability remaining. */
  iframeT: number;
  /** Post-hit mercy invulnerability remaining. */
  hurtT: number;
  attackCd: number;
  /** Swing wind-up remaining; negative when not swinging. */
  swingT: number;
  swingTargetId: number;
  skillCd: number;
  skillBuffer: number;
  castT: number;
  dashT: number;
  dashHit: number[];
  /** "Counter from the roll" window remaining. */
  empowerT: number;
  targetId: number | null;
  targetLockT: number;
}

export type EnemyState = 'spawning' | 'chase' | 'windup' | 'recover' | 'stunned' | 'dead';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  hp: number;
  maxHp: number;
  dmgScale: number;
  xpScale: number;
  state: EnemyState;
  stateT: number;
  /** Total length of the current timed state (for telegraph progress). */
  stateDur: number;
  attackCd: number;
  /** Aim angle of the current/last attack (world radians). */
  aim: number;
  facing: number;
  kvx: number;
  kvy: number;
  flinchT: number;
  deadT: number;
  /** Movement multiplier from slowing zones, reset every step. */
  slowMul: number;
  /** Personal flanking offset so a pack spreads around the hero instead of stacking. */
  flankAngle: number;
}

export interface Projectile {
  id: number;
  team: 'hero' | 'enemy';
  kind: 'shard' | 'ember';
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  crit: boolean;
  pierceLeft: number;
  life: number;
  hit: number[];
}

export interface Zone {
  id: number;
  kind: 'seal';
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  tickT: number;
}

export interface Pickup {
  id: number;
  kind: 'ash' | 'heal';
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  amount: number;
  age: number;
}

export interface WorldObject {
  id: number;
  kind: ObjectKind;
  x: number;
  y: number;
  roomId: number;
  /** Stairs stay dormant until their room is cleared. */
  active: boolean;
  used: boolean;
}

export interface InputIntent {
  /** World-space movement direction, magnitude 0..1. */
  moveX: number;
  moveY: number;
  /** Edge-triggered presses (true only on the frame the button went down). */
  dodge: boolean;
  skill: boolean;
}

export interface Choice {
  source: 'level' | 'chest';
  options: UpgradeId[];
}

export type DamageSource = 'attack' | 'cleave' | 'bolt' | 'skill' | 'shatter';

export type SimEvent =
  | { type: 'swing'; targetId: number; angle: number }
  | { type: 'whiff' }
  | { type: 'shoot'; team: 'hero' | 'enemy'; x: number; y: number; angle: number }
  | { type: 'projectileEnd'; team: 'hero' | 'enemy'; x: number; y: number }
  | { type: 'damage'; targetId: number; amount: number; crit: boolean; x: number; y: number; source: DamageSource }
  | { type: 'death'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'dodge'; dirX: number; dirY: number }
  | { type: 'evade'; x: number; y: number }
  | { type: 'skillCast'; skill: SkillId }
  | { type: 'skillImpact'; x: number; y: number; radius: number; hits: number }
  | { type: 'dash'; dirX: number; dirY: number }
  | { type: 'volley'; angle: number }
  | { type: 'seal'; x: number; y: number; radius: number }
  | { type: 'shatter'; x: number; y: number; radius: number }
  | { type: 'interrupt'; id: number }
  | { type: 'windup'; id: number; kind: EnemyKind }
  | { type: 'strike'; id: number; kind: EnemyKind; hit: boolean }
  | { type: 'heroHurt'; amount: number; x: number; y: number }
  | { type: 'heroHeal'; amount: number }
  | { type: 'heroDeath' }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'xp'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'choice' }
  | { type: 'pickup'; kind: 'ash' | 'heal'; amount: number; x: number; y: number }
  | { type: 'chest'; x: number; y: number }
  | { type: 'shrine'; x: number; y: number; amount: number }
  | { type: 'roomEnter'; roomId: number; roomType: RoomType }
  | { type: 'doors'; roomId: number; open: boolean }
  | { type: 'roomClear'; roomId: number; roomType: RoomType }
  | { type: 'stairsOpen'; x: number; y: number }
  | { type: 'floorExit' };
