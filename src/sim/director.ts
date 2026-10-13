import type { EnemyKind } from '../config/balance';
import { DUNGEON, ENEMY_COST } from '../config/dungeon';
import { RUN, floorScaling } from '../config/progression';
import { dist } from '../core/math';
import type { Rng } from '../core/rng';
import { Tile } from '../world/arena';
import { roomAt, type Dungeon, type Room } from '../world/dungeon';
import type { Director, Simulation } from './simulation';

export type RoomState = 'unvisited' | 'active' | 'cleared';

/** Builds the waves for one room from its enemy budget. Deterministic for a given rng state. */
export function composeEncounter(room: Room, depth: number, rng: Rng): EnemyKind[][] {
  const mult = room.type === 'elite' ? DUNGEON.eliteMult : room.type === 'exit' ? DUNGEON.guardianMult : 1;
  const area = (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1);
  let budget = (DUNGEON.budgetBase + DUNGEON.budgetPerDepth * (depth - 1)) * mult * Math.min(1.2, Math.max(0.85, area / 121));
  const roster: EnemyKind[] = [];
  if (room.type === 'elite' || room.type === 'exit' || depth >= 3) {
    roster.push('brute');
    budget -= ENEMY_COST.brute;
  }
  let acolytes = 0;
  const maxAcolytes = depth === 1 ? 1 : 2 + Math.floor(depth / 2);
  while (budget >= 1) {
    const r = rng.next();
    let kind: EnemyKind = 'thrall';
    if (r < 0.28 && acolytes < maxAcolytes && budget >= ENEMY_COST.acolyte) kind = 'acolyte';
    else if (r > 0.88 && depth >= 2 && budget >= ENEMY_COST.brute) kind = 'brute';
    if (kind === 'acolyte') acolytes++;
    roster.push(kind);
    budget -= ENEMY_COST[kind];
  }
  const waves = room.type === 'combat' && roster.length <= 5 ? 1 : room.type === 'exit' ? 3 : 2;
  const out: EnemyKind[][] = Array.from({ length: waves }, () => []);
  // brutes lead the first wave; the rest is dealt round-robin
  roster.forEach((k, i) => out[k === 'brute' && i === 0 ? 0 : i % waves]!.push(k));
  return out.filter((w) => w.length > 0);
}

/**
 * Runs one dungeon floor on top of the combat simulation: reveals rooms as the
 * hero explores, locks doors while a room's fight is on, spawns its waves,
 * pays out rewards, and opens the stairs once the exit room is cleared.
 */
export class DungeonDirector implements Director {
  readonly states: RoomState[];
  readonly revealedRooms: Uint8Array;
  readonly revealedCorridors: Uint8Array;
  currentRoom: number | null = null;
  /** Bumped whenever the revealed set changes (renderers redraw the minimap). */
  revealVersion = 0;
  private waves: EnemyKind[][] = [];
  /** Objects that appeared under the hero: they arm only after the hero steps off. */
  private readonly needsLeave = new Set<number>();
  private waveT = 0;

  constructor(private readonly sim: Simulation, readonly dungeon: Dungeon) {
    this.states = dungeon.rooms.map((r) => (r.type === 'start' ? 'cleared' : 'unvisited'));
    this.revealedRooms = new Uint8Array(dungeon.rooms.length);
    this.revealedCorridors = new Uint8Array(dungeon.corridors.length);
    for (const o of dungeon.objects) sim.addObject(o.kind, o.x, o.y, o.roomId, o.kind !== 'stairs');
    this.reveal(dungeon.startRoom);
    this.currentRoom = dungeon.startRoom;
  }

  get activeRoom(): Room | null {
    const i = this.states.indexOf('active');
    return i >= 0 ? this.dungeon.rooms[i]! : null;
  }

