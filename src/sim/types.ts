import type { EnemyDef, EnemyKind } from '../config/balance';

export type HeroState = 'idle' | 'move' | 'dodge' | 'cast' | 'dead';

export interface HeroStats {
  maxHp: number;
  moveSpeed: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  critChance: number;
  critMult: number;
  damageReduction: number;
  skillCooldownMult: number;
}

export interface Hero {
  x: number;
  y: number;
  /** Position at the previous sim step (render interpolation). */
  px: number;
  py: number;
  r: number;
  hp: number;
  stats: HeroStats;
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
  /** Dodge invulnerability remaining. */
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
  /** Personal flanking offset so a pack spreads around the hero instead of stacking. */
  flankAngle: number;
}

export interface InputIntent {
  /** World-space movement direction, magnitude 0..1. */
  moveX: number;
  moveY: number;
  /** Edge-triggered presses (true only on the frame the button went down). */
  dodge: boolean;
  skill: boolean;
}

export type SimEvent =
  | { type: 'swing'; targetId: number; angle: number }
  | { type: 'whiff' }
  | { type: 'damage'; targetId: number; amount: number; crit: boolean; x: number; y: number; source: 'attack' | 'cleave' | 'skill' }
  | { type: 'death'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'dodge'; dirX: number; dirY: number }
  | { type: 'evade'; x: number; y: number }
  | { type: 'skillCast' }
  | { type: 'skillImpact'; x: number; y: number; radius: number; hits: number }
  | { type: 'interrupt'; id: number }
  | { type: 'windup'; id: number; kind: EnemyKind }
  | { type: 'strike'; id: number; kind: EnemyKind; hit: boolean }
  | { type: 'heroHurt'; amount: number; x: number; y: number }
  | { type: 'heroDeath' }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'waveStart'; wave: number; count: number }
  | { type: 'waveClear'; wave: number };
