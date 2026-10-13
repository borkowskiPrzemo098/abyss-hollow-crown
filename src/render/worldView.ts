import Phaser from 'phaser';
import { depthOf, worldToScreenX, worldToScreenY } from '../core/iso';
import { Tile, tileAt, type Decor } from '../world/arena';
import { biomeFor, TRAPS, type BiomeDef } from '../config/biomes';
import type { Simulation } from '../sim/simulation';
import type { Dungeon, TrapTile } from '../world/dungeon';
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

interface Occluder {
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

interface Group {
  items: { obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.AlphaSingle; alpha: number }[];
  revealed: boolean;
  /** Its game objects exist (they are made when the room is first revealed, not when the floor loads). */
  built: boolean;
  /** Inside the camera's view (plus a margin): only then are its objects shown and updated. */
  inView: boolean;
  /** Tile indices of the region, decor and traps that belong to it, kept until it is built. */
  tiles: number[];
  decor: Decor[];
  traps: TrapTile[];
  /** Screen-space extent of everything in it. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** How far outside the camera a region is still kept alive (px of the world, covers tall walls and soft light). */
const CULL_MARGIN = 220;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

const N8: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * One dungeon floor drawn isometrically. Everything is grouped by region (room
 * or corridor) and stays hidden until the director reveals it, so the floor is
 * explored, not shown. Walls with floor behind them (from the camera's view)
 * are drawn low so they never hide the hero; walls with floor only in front
 * are tall and give rooms their depth.
 */
export class WorldView {
  private readonly groups = new Map<string, Group>();
  private readonly occluders: Occluder[] = [];
  private readonly lights: Light[] = [];
  private readonly gates: { img: Phaser.GameObjects.Image; idx: number; group: string }[] = [];
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly trapViews: { kind: string; tx: number; ty: number; base: Phaser.GameObjects.Image; up?: Phaser.GameObjects.Image; glow?: Phaser.GameObjects.Image; group: string }[] = [];
  private readonly biome: BiomeDef;

  private readonly walkableish: (x: number, y: number) => boolean;
  private readonly groupOf: (x: number, y: number) => string | null;
  /** Camera view of the last cull() call. */
  private view = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
  /** Traps of the running simulation by tile, for the per-frame animation (rebuilt when the floor's traps change). */
  private trapIndex = new Map<number, { phase: number }>();
  private trapIndexFor: unknown = null;

  /**
   * Plans the floor: which tile belongs to which room or corridor. Nothing is drawn yet — a region's
   * game objects are created the first time it is revealed, so a big floor costs nothing until it is explored.
   */
  constructor(private readonly scene: Phaser.Scene, private readonly dungeon: Dungeon) {
    this.biome = biomeFor(dungeon.depth);
    const { map, region } = dungeon;
    const W = map.w;
    this.walkableish = (x: number, y: number) => tileAt(map, x, y) !== Tile.Wall;
    this.groupOf = (x: number, y: number): string | null => {
      let r = region[y * W + x] ?? -1;
      if (r === -1) {
        for (const [dx, dy] of N8) {
          const n = region[(y + dy) * W + (x + dx)] ?? -1;
          if (n !== -1 && this.walkableish(x + dx, y + dy)) {
            r = n;
            break;
          }
        }
      }
      if (r === -1) return null;
      return r >= 0 ? `r${r}` : `c${-r - 2}`;
    };

    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const g = this.groupOf(tx, ty);
        if (!g) continue;
        // buried rock (a wall with nothing walkable beside it) is never drawn
        if (tileAt(map, tx, ty) === Tile.Wall && !N8.some(([dx, dy]) => this.walkableish(tx + dx, ty + dy))) continue;
        this.group(g).tiles.push(ty * W + tx);
      }
    }
    for (const d of map.decor) {
      const g = this.groupOf(d.tx, d.ty);
      if (g) this.group(g).decor.push(d);
    }
    for (const t of dungeon.traps) {
      const g = this.groupOf(t.tx, t.ty);
      if (g) this.group(g).traps.push(t);
    }

    const s = 1 / RES;
    for (const r of dungeon.rooms) {
      for (const dr of r.doors) {
        // the wall a door sits in runs along world y when the door is on an east/west side
        const alongY = dr.tx === r.x0 - 1 || dr.tx === r.x1 + 1;
        const img = scene.add
          .image(worldToScreenX(dr.tx + 0.5, dr.ty + 0.5), worldToScreenY(dr.tx + 0.5, dr.ty + 0.5), alongY ? 'gateY' : 'gateX')
          .setScale(s)
          .setOrigin(0.5, 56 / 72)
          .setDepth(depthOf(dr.tx + 0.5, dr.ty + 0.5))
          .setVisible(false);
        this.objects.push(img);
        this.gates.push({ img, idx: dr.ty * W + dr.tx, group: `r${r.id}` });
      }
    }
    this.addDust();
  }

