import Phaser from 'phaser';
import { depthOf, worldDirToScreenAngle, worldToScreenX, worldToScreenY } from '../core/iso';
import type { Simulation } from '../sim/simulation';
import { PAL } from './palette';
import { RES } from './textures';
import { LAYER } from './worldView';

const S = 1 / RES;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Height above the floor at which projectiles fly (screen px). */
const FLY_H = 18;

interface ObjView {
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  kind: string;
}

/**
 * Views for short-lived simulation entities: projectiles, pickups and room
 * objects. Images are recycled through small free-lists, never created per frame.
 */
export class EntityViews {
  private readonly proj = new Map<number, { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }>();
  private readonly picks = new Map<number, Phaser.GameObjects.Image>();
  private readonly objs = new Map<number, ObjView>();
  private readonly free: Phaser.GameObjects.Image[] = [];
  private readonly seen = new Set<number>();

  constructor(private readonly scene: Phaser.Scene) {}

  private take(key: string): Phaser.GameObjects.Image {
    const img = this.free.pop() ?? this.scene.add.image(0, 0, key);
    return img.setTexture(key).setVisible(true).setAlpha(1).setRotation(0).setScale(S).setOrigin(0.5).clearTint().setBlendMode(Phaser.BlendModes.NORMAL);
  }

  private give(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    this.free.push(img);
  }

  sync(sim: Simulation, alpha: number, time: number, revealed: (roomId: number) => boolean): void {
    // projectiles
    this.seen.clear();
    for (const p of sim.projectiles) {
      this.seen.add(p.id);
      let v = this.proj.get(p.id);
      if (!v) {
        const enemy = p.team === 'enemy';
        const body = this.take(enemy ? 'ember' : 'shard').setBlendMode(Phaser.BlendModes.ADD);
        if (enemy) body.setScale(S * 1.25);
        const shadow = this.take('shadow').setScale(S * (enemy ? 0.32 : 0.18)).setAlpha(0.7);
        v = { body, shadow };
        this.proj.set(p.id, v);
      }
      const x = lerp(p.px, p.x, alpha);
      const y = lerp(p.py, p.y, alpha);
      const sx = worldToScreenX(x, y);
      const sy = worldToScreenY(x, y);
      v.body.setPosition(sx, sy - FLY_H).setDepth(depthOf(x, y) + 0.5);
      if (p.team === 'hero') v.body.setRotation(worldDirToScreenAngle(p.vx, p.vy));
      else v.body.setScale(S * (1.15 + Math.sin(time * 30) * 0.1));
      v.shadow.setPosition(sx, sy).setDepth(LAYER.floorDecal + 0.5);
    }
    for (const [id, v] of this.proj) {
      if (this.seen.has(id)) continue;
      this.give(v.body);
      this.give(v.shadow);
      this.proj.delete(id);
    }

    // pickups
    this.seen.clear();
    for (const p of sim.pickups) {
      this.seen.add(p.id);
      let img = this.picks.get(p.id);
      if (!img) {
        img = this.take('mote').setBlendMode(Phaser.BlendModes.ADD).setTint(p.kind === 'heal' ? PAL.gold : PAL.bone);
        this.picks.set(p.id, img);
      }
      const x = lerp(p.px, p.x, alpha);
      const y = lerp(p.py, p.y, alpha);
      const bob = Math.sin(time * 5 + p.id) * 2;
      img
        .setPosition(worldToScreenX(x, y), worldToScreenY(x, y) - 8 + bob)
        .setDepth(depthOf(x, y) + 0.4)
        .setScale(S * (p.kind === 'heal' ? 1.6 : 0.9) * (1 + Math.sin(time * 8 + p.id) * 0.15));
    }
    for (const [id, img] of this.picks) {
      if (this.seen.has(id)) continue;
      this.give(img);
      this.picks.delete(id);
    }

    // room objects
    this.seen.clear();
    for (const o of sim.objects) {
      this.seen.add(o.id);
      let v = this.objs.get(o.id);
      const sx = worldToScreenX(o.x, o.y);
      const sy = worldToScreenY(o.x, o.y);
      if (!v) {
        let img: Phaser.GameObjects.Image;
        let glow: Phaser.GameObjects.Image | null = null;
        if (o.kind === 'stairs') {
          img = this.take('stairs').setPosition(sx, sy).setDepth(LAYER.floorDecal + 0.2);
          glow = this.take('light').setScale(3.2 / RES, 1.7 / RES).setTint(PAL.ember).setBlendMode(Phaser.BlendModes.ADD).setPosition(sx, sy).setDepth(LAYER.groundLight);
        } else {
          img = this.take(o.kind === 'chest' ? 'chest' : 'shrine').setOrigin(0.5, 1).setPosition(sx, sy + 8).setDepth(depthOf(o.x, o.y));
          glow = this.take('light').setScale(2.6 / RES, 1.4 / RES).setTint(o.kind === 'chest' ? PAL.emberHot : PAL.gold).setBlendMode(Phaser.BlendModes.ADD).setPosition(sx, sy).setDepth(LAYER.groundLight);
        }
        v = { img, glow, kind: o.kind };
        this.objs.set(o.id, v);
      }
      const visible = revealed(o.roomId);
      v.img.setVisible(visible);
      if (o.kind === 'chest') v.img.setTexture(o.used ? 'chestOpen' : 'chest');
      if (o.kind === 'shrine') {
        if (o.used) v.img.setTint(0x6a6a74);
        else v.img.clearTint();
      }
      if (o.kind === 'stairs') v.img.setAlpha(o.active ? 1 : 0.45);
      if (v.glow) {
        const lit = visible && o.active && !o.used;
        v.glow.setVisible(lit || (o.kind === 'stairs' && o.active && visible));
        v.glow.setAlpha(0.35 + Math.sin(time * 3 + o.id) * 0.12);
      }
    }
    for (const [id, v] of this.objs) {
      if (this.seen.has(id)) continue;
      this.give(v.img);
      if (v.glow) this.give(v.glow);
      this.objs.delete(id);
    }
  }

  clear(): void {
    for (const v of this.proj.values()) {
      this.give(v.body);
      this.give(v.shadow);
    }
    for (const img of this.picks.values()) this.give(img);
    for (const v of this.objs.values()) {
      this.give(v.img);
      if (v.glow) this.give(v.glow);
    }
    this.proj.clear();
    this.picks.clear();
    this.objs.clear();
  }

  destroy(): void {
    this.clear();
    for (const img of this.free) img.destroy();
    this.free.length = 0;
  }
}
