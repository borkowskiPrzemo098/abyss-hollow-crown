import { biomeFor, type BiomeId, type TrapKind } from '../config/biomes';
import { DUNGEON } from '../config/dungeon';
import { Rng } from '../core/rng';
import { Tile, isWalkable, type ArenaMap, type Decor } from './arena';

export type RoomType = 'start' | 'combat' | 'elite' | 'treasure' | 'shrine' | 'exit';

export interface Room {
  id: number;
  type: RoomType;
  gx: number;
  gy: number;
  /** Interior bounds, inclusive tile coordinates. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Interior centre in world coordinates. */
  cx: number;
  cy: number;
  /** Door tiles on this room's wall ring (closed while the room's fight is on). */
  doors: { tx: number; ty: number }[];
  links: number[];
  spawns: { x: number; y: number }[];
  /** Graph distance from the start room. */
  depth: number;
}

export interface Corridor {
  a: number;
  b: number;
}

export type ObjectKind = 'chest' | 'shrine' | 'stairs';

export interface TrapTile {
  kind: TrapKind;
  tx: number;
  ty: number;
}

export interface Dungeon {
  map: ArenaMap;
  rooms: Room[];
  corridors: Corridor[];
  /** Per tile: room id (≥ 0, interior + wall ring), corridor −(index + 2), or −1 for solid rock. */
  region: Int16Array;
  startRoom: number;
  exitRoom: number;
  depth: number;
  seed: number;
  /** Where room objects go. Chests from elite rooms are added at runtime. */
  objects: { kind: ObjectKind; x: number; y: number; roomId: number }[];
  biome: BiomeId;
  /** Floor traps (the tiles stay walkable). */
  traps: TrapTile[];
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Generates one dungeon floor. Deterministic for a (seed, depth) pair.
 * Retries with derived seeds until the result passes validateDungeon(),
 * so callers always receive a connected, playable floor.
 */
export function generateDungeon(seed: number, depth: number): Dungeon {
  for (let attempt = 0; attempt < 32; attempt++) {
    const d = buildDungeon((seed + attempt * 7919) >>> 0, depth);
    if (validateDungeon(d).length === 0) return d;
  }
  throw new Error(`Could not generate a valid dungeon for seed ${seed}`);
}

function buildDungeon(seed: number, depth: number): Dungeon {
  const rng = new Rng(seed ^ (depth * 0x9e3779b1));
  const G = DUNGEON.grid;
  const C = DUNGEON.cell;
  const W = G * C;
  const tiles = new Uint8Array(W * W).fill(Tile.Wall);
  const region = new Int16Array(W * W).fill(-1);
  const want = DUNGEON.rooms[Math.min(depth, DUNGEON.rooms.length) - 1] ?? 8;

  // 1. grow a set of cells from a random start, remembering the tree links
  const cellRoom = new Int16Array(G * G).fill(-1);
  const cells: { gx: number; gy: number }[] = [];
  const links: [number, number][] = [];
  const sx = rng.int(0, G - 1);
  const sy = rng.int(0, G - 1);
  cellRoom[sy * G + sx] = 0;
  cells.push({ gx: sx, gy: sy });
  for (let guard = 0; cells.length < want && guard < 500; guard++) {
    const from = rng.int(0, cells.length - 1);
    const c = cells[from]!;
    const [dx, dy] = rng.pick(DIRS);
    const nx = c.gx + dx;
    const ny = c.gy + dy;
    if (nx < 0 || ny < 0 || nx >= G || ny >= G || cellRoom[ny * G + nx]! >= 0) continue;
    cellRoom[ny * G + nx] = cells.length;
    links.push([from, cells.length]);
    cells.push({ gx: nx, gy: ny });
  }
  // a few extra links between neighbouring rooms create loops
  const candidates: [number, number][] = [];
  cells.forEach((c, i) => {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const j = cellRoom[(c.gy + dy) * G + (c.gx + dx)];
      if (c.gx + dx >= G || c.gy + dy >= G || j === undefined || j < 0) continue;
      if (!links.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) candidates.push([i, j]);
    }
  });
  for (let k = 0; k < DUNGEON.extraLinks && candidates.length > 0; k++) {
    links.push(candidates.splice(rng.int(0, candidates.length - 1), 1)[0]!);
  }

