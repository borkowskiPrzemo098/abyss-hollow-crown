import { COMMON, ENEMIES, ENEMY_FRICTION, type EnemyKind } from '../config/balance';
import { TRAPS } from '../config/biomes';
import { HEROES } from '../config/heroes';
import { DROPS, EFFECT, type DropSource, type Item } from '../config/items';
import { RUN, xpToNext } from '../config/progression';
import {
  SKILLS,
  SKILL_RULES,
  type SkillId,
  type AxeDef,
  type BlinkDef,
  type ChargeDef,
  type CrushDef,
  type HookDef,
  type MineDef,
  type SealDef,
  type SkillDef,
  type SnipeDef,
  type StarfallDef,
  type SunderDef,
  type VolleyDef,
  type WarcryDef,
} from '../config/skills';
import { STATUS, SYNERGY } from '../config/statuses';
import { SKILL_UPGRADES, SKILL_UPGRADE_LIST, SKILL_UPGRADE_RULES, isSkillUpgradeId, maxLevel, resolveMods, type SkillMods, type SkillUpgradeDef } from '../config/skillUpgrades';
import { UPGRADES, UPGRADE_EFFECT, type UpgradeId } from '../config/upgrades';
import { isoMoveScale } from '../core/iso';
import { angleDiff, dist, normalize, turnToward, type Vec2 } from '../core/math';
import { Rng } from '../core/rng';
import { blocksSight, isWalkable, tileAt, type ArenaMap } from '../world/arena';
import { hasClearPath, hasLineOfSight, moveCircle, resolveCircleVsGrid } from '../world/collision';
import type { ObjectKind, TrapTile } from '../world/dungeon';
import { FlowField } from '../world/flowField';
import { applyReduction, rollDamage, type DamageRoll } from './damage';
import { generateItem, rollRarity } from './loot';
import { computeStats, emptyUpgrades } from './stats';
import { chooseTarget, isTargetable, type TargetingParams } from './targeting';
import type {
  Choice,
  ChoiceId,
  DamageSource,
  Delayed,
  Enemy,
  Hazard,
  Hero,
  HeroBuild,
  InputIntent,
  Pickup,
  Projectile,
  SimEvent,
  Trap,
  WorldObject,
  Zone,
} from './types';

const DEG = Math.PI / 180;
const ISO = COMMON.isoCompensation;
const HERO_SOURCES: ReadonlySet<DamageSource> = new Set(['attack', 'cleave', 'bolt', 'skill', 'chain', 'arc', 'nova', 'ember', 'thorns']);

export interface SimOptions {
  seed: number;
  build: HeroBuild;
}

/**
 * Everything about a run that cannot be rebuilt from the floor's seed: the hero, the counters, the random
 * streams, what lies on the floor and which objects have been used. It is only taken at a calm moment
 * (see isSafePoint in meta/runSave.ts), so no enemy, projectile or timer of a fight needs saving.
 */
export interface SimSnapshot {
  time: number;
  kills: number;
  ash: number;
  depth: number;
  /** State of the combat and the offer random streams, so a resumed run goes on exactly as it would have. */
  rng: number;
  choiceRng: number;
  hero: {
    x: number;
    y: number;
    facing: number;
    hp: number;
    level: number;
    xp: number;
    upgrades: Record<string, number>;
    skillUpgrades: Record<string, number>;
    skillCd: number[];
    dodgeCd: number;
  };
  loot: Item[];
  skillUpgradeLog: string[];
  /** Cycle offsets of the floor's traps (they were drawn from the random stream when the floor was made). */
  trapPhases: number[];
  objects: { kind: ObjectKind; x: number; y: number; roomId: number; active: boolean; used: boolean; loot: DropSource }[];
  pickups: { kind: Pickup['kind']; x: number; y: number; amount: number; item?: Item }[];
}

/** Drives encounters on top of the combat core (dungeon rooms, or test waves). */
export interface Director {
  update(dt: number): void;
}

export interface SpawnOptions {
  /** Skip the spawn telegraph (tests). */
  instant?: boolean;
  hpScale?: number;
  dmgScale?: number;
  xpScale?: number;
  delay?: number;
  minion?: boolean;
}

export function createHero(build: HeroBuild, x: number, y: number): Hero {
  const cls = HEROES[build.heroId];
  const upgrades = emptyUpgrades();
  const stats = computeStats(cls, build.ranks, upgrades, build.gear);
  return {
    x,
    y,
    px: x,
    py: y,
    r: COMMON.heroRadius,
    hp: stats.maxHp,
    cls,
    skills: build.skills.slice(0, SKILL_RULES.maxSlots).map((id) => ({ def: SKILLS[id], cd: 0, buffer: 0 })),
    activeSkill: null,
    castSlot: 0,
    skillLock: 0,
    build,
    stats,
    level: 1,
    xp: 0,
    upgrades,
    state: 'idle',
    facing: Math.PI / 4,
    vx: 0,
    vy: 0,
    dodgeT: 0,
    dodgeDirX: 0,
    dodgeDirY: 0,
    dodgeCd: 0,
    dodgeBuffer: 0,
    iframeT: 0,
    hurtT: 0,
    attackCd: 0,
    swingT: -1,
    swingTargetId: -1,
    castT: 0,
    dashT: 0,
    dashHit: [],
    empowerT: 0,
    targetId: null,
    targetLockT: 0,
    barrier: stats.barrierMax,
    barrierT: 0,
    frostCd: 0,
    frenzyT: 0,
    attackCount: 0,
    novaCd: 0,
    lavaT: 0,
    guardT: 0,
    pactT: 0,
    whirlT: 0,
    whirlTick: 0,
    overloadT: 0,
    shield: 0,
    shieldT: 0,
    inBanner: false,
    bannerHaste: 0,
    skillUpgrades: {},
    guardPower: 0,
    pactPower: 0,
    pactLifesteal: 0,
    whirlMove: 1,
    overloadHaste: 0,
    refundLeft: 0,
    retaliateCd: 0,
    trapCd: 0,
  };
}

/**
 * The whole combat simulation, independent of Phaser and of frame rate.
 * Advance it with fixed `step(dt)` calls; read state and drain events to render.
 */
export class Simulation {
  map: ArenaMap;
  readonly rng: Rng;
  readonly hero: Hero;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  hazards: Hazard[] = [];
  traps: Trap[] = [];
  pickups: Pickup[] = [];
  objects: WorldObject[] = [];
  /** Pending upgrade choices. The world is frozen while one is open. */
  choices: Choice[] = [];
  director: Director | null = null;
  /** Dungeon floor (item level of drops, enemy scaling). */
  depth = 1;
  time = 0;
  /** While > 0 the world freezes (hit-stop) — gives big hits weight. */
  hitstop = 0;
  kills = 0;
  /** Ash collected this run (banked into the save when the run ends). */
  ash = 0;
  /** Items picked up this run (already added to the player's bag by the game). */
  loot: Item[] = [];

