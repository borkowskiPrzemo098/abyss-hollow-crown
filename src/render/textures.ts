import type Phaser from 'phaser';
import { Rng } from '../core/rng';
import { BIOMES } from '../config/biomes';
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

function sigil(ctx: Ctx, color: number): void {
  // A ritual circle laid into the floor, projected 2:1. 6 tiles across.
  const cx = 192;
  const cy = 96;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.5);
  const ring = (r: number, w: number, a: number) => {
    ctx.strokeStyle = css(color, a);
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
    ctx.strokeStyle = css(color, long ? 0.24 : 0.14);
    ctx.lineWidth = long ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 174, Math.sin(a) * 174);
    ctx.lineTo(Math.cos(a) * (long ? 150 : 162), Math.sin(a) * (long ? 150 : 162));
    ctx.stroke();
  }
  // crown: five points around the inner ring
  ctx.strokeStyle = css(color, 0.2);
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

function wandererBody(ctx: Ctx): void {
  // 38 x 48, hooded skirmisher in a long travel coat. Feet line y=48.
  // coat tails
  poly(ctx, [11, 20, 28, 20, 33, 45, 28, 42, 24, 47, 19, 43, 14, 47, 9, 43, 6, 46]);
  const cg = ctx.createLinearGradient(0, 18, 0, 47);
  cg.addColorStop(0, css(0x34303a));
  cg.addColorStop(1, css(0x17151b));
  ctx.fillStyle = cg;
  ctx.fill();
  // torso wrap
  ctx.beginPath();
  ctx.roundRect(12, 17, 15, 19, 5);
  const tg = ctx.createLinearGradient(12, 0, 27, 0);
  tg.addColorStop(0, css(0x5a4a3c));
  tg.addColorStop(1, css(0x2c241e));
  ctx.fillStyle = tg;
  ctx.fill();
  // crossed straps with shard pouches
  ctx.strokeStyle = css(0x1e1712);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(13, 19);
  ctx.lineTo(26, 33);
  ctx.stroke();
  ctx.fillStyle = css(PAL.emberHot);
  ctx.fillRect(18.5, 25, 2.5, 2.5);
  // scarf
  ctx.fillStyle = css(0x7a2e24);
  ctx.beginPath();
  ctx.ellipse(20, 17, 8, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [14, 17, 10, 28, 13, 28, 16, 18]);
  ctx.fill();
  // hood
  ctx.beginPath();
  ctx.moveTo(12, 16);
  ctx.quadraticCurveTo(12, 1, 21, 1);
  ctx.quadraticCurveTo(30, 2, 29, 15);
  ctx.closePath();
  const hg = ctx.createLinearGradient(12, 0, 30, 16);
  hg.addColorStop(0, css(0x4a4552));
  hg.addColorStop(1, css(0x1f1c24));
  ctx.fillStyle = hg;
  ctx.fill();
  // face in shadow + ember eyes
  ctx.beginPath();
  ctx.ellipse(24, 10, 4.2, 4.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0x0c0b0e);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.ember);
  ctx.shadowBlur = 4;
  ctx.fillStyle = css(PAL.emberHot);
  ctx.fillRect(23.5, 9, 1.8, 1.4);
  ctx.fillRect(26.4, 9, 1.6, 1.4);
  ctx.restore();
}

