import type { EnemyKind } from '../config/balance';
import { biomeFor } from '../config/biomes';
import { DUNGEON, ENEMY_COST, type EncounterStyle } from '../config/dungeon';
import { DROPS } from '../config/items';
import { RUN, floorScaling } from '../config/progression';
import { dist } from '../core/math';
import type { Rng } from '../core/rng';
import { Tile } from '../world/arena';
import { FIGHT_ROOMS, roomAt, type Dungeon, type Room } from '../world/dungeon';
import type { Director, Simulation } from './simulation';

export type RoomState = 'unvisited' | 'active' | 'cleared';

/** Builds the waves for one room from its enemy budget and the floor's roster. Deterministic for a given rng state. */
export function composeEncounter(room: Room, depth: number, rng: Rng): EnemyKind[][] {
  const biome = biomeFor(depth);
  const style: EncounterStyle = room.style ?? 'standard';
  const mult = room.type === 'elite' ? DUNGEON.eliteMult : room.type === 'arena' ? DUNGEON.arenaMult : 1;
  // the floor builds up: gentler near the entrance, harder near the boss
  const ramp = 1 + DUNGEON.ramp * ((room.progress ?? 0.5) - 0.5);
  const area = (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1);
  let budget = (DUNGEON.budgetBase + DUNGEON.budgetPerDepth * (depth - 1)) * mult * ramp * Math.min(1.2, Math.max(0.85, area / 121));
  if (style === 'swarm') budget *= 1.2;
  const roster: EnemyKind[] = [];
  const brutes = room.type === 'elite' ? 1 + (depth >= 2 && budget > 14 ? 1 : 0) : style === 'brutes' && depth >= 2 ? 2 : depth >= 3 ? 1 : 0;
  for (let i = 0; i < brutes; i++) {
    roster.push('brute');
    budget -= ENEMY_COST.brute;
  }
  // what the style prefers (kinds the floor does not have simply do not appear)
  const kinds = (Object.entries(biome.roster) as [EnemyKind, number][]).map(([k, w]): [EnemyKind, number] => {
    if (style === 'swarm') return [k, k === 'thrall' ? w * 4 : k === 'hound' ? w : w * 0.25];
    if (style === 'ranged') return [k, k === 'acolyte' || k === 'pyre' ? w * 4 : k === 'thrall' ? w * 0.6 : w];
    return [k, w];
  });
  const total = kinds.reduce((t, [, w]) => t + w, 0);
  const cap = biome.specialCap + (style === 'ranged' ? 2 : 0);
  const specials = new Map<EnemyKind, number>();
  const limit = DUNGEON.maxWaves * DUNGEON.maxAlive;
  while (budget >= 1 && roster.length < limit) {
    let r = rng.next() * total;
    let kind: EnemyKind = 'thrall';
    for (const [k, w] of kinds) {
      if (r < w) {
        kind = k;
        break;
      }
      r -= w;
    }
    const special = kind !== 'thrall' && kind !== 'brute';
    if (ENEMY_COST[kind] > budget || (special && (specials.get(kind) ?? 0) >= cap) || (kind === 'brute' && depth === 1 && room.type !== 'elite')) kind = 'thrall';
    if (kind !== 'thrall' && kind !== 'brute') specials.set(kind, (specials.get(kind) ?? 0) + 1);
    roster.push(kind);
    budget -= ENEMY_COST[kind];
  }
  // more waves instead of bigger ones: nobody faces more than maxAlive at once
  const minWaves = room.type === 'arena' ? DUNGEON.arenaMinWaves : 1;
  const waves = Math.min(DUNGEON.maxWaves, Math.max(minWaves, Math.ceil(roster.length / DUNGEON.waveSize)));
  const out: EnemyKind[][] = Array.from({ length: waves }, () => []);
  // brutes lead the first wave; the rest is dealt round-robin
  roster.forEach((k, i) => out[k === 'brute' && i === 0 ? 0 : i % waves]!.push(k));
  return out.filter((w) => w.length > 0);
}

/** What the director must remember to carry on a floor later: which rooms are cleared and what has been seen. */
export interface DirectorSnapshot {
  states: RoomState[];
  revealedRooms: number[];
  revealedCorridors: number[];
  currentRoom: number | null;
}

/**
 * Runs one dungeon floor on top of the combat simulation: reveals rooms as the
 * hero explores, locks doors while a room's fight is on, spawns its waves,
 * pays out rewards, and opens the stairs once the floor's boss falls.
 */
export class DungeonDirector implements Director {
  readonly states: RoomState[];
  readonly revealedRooms: Uint8Array;
  readonly revealedCorridors: Uint8Array;
  currentRoom: number | null = null;
  /** Bumped whenever the revealed set changes (renderers redraw the minimap). */
  revealVersion = 0;
  private waves: EnemyKind[][] = [];
  /** The floor boss while it lives. */
  bossId: number | null = null;
  /** Objects that appeared under the hero: they arm only after the hero steps off. */
  private readonly needsLeave = new Set<number>();
  private waveT = 0;
  private refusedAt = -99;

