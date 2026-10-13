import Phaser from 'phaser';
import type { HeroId } from '../config/heroes';
import { SKILLS } from '../config/skills';
import { depthOf, worldDirToScreenAngle, worldToScreenX, worldToScreenY } from '../core/iso';
import type { Enemy, Hero } from '../sim/types';
import { PAL } from './palette';
import { RES } from './textures';
import { LAYER } from './worldView';

const S = 1 / RES;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);


function tintFill(img: Phaser.GameObjects.Image, color: number): void {
  img.setTint(color).setTintMode(Phaser.TintModes.FILL);
}

function tintMul(img: Phaser.GameObjects.Image, color: number): void {
  img.setTint(color).setTintMode(Phaser.TintModes.MULTIPLY);
}

/** Decides facing from a screen angle with a dead zone so straight up/down doesn't flicker. */
function updateFlip(current: boolean, screenAngle: number): boolean {
  const c = Math.cos(screenAngle);
  if (c < -0.2) return true;
  if (c > 0.2) return false;
  return current;
}

// ───────────────────────────── hero ─────────────────────────────

interface HeroRigSpec {
  body: string;
  weapon: string;
  weaponOx: number;
  /** Resting weapon angle in the rig's right-facing frame. */
  rest: number;
  hand: { x: number; y: number };
}

const HERO_RIGS: Record<HeroId, HeroRigSpec> = {
  warden: { body: 'heroBody', weapon: 'sword', weaponOx: 6 / 44, rest: 1.15, hand: { x: 8, y: -21 } },
  wanderer: { body: 'wandererBody', weapon: 'staff', weaponOx: 6 / 46, rest: -0.55, hand: { x: 9, y: -20 } },
};

export class HeroView {
  readonly root: Phaser.GameObjects.Container;
  readonly light: Phaser.GameObjects.Image;
  private readonly rig: Phaser.GameObjects.Container;
  private readonly legL: Phaser.GameObjects.Image;
  private readonly legR: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  private readonly weapon: Phaser.GameObjects.Image;
  private readonly spec: HeroRigSpec;
  readonly bodyKey: string;
  flipped = false;
  private walkPhase = 0;
  private swingClock = -1;
  /** Screen angle of the current shot (ranged thrust aims at it). */
  private swingAngle = 0;
  private castClock = -1;
  private flashT = 0;
  private deadClock = -1;
  sx = 0;
  sy = 0;