  private flow: FlowField;
  private trapGrid: Uint8Array;
  private readonly input: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };
  private events: SimEvent[] = [];
  private nextId = 1;
  private modCache = new Map<SkillId, SkillMods>();
  private markCounter = 0;
  /** Lightning arcs of marked enemies share this budget (refills over time), so they can never snowball. */
  private arcBudget: number = SYNERGY.storm.burst;
  /** Things hero skills do a moment later (repeats, detonations). */
  delayed: Delayed[] = [];
  /** Skill upgrades taken this run, in order (banked into the codex when the run ends). */
  skillUpgradeLog: string[] = [];
  /** Separate random stream for skill-upgrade offers, so they never disturb combat randomness. */
  private readonly choiceRng: Rng;
  private lavaTick = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly targeting: TargetingParams;

  constructor(map: ArenaMap, opts: SimOptions) {
    this.map = map;
    this.rng = new Rng(opts.seed);
    this.choiceRng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
    this.flow = new FlowField(map);
    this.trapGrid = new Uint8Array(map.w * map.h);
    this.hero = createHero(opts.build, map.heroStart.x, map.heroStart.y);
    this.targeting = {
      attackRange: this.hero.stats.attackRange,
      acquireMargin: COMMON.targeting.acquireMargin,
      leashMargin: COMMON.targeting.leashMargin,
      switchRatio: COMMON.targeting.switchRatio,
      minLock: COMMON.targeting.minLock,
    };
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** Moves the hero (and its progress) onto a new floor. */
  loadMap(map: ArenaMap): void {
    this.map = map;
    this.flow = new FlowField(map);
    this.trapGrid = new Uint8Array(map.w * map.h);
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.delayed = [];
    this.hazards = [];
    this.traps = [];
    this.pickups = [];
    this.objects = [];
    this.director = null;
    const h = this.hero;
    h.x = h.px = map.heroStart.x;
    h.y = h.py = map.heroStart.y;
    h.vx = h.vy = 0;
    h.state = h.hp > 0 ? 'idle' : 'dead';
    h.swingT = -1;
    h.targetId = null;
  }

  setTraps(tiles: readonly TrapTile[]): void {
    const kinds = { spikes: 1, ice: 2, lava: 3, vent: 4 } as const;
    this.trapGrid.fill(0);
    this.traps = tiles.map((t) => {
      this.trapGrid[t.ty * this.map.w + t.tx] = kinds[t.kind];
      return { kind: t.kind, tx: t.tx, ty: t.ty, phase: this.rng.range(0, 3), hit: [], cycle: -1 };
    });
  }

  /** Trap kind under a world point, or null. */
  trapAt(x: number, y: number): 'spikes' | 'ice' | 'lava' | 'vent' | null {
    const v = this.trapGrid[Math.floor(y) * this.map.w + Math.floor(x)] ?? 0;
    return v === 1 ? 'spikes' : v === 2 ? 'ice' : v === 3 ? 'lava' : v === 4 ? 'vent' : null;
  }

  /** Call after tiles change (doors opening / closing). */
  invalidateFlow(): void {
    this.flow.invalidate();
  }

  /** Feed the latest player intent. Button presses are buffered briefly so early taps still count. */
  setInput(i: InputIntent): void {
    this.input.moveX = i.moveX;
    this.input.moveY = i.moveY;
    if (i.dodge) this.hero.dodgeBuffer = COMMON.inputBuffer;
    const slots = this.hero.skills;
    if (i.skill && slots[0]) slots[0].buffer = COMMON.inputBuffer;
    if (i.skill2 && slots[1]) slots[1].buffer = COMMON.inputBuffer;
    if (i.skill3 && slots[2]) slots[2].buffer = COMMON.inputBuffer;
  }

  emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  getEnemy(id: number | null): Enemy | undefined {
    if (id === null) return undefined;
    return this.enemies.find((e) => e.id === id);
  }

  livingEnemyCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.state !== 'dead') n++;
    return n;
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, opts: SpawnOptions = {}): Enemy {
    const def = ENEMIES[kind];
    const maxHp = Math.round(def.maxHp * (opts.hpScale ?? 1));
    const spawnT = def.spawnTime + (opts.delay ?? 0);
    const toHero = Math.atan2(this.hero.y - y, this.hero.x - x);
    const e: Enemy = {
      id: this.nextId++,
      kind,
      def,
      x,
      y,
      px: x,
      py: y,
      r: def.radius,
      hp: maxHp,
      maxHp,
      dmgScale: opts.dmgScale ?? 1,
      xpScale: opts.xpScale ?? 1,
      state: opts.instant ? 'chase' : 'spawning',
      stateT: opts.instant ? 0 : spawnT,
      stateDur: opts.instant ? 0 : spawnT,
      attackCd: opts.instant ? 0 : this.rng.range(0.25, 0.9),
      atk: def.boss ? def.boss.phases[0][0]! : def.attack,
      aim: toHero,
      facing: toHero,
      kvx: 0,
      kvy: 0,
      flinchT: 0,
      deadT: 0,
      slowMul: 1,
      flankAngle: this.rng.range(-0.75, 0.75),
      dashT: 0,
      dashHit: false,
      burnT: 0,
      burnDps: 0,
      burnTick: 0,
      frozenT: 0,
      chillT: 0,
      burnGen: 0,
      bleedT: 0,
      bleedStacks: 0,
      bleedTick: 0,
      markT: 0,
      markSeq: 0,
      markCd: 0,
      ccGrace: 0,
      ccElapsed: 0,
      phase: 1,
      invulnerable: false,
      lastAttack: 0,
      minion: !!opts.minion,
    };
    this.tmp.x = x;
    this.tmp.y = y;
    resolveCircleVsGrid(this.map, this.tmp, e.r);
    e.x = e.px = this.tmp.x;
    e.y = e.py = this.tmp.y;
    this.enemies.push(e);
    this.emit({ type: 'spawn', id: e.id, kind, x: e.x, y: e.y });
    if (def.boss) this.emit({ type: 'bossSpawn', id: e.id, kind });
    return e;
  }

  addObject(kind: ObjectKind, x: number, y: number, roomId: number, active: boolean, loot: DropSource = 'treasure'): WorldObject {
    const o: WorldObject = { id: this.nextId++, kind, x, y, roomId, active, used: false, loot };
    this.objects.push(o);
    return o;
  }

  addPickup(kind: Pickup['kind'], x: number, y: number, amount: number, item?: Item): void {
    const a = this.rng.range(-Math.PI, Math.PI);
    const s = this.rng.range(1.5, 3.5);
    const p: Pickup = { id: this.nextId++, kind, x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, amount, age: 0 };
    if (item) p.item = item;
    this.pickups.push(p);
  }

  /** Drops a freshly rolled item from a loot source at (x, y). */
  dropItem(source: DropSource, x: number, y: number): Item {
    const item = generateItem(this.rng, this.hero.cls.id, this.depth, rollRarity(this.rng, source, this.depth));
    this.addPickup('item', x, y, 1, item);
    return item;
  }

  heal(amount: number, quiet = false): number {
    const h = this.hero;
    if (h.state === 'dead') return 0;
    const before = h.hp;
    h.hp = Math.min(h.stats.maxHp, h.hp + amount);
    const healed = Math.round(h.hp - before);
    if (healed > 0 && !quiet) this.emit({ type: 'heroHeal', amount: healed });
    return healed;
  }

  /** Swaps equipped gear (from the inventory screen) and re-derives stats. */
  setGear(gear: Item[]): void {
    this.hero.build.gear = gear;
    this.recomputeStats();
  }

  /** Re-derives hero stats; a higher max HP also raises current HP by the same amount. */
  recomputeStats(): void {
    const h = this.hero;
    const oldMax = h.stats.maxHp;
    const hadBarrier = h.stats.barrierMax;
    h.stats = computeStats(h.cls, h.build.ranks, h.upgrades, h.build.gear);
    if (h.stats.maxHp > oldMax) h.hp += h.stats.maxHp - oldMax;
    h.hp = Math.min(h.hp, h.stats.maxHp);
    if (h.stats.barrierMax !== hadBarrier) h.barrier = h.stats.barrierMax;
    this.targeting.attackRange = h.stats.attackRange;
  }

  /** Offers up to three upgrades. Returns false when everything is already maxed. */
  queueChoice(source: Choice['source']): boolean {
    const options = this.rollUpgrades(source);
    if (options.length === 0) return false;
    this.choices.push({ source, options });
    this.emit({ type: 'choice' });
    return true;
  }

  applyChoice(id: ChoiceId): boolean {
    const c = this.choices[0];
    if (!c || !c.options.includes(id)) return false;
    const h = this.hero;
    if (isSkillUpgradeId(id)) {
      const level = Math.min(maxLevel(SKILL_UPGRADES[id]!), (h.skillUpgrades[id] ?? 0) + 1);
      h.skillUpgrades[id] = level;
      this.modCache.clear();
      this.skillUpgradeLog.push(id);
      this.emit({ type: 'skillUpgrade', id, level });
    } else {
      const u = id as UpgradeId;
      h.upgrades[u] = Math.min(UPGRADES[u].maxStacks, h.upgrades[u] + 1);
      this.recomputeStats();
    }
    this.choices.shift();
    return true;
  }

  /**
   * Replaces the hero's skill upgrade levels (loading a run, tests). Unknown ids are dropped and levels are
   * clamped to what the upgrade has, so a bad input can never exceed the limits.
   */
  setSkillUpgrades(levels: Readonly<Record<string, number>>): void {
    const next: Record<string, number> = {};
    for (const [id, lv] of Object.entries(levels)) {
      const def = SKILL_UPGRADES[id];
      const n = Math.min(def ? maxLevel(def) : 0, Math.max(0, Math.floor(Number.isFinite(lv) ? lv : 0)));
      if (def && n > 0) next[id] = n;
    }
    this.hero.skillUpgrades = next;
    this.modCache.clear();
  }

  snapshot(): SimSnapshot {
    const h = this.hero;
    return {
      time: this.time,
      kills: this.kills,
      ash: this.ash,
      depth: this.depth,
      rng: this.rng.getState(),
      choiceRng: this.choiceRng.getState(),
      hero: {
        x: h.x,
        y: h.y,
        facing: h.facing,
        hp: h.hp,
        level: h.level,
        xp: h.xp,
        upgrades: { ...h.upgrades },
        skillUpgrades: { ...h.skillUpgrades },
        skillCd: h.skills.map((sl) => sl.cd),
        dodgeCd: h.dodgeCd,
      },
      loot: [...this.loot],
      skillUpgradeLog: [...this.skillUpgradeLog],
      trapPhases: this.traps.map((t) => t.phase),
      objects: this.objects.map((o) => ({ kind: o.kind, x: o.x, y: o.y, roomId: o.roomId, active: o.active, used: o.used, loot: o.loot })),
      pickups: this.pickups.map((q) => ({ kind: q.kind, x: q.x, y: q.y, amount: q.amount, ...(q.item ? { item: q.item } : {}) })),
    };
  }

  /**
   * Puts a snapshot back onto a freshly built floor (the director has already made its objects and traps;
   * they are replaced by the saved ones). The random streams are set last, so the result does not depend
   * on what building the floor drew from them.
   */
  restore(s: SimSnapshot): void {
    const h = this.hero;
    h.x = h.px = s.hero.x;
    h.y = h.py = s.hero.y;
    h.facing = s.hero.facing;
    h.level = s.hero.level;
    h.xp = s.hero.xp;
    h.upgrades = { ...emptyUpgrades() };
    for (const [id, n] of Object.entries(s.hero.upgrades)) if (id in UPGRADES) h.upgrades[id as UpgradeId] = Math.min(UPGRADES[id as UpgradeId].maxStacks, Math.max(0, Math.floor(n)));
    this.setSkillUpgrades(s.hero.skillUpgrades);
    this.recomputeStats();
    h.hp = Math.max(1, Math.min(h.stats.maxHp, s.hero.hp));
    h.skills.forEach((sl, i) => (sl.cd = Math.max(0, s.hero.skillCd[i] ?? 0)));
    h.dodgeCd = Math.max(0, s.hero.dodgeCd);
    h.vx = h.vy = 0;
    h.state = 'idle';
    this.time = s.time;
    this.kills = s.kills;
    this.ash = s.ash;
    this.depth = s.depth;
    this.loot = [...s.loot];
    this.skillUpgradeLog = [...s.skillUpgradeLog];
    this.traps.forEach((t, i) => (t.phase = s.trapPhases[i] ?? t.phase));
    this.objects = [];
    for (const o of s.objects) {
      const made = this.addObject(o.kind, o.x, o.y, o.roomId, o.active, o.loot);
      made.used = o.used;
    }
    this.pickups = [];
    for (const q of s.pickups) this.addPickup(q.kind, q.x, q.y, q.amount, q.item);
    for (const q of this.pickups) {
      q.vx = q.vy = 0;
      q.age = 1;
    }
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.hazards = [];
    this.delayed = [];
    this.choices = [];
    this.rng.setState(s.rng);
    this.choiceRng.setState(s.choiceRng);
  }

  /** Skill upgrades that could still be offered: for worn skills only, and not yet at their last level. */
  skillUpgradeCandidates(): SkillUpgradeDef[] {
    const h = this.hero;
    return SKILL_UPGRADE_LIST.filter((u) => h.skills.some((s) => s.def.id === u.skill) && (h.skillUpgrades[u.id] ?? 0) < maxLevel(u));
  }

  private rollUpgrades(source: Choice['source']): ChoiceId[] {
    const h = this.hero;
    const pool = (Object.values(UPGRADES) as (typeof UPGRADES)[UpgradeId][]).filter(
      (u) => h.upgrades[u.id] < u.maxStacks && (!u.heroes || u.heroes.includes(h.cls.id)),
    );
    const picks: UpgradeId[] = [];
    while (picks.length < 3 && pool.length > 0) {
      const weights = pool.map((u) => u.weight * (source === 'chest' && u.kind === 'special' ? 2.5 : 1));
      let roll = this.rng.next() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < pool.length - 1 && roll >= weights[i]!) roll -= weights[i++]!;
      picks.push(pool[i]!.id);
      pool.splice(i, 1);
    }
    return this.withSkillUpgrades(picks, source);
  }

  /**
   * Swaps the last cards of an offer for upgrades of the skills you wear (one on a level-up, two from a chest),
   * preferring different skills. Drawn from its own random stream, so the stat cards are exactly what they were.
   */
  private withSkillUpgrades(picks: ChoiceId[], source: Choice['source']): ChoiceId[] {
    const want = SKILL_UPGRADE_RULES.offer[source];
    const pool = this.skillUpgradeCandidates();
    const chosen: SkillUpgradeDef[] = [];
    while (chosen.length < want && pool.length > 0) {
      const fresh = pool.filter((u) => !chosen.some((c) => c.skill === u.skill));
      const from = fresh.length > 0 ? fresh : pool;
      const weights = from.map((u) => u.weight ?? 10);
      let roll = this.choiceRng.next() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < from.length - 1 && roll >= weights[i]!) roll -= weights[i++]!;
      const pick = from[i]!;
      chosen.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    if (chosen.length === 0) return picks;
    return [...picks.slice(0, Math.max(0, 3 - chosen.length)), ...chosen.map((u) => u.id)];
  }

  step(dt: number): void {
    this.time += dt;
    const h = this.hero;
    h.px = h.x;
    h.py = h.y;
    for (const e of this.enemies) {
      e.px = e.x;
      e.py = e.y;
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
    }
    for (const p of this.pickups) {
      p.px = p.x;
      p.py = p.y;
    }
    if (this.choices.length > 0) return;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.arcBudget = Math.min(SYNERGY.storm.burst, this.arcBudget + dt * SYNERGY.storm.perSecond);
    this.updateHero(dt);
    this.updateZones(dt);
    this.updateDelayed(dt);
    this.updateEnemies(dt);
    this.separateBodies();
    this.updateHeroAttack(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateTraps(dt);
    this.updatePickups(dt);
    this.director?.update(dt);
    this.enemies = this.enemies.filter((e) => !(e.state === 'dead' && e.deadT > 1.6));
  }

  /** Compact fingerprint of the world state (determinism tests). */
  stateHash(): string {
    const r = (v: number) => Math.round(v * 1000);
    const parts = [r(this.hero.x), r(this.hero.y), Math.round(this.hero.hp), this.kills, this.hero.level];
    for (const e of this.enemies) parts.push(e.id, r(e.x), r(e.y), Math.round(e.hp));
    return parts.join(',');
  }

  // ───────────────────────────── hero ─────────────────────────────

  private updateHero(dt: number): void {
    const h = this.hero;
    h.dodgeCd = Math.max(0, h.dodgeCd - dt);
    const haste = h.bannerHaste + (h.overloadT > 0 ? h.overloadHaste : 0);
    h.attackCd = Math.max(0, h.attackCd - dt * (1 + haste));
    for (const sl of h.skills) {
      sl.cd = Math.max(0, sl.cd - dt);
      sl.buffer = Math.max(0, sl.buffer - dt);
    }
    h.skillLock = Math.max(0, h.skillLock - dt);
    h.retaliateCd = Math.max(0, h.retaliateCd - dt);
    h.trapCd = Math.max(0, h.trapCd - dt);
    h.guardT = Math.max(0, h.guardT - dt);
    h.pactT = Math.max(0, h.pactT - dt);
    h.overloadT = Math.max(0, h.overloadT - dt);
    if (h.shieldT > 0) {
      h.shieldT = Math.max(0, h.shieldT - dt);
      if (h.shieldT === 0) h.shield = 0;
    }
    h.iframeT = Math.max(0, h.iframeT - dt);
    h.hurtT = Math.max(0, h.hurtT - dt);
    h.dodgeBuffer = Math.max(0, h.dodgeBuffer - dt);
    h.empowerT = Math.max(0, h.empowerT - dt);
    h.frostCd = Math.max(0, h.frostCd - dt);
    h.frenzyT = Math.max(0, h.frenzyT - dt);
    h.novaCd = Math.max(0, h.novaCd - dt);
    h.targetLockT += dt;
    if (h.stats.barrierMax > 0 && h.barrier < h.stats.barrierMax) {
      h.barrierT -= dt;
      if (h.barrierT <= 0) h.barrier = h.stats.barrierMax;
    }

    if (h.state === 'dead') {
      h.vx = h.vy = 0;
      return;
    }

    if (h.whirlT > 0) this.updateWhirl(dt);

    if (h.state === 'cast') {
      h.vx = h.vy = 0;
      h.castT -= dt;
      if (h.castT <= 0) {
        h.castT = 0;
        h.state = 'idle';
        this.resolveCast();
      }
      return;
    }

    if (h.state === 'dodge') {
      const D = h.cls.dodge;
      const done = this.rollMove(dt, h.dodgeT, D.duration, D.distance);
      h.dodgeT += dt;
      if (done) h.state = 'idle';
      return;
    }

    if (h.state === 'dash') {
      const S = h.activeSkill as ChargeDef;
      const cm = this.mods('charge');
      const done = this.rollMove(dt, h.dashT, S.duration, S.distance * (1 + cm.radius));
      // Ognisty Ślad: patches of burning ground behind the charge
      if (cm.ground > 0 && Math.floor(h.dashT / 0.09) !== Math.floor((h.dashT + dt) / 0.09)) this.leaveGround(h.x, h.y, 0.9, 'charge', cm.ground);
      h.dashT += dt;
      this.dashHits(S);
      if (done) h.state = 'idle';
      return;
    }

    if (h.dodgeBuffer > 0 && h.dodgeCd <= 0) {
      this.startDodge();
      return;
    }
    const ready = this.readySlot();
    if (ready >= 0) {
      this.startSkill(ready);
      if (h.state !== 'idle' && h.state !== 'move') return;
    }

    // walking: instant response on stone, sluggish on ice
    const mag = Math.min(1, Math.hypot(this.input.moveX, this.input.moveY));
    let tx = 0;
    let ty = 0;
    if (mag > 0.01) {
      normalize(this.input.moveX, this.input.moveY, this.tmp);
      const speed = this.heroMoveSpeed() * mag * isoMoveScale(this.tmp.x, this.tmp.y, ISO);
      tx = this.tmp.x * speed;
      ty = this.tmp.y * speed;
      if (h.swingT < 0) h.facing = Math.atan2(this.tmp.y, this.tmp.x);
    }
    let vx = tx;
    let vy = ty;
    if (this.trapAt(h.x, h.y) === 'ice') {
      const k = 1 - Math.exp(-TRAPS.ice.grip * dt);
      vx = h.vx + (tx - h.vx) * k;
      vy = h.vy + (ty - h.vy) * k;
    }
    if (Math.abs(vx) + Math.abs(vy) > 0.001) {
      this.moveHero(vx * dt, vy * dt, dt);
      h.state = mag > 0.01 ? 'move' : 'idle';
    } else {
      h.vx = h.vy = 0;
      h.state = 'idle';
    }
  }

  private heroMoveSpeed(): number {
    const h = this.hero;
    return h.stats.moveSpeed * (h.frenzyT > 0 ? 1 + EFFECT.frenzy.move : 1) * (h.whirlT > 0 ? h.whirlMove : 1);
  }

  /** Enemies a hero projectile passes through: class + upgrades + Overload. */
  private heroPierce(): number {
    const h = this.hero;
    return h.stats.pierce + (h.overloadT > 0 ? SKILLS.overload.pierce : 0);
  }

  private heroAttackInterval(): number {
    const h = this.hero;
    return h.stats.attackInterval / (h.frenzyT > 0 ? 1 + EFFECT.frenzy.attackSpeed : 1);
  }

  private moveHero(dx: number, dy: number, dt: number): void {
    const h = this.hero;
    this.tmp.x = h.x;
    this.tmp.y = h.y;
    moveCircle(this.map, this.tmp, dx, dy, h.r);
    h.vx = (this.tmp.x - h.x) / dt;
    h.vy = (this.tmp.y - h.y) / dt;
    h.x = this.tmp.x;
    h.y = this.tmp.y;
  }

  /** Ease-out displacement along dodgeDir: fast burst, soft landing, exact total distance. */
  private rollMove(dt: number, t: number, duration: number, distance: number): boolean {
    const h = this.hero;
    const u0 = t / duration;
    const u1 = Math.min(1, (t + dt) / duration);
    const ds = (1 - (1 - u1) ** 2) - (1 - (1 - u0) ** 2);
    const d = distance * isoMoveScale(h.dodgeDirX, h.dodgeDirY, ISO) * ds;
    this.moveHero(h.dodgeDirX * d, h.dodgeDirY * d, dt);
    return u1 >= 1;
  }

  private cancelSwing(): void {
    const h = this.hero;
    if (h.swingT >= 0) {
      h.swingT = -1;
      // Refund most of the interval so dodge-cancelling doesn't feel punishing.
      h.attackCd = Math.min(h.attackCd, 0.15);
    }
  }

  /** Direction for rolls and skills: stick if held, else toward the target, else facing. */
  private aimDirection(preferTarget: boolean): void {
    const h = this.hero;
    const t = this.getEnemy(h.targetId);
    const mag = Math.hypot(this.input.moveX, this.input.moveY);
    if (preferTarget && t && isTargetable(t)) normalize(t.x - h.x, t.y - h.y, this.tmp);
    else if (mag > 0.2) normalize(this.input.moveX, this.input.moveY, this.tmp);
    else if (t && isTargetable(t)) normalize(t.x - h.x, t.y - h.y, this.tmp);
    else {
      this.tmp.x = Math.cos(h.facing);
      this.tmp.y = Math.sin(h.facing);
    }
  }

  private startDodge(): void {
    const h = this.hero;
    const tm = this.mods('mine');
    if (tm.dodgeTrap > 0 && h.trapCd <= 0 && h.skills.some((sl) => sl.def.id === 'mine')) {
      h.trapCd = SYNERGY.trap.cooldown;
      this.placeMines(SKILLS.mine, Math.round(tm.dodgeTrap), h.x, h.y);
      this.emit({ type: 'synergy', id: 'trap', x: h.x, y: h.y, targetId: -1 });
    }
    this.aimDirection(false);
    h.dodgeDirX = this.tmp.x;
    h.dodgeDirY = this.tmp.y;
    h.facing = Math.atan2(this.tmp.y, this.tmp.x);
    h.state = 'dodge';
    h.dodgeT = 0;
    h.dodgeCd = h.cls.dodge.cooldown;
    h.dodgeBuffer = 0;
    h.iframeT = Math.max(h.iframeT, h.cls.dodge.iframes);
    if (h.stats.dodgeStrike > 0) h.empowerT = UPGRADE_EFFECT.dodgeStrikeWindow;
    this.cancelSwing();
    this.emit({ type: 'dodge', dirX: h.dodgeDirX, dirY: h.dodgeDirY });
    if (h.stats.emberStep) this.burst(h.x, h.y, EFFECT.emberStep.radius, EFFECT.emberStep.damage, 'ember');
  }

  /** Hero-owned area damage around a point (ember step, crit nova). */
  private burst(x: number, y: number, radius: number, mult: number, source: 'ember' | 'nova', except?: Enemy): void {
    this.emit(source === 'ember' ? { type: 'emberStep', x, y, radius } : { type: 'nova', x, y, radius });
    for (const e of this.enemies) {
      if (e === except || !isTargetable(e) || dist(e.x, e.y, x, y) > radius + e.r) continue;
      this.damageEnemy(e, this.rollHero(mult, false), source, Math.atan2(e.y - y, e.x - x), 1.5);
    }
  }

  // ───────────────────────────── skills ─────────────────────────────

  /** Summed upgrade modifiers of one skill (cached until the next upgrade). */
  mods(id: SkillId): SkillMods {
    let m = this.modCache.get(id);
    if (!m) {
      m = resolveMods(id, this.hero.skillUpgrades);
      this.modCache.set(id, m);
    }
    return m;
  }

  /** Cooldown of a skill now: base × its upgrades × the general cooldown stat, never below the floor. */
  skillCooldown(def: SkillDef): number {
    const m = this.mods(def.id);
    return def.cooldown * Math.max(SKILL_UPGRADE_RULES.minCooldownShare, (1 - m.cooldown) * this.hero.stats.skillCooldownMult);
  }

  /** Slot to cast this step: buffered, off cooldown, and — for target-hungry skills — with something to hit. */
  private readySlot(): number {
    const h = this.hero;
    if (h.skillLock > 0) return -1;
    let best = -1;
    for (let i = 0; i < h.skills.length; i++) {
      const sl = h.skills[i]!;
      if (sl.buffer <= 0 || sl.cd > 0) continue;
      if (SKILL_RULES.needsTarget.includes(sl.def.id) && !this.skillHasTarget(sl.def)) {
        sl.buffer = 0;
        this.emit({ type: 'skillFizzle', slot: i });
        continue;
      }
      if (best < 0 || sl.buffer > h.skills[best]!.buffer) best = i;
    }
    return best;
  }

  private skillHasTarget(def: SkillDef): boolean {
    if (def.id === 'crush') return this.nearestEnemy(def.reach + 0.6, true) !== null;
    if (def.id === 'snipe') return this.nearestEnemy(def.range, true) !== null;
    if (def.id === 'starfall') return this.nearestEnemy(def.range, false) !== null;
    return true;
  }

  /** Closest living, targetable enemy within `range` of the hero (edge to centre), optionally in line of sight. */
  private nearestEnemy(range: number, needSight: boolean): Enemy | null {
    const h = this.hero;
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!isTargetable(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > range + e.r || d >= bd) continue;
      if (needSight && !hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      best = e;
      bd = d;
    }
    return best;
  }

  /** Enemies within `range` of a point and in its line of sight, nearest first. */
  private enemiesNear(x: number, y: number, range: number): Enemy[] {
    return this.enemies
      .filter((e) => isTargetable(e) && dist(x, y, e.x, e.y) <= range + e.r && hasLineOfSight(this.map, x, y, e.x, e.y))
      .sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y));
  }

  // ── what upgrades do (the same few building blocks for every skill) ──

  /** Damage multiplier against this particular enemy (execute, control). */
  private condFactor(e: Enemy, m: SkillMods): number {
    let f = 1;
    if (m.execute > 0 && e.hp / e.maxHp < SKILL_UPGRADE_RULES.executeBelow) f += m.execute;
    if (m.control > 0 && (e.state === 'stunned' || e.frozenT > 0 || e.chillT > 0)) f += m.control;
    return f;
  }

  // ── statuses ──

  /** Sets an enemy on fire. A new ignition refreshes the time and keeps the stronger burn; it never stacks. */
  private applyBurn(e: Enemy, dps: number, generation: number): void {
    if (e.state === 'dead') return;
    const fresh = e.burnT <= 0;
    e.burnT = EFFECT.burn.duration;
    e.burnDps = Math.max(e.burnDps, dps);
    e.burnGen = fresh ? generation : Math.min(e.burnGen, generation);
    if (fresh) this.emit({ type: 'status', id: e.id, status: 'burn', stacks: 1 });
  }

  private applyChill(e: Enemy, seconds: number): void {
    if (e.state === 'dead' || seconds <= 0) return;
    const fresh = e.chillT <= 0;
    e.chillT = Math.min(STATUS.chill.maxDuration, Math.max(e.chillT, seconds));
    if (fresh) this.emit({ type: 'status', id: e.id, status: 'chill', stacks: 1 });
  }

  /** Bleeding: one more stack (up to the limit) and the clock starts over. */
  private applyBleed(e: Enemy): void {
    if (e.state === 'dead') return;
    const was = e.bleedStacks;
    e.bleedStacks = Math.min(STATUS.bleed.maxStacks, was + 1);
    e.bleedT = STATUS.bleed.duration;
    if (was === 0) e.bleedTick = STATUS.bleed.tick;
    if (e.bleedStacks !== was) this.emit({ type: 'status', id: e.id, status: 'bleed', stacks: e.bleedStacks });
  }

  /** Marks an enemy. Only a few can be marked at once: the oldest mark goes first. */
  private applyMark(e: Enemy): void {
    if (e.state === 'dead') return;
    const fresh = e.markT <= 0;
    e.markT = STATUS.mark.duration;
    if (!fresh) return;
    e.markSeq = ++this.markCounter;
    e.markCd = 0;
    this.emit({ type: 'status', id: e.id, status: 'mark', stacks: 1 });
    for (;;) {
      const marked = this.enemies.filter((o) => o.markT > 0 && o.state !== 'dead');
      if (marked.length <= STATUS.mark.maxMarked) break;
      marked.sort((a, b) => a.markSeq - b.markSeq)[0]!.markT = 0;
    }
  }

  /** Statuses from skill upgrades (the `ignite` and `chill` modifiers). */
  private applyStatus(e: Enemy, m: SkillMods): void {
    if (e.state === 'dead') return;
    if (m.ignite > 0) this.applyBurn(e, this.hero.stats.damage * m.ignite, 0);
    if (m.chill > 0) this.applyChill(e, m.chill);
  }

  // ── reactions between skills and statuses ──

  /** Called after a skill's own hit lands (never after reaction damage, which cannot start reactions). */
  private react(e: Enemy, id: SkillId): void {
    if (SYNERGY.rend.consumeBy.includes(id) && e.bleedStacks > 0 && e.state !== 'dead') this.rend(e);
    if (SYNERGY.rend.applyBy.includes(id)) this.applyBleed(e);
    if (SYNERGY.storm.markBy.includes(id)) this.applyMark(e);
  }

  /** Rozerwanie: an area or heavy hit tears the bleeding open — the stacks are spent for burst damage. */
  private rend(e: Enemy): void {
    const stacks = e.bleedStacks;
    e.bleedStacks = 0;
    e.bleedT = 0;
    const amount = Math.max(1, Math.round(this.hero.stats.damage * SYNERGY.rend.perStack * stacks * (e.def.boss ? STATUS.bleed.bossFactor : 1)));
    this.damageEnemy(e, { amount, crit: false }, 'skill', 0, 0);
    this.emit({ type: 'synergy', id: 'rend', x: e.x, y: e.y, targetId: e.id, amount });
  }

  /** Burza znaku: a shot into a marked enemy sends lightning to the nearest others. Arcs never start further arcs. */
  private arc(from: Enemy): void {
    const S = SYNERGY.storm;
    if (from.markCd > 0 || this.arcBudget < 1) return;
    const near = this.enemies
      .filter((o) => o !== from && isTargetable(o) && dist(o.x, o.y, from.x, from.y) <= S.range + o.r)
      .sort((a, b) => dist(a.x, a.y, from.x, from.y) - dist(b.x, b.y, from.x, from.y) || a.id - b.id)
      .slice(0, Math.min(S.targets, Math.floor(this.arcBudget)));
    if (near.length === 0) return;
    from.markCd = S.perMarkCooldown;
    this.arcBudget -= near.length;
    const segments: [number, number, number, number][] = [];
    for (const o of near) {
      segments.push([from.x, from.y, o.x, o.y]);
      this.damageEnemy(o, this.rollHero(S.damage, false), 'arc', Math.atan2(o.y - from.y, o.x - from.x), 1);
    }
    this.emit({ type: 'chain', segments });
    this.emit({ type: 'synergy', id: 'storm', x: from.x, y: from.y, targetId: from.id });
  }

  /** Rozbicie: damage factor of a heavy skill against a frozen enemy. */
  private shatterFactor(e: Enemy, id: SkillId): number {
    return SYNERGY.shatter.heavy.includes(id) && e.frozenT > 0 && e.state !== 'dead' ? 1 + SYNERGY.shatter.bonus : 1;
  }

  /** The ice breaks: the freeze ends (with its cool-off) and the shards chill the enemy. */
  private breakFreeze(e: Enemy): void {
    e.frozenT = 0;
    this.endStun(e);
    this.applyChill(e, SYNERGY.shatter.chill);
    this.emit({ type: 'synergy', id: 'shatter', x: e.x, y: e.y, targetId: e.id });
  }

  /**
   * Rozdmuchanie: the shout fans the flames. Burning enemies in range ignite others near them, up to a few per cast,
   * and fire that was itself spread can only be spread a limited number of times.
   */
  private stoke(x: number, y: number, radius: number): void {
    const S = SYNERGY.stoke;
    const sources = this.enemies.filter((e) => isTargetable(e) && e.burnT > 0 && e.burnGen < STATUS.burn.maxGeneration && dist(x, y, e.x, e.y) <= radius + e.r).sort((a, b) => a.id - b.id);
    let added = 0;
    let first: Enemy | null = null;
    for (const src of sources) {
      const targets = this.enemies
        .filter((o) => o !== src && isTargetable(o) && o.burnT <= 0 && dist(o.x, o.y, src.x, src.y) <= S.spreadRadius + o.r)
        .sort((a, b) => dist(a.x, a.y, src.x, src.y) - dist(b.x, b.y, src.x, src.y) || a.id - b.id);
      for (const o of targets) {
        if (added >= S.maxNew) break;
        this.applyBurn(o, src.burnDps * S.strength, src.burnGen + 1);
        added++;
        first ??= o;
      }
    }
    if (first) this.emit({ type: 'synergy', id: 'stoke', x: first.x, y: first.y, targetId: first.id, amount: added });
  }

  /** Everything a skill hit does besides its damage: statuses, healing, cooldown refund, explosion, reactions. */
  private afterSkillHit(e: Enemy, id: SkillId, m: SkillMods, withBlast: boolean, primary: boolean = withBlast): void {
    const h = this.hero;
    this.applyStatus(e, m);
    if (m.heal > 0) this.heal(h.stats.maxHp * m.heal, true);
    if (m.refund > 0 && h.refundLeft > 0) {
      const slot = h.skills.find((s) => s.def.id === id);
      if (slot) {
        const give = Math.min(m.refund, h.refundLeft);
        slot.cd = Math.max(0, slot.cd - give);
        h.refundLeft -= give;
      }
    }
    if (primary) this.react(e, id);
    if (withBlast && m.blast > 0) this.blast(e.x, e.y, SKILL_UPGRADE_RULES.blastRadius, m.blast, id, e);
  }

  /**
   * One hit of a hero skill, with that skill's upgrades applied. `raw` hits (explosions, ground ticks,
   * finales) use their multiplier as given and never trigger further explosions.
   */
  private skillHit(e: Enemy, id: SkillId, mult: number, angle: number, kb: number, raw = false, noBlast = false): void {
    const m = this.mods(id);
    const base = raw ? mult : mult + m.flat;
    const sf = raw ? 1 : this.shatterFactor(e, id);
    const roll = this.rollHero(base * (1 + m.damage) * this.condFactor(e, m) * sf, false);
    this.damageEnemy(e, roll, 'skill', angle, kb);
    if (e.invulnerable) return;
    this.afterSkillHit(e, id, m, !raw && !noBlast, !raw);
    if (sf > 1 && e.state !== 'dead') this.breakFreeze(e);
  }

  /** An explosion of a hero skill: × attack damage to every enemy in the circle (except `except`). Never chains. */
  private blast(x: number, y: number, radius: number, mult: number, id: SkillId, except?: Enemy): void {
    this.emit({ type: 'skillFx', skill: id, x, y, radius, blast: true });
    for (const o of this.enemies) {
      if (o === except || !isTargetable(o) || dist(o.x, o.y, x, y) > radius + o.r) continue;
      this.skillHit(o, id, mult, Math.atan2(o.y - y, o.x - x), 2, true);
    }
  }

  /** Burning (or freezing) ground that hurts enemies standing in it. */
  private leaveGround(x: number, y: number, r: number, id: SkillId, mult: number): void {
    const ground = this.zones.filter((z) => z.kind === 'ground' && z.life > 0);
    for (let i = 0; i <= ground.length - SKILL_UPGRADE_RULES.groundMax; i++) ground[i]!.life = 0;
    const life = SKILL_UPGRADE_RULES.groundLife;
    this.zones.push({ id: this.nextId++, kind: 'ground', x, y, r, life, maxLife: life, tickT: SKILL_UPGRADE_RULES.groundTick, skill: id, mult });
  }

  private later(t: number, kind: Delayed['kind'], x: number, y: number, mult: number, radius: number, skill: SkillId): void {
    this.delayed.push({ t, kind, x, y, mult, radius, skill });
  }

  private updateDelayed(dt: number): void {
    if (this.delayed.length === 0) return;
    for (const d of this.delayed) d.t -= dt;
    const due = this.delayed.filter((d) => d.t <= 0);
    this.delayed = this.delayed.filter((d) => d.t > 0);
    for (const d of due) {
      if (d.kind === 'burst') this.blast(d.x, d.y, d.radius, d.mult, d.skill);
      else if (d.kind === 'sunder') this.resolveSunder(SKILLS.sunder, d.x, d.y, d.mult);
      else this.castFrostAt(d.x, d.y, d.mult);
    }
  }

  /** Hit back when struck under a Bastion or a Void Ward with the matching upgrade. */
  private retaliate(): void {
    const h = this.hero;
    if (h.retaliateCd > 0) return;
    let mult = 0;
    let id: SkillId = 'bastion';
    if (h.guardT > 0) mult = this.mods('bastion').retaliate;
    if (h.shieldT > 0) {
      const w = this.mods('ward').retaliate;
      if (w > mult) {
        mult = w;
        id = 'ward';
      }
    }
    if (mult <= 0) return;
    h.retaliateCd = SKILL_UPGRADE_RULES.retaliateCooldown;
    this.blast(h.x, h.y, SKILL_UPGRADE_RULES.retaliateRadius, mult, id);
  }

  // ── casting ──

  private startSkill(i: number): void {
    const h = this.hero;
    const slot = h.skills[i]!;
    const sk = slot.def;
    const m = this.mods(sk.id);
    slot.cd = this.skillCooldown(sk);
    slot.buffer = 0;
    h.refundLeft = SKILL_UPGRADE_RULES.refundCap;
    h.skillLock = SKILL_RULES.globalCooldown;
    h.activeSkill = sk;
    h.castSlot = i;
    this.cancelSwing();
    this.emit({ type: 'skillCast', skill: sk.id });
    switch (sk.id) {
      case 'sunder':
      case 'crush':
        h.state = 'cast';
        h.castT = sk.castTime;
        h.vx = h.vy = 0;
        break;
      case 'charge':
        this.aimDirection(false);
        h.dodgeDirX = this.tmp.x;
        h.dodgeDirY = this.tmp.y;
        h.facing = Math.atan2(this.tmp.y, this.tmp.x);
        h.state = 'dash';
        h.dashT = 0;
        h.dashHit = [];
        h.iframeT = Math.max(h.iframeT, sk.duration + 0.05);
        this.emit({ type: 'dash', dirX: h.dodgeDirX, dirY: h.dodgeDirY });
        break;
      case 'volley':
        this.fireVolley(sk);
        break;
      case 'seal':
        this.placeSeal(sk);
        break;
      case 'bastion':
        h.guardT = sk.duration * (1 + m.duration);
        h.guardPower = Math.min(0.85, sk.reduction * (1 + m.potency));
        this.emit({ type: 'skillFx', skill: sk.id, x: h.x, y: h.y, radius: 1.3 });
        break;
      case 'warcry':
        this.castWarcry(sk);
        break;
      case 'axe':
        this.throwAxe(sk);
        break;
      case 'hook':
        this.castHook(sk);
        break;
      case 'banner': {
        this.zones = this.zones.filter((z) => z.kind !== 'banner');
        const life = sk.duration * (1 + m.duration);
        const r = sk.radius * (1 + m.radius);
        this.zones.push({ id: this.nextId++, kind: 'banner', x: h.x, y: h.y, r, life, maxLife: life, tickT: 0, skill: 'banner' });
        this.emit({ type: 'skillFx', skill: sk.id, x: h.x, y: h.y, radius: r });
        break;
      }
      case 'whirl':
        h.whirlT = sk.duration * (1 + m.duration);
        h.whirlTick = 0.05;
        h.whirlMove = Math.min(1, sk.moveMult + (1 - sk.moveMult) * m.potency);
        break;
      case 'pact':
        // the price is real but never lethal
        h.hp = Math.max(1, h.hp - h.stats.maxHp * sk.selfCost);
        h.pactT = sk.duration * (1 + m.duration);
        h.pactPower = sk.damageBonus * (1 + m.potency);
        h.pactLifesteal = sk.lifesteal + m.lifesteal;
        this.emit({ type: 'skillFx', skill: sk.id, x: h.x, y: h.y, radius: 1.4 });
        break;
      case 'snipe':
        this.fireSnipe(sk);
        break;
      case 'blink':
        this.castBlink(sk);
        break;
      case 'ward':
        h.shield = Math.max(h.shield, (sk.flat + sk.hpFraction * h.stats.maxHp) * (1 + m.potency));
        h.shieldT = sk.duration * (1 + m.duration);
        this.emit({ type: 'skillFx', skill: sk.id, x: h.x, y: h.y, radius: 1.3 });
        break;
      case 'frost':
        this.castFrostAt(h.x, h.y, 1);
        if (m.echo > 0) this.later(SKILL_UPGRADE_RULES.echoDelay.frost, 'frost', h.x, h.y, m.echo, 0, 'frost');
        break;
      case 'sentry': {
        const p = this.walkableNear(h.x, h.y);
        this.zones = this.zones.filter((z) => z.kind !== 'sentry');
        const life = sk.duration * (1 + m.duration);
        this.zones.push({ id: this.nextId++, kind: 'sentry', x: p.x, y: p.y, r: sk.range, life, maxLife: life, tickT: 0.3, skill: 'sentry' });
        this.emit({ type: 'skillFx', skill: sk.id, x: p.x, y: p.y, radius: 0.9 });
        break;
      }
      case 'mine':
        this.layMine(sk);
        break;
      case 'starfall':
        this.castStarfall(sk);
        break;
      case 'overload':
        h.overloadT = sk.duration * (1 + m.duration);
        h.overloadHaste = sk.haste * (1 + m.potency);
        this.emit({ type: 'skillFx', skill: sk.id, x: h.x, y: h.y, radius: 1.3 });
        break;
    }
  }

  private resolveCast(): void {
    const sk = this.hero.activeSkill;
    if (sk?.id === 'sunder') this.resolveSunder(sk);
    else if (sk?.id === 'crush') this.resolveCrush(sk);
  }

  /** Rozłam. Called again (at the old spot, weaker) by the Second Quake upgrade. */
  private resolveSunder(S: SunderDef, ax?: number, ay?: number, scale = 1): void {
    const h = this.hero;
    const echo = ax !== undefined;
    const x = echo ? ax : h.x;
    const y = echo ? (ay as number) : h.y;
    const m = this.mods('sunder');
    const radius = S.radius * (1 + m.radius);
    let hits = 0;
    for (const e of this.enemies) {
      if (!isTargetable(e)) continue;
      const d = dist(x, y, e.x, e.y);
      if (d > radius + e.r) continue;
      if (!hasLineOfSight(this.map, x, y, e.x, e.y)) continue;
      hits++;
      const ang = d > 1e-6 ? Math.atan2(e.y - y, e.x - x) : this.rng.range(-Math.PI, Math.PI);
      this.skillHit(e, 'sunder', S.damageMult * scale, ang, S.knockback * (1 - e.def.poise * 0.6), false, echo);
      this.stun(e, S.stun + m.stun);
    }
    this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill);
    this.emit({ type: 'skillImpact', x, y, radius, hits });
    if (!echo) {
      if (m.ground > 0) this.leaveGround(x, y, radius * 0.8, 'sunder', m.ground);
      if (m.echo > 0) this.later(SKILL_UPGRADE_RULES.echoDelay.sunder, 'sunder', x, y, m.echo, 0, 'sunder');
    }
  }

  private dashHits(S: ChargeDef): void {
    const h = this.hero;
    const m = this.mods('charge');
    const width = S.width * (1 + m.radius);
    for (const e of this.enemies) {
      if (!isTargetable(e) || h.dashHit.includes(e.id)) continue;
      if (dist(h.x, h.y, e.x, e.y) > width + e.r) continue;
      h.dashHit.push(e.id);
      // shove enemies off the charge line, slightly forward
      const side = (e.x - h.x) * h.dodgeDirY - (e.y - h.y) * h.dodgeDirX > 0 ? 1 : -1;
      const fwd = Math.atan2(h.dodgeDirY, h.dodgeDirX);
      this.skillHit(e, 'charge', S.damageMult, fwd - side * 1.1, S.knockback * (1 - e.def.poise * 0.6));
      this.stun(e, S.stun + m.stun);
      if (h.dashHit.length === 1) this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill * 0.6);
    }
  }

  /** One huge blow on whoever is nearest when it lands; a miss gives part of the cooldown back. */
  private resolveCrush(S: CrushDef): void {
    const h = this.hero;
    const e = this.nearestEnemy(S.reach, true);
    if (!e) {
      const sl = h.skills[h.castSlot];
      if (sl) sl.cd *= 1 - S.missRefund;
      this.emit({ type: 'whiff' });
      return;
    }
    const m = this.mods('crush');
    const ang = Math.atan2(e.y - h.y, e.x - h.x);
    h.facing = ang;
    this.skillHit(e, 'crush', S.damageMult, ang, S.knockback * (1 - e.def.poise * 0.6));
    this.stun(e, S.stun + m.stun);
    this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill);
    this.emit({ type: 'skillImpact', x: e.x, y: e.y, radius: 1.3, hits: 1 });
  }

  /** Adds velocity to an enemy without damaging it. */
  private shove(e: Enemy, angle: number, force: number): void {
    const k = force * (1 - e.def.poise * 0.6);
    e.kvx += Math.cos(angle) * k;
    e.kvy += Math.sin(angle) * k;
  }

  private castWarcry(S: WarcryDef): void {
    const h = this.hero;
    const m = this.mods('warcry');
    const radius = S.radius * (1 + m.radius);
    for (const e of this.enemies) {
      if (!isTargetable(e) || dist(h.x, h.y, e.x, e.y) > radius + e.r) continue;
      const ang = Math.atan2(e.y - h.y, e.x - h.x);
      // no damage at first; the Thunder upgrade adds some
      if (m.flat > 0) this.skillHit(e, 'warcry', 0, ang, 0);
      this.shove(e, ang, S.knockback);
      this.stun(e, S.stun + m.stun);
    }
    this.stoke(h.x, h.y, radius);
    this.emit({ type: 'skillFx', skill: S.id, x: h.x, y: h.y, radius });
  }

  private castHook(S: HookDef): void {
    const h = this.hero;
    const m = this.mods('hook');
    const radius = S.radius * (1 + m.radius);
    for (const e of this.enemies) {
      const d = dist(h.x, h.y, e.x, e.y);
      if (!isTargetable(e) || d > radius + e.r || !hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      // velocity decays at ENEMY_FRICTION, so the slide covers about force / friction tiles
      const need = Math.max(0, d - S.stopAt) * ENEMY_FRICTION;
      this.skillHit(e, 'hook', S.damageMult, Math.atan2(h.y - e.y, h.x - e.x), need, false, true);
      this.stun(e, S.stun + m.stun);
    }
    if (m.blast > 0) this.later(SKILL_UPGRADE_RULES.hookDetonateDelay, 'burst', h.x, h.y, m.blast, SKILL_UPGRADE_RULES.hookDetonateRadius, 'hook');
    this.emit({ type: 'skillFx', skill: S.id, x: h.x, y: h.y, radius });
  }

  /** Aim of a skill shot: the nearest enemy in sight within `range` (not only the auto-attack target), else the stick, else facing. */
  private aimAtNearest(range: number): number {
    const t = this.nearestEnemy(range, true);
    if (t) normalize(t.x - this.hero.x, t.y - this.hero.y, this.tmp);
    else this.aimDirection(false);
    return Math.atan2(this.tmp.y, this.tmp.x);
  }

  private throwAxe(S: AxeDef): void {
    const h = this.hero;
    const m = this.mods('axe');
    const a = this.aimAtNearest(S.range);
    h.facing = a;
    const n = 1 + m.projectiles;
    for (let i = 0; i < n; i++) {
      const ang = a + (i - (n - 1) / 2) * SKILL_UPGRADE_RULES.fan;
      const roll = this.rollHero((S.damageMult + m.flat) * (1 + m.damage), false);
      this.fireProjectile('hero', 'shard', h.x, h.y, ang, S.speed, S.size, roll, S.pierce + m.pierce + this.heroPierce(), S.range, false, 'axe');
    }
  }

  private fireSnipe(S: SnipeDef): void {
    const h = this.hero;
    const m = this.mods('snipe');
    const first = this.aimAtNearest(S.range);
    h.facing = first;
    const n = 1 + m.projectiles;
    const targets = this.enemiesNear(h.x, h.y, S.range);
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      // extra shots go to the next enemies; with none left they fan out beside the first
      const a = i === 0 ? first : t ? Math.atan2(t.y - h.y, t.x - h.x) : first + (i % 2 ? 1 : -1) * 0.07 * Math.ceil(i / 2);
      const roll = this.rollHero((S.damageMult + m.flat) * (1 + m.damage), false);
      this.fireProjectile('hero', 'shard', h.x, h.y, a, S.speed, S.size, roll, S.pierce + m.pierce + this.heroPierce(), S.range, false, 'snipe');
    }
  }

  /** Hops along the aim line, stopping at walls. The hop itself is the escape: a brief moment of invulnerability. */
  private castBlink(S: BlinkDef): void {
    const h = this.hero;
    const m = this.mods('blink');
    this.aimDirection(false);
    const from = { x: h.x, y: h.y };
    const p = { x: h.x, y: h.y };
    const d = S.distance * (1 + m.radius);
    moveCircle(this.map, p, this.tmp.x * d, this.tmp.y * d, h.r);
    h.x = h.px = p.x;
    h.y = h.py = p.y;
    h.vx = h.vy = 0;
    h.facing = Math.atan2(this.tmp.y, this.tmp.x);
    h.iframeT = Math.max(h.iframeT, S.iframes);
    this.emit({ type: 'skillFx', skill: S.id, x: h.x, y: h.y, radius: 1, x2: from.x, y2: from.y });
    if (m.ground > 0) this.leaveGround(from.x, from.y, 1.4, 'blink', m.ground);
    if (m.blast > 0) {
      this.blast(from.x, from.y, 1.6, m.blast, 'blink');
      this.blast(h.x, h.y, 1.6, m.blast, 'blink');
    }
  }

  /** The freezing ring around (x, y); `scale` < 1 for the echo. */
  private castFrostAt(x: number, y: number, scale: number): void {
    const S = SKILLS.frost;
    const m = this.mods('frost');
    const radius = S.radius * (1 + m.radius);
    const freeze = S.freeze + m.stun;
    for (const e of this.enemies) {
      if (!isTargetable(e) || dist(x, y, e.x, e.y) > radius + e.r || !hasLineOfSight(this.map, x, y, e.x, e.y)) continue;
      this.skillHit(e, 'frost', S.damageMult * scale, Math.atan2(e.y - y, e.x - x), 1.2, false, scale !== 1);
      this.stun(e, freeze);
      if (e.state === 'stunned') e.frozenT = freeze * e.def.stunTaken;
    }
    this.emit({ type: 'skillFx', skill: S.id, x, y, radius });
  }

  private layMine(S: MineDef): void {
    const h = this.hero;
    const m = this.mods('mine');
    this.placeMines(S, 1 + m.projectiles, h.x, h.y);
    this.emit({ type: 'skillFx', skill: S.id, x: h.x, y: h.y, radius: 0.6 });
  }

  /** Lays `n` mines around a point (one exactly on it). The oldest fizzles out when the limit would be passed. */
  private placeMines(S: MineDef, n: number, x: number, y: number): void {
    const m = this.mods('mine');
    const cap = S.max + m.projectiles;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spot = n === 1 ? { x, y } : this.walkableNear(x + Math.cos(a) * 0.9, y + Math.sin(a) * 0.9);
      const live = this.zones.filter((z) => z.kind === 'mine' && z.life > 0);
      for (let k = 0; k <= live.length - cap; k++) live[k]!.life = 0;
      this.zones.push({ id: this.nextId++, kind: 'mine', x: spot.x, y: spot.y, r: S.radius * (1 + m.radius), life: S.duration, maxLife: S.duration, tickT: S.arm, skill: 'mine' });
    }
  }

  private castStarfall(S: StarfallDef): void {
    const h = this.hero;
    const m = this.mods('starfall');
    const targets = this.enemies
      .filter((e) => isTargetable(e) && dist(h.x, h.y, e.x, e.y) <= S.range + e.r)
      .sort((a, b) => dist(h.x, h.y, a.x, a.y) - dist(h.x, h.y, b.x, b.y))
      .slice(0, S.count + m.projectiles);
    for (const e of [...targets].reverse()) this.applyMark(e);
    for (const e of targets) {
      this.zones.push({ id: this.nextId++, kind: 'star', x: e.x, y: e.y, r: S.radius * (1 + m.radius), life: S.delay + 0.1, maxLife: S.delay + 0.1, tickT: S.delay, skill: 'starfall' });
    }
  }

  /** Whirl of Blades: periodic damage around the hero while the timer runs. */
  private updateWhirl(dt: number): void {
    const h = this.hero;
    const S = SKILLS.whirl;
    const m = this.mods('whirl');
    const radius = S.radius * (1 + m.radius);
    h.whirlT = Math.max(0, h.whirlT - dt);
    h.whirlTick -= dt;
    while (h.whirlTick <= 0) {
      h.whirlTick += S.tick;
      for (const e of this.enemies) {
        if (!isTargetable(e) || dist(h.x, h.y, e.x, e.y) > radius + e.r) continue;
        this.skillHit(e, 'whirl', S.damageMult, Math.atan2(e.y - h.y, e.x - h.x), 1.5);
      }
      this.emit({ type: 'skillFx', skill: S.id, x: h.x, y: h.y, radius });
    }
  }

  private fireVolley(S: VolleyDef): void {
    const h = this.hero;
    const m = this.mods('volley');
    this.aimDirection(true);
    const base = Math.atan2(this.tmp.y, this.tmp.x);
    h.facing = base;
    const bolts = S.bolts + m.projectiles;
    const half = ((S.arcDeg + 5 * m.projectiles) / 2) * DEG;
    for (let i = 0; i < bolts; i++) {
      const a = base - half + (bolts === 1 ? half : (2 * half * i) / (bolts - 1));
      const roll = this.rollHero((S.damageMult + m.flat) * (1 + m.damage), false);
      this.fireProjectile('hero', 'shard', h.x, h.y, a, S.speed, h.cls.attack.boltRadius || 0.18, roll, S.pierce + m.pierce + this.heroPierce(), S.range, false, 'volley');
    }
    this.emit({ type: 'volley', angle: base });
  }

  private placeSeal(S: SealDef): void {
    const h = this.hero;
    const m = this.mods('seal');
    const r = S.radius * (1 + m.radius);
    const life = S.duration * (1 + m.duration);
    this.zones.push({ id: this.nextId++, kind: 'seal', x: h.x, y: h.y, r, life, maxLife: life, tickT: 0.05, skill: 'seal' });
    this.emit({ type: 'seal', x: h.x, y: h.y, radius: r });
  }

  /**
   * Hard crowd control. One application never stuns for longer than STATUS.cc.max (bosses: bossMax), a stun that
   * already runs is never shortened, and once it ends the enemy cannot be stunned again for a while (bosses: much longer).
   */
  private stun(e: Enemy, seconds: number): void {
    if (e.state === 'dead' || e.invulnerable) return;
    if (e.state !== 'stunned' && e.ccGrace > 0) return;
    if (e.state === 'windup') this.emit({ type: 'interrupt', id: e.id });
    const fresh = e.state !== 'stunned';
    if (fresh) e.ccElapsed = 0;
    const remaining = fresh ? 0 : e.stateT;
    const cap = e.def.boss ? STATUS.cc.bossMax : STATUS.cc.max;
    // a stun that is already running can only be extended up to the cap in total, however often it is renewed
    const room = Math.max(0, cap - e.ccElapsed);
    e.state = 'stunned';
    e.dashT = 0;
    e.stateT = e.stateDur = Math.max(remaining, Math.min(room, seconds * e.def.stunTaken));
  }

  /** Ends a stun early (a frozen enemy shattered). The cool-off starts now. */
  private endStun(e: Enemy): void {
    if (e.state !== 'stunned' || e.invulnerable) return;
    e.state = 'chase';
    e.stateT = 0;
    e.ccGrace = e.def.boss ? STATUS.cc.bossGrace : STATUS.cc.grace;
  }

  /** Applies damage to the hero, honouring i-frames, mercy frames, barrier and gear reactions. */
  damageHero(amount: number, attacker?: Enemy): boolean {
    const h = this.hero;
    if (h.state === 'dead') return false;
    if (h.iframeT > 0) {
      this.emit({ type: 'evade', x: h.x, y: h.y });
      return false;
    }
    if (h.hurtT > 0) return false;
    let amt = applyReduction(amount, h.stats.armor);
    if (h.guardT > 0) amt *= 1 - h.guardPower;
    h.hurtT = COMMON.hurtIframes;
    this.onHeroStruck(attacker);
    this.retaliate();
    if (h.shield > 0) {
      const absorbed = Math.min(h.shield, amt);
      h.shield -= absorbed;
      amt -= absorbed;
      if (h.shield <= 0) h.shieldT = 0;
      this.emit({ type: 'barrierHit', absorbed, broken: h.shield <= 0 });
      if (amt <= 0) return true;
    }
    if (h.barrier > 0) {
      const absorbed = Math.min(h.barrier, amt);
      h.barrier -= absorbed;
      amt -= absorbed;
      h.barrierT = EFFECT.barrier.delay;
      this.emit({ type: 'barrierHit', absorbed, broken: h.barrier <= 0 });
      if (amt <= 0) return true;
    }
    h.barrierT = EFFECT.barrier.delay;
    h.hp = Math.max(0, h.hp - amt);
    this.emit({ type: 'heroHurt', amount: amt, x: h.x, y: h.y });
    if (h.hp <= 0) {
      h.state = 'dead';
      h.swingT = -1;
      h.castT = 0;
      h.targetId = null;
      this.emit({ type: 'heroDeath' });
    }
    return true;
  }

  /** Thorns and Frost Shell react to being hit. */
  private onHeroStruck(attacker?: Enemy): void {
    const h = this.hero;
    if (attacker && h.stats.thorns > 0 && isTargetable(attacker)) {
      this.damageEnemy(attacker, rollDamage(h.stats.damage * h.stats.thorns, 0, 1, 0, this.rng), 'thorns', Math.atan2(attacker.y - h.y, attacker.x - h.x), 2);
    }
    if (h.stats.frostShell && h.frostCd <= 0) {
      h.frostCd = EFFECT.frostShell.cooldown;
      this.emit({ type: 'frostShell', x: h.x, y: h.y, radius: EFFECT.frostShell.radius });
      for (const e of this.enemies) {
        if (!isTargetable(e) || dist(e.x, e.y, h.x, h.y) > EFFECT.frostShell.radius + e.r) continue;
        this.stun(e, EFFECT.frostShell.freeze);
        if (e.state === 'stunned') e.frozenT = EFFECT.frostShell.freeze * e.def.stunTaken;
      }
    }
  }

  /** Damage that ignores mercy frames (standing in lava). Dodging still avoids it. */
  private hurtByGround(amount: number): void {
    const h = this.hero;
    if (h.state === 'dead' || h.iframeT > 0) return;
    const amt = applyReduction(amount, h.stats.armor) * (h.guardT > 0 ? 1 - h.guardPower : 1);
    h.hp = Math.max(0, h.hp - amt);
    this.emit({ type: 'heroHurt', amount: amt, x: h.x, y: h.y });
    if (h.hp <= 0) {
      h.state = 'dead';
      h.targetId = null;
      this.emit({ type: 'heroDeath' });
    }
  }

  // ───────────────────────────── hero auto-attack ─────────────────────────────

  /** Rolls one hero hit: attack damage × mult, with last-stand and dodge-strike applied. */
  private rollHero(mult: number, canEmpower: boolean): DamageRoll {
    const h = this.hero;
    const s = h.stats;
    let base = s.damage * mult;
    if (s.lastStand > 0 && h.hp / s.maxHp < UPGRADE_EFFECT.lastStandThreshold) base *= 1 + s.lastStand;
    if (h.pactT > 0) base *= 1 + h.pactPower;
    if (canEmpower && h.empowerT > 0 && s.dodgeStrike > 0) {
      h.empowerT = 0;
      return { amount: Math.max(1, Math.round(base * (1 + s.dodgeStrike) * s.critMult)), crit: true };
    }
    return rollDamage(base, s.critChance, s.critMult, 0, this.rng);
  }

  private updateHeroAttack(dt: number): void {
    const h = this.hero;
    if (h.state === 'dead') {
      h.targetId = null;
      return;
    }
    const next = chooseTarget(h.x, h.y, h.targetId, h.targetLockT, this.enemies, this.targeting, (x, y) =>
      hasLineOfSight(this.map, h.x, h.y, x, y),
    );
    if (next !== h.targetId) {
      h.targetId = next;
      h.targetLockT = 0;
    }
    if (h.state === 'dodge' || h.state === 'cast' || h.state === 'dash') return;

    if (h.swingT >= 0) {
      const t = this.getEnemy(h.swingTargetId);
      if (t && isTargetable(t)) h.facing = Math.atan2(t.y - h.y, t.x - h.x);
      h.swingT -= dt;
      if (h.swingT <= 0) {
        h.swingT = -1;
        this.landSwing();
      }
      return;
    }

    if (h.attackCd > 0 || h.targetId === null) return;
    const t = this.getEnemy(h.targetId);
    if (!t) return;
    if (dist(h.x, h.y, t.x, t.y) > h.stats.attackRange) return;
    const angle = Math.atan2(t.y - h.y, t.x - h.x);
    h.swingT = h.cls.attack.windup;
    h.swingTargetId = t.id;
    h.attackCd = this.heroAttackInterval();
    h.facing = angle;
    this.emit({ type: 'swing', targetId: t.id, angle });
  }

  private landSwing(): void {
    const h = this.hero;
    const A = h.cls.attack;
    const t = this.getEnemy(h.swingTargetId);
    h.attackCount++;
    const chain = h.stats.chainEvery > 0 && h.attackCount % h.stats.chainEvery === 0;
    if (A.kind === 'bolt') {
      if (!t || !isTargetable(t)) {
        this.emit({ type: 'whiff' });
        return;
      }
      const angle = Math.atan2(t.y - h.y, t.x - h.x);
      const range = h.stats.attackRange + 1.5;
      this.fireProjectile('hero', 'shard', h.x, h.y, angle, A.boltSpeed, A.boltRadius, this.rollHero(1, true), this.heroPierce(), range, chain, h.overloadT > 0 ? 'overload' : undefined);
      return;
    }
    if (
      !t ||
      !isTargetable(t) ||
      dist(h.x, h.y, t.x, t.y) > h.stats.attackRange + A.landSlack ||
      !hasLineOfSight(this.map, h.x, h.y, t.x, t.y)
    ) {
      this.emit({ type: 'whiff' });
      return;
    }
    const angle = Math.atan2(t.y - h.y, t.x - h.x);
    const roll = this.rollHero(1, true);
    this.damageEnemy(t, roll, 'attack', angle, A.knockback);
    if (roll.crit) this.hitstop = Math.max(this.hitstop, COMMON.hitstop.crit);
    if (chain) this.chainFrom(t);

    const halfArc = (h.stats.cleaveArcDeg / 2) * DEG;
    for (const e of this.enemies) {
      if (e === t || !isTargetable(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > h.stats.attackRange + e.r * 0.5) continue;
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      if (Math.abs(angleDiff(angle, a)) > halfArc) continue;
      if (!hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      this.damageEnemy(e, this.rollHero(h.stats.cleaveRatio, false), 'cleave', a, A.knockback * 0.6);
    }
  }

  /** Chain lightning from one enemy to its nearest neighbours. */
  private chainFrom(from: Enemy): void {
    const C = EFFECT.chain;
    const near = this.enemies
      .filter((e) => e !== from && isTargetable(e) && dist(e.x, e.y, from.x, from.y) <= C.range)
      .sort((a, b) => dist(a.x, a.y, from.x, from.y) - dist(b.x, b.y, from.x, from.y))
      .slice(0, C.targets);
    if (near.length === 0) return;
    const segments: [number, number, number, number][] = [];
    let prev = from;
    for (const e of near) {
      segments.push([prev.x, prev.y, e.x, e.y]);
      this.damageEnemy(e, this.rollHero(C.damage, false), 'chain', Math.atan2(e.y - prev.y, e.x - prev.x), 1);
      prev = e;
    }
    this.emit({ type: 'chain', segments });
  }

  damageEnemy(e: Enemy, roll: DamageRoll, source: DamageSource, kbAngle: number, kbForce: number): void {
    if (e.state === 'dead') return;
    if (e.invulnerable) {
      this.emit({ type: 'immune', id: e.id, x: e.x, y: e.y });
      return;
    }
    const h = this.hero;
    const fromHero = HERO_SOURCES.has(source);
    let amount = roll.amount;
    if (fromHero && h.stats.executioner && e.hp / e.maxHp < EFFECT.executioner.threshold) amount = Math.round(amount * (1 + EFFECT.executioner.bonus));
    e.hp = Math.max(0, e.hp - amount);
    this.emit({ type: 'damage', targetId: e.id, amount, crit: roll.crit, x: e.x, y: e.y, source });
    if (fromHero && h.stats.leech > 0) this.heal(amount * h.stats.leech, true);
    if (fromHero && h.pactT > 0) this.heal(amount * h.pactLifesteal, true);
    if ((source === 'attack' || source === 'cleave' || source === 'bolt') && h.stats.burn > 0) {
      // re-applying refreshes the burn rather than stacking it
      e.burnT = EFFECT.burn.duration;
      e.burnDps = h.stats.damage * h.stats.burn;
      e.burnGen = 0;
    }
    if (fromHero && roll.crit && h.stats.critNova && h.novaCd <= 0 && source !== 'nova') {
      h.novaCd = EFFECT.critNova.cooldown;
      this.burst(e.x, e.y, EFFECT.critNova.radius, EFFECT.critNova.damage, 'nova', e);
    }
    if (e.def.boss && e.phase === 1 && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
      this.enterPhaseTwo(e);
      return;
    }
    const k = kbForce * (1 - e.def.poise);
    if (e.hp <= 0) {
      this.killEnemy(e, source, kbAngle, k);
      return;
    }
    e.kvx += Math.cos(kbAngle) * k;
    e.kvy += Math.sin(kbAngle) * k;
    // Light hits never cancel a wind-up: the player must dodge or use the skill.
    if (e.def.poise < 0.5 && e.state !== 'windup' && e.state !== 'stunned' && source !== 'burn') e.flinchT = 0.14;
  }

  private enterPhaseTwo(e: Enemy): void {
    const boss = e.def.boss!;
    e.phase = 2;
    e.invulnerable = true;
    e.state = 'stunned';
    e.dashT = 0;
    e.stateT = e.stateDur = boss.roar;
    e.lastAttack = -1;
    this.pickBossAttack(e);
    this.emit({ type: 'bossPhase', id: e.id });
  }

  private killEnemy(e: Enemy, source: DamageSource, kbAngle: number, k: number): void {
    const h = this.hero;
    e.state = 'dead';
    e.deadT = 0;
    e.burnT = 0;
    e.bleedT = 0;
    e.bleedStacks = 0;
    e.markT = 0;
    e.dashT = 0;
    e.kvx = Math.cos(kbAngle) * (k + 1.5);
    e.kvy = Math.sin(kbAngle) * (k + 1.5);
    this.kills++;
    this.emit({ type: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y });
    if (e.def.boss) this.emit({ type: 'bossDeath', id: e.id, kind: e.kind, x: e.x, y: e.y });
    if (!e.minion) {
      for (let i = 0; i < e.def.ash; i++) this.addPickup('ash', e.x, e.y, 1);
      if (this.rng.chance(RUN.healDropChance)) this.addPickup('heal', e.x, e.y, RUN.healAmount);
      if (!e.def.boss) {
        const tough = e.kind === 'brute' || e.kind === 'hound';
        if (this.rng.chance(tough ? DROPS.toughEnemyChance : DROPS.enemyChance)) this.dropItem('enemy', e.x, e.y);
      }
    }
    if (h.stats.lifeOnKill > 0) this.heal(h.stats.lifeOnKill);
    if (h.stats.frenzy) h.frenzyT = EFFECT.frenzy.duration;
    this.grantXp(Math.round(e.def.xp * e.xpScale * (e.minion ? 0.3 : 1)));
    if (h.stats.shatter > 0 && source !== 'shatter') {
      const R = UPGRADE_EFFECT.shatterRadius;
      this.emit({ type: 'shatter', x: e.x, y: e.y, radius: R });
      for (const o of this.enemies) {
        if (o === e || !isTargetable(o) || dist(o.x, o.y, e.x, e.y) > R + o.r) continue;
        const roll = rollDamage(h.stats.damage * h.stats.shatter, 0, 1, 0, this.rng);
        this.damageEnemy(o, roll, 'shatter', Math.atan2(o.y - e.y, o.x - e.x), 1.2);
      }
    }
  }

  /** Kills every boss minion still standing (when their master falls). */
  killMinions(): void {
    for (const e of this.enemies) if (e.minion && e.state !== 'dead') this.killEnemy(e, 'skill', 0, 0);
  }

  grantXp(amount: number): void {
    const h = this.hero;
    if (amount <= 0 || h.state === 'dead') return;
    h.xp += amount;
    this.emit({ type: 'xp', amount });
    while (h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level++;
      this.emit({ type: 'levelUp', level: h.level });
      this.queueChoice('level');
    }
  }

  // ───────────────────────────── projectiles, zones, hazards, traps, pickups ─────────────────────────────

  private fireProjectile(
    team: Projectile['team'],
    kind: Projectile['kind'],
    x: number,
    y: number,
    angle: number,
    speed: number,
    r: number,
    roll: DamageRoll,
    pierce: number,
    range: number,
    chain = false,
    skill?: SkillId,
  ): void {
    const sx = x + Math.cos(angle) * 0.35;
    const sy = y + Math.sin(angle) * 0.35;
    this.projectiles.push({
      id: this.nextId++,
      team,
      kind,
      x: sx,
      y: sy,
      px: sx,
      py: sy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r,
      damage: roll.amount,
      crit: roll.crit,
      pierceLeft: pierce,
      life: range / speed,
      hit: [],
      chain,
      skill,
    });
    this.emit({ type: 'shoot', team, x: sx, y: sy, angle });
  }

  private updateProjectiles(dt: number): void {
    const h = this.hero;
    for (const p of this.projectiles) {
      p.life -= dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 0.2));
      for (let s = 0; s < steps && p.life > 0; s++) {
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        if (blocksSight(tileAt(this.map, Math.floor(p.x), Math.floor(p.y)))) {
          p.life = 0;
          break;
        }
        if (p.team === 'hero') {
          for (const e of this.enemies) {
            if (!isTargetable(e) || p.hit.includes(e.id)) continue;
            if (dist(p.x, p.y, e.x, e.y) > p.r + e.r) continue;
            p.hit.push(e.id);
            const pm = p.skill ? this.mods(p.skill) : null;
            const wasMarked = e.markT > 0;
            const sf = p.skill ? this.shatterFactor(e, p.skill) : 1;
            const amount = pm && p.skill ? Math.max(1, Math.round(p.damage * this.condFactor(e, pm) * sf)) : p.damage;
            this.damageEnemy(e, { amount, crit: p.crit }, 'bolt', Math.atan2(p.vy, p.vx), h.cls.attack.knockback || 0.8);
            if (pm && p.skill && !e.invulnerable) {
              this.afterSkillHit(e, p.skill, pm, true);
              if (sf > 1 && e.state !== 'dead') this.breakFreeze(e);
              if (wasMarked && SYNERGY.storm.triggerBy.includes(p.skill)) this.arc(e);
            }
            if (p.chain && p.hit.length === 1) this.chainFrom(e);
            if (p.crit) this.hitstop = Math.max(this.hitstop, COMMON.hitstop.crit * 0.5);
            if (--p.pierceLeft < 0) {
              p.life = 0;
              break;
            }
          }
        } else if (h.state !== 'dead' && dist(p.x, p.y, h.x, h.y) <= p.r + h.r) {
          // A dodged ember flies on; a landed one is spent.
          if (this.damageHero(p.damage)) p.life = 0;
        }
      }
      if (p.life <= 0) this.emit({ type: 'projectileEnd', team: p.team, x: p.x, y: p.y });
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  private updateZones(dt: number): void {
    const h = this.hero;
    h.inBanner = false;
    h.bannerHaste = 0;
    for (const e of this.enemies) e.slowMul = e.chillT > 0 ? (e.def.boss ? STATUS.chill.bossSlow : STATUS.chill.slow) : 1;
    for (const z of this.zones) {
      z.life -= dt;
      if (z.kind === 'seal') {
        const S = SKILLS.seal;
        z.tickT -= dt;
        const tick = z.tickT <= 0;
        if (tick) z.tickT += S.tick;
        for (const e of this.enemies) {
          if (!isTargetable(e) || dist(e.x, e.y, z.x, z.y) > z.r + e.r) continue;
          e.slowMul = Math.min(e.slowMul, S.slow);
          if (tick) this.skillHit(e, 'seal', S.damageMult, Math.atan2(e.y - z.y, e.x - z.x), 0.3);
        }
        const fin = this.mods('seal').finale;
        if (z.life <= 0 && fin > 0) this.blast(z.x, z.y, z.r, fin, 'seal');
      } else if (z.kind === 'banner') {
        if (h.state !== 'dead' && dist(z.x, z.y, h.x, h.y) <= z.r) {
          const pot = 1 + this.mods('banner').potency;
          h.inBanner = true;
          h.bannerHaste = SKILLS.banner.haste * pot;
          this.heal(h.stats.maxHp * SKILLS.banner.regen * pot * dt, true);
        }
      } else if (z.kind === 'sentry') {
        const S = SKILLS.sentry;
        const m = this.mods('sentry');
        z.tickT -= dt;
        if (z.tickT <= 0) {
          const list = this.enemiesNear(z.x, z.y, S.range);
          if (list.length > 0) {
            z.tickT += S.interval;
            const n = 1 + m.projectiles;
            for (let i = 0; i < n; i++) {
              // with fewer enemies than shots the nearest takes the extra ones, fanned a little
              const t = list[i] ?? list[0]!;
              const a = Math.atan2(t.y - z.y, t.x - z.x) + (i >= list.length ? 0.08 * (i - list.length + 1) * (i % 2 ? 1 : -1) : 0);
              const roll = this.rollHero((S.damageMult + m.flat) * (1 + m.damage), false);
              this.fireProjectile('hero', 'shard', z.x, z.y, a, S.speed, 0.18, roll, m.pierce, S.range + 1, false, 'sentry');
            }
          } else z.tickT = 0.15;
        }
        if (z.life <= 0 && m.finale > 0) this.blast(z.x, z.y, 2.2, m.finale, 'sentry');
      } else if (z.kind === 'mine') {
        z.tickT = Math.max(0, z.tickT - dt);
        const M = SKILLS.mine;
        if (z.tickT === 0 && this.enemies.some((e) => isTargetable(e) && dist(e.x, e.y, z.x, z.y) <= M.trigger + e.r)) {
          const m = this.mods('mine');
          for (const e of this.enemies) {
            if (!isTargetable(e) || dist(e.x, e.y, z.x, z.y) > z.r + e.r) continue;
            this.skillHit(e, 'mine', M.damageMult, Math.atan2(e.y - z.y, e.x - z.x), 5);
            this.stun(e, M.stun + m.stun);
          }
          this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill * 0.6);
          this.emit({ type: 'skillFx', skill: 'mine', x: z.x, y: z.y, radius: z.r });
          z.life = 0;
        }
      } else if (z.kind === 'star') {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          const S = SKILLS.starfall;
          const m = this.mods('starfall');
          for (const e of this.enemies) {
            if (!isTargetable(e) || dist(e.x, e.y, z.x, z.y) > z.r + e.r) continue;
            this.skillHit(e, 'starfall', S.damageMult, Math.atan2(e.y - z.y, e.x - z.x), 3);
          }
          this.emit({ type: 'skillFx', skill: 'starfall', x: z.x, y: z.y, radius: z.r });
          if (m.ground > 0) this.leaveGround(z.x, z.y, z.r * 0.8, 'starfall', m.ground);
          z.life = 0;
        }
      } else if (z.kind === 'ground' && z.skill) {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += SKILL_UPGRADE_RULES.groundTick;
          for (const e of this.enemies) {
            if (!isTargetable(e) || dist(e.x, e.y, z.x, z.y) > z.r + e.r) continue;
            this.skillHit(e, z.skill, z.mult ?? 0, Math.atan2(e.y - z.y, e.x - z.x), 0.2, true);
          }
        }
      }
    }
    this.zones = this.zones.filter((z) => z.life > 0);
  }

  addHazard(kind: Hazard['kind'], x: number, y: number, r: number, delay: number, damage: number, hurtsEnemies = false): void {
    const p = this.walkableNear(x, y);
    this.hazards.push({ id: this.nextId++, kind, x: p.x, y: p.y, r, t: 0, delay, damage, hurtsEnemies });
  }

  private updateHazards(dt: number): void {
    const h = this.hero;
    for (const z of this.hazards) {
      z.t += dt;
      if (z.t < z.delay) continue;
      this.emit({ type: 'hazardBlast', kind: z.kind, x: z.x, y: z.y, radius: z.r });
      if (dist(z.x, z.y, h.x, h.y) <= z.r + h.r) this.damageHero(z.damage);
      if (z.hurtsEnemies)
        for (const e of this.enemies)
          if (isTargetable(e) && dist(z.x, z.y, e.x, e.y) <= z.r + e.r) this.damageEnemy(e, { amount: z.damage, crit: false }, 'trap', Math.atan2(e.y - z.y, e.x - z.x), 3);
    }
    this.hazards = this.hazards.filter((z) => z.t < z.delay);
  }

  /** Spike and vent cycles, lava burns. Traps hurt enemies too. */
  private updateTraps(dt: number): void {
    const h = this.hero;
    for (const t of this.traps) {
      if (t.kind !== 'spikes' && t.kind !== 'vent') continue;
      const T = t.kind === 'spikes' ? TRAPS.spikes : TRAPS.vent;
      const local = (this.time + t.phase) % T.period;
      const cycle = Math.floor((this.time + t.phase) / T.period);
      if (local < T.up) continue;
      if (cycle !== t.cycle) {
        t.cycle = cycle;
        t.hit = [];
        this.emit({ type: 'trapFire', kind: t.kind, x: t.tx + 0.5, y: t.ty + 0.5 });
      }
      const inside = (x: number, y: number, r: number) =>
        t.kind === 'spikes'
          ? x + r * 0.4 > t.tx && x - r * 0.4 < t.tx + 1 && y + r * 0.4 > t.ty && y - r * 0.4 < t.ty + 1
          : dist(x, y, t.tx + 0.5, t.ty + 0.5) <= TRAPS.vent.radius + r * 0.5;
      if (h.state !== 'dead' && !t.hit.includes(0) && inside(h.x, h.y, h.r)) {
        t.hit.push(0);
        this.damageHero(T.damage);
      }
      for (const e of this.enemies) {
        if (!isTargetable(e) || t.hit.includes(e.id) || e.def.boss || !inside(e.x, e.y, e.r)) continue;
        t.hit.push(e.id);
        this.damageEnemy(e, { amount: T.enemyDamage, crit: false }, 'trap', this.rng.range(-Math.PI, Math.PI), 1);
      }
    }
    // lava ticks: the hero and enemies standing in it burn
    h.lavaT -= dt;
    if (h.lavaT <= 0 && this.trapAt(h.x, h.y) === 'lava') {
      h.lavaT = TRAPS.lava.tick;
      this.hurtByGround(TRAPS.lava.damage);
    }
    this.lavaTick -= dt;
    if (this.lavaTick <= 0) {
      this.lavaTick = TRAPS.lava.tick;
      for (const e of this.enemies)
        if (isTargetable(e) && !e.def.boss && this.trapAt(e.x, e.y) === 'lava') this.damageEnemy(e, { amount: TRAPS.lava.enemyDamage, crit: false }, 'trap', 0, 0);
    }
  }

  private updatePickups(dt: number): void {
    const h = this.hero;
    const decay = Math.exp(-6 * dt);
    for (const p of this.pickups) {
      p.age += dt;
      const d = dist(p.x, p.y, h.x, h.y);
      if (h.state !== 'dead' && p.age > 0.35 && d < RUN.magnetRadius) {
        const pull = 4 + 10 * (1 - d / RUN.magnetRadius);
        p.vx = ((h.x - p.x) / Math.max(d, 0.01)) * pull;
        p.vy = ((h.y - p.y) / Math.max(d, 0.01)) * pull;
      } else {
        p.vx *= decay;
        p.vy *= decay;
      }
      this.tmp.x = p.x;
      this.tmp.y = p.y;
      moveCircle(this.map, this.tmp, p.vx * dt, p.vy * dt, 0.12);
      p.x = this.tmp.x;
      p.y = this.tmp.y;
      if (h.state !== 'dead' && p.age > 0.35 && dist(p.x, p.y, h.x, h.y) < 0.45) {
        p.age = -1; // collected
        if (p.kind === 'ash') this.ash += p.amount;
        else if (p.kind === 'heal') this.heal(p.amount);
        if (p.kind === 'item' && p.item) {
          this.loot.push(p.item);
          this.emit({ type: 'loot', item: p.item });
        } else this.emit({ type: 'pickup', kind: p.kind as 'ash' | 'heal', amount: p.amount, x: p.x, y: p.y });
      }
    }
    this.pickups = this.pickups.filter((p) => p.age >= 0);
  }

  // ───────────────────────────── enemies ─────────────────────────────

  private updateEnemies(dt: number): void {
    const h = this.hero;
    this.flow.setGoal(Math.floor(h.x), Math.floor(h.y));
    const decay = Math.exp(-ENEMY_FRICTION * dt);
    for (const e of this.enemies) {
      if (e.kvx !== 0 || e.kvy !== 0) {
        this.tmp.x = e.x;
        this.tmp.y = e.y;
        moveCircle(this.map, this.tmp, e.kvx * dt, e.kvy * dt, e.r);
        e.x = this.tmp.x;
        e.y = this.tmp.y;
        e.kvx *= decay;
        e.kvy *= decay;
        if (Math.abs(e.kvx) + Math.abs(e.kvy) < 0.02) e.kvx = e.kvy = 0;
      }
      if (e.state === 'dead') {
        e.deadT += dt;
        continue;
      }
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.flinchT = Math.max(0, e.flinchT - dt);
      e.frozenT = Math.max(0, e.frozenT - dt);
      e.chillT = Math.max(0, e.chillT - dt);
      e.ccGrace = Math.max(0, e.ccGrace - dt);
      e.markT = Math.max(0, e.markT - dt);
      e.markCd = Math.max(0, e.markCd - dt);
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = EFFECT.burn.tick;
          this.damageEnemy(e, { amount: Math.max(1, Math.round(e.burnDps * EFFECT.burn.tick)), crit: false }, 'burn', 0, 0);
          if (e.hp <= 0) continue; // the burn finished it
        }
        if (e.burnT <= 0) e.burnDps = 0;
      }
      if (e.bleedT > 0) {
        e.bleedT -= dt;
        e.bleedTick -= dt;
        if (e.bleedTick <= 0) {
          e.bleedTick += STATUS.bleed.tick;
          const part = h.stats.damage * STATUS.bleed.dpsPerStack * e.bleedStacks * STATUS.bleed.tick * (e.def.boss ? STATUS.bleed.bossFactor : 1);
          this.damageEnemy(e, { amount: Math.max(1, Math.round(part)), crit: false }, 'bleed', 0, 0);
          if (e.hp <= 0) continue; // the bleeding finished it
        }
        if (e.bleedT <= 0) e.bleedStacks = 0;
      }
      if (e.dashT > 0) this.enemyDash(e, dt);

      switch (e.state) {
        case 'spawning':
        case 'stunned':
        case 'recover':
          if (e.state === 'stunned') e.ccElapsed += dt;
          e.stateT -= dt;
          if (e.stateT <= 0) {
            if (e.state === 'stunned') e.ccGrace = e.def.boss ? STATUS.cc.bossGrace : STATUS.cc.grace;
            e.state = 'chase';
            e.invulnerable = false;
          }
          break;
        case 'windup': {
          e.stateT -= dt;
          const A = e.atk;
          const elapsed = e.stateDur - e.stateT;
          if (h.state !== 'dead' && elapsed < A.trackFraction * e.stateDur) {
            const want = Math.atan2(h.y - e.y, h.x - e.x);
            e.aim = turnToward(e.aim, want, A.turnRate * DEG * dt);
          }
          e.facing = e.aim;
          if (e.stateT <= 0) this.enemyStrike(e);
          break;
        }
        case 'chase':
          this.enemyChase(e, dt);
          break;
      }
    }
  }

  /** Bosses pick their next attack from the current phase, never the same one twice in a row. */
  private pickBossAttack(e: Enemy): void {
    const list = e.def.boss!.phases[e.phase - 1]!;
    let i = this.rng.int(0, list.length - 1);
    if (list.length > 1 && i === e.lastAttack) i = (i + 1) % list.length;
    e.lastAttack = i;
    e.atk = list[i]!;
  }

  private enemyChase(e: Enemy, dt: number): void {
    const h = this.hero;
    if (h.state === 'dead') return;
    const A = e.atk;
    const d = dist(e.x, e.y, h.x, h.y);
    const toHero = Math.atan2(h.y - e.y, h.x - e.x);
    const los = hasLineOfSight(this.map, e.x, e.y, h.x, h.y);
    e.facing = toHero;

    const ignoresSight = A.shape.kind === 'summon' || A.shape.kind === 'meteors';
    if (d <= A.triggerRange && e.attackCd <= 0 && (los || ignoresSight) && e.flinchT <= 0) {
      e.state = 'windup';
      e.stateT = e.stateDur = A.windup;
      e.aim = toHero;
      this.emit({ type: 'windup', id: e.id, kind: e.kind });
      if (A.shape.kind === 'meteors') {
        // the blasts are placed now, so their circles are the telegraph
        for (let i = 0; i < A.shape.count; i++) {
          const a = this.rng.range(-Math.PI, Math.PI);
          const r = i === 0 ? 0 : this.rng.range(0.8, A.shape.spread);
          this.addHazard(e.kind === 'bossFrost' ? 'frost' : 'meteor', h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, A.shape.radius, A.shape.delay + i * 0.12, A.damage * e.dmgScale);
        }
      }
      return;
    }
    if (e.flinchT > 0) return;

    let dirX: number;
    let dirY: number;
    let speed = e.def.speed;
    const keep = e.def.keepAway;
    const ranged = A.shape.kind === 'bolt' || A.shape.kind === 'lob' || A.shape.kind === 'radial' || A.shape.kind === 'meteors' || A.shape.kind === 'summon';
    if (keep && ranged && los && d < keep.min) {
      // casters back off when the hero gets close
      dirX = -Math.cos(toHero);
      dirY = -Math.sin(toHero);
    } else if (keep && ranged && los && d <= keep.max) {
      const side = e.flankAngle >= 0 ? 1 : -1;
      dirX = -Math.sin(toHero) * side;
      dirY = Math.cos(toHero) * side;
      speed *= 0.4;
    } else if (!keep && A.shape.kind !== 'charge' && los && d <= Math.min(A.triggerRange * 0.9, e.r + h.r + 0.35)) {
      // In reach but on cooldown: circle the hero slowly, inside the hero's own reach —
      // an enemy waiting on its cooldown is the hero's counter-attack window.
      const side = e.flankAngle >= 0 ? 1 : -1;
      dirX = -Math.sin(toHero) * side;
      dirY = Math.cos(toHero) * side;
      speed *= 0.35;
    } else if (los && hasClearPath(this.map, e.x, e.y, h.x, h.y, e.r)) {
      // Approach from our own side of the hero, fanned out by flankAngle, so packs surround.
      let tx = h.x;
      let ty = h.y;
      if (d > 2.4) {
        const from = Math.atan2(e.y - h.y, e.x - h.x) + e.flankAngle;
        tx = h.x + Math.cos(from) * 1.2;
        ty = h.y + Math.sin(from) * 1.2;
      }
      normalize(tx - e.x, ty - e.y, this.tmp);
      dirX = this.tmp.x;
      dirY = this.tmp.y;
    } else {
      const wp = this.flow.nextWaypoint(Math.floor(e.x), Math.floor(e.y));
      normalize((wp ? wp.x : h.x) - e.x, (wp ? wp.y : h.y) - e.y, this.tmp);
      dirX = this.tmp.x;
      dirY = this.tmp.y;
    }
    speed *= e.slowMul * isoMoveScale(dirX, dirY, ISO);
    this.tmp.x = e.x;
    this.tmp.y = e.y;
    moveCircle(this.map, this.tmp, dirX * speed * dt, dirY * speed * dt, e.r);
    e.x = this.tmp.x;
    e.y = this.tmp.y;
  }

  private enemyStrike(e: Enemy): void {
    const h = this.hero;
    const A = e.atk;
    const S = A.shape;
    let hit = false;
    const damage = A.damage * e.dmgScale;
    switch (S.kind) {
      case 'bolt':
        this.fireProjectile('enemy', 'ember', e.x, e.y, e.aim, S.speed, S.radius, { amount: Math.round(damage), crit: false }, 0, S.range);
        break;
      case 'radial':
        for (let i = 0; i < S.bolts; i++) {
          const a = e.aim + (i / S.bolts) * Math.PI * 2;
          this.fireProjectile('enemy', 'ember', e.x, e.y, a, S.speed, S.radius, { amount: Math.round(damage), crit: false }, 0, S.range);
        }
        break;
      case 'charge':
        e.dashT = S.distance / S.speed;
        e.dashHit = false;
        this.emit({ type: 'enemyCharge', id: e.id });
        break;
      case 'lob':
        this.addHazard('bomb', h.x, h.y, S.radius, S.delay, damage, true);
        break;
      case 'summon':
        S.kinds.forEach((kind, i) => {
          const a = (i / S.kinds.length) * Math.PI * 2 + this.rng.range(0, 1);
          const p = this.walkableNear(e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2);
          this.spawnEnemy(kind, p.x, p.y, { minion: true, hpScale: 1 + (this.depth - 1) * 0.3, dmgScale: e.dmgScale, delay: i * 0.1 });
        });
        break;
      case 'meteors':
        break; // already placed at wind-up
      case 'cone':
      case 'circle':
        if (h.state !== 'dead' && hasLineOfSight(this.map, e.x, e.y, h.x, h.y)) {
          let inside = false;
          if (S.kind === 'cone') {
            const d = dist(e.x, e.y, h.x, h.y);
            if (d <= S.radius + h.r) {
              const a = Math.atan2(h.y - e.y, h.x - e.x);
              const slack = Math.asin(Math.min(1, h.r / Math.max(d, 0.01)));
              inside = Math.abs(angleDiff(e.aim, a)) <= (S.arcDeg / 2) * DEG + slack;
            }
          } else {
            const cx = e.x + Math.cos(e.aim) * S.offset;
            const cy = e.y + Math.sin(e.aim) * S.offset;
            inside = dist(cx, cy, h.x, h.y) <= S.radius + h.r;
          }
          if (inside) hit = this.damageHero(damage, e);
        }
        break;
    }
    this.emit({ type: 'strike', id: e.id, kind: e.kind, hit });
    e.state = 'recover';
    e.stateT = e.stateDur = A.recovery + (S.kind === 'charge' ? e.dashT : 0);
    e.attackCd = A.cooldown;
    if (e.def.boss) this.pickBossAttack(e);
  }

  /** A charging enemy runs its lane; touching the hero hurts once; walls stop it. */
  private enemyDash(e: Enemy, dt: number): void {
    const h = this.hero;
    const S = e.atk.shape;
    if (S.kind !== 'charge') {
      e.dashT = 0;
      return;
    }
    e.dashT -= dt;
    const step = S.speed * dt;
    this.tmp.x = e.x;
    this.tmp.y = e.y;
    moveCircle(this.map, this.tmp, Math.cos(e.aim) * step, Math.sin(e.aim) * step, e.r);
    const moved = dist(this.tmp.x, this.tmp.y, e.x, e.y);
    e.x = this.tmp.x;
    e.y = this.tmp.y;
    if (!e.dashHit && h.state !== 'dead' && dist(e.x, e.y, h.x, h.y) <= e.r + h.r + S.width * 0.5) {
      e.dashHit = true;
      this.damageHero(e.atk.damage * e.dmgScale, e);
    }
    if (moved < step * 0.3 || e.dashT <= 0) e.dashT = 0;
  }

  /** Soft body separation. Mass decides who yields; a rolling or charging hero passes through. */
  private separateBodies(): void {
    const list = this.enemies;
    const h = this.hero;
    const heroSolid = h.state !== 'dead' && h.state !== 'dodge' && h.state !== 'dash';
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Enemy;
      if (a.state === 'dead' || a.state === 'spawning') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Enemy;
        if (b.state === 'dead' || b.state === 'spawning') continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.0001;
        const overlap = min - d;
        const nx = d2 > 0 ? dx / d : 1;
        const ny = d2 > 0 ? dy / d : 0;
        const total = a.def.mass + b.def.mass;
        a.x -= nx * overlap * (b.def.mass / total);
        a.y -= ny * overlap * (b.def.mass / total);
        b.x += nx * overlap * (a.def.mass / total);
        b.y += ny * overlap * (a.def.mass / total);
      }
      if (heroSolid && a.dashT <= 0) {
        const dx = a.x - h.x;
        const dy = a.y - h.y;
        const min = a.r + h.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          const overlap = min - d;
          const nx = d2 > 0 ? dx / d : 1;
          const ny = d2 > 0 ? dy / d : 0;
          // The hero is sturdy: it yields at most half of its mass share.
          const heroShare = (a.def.mass / (a.def.mass + COMMON.heroMass)) * 0.5;
          h.x -= nx * overlap * heroShare;
          h.y -= ny * overlap * heroShare;
          a.x += nx * overlap * (1 - heroShare);
          a.y += ny * overlap * (1 - heroShare);
        }
      }
    }
    for (const e of list) {
      if (e.state === 'dead' || e.state === 'spawning') continue;
      this.tmp.x = e.x;
      this.tmp.y = e.y;
      resolveCircleVsGrid(this.map, this.tmp, e.r);
      e.x = this.tmp.x;
      e.y = this.tmp.y;
    }
    this.tmp.x = h.x;
    this.tmp.y = h.y;
    resolveCircleVsGrid(this.map, this.tmp, h.r);
    h.x = this.tmp.x;
    h.y = this.tmp.y;
  }

  /** Finds a walkable spot near (x, y), or returns it unchanged. */
  walkableNear(x: number, y: number): { x: number; y: number } {
    if (isWalkable(this.map, Math.floor(x), Math.floor(y))) return { x, y };
    for (let r = 1; r <= 3; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++)
          if (isWalkable(this.map, Math.floor(x) + ox, Math.floor(y) + oy)) return { x: Math.floor(x) + ox + 0.5, y: Math.floor(y) + oy + 0.5 };
    return { x, y };
  }
}

