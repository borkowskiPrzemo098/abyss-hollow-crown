import { COMMON, ENEMIES, ENEMY_FRICTION, type EnemyKind } from '../config/balance';
import { HEROES } from '../config/heroes';
import { RUN, xpToNext } from '../config/progression';
import { SKILLS, type ChargeDef, type SealDef, type SunderDef, type VolleyDef } from '../config/skills';
import { UPGRADES, UPGRADE_EFFECT, type UpgradeId } from '../config/upgrades';
import { isoMoveScale } from '../core/iso';
import { angleDiff, dist, normalize, turnToward, type Vec2 } from '../core/math';
import { Rng } from '../core/rng';
import { blocksSight, isWalkable, tileAt, type ArenaMap } from '../world/arena';
import { hasClearPath, hasLineOfSight, moveCircle, resolveCircleVsGrid } from '../world/collision';
import { FlowField } from '../world/flowField';
import type { ObjectKind } from '../world/dungeon';
import { applyReduction, rollDamage, type DamageRoll } from './damage';
import { computeStats, emptyUpgrades } from './stats';
import { chooseTarget, isTargetable, type TargetingParams } from './targeting';
import type {
  Choice,
  DamageSource,
  Enemy,
  Hero,
  HeroBuild,
  InputIntent,
  Pickup,
  Projectile,
  SimEvent,
  WorldObject,
  Zone,
} from './types';

const DEG = Math.PI / 180;
const ISO = COMMON.isoCompensation;

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
}