  constructor(scene: Phaser.Scene, readonly heroId: HeroId) {
    this.spec = HERO_RIGS[heroId];
    this.bodyKey = this.spec.body;
    const shadow = scene.add.image(0, 0, 'shadow').setScale(S * 0.62);
    this.legL = scene.add.image(-5, -15, 'heroLeg').setScale(S).setOrigin(0.5, 0);
    this.legR = scene.add.image(4, -15, 'heroLeg').setScale(S).setOrigin(0.5, 0);
    this.body = scene.add.image(0, -3, this.spec.body).setScale(S).setOrigin(0.5, 1);
    this.weapon = scene.add.image(this.spec.hand.x, this.spec.hand.y, this.spec.weapon).setScale(S).setOrigin(this.spec.weaponOx, 0.5);
    this.rig = scene.add.container(0, 0, [this.legL, this.legR, this.body, this.weapon]);
    this.root = scene.add.container(0, 0, [shadow, this.rig]);
    this.light = scene.add
      .image(0, 0, 'light')
      .setScale(4.4 / RES, 2.4 / RES)
      .setTint(PAL.emberHot)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.3)
      .setDepth(LAYER.groundLight);
  }

  onSwing(screenAngle: number): void {
    this.swingClock = 0;
    this.swingAngle = screenAngle;
  }

  onCast(): void {
    this.castClock = 0;
  }

  onHurt(): void {
    this.flashT = 0.12;
  }

  update(h: Hero, rx: number, ry: number, dt: number, time: number): void {
    this.sx = worldToScreenX(rx, ry);
    this.sy = worldToScreenY(rx, ry);
    this.root.setPosition(this.sx, this.sy).setDepth(depthOf(rx, ry));
    this.light.setPosition(this.sx, this.sy - 4);
    this.light.setAlpha(0.3 + Math.sin(time * 3.1) * 0.02);

    const fa = worldDirToScreenAngle(Math.cos(h.facing), Math.sin(h.facing));
    this.flipped = updateFlip(this.flipped, fa);
    this.rig.setScale(this.flipped ? -1 : 1, 1);

    const sp = this.spec;
    const ranged = this.heroId === 'wanderer';
    const speed = Math.hypot(h.vx, h.vy);
    let bodyY = -3;
    let bodyRot = 0;
    let bodySY = 1;
    let legLift = 0;
    let weaponA = sp.rest + Math.sin(time * 2.2) * 0.04;
    let weaponX = sp.hand.x;
    let weaponVisible = true;
    let legsVisible = true;

    if (h.state === 'dead') {
      if (this.deadClock < 0) this.deadClock = 0;
      this.deadClock += dt;
      const t = Math.min(1, this.deadClock / 0.45);
      bodyRot = easeOut(t) * 1.35;
      bodyY = lerp(-3, 4, t);
      weaponA = lerp(weaponA, 2.6, t);
      legsVisible = t < 0.5;
    } else {
      this.deadClock = -1;
      if (h.state === 'move' && speed > 0.1) {
        this.walkPhase += speed * dt * 3.4;
        legLift = Math.sin(this.walkPhase);
        bodyY -= Math.abs(Math.cos(this.walkPhase)) * 1.6;
      } else {
        bodyY += Math.sin(time * 2.4) * 0.5; // breathing
      }
      if (h.state === 'dodge') {
        const u = Math.min(1, h.dodgeT / h.cls.dodge.duration);
        bodyRot = u * Math.PI * 2;
        bodyY = -3 - Math.sin(u * Math.PI) * 7;
        bodySY = 0.82;
        legsVisible = false;
        weaponVisible = false;
      }
      if (h.state === 'dash') {
        // shoulder-first charge, blade levelled ahead
        bodyRot = 0.28;
        bodyY = -2;
        weaponA = 0.15;
        legLift = Math.sin(time * 40);
      }
      if (this.swingClock >= 0) {
        const w = h.cls.attack.windup;
        const t = this.swingClock;
        if (ranged) {
          // short thrust of the staff toward the target
          const aim = this.flipped ? Math.PI - this.swingAngle : this.swingAngle;
          const local = Math.atan2(Math.sin(aim), Math.cos(aim));
          const k = t < w ? easeOut(t / w) : t < w + 0.18 ? 1 - (t - w) / 0.18 : 0;
          weaponA = lerp(sp.rest, Math.max(-1.2, Math.min(1.2, local)), k);
          weaponX = sp.hand.x + 4 * k;
          if (t >= w + 0.18) this.swingClock = -1;
        } else {
          if (t < w) weaponA = lerp(sp.rest, -2.0, easeOut(t / w));
          else if (t < w + 0.08) weaponA = lerp(-2.0, 1.55, easeOut((t - w) / 0.08));
          else if (t < w + 0.32) weaponA = lerp(1.55, sp.rest, (t - w - 0.08) / 0.24);
          else this.swingClock = -1;
        }
        if (this.swingClock >= 0) this.swingClock += dt;
      }
      if (this.castClock >= 0) {
        const c = h.activeSkill?.id === 'sunder' ? SKILLS.sunder.castTime : h.activeSkill?.id === 'crush' ? SKILLS.crush.castTime : 0.12;
        const t = this.castClock;
        if (t < c) {
          weaponA = lerp(sp.rest, -1.75, easeOut(t / c));
          bodyY -= easeOut(t / c) * 5;
        } else if (t < c + 0.1) {
          weaponA = lerp(-1.75, ranged ? 0 : 1.7, (t - c) / 0.1);
          bodySY = 0.9;
        } else if (t < c + 0.4) {
          weaponA = lerp(ranged ? 0 : 1.7, sp.rest, (t - c - 0.1) / 0.3);
        } else this.castClock = -1;
        if (this.castClock >= 0) this.castClock += dt;
      }
    }

    this.legL.setVisible(legsVisible).setY(-15 - Math.max(0, legLift) * 2.5);
    this.legR.setVisible(legsVisible).setY(-15 - Math.max(0, -legLift) * 2.5);
    this.body.setPosition(0, bodyY).setRotation(bodyRot).setScale(S, S * bodySY);
    this.weapon.setVisible(weaponVisible).setPosition(weaponX, bodyY + sp.hand.y + 3).setRotation(weaponA);

    // feedback tints: hurt flash > i-frame shimmer > empowered glow > none
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT > 0) {
      tintFill(this.body, 0xff6b5e);
    } else if (h.iframeT > 0) {
      tintFill(this.body, PAL.emberHot);
      this.body.setAlpha(0.75);
    } else {
      if (h.empowerT > 0) tintMul(this.body, 0xffd9a0);
      else this.body.clearTint();
      this.body.setAlpha(h.hurtT > 0 && Math.floor(time * 20) % 2 === 0 ? 0.55 : 1);
    }
  }

  destroy(): void {
    this.root.destroy();
    this.light.destroy();
  }
}

