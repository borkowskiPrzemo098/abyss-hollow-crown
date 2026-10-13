import { COMMON, ENEMIES, ENEMY_FRICTION, type EnemyKind } from '../config/balance';
import { TRAPS } from '../config/biomes';
import { HEROES } from '../config/heroes';
import { DROPS, EFFECT, type DropSource, type Item } from '../config/items';
import { RUN, xpToNext } from '../config/progression';
import { SKILLS, type ChargeDef, type SealDef, type SunderDef, type VolleyDef } from '../config/skills';
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
  DamageSource,
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
const HERO_SOURCES: ReadonlySet<DamageSource> = new Set(['attack', 'cleave', 'bolt', 'skill', 'chain', 'nova', 'ember', 'thorns']);

export interface SimOptions {
  seed: number;
  build: HeroBuild;
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
    skill: SKILLS[build.skillId],
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
    skillCd: 0,
    skillBuffer: 0,
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
  private lavaTick = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly targeting: TargetingParams;

  constructor(map: ArenaMap, opts: SimOptions) {
    this.map = map;
    this.rng = new Rng(opts.seed);
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
    if (i.skill) this.hero.skillBuffer = COMMON.inputBuffer;
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

  applyChoice(id: UpgradeId): boolean {
    const c = this.choices[0];
    if (!c || !c.options.includes(id)) return false;
    const h = this.hero;
    h.upgrades[id] = Math.min(UPGRADES[id].maxStacks, h.upgrades[id] + 1);
    this.recomputeStats();
    this.choices.shift();
    return true;
  }

  private rollUpgrades(source: Choice['source']): UpgradeId[] {
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
    return picks;
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
    this.updateHero(dt);
    this.updateZones(dt);
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
    h.attackCd = Math.max(0, h.attackCd - dt);
    h.skillCd = Math.max(0, h.skillCd - dt);
    h.iframeT = Math.max(0, h.iframeT - dt);
    h.hurtT = Math.max(0, h.hurtT - dt);
    h.dodgeBuffer = Math.max(0, h.dodgeBuffer - dt);
    h.skillBuffer = Math.max(0, h.skillBuffer - dt);
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

    if (h.state === 'cast') {
      h.vx = h.vy = 0;
      h.castT -= dt;
      if (h.castT <= 0) {
        h.castT = 0;
        h.state = 'idle';
        this.resolveSunder(h.skill as SunderDef);
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
      const S = h.skill as ChargeDef;
      const done = this.rollMove(dt, h.dashT, S.duration, S.distance);
      h.dashT += dt;
      this.dashHits(S);
      if (done) h.state = 'idle';
      return;
    }

    if (h.dodgeBuffer > 0 && h.dodgeCd <= 0) {
      this.startDodge();
      return;
    }
    if (h.skillBuffer > 0 && h.skillCd <= 0) {
      this.startSkill();
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
    return h.stats.moveSpeed * (h.frenzyT > 0 ? 1 + EFFECT.frenzy.move : 1);
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

  private startSkill(): void {
    const h = this.hero;
    const sk = h.skill;
    h.skillCd = sk.cooldown * h.stats.skillCooldownMult;
    h.skillBuffer = 0;
    this.cancelSwing();
    this.emit({ type: 'skillCast', skill: sk.id });
    switch (sk.id) {
      case 'sunder':
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
    }
  }

  private resolveSunder(S: SunderDef): void {
    const h = this.hero;
    let hits = 0;
    for (const e of this.enemies) {
      if (!isTargetable(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > S.radius + e.r) continue;
      if (!hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      hits++;
      const ang = d > 1e-6 ? Math.atan2(e.y - h.y, e.x - h.x) : this.rng.range(-Math.PI, Math.PI);
      this.damageEnemy(e, this.rollHero(S.damageMult, false), 'skill', ang, S.knockback * (1 - e.def.poise * 0.6));
      this.stun(e, S.stun);
    }
    this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill);
    this.emit({ type: 'skillImpact', x: h.x, y: h.y, radius: S.radius, hits });
  }

  private dashHits(S: ChargeDef): void {
    const h = this.hero;
    for (const e of this.enemies) {
      if (!isTargetable(e) || h.dashHit.includes(e.id)) continue;
      if (dist(h.x, h.y, e.x, e.y) > S.width + e.r) continue;
      h.dashHit.push(e.id);
      // shove enemies off the charge line, slightly forward
      const side = (e.x - h.x) * h.dodgeDirY - (e.y - h.y) * h.dodgeDirX > 0 ? 1 : -1;
      const fwd = Math.atan2(h.dodgeDirY, h.dodgeDirX);
      this.damageEnemy(e, this.rollHero(S.damageMult, false), 'skill', fwd - side * 1.1, S.knockback * (1 - e.def.poise * 0.6));
      this.stun(e, S.stun);
      if (h.dashHit.length === 1) this.hitstop = Math.max(this.hitstop, COMMON.hitstop.skill * 0.6);
    }
  }

  private fireVolley(S: VolleyDef): void {
    const h = this.hero;
    this.aimDirection(true);
    const base = Math.atan2(this.tmp.y, this.tmp.x);
    h.facing = base;
    const half = (S.arcDeg / 2) * DEG;
    for (let i = 0; i < S.bolts; i++) {
      const a = base - half + (S.bolts === 1 ? half : (2 * half * i) / (S.bolts - 1));
      const roll = this.rollHero(S.damageMult, false);
      this.fireProjectile('hero', 'shard', h.x, h.y, a, S.speed, h.cls.attack.boltRadius || 0.18, roll, S.pierce + h.stats.pierce, S.range);
    }
    this.emit({ type: 'volley', angle: base });
  }

  private placeSeal(S: SealDef): void {
    const h = this.hero;
    this.zones.push({ id: this.nextId++, kind: 'seal', x: h.x, y: h.y, r: S.radius, life: S.duration, maxLife: S.duration, tickT: 0.05 });
    this.emit({ type: 'seal', x: h.x, y: h.y, radius: S.radius });
  }

  private stun(e: Enemy, seconds: number): void {
    if (e.state === 'dead' || e.invulnerable) return;
    if (e.state === 'windup') this.emit({ type: 'interrupt', id: e.id });
    const remaining = e.state === 'stunned' ? e.stateT : 0;
    e.state = 'stunned';
    e.dashT = 0;
    e.stateT = e.stateDur = Math.max(remaining, seconds * e.def.stunTaken);
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
    h.hurtT = COMMON.hurtIframes;
    this.onHeroStruck(attacker);
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
    const amt = applyReduction(amount, h.stats.armor);
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
      this.fireProjectile('hero', 'shard', h.x, h.y, angle, A.boltSpeed, A.boltRadius, this.rollHero(1, true), h.stats.pierce, range, chain);
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
    if ((source === 'attack' || source === 'cleave' || source === 'bolt') && h.stats.burn > 0) {
      // re-applying refreshes the burn rather than stacking it
      e.burnT = EFFECT.burn.duration;
      e.burnDps = h.stats.damage * h.stats.burn;
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
            this.damageEnemy(e, { amount: p.damage, crit: p.crit }, 'bolt', Math.atan2(p.vy, p.vx), h.cls.attack.knockback || 0.8);
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
    const S = SKILLS.seal;
    for (const e of this.enemies) e.slowMul = 1;
    for (const z of this.zones) {
      z.life -= dt;
      z.tickT -= dt;
      const tick = z.tickT <= 0;
      if (tick) z.tickT += S.tick;
      for (const e of this.enemies) {
        if (!isTargetable(e) || dist(e.x, e.y, z.x, z.y) > z.r + e.r) continue;
        e.slowMul = Math.min(e.slowMul, S.slow);
        if (tick) this.damageEnemy(e, this.rollHero(S.damageMult, false), 'skill', Math.atan2(e.y - z.y, e.x - z.x), 0.3);
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
      if (e.dashT > 0) this.enemyDash(e, dt);

      switch (e.state) {
        case 'spawning':
        case 'stunned':
        case 'recover':
          e.stateT -= dt;
          if (e.stateT <= 0) {
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