  update(dt: number): void {
    const h = this.sim.hero;
    const d = this.dungeon;
    // reveal: standing in a room shows its corridors; standing in a corridor shows both ends
    const reg = d.region[Math.floor(h.y) * d.map.w + Math.floor(h.x)] ?? -1;
    if (reg >= 0) this.reveal(reg);
    else if (reg <= -2) {
      const ci = -reg - 2;
      const c = d.corridors[ci]!;
      this.reveal(c.a);
      this.reveal(c.b);
    }

    const inside = roomAt(d, h.x, h.y, 1);
    if (inside) {
      this.currentRoom = inside.id;
      if (this.states[inside.id] === 'unvisited' && h.state !== 'dead') this.enter(inside);
    }

    const active = this.activeRoom;
    if (active && this.sim.livingEnemyCount() === 0) {
      if (this.waves.length > 0) {
        this.waveT -= dt;
        if (this.waveT <= 0) this.spawnWave(active);
      } else {
        this.clear(active);
      }
    }

    for (const o of this.sim.objects) {
      if (o.used || !o.active || h.state === 'dead') continue;
      const dd = dist(o.x, o.y, h.x, h.y);
      if (this.needsLeave.has(o.id)) {
        if (dd > 1.2) this.needsLeave.delete(o.id);
        continue;
      }
      if (dd > 0.75) continue;
      if (o.kind === 'chest') {
        o.used = true;
        this.sim.emit({ type: 'chest', x: o.x, y: o.y });
        for (let i = 0; i < 4; i++) this.sim.addPickup('ash', o.x, o.y, 1);
        this.sim.queueChoice('chest');
      } else if (o.kind === 'shrine') {
        o.used = true;
        const healed = this.sim.heal(h.stats.maxHp * RUN.shrineHealFraction);
        this.sim.emit({ type: 'shrine', x: o.x, y: o.y, amount: healed });
      } else if (o.kind === 'stairs') {
        o.used = true;
        this.sim.emit({ type: 'floorExit' });
      }
    }
  }

  private reveal(roomId: number): void {
    const d = this.dungeon;
    let changed = false;
    if (!this.revealedRooms[roomId]) {
      this.revealedRooms[roomId] = 1;
      changed = true;
    }
    d.corridors.forEach((c, i) => {
      if ((c.a === roomId || c.b === roomId) && !this.revealedCorridors[i]) {
        this.revealedCorridors[i] = 1;
        changed = true;
      }
    });
    if (changed) this.revealVersion++;
  }

  private enter(room: Room): void {
    this.sim.emit({ type: 'roomEnter', roomId: room.id, roomType: room.type });
    if (room.type === 'treasure' || room.type === 'shrine' || room.type === 'start') {
      this.states[room.id] = 'cleared';
      return;
    }
    this.states[room.id] = 'active';
    this.setDoors(room, false);
    this.waves = composeEncounter(room, this.dungeon.depth, this.sim.rng);
    this.spawnWave(room);
  }

  private spawnWave(room: Room): void {
    const wave = this.waves.shift();
    if (!wave) return;
    const h = this.sim.hero;
    const scale = floorScaling(this.dungeon.depth);
    let spots = room.spawns.filter((s) => dist(s.x, s.y, h.x, h.y) >= DUNGEON.minSpawnDistance);
    if (spots.length < 2) spots = [...room.spawns].sort((a, b) => dist(b.x, b.y, h.x, h.y) - dist(a.x, a.y, h.x, h.y));
    const pool = [...spots];
    wave.forEach((kind, i) => {
      if (pool.length === 0) pool.push(...spots);
      const s = pool.splice(this.sim.rng.int(0, pool.length - 1), 1)[0]!;
      this.sim.spawnEnemy(kind, s.x, s.y, { hpScale: scale.hp, dmgScale: scale.damage, xpScale: scale.xp, delay: i * 0.12 });
    });
    this.waveT = DUNGEON.waveGap;
  }

  private clear(room: Room): void {
    this.states[room.id] = 'cleared';
    this.setDoors(room, true);
    this.sim.emit({ type: 'roomClear', roomId: room.id, roomType: room.type });
    for (let i = 0; i < RUN.roomClearAsh; i++) this.sim.addPickup('ash', room.cx, room.cy, 1);
    this.sim.heal(this.sim.hero.stats.maxHp * RUN.roomClearHeal);
    if (room.type === 'elite') {
      const p = this.sim.walkableNear(room.cx, room.cy);
      this.armAway(this.sim.addObject('chest', p.x, p.y, room.id, true).id, p.x, p.y);
    }
    if (room.type === 'exit') {
      for (const o of this.sim.objects) {
        if (o.kind === 'stairs' && o.roomId === room.id) {
          o.active = true;
          this.armAway(o.id, o.x, o.y);
          this.sim.emit({ type: 'stairsOpen', x: o.x, y: o.y });
        }
      }
    }
  }

  private armAway(id: number, x: number, y: number): void {
    const h = this.sim.hero;
    if (dist(x, y, h.x, h.y) < 1.2) this.needsLeave.add(id);
  }

  private setDoors(room: Room, open: boolean): void {
    const m = this.dungeon.map;
    for (const dr of room.doors) m.tiles[dr.ty * m.w + dr.tx] = open ? Tile.Floor : Tile.Door;
    this.sim.invalidateFlow();
    this.sim.emit({ type: 'doors', roomId: room.id, open });
  }
}
