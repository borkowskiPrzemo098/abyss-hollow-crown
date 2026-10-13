import type Phaser from 'phaser';
import { SKILLS } from '../config/skills';
import { blocksSight, tileAt, type ArenaMap } from '../world/arena';
import { worldToScreenX, worldToScreenY } from '../core/iso';
import type { Simulation } from '../sim/simulation';
import type { StrikeShape } from '../config/balance';
import type { Enemy } from '../sim/types';
import { PAL } from './palette';
import { RES } from './textures';
import { LAYER } from './worldView';

const DEG = Math.PI / 180;

interface StrikeFlash {
  shape: StrikeShape;
  aim: number;
  x: number;
  y: number;
  life: number;
}

export interface ViewPos {
  sx: number;
  sy: number;
  headY: number;
}

/**
 * Per-frame vector overlays:
 *  - ground layer (under bodies): attack telegraphs, spawn sigils, the target ring
 *  - top layer (over bodies): enemy health, stun marks, the target chevron
 * Shapes are built in world space and projected point by point, so a telegraph
 * covers exactly the area the simulation will test.
 */
export class Overlays {
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly top: Phaser.GameObjects.Graphics;
  private readonly chevron: Phaser.GameObjects.Image;
  private readonly flashes: StrikeFlash[] = [];
  private readonly pts: { x: number; y: number }[] = [];
  private map: ArenaMap | null = null;

  constructor(scene: Phaser.Scene) {
    this.ground = scene.add.graphics().setDepth(LAYER.telegraph);
    this.top = scene.add.graphics().setDepth(LAYER.overlay);
    this.chevron = scene.add.image(0, 0, 'chevron').setScale(1 / RES).setDepth(LAYER.overlay + 1).setVisible(false);
    for (let i = 0; i < 40; i++) this.pts.push({ x: 0, y: 0 });
  }

  onStrike(e: Enemy): void {
    this.flashes.push({ shape: e.atk.shape, aim: e.aim, x: e.x, y: e.y, life: 0.16 });
  }