  // the boss lair is the cell farthest from the start; it always gets the biggest room
  const cellDepth = new Int16Array(cells.length).fill(-1);
  cellDepth[0] = 0;
  const cq = [0];
  while (cq.length) {
    const i = cq.shift()!;
    for (const [a, b] of links) {
      const j = a === i ? b : b === i ? a : -1;
      if (j >= 0 && cellDepth[j]! < 0) {
        cellDepth[j] = cellDepth[i]! + 1;
        cq.push(j);
      }
    }
  }
  const deepest = Math.max(...cellDepth);
  const exitCell = rng.pick(cells.map((_, i) => i).filter((i) => cellDepth[i] === deepest && i !== 0));

  // 2. rooms: each interior contains its cell's core (rows/cols 6..9) so corridors always line up
  const rooms: Room[] = cells.map((c, id) => {
    const ox = c.gx * C;
    const oy = c.gy * C;
    const w = id === exitCell ? DUNGEON.roomMax : rng.int(DUNGEON.roomMin, DUNGEON.roomMax);
    const h = id === exitCell ? DUNGEON.roomMax : rng.int(DUNGEON.roomMin, DUNGEON.roomMax);
    const x0 = rng.int(Math.max(ox + 2, ox + 10 - w), Math.min(ox + 6, ox + 14 - w));
    const y0 = rng.int(Math.max(oy + 2, oy + 10 - h), Math.min(oy + 6, oy + 14 - h));
    return {
      id,
      type: 'combat' as RoomType,
      gx: c.gx,
      gy: c.gy,
      x0,
      y0,
      x1: x0 + w - 1,
      y1: y0 + h - 1,
      cx: x0 + w / 2,
      cy: y0 + h / 2,
      doors: [],
      links: [],
      spawns: [],
      depth: 0,
    };
  });
  for (const r of rooms) {
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++)
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        region[y * W + x] = r.id;
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) tiles[y * W + x] = Tile.Floor;
      }
  }

  // 3. corridors between linked rooms; the tiles where a corridor pierces a wall ring are doors
  const corridors: Corridor[] = [];
  const half = (DUNGEON.corridorWidth - 1) / 2;
  for (const [ai, bi] of links) {
    let a = rooms[ai]!;
    let b = rooms[bi]!;
    if (a.gx > b.gx || a.gy > b.gy) [a, b] = [b, a];
    a.links.push(b.id);
    b.links.push(a.id);
    const ci = corridors.length;
    corridors.push({ a: a.id, b: b.id });
    const horizontal = a.gy === b.gy;
    const core = (horizontal ? a.gy : a.gx) * C;
    const mid = rng.int(core + 6 + half, core + 9 - half);
    const from = horizontal ? a.x1 + 1 : a.y1 + 1;
    const to = horizontal ? b.x0 - 1 : b.y0 - 1;
    for (let s = from; s <= to; s++) {
      for (let o = -half; o <= half; o++) {
        const x = horizontal ? s : mid + o;
        const y = horizontal ? mid + o : s;
        tiles[y * W + x] = Tile.Floor;
        if (s === from) a.doors.push({ tx: x, ty: y });
        else if (s === to) b.doors.push({ tx: x, ty: y });
        else region[y * W + x] = -(ci + 2);
      }
    }
    // corridor side walls reveal together with the corridor
    for (let s = from + 1; s < to; s++) {
      for (const o of [-half - 1, half + 1]) {
        const x = horizontal ? s : mid + o;
        const y = horizontal ? mid + o : s;
        if (region[y * W + x] === -1) region[y * W + x] = -(ci + 2);
      }
    }
  }

  // 4. room roles from graph distance
  const start = rooms[0]!;
  const queue = [start.id];
  const seen = new Set([start.id]);
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of rooms[id]!.links) {
      if (seen.has(n)) continue;
      seen.add(n);
      rooms[n]!.depth = rooms[id]!.depth + 1;
      queue.push(n);
    }
  }
  start.type = 'start';
  const exit = rooms[exitCell]!;
  exit.type = 'exit';
  const free = () => rooms.filter((r) => r.type === 'combat');
  const leaves = free().filter((r) => r.links.length === 1);
  const treasure = leaves.length > 0 ? rng.pick(leaves) : rng.pick(free());
  treasure.type = 'treasure';
  const eliteCandidates = free().filter((r) => r.depth >= 2);
  if (eliteCandidates.length > 0 && free().length > 3) rng.pick(eliteCandidates).type = 'elite';
  if (free().length > 2) rng.pick(free()).type = 'shrine';

  // 5. furnishing: only inside x0+2..x1-2 so the interior's edge ring always connects every door
  const decor: Decor[] = [];
  const objects: Dungeon['objects'] = [];
  const set = (x: number, y: number, t: Tile) => {
    tiles[y * W + x] = t;
  };
  for (const r of rooms) {
    const cx = Math.floor(r.cx);
    const cy = Math.floor(r.cy);
    const corners = [
      [r.x0 + 2, r.y0 + 2],
      [r.x1 - 2, r.y0 + 2],
      [r.x0 + 2, r.y1 - 2],
      [r.x1 - 2, r.y1 - 2],
    ] as const;
    switch (r.type) {
      case 'start':
        set(corners[0][0], corners[0][1], Tile.Brazier);
        set(corners[3][0], corners[3][1], Tile.Brazier);
        break;
      case 'treasure':
        for (const [x, y] of corners) set(x, y, Tile.Brazier);
        objects.push({ kind: 'chest', x: r.cx, y: r.cy, roomId: r.id });
        break;
      case 'shrine':
        set(corners[1][0], corners[1][1], Tile.Brazier);
        set(corners[2][0], corners[2][1], Tile.Brazier);
        objects.push({ kind: 'shrine', x: r.cx, y: r.cy, roomId: r.id });
        break;
      case 'exit':
        for (const [x, y] of corners) set(x, y, Tile.Pillar);
        objects.push({ kind: 'stairs', x: r.cx, y: r.cy, roomId: r.id });
        break;
      default: {
        const style = rng.int(0, 3);
        if (style === 0) for (const [x, y] of corners) set(x, y, Tile.Pillar);
        else if (style === 1) {
          set(corners[0][0], corners[0][1], Tile.Brazier);
          set(corners[3][0], corners[3][1], Tile.Brazier);
          set(cx, cy, Tile.Pillar);
          set(cx - 1, cy, Tile.Pillar);
        } else if (style === 2) {
          // a broken wall segment across the middle
          const len = rng.int(2, 3);
          const vertical = rng.chance(0.5);
          for (let k = 0; k < len; k++) set(vertical ? cx : cx - 1 + k, vertical ? cy - 1 + k : cy, Tile.Pillar);
          set(corners[1][0], corners[1][1], Tile.Brazier);
        } else {
          set(corners[1][0], corners[1][1], Tile.Pillar);
          set(corners[2][0], corners[2][1], Tile.Pillar);
          set(corners[0][0], corners[0][1], Tile.Brazier);
        }
      }
    }
    for (let k = rng.int(1, 3); k > 0; k--) {
      const x = rng.int(r.x0 + 1, r.x1 - 1);
      const y = rng.int(r.y0 + 1, r.y1 - 1);
      if (tiles[y * W + x] === Tile.Floor) decor.push({ kind: 'rubble', tx: x, ty: y });
    }
  }

  // 6. traps, by biome, in fighting rooms; never on the edge ring so every door stays safely reachable
  const biome = biomeFor(depth);
  const traps: TrapTile[] = [];
  const trapAt = new Set<number>();
  for (const r of rooms) {
    if (r.type !== 'combat' && r.type !== 'elite') continue;
    for (const [kind, min, max] of biome.traps) {
      for (let n = rng.int(min, max); n > 0; n--) {
        const cx = rng.int(r.x0 + 2, r.x1 - 2);
        const cy = rng.int(r.y0 + 2, r.y1 - 2);
        const cells: [number, number][] =
          kind === 'vent' ? [[0, 0]] : kind === 'spikes' ? [[0, 0], [1, 0], [0, 1], [1, 1]] : kind === 'lava' ? [[0, 0], [1, 0], [2, 0], [1, 1], [-1, 1]] : [];
        if (kind === 'ice') for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (ox * ox + oy * oy <= 5 && rng.chance(0.8)) cells.push([ox, oy]);
        for (const [ox, oy] of cells) {
          const x = cx + ox;
          const y = cy + oy;
          if (x <= r.x0 || x >= r.x1 || y <= r.y0 || y >= r.y1) continue;
          const idx = y * W + x;
          if (tiles[idx] !== Tile.Floor || trapAt.has(idx)) continue;
          trapAt.add(idx);
          traps.push({ kind, tx: x, ty: y });
        }
      }
    }
  }

  // 7. spawn points: walkable interior tiles off the edge ring, spaced out
  for (const r of rooms) {
    for (let y = r.y0 + 1; y <= r.y1 - 1; y += 2)
      for (let x = r.x0 + 1; x <= r.x1 - 1; x += 2) if (tiles[y * W + x] === Tile.Floor) r.spawns.push({ x: x + 0.5, y: y + 0.5 });
  }

  const map: ArenaMap = {
    w: W,
    h: W,
    tiles,
    decor,
    spawns: rooms.flatMap((r) => r.spawns),
    heroStart: { x: start.cx, y: start.cy },
  };
  return { map, rooms, corridors, region, startRoom: start.id, exitRoom: exit.id, depth, seed, objects, biome: biome.id, traps };
}