// ───────────────────────────── enemies ─────────────────────────────

interface EnemyRigSpec {
  body: string;
  /** Robed enemies have no visible legs. */
  leg: string | null;
  bodyY: number;
  legY: number;
  legX: [number, number];
  shadow: number;
  headY: number;
  weapon?: { key: string; ox: number; x: number; y: number };
}

const RIGS: Record<Enemy['kind'], EnemyRigSpec> = {
  thrall: { body: 'thrallBody', leg: 'thrallLeg', bodyY: -6, legY: -13, legX: [-5, 4], shadow: 0.6, headY: -48 },
  brute: {
    body: 'bruteBody',
    leg: 'bruteLeg',
    bodyY: -9,
    legY: -17,
    legX: [-9, 6],
    shadow: 1.05,
    headY: -76,
    weapon: { key: 'maul', ox: 4 / 46, x: 18, y: -40 },
  },
  acolyte: { body: 'acolyteBody', leg: null, bodyY: -2, legY: 0, legX: [0, 0], shadow: 0.55, headY: -54 },
  hound: { body: 'houndBody', leg: null, bodyY: 0, legY: 0, legX: [0, 0], shadow: 0.75, headY: -38 },
  pyre: { body: 'pyreBody', leg: null, bodyY: -2, legY: 0, legX: [0, 0], shadow: 0.55, headY: -54 },
  bossCrypt: { body: 'bossCryptBody', leg: 'bruteLeg', bodyY: -9, legY: -17, legX: [-9, 6], shadow: 1.05, headY: -80, weapon: { key: 'maul', ox: 4 / 46, x: 18, y: -40 } },
  bossFrost: { body: 'bossFrostBody', leg: null, bodyY: -2, legY: 0, legX: [0, 0], shadow: 0.6, headY: -62 },
  bossKing: { body: 'bossKingBody', leg: 'heroLeg', bodyY: -6, legY: -16, legX: [-6, 5], shadow: 0.7, headY: -68, weapon: { key: 'kingBlade', ox: 6 / 60, x: 11, y: -28 } },
};

export class EnemyView {
  readonly root: Phaser.GameObjects.Container;
  private readonly rig: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly legL: Phaser.GameObjects.Image;
  private readonly legR: Phaser.GameObjects.Image;
  private readonly weapon: Phaser.GameObjects.Image | null;
  private readonly spec: EnemyRigSpec;
  private flipped = false;
  private walkPhase = 0;
  private flashT = 0;
  private lastX = 0;
  private lastY = 0;
  sx = 0;
  sy = 0;
  headY: number;

  private readonly scale: number;

  constructor(scene: Phaser.Scene, e: Enemy, private readonly biomeTint = 0xffffff) {
    this.spec = RIGS[e.kind];
    const sp = this.spec;
    this.scale = e.def.scale ?? 1;
    const shadow = scene.add.image(0, 0, 'shadow').setScale(S * sp.shadow * this.scale);
    this.legL = scene.add.image(sp.legX[0], sp.legY, sp.leg ?? 'thrallLeg').setScale(S).setOrigin(0.5, 0).setVisible(!!sp.leg);
    this.legR = scene.add.image(sp.legX[1], sp.legY, sp.leg ?? 'thrallLeg').setScale(S).setOrigin(0.5, 0).setVisible(!!sp.leg);
    this.body = scene.add.image(0, sp.bodyY, sp.body).setScale(S).setOrigin(0.5, 1);
    const parts: Phaser.GameObjects.GameObject[] = [this.legL, this.legR, this.body];
    this.weapon = sp.weapon
      ? scene.add.image(sp.weapon.x, sp.weapon.y, sp.weapon.key).setScale(S).setOrigin(sp.weapon.ox, 0.5)
      : null;
    if (this.weapon) parts.push(this.weapon);
    this.rig = scene.add.container(0, 0, parts);
    this.root = scene.add.container(0, 0, [shadow, this.rig]);
    this.headY = sp.headY * this.scale;
    this.lastX = e.x;
    this.lastY = e.y;
  }

  onHit(): void {
    this.flashT = 0.08;
  }

