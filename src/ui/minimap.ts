import type { DungeonDirector } from '../sim/director';
import type { Simulation } from '../sim/simulation';
import type { Dungeon, Room } from '../world/dungeon';

/** Smallest scale (canvas pixels per projected tile) at which rooms stay readable. Below it the map scrolls with the hero. */
const MIN_SCALE = 2.6;
const PAD = 12;

/**
 * Isometric minimap on a small canvas: same orientation as the game view, so "up-right on the map" is
 * "up-right on screen". It shows only what has been revealed. A small floor fits whole; a large one is
 * drawn at a readable scale and follows the hero. The main route is drawn bold, side branches thin, and
 * the next unexplored step of the main route pulses so the way to the boss is always clear.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = MIN_SCALE;
  /** Projected coordinates of the view's centre, eased toward their target. */
  private cx = 0;
  private cy = 0;
  private fitVersion = -1;
  private bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private settled = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setDungeon(_d: Dungeon): void {
    this.fitVersion = -1;
    this.settled = false;
  }

  private static iso(x: number, y: number): [number, number] {
    return [x - y, (x + y) / 2];
  }

  /** Bounds of what is shown: revealed rooms, and the rooms their corridors lead on to. */
  private refit(d: Dungeon, dir: DungeonDirector): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const take = (x: number, y: number) => {
      const [sx, sy] = Minimap.iso(x, y);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    };
    const room = (r: Room) => {
      take(r.x0, r.y0);
      take(r.x1 + 1, r.y0);
      take(r.x0, r.y1 + 1);
      take(r.x1 + 1, r.y1 + 1);
    };
    for (const r of d.rooms) {
      if (!dir.revealedRooms[r.id]) continue;
      room(r);
      for (const n of r.links) if (!dir.revealedRooms[n]) take(d.rooms[n]!.cx, d.rooms[n]!.cy);
    }
    this.bounds = { minX, maxX, minY, maxY };
    this.fitVersion = dir.revealVersion;
  }

  private target(sim: Simulation): { scale: number; cx: number; cy: number } {
    const { minX, maxX, minY, maxY } = this.bounds;
    const w = this.canvas.width - PAD * 2;
    const h = this.canvas.height - PAD * 2;
    const fit = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY));
    if (fit >= MIN_SCALE) return { scale: fit, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    // too large to show whole: follow the hero, but never scroll beyond what is revealed
    const [hx, hy] = Minimap.iso(sim.hero.x, sim.hero.y);
    const halfW = w / 2 / MIN_SCALE;
    const halfH = h / 2 / MIN_SCALE;
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    return { scale: MIN_SCALE, cx: clamp(hx, minX + halfW, maxX - halfW), cy: clamp(hy, minY + halfH, maxY - halfH) };
  }

  private px(x: number, y: number): [number, number] {
    const [sx, sy] = Minimap.iso(x, y);
    return [this.canvas.width / 2 + (sx - this.cx) * this.scale, this.canvas.height / 2 + (sy - this.cy) * this.scale];
  }

  private quad(x0: number, y0: number, x1: number, y1: number): void {
    const c = this.ctx;
    const a = this.px(x0, y0);
    const b = this.px(x1, y0);
    const d = this.px(x1, y1);
    const e = this.px(x0, y1);
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(d[0], d[1]);
    c.lineTo(e[0], e[1]);
    c.closePath();
  }

  draw(d: Dungeon, dir: DungeonDirector, sim: Simulation, time: number): void {
    const c = this.ctx;
    if (dir.revealVersion !== this.fitVersion) this.refit(d, dir);
    const goal = this.target(sim);
    const k = this.settled ? 0.25 : 1;
    this.scale += (goal.scale - this.scale) * k;
    this.cx += (goal.cx - this.cx) * k;
    this.cy += (goal.cy - this.cy) * k;
    this.settled = true;

    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.lineJoin = 'round';
    c.lineCap = 'round';

    // the next step of the main route: the first room on it that is not cleared yet
    const next = d.mainRoute.find((id) => dir.states[id] !== 'cleared');

    d.corridors.forEach((cor, i) => {
      if (!dir.revealedCorridors[i]) return;
      const a = d.rooms[cor.a]!;
      const b = d.rooms[cor.b]!;
      const p = this.px(a.cx, a.cy);
      const q = this.px(b.cx, b.cy);
      c.strokeStyle = cor.main ? 'rgba(232,224,204,0.62)' : 'rgba(185,178,162,0.32)';
      c.lineWidth = cor.main ? 4.5 : 2;
      c.beginPath();
      c.moveTo(p[0], p[1]);
      c.lineTo(q[0], q[1]);
      c.stroke();
    });

    // rooms that exist but have not been seen yet: a hollow marker (the main route's next one pulses)
    for (const r of d.rooms) {
      if (dir.revealedRooms[r.id]) continue;
      if (!r.links.some((n) => dir.revealedRooms[n])) continue;
      const [x, y] = this.px(r.cx, r.cy);
      const main = r.route === 'main';
      const pulse = main && r.id === next ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
      c.strokeStyle = main ? `rgba(240,138,60,${0.55 + pulse * 0.4})` : 'rgba(185,178,162,0.4)';
      c.lineWidth = main ? 2.2 : 1.4;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.arc(x, y, (main ? 6 : 4.5) + pulse * 2, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }

    for (const r of d.rooms) {
      if (!dir.revealedRooms[r.id]) continue;
      const st = dir.states[r.id];
      const main = r.route === 'main';
      this.quad(r.x0, r.y0, r.x1 + 1, r.y1 + 1);
      c.fillStyle = st === 'active' ? 'rgba(200,50,58,0.55)' : st === 'cleared' ? 'rgba(62,67,80,0.9)' : r.type === 'elite' ? 'rgba(80,46,30,0.92)' : r.type === 'arena' ? 'rgba(52,40,58,0.92)' : 'rgba(30,32,40,0.9)';
      c.fill();
      const current = r.id === dir.currentRoom;
      const pulse = r.id === next && st !== 'active' && !current ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
      c.strokeStyle = current ? 'rgba(240,138,60,0.95)' : pulse > 0 ? `rgba(240,138,60,${0.4 + pulse * 0.5})` : main ? 'rgba(232,224,204,0.5)' : 'rgba(185,178,162,0.3)';
      c.lineWidth = current ? 2.5 : main ? 1.8 : 1.1;
      c.stroke();
    }

    for (const o of sim.objects) {
      if (!dir.revealedRooms[o.roomId] || o.used) continue;
      const [x, y] = this.px(o.x, o.y);
      c.fillStyle = o.kind === 'stairs' ? (o.active ? '#f08a3c' : 'rgba(240,138,60,0.35)') : o.kind === 'shrine' ? '#6be3d4' : o.kind === 'altar' ? '#c8556a' : '#d6b25e';
      c.beginPath();
      if (o.kind === 'stairs') {
        c.moveTo(x, y - 5);
        c.lineTo(x + 5, y);
        c.lineTo(x, y + 5);
        c.lineTo(x - 5, y);
      } else c.arc(x, y, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    const [hx, hy] = this.px(sim.hero.x, sim.hero.y);
    c.fillStyle = '#fff1d6';
    c.beginPath();
    c.arc(hx, hy, 3.5 + Math.sin(time * 6) * 0.6, 0, Math.PI * 2);
    c.fill();
  }
}