  draw(sim: Simulation, views: ReadonlyMap<number, ViewPos>, dt: number, time: number): void {
    const g = this.ground;
    const t = this.top;
    g.clear();
    t.clear();
    this.map = sim.map;

    // hero-made zones: Seal of the Void, banner, sentry, mines, falling stars
    for (const z of sim.zones) {
      const fade = Math.min(1, z.life / 0.8);
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const sx = worldToScreenX(z.x, z.y);
      const sy = worldToScreenY(z.x, z.y);
      if (z.kind === 'seal') {
        // an ember ring with a slow pulse; fades in its last second
        this.circle(g, z.x, z.y, z.r, PAL.ember, (0.08 + 0.05 * pulse) * fade, 0.75 * fade);
        this.circle(g, z.x, z.y, z.r * 0.62, PAL.emberHot, 0, 0.35 * fade);
        for (let k = 0; k < 6; k++) {
          const a = time * 0.8 + (k * Math.PI) / 3;
          this.arc(g, z.x, z.y, z.r * 0.82, a, a + 0.32, PAL.emberHot, 0.8 * fade, 2.2);
        }
      } else if (z.kind === 'banner') {
        this.circle(g, z.x, z.y, z.r, PAL.gold, (0.06 + 0.04 * pulse) * fade, 0.7 * fade);
        t.lineStyle(3, PAL.bone, fade);
        t.beginPath();
        t.moveTo(sx, sy);
        t.lineTo(sx, sy - 36);
        t.strokePath();
        t.fillStyle(PAL.gold, 0.9 * fade);
        t.fillTriangle(sx, sy - 36, sx + 18, sy - 29 + Math.sin(time * 5) * 2, sx, sy - 22);
      } else if (z.kind === 'sentry') {
        this.circle(g, z.x, z.y, z.r, PAL.hollow, 0, 0.12 * fade);
        this.circle(g, z.x, z.y, 0.38, PAL.hollow, 0.5 * fade, 0.9 * fade);
        t.fillStyle(PAL.hollow, 0.9 * fade);
        t.fillTriangle(sx, sy - 32, sx - 7, sy - 17, sx + 7, sy - 17);
        t.fillStyle(PAL.hollowDeep, 0.95 * fade);
        t.fillTriangle(sx - 7, sy - 17, sx + 7, sy - 17, sx, sy - 4);
      } else if (z.kind === 'mine') {
        const armed = z.tickT <= 0;
        this.circle(g, z.x, z.y, 0.3, PAL.hollow, armed ? 0.5 : 0.2, 0.9 * fade);
        this.circle(g, z.x, z.y, 0.46 + 0.06 * pulse, PAL.hollow, 0, armed ? 0.8 * fade : 0.3);
      } else if (z.kind === 'ground') {
        // burning ground (ember) or frozen ground (ice) left by a skill upgrade
        const ice = z.skill === 'blink' || z.skill === 'frost';
        const col = ice ? 0x9fd8ff : PAL.ember;
        this.circle(g, z.x, z.y, z.r, col, (0.08 + 0.06 * pulse) * fade, 0.55 * fade);
        this.circle(g, z.x, z.y, z.r * 0.55, ice ? 0xdff4ff : PAL.emberHot, 0.06 * fade, 0);
      } else {
        // a marked spot: the fill reaches the rim exactly when the star lands
        const p = Math.min(1, 1 - z.tickT / Math.max(0.01, SKILLS.starfall.delay));
        this.circle(g, z.x, z.y, z.r, PAL.emberHot, 0.06, 0.55);
        this.circle(g, z.x, z.y, z.r * Math.max(0.05, p), PAL.ember, 0.2 + p * 0.15, 0);
      }
    }

    // delayed blasts: the fill reaches the rim exactly when it goes off
    for (const z of sim.hazards) {
      const p = Math.min(1, z.t / z.delay);
      const icy = z.kind === 'frost';
      this.circle(g, z.x, z.y, z.r, PAL.danger, 0.1, 0.7);
      this.circle(g, z.x, z.y, z.r * Math.max(0.05, p), icy ? 0x9fd8ff : PAL.danger, 0.22 + p * 0.15, 0);
      if (p > 0.8) this.circle(g, z.x, z.y, z.r, 0xffd2c8, 0, 0.9);
    }

    for (const e of sim.enemies) {
      if (e.state === 'windup') {
        const p = 1 - Math.max(0, e.stateT) / e.stateDur;
        this.drawShape(g, e.atk.shape, e.x, e.y, e.aim, 1, PAL.danger, 0.13, 0.75);
        // the inner fill grows to the edge exactly when the hit lands
        this.drawShape(g, e.atk.shape, e.x, e.y, e.aim, p, PAL.danger, 0.24 + p * 0.12, 0);
        if (p > 0.82) this.drawShape(g, e.atk.shape, e.x, e.y, e.aim, 1, 0xffd2c8, 0, 0.9);
      } else if (e.state === 'spawning') {
        const p = 1 - Math.max(0, e.stateT) / e.stateDur;
        this.circle(g, e.x, e.y, 0.55 + 0.25 * p, PAL.hollow, 0.08 + 0.12 * p, 0.6);
        this.arc(g, e.x, e.y, 0.75, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, PAL.hollow, 0.9);
      }
    }
    // marked enemies carry a turquoise reticle that blinks faster as the mark runs out
    for (const e of sim.enemies) {
      if (e.markT <= 0 || e.state === 'dead') continue;
      const mx = worldToScreenX(e.x, e.y);
      const my = worldToScreenY(e.x, e.y) - (30 + e.r * 42);
      const fade = e.markT < 1 ? 0.45 + 0.55 * (Math.floor(time * 10) % 2) : 1;
      const r = 8 + Math.sin(time * 6 + e.id) * 1.2;
      t.lineStyle(2, PAL.hollow, 0.95 * fade);
      t.strokeCircle(mx, my, r);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        t.beginPath();
        t.moveTo(mx + Math.cos(a) * (r + 2), my + Math.sin(a) * (r + 2));
        t.lineTo(mx + Math.cos(a) * (r + 7), my + Math.sin(a) * (r + 7));
        t.strokePath();
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      this.drawShape(g, f.shape, f.x, f.y, f.aim, 1, 0xffe6dc, (f.life / 0.16) * 0.45, 0);
    }

    // target marker
    const h = sim.hero;
    const target = sim.getEnemy(h.targetId);
    const tv = target ? views.get(target.id) : undefined;
    if (target && tv && h.state !== 'dead') {
      const inRange = Math.hypot(target.x - h.x, target.y - h.y) <= h.stats.attackRange;
      const a = inRange ? 0.95 : 0.45;
      const r = target.r + 0.22;
      const spin = time * 1.6;
      for (let k = 0; k < 4; k++) {
        const a0 = spin + (k * Math.PI) / 2;
        this.arc(g, target.x, target.y, r, a0, a0 + 0.9, PAL.ember, a, 2.6);
      }
      this.chevron
        .setVisible(true)
        .setPosition(tv.sx, tv.sy + tv.headY - 8 + Math.sin(time * 6) * 2)
        .setAlpha(a);
    } else {
      this.chevron.setVisible(false);
    }

    // enemy health and stun marks
    for (const e of sim.enemies) {
      const v = views.get(e.id);
      if (!v || e.state === 'dead' || e.state === 'spawning' || e.def.boss) continue;
      const show = e.hp < e.maxHp || e.kind === 'brute';
      const bx = v.sx;
      const by = v.sy + v.headY;
      if (show) {
        const w = e.kind === 'brute' ? 40 : 26;
        t.fillStyle(PAL.void, 0.75);
        t.fillRect(bx - w / 2 - 1, by - 1, w + 2, 5);
        t.fillStyle(e.id === h.targetId ? PAL.bone : PAL.ash, 1);
        t.fillRect(bx - w / 2, by, w * (e.hp / e.maxHp), 3);
      }
      if (e.state === 'stunned') {
        for (let k = 0; k < 3; k++) {
          const a = time * 4 + (k * Math.PI * 2) / 3;
          const sx = bx + Math.cos(a) * 11;
          const sy = by - 8 + Math.sin(a) * 4;
          t.fillStyle(0xd8e4ff, 0.9);
          t.fillTriangle(sx, sy - 3, sx + 2.5, sy, sx, sy + 3);
          t.fillTriangle(sx, sy - 3, sx - 2.5, sy, sx, sy + 3);
        }
      }
    }

    // dodge readiness ring under the hero: a quiet cue that rolling is available again
    if (h.state !== 'dead' && h.dodgeCd > 0) {
      const p = 1 - h.dodgeCd / h.cls.dodge.cooldown;
      this.arc(g, h.x, h.y, h.r + 0.18, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, PAL.bone, 0.28, 1.5);
    }
  }

