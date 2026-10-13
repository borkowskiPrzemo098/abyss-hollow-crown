import { ENEMIES, ENEMY_FRICTION, HERO, SKILLS, WAVES, waveComposition, type EnemyKind } from '../config/balance';
import { angleDiff, dist, normalize, turnToward, type Vec2 } from '../core/math';
import { Rng } from '../core/rng';
import { isWalkable, type ArenaMap } from '../world/arena';
import { hasClearPath, hasLineOfSight, moveCircle, resolveCircleVsGrid } from '../world/collision';
import { FlowField } from '../world/flowField';
import { applyReduction, rollDamage, type DamageRoll } from './damage';
import { chooseTarget, isTargetable, type TargetingParams } from './targeting';
import type { Enemy, Hero, HeroStats, InputIntent, SimEvent } from './types';

const DEG = Math.PI / 180;

export interface SimOptions {
  seed: number;
  /** Spawn escalating waves automatically. Tests usually disable this and place enemies by hand. */
  waves: boolean;
}

export function createHeroStats(): HeroStats {
  return {
    maxHp: HERO.maxHp,
    moveSpeed: HERO.moveSpeed,
    damage: HERO.attack.damage,
    attackInterval: HERO.attack.interval,
    attackRange: HERO.attack.range,
    critChance: HERO.crit.chance,
    critMult: HERO.crit.mult,
    damageReduction: HERO.damageReduction,
    skillCooldownMult: 1,
  };
}

/**
 * The whole combat simulation, independent of Phaser and of frame rate.
 * Advance it with fixed `step(dt)` calls; read state and drain events to render.
 */
export class Simulation {
  readonly map: ArenaMap;
  readonly rng: Rng;
  readonly hero: Hero;
  enemies: Enemy[] = [];
  time = 0;
  /** While > 0 the world freezes (hit-stop) — gives hits weight. */
  hitstop = 0;
  wave = 0;
  waveActive = false;
  waveBreakT = 1.0;
  kills = 0;

  private readonly wavesEnabled: boolean;
  private readonly flow: FlowField;
  private readonly input: InputIntent = { moveX: 0, moveY: 0, dodge: false, skill: false };
  private events: SimEvent[] = [];
  private nextId = 1;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly targeting: TargetingParams;

  constructor(map: ArenaMap, opts: SimOptions) {
    this.map = map;
    this.rng = new Rng(opts.seed);
    this.wavesEnabled = opts.waves;
    this.flow = new FlowField(map);
    const stats = createHeroStats();
    this.hero = {
      x: map.heroStart.x,
      y: map.heroStart.y,
      px: map.heroStart.x,
      py: map.heroStart.y,
      r: HERO.radius,
      hp: stats.maxHp,
      stats,
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
      targetId: null,
      targetLockT: 0,
    };
    this.targeting = {
      attackRange: stats.attackRange,
      acquireMargin: HERO.targeting.acquireMargin,
      leashMargin: HERO.targeting.leashMargin,
      switchRatio: HERO.targeting.switchRatio,
      minLock: HERO.targeting.minLock,
    };
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** Feed the latest player intent. Button presses are buffered briefly so early taps still count. */
  setInput(i: InputIntent): void {
    this.input.moveX = i.moveX;
    this.input.moveY = i.moveY;
    if (i.dodge) this.hero.dodgeBuffer = HERO.dodge.buffer;
    if (i.skill) this.hero.skillBuffer = SKILLS.sunder.buffer;
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

  /** Places an enemy. `instant` skips the spawn telegraph (used by tests). */
  spawnEnemy(kind: EnemyKind, x: number, y: number, opts: { instant?: boolean; hpScale?: number; delay?: number } = {}): Enemy {
    const def = ENEMIES[kind];
    const maxHp = Math.round(def.maxHp * (opts.hpScale ?? 1));
    const spawnT = def.spawnTime + (opts.delay ?? 0);
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
      state: opts.instant ? 'chase' : 'spawning',
      stateT: opts.instant ? 0 : spawnT,
      stateDur: opts.instant ? 0 : spawnT,
      attackCd: opts.instant ? 0 : this.rng.range(0.25, 0.9),
      aim: Math.atan2(this.hero.y - y, this.hero.x - x),
      facing: Math.atan2(this.hero.y - y, this.hero.x - x),
      kvx: 0,
      kvy: 0,
      flinchT: 0,
      deadT: 0,
      flankAngle: this.rng.range(-0.75, 0.75),
    };
    this.tmp.x = x;
    this.tmp.y = y;
    resolveCircleVsGrid(this.map, this.tmp, e.r);
    e.x = e.px = this.tmp.x;
    e.y = e.py = this.tmp.y;
    this.enemies.push(e);
    this.events.push({ type: 'spawn', id: e.id, kind, x: e.x, y: e.y });
    return e;
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
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    this.updateHero(dt);
    this.updateEnemies(dt);
    this.separateBodies();
    this.updateHeroAttack(dt);
    this.updateWaves(dt);
    this.enemies = this.enemies.filter((e) => !(e.state === 'dead' && e.deadT > 1.6));
  }

  /** Compact fingerprint of the world state (determinism tests). */
  stateHash(): string {
    const r = (v: number) => Math.round(v * 1000);
    const parts = [r(this.hero.x), r(this.hero.y), this.hero.hp, this.kills, this.wave];
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
        this.resolveSunder();
      }
      return;
    }