  private group(key: string): Group {
    let g = this.groups.get(key);
    if (!g) {
      g = { items: [], revealed: false, built: false, inView: true, tiles: [], decor: [], traps: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      this.groups.set(key, g);
    }
    return g;
  }

  /** Makes the game objects of one room or corridor. */
  private build(key: string): void {
    const g = this.groups.get(key);
    if (!g || g.built) return;
    g.built = true;
    const scene = this.scene;
    const s = 1 / RES;
    const { map } = this.dungeon;
    const W = map.w;
    for (const idx of g.tiles) {
      const tx = idx % W;
      const ty = (idx - tx) / W;
      const t = tileAt(map, tx, ty);
      const sx = worldToScreenX(tx + 0.5, ty + 0.5);
      const sy = worldToScreenY(tx + 0.5, ty + 0.5);
      if (t !== Tile.Wall) this.add(key, scene.add.image(sx, sy, this.k(`floor${hash(tx, ty) % 6}`)).setScale(s).setDepth(LAYER.floor));
      if (t === Tile.Wall) {
        const low = this.walkableish(tx - 1, ty) || this.walkableish(tx, ty - 1) || this.walkableish(tx - 1, ty - 1);
        const h = low ? LOW_WALL_H : WALL_H;
        const img = scene.add
          .image(sx, sy, this.k(low ? 'wallLow' : `wall${hash(ty, tx) % 3}`))
          .setScale(s)
          .setOrigin(0.5, (16 + h) / (32 + h))
          .setDepth(depthOf(tx + 0.5, ty + 0.5));
        this.add(key, img);
      } else if (t === Tile.Pillar) {
        const img = scene.add
          .image(sx, sy, this.k('pillar'))
          .setScale(s)
          .setOrigin(0.5, (16 + PILLAR_H) / (32 + PILLAR_H))
          .setDepth(depthOf(tx + 0.5, ty + 0.5));
        this.add(key, img);
        this.occluders.push({ img, sx, sy, height: PILLAR_H, depth: img.depth });
      } else if (t === Tile.Brazier) {
        this.addBrazier(key, sx, sy, tx, ty);
      }
    }
    if (key.startsWith('r')) {
      const r = this.dungeon.rooms[Number(key.slice(1))];
      if (r?.type === 'start') this.add(key, scene.add.image(worldToScreenX(r.cx, r.cy), worldToScreenY(r.cx, r.cy), this.k('sigil')).setScale(s * 0.75).setDepth(LAYER.floorDecal));
    }
    for (const d of g.decor) {
      const sx = worldToScreenX(d.tx + 0.5, d.ty + 0.5);
      const sy = worldToScreenY(d.tx + 0.5, d.ty + 0.5);
      this.add(key, scene.add.image(sx, sy, 'rubble').setScale(s).setDepth(LAYER.floorDecal).setAlpha(0.9));
    }
    this.buildTraps(key, g.traps);
    g.tiles = [];
    g.decor = [];
    g.traps = [];
  }

  /** Texture key for this floor's biome. */
  private k(name: string): string {
    return this.biome.id + '-' + name;
  }

  private buildTraps(g: string, traps: TrapTile[]): void {
    const s = 1 / RES;
    for (const t of traps) {
      const sx = worldToScreenX(t.tx + 0.5, t.ty + 0.5);
      const sy = worldToScreenY(t.tx + 0.5, t.ty + 0.5);
      if (t.kind === 'spikes') {
        const base = this.scene.add.image(sx, sy, 'trapSpikes').setScale(s).setOrigin(0.5, 28 / 44).setDepth(LAYER.floorDecal + 0.1);
        const up = this.scene.add.image(sx, sy, 'trapSpikesUp').setScale(s).setOrigin(0.5, 28 / 44).setDepth(depthOf(t.tx + 0.5, t.ty + 0.5) - 0.5);
        this.add(g, base);
        this.add(g, up);
        this.trapViews.push({ kind: t.kind, tx: t.tx, ty: t.ty, base, up, group: g });
      } else {
        const key = t.kind === 'ice' ? 'trapIce' : t.kind === 'lava' ? 'trapLava' : 'trapVent';
        const base = this.scene.add.image(sx, sy, key).setScale(s).setDepth(LAYER.floorDecal + 0.1);
        this.add(g, base);
        let glow: Phaser.GameObjects.Image | undefined;
        if (t.kind === 'lava' || t.kind === 'vent') {
          glow = this.scene.add.image(sx, sy, 'light').setScale(1.6 / RES, 0.9 / RES).setTint(0xff6a2a).setBlendMode(Phaser.BlendModes.ADD).setDepth(LAYER.groundLight).setAlpha(t.kind === 'lava' ? 0.35 : 0);
          this.add(g, glow);
        }
        this.trapViews.push({ kind: t.kind, tx: t.tx, ty: t.ty, base, glow, group: g });
      }
    }
  }

  /** Spikes rise and vents glow following the simulation's trap clock; lava breathes. */
  updateTraps(sim: Simulation, timeSec: number): void {
    if (this.trapIndexFor !== sim.traps) {
      this.trapIndex.clear();
      for (const t of sim.traps) this.trapIndex.set(t.ty * this.dungeon.map.w + t.tx, t);
      this.trapIndexFor = sim.traps;
    }
    for (const v of this.trapViews) {
      const grp = this.groups.get(v.group);
      if (!grp?.revealed || !grp.inView) continue;
      if (v.kind === 'lava') {
        v.glow?.setAlpha(0.3 + Math.sin(timeSec * 2 + v.tx) * 0.08);
        continue;
      }
      if (v.kind !== 'spikes' && v.kind !== 'vent') continue;
      const trap = this.trapIndex.get(v.ty * this.dungeon.map.w + v.tx);
      if (!trap) continue;
      const T = v.kind === 'spikes' ? TRAPS.spikes : TRAPS.vent;
      const local = (sim.time + trap.phase) % T.period;
      const warn = local >= T.warn && local < T.up;
      const active = local >= T.up;
      if (v.up) v.up.setVisible(active);
      if (warn) v.base.setTint(Math.floor(timeSec * 12) % 2 ? 0xff6a5a : 0xffb0a0);
      else v.base.clearTint();
      if (v.glow) v.glow.setAlpha(active ? 0.6 : warn ? 0.25 : 0);
    }
  }

  private add(group: string, o: Phaser.GameObjects.Image | Phaser.GameObjects.Particles.ParticleEmitter): void {
    const g = this.group(group);
    g.items.push({ obj: o, alpha: o.alpha });
    g.minX = Math.min(g.minX, o.x);
    g.maxX = Math.max(g.maxX, o.x);
    g.minY = Math.min(g.minY, o.y);
    g.maxY = Math.max(g.maxY, o.y);
    o.setVisible(false);
    this.objects.push(o);
  }

  private addBrazier(group: string, sx: number, sy: number, tx: number, ty: number): void {
    const s = 1 / RES;
    const depth = depthOf(tx + 0.5, ty + 0.5);
    this.add(group, this.scene.add.image(sx, sy + 6, this.k('brazier')).setScale(s).setOrigin(0.5, 1).setDepth(depth));
    const light = this.scene.add
      .image(sx, sy, 'light')
      .setScale(5.2 / RES, 2.8 / RES)
      .setTint(this.biome.palette.light)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LAYER.groundLight)
      .setAlpha(0.42);
    this.add(group, light);
    this.lights.push({ img: light, base: 0.42, phase: hash(tx, ty) % 100 });
    const flame = this.scene.add.particles(sx, sy - 22, 'mote', {
      lifespan: { min: 380, max: 720 },
      speedY: { min: -46, max: -18 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.95, end: 0 },
      color: [...this.biome.palette.flame],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 45,
      emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(0, 0, 14, 5), quantity: 1 },
    });
    flame.setDepth(depth + 1);
    this.add(group, flame);
  }

