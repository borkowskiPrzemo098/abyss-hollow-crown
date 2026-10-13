import type { HeroId } from '../config/heroes';
import { SKILLS, SKILL_ORDER, SKILL_RULES, starterSkills, type HeroProgress, type SkillId, type UnlockReq } from '../config/skills';

/**
 * Which skills a hero may wear. Pure rules, no save or DOM: the save and the
 * menus both go through these so a locked or foreign skill can never be equipped.
 */
export type LoadoutError = 'unknown' | 'wrongClass' | 'locked' | 'duplicate' | 'full' | 'empty';

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, v);
}

export function meets(req: UnlockReq, p: HeroProgress): boolean {
  switch (req.type) {
    case 'start':
      return true;
    case 'runs':
      return p.runs >= req.n;
    case 'kills':
      return p.kills >= req.n;
    case 'floor':
      return p.bestFloor >= req.n;
    case 'wins':
      return p.wins >= req.n;
  }
}

export function isUnlocked(id: SkillId, p: HeroProgress): boolean {
  return meets(SKILLS[id].unlock, p);
}

/** The hero's unlocked skills, in display order. */
export function unlockedSkills(hero: HeroId, p: HeroProgress): SkillId[] {
  return SKILL_ORDER[hero].filter((id) => isUnlocked(id, p));
}

/** How far along a requirement is (for the menu: "23 / 60"). */
export function unlockProgress(req: UnlockReq, p: HeroProgress): { have: number; need: number } {
  switch (req.type) {
    case 'start':
      return { have: 1, need: 1 };
    case 'runs':
      return { have: Math.min(p.runs, req.n), need: req.n };
    case 'kills':
      return { have: Math.min(p.kills, req.n), need: req.n };
    case 'floor':
      return { have: Math.min(p.bestFloor, req.n), need: req.n };
    case 'wins':
      return { have: Math.min(p.wins, req.n), need: req.n };
  }
}

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

/** Polish requirement text shown on a locked skill. */
export function unlockText(req: UnlockReq): string {
  switch (req.type) {
    case 'start':
      return 'Dostępna od początku';
    case 'runs':
      return `Ukończ ${req.n} ${plural(req.n, 'wyprawę', 'wyprawy', 'wypraw')}`;
    case 'kills':
      return `Pokonaj ${req.n} ${plural(req.n, 'wroga', 'wrogów', 'wrogów')} tą klasą`;
    case 'floor':
      return `Dotrzyj do poziomu ${req.n}`;
    case 'wins':
      return req.n === 1 ? 'Wygraj wyprawę' : `Wygraj ${req.n} ${plural(req.n, 'wyprawę', 'wyprawy', 'wypraw')}`;
  }
}

/**
 * Checks a whole loadout: one to `maxSlots` distinct skills, all of the hero's
 * class and all unlocked. Returns the first problem, or null when it is valid.
 */
export function checkLoadout(hero: HeroId, ids: readonly unknown[], p: HeroProgress): LoadoutError | null {
  if (ids.length === 0) return 'empty';
  if (ids.length > SKILL_RULES.maxSlots) return 'full';
  const seen = new Set<unknown>();
  for (const id of ids) {
    if (!isSkillId(id)) return 'unknown';
    if (seen.has(id)) return 'duplicate';
    seen.add(id);
    if (SKILLS[id].hero !== hero) return 'wrongClass';
    if (!isUnlocked(id, p)) return 'locked';
  }
  return null;
}

/** Whether `id` could be added to `current` right now. */
export function canAdd(hero: HeroId, current: readonly SkillId[], id: SkillId, p: HeroProgress): LoadoutError | null {
  if (!isSkillId(id)) return 'unknown';
  if (current.includes(id)) return 'duplicate';
  if (SKILLS[id].hero !== hero) return 'wrongClass';
  if (!isUnlocked(id, p)) return 'locked';
  if (current.length >= SKILL_RULES.maxSlots) return 'full';
  return null;
}

/**
 * Repairs a loadout read from storage: drops anything unknown, foreign, locked
 * or repeated, trims to the slot limit, and falls back to the first starter.
 */
export function sanitizeLoadout(hero: HeroId, raw: unknown, p: HeroProgress): SkillId[] {
  const out: SkillId[] = [];
  if (Array.isArray(raw)) {
    for (const id of raw) if (out.length < SKILL_RULES.maxSlots && canAdd(hero, out, id as SkillId, p) === null) out.push(id as SkillId);
  }
  return out.length > 0 ? out : [starterSkills(hero)[0]!];
}

/** Skills that became available between two progress snapshots. */
export function newlyUnlocked(hero: HeroId, before: HeroProgress, after: HeroProgress): SkillId[] {
  return SKILL_ORDER[hero].filter((id) => !isUnlocked(id, before) && isUnlocked(id, after));
}
