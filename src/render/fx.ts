import Phaser from 'phaser';
import { RES } from './textures';
import { PAL } from './palette';
import { LAYER } from './worldView';

const S = 1 / RES;

interface Floater {
  text: Phaser.GameObjects.Text;
  life: number;
  max: number;
  vy: number;
  pop: number;
}

interface Timed {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  from: number;
  to: number;
  baseAlpha: number;
  sy: number;
}

export type FloaterKind = 'hit' | 'crit' | 'hurt' | 'evade' | 'heal' | 'level' | 'burn' | 'bleed';

/**
 * Pooled combat feedback. Nothing here allocates per frame: floaters, slashes,
 * rings and afterimages come from fixed pools; particles use pre-built emitters.
 */
export class Fx {
  private readonly floaters: Floater[] = [];
  private readonly slashes: Timed[] = [];
  private readonly rings: Timed[] = [];
  private readonly ghosts: Timed[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly bone: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly souls: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flames: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly frost: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly bolts: Phaser.GameObjects.Graphics;
  private readonly arcs: { pts: number[]; life: number }[] = [];
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < 24; i++) {
      const text = scene.add
        .text(0, 0, '', {
          fontFamily: '"Alegreya Sans", sans-serif',
          fontStyle: '800',
          fontSize: '20px',
          color: '#f3ead6',
          stroke: '#0b0b0e',
          strokeThickness: 5,
          resolution: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(LAYER.text)
        .setVisible(false);
      this.objects.push(text);
      this.floaters.push({ text, life: 0, max: 1, vy: 0, pop: 0 });
    }
    const pool = (n: number, key: string, add: boolean, out: Timed[]) => {
      for (let i = 0; i < n; i++) {
        const img = scene.add.image(0, 0, key).setVisible(false).setDepth(LAYER.fx);
        if (add) img.setBlendMode(Phaser.BlendModes.ADD);
        this.objects.push(img);
        out.push({ img, life: 0, max: 1, from: 1, to: 1, baseAlpha: 1, sy: 1 });
      }
    };
    pool(5, 'slash', true, this.slashes);
    pool(4, 'ring', true, this.rings);
    pool(6, 'heroBody', true, this.ghosts);

    const emitter = (key: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const e = scene.add.particles(0, 0, key, { emitting: false, ...cfg });
      e.setDepth(LAYER.fx);
      this.objects.push(e);
      return e;
    };
    this.sparks = emitter('spark', {
      speed: { min: 90, max: 260 },
      lifespan: { min: 160, max: 340 },
      scale: { start: 0.55, end: 0 },
      color: [0xffffff, PAL.emberHot, PAL.ember],
      blendMode: Phaser.BlendModes.ADD,
      rotate: { min: 0, max: 360 },
    });
    this.bone = emitter('chip', {
      speed: { min: 30, max: 110 },
      angle: { min: 200, max: 340 },
      gravityY: 320,
      lifespan: { min: 300, max: 560 },
      scale: { start: 0.6, end: 0.2 },
      tint: [PAL.bone, PAL.ash, 0x6e6a61],
    });
    this.souls = emitter('mote', {
      speedY: { min: -60, max: -25 },
      speedX: { min: -12, max: 12 },
      lifespan: { min: 600, max: 1100 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      color: [PAL.hollow, PAL.hollowDeep],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.debris = emitter('chip', {
      speed: { min: 110, max: 280 },
      angle: { min: 190, max: 350 },
      gravityY: 520,
      lifespan: { min: 380, max: 700 },
      scale: { start: 0.9, end: 0.3 },
      tint: [PAL.stone4, PAL.stone5, PAL.ash],
    });
    this.flames = emitter('mote', {
      speedY: { min: -120, max: -50 },
      speedX: { min: -25, max: 25 },
      lifespan: { min: 280, max: 560 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      color: [0xffe0a0, 0xff7a2a, 0xc0301a],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.frost = emitter('spark', {
      speed: { min: 60, max: 200 },
      lifespan: { min: 260, max: 520 },
      scale: { start: 0.8, end: 0 },
      color: [0xffffff, 0xbfe6ff, 0x6fb8ff],
      blendMode: Phaser.BlendModes.ADD,
      rotate: { min: 0, max: 360 },
    });
    this.bolts = scene.add.graphics().setDepth(LAYER.fx + 1).setBlendMode(Phaser.BlendModes.ADD);
    this.objects.push(this.bolts);
    this.dust = emitter('mote', {
      speed: { min: 10, max: 45 },
      lifespan: { min: 280, max: 520 },
      scale: { start: 0.5, end: 1.1 },
      alpha: { start: 0.28, end: 0 },
      tint: PAL.ash,
    });
  }

  floater(x: number, y: number, label: string, kind: FloaterKind): void {
    const f = this.floaters.find((o) => o.life <= 0) ?? this.floaters[0]!;
    const color = { crit: '#ffb85c', hurt: '#ff6457', evade: '#9df0e6', heal: '#f2d27a', level: '#ffd98a', hit: '#f3ead6', burn: '#ff9a4a', bleed: '#e0647a' }[kind];
    const size = kind === 'crit' ? 28 : kind === 'level' ? 24 : kind === 'evade' || kind === 'burn' ? 16 : 20;
    f.text
      .setText(label)
      .setColor(color)
      .setFontSize(size)
      .setPosition(x + (Math.random() - 0.5) * 10, y)
      .setVisible(true)
      .setAlpha(1);
    f.life = f.max = kind === 'crit' || kind === 'level' ? 0.9 : 0.65;
    f.vy = kind === 'evade' ? -26 : -46;
    f.pop = kind === 'crit' ? 1.5 : 1.25;
  }

  slash(x: number, y: number, screenAngle: number, crit: boolean): void {
    const s = this.slashes.find((o) => o.life <= 0) ?? this.slashes[0]!;
    s.img.setPosition(x, y).setRotation(screenAngle).setVisible(true).setTint(crit ? PAL.emberHot : 0xffffff);
    s.life = s.max = 0.16;
    s.from = S * 0.62;
    s.to = S * 0.82;
    s.baseAlpha = 1;
    s.sy = 0.72;
  }

  ring(x: number, y: number, radiusTiles: number, color: number, life = 0.38): void {
    const r = this.rings.find((o) => o.life <= 0) ?? this.rings[0]!;
    // ring texture radius is 60 world px horizontally; an iso circle of r tiles is 45.25·r px wide
    const target = (radiusTiles * 45.25) / 60;
    r.img.setPosition(x, y).setVisible(true).setTint(color).setDepth(LAYER.telegraph + 0.5);
    r.life = r.max = life;
    r.from = target * 0.25 * S;
    r.to = target * S;
    r.baseAlpha = 0.95;
    r.sy = 1;
  }

  afterimage(x: number, y: number, flipped: boolean, rotation: number, bodyKey: string): void {
    const g = this.ghosts.find((o) => o.life <= 0) ?? this.ghosts[0]!;
    g.img
      .setTexture(bodyKey)
      .setPosition(x, y - 3)
      .setOrigin(0.5, 1)
      .setVisible(true)
      .setTint(PAL.ember)
      .setRotation(rotation)
      .setFlipX(flipped)
      .setDepth(LAYER.fx - 2);
    g.life = g.max = 0.22;
    g.from = g.to = S;
    g.baseAlpha = 0.45;
    g.sy = 1;
  }

  sparksAt(x: number, y: number, n: number): void {
    this.sparks.explode(n, x, y);
  }

  boneAt(x: number, y: number, n: number): void {
    this.bone.explode(n, x, y);
  }

  soulAt(x: number, y: number, n: number): void {
    this.souls.explode(n, x, y);
  }

  debrisAt(x: number, y: number, n: number): void {
    this.debris.explode(n, x, y);
  }

  flamesAt(x: number, y: number, n: number): void {
    this.flames.explode(n, x, y);
  }

  frostAt(x: number, y: number, n: number): void {
    this.frost.explode(n, x, y);
  }

  /** A jagged lightning arc between screen points (each pair = one segment). */
  lightning(segments: [number, number, number, number][]): void {
    for (const [x0, y0, x1, y1] of segments) {
      const pts = [x0, y0];
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        pts.push(x0 + (x1 - x0) * t + (Math.random() - 0.5) * 12, y0 + (y1 - y0) * t + (Math.random() - 0.5) * 10);
      }
      pts.push(x1, y1);
      this.arcs.push({ pts, life: 0.18 });
    }
  }

  dustAt(x: number, y: number, n: number): void {
    this.dust.explode(n, x, y);
  }

  update(dt: number): void {
    this.bolts.clear();
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      a.life -= dt;
      if (a.life <= 0) {
        this.arcs.splice(i, 1);
        continue;
      }
      for (const [w, c, al] of [[6, 0x6fb8ff, 0.35], [2.2, 0xffffff, 1]] as const) {
        this.bolts.lineStyle(w, c, al * (a.life / 0.18));
        this.bolts.beginPath();
        this.bolts.moveTo(a.pts[0]!, a.pts[1]!);
        for (let k = 2; k < a.pts.length; k += 2) this.bolts.lineTo(a.pts[k]!, a.pts[k + 1]!);
        this.bolts.strokePath();
      }
    }
    for (const f of this.floaters) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - f.life / f.max;
      f.text.y += f.vy * dt * (1 - t);
      f.text.setScale(t < 0.15 ? f.pop - (f.pop - 1) * (t / 0.15) : 1);
      f.text.setAlpha(t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
      if (f.life <= 0) f.text.setVisible(false);
    }
    const timed = (list: Timed[]) => {
      for (const o of list) {
        if (o.life <= 0) continue;
        o.life -= dt;
        const t = 1 - Math.max(0, o.life) / o.max;
        const s = o.from + (o.to - o.from) * (1 - (1 - t) * (1 - t));
        o.img.setScale(s, s * o.sy).setAlpha(o.baseAlpha * (1 - t));
        if (o.life <= 0) o.img.setVisible(false);
      }
    };
    timed(this.slashes);
    timed(this.rings);
    timed(this.ghosts);
  }

  shake(intensity: number, ms: number): void {
    this.scene.cameras.main.shake(ms, intensity);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
  }
}