  private addDust(): void {
    const { map } = this.dungeon;
    const w = map.w * 32;
    const bottom = worldToScreenY(map.w, map.h);
    const dust = this.scene.add.particles(0, 0, 'mote', {
      lifespan: 7000,
      speedX: { min: -6, max: 6 },
      speedY: { min: -10, max: -2 },
      scale: { start: 0.35, end: 0.1 },
      // fade in and out over the particle's life
      alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.2 },
      tint: PAL.ash,
      blendMode: Phaser.BlendModes.ADD,
      frequency: 90,
      emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-w, 0, w * 2, bottom), quantity: 1 },
    });
    dust.setDepth(LAYER.fx - 1);
    this.objects.push(dust);
  }

  /** Shows newly revealed rooms and corridors with a short fade. */
  reveal(rooms: Uint8Array, corridors: Uint8Array, instant = false): void {
    const show = (key: string) => {
      const g = this.groups.get(key);
      if (!g || g.revealed) return;
      this.build(key);
      g.revealed = true;
      g.inView = this.intersects(g);
      for (const it of g.items) {
        it.obj.setVisible(g.inView).setActive(g.inView);
        if (instant || !g.inView) it.obj.setAlpha(it.alpha);
        else {
          it.obj.setAlpha(0);
          this.scene.tweens.add({ targets: it.obj, alpha: it.alpha, duration: 380, ease: 'Sine.easeOut' });
        }
      }
    };
    rooms.forEach((v, i) => v && show(`r${i}`));
    corridors.forEach((v, i) => v && show(`c${i}`));
  }

  private intersects(g: Group): boolean {
    const v = this.view;
    return g.maxX + CULL_MARGIN >= v.x && g.minX - CULL_MARGIN <= v.x + v.w && g.maxY + CULL_MARGIN >= v.y && g.minY - CULL_MARGIN <= v.y + v.h;
  }

  /**
   * Shows only the rooms and corridors near the camera (screen-space world view). A floor can hold dozens of
   * rooms and thousands of tiles; what is far away is hidden and not updated, so the cost follows the screen,
   * not the size of the floor.
   */
  cull(x: number, y: number, w: number, h: number): void {
    this.view = { x, y, w, h };
    for (const g of this.groups.values()) {
      if (!g.revealed || !g.built) continue;
      const now = this.intersects(g);
      if (now === g.inView) continue;
      g.inView = now;
      for (const it of g.items) it.obj.setVisible(now).setActive(now);
    }
  }

  /** How much the floor has cost so far (for the measurements). */
  stats(): { regions: number; built: number; revealed: number; objects: number; shown: number } {
    let built = 0;
    let revealed = 0;
    let shown = 0;
    for (const g of this.groups.values()) {
      if (g.built) built++;
      if (g.revealed) revealed++;
      if (g.revealed && g.inView) shown += g.items.length;
    }
    return { regions: this.groups.size, built, revealed, objects: this.objects.length, shown };
  }

  /** Is the room/corridor containing this world point visible yet? */
  isRevealedAt(x: number, y: number): boolean {
    const r = this.dungeon.region[Math.floor(y) * this.dungeon.map.w + Math.floor(x)] ?? -1;
    if (r === -1) return false;
    return this.groups.get(r >= 0 ? "r" + r : "c" + (-r - 2))?.revealed ?? false;
  }

  isRevealed(roomId: number): boolean {
    return this.groups.get(`r${roomId}`)?.revealed ?? false;
  }

  /** Portcullis sprites follow the door tiles. */
  updateDoors(): void {
    const tiles = this.dungeon.map.tiles;
    for (const g of this.gates) {
      const closed = tiles[g.idx] === Tile.Door;
      const want = closed && (this.groups.get(g.group)?.revealed ?? false);
      if (g.img.visible !== want) g.img.setVisible(want);
    }
  }

  /** Flickers the brazier lights. */
  update(timeSec: number): void {
    for (const l of this.lights) {
      if (!l.img.visible) continue;
      const f = Math.sin(timeSec * 7.1 + l.phase) * 0.5 + Math.sin(timeSec * 13.7 + l.phase * 2) * 0.3;
      l.img.setAlpha(l.base + f * 0.06);
    }
  }

  /** Fades pillars that stand in front of the hero so the hero is never hidden. */
  updateOcclusion(heroSX: number, heroSY: number, heroDepth: number): void {
    for (const o of this.occluders) {
      if (!o.img.visible) continue;
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
    for (const o of this.objects) {
      this.scene.tweens.killTweensOf(o);
      o.destroy();
    }
    this.objects.length = 0;
    this.groups.clear();
    this.occluders.length = 0;
    this.lights.length = 0;
    this.gates.length = 0;
  }
}
