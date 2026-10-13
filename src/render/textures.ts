import type Phaser from 'phaser';
import { Rng } from '../core/rng';
import { PAL, css } from './palette';

/**
 * Procedural placeholder art, drawn once at boot with the Canvas 2D API.
 * Every texture is authored in world pixels and rasterised at RES× so it stays
 * crisp under camera zoom on high-DPI phones. Display objects using these
 * textures are scaled by 1/RES.
 *
 * PLACEHOLDER STATUS: coherent and readable, but not final art. See docs/ROADMAP.md.
 */
export const RES = 2;
export const WALL_H = 46;
export const PILLAR_H = 92;
export const LOW_WALL_H = 12;

type Ctx = CanvasRenderingContext2D;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.ceil(w * RES), Math.ceil(h * RES));
  if (!tex) throw new Error(`Could not create texture ${key}`);
  const ctx = tex.context;
  ctx.save();
  ctx.scale(RES, RES);
  draw(ctx);
  ctx.restore();
  tex.refresh();
}

function poly(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
}

function diamond(ctx: Ctx, cx: number, cy: number, hw: number, hh: number): void {
  poly(ctx, [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
}

function radial(ctx: Ctx, cx: number, cy: number, r: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

// ───────────────────────────── environment ─────────────────────────────

function floorTile(ctx: Ctx, rng: Rng, base: number): void {
  diamond(ctx, 32, 16, 31, 15.5);
  ctx.fillStyle = css(base);
  ctx.fill();
  ctx.save();
  diamond(ctx, 32, 16, 31, 15.5);
  ctx.clip();
  // mottled stone
  for (let i = 0; i < 26; i++) {
    const x = rng.range(4, 60);
    const y = rng.range(3, 29);
    ctx.fillStyle = css(rng.chance(0.5) ? shade(base, 1.25) : shade(base, 0.75), rng.range(0.25, 0.6));
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(1, 5), rng.range(0.5, 2.2), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // cracks
  const cracks = rng.int(0, 2);
  ctx.strokeStyle = css(PAL.void, 0.7);
  ctx.lineWidth = 0.8;
  for (let c = 0; c < cracks; c++) {
    let x = rng.range(10, 54);
    let y = rng.range(6, 26);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rng.range(-7, 7);
      y += rng.range(-3, 3);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // bevel: lit top edges, shadowed bottom edges
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(shade(base, 1.6), 0.55);
  ctx.beginPath();
  ctx.moveTo(1.5, 16);
  ctx.lineTo(32, 1);
  ctx.lineTo(62.5, 16);
  ctx.stroke();
  ctx.strokeStyle = css(PAL.void, 0.6);
  ctx.beginPath();
  ctx.moveTo(62.5, 16);
  ctx.lineTo(32, 31);
  ctx.lineTo(1.5, 16);
  ctx.stroke();
}

function block(ctx: Ctx, rng: Rng, h: number, top: number, left: number, right: number, courses: number): void {
  const T = [32, 0];
  const R = [64, 16];
  const B = [32, 32];
  const L = [0, 16];
  // left face
  poly(ctx, [L[0]!, L[1]!, B[0]!, B[1]!, B[0]!, B[1]! + h, L[0]!, L[1]! + h]);
  const lg = ctx.createLinearGradient(0, 0, 0, 32 + h);
  lg.addColorStop(0, css(shade(left, 1.15)));
  lg.addColorStop(1, css(shade(left, 0.55)));
  ctx.fillStyle = lg;
  ctx.fill();
  // right face
  poly(ctx, [B[0]!, B[1]!, R[0]!, R[1]!, R[0]!, R[1]! + h, B[0]!, B[1]! + h]);
  const rg = ctx.createLinearGradient(0, 0, 0, 32 + h);
  rg.addColorStop(0, css(shade(right, 1.15)));
  rg.addColorStop(1, css(shade(right, 0.6)));
  ctx.fillStyle = rg;
  ctx.fill();
  // brick courses on both faces
  ctx.strokeStyle = css(PAL.void, 0.45);
  ctx.lineWidth = 0.8;
  for (let i = 1; i < courses; i++) {
    const y = (h / courses) * i;
    ctx.beginPath();
    ctx.moveTo(0, 16 + y);
    ctx.lineTo(32, 32 + y);
    ctx.lineTo(64, 16 + y);
    ctx.stroke();
    // vertical joints, staggered
    const off = i % 2 === 0 ? 8 : 0;
    for (let j = 0; j < 2; j++) {
      const lx = 8 + off + j * 14;
      if (lx < 32) {
        ctx.beginPath();
        ctx.moveTo(lx, 16 + lx / 2 + y);
        ctx.lineTo(lx, 16 + lx / 2 + y - h / courses);
        ctx.stroke();
      }
      const rx = 40 + off + j * 12;
      if (rx < 64) {
        ctx.beginPath();
        ctx.moveTo(rx, 32 - (rx - 32) / 2 + y);
        ctx.lineTo(rx, 32 - (rx - 32) / 2 + y - h / courses);
        ctx.stroke();
      }
    }
  }
  // grime specks
  for (let i = 0; i < 18; i++) {
    const onLeft = rng.chance(0.5);
    const x = onLeft ? rng.range(2, 30) : rng.range(34, 62);
    const yTop = onLeft ? 16 + x / 2 : 32 - (x - 32) / 2;
    const y = yTop + rng.range(2, h - 2);
    ctx.fillStyle = css(rng.chance(0.3) ? PAL.ash : PAL.void, rng.range(0.1, 0.35));
    ctx.fillRect(x, y, rng.range(1, 3), rng.range(1, 2));
  }
  // vertical edge highlight
  ctx.strokeStyle = css(shade(right, 1.7), 0.35);
  ctx.beginPath();
  ctx.moveTo(32, 32);
  ctx.lineTo(32, 32 + h);
  ctx.stroke();
  // top face
  poly(ctx, [T[0]!, T[1]!, R[0]!, R[1]!, B[0]!, B[1]!, L[0]!, L[1]!]);
  ctx.fillStyle = css(top);
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = css(shade(top, rng.range(0.8, 1.25)), 0.5);
    ctx.beginPath();
    ctx.ellipse(rng.range(8, 56), rng.range(4, 28), rng.range(2, 6), rng.range(1, 2.5), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = css(shade(top, 1.6), 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0.5, 16);
  ctx.lineTo(32, 0.5);
  ctx.lineTo(63.5, 16);
  ctx.stroke();
  ctx.strokeStyle = css(PAL.void, 0.5);
  ctx.beginPath();
  ctx.moveTo(63.5, 16);
  ctx.lineTo(32, 31.5);
  ctx.lineTo(0.5, 16);
  ctx.stroke();
}

function sigil(ctx: Ctx): void {
  // A ritual circle laid into the floor, projected 2:1. 6 tiles across.
  const cx = 192;
  const cy = 96;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.5);
  const ring = (r: number, w: number, a: number) => {
    ctx.strokeStyle = css(PAL.ember, a);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(186, 3, 0.22);
  ring(172, 1.2, 0.18);
  ring(112, 2, 0.16);
  // radial spokes and rune notches between the outer rings
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const long = i % 3 === 0;
    ctx.strokeStyle = css(PAL.ember, long ? 0.24 : 0.14);
    ctx.lineWidth = long ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 174, Math.sin(a) * 174);
    ctx.lineTo(Math.cos(a) * (long ? 150 : 162), Math.sin(a) * (long ? 150 : 162));
    ctx.stroke();
  }
  // crown: five points around the inner ring
  ctx.strokeStyle = css(PAL.ember, 0.2);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 100 : 62;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ring(34, 1.5, 0.2);
  ctx.restore();
}

// ───────────────────────────── characters ─────────────────────────────

function heroBody(ctx: Ctx): void {
  // 40 x 48, feet line at y=48, facing right.
  // cloak (behind)
  poly(ctx, [10, 15, 30, 15, 35, 44, 31, 41, 27, 46, 22, 42, 17, 46, 12, 41, 6, 45]);
  const cg = ctx.createLinearGradient(0, 14, 0, 46);
  cg.addColorStop(0, css(0x3b3b44));
  cg.addColorStop(1, css(0x1c1c22));
  ctx.fillStyle = cg;
  ctx.fill();
  // torso plate
  ctx.beginPath();
  ctx.roundRect(12, 16, 17, 22, 4);
  const tg = ctx.createLinearGradient(12, 0, 29, 0);
  tg.addColorStop(0, css(0x7a808d));
  tg.addColorStop(0.45, css(0x50555f));
  tg.addColorStop(1, css(0x30333b));
  ctx.fillStyle = tg;
  ctx.fill();
  // tabard with crown sigil
  poly(ctx, [17, 22, 25, 22, 25, 43, 21, 40, 17, 43]);
  ctx.fillStyle = css(0x5c2420);
  ctx.fill();
  ctx.strokeStyle = css(PAL.gold, 0.85);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18.5, 29);
  ctx.lineTo(19.5, 26);
  ctx.lineTo(21, 28);
  ctx.lineTo(22.5, 26);
  ctx.lineTo(23.5, 29);
  ctx.closePath();
  ctx.stroke();
  // belt
  ctx.fillStyle = css(0x2a1d16);
  ctx.fillRect(12, 34, 17, 3);
  ctx.fillStyle = css(PAL.ember);
  ctx.fillRect(20, 34, 3, 3);
  // pauldrons
  for (const [x, w] of [[12, 8], [28, 7]] as const) {
    ctx.beginPath();
    ctx.ellipse(x, 18, w, 5, 0, 0, Math.PI * 2);
    const pg = ctx.createLinearGradient(x - w, 13, x + w, 23);
    pg.addColorStop(0, css(0x8b919e));
    pg.addColorStop(1, css(0x3a3d46));
    ctx.fillStyle = pg;
    ctx.fill();
  }
  // helm
  ctx.beginPath();
  ctx.roundRect(14, 2, 14, 15, [6, 6, 3, 3]);
  const hg = ctx.createLinearGradient(14, 0, 28, 0);
  hg.addColorStop(0, css(0x80868f));
  hg.addColorStop(1, css(0x3c3f48));
  ctx.fillStyle = hg;
  ctx.fill();
  // crest ridge
  ctx.strokeStyle = css(0x9aa0aa);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(15, 4);
  ctx.quadraticCurveTo(21, -1, 27, 4);
  ctx.stroke();
  // visor slit: the ember that marks the Warden
  ctx.save();
  ctx.shadowColor = css(PAL.ember, 0.9);
  ctx.shadowBlur = 4;
  ctx.strokeStyle = css(PAL.emberHot);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(19, 9.5);
  ctx.lineTo(28, 9);
  ctx.stroke();
  ctx.restore();
}

function heroLeg(ctx: Ctx): void {
  ctx.beginPath();
  ctx.roundRect(0, 0, 6, 14, 2);
  ctx.fillStyle = css(0x30333b);
  ctx.fill();
  ctx.fillStyle = css(0x5a5f6a);
  ctx.fillRect(0.5, 1, 2, 9);
  ctx.fillStyle = css(0x1b1c21);
  ctx.fillRect(-1, 11, 8, 3);
}

function sword(ctx: Ctx): void {
  // 44 x 10; hilt at x=6 (texture origin), blade points right.
  ctx.fillStyle = css(0x2a1d16);
  ctx.fillRect(0, 4, 7, 2.4);
  ctx.fillStyle = css(PAL.gold);
  ctx.beginPath();
  ctx.arc(1, 5.2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(0x8a7444);
  ctx.fillRect(6.5, 0.8, 2.6, 8.8);
  poly(ctx, [9, 3.2, 40, 3.6, 44, 5.2, 40, 6.8, 9, 7.2]);
  const bg = ctx.createLinearGradient(0, 3, 0, 7.2);
  bg.addColorStop(0, css(0xeef0f4));
  bg.addColorStop(0.5, css(0xb7bcc6));
  bg.addColorStop(1, css(0x6c717c));
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = css(0x4a4f59, 0.8);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(10, 5.2);
  ctx.lineTo(38, 5.2);
  ctx.stroke();
}

function thrallBody(ctx: Ctx): void {
  // 36 x 40, hunched, facing right. Feet line y=40.
  const skin = 0xa9a397;
  // rag skirt
  poly(ctx, [9, 24, 25, 24, 27, 37, 23, 34, 20, 38, 16, 34, 12, 38, 8, 35]);
  ctx.fillStyle = css(0x23242a);
  ctx.fill();
  // back + torso (hunched curve)
  ctx.beginPath();
  ctx.moveTo(9, 26);
  ctx.quadraticCurveTo(6, 12, 17, 8);
  ctx.quadraticCurveTo(26, 6, 28, 14);
  ctx.lineTo(25, 26);
  ctx.closePath();
  const sg = ctx.createLinearGradient(6, 6, 28, 26);
  sg.addColorStop(0, css(shade(skin, 1.05)));
  sg.addColorStop(1, css(shade(skin, 0.55)));
  ctx.fillStyle = sg;
  ctx.fill();
  // ribs
  ctx.strokeStyle = css(0x4d4a43, 0.7);
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(15, 13 + i * 3);
    ctx.quadraticCurveTo(20, 11 + i * 3, 24, 14 + i * 3);
    ctx.stroke();
  }
  // spine nubs
  ctx.fillStyle = css(shade(skin, 1.2));
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(9.5 + i * 1.2, 22 - i * 4, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // reaching arm with claws
  ctx.strokeStyle = css(shade(skin, 0.8));
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(24, 14);
  ctx.quadraticCurveTo(31, 18, 33, 24);
  ctx.stroke();
  ctx.strokeStyle = css(0xd9d3c4);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(33, 24);
    ctx.lineTo(35.5, 26 + i * 1.6);
    ctx.stroke();
  }
  // head, thrust forward
  ctx.beginPath();
  ctx.ellipse(27, 9, 5.5, 5, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = css(shade(skin, 0.9));
  ctx.fill();
  ctx.fillStyle = css(0x111114);
  ctx.beginPath();
  ctx.ellipse(29, 12, 2.6, 1.6, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // hollow eyes
  ctx.save();
  ctx.shadowColor = css(PAL.hollow, 1);
  ctx.shadowBlur = 4;
  ctx.fillStyle = css(PAL.hollow);
  ctx.beginPath();
  ctx.arc(29.5, 8, 1.3, 0, Math.PI * 2);
  ctx.arc(26.6, 7.6, 1.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function thrallLeg(ctx: Ctx): void {
  ctx.strokeStyle = css(0x7d786d);
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(2, 1);
  ctx.lineTo(2.5, 11);
  ctx.stroke();
  ctx.fillStyle = css(0x4d4a43);
  ctx.fillRect(1, 10.5, 5, 2);
}

function bruteBody(ctx: Ctx): void {
  // 60 x 62, feet line y=62.
  const iron = 0x3a3d45;
  // loincloth
  poly(ctx, [18, 44, 42, 44, 44, 58, 36, 55, 30, 60, 24, 55, 16, 58]);
  ctx.fillStyle = css(0x2a1f1c);
  ctx.fill();
  // massive torso
  ctx.beginPath();
  ctx.moveTo(14, 46);
  ctx.quadraticCurveTo(6, 26, 16, 16);
  ctx.lineTo(44, 14);
  ctx.quadraticCurveTo(54, 26, 46, 46);
  ctx.closePath();
  const tg = ctx.createLinearGradient(6, 14, 54, 46);
  tg.addColorStop(0, css(0x8e877a));
  tg.addColorStop(1, css(0x4a463f));
  ctx.fillStyle = tg;
  ctx.fill();
  // iron chest plate with rivets and rust
  ctx.beginPath();
  ctx.roundRect(18, 20, 24, 20, 4);
  const pg = ctx.createLinearGradient(18, 20, 42, 40);
  pg.addColorStop(0, css(shade(iron, 1.6)));
  pg.addColorStop(1, css(shade(iron, 0.7)));
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.fillStyle = css(0x7a3b22, 0.55);
  ctx.fillRect(20, 36, 9, 3);
  ctx.fillRect(35, 22, 5, 2);
  ctx.fillStyle = css(0xb6b0a4);
  for (const [x, y] of [[21, 23], [39, 23], [21, 37], [39, 37]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  // hollow wound glowing through the plate
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 6;
  ctx.strokeStyle = css(PAL.hollow, 0.9);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(28, 25);
  ctx.lineTo(31, 30);
  ctx.lineTo(29, 34);
  ctx.stroke();
  ctx.restore();
  // shoulders
  for (const x of [13, 47]) {
    ctx.beginPath();
    ctx.ellipse(x, 19, 10, 8, 0, 0, Math.PI * 2);
    const sg = ctx.createLinearGradient(x - 10, 11, x + 10, 27);
    sg.addColorStop(0, css(shade(iron, 1.8)));
    sg.addColorStop(1, css(shade(iron, 0.6)));
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = css(PAL.void, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // small helmeted head sunk between shoulders
  ctx.beginPath();
  ctx.roundRect(24, 3, 14, 14, [5, 5, 2, 2]);
  ctx.fillStyle = css(shade(iron, 1.3));
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 5;
  ctx.fillStyle = css(PAL.hollow);
  ctx.fillRect(31, 8, 6, 1.8);
  ctx.restore();
}

function bruteLeg(ctx: Ctx): void {
  ctx.beginPath();
  ctx.roundRect(0, 0, 10, 16, 3);
  ctx.fillStyle = css(0x4a463f);
  ctx.fill();
  ctx.fillStyle = css(0x2c2e34);
  ctx.fillRect(-1, 11, 12, 5);
}

function maul(ctx: Ctx): void {
  // 46 x 22; grip at x=4 (texture origin), head at the far end.
  ctx.fillStyle = css(0x3b2a20);
  ctx.fillRect(0, 9, 34, 4);
  ctx.fillStyle = css(0x22181a);
  ctx.fillRect(2, 8.5, 6, 5);
  ctx.beginPath();
  ctx.roundRect(30, 1, 16, 20, 3);
  const g = ctx.createLinearGradient(30, 1, 46, 21);
  g.addColorStop(0, css(0x777065));
  g.addColorStop(1, css(0x34312c));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = css(PAL.void, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(33, 6);
  ctx.lineTo(41, 9);
  ctx.lineTo(36, 15);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 4;
  ctx.fillStyle = css(PAL.hollow, 0.85);
  ctx.fillRect(37, 4, 2, 2);
  ctx.fillRect(40, 14, 2, 2);
  ctx.restore();
}

// ───────────────────────────── FX ─────────────────────────────

function slash(ctx: Ctx): void {
  // 96 x 96 crescent around the centre (48,48), opening to the right.
  ctx.save();
  ctx.translate(48, 48);
  const g = ctx.createRadialGradient(0, 0, 18, 0, 0, 46);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, css(PAL.emberHot, 0.35));
  g.addColorStop(0.85, 'rgba(255,248,232,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 46, -1.15, 1.15);
  ctx.arc(8, 0, 34, 1.0, -1.0, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function generateTextures(scene: Phaser.Scene): void {
  const rng = new Rng(1337);

  const floorBases = [PAL.stone1, PAL.stone2, 0x1c1e25, 0x20232b, 0x191b22, 0x23262e];
  floorBases.forEach((b, i) => make(scene, `floor${i}`, 64, 32, (c) => floorTile(c, rng, b)));
  for (let i = 0; i < 3; i++)
    make(scene, `wall${i}`, 64, 32 + WALL_H, (c) => block(c, rng, WALL_H, PAL.stone4, 0x23262e, 0x2f333d, 4));
  make(scene, 'wallLow', 64, 32 + LOW_WALL_H, (c) => block(c, rng, LOW_WALL_H, PAL.stone4, 0x23262e, 0x2f333d, 1));
  make(scene, 'pillar', 64, 32 + PILLAR_H, (c) => {
    block(c, rng, PILLAR_H, 0x474c58, 0x2a2d36, 0x383c47, 7);
    // carved band near the top
    c.strokeStyle = css(PAL.ember, 0.18);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, 16 + 14);
    c.lineTo(32, 32 + 14);
    c.lineTo(64, 16 + 14);
    c.stroke();
  });
  make(scene, 'sigil', 384, 192, sigil);
  make(scene, 'brazier', 32, 40, (c) => {
    c.fillStyle = css(0x24262c);
    poly(c, [12, 40, 20, 40, 18, 18, 14, 18]);
    c.fill();
    c.beginPath();
    c.ellipse(16, 15, 13, 6, 0, 0, Math.PI * 2);
    c.fillStyle = css(0x3a3d45);
    c.fill();
    c.beginPath();
    c.ellipse(16, 13, 11, 4.5, 0, 0, Math.PI * 2);
    c.fillStyle = radial(c, 16, 13, 11, [[0, css(PAL.emberHot)], [0.5, css(PAL.ember)], [1, css(PAL.emberDeep)]]);
    c.fill();
  });
  make(scene, 'rubble', 40, 22, (c) => {
    for (let i = 0; i < 7; i++) {
      const x = rng.range(6, 34);
      const y = rng.range(6, 16);
      const s = rng.range(2, 5);
      c.fillStyle = css(rng.chance(0.5) ? PAL.stone4 : PAL.stone3);
      poly(c, [x - s, y, x, y - s * 0.6, x + s, y, x, y + s * 0.6]);
      c.fill();
    }
  });

  make(scene, 'heroBody', 40, 48, heroBody);
  make(scene, 'heroLeg', 6, 14, heroLeg);
  make(scene, 'sword', 44, 10, sword);
  make(scene, 'thrallBody', 36, 40, thrallBody);
  make(scene, 'thrallLeg', 6, 13, thrallLeg);
  make(scene, 'bruteBody', 60, 62, bruteBody);
  make(scene, 'bruteLeg', 10, 16, bruteLeg);
  make(scene, 'maul', 46, 22, maul);

  make(scene, 'shadow', 64, 32, (c) => {
    c.save();
    c.translate(32, 16);
    c.scale(1, 0.5);
    c.fillStyle = radial(c, 0, 0, 30, [[0, 'rgba(0,0,0,0.75)'], [0.6, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
    c.beginPath();
    c.arc(0, 0, 30, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });
  make(scene, 'light', 128, 128, (c) => {
    c.fillStyle = radial(c, 64, 64, 64, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.45)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    c.fillRect(0, 0, 128, 128);
  });
  make(scene, 'mote', 16, 16, (c) => {
    c.fillStyle = radial(c, 8, 8, 8, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    c.fillRect(0, 0, 16, 16);
  });
  make(scene, 'spark', 10, 4, (c) => {
    poly(c, [0, 2, 5, 0, 10, 2, 5, 4]);
    c.fillStyle = '#fff';
    c.fill();
  });
  make(scene, 'chip', 4, 4, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 4, 4);
  });
  make(scene, 'slash', 96, 96, slash);
  make(scene, 'ring', 128, 64, (c) => {
    c.save();
    c.translate(64, 32);
    c.scale(1, 0.5);
    c.strokeStyle = '#fff';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 0, 60, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  });
  make(scene, 'chevron', 14, 10, (c) => {
    poly(c, [0, 0, 7, 7, 14, 0, 7, 3]);
    c.fillStyle = css(PAL.ember);
    c.fill();
    c.strokeStyle = css(PAL.void, 0.8);
    c.lineWidth = 1;
    c.stroke();
  });
}
