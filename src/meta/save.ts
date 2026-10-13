import { NO_RANKS, RANKS, type MetaRanks, type RankId } from '../config/progression';

/**
 * Persistent progress, stored in IndexedDB.
 *  - Versioned schema with migration.
 *  - Every successful write also refreshes a backup copy.
 *  - A failed or corrupted read never overwrites good data: the game keeps
 *    running on defaults and only replaces the save after an explicit choice.
 */
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  ash: number;
  ranks: MetaRanks;
  settings: { volume: number; muted: boolean };
  stats: { runs: number; wins: number; bestFloor: number; kills: number };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    ash: 0,
    ranks: { ...NO_RANKS },
    settings: { volume: 0.7, muted: false },
    stats: { runs: 0, wins: 0, bestFloor: 0, kills: 0 },
  };
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/**
 * Validates (and migrates) raw stored data. Returns null when the data is not
 * a usable save — the caller must then treat it as corrupted, not as empty.
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const version = num(r.version, 1, SAVE_VERSION);
  if (version === null) return null;
  const out = defaultSave();
  const ash = num(r.ash, 0, 1e9);
  if (ash === null) return null;
  out.ash = Math.floor(ash);
  const ranks = r.ranks as Record<string, unknown> | undefined;
  if (!ranks || typeof ranks !== 'object') return null;
  for (const id of Object.keys(RANKS) as RankId[]) {
    const v = ranks[id] === undefined ? 0 : num(ranks[id], 0, RANKS[id].costs.length);
    if (v === null) return null;
    out.ranks[id] = Math.floor(v);
  }
  const s = r.settings as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') {
    out.settings.volume = num(s.volume, 0, 1) ?? out.settings.volume;
    out.settings.muted = typeof s.muted === 'boolean' ? s.muted : out.settings.muted;
  }
  const st = r.stats as Record<string, unknown> | undefined;
  if (st && typeof st === 'object') {
    out.stats.runs = num(st.runs, 0, 1e9) ?? 0;
    out.stats.wins = num(st.wins, 0, 1e9) ?? 0;
    out.stats.bestFloor = num(st.bestFloor, 0, 1e6) ?? 0;
    out.stats.kills = num(st.kills, 0, 1e12) ?? 0;
  }
  return out;
}

/** Cost of the next rank, or null when maxed. */
export function nextRankCost(save: SaveData, id: RankId): number | null {
  return RANKS[id].costs[save.ranks[id]] ?? null;
}

/** Spends ash on a rank. Returns false (and changes nothing) when unaffordable or maxed. */
export function buyRank(save: SaveData, id: RankId): boolean {
  const cost = nextRankCost(save, id);
  if (cost === null || save.ash < cost) return false;
  save.ash -= cost;
  save.ranks[id] += 1;
  return true;
}

/** Banks a finished run into the save. */
export function bankRun(save: SaveData, run: { ash: number; won: boolean; floor: number; kills: number; keepFraction: number; bonus: number }): number {
  const gained = Math.floor(run.ash * (run.won ? 1 : run.keepFraction)) + (run.won ? run.bonus : 0);
  save.ash += gained;
  save.stats.runs += 1;
  if (run.won) save.stats.wins += 1;
  save.stats.bestFloor = Math.max(save.stats.bestFloor, run.floor);
  save.stats.kills += run.kills;
  return gained;
}

export type LoadResult = { status: 'ok' | 'new'; data: SaveData } | { status: 'corrupted' | 'unavailable'; data: SaveData };

const DB = 'abyss-hollow-crown';
const STORE = 'save';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
  });
}

function get(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('read failed'));
  });
}

function putBoth(db: IDBDatabase, data: SaveData): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(data, 'main');
    store.put(data, 'backup');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
  });
}

export class SaveStore {
  data: SaveData = defaultSave();
  status: LoadResult['status'] = 'new';
  private db: IDBDatabase | null = null;
  /** Writes are blocked while a corrupted save is waiting for the player's decision. */
  private writable = false;

  async load(): Promise<LoadResult> {
    try {
      this.db = await openDb();
    } catch {
      this.status = 'unavailable';
      return { status: 'unavailable', data: this.data };
    }
    try {
      const main = await get(this.db, 'main');
      if (main === undefined) {
        this.status = 'new';
        this.writable = true;
        return { status: 'new', data: this.data };
      }
      const parsed = parseSave(main) ?? parseSave(await get(this.db, 'backup'));
      if (parsed) {
        this.data = parsed;
        this.status = 'ok';
        this.writable = true;
        return { status: 'ok', data: parsed };
      }
      this.status = 'corrupted';
      return { status: 'corrupted', data: this.data };
    } catch {
      this.status = 'corrupted';
      return { status: 'corrupted', data: this.data };
    }
  }

  /** The player explicitly chose to start over after a corrupted save. */
  async resetCorrupted(): Promise<void> {
    this.data = defaultSave();
    this.writable = true;
    this.status = 'new';
    await this.save();
  }

  async save(): Promise<boolean> {
    if (!this.db || !this.writable) return false;
    try {
      await putBoth(this.db, this.data);
      return true;
    } catch {
      return false;
    }
  }
}
