import { biomeFor, type BiomeId, type TrapKind } from '../config/biomes';
import { DUNGEON, ENCOUNTER_STYLES, type EncounterStyle } from '../config/dungeon';
import type { DropSource } from '../config/items';
import { Rng } from '../core/rng';
import { Tile, isWalkable, type ArenaMap, type Decor } from './arena';

/**
 * start      – the entrance (cleared).
 * combat     – a fight.      arena – a big fight in a big hall.      elite – a hard fight with a chest after it.
 * treasure   – a chest.      shrine – heals once (a place to rest).
 * trial      – a hall full of traps and no enemies; on a side branch it holds a chest.
 * altar      – pay a share of your health for an upgrade (a risky reward).
 * exit       – the boss lair with the stairs.
 */
export type RoomType = 'start' | 'combat' | 'arena' | 'elite' | 'treasure' | 'shrine' | 'altar' | 'trial' | 'exit';

/** Rooms in which the director runs a fight. */
export const FIGHT_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>(['combat', 'arena', 'elite', 'exit']);

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
  /** On the way to the boss, or off a side branch (optional). */
  route: 'main' | 'branch';
  /** Index of the branch this room belongs to; −1 on the main route. */
  branch: number;
  /** How far along the floor (0 at the entrance, 1 at the boss); a branch shares its root's value. */
  progress: number;
  /** What kind of fight the room holds (only used by fighting rooms). */
  style: EncounterStyle;
  /** The furnishing pattern, for variety (and for tests). */
  layout: string;
}

export interface Corridor {
  a: number;
  b: number;
  /** A corridor of the main route (wide); branch corridors are narrow. */
  main: boolean;
}

export type ObjectKind = 'chest' | 'shrine' | 'stairs' | 'altar';

export interface TrapTile {
  kind: TrapKind;
  tx: number;
  ty: number;
}

export interface BranchInfo {
  /** The main-route room the branch leaves from. */
  root: number;
  /** Rooms in walking order; the last one holds the reward. */
  rooms: number[];
}

export interface Dungeon {
  map: ArenaMap;
  rooms: Room[];
  corridors: Corridor[];
  /** Per tile: room id (≥ 0, interior + wall ring), corridor −(index + 2), or −1 for solid rock. */
  region: Int16Array;
  startRoom: number;
  exitRoom: number;
  /** Room ids from the entrance to the boss lair: the way you must go. */
  mainRoute: number[];
  /** Optional side branches. */
  branches: BranchInfo[];
  depth: number;
  seed: number;
  /** Where room objects go. Chests from elite rooms are added at runtime. */
  objects: { kind: ObjectKind; x: number; y: number; roomId: number; loot?: DropSource }[];
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
    if (d && validateDungeon(d).length === 0) return d;
  }
  throw new Error(`Could not generate a valid dungeon for seed ${seed}`);
}

const pickByDepth = <T>(list: readonly T[], depth: number): T => list[Math.min(depth, list.length) - 1] ?? list[list.length - 1]!;

/** A self-avoiding walk of `length` cells on the grid, preferring to turn (so the route winds instead of running straight). */
function walkRoute(rng: Rng, G: number, length: number): { gx: number; gy: number }[] | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const occ = new Uint8Array(G * G);
    const path: { gx: number; gy: number }[] = [{ gx: rng.int(0, G - 1), gy: rng.int(0, G - 1) }];
    occ[path[0]!.gy * G + path[0]!.gx] = 1;
    let budget = 6000;
    const dfs = (last: number): boolean => {
      if (path.length === length) return true;
      if (--budget < 0) return false;
      const here = path[path.length - 1]!;
      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      // going straight on is the last choice most of the time
      if (last >= 0 && rng.chance(0.75)) order.sort((a, b) => (a === last ? 1 : 0) - (b === last ? 1 : 0));
      for (const di of order) {
        const [dx, dy] = DIRS[di]!;
        const nx = here.gx + dx;
        const ny = here.gy + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G || occ[ny * G + nx]) continue;
        occ[ny * G + nx] = 1;
        path.push({ gx: nx, gy: ny });
        if (dfs(di)) return true;
        path.pop();
        occ[ny * G + nx] = 0;
      }
      return false;
    };
    if (dfs(-1)) return path;
  }
  return null;
}