  private drawShape(
    g: Phaser.GameObjects.Graphics,
    shape: StrikeShape,
    x: number,
    y: number,
    aim: number,
    scale: number,
    color: number,
    fillA: number,
    lineA: number,
  ): void {
    if (shape.kind === 'meteors' || shape.kind === 'lob' || shape.kind === 'summon') return; // their own circles / sigils are the telegraph
    if (shape.kind === 'radial') {
      // rays showing every direction a shard will fly
      const len = 0.6 + 1.6 * Math.max(0.02, scale);
      for (let i = 0; i < shape.bolts; i++) {
        const a = aim + (i / shape.bolts) * Math.PI * 2;
        g.lineStyle(3, color, Math.max(lineA, fillA * 2));
        g.beginPath();
        g.moveTo(worldToScreenX(x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6), worldToScreenY(x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6));
        g.lineTo(worldToScreenX(x + Math.cos(a) * len, y + Math.sin(a) * len), worldToScreenY(x + Math.cos(a) * len, y + Math.sin(a) * len));
        g.strokePath();
      }
      return;
    }
    if (shape.kind === 'cone') {
      const half = (shape.arcDeg / 2) * DEG;
      const r = shape.radius * Math.max(0.02, scale);
      const n = 14;
      const pts = this.pts;
      pts[0]!.x = worldToScreenX(x, y);
      pts[0]!.y = worldToScreenY(x, y);
      for (let i = 0; i <= n; i++) {
        const a = aim - half + (i / n) * half * 2;
        const wx = x + Math.cos(a) * r;
        const wy = y + Math.sin(a) * r;
        pts[i + 1]!.x = worldToScreenX(wx, wy);
        pts[i + 1]!.y = worldToScreenY(wx, wy);
      }
      this.polygon(g, n + 2, color, fillA, lineA);
    } else if (shape.kind === 'bolt' || shape.kind === 'charge') {
      // the ember's path / the charge lane, cut off where it will hit a wall
      const reach = shape.kind === 'bolt' ? shape.range : shape.distance;
      const len = this.traceLength(x, y, aim, reach) * Math.max(0.02, scale);
      const w = shape.kind === 'bolt' ? shape.radius + 0.12 : shape.width;
      const nx = -Math.sin(aim) * w;
      const ny = Math.cos(aim) * w;
      const ex = x + Math.cos(aim) * len;
      const ey = y + Math.sin(aim) * len;
      const corners = [x + nx, y + ny, ex + nx, ey + ny, ex - nx, ey - ny, x - nx, y - ny];
      for (let i = 0; i < 4; i++) {
        this.pts[i]!.x = worldToScreenX(corners[i * 2]!, corners[i * 2 + 1]!);
        this.pts[i]!.y = worldToScreenY(corners[i * 2]!, corners[i * 2 + 1]!);
      }
      this.polygon(g, 4, color, fillA, lineA);
    } else {
      const cx = x + Math.cos(aim) * shape.offset;
      const cy = y + Math.sin(aim) * shape.offset;
      this.circle(g, cx, cy, shape.radius * Math.max(0.02, scale), color, fillA, lineA);
    }
  }