function staff(ctx: Ctx): void {
  // 46 x 12; grip at x=6 (origin), crystal at the far end.
  ctx.fillStyle = css(0x3b2a1e);
  ctx.fillRect(0, 5, 38, 2.4);
  ctx.fillStyle = css(PAL.gold);
  ctx.fillRect(34, 3.8, 2, 4.8);
  poly(ctx, [37, 6.2, 41, 1, 46, 6.2, 41, 11.4]);
  ctx.save();
  ctx.shadowColor = css(PAL.ember);
  ctx.shadowBlur = 6;
  const g = ctx.createLinearGradient(37, 0, 46, 12);
  g.addColorStop(0, css(0xfff1d6));
  g.addColorStop(1, css(PAL.ember));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function acolyteBody(ctx: Ctx): void {
  // 34 x 46, robed caster. Feet line y=46.
  poly(ctx, [10, 14, 24, 14, 30, 46, 4, 46]);
  const rg = ctx.createLinearGradient(0, 14, 0, 46);
  rg.addColorStop(0, css(0x2b3532));
  rg.addColorStop(1, css(0x111615));
  ctx.fillStyle = rg;
  ctx.fill();
  // ash-grey sash and hem runes
  ctx.strokeStyle = css(PAL.hollow, 0.55);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(7 + i * 4.5, 43);
    ctx.lineTo(8.5 + i * 4.5, 40);
    ctx.stroke();
  }
  ctx.fillStyle = css(0x8a8478);
  ctx.fillRect(9, 26, 16, 2.5);
  // cowl with a bone mask
  ctx.beginPath();
  ctx.moveTo(9, 15);
  ctx.quadraticCurveTo(9, 0, 17, 0);
  ctx.quadraticCurveTo(26, 0, 25, 15);
  ctx.closePath();
  ctx.fillStyle = css(0x1d2422);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(19, 8.5, 4.4, 5.2, 0.15, 0, Math.PI * 2);
  ctx.fillStyle = css(0xd8d0bd);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 4;
  ctx.fillStyle = css(PAL.hollow);
  ctx.fillRect(18.6, 7, 2, 1.6);
  ctx.fillRect(21.4, 7.2, 1.6, 1.4);
  ctx.restore();
  // raised hand holding a cinder
  ctx.strokeStyle = css(0x2b3532);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(22, 18);
  ctx.lineTo(29, 14);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = css(PAL.danger);
  ctx.shadowBlur = 6;
  ctx.fillStyle = css(0xff7a4a);
  ctx.beginPath();
  ctx.arc(30.5, 12, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function chest(ctx: Ctx, open: boolean): void {
  // 40 x 34 iso chest, origin bottom centre.
  const body = 0x5a3a22;
  poly(ctx, [4, 16, 20, 24, 20, 34, 4, 26]);
  ctx.fillStyle = css(shade(body, 0.7));
  ctx.fill();
  poly(ctx, [20, 24, 36, 16, 36, 26, 20, 34]);
  ctx.fillStyle = css(body);
  ctx.fill();
  ctx.strokeStyle = css(PAL.gold);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(4, 21);
  ctx.lineTo(20, 29);
  ctx.lineTo(36, 21);
  ctx.stroke();
  if (open) {
    poly(ctx, [4, 16, 20, 8, 36, 16, 20, 24]);
    ctx.fillStyle = css(0x120c08);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = css(PAL.emberHot);
    ctx.shadowBlur = 8;
    poly(ctx, [10, 16, 20, 11, 30, 16, 20, 21]);
    ctx.fillStyle = css(PAL.ember, 0.6);
    ctx.fill();
    ctx.restore();
    poly(ctx, [4, 16, 20, 8, 20, -2, 4, 6]);
    ctx.fillStyle = css(shade(body, 0.85));
    ctx.fill();
  } else {
    poly(ctx, [4, 16, 20, 8, 36, 16, 20, 24]);
    ctx.fillStyle = css(shade(body, 1.25));
    ctx.fill();
    poly(ctx, [4, 16, 20, 24, 20, 20, 4, 12]);
    ctx.fill();
    ctx.strokeStyle = css(PAL.gold);
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(28, 20);
    ctx.stroke();
    ctx.fillStyle = css(PAL.gold);
    ctx.fillRect(18.5, 24, 3, 4);
  }
}

function shrine(ctx: Ctx): void {
  // 40 x 46 stone altar with a bowl, origin bottom centre.
  poly(ctx, [6, 32, 20, 39, 34, 32, 34, 40, 20, 46, 6, 40]);
  ctx.fillStyle = css(0x3a3e48);
  ctx.fill();
  poly(ctx, [6, 32, 20, 25, 34, 32, 20, 39]);
  ctx.fillStyle = css(0x555b67);
  ctx.fill();
  ctx.fillStyle = css(0x2c2f37);
  poly(ctx, [15, 33, 25, 33, 23, 16, 17, 16]);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(20, 15, 9, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0x4a4f5a);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(20, 14, 7, 2.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(PAL.gold, 0.9);
  ctx.fill();
  ctx.strokeStyle = css(PAL.gold, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(17, 21);
  ctx.lineTo(20, 24);
  ctx.lineTo(23, 21);
  ctx.stroke();
}

function stairs(ctx: Ctx): void {
  // 64 x 32 floor decal: steps descending into the dark, drawn inside a tile diamond.
  diamond(ctx, 32, 16, 30, 15);
  ctx.fillStyle = css(PAL.void);
  ctx.fill();
  ctx.save();
  diamond(ctx, 32, 16, 30, 15);
  ctx.clip();
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    ctx.fillStyle = css(shade(0x3a3f4b, 1 - t * 0.8));
    poly(ctx, [6 + i * 5, 16 - i * 0.5, 32, 3 + i * 2.6, 58 - i * 5, 16 - i * 0.5, 32, 29 - i * 3]);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = css(PAL.stone5);
  ctx.lineWidth = 1.5;
  diamond(ctx, 32, 16, 30, 15);
  ctx.stroke();
}

/** Portcullis panel along a wall. slope = screen dy/dx of the wall line (+0.5 world-x wall, −0.5 world-y wall). */
function gate(ctx: Ctx, slope: number): void {
  // 64 x 72; the panel's foot passes through the tile centre at (32, 56).
  const foot = (x: number) => 56 + slope * (x - 32);
  const H = 34;
  ctx.strokeStyle = css(0x2b2d33);
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const x = 12 + i * 10;
    ctx.beginPath();
    ctx.moveTo(x, foot(x) - H);
    ctx.lineTo(x, foot(x) + 1);
    ctx.stroke();
  }
  ctx.strokeStyle = css(0x50535c);
  ctx.lineWidth = 2.2;
  for (const up of [10, 26]) {
    ctx.beginPath();
    ctx.moveTo(8, foot(8) - up);
    ctx.lineTo(56, foot(56) - up);
    ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = css(PAL.danger);
  ctx.shadowBlur = 6;
  ctx.fillStyle = css(PAL.danger, 0.9);
  ctx.beginPath();
  ctx.arc(32, foot(32) - 18, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function houndBody(ctx: Ctx): void {
  // 46 x 32 frost hound, facing right, paws on y=32.
  const fur = 0x8ea4bc;
  ctx.strokeStyle = css(shade(fur, 0.55));
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [x, lift] of [[11, 0], [17, 1], [30, 1], [36, 0]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, 19);
    ctx.lineTo(x + 1, 31 - lift);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(23, 17, 15, 7.5, -0.05, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, 9, 0, 25);
  g.addColorStop(0, css(shade(fur, 1.15)));
  g.addColorStop(1, css(shade(fur, 0.5)));
  ctx.fillStyle = g;
  ctx.fill();
  // icy spines along the back
  ctx.fillStyle = css(0xe6f6ff);
  for (let i = 0; i < 5; i++) poly(ctx, [12 + i * 5, 11, 14 + i * 5, 4 + (i % 2) * 2, 16 + i * 5, 11]), ctx.fill();
  // head and snout
  ctx.beginPath();
  ctx.ellipse(38, 13, 6.5, 5, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = css(shade(fur, 0.95));
  ctx.fill();
  poly(ctx, [41, 12, 46, 15, 41, 18]);
  ctx.fillStyle = css(shade(fur, 0.7));
  ctx.fill();
  poly(ctx, [34, 9, 35, 3, 38, 8]);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 4;
  ctx.fillStyle = css(PAL.hollow);
  ctx.fillRect(39, 11, 2, 1.6);
  ctx.restore();
  // tail
  ctx.strokeStyle = css(shade(fur, 0.8));
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(9, 15);
  ctx.quadraticCurveTo(2, 10, 4, 4);
  ctx.stroke();
}

function pyreBody(ctx: Ctx): void {
  // 36 x 46 fire cultist with a brazier strapped to the back. Feet line y=46.
  poly(ctx, [9, 16, 25, 16, 31, 46, 3, 46]);
  const rg = ctx.createLinearGradient(0, 16, 0, 46);
  rg.addColorStop(0, css(0x4a2018));
  rg.addColorStop(1, css(0x1c0d0a));
  ctx.fillStyle = rg;
  ctx.fill();
  // back brazier
  ctx.beginPath();
  ctx.ellipse(8, 14, 7, 3.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0x3a3332);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(0xff7a2a);
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(8, 12.5, 5.5, 2.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, 8, 12.5, 5.5, [[0, css(0xffe0a0)], [0.6, css(0xff7a2a)], [1, css(0xc0301a)]]);
  ctx.fill();
  ctx.restore();
  // hood with an iron mask
  ctx.beginPath();
  ctx.moveTo(13, 17);
  ctx.quadraticCurveTo(12, 2, 21, 3);
  ctx.quadraticCurveTo(29, 4, 27, 17);
  ctx.closePath();
  ctx.fillStyle = css(0x2a1410);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(19, 7, 7, 7, 2);
  ctx.fillStyle = css(0x55504e);
  ctx.fill();
  ctx.fillStyle = css(0xff9a4a);
  ctx.fillRect(21, 9.5, 4, 1.4);
  // hand with a bomb
  ctx.strokeStyle = css(0x4a2018);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(24, 20);
  ctx.lineTo(31, 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(32.5, 22, 3, 0, Math.PI * 2);
  ctx.fillStyle = css(0x2a2626);
  ctx.fill();
  ctx.fillStyle = css(0xffc073);
  ctx.fillRect(32, 17.5, 1.2, 2.2);
}

function bossCryptBody(ctx: Ctx): void {
  // the brute silhouette in darker crypt armour, with horns and gold trim (60 x 66, feet y=66)
  ctx.save();
  ctx.translate(0, 4);
  bruteBody(ctx);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(20,22,30,0.35)';
  ctx.fillRect(0, 0, 60, 66);
  ctx.restore();
  ctx.strokeStyle = css(PAL.gold);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(18, 24, 24, 20, 4);
  ctx.stroke();
  // horns
  ctx.fillStyle = css(0xd8d0bd);
  poly(ctx, [24, 10, 16, 0, 20, 11]);
  ctx.fill();
  poly(ctx, [38, 10, 46, 0, 42, 11]);
  ctx.fill();
}

function bossFrostBody(ctx: Ctx): void {
  // 36 x 54 frost queen: long robe, ice crown, pale glowing eyes. Feet line y=54.
  poly(ctx, [11, 20, 25, 20, 33, 54, 3, 54]);
  const rg = ctx.createLinearGradient(0, 20, 0, 54);
  rg.addColorStop(0, css(0x9cc8ef));
  rg.addColorStop(1, css(0x22384f));
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.strokeStyle = css(0xe6f6ff, 0.7);
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(6 + i * 4.6, 52);
    ctx.lineTo(9 + i * 4.6, 44);
    ctx.stroke();
  }
  // shoulders and pale face
  ctx.beginPath();
  ctx.ellipse(18, 21, 9, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0xc8e2fa);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(19, 13, 5, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0xdfe9f2);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(0x9fd8ff);
  ctx.shadowBlur = 5;
  ctx.fillStyle = css(0x6fd6ff);
  ctx.fillRect(19, 12, 2, 1.5);
  ctx.fillRect(22, 12, 1.6, 1.5);
  ctx.restore();
  // crown of ice shards
  ctx.fillStyle = css(0xeaf8ff);
  for (let i = 0; i < 5; i++) {
    const x = 13 + i * 3;
    poly(ctx, [x, 8, x + 1.5, 8 - 4 - (i === 2 ? 4 : i % 2 ? 1 : 2), x + 3, 8]);
    ctx.fill();
  }
  // a shard staff
  ctx.strokeStyle = css(0xbfe3ff);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(29, 52);
  ctx.lineTo(31, 14);
  ctx.stroke();
  poly(ctx, [31, 6, 34, 13, 31, 17, 28, 13]);
  ctx.fillStyle = css(0xeaf8ff);
  ctx.fill();
}

function bossKingBody(ctx: Ctx): void {
  // 44 x 58 the Hollow King: black plate, torn royal mantle, a crown above an empty face.
  poly(ctx, [10, 18, 34, 18, 40, 54, 34, 50, 29, 56, 22, 51, 15, 56, 9, 50, 4, 55]);
  const mg = ctx.createLinearGradient(0, 18, 0, 56);
  mg.addColorStop(0, css(0x6a1a1c));
  mg.addColorStop(1, css(0x200809));
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(13, 19, 18, 24, 5);
  const pg = ctx.createLinearGradient(13, 0, 31, 0);
  pg.addColorStop(0, css(0x4a4d58));
  pg.addColorStop(1, css(0x15161b));
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 6;
  ctx.strokeStyle = css(PAL.hollow, 0.9);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(22, 24);
  ctx.lineTo(20, 31);
  ctx.lineTo(23, 37);
  ctx.stroke();
  ctx.restore();
  for (const [x, w] of [[13, 8], [31, 8]] as const) {
    ctx.beginPath();
    ctx.ellipse(x, 21, w, 5.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(0x2e3038);
    ctx.fill();
  }
  // helm with a hollow, glowing face
  ctx.beginPath();
  ctx.roundRect(15, 5, 14, 15, [6, 6, 3, 3]);
  ctx.fillStyle = css(0x24262d);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(23, 12, 4, 4.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(0x061513);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(PAL.hollow);
  ctx.shadowBlur = 8;
  ctx.fillStyle = css(PAL.hollow, 0.85);
  ctx.beginPath();
  ctx.arc(23, 12, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // the hollow crown, floating
  ctx.strokeStyle = css(PAL.gold);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(15, 3);
  ctx.lineTo(16, -3 + 4);
  ctx.lineTo(19, 1);
  ctx.lineTo(22, -4 + 4);
  ctx.lineTo(25, 1);
  ctx.lineTo(28, -3 + 4);
  ctx.lineTo(29, 3);
  ctx.closePath();
  ctx.stroke();
}

function kingBlade(ctx: Ctx): void {
  // 60 x 12 greatsword; grip at x=6.
  ctx.fillStyle = css(0x1a1416);
  ctx.fillRect(0, 4.5, 8, 3);
  ctx.fillStyle = css(PAL.gold);
  ctx.fillRect(7, 0.5, 3, 11);
  poly(ctx, [10, 3, 54, 4, 60, 6, 54, 8, 10, 9]);
  const g = ctx.createLinearGradient(0, 3, 0, 9);
  g.addColorStop(0, css(0x9aa0aa));
  g.addColorStop(1, css(0x2a2d34));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = css(PAL.hollow, 0.7);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(12, 6);
  ctx.lineTo(52, 6);
  ctx.stroke();
}

function trapPlate(ctx: Ctx, base: number): void {
  diamond(ctx, 32, 16, 26, 13);
  ctx.fillStyle = css(base);
  ctx.fill();
  ctx.strokeStyle = css(PAL.void, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function spikes(ctx: Ctx, up: boolean): void {
  // 64 x 44; the plate sits at y 12..44 (centre 28), spikes rise above it when up.
  ctx.save();
  ctx.translate(0, 12);
  trapPlate(ctx, 0x2a2c33);
  const holes: [number, number][] = [[22, 12], [32, 8], [42, 12], [22, 20], [32, 16], [42, 20], [32, 24]];
  for (const [x, y] of holes) {
    ctx.fillStyle = css(PAL.void, 0.9);
    ctx.beginPath();
    ctx.ellipse(x, y, 2.4, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (up) {
      poly(ctx, [x - 2, y, x, y - 13, x + 2, y]);
      const g = ctx.createLinearGradient(0, y - 13, 0, y);
      g.addColorStop(0, '#f2f2f2');
      g.addColorStop(1, '#5c606a');
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  ctx.restore();
}

function lootGem(ctx: Ctx): void {
  // 22 x 26 white faceted relic (tinted by rarity at runtime).
  poly(ctx, [11, 0, 21, 9, 11, 26, 1, 9]);
  ctx.fillStyle = '#f4f4f4';
  ctx.fill();
  poly(ctx, [11, 0, 21, 9, 11, 12, 1, 9]);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  poly(ctx, [11, 12, 21, 9, 11, 26]);
  ctx.fillStyle = '#bdbdbd';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  poly(ctx, [11, 0, 21, 9, 11, 26, 1, 9]);
  ctx.stroke();
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

  // every floor of the dungeon has its own stone, walls, braziers and floor sigil
  for (const bio of BIOMES) {
    const P = bio.palette;
    const k = (name: string) => `${bio.id}-${name}`;
    P.floor.forEach((base, i) => make(scene, k(`floor${i}`), 64, 32, (c) => floorTile(c, rng, base)));
    for (let i = 0; i < 3; i++) make(scene, k(`wall${i}`), 64, 32 + WALL_H, (c) => block(c, rng, WALL_H, P.wallTop, P.wallLeft, P.wallRight, 4));
    make(scene, k('wallLow'), 64, 32 + LOW_WALL_H, (c) => block(c, rng, LOW_WALL_H, P.wallTop, P.wallLeft, P.wallRight, 1));
    make(scene, k('pillar'), 64, 32 + PILLAR_H, (c) => {
      block(c, rng, PILLAR_H, P.pillarTop, shade(P.wallLeft, 1.15), shade(P.wallRight, 1.15), 7);
      // carved band near the top
      c.strokeStyle = css(P.accent, 0.2);
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(0, 16 + 14);
      c.lineTo(32, 32 + 14);
      c.lineTo(64, 16 + 14);
      c.stroke();
    });
    make(scene, k('sigil'), 384, 192, (c) => sigil(c, P.accent));
    make(scene, k('brazier'), 32, 40, (c) => {
      c.fillStyle = css(shade(P.wallLeft, 0.9));
      poly(c, [12, 40, 20, 40, 18, 18, 14, 18]);
      c.fill();
      c.beginPath();
      c.ellipse(16, 15, 13, 6, 0, 0, Math.PI * 2);
      c.fillStyle = css(P.wallTop);
      c.fill();
      c.beginPath();
      c.ellipse(16, 13, 11, 4.5, 0, 0, Math.PI * 2);
      c.fillStyle = radial(c, 16, 13, 11, [[0, css(P.flame[0])], [0.5, css(P.flame[1])], [1, css(P.flame[2])]]);
      c.fill();
    });
  }
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

  make(scene, 'wandererBody', 38, 48, wandererBody);
  make(scene, 'staff', 46, 12, staff);
  make(scene, 'acolyteBody', 34, 46, acolyteBody);
  make(scene, 'chest', 40, 36, (c) => {
    c.translate(0, 2);
    chest(c, false);
  });
  make(scene, 'chestOpen', 40, 36, (c) => {
    c.translate(0, 2);
    chest(c, true);
  });
  make(scene, 'shrine', 40, 46, shrine);
  make(scene, 'stairs', 64, 32, stairs);
  make(scene, 'gateX', 64, 72, (c) => gate(c, 0.5));
  make(scene, 'gateY', 64, 72, (c) => gate(c, -0.5));
  make(scene, 'shard', 18, 6, (c) => {
    poly(c, [0, 3, 6, 0.5, 18, 3, 6, 5.5]);
    const g = c.createLinearGradient(0, 0, 18, 0);
    g.addColorStop(0, css(PAL.ember, 0));
    g.addColorStop(0.5, css(PAL.emberHot));
    g.addColorStop(1, '#fffaf0');
    c.fillStyle = g;
    c.fill();
  });
  make(scene, 'ember', 20, 20, (c) => {
    c.fillStyle = radial(c, 10, 10, 10, [[0, '#fff2e0'], [0.3, css(0xff6a3a)], [0.7, css(PAL.dangerDeep, 0.8)], [1, css(PAL.dangerDeep, 0)]]);
    c.fillRect(0, 0, 20, 20);
  });

  make(scene, 'houndBody', 46, 32, houndBody);
  make(scene, 'pyreBody', 36, 46, pyreBody);
  make(scene, 'bossCryptBody', 60, 66, bossCryptBody);
  make(scene, 'bossFrostBody', 36, 54, bossFrostBody);
  make(scene, 'bossKingBody', 44, 58, (c) => {
    c.translate(0, 4);
    bossKingBody(c);
  });
  make(scene, 'kingBlade', 60, 12, kingBlade);
  make(scene, 'trapSpikes', 64, 44, (c) => spikes(c, false));
  make(scene, 'trapSpikesUp', 64, 44, (c) => spikes(c, true));
  make(scene, 'trapVent', 64, 32, (c) => {
    trapPlate(c, 0x2a201d);
    c.strokeStyle = css(0x0e0a09);
    c.lineWidth = 1.6;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(32 + i * 6 - 8, 16 + i * 3 - 4);
      c.lineTo(32 + i * 6 + 8, 16 + i * 3 + 4);
      c.stroke();
    }
  });
  make(scene, 'trapIce', 64, 32, (c) => {
    diamond(c, 32, 16, 31, 15.5);
    c.fillStyle = 'rgba(190,230,255,0.42)';
    c.fill();
    c.strokeStyle = 'rgba(235,250,255,0.55)';
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(18, 14);
    c.lineTo(30, 18);
    c.lineTo(44, 12);
    c.moveTo(28, 9);
    c.lineTo(34, 22);
    c.stroke();
  });
  make(scene, 'trapLava', 64, 32, (c) => {
    diamond(c, 32, 16, 31, 15.5);
    c.fillStyle = css(0x1a0d0a);
    c.fill();
    c.save();
    diamond(c, 32, 16, 31, 15.5);
    c.clip();
    c.shadowColor = '#ff6a2a';
    c.shadowBlur = 6;
    c.strokeStyle = '#ff8a3a';
    c.lineWidth = 2.2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      let x = rng.range(10, 30);
      let y = rng.range(6, 26);
      c.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += rng.range(4, 9);
        y += rng.range(-4, 4);
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
  });
  make(scene, 'loot', 22, 26, lootGem);

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