  update(e: Enemy, rx: number, ry: number, dt: number, time: number): void {
    this.sx = worldToScreenX(rx, ry);
    this.sy = worldToScreenY(rx, ry);
    this.root.setPosition(this.sx, this.sy).setDepth(depthOf(rx, ry));
    const moved = Math.hypot(rx - this.lastX, ry - this.lastY);
    this.lastX = rx;
    this.lastY = ry;

    const fa = worldDirToScreenAngle(Math.cos(e.facing), Math.sin(e.facing));
    this.flipped = updateFlip(this.flipped, fa);
    this.rig.setScale((this.flipped ? -1 : 1) * this.scale, this.scale);

    const sp = this.spec;
    let bodyY = sp.bodyY;
    let bodyX = 0;
    let rot = 0;
    let sy = 1;
    let alpha = 1;
    let weaponA = 0.9;
    let legLift = 0;
    let tint: number | null = null;
    let fill = false;
    const p = e.stateDur > 0 ? 1 - Math.max(0, e.stateT) / e.stateDur : 1;

    switch (e.state) {
      case 'spawning':
        alpha = easeOut(p);
        bodyY += (1 - p) * 18;
        tint = PAL.hollow;
        fill = p < 0.6;
        break;
      case 'chase':
        if (moved > 0.0005) {
          this.walkPhase += moved * 9;
          legLift = Math.sin(this.walkPhase);
          bodyY -= Math.abs(Math.cos(this.walkPhase)) * 1.4;
        }
        break;
      case 'windup':
        // lean back, tremble and heat up: the "it's coming" read
        rot = -0.22 * easeOut(p);
        bodyX = Math.sin(time * 70) * 1.3 * p;
        tint = Phaser.Display.Color.GetColor(255, Math.round(255 - 140 * p), Math.round(255 - 150 * p));
        weaponA = lerp(0.9, -2.3, easeOut(p));
        break;
      case 'recover': {
        // lunge then slump: the counter-attack window
        const t = (e.stateDur - e.stateT) / 0.12;
        bodyX = t < 1 ? Math.sin(t * Math.PI) * 7 : 0;
        rot = t < 1 ? 0.25 : 0.12;
        sy = t < 1 ? 1 : 0.94;
        weaponA = 1.45;
        tint = 0xb8b8b8;
        break;
      }
      case 'stunned':
        rot = Math.sin(time * 11) * 0.14;
        tint = 0xa9b4c8;
        weaponA = 1.6;
        break;
      case 'dead': {
        const t = Math.min(1, e.deadT / 0.5);
        rot = easeOut(t) * 1.45;
        bodyY += t * 6;
        alpha = 1 - Math.min(1, Math.max(0, e.deadT - 0.6) / 0.9);
        tint = 0x5a5a64;
        weaponA = 2.4;
        break;
      }
    }

    if (e.frozenT > 0) {
      tint = 0x9fd8ff;
      rot = 0;
      bodyX = 0;
    } else if (e.burnT > 0 && tint === null) {
      tint = Math.floor(time * 10 + e.id) % 2 ? 0xffb07a : 0xff8a5a;
    } else if (e.bleedStacks > 0 && tint === null) {
      // deeper red with more stacks, a slow throb
      tint = Math.floor(time * 5 + e.id) % 2 ? 0xe8788c : e.bleedStacks > 1 ? 0xb83a56 : 0xc4566c;
    } else if (e.chillT > 0 && tint === null) {
      tint = 0xbfe4ff;
    }
    if (e.invulnerable) tint = Math.floor(time * 14) % 2 ? 0xffffff : 0xffe2a0;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashT > 0) {
      tintFill(this.body, 0xffffff);
    } else if (tint !== null) {
      if (fill) tintFill(this.body, tint);
      else tintMul(this.body, tint);
    } else if (this.biomeTint !== 0xffffff) {
      tintMul(this.body, this.biomeTint);
    } else {
      this.body.clearTint();
    }

    const legs = !!sp.leg && (e.state !== 'dead' || e.deadT < 0.25);
    this.legL.setY(sp.legY - Math.max(0, legLift) * 2.4).setVisible(legs);
    this.legR.setY(sp.legY - Math.max(0, -legLift) * 2.4).setVisible(legs);
    this.body.setPosition(bodyX, bodyY).setRotation(rot).setScale(S, S * sy);
    if (this.weapon && sp.weapon) {
      this.weapon.setPosition(sp.weapon.x + bodyX, sp.weapon.y + (bodyY - sp.bodyY)).setRotation(weaponA);
      if (this.flashT > 0) tintFill(this.weapon, 0xffffff);
      else this.weapon.clearTint();
    }
    this.root.setAlpha(alpha);
  }

  destroy(): void {
    this.root.destroy();
  }
}