    if (h.state === 'dodge') {
      const D = HERO.dodge;
      const u0 = h.dodgeT / D.duration;
      h.dodgeT += dt;
      const u1 = Math.min(1, h.dodgeT / D.duration);
      // Ease-out displacement: fast burst, soft landing. Total distance is exact.
      const ds = (1 - (1 - u1) ** 2) - (1 - (1 - u0) ** 2);
      const mx = h.dodgeDirX * D.distance * ds;
      const my = h.dodgeDirY * D.distance * ds;
      this.tmp.x = h.x;
      this.tmp.y = h.y;
      moveCircle(this.map, this.tmp, mx, my, h.r);
      h.vx = (this.tmp.x - h.x) / dt;
      h.vy = (this.tmp.y - h.y) / dt;
      h.x = this.tmp.x;
      h.y = this.tmp.y;
      if (u1 >= 1) h.state = 'idle';
      return;
    }

    if (h.dodgeBuffer > 0 && h.dodgeCd <= 0) {
      this.startDodge();
      return;
    }
    if (h.skillBuffer > 0 && h.skillCd <= 0) {
      this.startCast();
      return;
    }

    const mag = Math.min(1, Math.hypot(this.input.moveX, this.input.moveY));
    if (mag > 0.01) {
      normalize(this.input.moveX, this.input.moveY, this.tmp);
      const speed = h.stats.moveSpeed * mag;
      const dx = this.tmp.x * speed * dt;
      const dy = this.tmp.y * speed * dt;
      const ang = Math.atan2(this.tmp.y, this.tmp.x);
      this.tmp.x = h.x;
      this.tmp.y = h.y;
      moveCircle(this.map, this.tmp, dx, dy, h.r);
      h.vx = (this.tmp.x - h.x) / dt;
      h.vy = (this.tmp.y - h.y) / dt;
      h.x = this.tmp.x;
      h.y = this.tmp.y;
      h.state = 'move';
      if (h.swingT < 0) h.facing = ang;
    } else {
      h.vx = h.vy = 0;
      h.state = 'idle';
    }
  }

  private cancelSwing(): void {
    const h = this.hero;
    if (h.swingT >= 0) {
      h.swingT = -1;
      // Refund most of the interval so dodge-cancelling doesn't feel punishing.
      h.attackCd = Math.min(h.attackCd, 0.15);
    }
  }

  private startDodge(): void {
    const h = this.hero;
    const D = HERO.dodge;
    const mag = Math.hypot(this.input.moveX, this.input.moveY);
    if (mag > 0.2) {
      normalize(this.input.moveX, this.input.moveY, this.tmp);
    } else {
      this.tmp.x = Math.cos(h.facing);
      this.tmp.y = Math.sin(h.facing);
    }
    h.dodgeDirX = this.tmp.x;
    h.dodgeDirY = this.tmp.y;
    h.facing = Math.atan2(this.tmp.y, this.tmp.x);
    h.state = 'dodge';
    h.dodgeT = 0;
    h.dodgeCd = D.cooldown;
    h.dodgeBuffer = 0;
    h.iframeT = Math.max(h.iframeT, D.iframes);
    this.cancelSwing();
    this.events.push({ type: 'dodge', dirX: h.dodgeDirX, dirY: h.dodgeDirY });
  }

  private startCast(): void {
    const h = this.hero;
    const S = SKILLS.sunder;
    h.state = 'cast';
    h.castT = S.castTime;
    h.skillCd = S.cooldown * h.stats.skillCooldownMult;
    h.skillBuffer = 0;
    h.vx = h.vy = 0;
    this.cancelSwing();
    this.events.push({ type: 'skillCast' });
  }

  private resolveSunder(): void {
    const h = this.hero;
    const S = SKILLS.sunder;
    let hits = 0;
    for (const e of this.enemies) {
      if (!isTargetable(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > S.radius + e.r) continue;
      if (!hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      hits++;
      const roll = rollDamage(h.stats.damage * S.damageMult, h.stats.critChance, h.stats.critMult, 0, this.rng);
      const ang = d > 1e-6 ? Math.atan2(e.y - h.y, e.x - h.x) : this.rng.range(-Math.PI, Math.PI);
      this.damageEnemy(e, roll, 'skill', ang, S.knockback * (1 - e.def.poise * 0.6));
      if (e.state === 'dead') continue;
      if (e.state === 'windup') this.events.push({ type: 'interrupt', id: e.id });
      e.state = 'stunned';
      e.stateT = e.stateDur = S.stun * e.def.stunTaken;
    }
    this.hitstop = Math.max(this.hitstop, S.hitstop);
    this.events.push({ type: 'skillImpact', x: h.x, y: h.y, radius: S.radius, hits });
  }

  /** Applies damage to the hero, honouring dodge i-frames and mercy i-frames. */
  damageHero(amount: number): boolean {
    const h = this.hero;
    if (h.state === 'dead') return false;
    if (h.iframeT > 0) {
      this.events.push({ type: 'evade', x: h.x, y: h.y });
      return false;
    }
    if (h.hurtT > 0) return false;
    const amt = applyReduction(amount, h.stats.damageReduction);
    h.hp = Math.max(0, h.hp - amt);
    h.hurtT = HERO.hurtIframes;
    this.events.push({ type: 'heroHurt', amount: amt, x: h.x, y: h.y });
    if (h.hp <= 0) {
      h.state = 'dead';
      h.swingT = -1;
      h.castT = 0;
      h.targetId = null;
      this.events.push({ type: 'heroDeath' });
    }
    return true;
  }

  // ───────────────────────────── hero auto-attack ─────────────────────────────

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
    if (h.state === 'dodge' || h.state === 'cast') return;

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
    h.swingT = HERO.attack.windup;
    h.swingTargetId = t.id;
    h.attackCd = h.stats.attackInterval;
    h.facing = angle;
    this.events.push({ type: 'swing', targetId: t.id, angle });
  }

  private landSwing(): void {
    const h = this.hero;
    const A = HERO.attack;
    const t = this.getEnemy(h.swingTargetId);
    if (
      !t ||
      !isTargetable(t) ||
      dist(h.x, h.y, t.x, t.y) > h.stats.attackRange + A.landSlack ||
      !hasLineOfSight(this.map, h.x, h.y, t.x, t.y)
    ) {
      this.events.push({ type: 'whiff' });
      return;
    }
    const angle = Math.atan2(t.y - h.y, t.x - h.x);
    const roll = rollDamage(h.stats.damage, h.stats.critChance, h.stats.critMult, 0, this.rng);
    this.damageEnemy(t, roll, 'attack', angle, A.knockback);
    this.hitstop = Math.max(this.hitstop, roll.crit ? A.critHitstop : A.hitstop);

    const halfArc = (A.cleaveArcDeg / 2) * DEG;
    for (const e of this.enemies) {
      if (e === t || !isTargetable(e)) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d > h.stats.attackRange + e.r * 0.5) continue;
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      if (Math.abs(angleDiff(angle, a)) > halfArc) continue;
      if (!hasLineOfSight(this.map, h.x, h.y, e.x, e.y)) continue;
      const cr = rollDamage(h.stats.damage * A.cleaveRatio, h.stats.critChance, h.stats.critMult, 0, this.rng);
      this.damageEnemy(e, cr, 'cleave', a, A.knockback * 0.6);
    }
  }

  private damageEnemy(e: Enemy, roll: DamageRoll, source: 'attack' | 'cleave' | 'skill', kbAngle: number, kbForce: number): void {
    e.hp = Math.max(0, e.hp - roll.amount);
    this.events.push({ type: 'damage', targetId: e.id, amount: roll.amount, crit: roll.crit, x: e.x, y: e.y, source });
    const k = kbForce * (1 - e.def.poise);
    if (e.hp <= 0) {
      e.state = 'dead';
      e.deadT = 0;
      e.kvx = Math.cos(kbAngle) * (k + 1.5);
      e.kvy = Math.sin(kbAngle) * (k + 1.5);
      this.kills++;
      this.events.push({ type: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y });
      return;
    }
    e.kvx += Math.cos(kbAngle) * k;
    e.kvy += Math.sin(kbAngle) * k;
    // Light hits never cancel a wind-up: the player must dodge or use the skill.
    if (e.def.poise < 0.5 && e.state !== 'windup') e.flinchT = 0.14;
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
      this.events.push({ type: 'windup', id: e.id, kind: e.kind });
      return;
    }
    if (e.flinchT > 0) return;

    let dirX: number;
    let dirY: number;
    let speed = e.def.speed;
    // Close to body contact before circling, so an enemy waiting on its cooldown is
    // always inside the hero's reach — waiting is the hero's counter-attack window.
    const holdDist = Math.min(A.triggerRange * 0.9, e.r + h.r + 0.35);
    if (los && d <= holdDist) {
      // In reach but on cooldown: circle the hero slowly instead of standing still.
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
      const tx = wp ? wp.x : h.x;
      const ty = wp ? wp.y : h.y;
      normalize(tx - e.x, ty - e.y, this.tmp);
      dirX = this.tmp.x;
      dirY = this.tmp.y;
    }
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
    if (h.state !== 'dead' && hasLineOfSight(this.map, e.x, e.y, h.x, h.y)) {
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
      if (inside) hit = this.damageHero(A.damage);
    }
    this.events.push({ type: 'strike', id: e.id, kind: e.kind, hit });
    e.state = 'recover';
    e.stateT = e.stateDur = A.recovery;
    e.attackCd = A.cooldown;
  }

  /** Soft body separation. Mass decides who yields; a dodging hero passes through enemies. */
  private separateBodies(): void {
    const list = this.enemies;
    const h = this.hero;
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
      if (h.state !== 'dead' && h.state !== 'dodge') {
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
          const heroShare = (a.def.mass / (a.def.mass + HERO.mass)) * 0.5;
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

  // ───────────────────────────── waves ─────────────────────────────

  private updateWaves(dt: number): void {
    if (!this.wavesEnabled || this.hero.state === 'dead') return;
    if (this.livingEnemyCount() > 0) return;
    if (this.waveActive) {
      this.waveActive = false;
      this.waveBreakT = WAVES.breakTime;
      this.events.push({ type: 'waveClear', wave: this.wave });
    }
    this.waveBreakT -= dt;
    if (this.waveBreakT <= 0) this.startWave(this.wave + 1);
  }

  private startWave(n: number): void {
    this.wave = n;
    this.waveActive = true;
    const kinds = waveComposition(n);
    const hpScale = 1 + Math.max(0, n - 3) * WAVES.hpGrowthPerWave;
    const h = this.hero;
    const far = this.map.spawns.filter((s) => dist(s.x, s.y, h.x, h.y) >= WAVES.minSpawnDistance);
    const pool = far.length > 0 ? far : [...this.map.spawns].sort((a, b) => dist(b.x, b.y, h.x, h.y) - dist(a.x, a.y, h.x, h.y)).slice(0, 2);
    kinds.forEach((kind, i) => {
      const s = this.rng.pick(pool);
      let x = s.x + this.rng.range(-0.6, 0.6);
      let y = s.y + this.rng.range(-0.6, 0.6);
      if (!isWalkable(this.map, Math.floor(x), Math.floor(y))) {
        x = s.x;
        y = s.y;
      }
      this.spawnEnemy(kind, x, y, { hpScale, delay: i * 0.15 });
    });
    this.events.push({ type: 'waveStart', wave: n, count: kinds.length });
  }
}
