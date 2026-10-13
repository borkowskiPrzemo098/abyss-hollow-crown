import type { DungeonDirector } from '../sim/director';
import type { Simulation } from '../sim/simulation';
import type { Dungeon } from '../world/dungeon';

/**
 * Isometric minimap on a small canvas: same orientation as the game view, so
 * "up-right on the map" is "up-right on screen". Shows only revealed rooms.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setDungeon(d: Dungeon): void {
    // fit the projected bounds of the actual rooms (not the whole grid) into the canvas
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const r of d.rooms) {
      for (const [x, y] of [[r.x0, r.y0], [r.x1 + 1, r.y0], [r.x0, r.y1 + 1], [r.x1 + 1, r.y1 + 1]] as const) {
        const sx = x - y;
        const sy = (x + y) / 2;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
    }
    const pad = 8;
    this.scale = Math.min((this.canvas.width - pad * 2) / (maxX - minX), (this.canvas.height - pad * 2) / (maxY - minY));
    this.ox = (this.canvas.width - (maxX + minX) * this.scale) / 2;
    this.oy = (this.canvas.height - (maxY + minY) * this.scale) / 2;
  }

  private px(x: number, y: number): [number, number] {
    return [this.ox + (x - y) * this.scale, this.oy + ((x + y) / 2) * this.scale];
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
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.lineJoin = 'round';
    d.corridors.forEach((cor, i) => {
      if (!dir.revealedCorridors[i]) return;
      const a = d.rooms[cor.a]!;
      const b = d.rooms[cor.b]!;
      const p = this.px(a.cx, a.cy);
      const q = this.px(b.cx, b.cy);
      c.strokeStyle = 'rgba(185,178,162,0.45)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(p[0], p[1]);
      c.lineTo(q[0], q[1]);
      c.stroke();
    });
    for (const r of d.rooms) {
      if (!dir.revealedRooms[r.id]) continue;
      const st = dir.states[r.id];
      this.quad(r.x0, r.y0, r.x1 + 1, r.y1 + 1);
      c.fillStyle = st === 'active' ? 'rgba(200,50,58,0.55)' : st === 'cleared' ? 'rgba(62,67,80,0.9)' : 'rgba(30,32,40,0.9)';
      c.fill();
      c.strokeStyle = r.id === dir.currentRoom ? 'rgba(240,138,60,0.95)' : 'rgba(185,178,162,0.35)';
      c.lineWidth = r.id === dir.currentRoom ? 2.5 : 1.2;
      c.stroke();
    }
    for (const o of sim.objects) {
      if (!dir.revealedRooms[o.roomId] || o.used) continue;
      const [x, y] = this.px(o.x, o.y);
      c.fillStyle = o.kind === 'stairs' ? (o.active ? '#f08a3c' : 'rgba(240,138,60,0.35)') : '#d6b25e';
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
