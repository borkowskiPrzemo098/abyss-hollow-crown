import type { EnemyAttack, EnemyDef, EnemyKind } from '../config/balance';
import type { TrapKind } from '../config/biomes';
import type { HeroClassDef, HeroId } from '../config/heroes';
import type { DropSource, Item } from '../config/items';
import type { MetaRanks } from '../config/progression';
import type { SkillDef, SkillId } from '../config/skills';
import type { UpgradeId } from '../config/upgrades';
import type { ObjectKind, RoomType } from '../world/dungeon';

export type HeroState = 'idle' | 'move' | 'dodge' | 'dash' | 'cast' | 'dead';

/** What the player picked before the run: class, skill, permanent ranks and equipped gear. */
export interface HeroBuild {
  heroId: HeroId;
  skillId: SkillId;
  ranks: MetaRanks;
  gear: Item[];
}

/** Derived numbers. Recomputed from class + ranks + upgrades + gear whenever one changes. */
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
  // ── gear effects (0 / false = not equipped) ──
  /** Burn damage per second as a fraction of attack damage. */
  burn: number;
  frostShell: boolean;
  /** Every Nth attack chains; 0 = none. */
  chainEvery: number;
  leech: number;
  thorns: number;
  barrierMax: number;
  emberStep: boolean;
  critNova: boolean;
  frenzy: boolean;
  executioner: boolean;
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
  /** Current movement velocity (tiles/s). On ice it lags behind the stick. */
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
  // ── gear effect state ──
  barrier: number;
  /** Seconds until the barrier refills. */
  barrierT: number;
  frostCd: number;
  frenzyT: number;
  attackCount: number;
  novaCd: number;
  lavaT: number;
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
  /** The attack being wound up / last used (bosses rotate through several). */
  atk: EnemyAttack;
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
  /** Charge attack in progress: seconds left, and whether it already hit. */
  dashT: number;
  dashHit: boolean;
  burnT: number;
  burnDps: number;
  burnTick: number;
  /** Frozen by Frost Shell (renders icy; behaves as stunned). */
  frozenT: number;
  /** Bosses: 1 or 2. */
  phase: number;
  /** Boss roar at the phase change: ignores damage. */
  invulnerable: boolean;
  lastAttack: number;
  /** Summoned by a boss (dies with it). */
  minion: boolean;
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
  /** This shot is a chain-lightning attack (Laska Burzy). */
  chain: boolean;
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

/** A delayed blast: its circle is visible from the moment it exists until it goes off. */
export interface Hazard {
  id: number;
  kind: 'meteor' | 'bomb' | 'frost' | 'ember';
  x: number;
  y: number;
  r: number;
  t: number;
  delay: number;
  damage: number;
  hurtsEnemies: boolean;
}

export interface Trap {
  kind: TrapKind;
  tx: number;
  ty: number;
  /** Cycle offset so traps in one room don't fire in lockstep. */
  phase: number;
  /** Entities already hit during the current activation. */
  hit: number[];
  cycle: number;
}

export interface Pickup {
  id: number;
  kind: 'ash' | 'heal' | 'item';
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  amount: number;
  age: number;
  item?: Item;
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
  /** Chests: what kind of loot they hold. */
  loot: DropSource;
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

export type DamageSource = 'attack' | 'cleave' | 'bolt' | 'skill' | 'shatter' | 'burn' | 'chain' | 'nova' | 'ember' | 'thorns' | 'trap';

export type SimEvent =
  | { type: 'swing'; targetId: number; angle: number }
  | { type: 'whiff' }
  | { type: 'shoot'; team: 'hero' | 'enemy'; x: number; y: number; angle: number }
  | { type: 'projectileEnd'; team: 'hero' | 'enemy'; x: number; y: number }
  | { type: 'damage'; targetId: number; amount: number; crit: boolean; x: number; y: number; source: DamageSource }
  | { type: 'immune'; id: number; x: number; y: number }
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
  | { type: 'enemyCharge'; id: number }
  | { type: 'heroHurt'; amount: number; x: number; y: number }
  | { type: 'heroHeal'; amount: number }
  | { type: 'heroDeath' }
  | { type: 'barrierHit'; absorbed: number; broken: boolean }
  | { type: 'frostShell'; x: number; y: number; radius: number }
  | { type: 'emberStep'; x: number; y: number; radius: number }
  | { type: 'nova'; x: number; y: number; radius: number }
  | { type: 'chain'; segments: [number, number, number, number][] }
  | { type: 'hazardBlast'; kind: Hazard['kind']; x: number; y: number; radius: number }
  | { type: 'trapFire'; kind: 'spikes' | 'vent'; x: number; y: number }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'bossSpawn'; id: number; kind: EnemyKind }
  | { type: 'bossPhase'; id: number }
  | { type: 'bossDeath'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'xp'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'choice' }
  | { type: 'pickup'; kind: 'ash' | 'heal'; amount: number; x: number; y: number }
  | { type: 'loot'; item: Item }
  | { type: 'chest'; x: number; y: number }
  | { type: 'shrine'; x: number; y: number; amount: number }
  | { type: 'roomEnter'; roomId: number; roomType: RoomType }
  | { type: 'doors'; roomId: number; open: boolean }
  | { type: 'roomClear'; roomId: number; roomType: RoomType }
  | { type: 'stairsOpen'; x: number; y: number }
  | { type: 'floorExit' };
