import Phaser from 'phaser';
import { depthOf, worldToScreenX, worldToScreenY } from '../core/iso';
import { Tile, tileAt, type ArenaMap } from '../world/arena';
import { PAL } from './palette';
import { LOW_WALL_H, PILLAR_H, RES, WALL_H } from './textures';

/** Render layers. Objects standing on the floor use depthOf() (≥100). */
export const LAYER = {
  floor: 0,
  floorDecal: 1,
  groundLight: 2,
  telegraph: 3,
  overlay: 9000,
  fx: 9500,
  text: 9800,
} as const;

interface WallSprite {
  img: Phaser.GameObjects.Image;
  sx: number;
  sy: number;
  height: number;
  depth: number;
}

interface Light {
  img: Phaser.GameObjects.Image;
  base: number;
  phase: number;
}

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Static isometric room: floor, walls, pillars, braziers, ambient lights and dust. */
export class WorldView {
  private readonly occluders: WallSprite[] = [];
  private readonly lights: Light[] = [];
  private readonly emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene, map: ArenaMap) {
    const s = 1 / RES;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const t = tileAt(map, tx, ty);
        const sx = worldToScreenX(tx + 0.5, ty + 0.5);
        const sy = worldToScreenY(tx + 0.5, ty + 0.5);
        if (t !== Tile.Wall) {
          const v = hash(tx, ty) % 6;
          this.add(scene.add.image(sx, sy, `floor${v}`).setScale(s).setDepth(LAYER.floor));
        }
        if (t === Tile.Wall || t === Tile.Pillar) {
          const front = tx === map.w - 1 || ty === map.h - 1;
          const key = t === Tile.Pillar ? 'pillar' : front ? 'wallLow' : `wall${hash(ty, tx) % 3}`;
          const h = t === Tile.Pillar ? PILLAR_H : front ? LOW_WALL_H : WALL_H;
          const img = scene.add
            .image(sx, sy, key)
            .setScale(s)
            .setOrigin(0.5, (16 + h) / (32 + h))
            .setDepth(depthOf(tx + 0.5, ty + 0.5));
          this.add(img);
          // Interior walls and pillars can hide the hero; border walls never do.
          const border = tx === 0 || ty === 0 || front;
          if (!border) this.occluders.push({ img, sx, sy, height: h, depth: img.depth });
        }
        if (t === Tile.Brazier) this.addBrazier(sx, sy, tx, ty);
      }
    }
    for (const d of map.decor) {
      const sx = worldToScreenX(d.tx + 0.5, d.ty + 0.5);
      const sy = worldToScreenY(d.tx + 0.5, d.ty + 0.5);
      this.add(scene.add.image(sx, sy, 'rubble').setScale(s).setDepth(LAYER.floorDecal).setAlpha(0.9));
    }
    const hx = worldToScreenX(map.heroStart.x, map.heroStart.y);
    const hy = worldToScreenY(map.heroStart.x, map.heroStart.y);
    this.add(scene.add.image(hx, hy, 'sigil').setScale(s).setDepth(LAYER.floorDecal));
    this.addDust(map);
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private addBrazier(sx: number, sy: number, tx: number, ty: number): void {
    const s = 1 / RES;
    const depth = depthOf(tx + 0.5, ty + 0.5);
    this.add(this.scene.add.image(sx, sy + 6, 'brazier').setScale(s).setOrigin(0.5, 1).setDepth(depth));
    const light = this.scene.add
      .image(sx, sy, 'light')
      .setScale(5.2 / RES, 2.8 / RES)
      .setTint(PAL.ember)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LAYER.groundLight)
      .setAlpha(0.42);
    this.add(light);
    this.lights.push({ img: light, base: 0.42, phase: hash(tx, ty) % 100 });
    const flame = this.scene.add.particles(sx, sy - 22, 'mote', {
      lifespan: { min: 380, max: 720 },
      speedY: { min: -46, max: -18 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.95, end: 0 },
      color: [PAL.emberHot, PAL.ember, PAL.emberDeep],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 45,
      emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 14, 5), quantity: 1 },
    });
    flame.setDepth(depth + 1);
    this.emitters.push(flame);
    this.add(flame);
  }

  private addDust(map: ArenaMap): void {
    const w = map.w * 32;
    const top = worldToScreenY(0, 0);
    const bottom = worldToScreenY(map.w, map.h);
    const dust = this.scene.add.particles(0, 0, 'mote', {
      lifespan: 7000,
      speedX: { min: -6, max: 6 },
      speedY: { min: -10, max: -2 },
      scale: { start: 0.35, end: 0.1 },
      // fade in and out over the particle's life
      alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.22 },
      tint: PAL.ash,
      blendMode: Phaser.BlendModes.ADD,
      frequency: 160,
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-w, top, w * 2, bottom - top), quantity: 1 },
    });
    dust.setDepth(LAYER.fx - 1);
    this.emitters.push(dust);
    this.add(dust);
  }

  /** Flickers the brazier lights. */
  update(timeSec: number): void {
    for (const l of this.lights) {
      const f = Math.sin(timeSec * 7.1 + l.phase) * 0.5 + Math.sin(timeSec * 13.7 + l.phase * 2) * 0.3;
      l.img.setAlpha(l.base + f * 0.06);
    }
  }

  /** Fades interior walls that stand in front of the hero so the hero is never hidden. */
  updateOcclusion(heroSX: number, heroSY: number, heroDepth: number): void {
    for (const o of this.occluders) {
      let target = 1;
      if (o.depth > heroDepth) {
        const overlapX = Math.abs(o.sx - heroSX) < 32 + 14;
        const overlapY = heroSY > o.sy - 16 - o.height && heroSY - 50 < o.sy + 16;
        if (overlapX && overlapY) target = 0.32;
      }
      const a = o.img.alpha;
      if (Math.abs(a - target) > 0.005) o.img.setAlpha(a + (target - a) * 0.2);
    }
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.occluders.length = 0;
    this.lights.length = 0;
    this.emitters.length = 0;
  }
}