  private traceLength(x: number, y: number, aim: number, max: number): number {
    if (!this.map) return max;
    for (let d = 0.3; d < max; d += 0.2) {
      if (blocksSight(tileAt(this.map, Math.floor(x + Math.cos(aim) * d), Math.floor(y + Math.sin(aim) * d)))) return d;
    }
    return max;
  }

  private circle(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, fillA: number, lineA: number): void {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wx = x + Math.cos(a) * r;
      const wy = y + Math.sin(a) * r;
      this.pts[i]!.x = worldToScreenX(wx, wy);
      this.pts[i]!.y = worldToScreenY(wx, wy);
    }
    this.polygon(g, n, color, fillA, lineA);
  }

  private arc(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, a0: number, a1: number, color: number, alpha: number, width = 2): void {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.2));
    g.lineStyle(width, color, alpha);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const sx = worldToScreenX(x + Math.cos(a) * r, y + Math.sin(a) * r);
      const sy = worldToScreenY(x + Math.cos(a) * r, y + Math.sin(a) * r);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokePath();
  }

  private polygon(g: Phaser.GameObjects.Graphics, count: number, color: number, fillA: number, lineA: number): void {
    const pts = this.pts;
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < count; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.closePath();
    if (fillA > 0) {
      g.fillStyle(color, fillA);
      g.fillPath();
    }
    if (lineA > 0) {
      g.lineStyle(2, color, lineA);
      g.strokePath();
    }
  }

  reset(): void {
    this.flashes.length = 0;
  }

  destroy(): void {
    this.ground.destroy();
    this.top.destroy();
    this.chevron.destroy();
  }
}
