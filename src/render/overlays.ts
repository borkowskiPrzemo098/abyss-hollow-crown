import type Phaser from 'phaser';
import { HERO } from '../config/balance';
import { worldToScreenX, worldToScreenY } from '../core/iso';
import type { Simulation } from '../sim/simulation';
import type { Enemy } from '../sim/types';
import { PAL } from './palette';
import { RES } from './textures';
import { LAYER } from './worldView';

const DEG = Math.PI / 180;

interface StrikeFlash {
  enemy: Enemy;
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

  constructor(scene: Phaser.Scene) {
    this.ground = scene.add.graphics().setDepth(LAYER.telegraph);
    this.top = scene.add.graphics().setDepth(LAYER.overlay);
    this.chevron = scene.add.image(0, 0, 'chevron').setScale(1 / RES).setDepth(LAYER.overlay + 1).setVisible(false);
    for (let i = 0; i < 40; i++) this.pts.push({ x: 0, y: 0 });
  }

  onStrike(e: Enemy): void {
    this.flashes.push({ enemy: e, aim: e.aim, x: e.x, y: e.y, life: 0.16 });
  }

  draw(sim: Simulation, views: ReadonlyMap<number, ViewPos>, dt: number, time: number): void {
    const g = this.ground;
    const t = this.top;
    g.clear();
    t.clear();

    for (const e of sim.enemies) {
      if (e.state === 'windup') {
        const p = 1 - Math.max(0, e.stateT) / e.stateDur;
        this.drawShape(g, e, e.x, e.y, e.aim, 1, PAL.danger, 0.13, 0.75);
        // the inner fill grows to the edge exactly when the hit lands
        this.drawShape(g, e, e.x, e.y, e.aim, p, PAL.danger, 0.24 + p * 0.12, 0);
        if (p > 0.82) this.drawShape(g, e, e.x, e.y, e.aim, 1, 0xffd2c8, 0, 0.9);
      } else if (e.state === 'spawning') {
        const p = 1 - Math.max(0, e.stateT) / e.stateDur;
        this.circle(g, e.x, e.y, 0.55 + 0.25 * p, PAL.hollow, 0.08 + 0.12 * p, 0.6);
        this.arc(g, e.x, e.y, 0.75, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, PAL.hollow, 0.9);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      this.drawShape(g, f.enemy, f.x, f.y, f.aim, 1, 0xffe6dc, (f.life / 0.16) * 0.45, 0);
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
      if (!v || e.state === 'dead' || e.state === 'spawning') continue;
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
      const p = 1 - h.dodgeCd / HERO.dodge.cooldown;
      this.arc(g, h.x, h.y, h.r + 0.18, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, PAL.bone, 0.28, 1.5);
    }
  }

  private drawShape(
    g: Phaser.GameObjects.Graphics,
    e: Enemy,
    x: number,
    y: number,
    aim: number,
    scale: number,
    color: number,
    fillA: number,
    lineA: number,
  ): void {
    const shape = e.def.attack.shape;
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
    } else {
      const cx = x + Math.cos(aim) * shape.offset;
      const cy = y + Math.sin(aim) * shape.offset;
      this.circle(g, cx, cy, shape.radius * Math.max(0.02, scale), color, fillA, lineA);
    }
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
