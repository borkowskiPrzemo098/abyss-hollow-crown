/**
 * Tile map of a single room/arena. Pure data — no rendering.
 * Tile (tx, ty) covers the world rect [tx, tx+1) x [ty, ty+1).
 */
export const Tile = {
  Floor: 0,
  Wall: 1,
  Pillar: 2,
  Brazier: 3,
  /** A closed door. Opened doors are turned back into Floor. */
  Door: 4,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type DecorKind = 'rubble';

export interface Decor {
  kind: DecorKind;
  tx: number;
  ty: number;
}

export interface ArenaMap {
  /** Tile contents are mutable (doors open and close); the array itself is fixed. */
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly decor: readonly Decor[];
  readonly spawns: readonly { x: number; y: number }[];
  readonly heroStart: { x: number; y: number };
}

export function tileAt(map: ArenaMap, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return Tile.Wall;
  return map.tiles[ty * map.w + tx] as Tile;
}

export function blocksMove(t: Tile): boolean {
  return t !== Tile.Floor;
}

/** Braziers are waist-high: they stop bodies but not sight or attacks. */
export function blocksSight(t: Tile): boolean {
  return t === Tile.Wall || t === Tile.Pillar || t === Tile.Door;
}

export function isWalkable(map: ArenaMap, tx: number, ty: number): boolean {
  return !blocksMove(tileAt(map, tx, ty));
}

/**
 * Parses an ASCII layout.
 *  `#` wall · `P` pillar · `B` brazier · `.` floor · `x` floor + rubble
 *  `S` enemy spawn point · `H` hero start
 */
export function parseArena(rows: readonly string[]): ArenaMap {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h === 0 || w === 0) throw new Error('Arena layout is empty');
  const tiles = new Uint8Array(w * h);
  const decor: Decor[] = [];
  const spawns: { x: number; y: number }[] = [];
  let heroStart: { x: number; y: number } | null = null;

  rows.forEach((row, ty) => {
    if (row.length !== w) throw new Error(`Arena row ${ty} has length ${row.length}, expected ${w}`);
    for (let tx = 0; tx < w; tx++) {
      const c = row[tx];
      let t: Tile = Tile.Floor;
      switch (c) {
        case '#': t = Tile.Wall; break;
        case 'P': t = Tile.Pillar; break;
        case 'B': t = Tile.Brazier; break;
        case 'x': decor.push({ kind: 'rubble', tx, ty }); break;
        case 'S': spawns.push({ x: tx + 0.5, y: ty + 0.5 }); break;
        case 'H': heroStart = { x: tx + 0.5, y: ty + 0.5 }; break;
        case '.': break;
        default: throw new Error(`Unknown arena tile '${c}' at ${tx},${ty}`);
      }
      tiles[ty * w + tx] = t;
    }
  });
  if (!heroStart) throw new Error('Arena layout has no hero start (H)');
  if (spawns.length === 0) throw new Error('Arena layout has no spawn points (S)');
  return { w, h, tiles, decor, spawns, heroStart };
}

/** The Stage 1 test arena: the Ashen Antechamber. */
export const ANTECHAMBER_LAYOUT: readonly string[] = [
  '######################',
  '#....................#',
  '#.S......x.......S...#',
  '#....................#',
  '#...PP.........PP....#',
  '#...PP....##...PP....#',
  '#.........##.........#',
  '#.x..................#',
  '#.......B.....B......#',
  '#....................#',
  '#S........H.........S#',
  '#....................#',
  '#.......B.....B......#',
  '#..................x.#',
  '#....................#',
  '#...PP.........PP....#',
  '#...PP...#.....PP....#',
  '#........#...........#',
  '#....x...............#',
  '#.S..............S...#',
  '#....................#',
  '######################',
];
