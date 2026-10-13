import type { HeroId } from '../config/heroes';
import { BASES, DROPS, SLOTS, type Item, type Slot } from '../config/items';
import { NO_RANKS, RANKS, type MetaRanks, type RankId } from '../config/progression';
import { isSkillUpgradeId } from '../config/skillUpgrades';
import { NO_PROGRESS, type HeroProgress, type SkillId } from '../config/skills';
import { isItem, salvageValue } from '../sim/loot';
import { canAdd, newlyUnlocked, sanitizeLoadout, type LoadoutError } from './loadout';

/**
 * Persistent progress, stored in IndexedDB.
 *  - Versioned schema with migration.
 *  - Every successful write also refreshes a backup copy.
 *  - A failed or corrupted read never overwrites good data: the game keeps
 *    running on defaults and only replaces the save after an explicit choice.
 */
export const SAVE_VERSION = 4;

export type Loadout = Record<Slot, string | null>;

export interface SaveData {
  version: number;
  ash: number;
  ranks: MetaRanks;
  settings: { volume: number; muted: boolean };
  stats: { runs: number; wins: number; bestFloor: number; kills: number };
  /** Every item owned (equipped ones included), and what each hero wears. */
  inventory: { items: Item[]; equipped: Record<HeroId, Loadout> };
  /** Lasting progress of each class; it unlocks skills. */
  progress: Record<HeroId, HeroProgress>;
  /** Skills each class wears into a run (1–3, all unlocked and of that class). */
  loadout: Record<HeroId, SkillId[]>;
  /**
   * Skill upgrades found at least once, in any run. Upgrades themselves belong to a run (like the stat upgrades,
   * which are not saved either); this list only remembers which ones the player has seen.
   */
  codex: string[];
}

const emptyLoadout = (): Loadout => ({ weapon: null, helmet: null, armor: null, amulet: null, ring: null });

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    ash: 0,
    ranks: { ...NO_RANKS },
    settings: { volume: 0.7, muted: false },
    stats: { runs: 0, wins: 0, bestFloor: 0, kills: 0 },
    inventory: { items: [], equipped: { warden: emptyLoadout(), wanderer: emptyLoadout() } },
    progress: { warden: { ...NO_PROGRESS }, wanderer: { ...NO_PROGRESS } },
    loadout: { warden: sanitizeLoadout('warden', [], NO_PROGRESS), wanderer: sanitizeLoadout('wanderer', [], NO_PROGRESS) },
    codex: [],
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
  // v1 saves have no inventory: they migrate to an empty one
  const inv = r.inventory as { items?: unknown; equipped?: Record<string, Record<string, unknown>> } | undefined;
  if (version >= 2) {
    if (!inv || !Array.isArray(inv.items)) return null;
    for (const it of inv.items) if (isItem(it)) out.inventory.items.push(it);
    const owned = new Set(out.inventory.items.map((i) => i.uid));
    for (const hero of ['warden', 'wanderer'] as const) {
      const src = inv.equipped?.[hero];
      for (const slot of SLOTS) {
        const uid = src?.[slot];
        out.inventory.equipped[hero][slot] = typeof uid === 'string' && owned.has(uid) ? uid : null;
      }
    }
  }
  // v3: per-class progress and skill loadout. Older saves start from zero progress and the starter skill.
  const prog = r.progress as Record<string, Record<string, unknown> | undefined> | undefined;
  for (const hero of ['warden', 'wanderer'] as const) {
    const src = prog && typeof prog === 'object' ? prog[hero] : undefined;
    if (src && typeof src === 'object') {
      out.progress[hero] = {
        runs: Math.floor(num(src.runs, 0, 1e9) ?? 0),
        kills: Math.floor(num(src.kills, 0, 1e12) ?? 0),
        bestFloor: Math.floor(num(src.bestFloor, 0, 1e6) ?? 0),
        wins: Math.floor(num(src.wins, 0, 1e9) ?? 0),
      };
    }
    const lo = (r.loadout as Record<string, unknown> | undefined)?.[hero];
    out.loadout[hero] = sanitizeLoadout(hero, lo, out.progress[hero]);
  }
  // v4: the codex. Anything unknown or repeated is dropped; older saves start with an empty one.
  if (Array.isArray(r.codex)) out.codex = [...new Set(r.codex.filter(isSkillUpgradeId))];
  return out;
}

/** Skills a hero wears into the next run. */
export function skillLoadout(save: SaveData, hero: HeroId): SkillId[] {
  return [...save.loadout[hero]];
}