/** The kinds of the rooms between the entrance and the boss: fights with the odd breather, test of nerve and tougher fight. */
function routeBeats(n: number, rng: Rng): RoomType[] {
  const beats: RoomType[] = Array<RoomType>(n).fill('combat');
  const used = new Set<number>([n - 1]);
  // the last room before the boss is always a place to rest
  beats[n - 1] = 'shrine';
  const big = (t: RoomType | undefined) => t === 'arena' || t === 'elite';
  const place = (frac: number, type: RoomType) => {
    const want = Math.min(n - 2, Math.max(0, Math.round(frac * (n - 1)) + rng.int(-1, 1)));
    // the nearest free slot to the wanted one; two big fights never stand side by side
    for (const off of [0, 1, -1, 2, -2, 3, -3]) {
      const i = want + off;
      if (i < 0 || i > n - 2 || used.has(i)) continue;
      if (big(type) && (big(beats[i - 1]) || big(beats[i + 1]))) continue;
      used.add(i);
      beats[i] = type;
      return;
    }
  };
  place(0.14, 'trial');
  place(0.28, 'arena');
  place(0.42, 'shrine');
  place(0.58, 'elite');
  place(0.68, 'trial');
  place(0.8, 'arena');
  return beats;
}

/** What waits at the end of a side branch. */
function rewardKind(rng: Rng, first: boolean, shrines: number): RoomType {
  if (first) return 'treasure';
  const table: [RoomType, number][] = [
    ['treasure', 3],
    ['elite', 2.5],
    ['trial', 2],
    ['altar', 1.5],
    ['shrine', shrines >= 2 ? 0 : 1],
  ];
  let roll = rng.next() * table.reduce((a, [, w]) => a + w, 0);
  for (const [t, w] of table) {
    if (roll < w) return t;
    roll -= w;
  }
  return 'treasure';
}