export function createHero(build: HeroBuild, x: number, y: number): Hero {
  const cls = HEROES[build.heroId];
  const upgrades = emptyUpgrades();
  const stats = computeStats(cls, build.ranks, upgrades);
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
  pickups: Pickup[] = [];
  objects: WorldObject[] = [];
  /** Pending upgrade choices. The world is frozen while one is open. */
  choices: Choice[] = [];
  director: Director | null = null;
  time = 0;
  /** While > 0 the world freezes (hit-stop) — gives big hits weight. */
  hitstop = 0;
  kills = 0;
  /** Ash collected this run (banked into the save when the run ends). */
  ash = 0;

  private flow: FlowField;
  private readonly input: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };
  private events: SimEvent[] = [];
  private nextId = 1;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly targeting: TargetingParams;

  constructor(map: ArenaMap, opts: SimOptions) {
    this.map = map;
    this.rng = new Rng(opts.seed);
    this.flow = new FlowField(map);
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
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
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
      aim: toHero,
      facing: toHero,
      kvx: 0,
      kvy: 0,
      flinchT: 0,
      deadT: 0,
      slowMul: 1,
      flankAngle: this.rng.range(-0.75, 0.75),
    };
    this.tmp.x = x;
    this.tmp.y = y;
    resolveCircleVsGrid(this.map, this.tmp, e.r);
    e.x = e.px = this.tmp.x;
    e.y = e.py = this.tmp.y;
    this.enemies.push(e);
    this.emit({ type: 'spawn', id: e.id, kind, x: e.x, y: e.y });
    return e;
  }

  addObject(kind: ObjectKind, x: number, y: number, roomId: number, active: boolean): WorldObject {
    const o: WorldObject = { id: this.nextId++, kind, x, y, roomId, active, used: false };
    this.objects.push(o);
    return o;
  }

  addPickup(kind: Pickup['kind'], x: number, y: number, amount: number): void {
    const a = this.rng.range(-Math.PI, Math.PI);
    const s = this.rng.range(1.5, 3.5);
    this.pickups.push({ id: this.nextId++, kind, x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, amount, age: 0 });
  }

  heal(amount: number): number {
    const h = this.hero;
    if (h.state === 'dead') return 0;
    const before = h.hp;
    h.hp = Math.min(h.stats.maxHp, h.hp + amount);
    const healed = Math.round(h.hp - before);
    if (healed > 0) this.emit({ type: 'heroHeal', amount: healed });
    return healed;
  }

  /** Re-derives hero stats; a higher max HP also raises current HP by the same amount. */
  recomputeStats(): void {
    const h = this.hero;
    const oldMax = h.stats.maxHp;
    h.stats = computeStats(h.cls, h.build.ranks, h.upgrades);
    if (h.stats.maxHp > oldMax) h.hp += h.stats.maxHp - oldMax;
    h.hp = Math.min(h.hp, h.stats.maxHp);
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
    this.updatePickups(dt);
    this.director?.update(dt);
    this.enemies = this.enemies.filter((e) => !(e.state === 'dead' && e.deadT > 1.6));
  }

  /** Compact fingerprint of the world state (determinism tests). */
  stateHash(): string {
    const r = (v: number) => Math.round(v * 1000);
    const parts = [r(this.hero.x), r(this.hero.y), this.hero.hp, this.kills, this.hero.level];
    for (const e of this.enemies) parts.push(e.id, r(e.x), r(e.y), e.hp);
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
    h.targetLockT += dt;

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

    const mag = Math.min(1, Math.hypot(this.input.moveX, this.input.moveY));
    if (mag > 0.01) {
      normalize(this.input.moveX, this.input.moveY, this.tmp);
      const speed = h.stats.moveSpeed * mag * isoMoveScale(this.tmp.x, this.tmp.y, ISO);
      const dx = this.tmp.x * speed * dt;
      const dy = this.tmp.y * speed * dt;
      const ang = Math.atan2(this.tmp.y, this.tmp.x);
      this.moveHero(dx, dy, dt);
      h.state = 'move';
      if (h.swingT < 0) h.facing = ang;
    } else {
      h.vx = h.vy = 0;
      h.state = 'idle';
    }
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
    if (e.state === 'dead') return;
    if (e.state === 'windup') this.emit({ type: 'interrupt', id: e.id });
    e.state = 'stunned';
    e.stateT = e.stateDur = seconds * e.def.stunTaken;
  }

  /** Applies damage to the hero, honouring dodge i-frames and mercy i-frames. */
  damageHero(amount: number): boolean {
    const h = this.hero;
    if (h.state === 'dead') return false;
    if (h.iframeT > 0) {
      this.emit({ type: 'evade', x: h.x, y: h.y });
      return false;
    }
    if (h.hurtT > 0) return false;
    const amt = applyReduction(amount, h.stats.armor);
    h.hp = Math.max(0, h.hp - amt);
    h.hurtT = COMMON.hurtIframes;
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
    h.attackCd = h.stats.attackInterval;
    h.facing = angle;
    this.emit({ type: 'swing', targetId: t.id, angle });
  }

  private landSwing(): void {
    const h = this.hero;
    const A = h.cls.attack;
    const t = this.getEnemy(h.swingTargetId);
    if (A.kind === 'bolt') {
      if (!t || !isTargetable(t)) {
        this.emit({ type: 'whiff' });
        return;
      }
      const angle = Math.atan2(t.y - h.y, t.x - h.x);
      const range = h.stats.attackRange + 1.5;
      this.fireProjectile('hero', 'shard', h.x, h.y, angle, A.boltSpeed, A.boltRadius, this.rollHero(1, true), h.stats.pierce, range);
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

  private damageEnemy(e: Enemy, roll: DamageRoll, source: DamageSource, kbAngle: number, kbForce: number): void {
    if (e.state === 'dead') return;
    e.hp = Math.max(0, e.hp - roll.amount);
    this.emit({ type: 'damage', targetId: e.id, amount: roll.amount, crit: roll.crit, x: e.x, y: e.y, source });
    const k = kbForce * (1 - e.def.poise);
    if (e.hp <= 0) {
      this.killEnemy(e, source, kbAngle, k);
      return;
    }
    e.kvx += Math.cos(kbAngle) * k;
    e.kvy += Math.sin(kbAngle) * k;
    // Light hits never cancel a wind-up: the player must dodge or use the skill.
    if (e.def.poise < 0.5 && e.state !== 'windup' && e.state !== 'stunned') e.flinchT = 0.14;
  }

  private killEnemy(e: Enemy, source: DamageSource, kbAngle: number, k: number): void {
    const h = this.hero;
    e.state = 'dead';
    e.deadT = 0;
    e.kvx = Math.cos(kbAngle) * (k + 1.5);
    e.kvy = Math.sin(kbAngle) * (k + 1.5);
    this.kills++;
    this.emit({ type: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y });
    for (let i = 0; i < e.def.ash; i++) this.addPickup('ash', e.x, e.y, 1);
    if (this.rng.chance(RUN.healDropChance)) this.addPickup('heal', e.x, e.y, RUN.healAmount);
    if (h.stats.lifeOnKill > 0) this.heal(h.stats.lifeOnKill);
    this.grantXp(Math.round(e.def.xp * e.xpScale));
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

  // ───────────────────────────── projectiles, zones, pickups ─────────────────────────────

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
        else this.heal(p.amount);
        this.emit({ type: 'pickup', kind: p.kind, amount: p.amount, x: p.x, y: p.y });
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

      switch (e.state) {
        case 'spawning':
        case 'stunned':
        case 'recover':
          e.stateT -= dt;
          if (e.stateT <= 0) e.state = 'chase';
          break;
        case 'windup': {
          e.stateT -= dt;
          const elapsed = e.stateDur - e.stateT;
          if (h.state !== 'dead' && elapsed < e.def.attack.trackFraction * e.stateDur) {
            const want = Math.atan2(h.y - e.y, h.x - e.x);
            e.aim = turnToward(e.aim, want, e.def.attack.turnRate * DEG * dt);
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

  private enemyChase(e: Enemy, dt: number): void {
    const h = this.hero;
    if (h.state === 'dead') return;
    const A = e.def.attack;
    const d = dist(e.x, e.y, h.x, h.y);
    const toHero = Math.atan2(h.y - e.y, h.x - e.x);
    const los = hasLineOfSight(this.map, e.x, e.y, h.x, h.y);
    e.facing = toHero;

    if (d <= A.triggerRange && e.attackCd <= 0 && los && e.flinchT <= 0) {
      e.state = 'windup';
      e.stateT = e.stateDur = A.windup;
      e.aim = toHero;
      this.emit({ type: 'windup', id: e.id, kind: e.kind });
      return;
    }
    if (e.flinchT > 0) return;

    let dirX: number;
    let dirY: number;
    let speed = e.def.speed;
    const keep = e.def.keepAway;
    if (keep && los && d < keep.min) {
      // casters back off when the hero gets close
      dirX = -Math.cos(toHero);
      dirY = -Math.sin(toHero);
    } else if (keep && los && d <= keep.max) {
      const side = e.flankAngle >= 0 ? 1 : -1;
      dirX = -Math.sin(toHero) * side;
      dirY = Math.cos(toHero) * side;
      speed *= 0.4;
    } else if (!keep && los && d <= Math.min(A.triggerRange * 0.9, e.r + h.r + 0.35)) {
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
    const A = e.def.attack;
    let hit = false;
    const damage = A.damage * e.dmgScale;
    if (A.shape.kind === 'bolt') {
      this.fireProjectile('enemy', 'ember', e.x, e.y, e.aim, A.shape.speed, A.shape.radius, { amount: Math.round(damage), crit: false }, 0, A.shape.range);
    } else if (h.state !== 'dead' && hasLineOfSight(this.map, e.x, e.y, h.x, h.y)) {
      let inside = false;
      if (A.shape.kind === 'cone') {
        const d = dist(e.x, e.y, h.x, h.y);
        if (d <= A.shape.radius + h.r) {
          const a = Math.atan2(h.y - e.y, h.x - e.x);
          const slack = Math.asin(Math.min(1, h.r / Math.max(d, 0.01)));
          inside = Math.abs(angleDiff(e.aim, a)) <= (A.shape.arcDeg / 2) * DEG + slack;
        }
      } else {
        const cx = e.x + Math.cos(e.aim) * A.shape.offset;
        const cy = e.y + Math.sin(e.aim) * A.shape.offset;
        inside = dist(cx, cy, h.x, h.y) <= A.shape.radius + h.r;
      }
      if (inside) hit = this.damageHero(damage);
    }
    this.emit({ type: 'strike', id: e.id, kind: e.kind, hit });
    e.state = 'recover';
    e.stateT = e.stateDur = A.recovery;
    e.attackCd = A.cooldown;
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
      if (heroSolid) {
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

  /** Finds a walkable spawn spot near (x, y), or returns it unchanged. */
  walkableNear(x: number, y: number): { x: number; y: number } {
    if (isWalkable(this.map, Math.floor(x), Math.floor(y))) return { x, y };
    for (let r = 1; r <= 3; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++)
          if (isWalkable(this.map, Math.floor(x) + ox, Math.floor(y) + oy)) return { x: Math.floor(x) + ox + 0.5, y: Math.floor(y) + oy + 0.5 };
    return { x, y };
  }
}