/** Puts a skill into the hero's next free slot. Refuses locked, foreign, repeated or a fourth skill. */
export function equipSkill(save: SaveData, hero: HeroId, id: SkillId): LoadoutError | null {
  const err = canAdd(hero, save.loadout[hero], id, save.progress[hero]);
  if (err) return err;
  save.loadout[hero].push(id);
  return null;
}

/** Takes a skill off. The last remaining skill stays: a run needs at least one. */
export function unequipSkill(save: SaveData, hero: HeroId, id: SkillId): 'last' | null {
  const cur = save.loadout[hero];
  if (!cur.includes(id)) return null;
  if (cur.length <= 1) return 'last';
  save.loadout[hero] = cur.filter((s) => s !== id);
  return null;
}

/** Items a hero currently wears. */
export function equippedItems(save: SaveData, hero: HeroId): Item[] {
  const lo = save.inventory.equipped[hero];
  return SLOTS.map((s) => save.inventory.items.find((i) => i.uid === lo[s])).filter((i): i is Item => !!i);
}

/** Owned items not worn by anyone. */
export function bagItems(save: SaveData): Item[] {
  const worn = new Set(Object.values(save.inventory.equipped).flatMap((lo) => Object.values(lo)));
  return save.inventory.items.filter((i) => !worn.has(i.uid));
}

export function canEquip(item: Item, hero: HeroId): boolean {
  const b = BASES[item.base];
  return !!b && (!b.hero || b.hero === hero);
}

/** Puts an item on (replacing whatever was in the slot). */
export function equip(save: SaveData, hero: HeroId, uid: string): boolean {
  const item = save.inventory.items.find((i) => i.uid === uid);
  if (!item || !canEquip(item, hero)) return false;
  const slot = BASES[item.base]!.slot;
  // an item can only be worn by one hero at a time
  for (const lo of Object.values(save.inventory.equipped)) for (const s of SLOTS) if (lo[s] === uid) lo[s] = null;
  save.inventory.equipped[hero][slot] = uid;
  return true;
}

export function unequip(save: SaveData, hero: HeroId, slot: Slot): void {
  save.inventory.equipped[hero][slot] = null;
}

/**
 * Adds a found item. If the hero has nothing in that slot it is put on straight away.
 * With a full bag the item is broken down into ash instead (returns the ash gained).
 */
export function addItem(save: SaveData, item: Item, hero: HeroId): { equipped: boolean; salvaged: number } {
  if (bagItems(save).length >= DROPS.bagSize) {
    const ash = salvageValue(item);
    save.ash += ash;
    return { equipped: false, salvaged: ash };
  }
  save.inventory.items.push(item);
  const slot = BASES[item.base]!.slot;
  if (canEquip(item, hero) && !save.inventory.equipped[hero][slot]) {
    equip(save, hero, item.uid);
    return { equipped: true, salvaged: 0 };
  }
  return { equipped: false, salvaged: 0 };
}

/** Breaks an unworn item down into ash. */
export function salvage(save: SaveData, uid: string): number {
  if (!bagItems(save).some((i) => i.uid === uid)) return 0;
  const item = save.inventory.items.find((i) => i.uid === uid)!;
  save.inventory.items = save.inventory.items.filter((i) => i.uid !== uid);
  const ash = salvageValue(item);
  save.ash += ash;
  return ash;
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
export function bankRun(
  save: SaveData,
  run: { hero: HeroId; ash: number; won: boolean; floor: number; kills: number; keepFraction: number; bonus: number; skillUpgrades?: readonly string[] },
): { gained: number; unlocked: SkillId[] } {
  const before = { ...save.progress[run.hero] };
  const gained = Math.floor(run.ash * (run.won ? 1 : run.keepFraction)) + (run.won ? run.bonus : 0);
  save.ash += gained;
  save.stats.runs += 1;
  if (run.won) save.stats.wins += 1;
  save.stats.bestFloor = Math.max(save.stats.bestFloor, run.floor);
  save.stats.kills += run.kills;
  const p = save.progress[run.hero];
  p.runs += 1;
  p.kills += run.kills;
  p.bestFloor = Math.max(p.bestFloor, run.floor);
  if (run.won) p.wins += 1;
  for (const id of run.skillUpgrades ?? []) if (isSkillUpgradeId(id) && !save.codex.includes(id)) save.codex.push(id);
  return { gained, unlocked: newlyUnlocked(run.hero, before, p) };
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