function buildDungeon(seed: number, depth: number): Dungeon | null {
  const rng = new Rng(seed ^ (depth * 0x9e3779b1));
  const G = DUNGEON.grid;
  const C = DUNGEON.cell;
  const W = G * C;
  const tiles = new Uint8Array(W * W).fill(Tile.Wall);
  const region = new Int16Array(W * W).fill(-1);

  // 1. the main route: a winding walk of cells from the entrance to the boss lair
  const L = pickByDepth(DUNGEON.mainRooms, depth);
  const route = walkRoute(rng, G, L);
  if (!route) return null;
  const occ = new Uint8Array(G * G);
  for (const c of route) occ[c.gy * G + c.gx] = 1;

  // 2. side branches: short dead-end paths that start at a route room and end in a reward.
  // A branch of length n off route room i reaches depth i + n, which never passes the boss lair's depth L − 1.
  interface PlannedBranch {
    root: number;
    cells: { gx: number; gy: number }[];
  }
  const planned: PlannedBranch[] = [];
  const wanted = pickByDepth(DUNGEON.branches, depth);
  const roots = Array.from({ length: L - 2 }, (_, i) => i + 1);
  for (let i = roots.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [roots[i], roots[j]] = [roots[j]!, roots[i]!];
  }
  for (const root of roots) {
    if (planned.length >= wanted) break;
    const maxLen = Math.min(DUNGEON.branchLength[1], L - 1 - root);
    if (maxLen < DUNGEON.branchLength[0]) continue;
    const len = rng.int(DUNGEON.branchLength[0], maxLen);
    const cells: { gx: number; gy: number }[] = [];
    let cur = route[root]!;
    for (let k = 0; k < len; k++) {
      const free = DIRS.map(([dx, dy]) => ({ gx: cur.gx + dx, gy: cur.gy + dy })).filter((c) => c.gx >= 0 && c.gy >= 0 && c.gx < G && c.gy < G && !occ[c.gy * G + c.gx]);
      if (free.length === 0) break;
      cur = rng.pick(free);
      occ[cur.gy * G + cur.gx] = 1;
      cells.push(cur);
    }
    if (cells.length > 0) planned.push({ root, cells });
  }
  if (planned.length < Math.max(2, wanted - 2)) return null;

  // 3. room list: the route first (ids 0..L−1, entrance = 0, boss lair = L−1), then the branches
  const rooms: Room[] = [];
  const types: RoomType[] = [];
  const meta: { route: 'main' | 'branch'; branch: number; progress: number }[] = [];
  const cellsOf: { gx: number; gy: number }[] = [];
  const beats = routeBeats(L - 2, rng);
  route.forEach((c, i) => {
    cellsOf.push(c);
    types.push(i === 0 ? 'start' : i === L - 1 ? 'exit' : beats[i - 1]!);
    meta.push({ route: 'main', branch: -1, progress: i / (L - 1) });
  });
  const links: [number, number, boolean][] = route.slice(1).map((_, i) => [i, i + 1, true]);
  const branchInfo: BranchInfo[] = [];
  let shrines = types.filter((t) => t === 'shrine').length - 1; // the one before the boss is not a reward
  planned.forEach((b, bi) => {
    const ids: number[] = [];
    b.cells.forEach((c, k) => {
      const id = cellsOf.length;
      cellsOf.push(c);
      const last = k === b.cells.length - 1;
      const t = last ? rewardKind(rng, bi === 0, shrines) : 'combat';
      if (t === 'shrine') shrines++;
      types.push(t);
      meta.push({ route: 'branch', branch: bi, progress: b.root / (L - 1) });
      links.push([k === 0 ? b.root : id - 1, id, false]);
      ids.push(id);
    });
    branchInfo.push({ root: b.root, rooms: ids });
  });

  // 4. geometry. Every interior contains its cell's core band, so a corridor between neighbouring cells always lines up.
  for (let id = 0; id < cellsOf.length; id++) {
    const c = cellsOf[id]!;
    const t = types[id]!;
    const ox = c.gx * C;
    const oy = c.gy * C;
    const range: readonly number[] = t === 'exit' ? [DUNGEON.roomMax, DUNGEON.roomMax] : DUNGEON.sizes[t as keyof typeof DUNGEON.sizes];
    const w = rng.int(range[0]!, range[1]!);
    const h = t === 'exit' ? w : rng.int(range[0]!, range[1]!);
    const lo = (o: number, size: number) => Math.max(o + 2, o + DUNGEON.coreHi + 1 - size);
    const hi = (o: number, size: number) => Math.min(o + DUNGEON.coreLo, o + C - 1 - size);
    const x0 = rng.int(lo(ox, w), hi(ox, w));
    const y0 = rng.int(lo(oy, h), hi(oy, h));
    rooms.push({
      id,
      type: t,
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
      route: meta[id]!.route,
      branch: meta[id]!.branch,
      progress: meta[id]!.progress,
      style: 'standard',
      layout: 'plain',
    });
  }
  for (const r of rooms) {
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++)
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        region[y * W + x] = r.id;
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) tiles[y * W + x] = Tile.Floor;
      }
  }

  // 5. corridors between linked rooms; the tiles where a corridor pierces a wall ring are doors
  const corridors: Corridor[] = [];
  for (const [ai, bi, main] of links) {
    let a = rooms[ai]!;
    let b = rooms[bi]!;
    if (a.gx > b.gx || a.gy > b.gy) [a, b] = [b, a];
    a.links.push(b.id);
    b.links.push(a.id);
    const half = ((main ? DUNGEON.corridorWidth : DUNGEON.branchWidth) - 1) / 2;
    const ci = corridors.length;
    corridors.push({ a: a.id, b: b.id, main });
    const horizontal = a.gy === b.gy;
    const core = (horizontal ? a.gy : a.gx) * C;
    const mid = rng.int(core + DUNGEON.coreLo + half, core + DUNGEON.coreHi - half);
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

  // 6. depth in the room graph (a tree, so this is the walking distance in rooms)
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
  const exit = rooms[L - 1]!;

  // 7. how each fighting room fights: a style for the mix of enemies
  for (const r of rooms) {
    if (r.type === 'combat' || r.type === 'arena' || r.type === 'elite') {
      r.style = r.type === 'elite' ? 'brutes' : rng.pick(ENCOUNTER_STYLES);
    }
  }

  // 8. furnishing: only inside x0+2..x1-2 so the interior's edge ring always connects every door
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
    const braziers = (idx: number[]) => idx.forEach((i) => set(corners[i]![0], corners[i]![1], Tile.Brazier));
    switch (r.type) {
      case 'start':
        braziers([0, 3]);
        r.layout = 'braziers';
        break;
      case 'treasure':
        braziers([0, 1, 2, 3]);
        r.layout = 'vault';
        objects.push({ kind: 'chest', x: r.cx, y: r.cy, roomId: r.id });
        break;
      case 'shrine':
        braziers([1, 2]);
        r.layout = 'shrine';
        objects.push({ kind: 'shrine', x: r.cx, y: r.cy, roomId: r.id });
        break;
      case 'altar':
        braziers([0, 3]);
        r.layout = 'altar';
        objects.push({ kind: 'altar', x: r.cx, y: r.cy, roomId: r.id });
        break;
      case 'trial':
        braziers([0, 3]);
        r.layout = 'trial';
        // a trial on a side branch ends in a chest, a trial on the main route is only a test of footwork
        if (r.route === 'branch') objects.push({ kind: 'chest', x: r.cx, y: r.cy, roomId: r.id, loot: 'elite' });
        break;
      case 'exit':
        for (const [x, y] of corners) set(x, y, Tile.Pillar);
        r.layout = 'lair';
        objects.push({ kind: 'stairs', x: r.cx, y: r.cy, roomId: r.id });
        break;
      default: {
        const big = r.x1 - r.x0 >= 13 && r.y1 - r.y0 >= 13;
        const style = big ? rng.pick(['ring', 'columns', 'split', 'hall'] as const) : rng.pick(['pillars', 'braziers', 'wall', 'diagonal'] as const);
        r.layout = style;
        if (style === 'pillars') for (const [x, y] of corners) set(x, y, Tile.Pillar);
        else if (style === 'braziers') {
          braziers([0, 3]);
          set(cx, cy, Tile.Pillar);
          set(cx - 1, cy, Tile.Pillar);
        } else if (style === 'wall') {
          // a broken wall segment across the middle
          const len = rng.int(2, 3);
          const vertical = rng.chance(0.5);
          for (let k = 0; k < len; k++) set(vertical ? cx : cx - 1 + k, vertical ? cy - 1 + k : cy, Tile.Pillar);
          braziers([1]);
        } else if (style === 'diagonal') {
          set(corners[1][0], corners[1][1], Tile.Pillar);
          set(corners[2][0], corners[2][1], Tile.Pillar);
          braziers([0]);
        } else if (style === 'ring') {
          // a ring of pillars round the middle with a gap in the north and the south side
          for (let k = -2; k <= 2; k++) {
            for (const [x, y] of [
              [cx + k, cy - 2],
              [cx + k, cy + 2],
              [cx - 2, cy + k],
              [cx + 2, cy + k],
            ] as const) {
              if (x === cx && (y === cy - 2 || y === cy + 2)) continue;
              set(x, y, Tile.Pillar);
            }
          }
          braziers([0, 1, 2, 3]);
        } else if (style === 'columns') {
          // single pillars on a loose grid: cover to hide behind, never a wall
          for (let y = r.y0 + 3; y <= r.y1 - 3; y += 4) for (let x = r.x0 + 3; x <= r.x1 - 3; x += 4) set(x, y, Tile.Pillar);
        } else {
          // 'split' (a wall with two gaps down the middle) and 'hall' (rows of pillars) share the corner braziers
          braziers([0, 3]);
          if (style === 'split') {
            // a wall down the middle with a wide gap in the centre and room to pass at both ends
            for (let y = r.y0 + 4; y <= r.y1 - 4; y++) if (Math.abs(y - cy) > 1) set(cx, y, Tile.Pillar);
          } else {
            for (const y of [r.y0 + 4, r.y1 - 4]) for (let x = r.x0 + 3; x <= r.x1 - 3; x += 3) set(x, y, Tile.Pillar);
          }
        }
      }
    }
    for (let k = rng.int(1, 4); k > 0; k--) {
      const x = rng.int(r.x0 + 1, r.x1 - 1);
      const y = rng.int(r.y0 + 1, r.y1 - 1);
      if (tiles[y * W + x] === Tile.Floor) decor.push({ kind: 'rubble', tx: x, ty: y });
    }
  }

  // 9. traps, by biome: in fights, and — plenty — in the trial halls. Never on the edge ring, so every door stays reachable.
  const biome = biomeFor(depth);
  const traps: TrapTile[] = [];
  const trapAt = new Set<number>();
  for (const r of rooms) {
    if (r.type !== 'combat' && r.type !== 'elite' && r.type !== 'arena' && r.type !== 'trial') continue;
    const mult = r.type === 'trial' ? DUNGEON.trialTrapMult : r.type === 'arena' ? 1.5 : 1;
    for (const [kind, min, max] of biome.traps) {
      for (let n = Math.round(rng.int(min, max) * mult); n > 0; n--) {
        const cx = rng.int(r.x0 + 2, r.x1 - 2);
        const cy = rng.int(r.y0 + 2, r.y1 - 2);
        // keep the middle of a trial hall free for its chest
        if (r.type === 'trial' && Math.hypot(cx - r.cx, cy - r.cy) < 2.5) continue;
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

  // 10. spawn points: walkable interior tiles off the edge ring, spaced out
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
  return {
    map,
    rooms,
    corridors,
    region,
    startRoom: start.id,
    exitRoom: exit.id,
    mainRoute: Array.from({ length: L }, (_, i) => i),
    branches: branchInfo,
    depth,
    seed,
    objects,
    biome: biome.id,
    traps,
  };
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
    if (FIGHT_ROOMS.has(r.type) && r.spawns.length < 4) errors.push(`room ${r.id} has too few spawns`);
    for (const s of r.spawns) if (!reach[Math.floor(s.y) * W + Math.floor(s.x)]) errors.push(`room ${r.id} spawn unreachable`);
  }
  for (const o of d.objects) if (!reach[Math.floor(o.y) * W + Math.floor(o.x)]) errors.push(`${o.kind} spot unreachable`);
  for (const t of d.traps) if (map.tiles[t.ty * W + t.tx] !== Tile.Floor) errors.push(`trap on a blocked tile ${t.tx},${t.ty}`);
  const exitRoom = rooms[d.exitRoom];
  if (exitRoom && exitRoom.x1 - exitRoom.x0 + 1 < DUNGEON.roomMax) errors.push('boss lair is not full size');

  errors.push(...validateRoute(d));
  return errors;
}

/**
 * The shape of the floor: one main route from the entrance to the boss lair, optional branches that
 * only lead to rewards, no loops, and nothing mandatory behind a branch.
 */
export function validateRoute(d: Dungeon): string[] {
  const errors: string[] = [];
  const { rooms, mainRoute } = d;
  if (mainRoute.length < 3) errors.push('main route is too short');
  if (mainRoute[0] !== d.startRoom) errors.push('main route does not begin at the entrance');
  if (mainRoute[mainRoute.length - 1] !== d.exitRoom) errors.push('main route does not end at the boss lair');
  if (new Set(mainRoute).size !== mainRoute.length) errors.push('main route visits a room twice');
  for (let i = 0; i + 1 < mainRoute.length; i++) {
    if (!rooms[mainRoute[i]!]?.links.includes(mainRoute[i + 1]!)) errors.push(`main route rooms ${mainRoute[i]} and ${mainRoute[i + 1]} are not linked`);
  }
  const onRoute = new Set(mainRoute);
  for (const r of rooms) if ((r.route === 'main') !== onRoute.has(r.id)) errors.push(`room ${r.id} is labelled ${r.route} but is ${onRoute.has(r.id) ? '' : 'not '}on the route`);
  // a tree: one link fewer than rooms, so there is exactly one way to every room and none of them loops back
  if (d.corridors.length !== rooms.length - 1) errors.push(`floor has loops or islands (${d.corridors.length} corridors for ${rooms.length} rooms)`);

  // the exit must be reachable through main-route rooms alone
  const seen = new Set<number>([d.startRoom]);
  const queue = [d.startRoom];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of rooms[id]!.links) if (!seen.has(n) && onRoute.has(n)) (seen.add(n), queue.push(n));
  }
  if (!seen.has(d.exitRoom)) errors.push('the exit cannot be reached without entering a side branch');

  // branches: leave the route, are paths, end in a reward, never reach past the boss in depth
  const exitDepth = rooms[d.exitRoom]?.depth ?? 0;
  const branchRooms = new Set<number>();
  d.branches.forEach((b, bi) => {
    if (!onRoute.has(b.root) || b.root === d.startRoom || b.root === d.exitRoom) errors.push(`branch ${bi} does not start in a route room`);
    let prev = b.root;
    for (const id of b.rooms) {
      const r = rooms[id];
      if (!r) {
        errors.push(`branch ${bi} names a missing room`);
        continue;
      }
      if (onRoute.has(id) || branchRooms.has(id)) errors.push(`branch ${bi} room ${id} is shared`);
      branchRooms.add(id);
      if (r.route !== 'branch' || r.branch !== bi) errors.push(`branch ${bi} room ${id} is mislabelled`);
      if (!rooms[prev]!.links.includes(id)) errors.push(`branch ${bi} is not a connected path at room ${id}`);
      if (r.depth > exitDepth) errors.push(`branch ${bi} room ${id} lies deeper than the boss lair`);
      prev = id;
    }
    const end = rooms[b.rooms[b.rooms.length - 1]!];
    if (!end || !['treasure', 'elite', 'shrine', 'trial', 'altar'].includes(end.type)) errors.push(`branch ${bi} ends in a ${end?.type ?? 'nothing'}, not a reward`);
    if (end && end.links.length !== 1) errors.push(`branch ${bi} does not end in a dead end`);
  });
  for (const r of rooms) if (r.route === 'branch' && !branchRooms.has(r.id)) errors.push(`room ${r.id} belongs to no branch`);
  const lo = d.depth ? DUNGEON.mainRooms[Math.min(d.depth, DUNGEON.mainRooms.length) - 1]! : 0;
  if (lo && mainRoute.length !== lo) errors.push(`main route has ${mainRoute.length} rooms, expected ${lo}`);
  return errors;
}

/** Room whose interior contains the point, or null (corridor / wall ring). */
export function roomAt(d: Dungeon, x: number, y: number, inset = 0): Room | null {
  for (const r of d.rooms) {
    if (x >= r.x0 + inset && x <= r.x1 + 1 - inset && y >= r.y0 + inset && y <= r.y1 + 1 - inset) return r;
  }
  return null;
}