/** Returns a list of problems; an empty list means the floor is playable. */
export function validateDungeon(d: Dungeon): string[] {
  const errors: string[] = [];
  const { map, rooms } = d;
  const W = map.w;
  for (let i = 0; i < W; i++) {
    for (const idx of [i, (W - 1) * W + i, i * W, i * W + W - 1])
      if (map.tiles[idx] !== Tile.Wall) errors.push(`border tile ${idx} is open`);
  }
  if (rooms.filter((r) => r.type === 'start').length !== 1) errors.push('need exactly one start room');
  if (rooms.filter((r) => r.type === 'exit').length !== 1) errors.push('need exactly one exit room');
  if (d.startRoom === d.exitRoom) errors.push('start and exit are the same room');

  // everything walkable must be reachable from the start (doors are open at generation time)
  const start = rooms[d.startRoom]!;
  const reach = new Uint8Array(W * W);
  const stack = [Math.floor(start.cy) * W + Math.floor(start.cx)];
  if (map.tiles[stack[0]!] !== Tile.Floor) errors.push('start centre is blocked');
  reach[stack[0]!] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % W;
    const y = (idx - x) / W;
    for (const [dx, dy] of DIRS) {
      const n = (y + dy) * W + (x + dx);
      if (!reach[n] && isWalkable(map, x + dx, y + dy)) {
        reach[n] = 1;
        stack.push(n);
      }
    }
  }
  for (let i = 0; i < W * W; i++) if (map.tiles[i] === Tile.Floor && !reach[i]) errors.push(`floor tile ${i % W},${Math.floor(i / W)} unreachable`);
  for (const r of rooms) {
    if (r.links.length === 0) errors.push(`room ${r.id} has no connections`);
    if (r.doors.length === 0) errors.push(`room ${r.id} has no doors`);
    for (const dr of r.doors) {
      const onRing = (dr.tx === r.x0 - 1 || dr.tx === r.x1 + 1 || dr.ty === r.y0 - 1 || dr.ty === r.y1 + 1) &&
        dr.tx >= r.x0 - 1 && dr.tx <= r.x1 + 1 && dr.ty >= r.y0 - 1 && dr.ty <= r.y1 + 1;
      if (!onRing) errors.push(`room ${r.id} door ${dr.tx},${dr.ty} is not on its wall ring`);
    }
    if (r.type !== 'start' && r.type !== 'treasure' && r.type !== 'shrine' && r.spawns.length < 4) errors.push(`room ${r.id} has too few spawns`);
    for (const s of r.spawns) if (!reach[Math.floor(s.y) * W + Math.floor(s.x)]) errors.push(`room ${r.id} spawn unreachable`);
  }
  for (const o of d.objects) if (!reach[Math.floor(o.y) * W + Math.floor(o.x)]) errors.push(`${o.kind} spot unreachable`);
  for (const t of d.traps) if (map.tiles[t.ty * W + t.tx] !== Tile.Floor) errors.push(`trap on a blocked tile ${t.tx},${t.ty}`);
  const exitRoom = rooms[d.exitRoom];
  if (exitRoom && exitRoom.x1 - exitRoom.x0 + 1 < DUNGEON.roomMax) errors.push('boss lair is not full size');
  return errors;
}

/** Room whose interior contains the point, or null (corridor / wall ring). */
export function roomAt(d: Dungeon, x: number, y: number, inset = 0): Room | null {
  for (const r of d.rooms) {
    if (x >= r.x0 + inset && x <= r.x1 + 1 - inset && y >= r.y0 + inset && y <= r.y1 + 1 - inset) return r;
  }
  return null;
}
