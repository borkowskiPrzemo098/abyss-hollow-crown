import type { EnemyAttack, EnemyDef, EnemyKind } from '../config/balance';
import type { TrapKind } from '../config/biomes';
import type { HeroClassDef, HeroId } from '../config/heroes';
import type { DropSource, Item } from '../config/items';
import type { MetaRanks } from '../config/progression';
import type { SkillDef, SkillId } from '../config/skills';
import type { StatusId, SynergyId } from '../config/statuses';
import type { UpgradeId } from '../config/upgrades';
import type { ObjectKind, RoomType } from '../world/dungeon';

export type HeroState = 'idle' | 'move' | 'dodge' | 'dash' | 'cast' | 'dead';

/** What the player picked before the run: class, skills (1–3, in slot order), permanent ranks and equipped gear. */
export interface HeroBuild {
  heroId: HeroId;
  skills: SkillId[];
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

/** One worn skill: its definition, remaining cooldown and a short input buffer. */
export interface SkillSlot {
  def: SkillDef;
  cd: number;
  buffer: number;
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
  skills: SkillSlot[];
  /** Skill whose cast / dash is in progress (state 'cast' | 'dash'). */
  activeSkill: SkillDef | null;
  /** Slot of the skill being cast (a missed Crush refunds its cooldown). */
  castSlot: number;
  /** After any cast every slot is locked for a moment. */
  skillLock: number;
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
  // ── skill state ──
  /** Bastion: damage reduction time left. */
  guardT: number;
  /** Blood Pact: time left. */
  pactT: number;
  /** Whirl of Blades: time left and time to the next tick. */
  whirlT: number;
  whirlTick: number;
  /** Overload: time left. */
  overloadT: number;
  /** Void Ward: absorbing shield and its time left. */
  shield: number;
  shieldT: number;
  /** Standing inside a banner this step. */
  inBanner: boolean;
  /** Attack speed bonus from the banner you stand in (0 outside). */
  bannerHaste: number;
  // ── skill upgrades ──
  /** Upgrade levels found this run: upgrade id → level. */
  skillUpgrades: Record<string, number>;
  /** Bastion: share of damage removed while guardT runs. */
  guardPower: number;
  /** Blood Pact: damage bonus and share of damage returned as health. */
  pactPower: number;
  pactLifesteal: number;
  /** Whirl of Blades: walking speed multiplier while it runs. */
  whirlMove: number;
  /** Overload: attack speed bonus while overloadT runs. */
  overloadHaste: number;
  /** Seconds a single cast may still take off its cooldown (upgrade `refund`). */
  refundLeft: number;
  /** Retaliation blasts are rate limited. */
  retaliateCd: number;
  /** Mines left by dodging are rate limited. */
  trapCd: number;
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
  /** Slowed by a skill upgrade (chill): seconds left. */
  chillT: number;
  /** Generation of the fire on this enemy: 0 = lit by a hit, +1 for every time it was spread. */
  burnGen: number;
  /** Bleeding: seconds left, stacks, time to the next tick. */
  bleedT: number;
  bleedStacks: number;
  bleedTick: number;
  /** Marked: seconds left, order of marking (oldest goes first), cooldown until it may arc again. */
  markT: number;
  markSeq: number;
  markCd: number;
  /** After a stun ends the enemy cannot be stunned again for this long. */
  ccGrace: number;
  /** How long the current stun has already lasted; new applications can extend it only up to the limit. */
  ccElapsed: number;
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
  /** Skill whose upgrades apply to this shot's hits. */
  skill?: SkillId;
}

/**
 * A hero-made area on the floor. `seal` slows and burns, `banner` buffs the hero,
 * `sentry` shoots, `mine` waits for an enemy, `star` is a marked spot that explodes
 * when `tickT` runs out.
 */
export interface Zone {
  id: number;
  kind: 'seal' | 'banner' | 'sentry' | 'mine' | 'star' | 'ground';
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  /** Seal: time to the next damage tick. Sentry: time to the next shot. Mine: time left until armed. Star: time to impact. */
  tickT: number;
  /** Which skill made it (upgrades of that skill apply to what it does). */
  skill?: SkillId;
  /** Ground: × attack damage per tick. */
  mult?: number;
}

/** Something the hero's skill does a moment later: a repeat, or a blast. */
export interface Delayed {
  t: number;
  kind: 'burst' | 'sunder' | 'frost';
  x: number;
  y: number;
  mult: number;
  radius: number;
  skill: SkillId;
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
  /** Skill slots 1–3. Slot 2 and 3 are optional so one-skill callers stay unchanged. */
  skill: boolean;
  skill2?: boolean;
  skill3?: boolean;
}

/** A general stat upgrade (UpgradeId) or an upgrade of one skill (`<skill>.<name>`). */
export type ChoiceId = UpgradeId | (string & {});

export interface Choice {
  source: 'level' | 'chest';
  options: ChoiceId[];
}

export type DamageSource = 'attack' | 'cleave' | 'bolt' | 'skill' | 'shatter' | 'burn' | 'bleed' | 'chain' | 'arc' | 'nova' | 'ember' | 'thorns' | 'trap';

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
  /** A skill did something at a place (blast, ring, hop). `x2`/`y2` = where a hop started. */
  | { type: 'skillFx'; skill: SkillId; x: number; y: number; radius: number; x2?: number; y2?: number; blast?: boolean }
  /** A status was put on an enemy (first time or a new stack). */
  | { type: 'status'; id: number; status: StatusId; stacks: number }
  /** A reaction between a skill and a status happened at a place. */
  | { type: 'synergy'; id: SynergyId; x: number; y: number; targetId: number; amount?: number }
  /** The hero took a skill upgrade. */
  | { type: 'skillUpgrade'; id: string; level: number }
  /** A skill that needs a target was pressed with none in reach. */
  | { type: 'skillFizzle'; slot: number }
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
  | { type: 'altar'; x: number; y: number; cost: number }
  | { type: 'altarRefused'; x: number; y: number }
  | { type: 'roomEnter'; roomId: number; roomType: RoomType }
  | { type: 'doors'; roomId: number; open: boolean }
  | { type: 'roomClear'; roomId: number; roomType: RoomType }
  | { type: 'stairsOpen'; x: number; y: number }
  | { type: 'floorExit' };