  constructor(private readonly sim: Simulation, readonly dungeon: Dungeon) {
    this.states = dungeon.rooms.map((r) => (r.type === 'start' ? 'cleared' : 'unvisited'));
    this.revealedRooms = new Uint8Array(dungeon.rooms.length);
    this.revealedCorridors = new Uint8Array(dungeon.corridors.length);
    sim.depth = dungeon.depth;
    sim.setTraps(dungeon.traps);
    for (const o of dungeon.objects) sim.addObject(o.kind, o.x, o.y, o.roomId, o.kind !== 'stairs', o.loot ?? 'treasure');
    this.reveal(dungeon.startRoom);
    this.currentRoom = dungeon.startRoom;
  }

  snapshot(): DirectorSnapshot {
    const ids = (a: Uint8Array) => Array.from(a, (v, i) => (v ? i : -1)).filter((i) => i >= 0);
    return { states: [...this.states], revealedRooms: ids(this.revealedRooms), revealedCorridors: ids(this.revealedCorridors), currentRoom: this.currentRoom };
  }

  /** Applies a snapshot made at a calm moment: no room is mid-fight, every door is open. */
  restore(s: DirectorSnapshot): void {
    s.states.forEach((st, i) => {
      if (i < this.states.length) this.states[i] = st === 'active' ? 'unvisited' : st;
    });
    this.revealedRooms.fill(0);
    this.revealedCorridors.fill(0);
    for (const i of s.revealedRooms) if (i >= 0 && i < this.revealedRooms.length) this.revealedRooms[i] = 1;
    for (const i of s.revealedCorridors) if (i >= 0 && i < this.revealedCorridors.length) this.revealedCorridors[i] = 1;
    this.currentRoom = s.currentRoom;
    this.waves = [];
    this.bossId = null;
    this.needsLeave.clear();
    this.revealVersion++;
  }

  /** True when nothing is going on that a snapshot could not carry: no fight, no pending choice, no live enemy. */
  isCalm(): boolean {
    const sim = this.sim;
    return (
      sim.hero.state !== 'dead' &&
      this.activeRoom === null &&
      this.bossId === null &&
      this.waves.length === 0 &&
      sim.choices.length === 0 &&
      sim.livingEnemyCount() === 0 &&
      sim.projectiles.length === 0 &&
      sim.hazards.length === 0
    );
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
    if (this.bossId !== null) {
      const boss = this.sim.getEnemy(this.bossId);
      if (!boss || boss.state === 'dead') {
        this.bossId = null;
        this.sim.killMinions();
      }
    }
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
        this.sim.dropItem(o.loot, o.x, o.y);
        // treasure vaults and the end of a trial hall also offer an upgrade; an elite's chest holds items only
        if (o.loot === 'treasure' || this.dungeon.rooms[o.roomId]?.type === 'trial') this.sim.queueChoice('chest');
      } else if (o.kind === 'altar') {
        // a risky reward: it costs a share of your health, and will not kill you
        const cost = h.stats.maxHp * DUNGEON.altarCost;
        if (h.hp <= cost + 1) {
          if (this.sim.time - this.refusedAt > 2.5) {
            this.refusedAt = this.sim.time;
            this.sim.emit({ type: 'altarRefused', x: o.x, y: o.y });
          }
          continue;
        }
        o.used = true;
        h.hp -= cost;
        this.sim.emit({ type: 'altar', x: o.x, y: o.y, cost: Math.round(cost) });
        this.sim.dropItem('treasure', o.x, o.y);
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
    if (!FIGHT_ROOMS.has(room.type)) {
      this.states[room.id] = 'cleared';
      return;
    }
    this.states[room.id] = 'active';
    this.setDoors(room, false);
    if (room.type === 'exit') {
      // the boss rises in the middle of its lair
      this.waves = [];
      const p = this.sim.walkableNear(room.cx, room.cy);
      this.bossId = this.sim.spawnEnemy(biomeFor(this.dungeon.depth).boss, p.x, p.y).id;
      return;
    }
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
    if (room.type === 'arena') {
      this.sim.heal(this.sim.hero.stats.maxHp * DUNGEON.arenaHeal);
      if (this.sim.rng.chance(DUNGEON.arenaItemChance)) this.sim.dropItem('elite', room.cx, room.cy);
    }
    if (room.type === 'elite') {
      const p = this.sim.walkableNear(room.cx, room.cy);
      this.armAway(this.sim.addObject('chest', p.x, p.y, room.id, true, 'elite').id, p.x, p.y);
    }
    if (room.type === 'exit') {
      for (let i = 0; i < DROPS.bossItems; i++) this.sim.dropItem('boss', room.cx + (i - 0.5) * 1.2, room.cy + 1);
      this.sim.heal(this.sim.hero.stats.maxHp * 0.3);
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
