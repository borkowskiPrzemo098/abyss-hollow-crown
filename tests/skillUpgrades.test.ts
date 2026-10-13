import { describe, expect, it } from 'vitest';
import type { HeroId } from '../src/config/heroes';
import {
  MOD_CAPS,
  MOD_KEYS,
  SKILL_UPGRADES,
  SKILL_UPGRADE_LIST,
  SKILL_UPGRADE_RULES,
  ZERO_MODS,
  describeStep,
  isSkillUpgradeId,
  maxLevel,
  resolveMods,
  upgradesOf,
  validateSkillUpgradeData,
  type SkillUpgradeDef,
} from '../src/config/skillUpgrades';
import { SKILLS, SKILL_ORDER, type SkillId } from '../src/config/skills';
import { SAVE_VERSION, bankRun, defaultSave, parseSave } from '../src/meta/save';
import type { Enemy, SimEvent } from '../src/sim/types';
import { UPGRADES } from '../src/config/upgrades';
import { openRoom, run, sandbox } from './helpers';

const ALL_SKILLS = Object.keys(SKILLS) as SkillId[];
const heroOf = (s: SkillId): HeroId => SKILLS[s].hero;
const up = (skill: SkillId, name: string) => SKILL_UPGRADES[`${skill}.${name}`]!;

// ───────────────────────────── helpers ─────────────────────────────

type Sim = ReturnType<typeof sandbox>;

/** A hero with one skill, no crits, no auto-attack (so only the skill under test deals damage) and the given upgrade levels. */
function lab(skill: SkillId, levels: Record<string, number> = {}, extra: SkillId[] = []): Sim {
  const sim = sandbox(openRoom(), { hero: heroOf(skill), skills: [skill, ...extra], seed: 5 });
  sim.hero.stats.critChance = 0;
  sim.hero.stats.attackRange = 0;
  sim.setSkillUpgrades(levels);
  return sim;
}

/** An enemy that stands still and cannot fight back. */
function dummy(sim: Sim, kind: 'thrall' | 'brute', dx: number, dy = 0): Enemy {
  const e = sim.spawnEnemy(kind, sim.hero.x + dx, sim.hero.y + dy, { instant: true });
  e.state = 'stunned';
  e.stateT = e.stateDur = 999;
  return e;
}

const at = (skill: SkillId, name: string, level: number): Record<string, number> => ({ [`${skill}.${name}`]: level });
const maxed = (skill: SkillId): Record<string, number> => Object.fromEntries(upgradesOf(skill).map((u) => [u.id, maxLevel(u)]));
const dmg = (ev: SimEvent[], source?: string) => ev.filter((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage' && (!source || e.source === source));
const dmgTo = (ev: SimEvent[], e: Enemy, source?: string) => dmg(ev, source).filter((x) => x.targetId === e.id);

// ───────────────────────────── the tables ─────────────────────────────

describe('skill upgrade data', () => {
  it('passes its own validation', () => {
    expect(validateSkillUpgradeData(ALL_SKILLS)).toEqual([]);
  });

  it('gives every one of the twenty skills at least two upgrades of its own', () => {
    for (const s of ALL_SKILLS) expect(upgradesOf(s).length, s).toBeGreaterThanOrEqual(2);
    for (const hero of ['warden', 'wanderer'] as HeroId[]) for (const s of SKILL_ORDER[hero]) expect(upgradesOf(s).every((u) => u.skill === s)).toBe(true);
    expect(SKILL_UPGRADE_LIST.length).toBeGreaterThanOrEqual(60);
  });

  it('keeps ids unique and never mixes with the general stat upgrades', () => {
    expect(new Set(SKILL_UPGRADE_LIST.map((u) => u.id)).size).toBe(SKILL_UPGRADE_LIST.length);
    for (const u of SKILL_UPGRADE_LIST) expect(u.id in UPGRADES).toBe(false);
    expect(isSkillUpgradeId('sunder.wide')).toBe(true);
    expect(isSkillUpgradeId('power')).toBe(false);
    expect(isSkillUpgradeId('toString')).toBe(false);
    expect(isSkillUpgradeId(42)).toBe(false);
  });

  it('offers different kinds of change, not just numbers', () => {
    const kinds = new Set<string>();
    for (const u of SKILL_UPGRADE_LIST) for (const lv of u.levels) for (const k of Object.keys(lv)) kinds.add(k);
    for (const k of ['projectiles', 'pierce', 'blast', 'ground', 'ignite', 'chill', 'echo', 'finale', 'retaliate', 'refund', 'execute', 'control', 'cooldown']) expect(kinds.has(k), k).toBe(true);
  });

  it('is able to catch a broken table', () => {
    const list = SKILL_UPGRADE_LIST as SkillUpgradeDef[];
    const add = (u: SkillUpgradeDef) => {
      list.push(u);
      try {
        return validateSkillUpgradeData(ALL_SKILLS);
      } finally {
        list.pop();
      }
    };
    expect(add({ id: 'sunder.wide', skill: 'sunder', name: 'x', summary: 'x', levels: [{ radius: 0.1 }] }).some((p) => p.includes('duplicate'))).toBe(true);
    expect(add({ id: 'sunder.zzz', skill: 'sunder', name: 'x', summary: 'x', levels: [{ radius: 5 }] }).some((p) => p.includes('cap'))).toBe(true);
    expect(add({ id: 'sunder.zzz', skill: 'sunder', name: 'x', summary: 'x', levels: [{ radius: 0.2 }, { radius: 0.1 }] }).some((p) => p.includes('weaker'))).toBe(true);
    expect(add({ id: 'sunder.zzz', skill: 'sunder', name: 'x', summary: 'x', levels: [] }).some((p) => p.includes('1–3 levels'))).toBe(true);
    expect(add({ id: 'nope.zzz', skill: 'nope' as SkillId, name: 'x', summary: 'x', levels: [{ radius: 0.1 }] }).some((p) => p.includes('unknown skill'))).toBe(true);
    expect(add({ id: 'sunder.zzz', skill: 'sunder', name: 'x', summary: 'x', levels: [{ bogus: 1 } as never] }).some((p) => p.includes('unknown modifier'))).toBe(true);
    expect(validateSkillUpgradeData(ALL_SKILLS)).toEqual([]);
  });

  it('describes every level in words, with the numbers taken from the table', () => {
    for (const u of SKILL_UPGRADE_LIST) {
      for (let lv = 1; lv <= maxLevel(u); lv++) {
        const lines = describeStep(u, lv - 1, lv);
        expect(lines.length, u.id).toBe(Object.keys(u.levels[lv - 1]!).length);
        for (const l of lines) {
          expect(l.name.length).toBeGreaterThan(2);
          expect(l.value).toMatch(/\d/);
          if (lv > 1) expect(l.from, `${u.id} level ${lv}`).toBeTruthy();
        }
      }
    }
    // a spot check of the printed numbers
    expect(describeStep(up('sunder', 'wide'), 0, 1)[0]).toEqual({ name: 'Obszar', value: '+20%', from: undefined });
    expect(describeStep(up('sunder', 'wide'), 1, 2)[0]).toEqual({ name: 'Obszar', value: '+40%', from: '+20%' });
    expect(describeStep(up('volley', 'more'), 0, 1)[0]!.name).toBe('Dodatkowe odłamki');
  });
});

// ───────────────────────────── summing and limits ─────────────────────────────

describe('stacking and limits', () => {
  it('has no effect at all without upgrades', () => {
    for (const s of ALL_SKILLS) expect(resolveMods(s, {})).toEqual(ZERO_MODS);
  });

  it('uses the level table, so a second level replaces the first instead of piling on top', () => {
    expect(resolveMods('sunder', at('sunder', 'wide', 1)).radius).toBeCloseTo(0.2, 9);
    expect(resolveMods('sunder', at('sunder', 'wide', 2)).radius).toBeCloseTo(0.4, 9);
  });

  it('never goes past the last level, however many are claimed', () => {
    expect(resolveMods('volley', at('volley', 'more', 99)).projectiles).toBe(4);
    expect(resolveMods('volley', at('volley', 'more', -3)).projectiles).toBe(0);
    expect(resolveMods('volley', at('volley', 'more', 1.9)).projectiles).toBe(2);
    expect(resolveMods('volley', at('volley', 'more', Number.NaN)).projectiles).toBe(0);
  });

  it('ignores upgrades of other skills and unknown ids', () => {
    expect(resolveMods('sunder', { 'volley.more': 2, 'nope.x': 3, __proto__: 1 } as never)).toEqual(ZERO_MODS);
  });

  it('adds up different upgrades of one skill', () => {
    const m = resolveMods('sunder', { ...at('sunder', 'wide', 2), ...at('sunder', 'rush', 1), ...at('sunder', 'embers', 1) });
    expect(m.radius).toBeCloseTo(0.4, 9);
    expect(m.cooldown).toBeCloseTo(0.3, 9);
    expect(m.damage).toBeCloseTo(-0.2, 9);
    expect(m.ground).toBeCloseTo(0.3, 9);
  });

  it('keeps every modifier of every skill inside its cap even with everything taken', () => {
    for (const s of ALL_SKILLS) {
      const m = resolveMods(s, maxed(s));
      for (const k of MOD_KEYS) {
        expect(m[k], `${s}.${k}`).toBeLessThanOrEqual(MOD_CAPS[k][1] + 1e-9);
        expect(m[k], `${s}.${k}`).toBeGreaterThanOrEqual(MOD_CAPS[k][0] - 1e-9);
      }
    }
  });

  it('clamps a sum that would be too large', () => {
    const list = SKILL_UPGRADE_LIST as SkillUpgradeDef[];
    list.push({ id: 'sunder.t1', skill: 'sunder', name: 'x', summary: 'x', levels: [{ radius: 0.9 }] }, { id: 'sunder.t2', skill: 'sunder', name: 'x', summary: 'x', levels: [{ radius: 0.9 }] });
    try {
      expect(resolveMods('sunder', { 'sunder.t1': 1, 'sunder.t2': 1 }).radius).toBe(MOD_CAPS.radius[1]);
    } finally {
      list.length -= 2;
    }
  });

  it('never lets a cooldown fall below the floor, whatever else shortens it', () => {
    const sim = lab('starfall', at('starfall', 'quick', 1));
    sim.hero.stats.skillCooldownMult = 0.3;
    expect(sim.skillCooldown(SKILLS.starfall)).toBeCloseTo(SKILLS.starfall.cooldown * SKILL_UPGRADE_RULES.minCooldownShare, 9);
    const plain = lab('starfall');
    expect(plain.skillCooldown(SKILLS.starfall)).toBe(SKILLS.starfall.cooldown);
    const quick = lab('starfall', at('starfall', 'quick', 1));
    expect(quick.skillCooldown(SKILLS.starfall)).toBeCloseTo(SKILLS.starfall.cooldown * 0.75, 9);
  });

  it('refuses bad input when levels are set on the hero', () => {
    const sim = lab('sunder');
    sim.setSkillUpgrades({ 'sunder.wide': 9, 'volley.more': 1, bogus: 2, 'sunder.rush': -4, 'sunder.embers': Number.NaN });
    // 'volley.more' is a real upgrade of another skill: it is kept on the hero but has no effect on a Rozłam
    expect(sim.hero.skillUpgrades['sunder.wide']).toBe(2);
    expect(sim.mods('sunder').projectiles).toBe(0);
    expect('bogus' in sim.hero.skillUpgrades).toBe(false);
    expect('sunder.rush' in sim.hero.skillUpgrades).toBe(false);
  });
});

// ───────────────────────────── offers ─────────────────────────────

describe('how upgrades are offered', () => {
  const offer = (sim: Sim, source: 'level' | 'chest') => {
    sim.queueChoice(source);
    return sim.choices[sim.choices.length - 1]!.options;
  };
  const isSkill = (id: string) => isSkillUpgradeId(id);

  it('puts one skill upgrade among the cards on a level-up and two in a chest, never more than three cards', () => {
    const sim = sandbox(openRoom(), { hero: 'warden', skills: ['sunder', 'charge', 'crush'] });
    const level = offer(sim, 'level');
    expect(level.length).toBe(3);
    expect(level.filter(isSkill).length).toBe(1);
    const chest = offer(sim, 'chest');
    expect(chest.length).toBe(3);
    expect(chest.filter(isSkill).length).toBe(2);
    expect(new Set(chest).size).toBe(3);
  });

  it('offers only upgrades of skills that are worn, and prefers different skills', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer', skills: ['volley', 'seal', 'blink'] });
    for (let i = 0; i < 30; i++) {
      const chest = offer(sim, 'chest').filter(isSkill);
      for (const id of chest) expect(['volley', 'seal', 'blink']).toContain(SKILL_UPGRADES[id]!.skill);
      expect(new Set(chest.map((id) => SKILL_UPGRADES[id]!.skill)).size).toBe(chest.length);
      sim.choices.length = 0;
    }
  });

  it('keeps the stat cards first and untouched by the skill cards', () => {
    const a = sandbox(openRoom(), { hero: 'warden', skills: ['sunder'], seed: 11 });
    const b = sandbox(openRoom(), { hero: 'warden', skills: ['sunder'], seed: 11 });
    b.setSkillUpgrades(maxed('sunder')); // nothing left to offer for the skill
    for (let i = 0; i < 12; i++) {
      const x = offer(a, 'level');
      const y = offer(b, 'level');
      expect(y.filter(isSkill).length).toBe(0);
      expect(y.length).toBe(3);
      // the same two stat cards come first either way
      expect(x.slice(0, 2)).toEqual(y.slice(0, 2));
      expect(isSkill(x[0]!)).toBe(false);
      a.choices.length = 0;
      b.choices.length = 0;
    }
  });

  it('stops offering an upgrade once it is at its last level, and everything once all are', () => {
    const sim = sandbox(openRoom(), { hero: 'warden', skills: ['sunder'] });
    sim.setSkillUpgrades({ 'sunder.wide': 2 });
    for (let i = 0; i < 30; i++) {
      expect(offer(sim, 'chest')).not.toContain('sunder.wide');
      sim.choices.length = 0;
    }
    expect(sim.skillUpgradeCandidates().map((u) => u.id).sort()).toEqual(['sunder.aftershock', 'sunder.embers', 'sunder.rush']);
    sim.setSkillUpgrades(maxed('sunder'));
    expect(sim.skillUpgradeCandidates()).toEqual([]);
  });

  it('offers the same cards for the same seed', () => {
    const make = () => sandbox(openRoom(), { hero: 'wanderer', skills: ['volley', 'frost'], seed: 99 });
    const a = make();
    const b = make();
    for (let i = 0; i < 8; i++) {
      expect(offer(a, i % 2 ? 'chest' : 'level')).toEqual(offer(b, i % 2 ? 'chest' : 'level'));
      a.choices.length = 0;
      b.choices.length = 0;
    }
  });

  it('applies a taken card: one level, capped, logged, and an unoffered card changes nothing', () => {
    const sim = sandbox(openRoom(), { hero: 'warden', skills: ['sunder'] });
    sim.queueChoice('chest');
    const card = sim.choices[0]!.options.find(isSkill)!;
    const other = SKILL_UPGRADE_LIST.find((u) => u.skill === 'warcry')!.id;
    expect(sim.applyChoice(other)).toBe(false);
    expect(sim.hero.skillUpgrades[other]).toBeUndefined();
    expect(sim.applyChoice(card)).toBe(true);
    expect(sim.hero.skillUpgrades[card]).toBe(1);
    expect(sim.skillUpgradeLog).toEqual([card]);
    expect(sim.drainEvents().some((e) => e.type === 'skillUpgrade' && e.id === card && e.level === 1)).toBe(true);
    // taking it again (when it comes up) raises it by exactly one and stops at the end
    for (let i = 0; i < 6; i++) {
      sim.choices.length = 0;
      sim.choices.push({ source: 'level', options: [card] });
      sim.applyChoice(card);
    }
    expect(sim.hero.skillUpgrades[card]).toBe(maxLevel(SKILL_UPGRADES[card]!));
  });

  it('still offers plain stat upgrades when a hero has no skill upgrades to find', () => {
    const sim = sandbox(openRoom(), { hero: 'warden', skills: ['sunder'] });
    sim.setSkillUpgrades(maxed('sunder'));
    expect(offer(sim, 'chest').every((id) => id in UPGRADES)).toBe(true);
  });
});

// ───────────────────────────── the save ─────────────────────────────

describe('skill upgrades in the save', () => {
  it('remembers which upgrades the player has found, once each', () => {
    const s = defaultSave();
    expect(s.codex).toEqual([]);
    bankRun(s, { hero: 'warden', ash: 1, won: false, floor: 1, kills: 1, keepFraction: 0.6, bonus: 40, skillUpgrades: ['sunder.wide', 'sunder.rush', 'sunder.wide'] });
    bankRun(s, { hero: 'warden', ash: 1, won: false, floor: 1, kills: 1, keepFraction: 0.6, bonus: 40, skillUpgrades: ['sunder.rush', 'charge.trail'] });
    expect(s.codex).toEqual(['sunder.wide', 'sunder.rush', 'charge.trail']);
  });

  it('does not store ids it does not know', () => {
    const s = defaultSave();
    bankRun(s, { hero: 'warden', ash: 1, won: false, floor: 1, kills: 1, keepFraction: 0.6, bonus: 40, skillUpgrades: ['nope.x', 'power', 'sunder.wide'] });
    expect(s.codex).toEqual(['sunder.wide']);
  });

  it('survives save and load, and drops junk from a damaged file', () => {
    const s = defaultSave();
    s.codex = ['volley.more', 'seal.drain'];
    expect(parseSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.codex = ['volley.more', 'volley.more', 'bogus', 7, null, 'seal.drain'];
    expect(parseSave(raw)!.codex).toEqual(['volley.more', 'seal.drain']);
    raw.codex = 'not a list';
    expect(parseSave(raw)!.codex).toEqual([]);
  });

  it('migrates a version 3 save (skills, no codex) without losing anything', () => {
    const v3 = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    v3.version = 3;
    delete v3.codex;
    (v3.progress as Record<string, unknown>).warden = { runs: 5, kills: 400, bestFloor: 3, wins: 1 };
    (v3.loadout as Record<string, unknown>).warden = ['sunder', 'crush', 'pact'];
    v3.ash = 123;
    const s = parseSave(v3)!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.codex).toEqual([]);
    expect(s.loadout.warden).toEqual(['sunder', 'crush', 'pact']);
    expect(s.progress.warden.kills).toBe(400);
    expect(s.ash).toBe(123);
  });

  it('migrates a version 2 save all the way', () => {
    const v2 = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    v2.version = 2;
    delete v2.codex;
    delete v2.progress;
    delete v2.loadout;
    const s = parseSave(v2)!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.codex).toEqual([]);
    expect(s.loadout.wanderer).toEqual(['volley']);
  });
});

// ───────────────────────────── what upgrades do ─────────────────────────────

describe('warden upgrades', () => {
  it('Szeroki Wstrząs: the slam reaches enemies it used to miss', () => {
    const far = (levels: Record<string, number>) => {
      const sim = lab('sunder', levels);
      const e = dummy(sim, 'brute', 3.6);
      const ev = run(sim, 0.5, { skill: true });
      return dmgTo(ev, e).length;
    };
    expect(far({})).toBe(0);
    expect(far(at('sunder', 'wide', 1))).toBe(0); // 2.4 × 1.2 = 2.9, plus the enemy's own radius 0.5, is still short of 3.6
    expect(far(at('sunder', 'wide', 2))).toBe(1);
  });

  it('Pośpiech: shorter cooldown, weaker hit', () => {
    const plain = lab('sunder');
    const quick = lab('sunder', at('sunder', 'rush', 1));
    const a = dummy(plain, 'brute', 1.2);
    const b = dummy(quick, 'brute', 1.2);
    const da = dmgTo(run(plain, 0.5, { skill: true }), a, 'skill')[0]!.amount;
    const db = dmgTo(run(quick, 0.5, { skill: true }), b, 'skill')[0]!.amount;
    expect(da).toBe(Math.round(plain.hero.stats.damage * SKILLS.sunder.damageMult));
    expect(db).toBe(Math.round(quick.hero.stats.damage * SKILLS.sunder.damageMult * 0.8));
    expect(quick.skillCooldown(SKILLS.sunder)).toBeCloseTo(SKILLS.sunder.cooldown * 0.7, 9);
    expect(quick.hero.skills[0]!.cd).toBeLessThan(plain.hero.skills[0]!.cd - 1);
  });

  it('Żarzące Szczeliny: the ground keeps burning for three seconds, then goes out', () => {
    const sim = lab('sunder', at('sunder', 'embers', 2));
    const e = dummy(sim, 'brute', 1.2);
    const ev = run(sim, 0.5, { skill: true });
    expect(sim.zones.some((z) => z.kind === 'ground')).toBe(true);
    const first = dmgTo(ev, e, 'skill').length;
    const later = dmgTo(run(sim, 1.5), e, 'skill');
    expect(first).toBeGreaterThanOrEqual(1);
    expect(later.length).toBeGreaterThanOrEqual(2);
    expect(later[0]!.amount).toBe(Math.round(sim.hero.stats.damage * 0.5));
    run(sim, 3);
    expect(sim.zones.some((z) => z.kind === 'ground')).toBe(false);
    expect(dmgTo(run(sim, 1), e, 'skill').length).toBe(0);
  });

  it('Drugi Wstrząs: the ground strikes again later at half strength', () => {
    const sim = lab('sunder', at('sunder', 'aftershock', 1));
    const e = dummy(sim, 'brute', 1.2);
    const ev = run(sim, 1.2, { skill: true });
    const hits = dmgTo(ev, e, 'skill');
    expect(hits.length).toBe(2);
    expect(hits[0]!.amount).toBe(Math.round(sim.hero.stats.damage * SKILLS.sunder.damageMult));
    expect(hits[1]!.amount).toBe(Math.round(sim.hero.stats.damage * SKILLS.sunder.damageMult * 0.5));
    expect(ev.filter((x) => x.type === 'skillImpact').length).toBe(2);
  });

  it('Dłuższy Rozbieg: the charge covers a quarter more ground', () => {
    const dist = (levels: Record<string, number>) => {
      const sim = lab('charge', levels);
      sim.hero.x = sim.hero.px = 3.5;
      const x0 = sim.hero.x;
      run(sim, 0.6, { skill: true, moveX: 1 });
      return sim.hero.x - x0;
    };
    const base = dist({});
    expect(dist(at('charge', 'reach', 1)) - base).toBeGreaterThan(SKILLS.charge.distance * 0.25 * 0.85);
    expect(dist(at('charge', 'reach', 2)) - base).toBeGreaterThan(SKILLS.charge.distance * 0.5 * 0.85);
  });

  it('Pęd Bitewny: each enemy rammed takes time off the cooldown, up to a cap', () => {
    const sim = lab('charge', at('charge', 'momentum', 2));
    for (const dx of [1.5, 2.4, 3.3]) dummy(sim, 'brute', dx);
    run(sim, 0.6, { skill: true, moveX: 1 });
    const cd = sim.hero.skills[0]!.cd;
    const plain = lab('charge');
    for (const dx of [1.5, 2.4, 3.3]) dummy(plain, 'brute', dx);
    run(plain, 0.6, { skill: true, moveX: 1 });
    expect(plain.hero.skills[0]!.cd - cd).toBeCloseTo(3, 1); // three hits × 1 s, exactly the cap
  });

  it('Taran: rammed enemies stay stunned longer', () => {
    const stun = (levels: Record<string, number>) => {
      const sim = lab('charge', levels);
      const e = dummy(sim, 'thrall', 1.5);
      e.state = 'chase';
      e.stateT = 0;
      run(sim, 0.34, { skill: true, moveX: 1 });
      return e.stateT;
    };
    expect(stun(at('charge', 'ram', 2))).toBeGreaterThan(stun({}) + 0.8);
  });

  it('Ognisty Ślad: burning ground is left along the path', () => {
    const sim = lab('charge', at('charge', 'trail', 1));
    run(sim, 0.6, { skill: true, moveX: 1 });
    const patches = sim.zones.filter((z) => z.kind === 'ground');
    expect(patches.length).toBeGreaterThanOrEqual(3);
    expect(new Set(patches.map((z) => Math.round(z.x))).size).toBeGreaterThanOrEqual(2);
  });

  it('Miażdżący Cios: Ciężar, Wyrok and Fala Uderzeniowa change the hit in different ways', () => {
    const hit = (levels: Record<string, number>, hpShare = 1) => {
      const sim = lab('crush', levels);
      const e = dummy(sim, 'brute', 1.6);
      const n = dummy(sim, 'brute', 2.4, 0.6);
      e.hp = e.maxHp * hpShare;
      const ev = run(sim, 0.9, { skill: true });
      return { main: dmgTo(ev, e, 'skill')[0]?.amount ?? 0, neighbour: dmgTo(ev, n, 'skill')[0]?.amount ?? 0, base: sim.hero.stats.damage * SKILLS.crush.damageMult };
    };
    const plain = hit({});
    expect(plain.main).toBe(Math.round(plain.base));
    expect(plain.neighbour).toBe(0);
    expect(hit(at('crush', 'weight', 1)).main).toBe(Math.round(plain.base * 1.25));
    expect(hit(at('crush', 'verdict', 2), 1).main).toBe(Math.round(plain.base)); // full health: nothing extra
    expect(hit(at('crush', 'verdict', 2), 0.2).main).toBe(Math.round(plain.base * 2));
    expect(hit(at('crush', 'shock', 2)).neighbour).toBe(Math.round(plain.base / SKILLS.crush.damageMult * 1.8));
  });

  it('Okrzyk Wojny: Grzmot makes it hurt, Przerażenie keeps them stunned longer, Daleki Okrzyk reaches further', () => {
    const run1 = (levels: Record<string, number>, dx = 2) => {
      const sim = lab('warcry', levels);
      const e = dummy(sim, 'thrall', dx);
      e.state = 'chase';
      e.stateT = 0;
      const ev = run(sim, 0.12, { skill: true });
      return { e, ev, sim };
    };
    expect(run1({}).e.hp).toBe(42);
    const thunder = run1(at('warcry', 'thunder', 2));
    expect(thunder.e.hp).toBeLessThan(42);
    expect(dmgTo(thunder.ev, thunder.e, 'skill')[0]!.amount).toBe(Math.round(thunder.sim.hero.stats.damage * 1.8));
    const plain = run1({});
    const terror = run1(at('warcry', 'terror', 2));
    expect(terror.e.stateT).toBeGreaterThan(plain.e.stateT + 0.8);
    const miss = run1({}, 5.6);
    const far = run1(at('warcry', 'far', 2), 5.6);
    expect(Math.hypot(far.e.x - far.sim.hero.x, far.e.y - far.sim.hero.y)).toBeGreaterThan(Math.hypot(miss.e.x - miss.sim.hero.x, miss.e.y - miss.sim.hero.y) + 0.5);
  });

  it('Bastion: Żelazna Wola cuts more, Długi Bastion lasts longer, Kolce Bastionu hit back — but not twice at once', () => {
    const taken = (levels: Record<string, number>) => {
      const sim = lab('bastion', levels);
      run(sim, 0.1, { skill: true });
      const before = sim.hero.hp;
      sim.damageHero(40);
      return { loss: before - sim.hero.hp, sim };
    };
    const base = taken({}).loss;
    expect(base).toBeCloseTo(40 * (1 - SKILLS.bastion.reduction), 5);
    expect(taken(at('bastion', 'iron', 2)).loss).toBeCloseTo(40 * (1 - SKILLS.bastion.reduction * 1.3), 5);
    const long = lab('bastion', at('bastion', 'long', 2));
    run(long, 0.1, { skill: true });
    expect(long.hero.guardT).toBeCloseTo(SKILLS.bastion.duration * 2 - 0.1, 1);

    const sim = lab('bastion', at('bastion', 'thorns', 1));
    const e = dummy(sim, 'brute', 1);
    run(sim, 0.1, { skill: true });
    expect(dmgTo(run(sim, 0.01), e, 'skill').length).toBe(0);
    sim.damageHero(10);
    const a = dmgTo(sim.drainEvents(), e, 'skill');
    expect(a.length).toBe(1);
    expect(a[0]!.amount).toBe(Math.round(sim.hero.stats.damage * 1));
    sim.hero.hurtT = 0;
    sim.damageHero(10);
    expect(dmgTo(sim.drainEvents(), e, 'skill').length).toBe(0); // rate limited
    run(sim, SKILL_UPGRADE_RULES.retaliateCooldown + 0.1);
    sim.hero.hurtT = 0;
    sim.damageHero(10);
    expect(dmgTo(sim.drainEvents(), e, 'skill').length).toBe(1);
  });

  it('Rzut Toporem: Bliźniacze Topory fan out, Rozżarzony Topór sets fire, Łamacz explodes', () => {
    const shots = (levels: Record<string, number>) => {
      const sim = lab('axe', levels);
      dummy(sim, 'brute', 3);
      const ev = run(sim, 0.05, { skill: true });
      return ev.filter((e): e is Extract<SimEvent, { type: 'shoot' }> => e.type === 'shoot');
    };
    expect(shots({}).length).toBe(1);
    const twin = shots(at('axe', 'twin', 2));
    expect(twin.length).toBe(3);
    expect(new Set(twin.map((s) => s.angle.toFixed(3))).size).toBe(3);
    expect(twin[1]!.angle).toBeCloseTo((twin[0]!.angle + twin[2]!.angle) / 2, 6);

    const burn = lab('axe', at('axe', 'molten', 1));
    const e = dummy(burn, 'brute', 3);
    run(burn, 1.2, { skill: true });
    expect(e.burnT).toBeGreaterThan(0);
    const blast = lab('axe', at('axe', 'splitter', 2));
    const a = dummy(blast, 'brute', 3);
    const b = dummy(blast, 'brute', 3, 1.1);
    const ev = run(blast, 1, { skill: true });
    expect(dmgTo(ev, a, 'bolt').length).toBe(1);
    expect(dmgTo(ev, b, 'skill')[0]!.amount).toBe(Math.round(blast.hero.stats.damage * 1.4));
  });

  it('Łańcuch Popiołu: Zgniecenie detonates the pile, Kajdany stun longer, Dłuższy Łańcuch reaches further', () => {
    const sim = lab('hook', at('hook', 'crushing', 1));
    // a thrall: heavy brutes resist being dragged (their poise), so they would not reach the blast
    const e = dummy(sim, 'thrall', 4);
    const ev = run(sim, 0.2, { skill: true });
    expect(dmgTo(ev, e, 'skill').length).toBe(1);
    const later = dmgTo(run(sim, 0.8), e, 'skill');
    expect(later.length).toBe(1);
    expect(later[0]!.amount).toBe(Math.round(sim.hero.stats.damage * 0.8));

    const stunned = (levels: Record<string, number>) => {
      const s = lab('hook', levels);
      const t = dummy(s, 'thrall', 3);
      t.state = 'chase'; // not already stunned for good
      t.stateT = 0;
      run(s, 0.1, { skill: true });
      return t.stateT;
    };
    expect(stunned(at('hook', 'shackles', 2))).toBeGreaterThan(stunned({}) + 0.5);
    const pulled = (levels: Record<string, number>, dx: number) => {
      const s = lab('hook', levels);
      const t = dummy(s, 'thrall', dx);
      run(s, 1, { skill: true });
      return Math.hypot(t.x - s.hero.x, t.y - s.hero.y);
    };
    expect(pulled({}, 6.4)).toBeGreaterThan(6);
    expect(pulled(at('hook', 'reach', 2), 6.4)).toBeLessThan(2);
  });

  it('Sztandar Popiołu: Okrzyk Zbiórki makes it faster and healing stronger; Trwały and Szeroki change its size', () => {
    const sim = lab('banner', at('banner', 'rally', 2));
    sim.hero.hp = 40;
    run(sim, 0.2, { skill: true });
    expect(sim.hero.bannerHaste).toBeCloseTo(SKILLS.banner.haste * 1.6, 9);
    const plain = lab('banner');
    plain.hero.hp = 40;
    run(plain, 0.2, { skill: true });
    const hp0 = sim.hero.hp;
    const hp1 = plain.hero.hp;
    run(sim, 2);
    run(plain, 2);
    expect(sim.hero.hp - hp0).toBeGreaterThan((plain.hero.hp - hp1) * 1.4);
    const wide = lab('banner', { ...at('banner', 'wide', 2), ...at('banner', 'long', 2) });
    run(wide, 0.1, { skill: true });
    const z = wide.zones.find((q) => q.kind === 'banner')!;
    expect(z.r).toBeCloseTo(SKILLS.banner.radius * 1.5, 9);
    expect(z.maxLife).toBeCloseTo(SKILLS.banner.duration * 1.8, 9);
  });

  it('Wir Ostrzy: longer, wider, burning, and faster on the feet', () => {
    const ticks = (levels: Record<string, number>, dx = 1) => {
      const sim = lab('whirl', levels);
      const e = dummy(sim, 'brute', dx);
      const ev = run(sim, 4, { skill: true });
      return { n: dmgTo(ev, e, 'skill').length, e };
    };
    const base = ticks({});
    expect(ticks(at('whirl', 'long', 2)).n).toBeGreaterThan(base.n * 1.4);
    expect(ticks({}, 3).n).toBe(0); // 1.9 + the enemy's radius 0.5 is short of 3
    expect(ticks(at('whirl', 'wide', 2), 3).n).toBeGreaterThan(0);
    expect(ticks(at('whirl', 'sear', 1)).e.burnT).toBeGreaterThanOrEqual(0);
    const burning = lab('whirl', at('whirl', 'sear', 2));
    const e = dummy(burning, 'brute', 1);
    run(burning, 0.5, { skill: true });
    expect(e.burnT).toBeGreaterThan(0);
    const walk = (levels: Record<string, number>) => {
      const sim = lab('whirl', levels);
      const x0 = sim.hero.x;
      run(sim, 1, { skill: true, moveX: 1 });
      return sim.hero.x - x0;
    };
    expect(walk(at('whirl', 'fleet', 2))).toBeGreaterThan(walk({}) * 1.2);
  });

  it('Krwawy Pakt: stronger bonus, more lifesteal, longer', () => {
    const cast = (levels: Record<string, number>) => {
      const sim = lab('pact', levels);
      run(sim, 0.1, { skill: true });
      return sim.hero;
    };
    const plain = cast({});
    const fury = cast(at('pact', 'fury', 2));
    const greed = cast(at('pact', 'greed', 2));
    const long = cast(at('pact', 'long', 2));
    expect(plain.pactPower).toBeCloseTo(SKILLS.pact.damageBonus, 9);
    expect(fury.pactPower).toBeCloseTo(SKILLS.pact.damageBonus * 1.4, 9);
    expect(greed.pactLifesteal).toBeCloseTo(SKILLS.pact.lifesteal + 0.1, 9);
    expect(long.pactT).toBeGreaterThan(plain.pactT + 4);
  });
});

describe('wanderer upgrades', () => {
  it('Salwa Odłamków: more shards in a wider fan, further piercing, explosions, fire', () => {
    const sim = lab('volley', at('volley', 'more', 2));
    dummy(sim, 'brute', 3);
    const ev = run(sim, 0.05, { skill: true });
    const angles = ev.filter((e): e is Extract<SimEvent, { type: 'shoot' }> => e.type === 'shoot').map((e) => e.angle);
    expect(angles.length).toBe(SKILLS.volley.bolts + 4);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(((SKILLS.volley.arcDeg + 5 * 4) * Math.PI) / 180 - 0.01);

    const pierce = lab('volley', at('volley', 'pierce', 2));
    dummy(pierce, 'brute', 3);
    run(pierce, 0.05, { skill: true });
    const p = pierce.projectiles.find((q) => q.team === 'hero')!;
    expect(p.pierceLeft).toBe(SKILLS.volley.pierce + 2);

    const burst = lab('volley', at('volley', 'burst', 2));
    const a = dummy(burst, 'brute', 3);
    const b = dummy(burst, 'brute', 3, 1.1);
    const ev2 = run(burst, 1, { skill: true });
    expect(dmgTo(ev2, a, 'bolt').length).toBeGreaterThan(0);
    expect(dmgTo(ev2, b, 'skill').some((x) => x.amount === Math.round(burst.hero.stats.damage * 0.8))).toBe(true);

    const fire = lab('volley', at('volley', 'fire', 2));
    const c = dummy(fire, 'brute', 3);
    run(fire, 1, { skill: true });
    expect(c.burnT).toBeGreaterThan(0);
    const cold = lab('volley');
    const d = dummy(cold, 'brute', 3);
    run(cold, 1, { skill: true });
    expect(d.burnT).toBe(0);
  });

  it('Pieczęć Pustki: bigger, longer, healing and exploding', () => {
    const sim = lab('seal', { ...at('seal', 'wide', 2), ...at('seal', 'deep', 2) });
    run(sim, 0.1, { skill: true });
    const z = sim.zones.find((q) => q.kind === 'seal')!;
    expect(z.r).toBeCloseTo(SKILLS.seal.radius * 1.5, 9);
    expect(z.maxLife).toBeCloseTo(SKILLS.seal.duration * 1.8, 9);

    const drain = lab('seal', at('seal', 'drain', 2));
    drain.hero.hp = 40;
    dummy(drain, 'brute', 1);
    run(drain, 2, { skill: true });
    const plain = lab('seal');
    plain.hero.hp = 40;
    dummy(plain, 'brute', 1);
    run(plain, 2, { skill: true });
    expect(drain.hero.hp).toBeGreaterThan(plain.hero.hp + 1);

    const boom = lab('seal', at('seal', 'detonate', 2));
    const e = dummy(boom, 'brute', 1);
    const ev = run(boom, SKILLS.seal.duration + 0.5, { skill: true });
    const last = dmgTo(ev, e, 'skill').pop()!;
    expect(last.amount).toBe(Math.round(boom.hero.stats.damage * 2.5));
    expect(boom.zones.some((q) => q.kind === 'seal')).toBe(false);
  });

  it('Strzał Przeszywający: pierces further, explodes, shoots a second target, finishes the weak', () => {
    const base = lab('snipe');
    const t1 = dummy(base, 'brute', 3);
    const dBase = dmgTo(run(base, 0.5, { skill: true }), t1, 'bolt')[0]!.amount;
    const weak = lab('snipe', at('snipe', 'finisher', 2));
    const t2 = dummy(weak, 'brute', 3);
    t2.hp = t2.maxHp * 0.2;
    expect(dmgTo(run(weak, 0.5, { skill: true }), t2, 'bolt')[0]!.amount).toBe(Math.round(dBase * 2));

    const pierce = lab('snipe', at('snipe', 'pierce', 2));
    dummy(pierce, 'brute', 3);
    run(pierce, 0.05, { skill: true });
    expect(pierce.projectiles.find((q) => q.team === 'hero')!.pierceLeft).toBe(SKILLS.snipe.pierce + 2);

    const twin = lab('snipe', at('snipe', 'twin', 1));
    const a = dummy(twin, 'brute', 3);
    const b = dummy(twin, 'brute', -3, 0.2);
    const ev = run(twin, 0.5, { skill: true });
    expect(dmgTo(ev, a, 'bolt').length).toBe(1);
    expect(dmgTo(ev, b, 'bolt').length).toBe(1);

    const blast = lab('snipe', at('snipe', 'blast', 2));
    const c = dummy(blast, 'brute', 3);
    const d = dummy(blast, 'brute', 3, 1.2);
    const ev2 = run(blast, 0.5, { skill: true });
    expect(dmgTo(ev2, c, 'bolt').length).toBe(1);
    expect(dmgTo(ev2, d, 'skill')[0]!.amount).toBe(Math.round(blast.hero.stats.damage * 1.8));
  });

  it('Krok Otchłani: further, with explosions at both ends, a frozen trail, a shorter cooldown', () => {
    const hop = (levels: Record<string, number>) => {
      const sim = lab('blink', levels);
      sim.hero.x = sim.hero.px = 3.5;
      const x0 = sim.hero.x;
      run(sim, 0.02, { skill: true, moveX: 1 });
      return sim.hero.x - x0;
    };
    expect(hop(at('blink', 'far', 2)) - hop({})).toBeGreaterThan(SKILLS.blink.distance * 0.5 * 0.9);

    const nova = lab('blink', at('blink', 'nova', 2));
    nova.hero.x = nova.hero.px = 3.5;
    const start = dummy(nova, 'brute', 1);
    const end = dummy(nova, 'brute', 4.8);
    const ev = run(nova, 0.1, { skill: true, moveX: 1 });
    expect(dmgTo(ev, start, 'skill').length).toBe(1);
    expect(dmgTo(ev, end, 'skill').length).toBe(1);

    const frost = lab('blink', at('blink', 'frost', 2));
    const e = dummy(frost, 'brute', 1);
    run(frost, 0.8, { skill: true, moveX: 1 });
    expect(frost.zones.some((z) => z.kind === 'ground' && z.skill === 'blink')).toBe(true);
    expect(e.chillT).toBeGreaterThan(0);
    expect(lab('blink', at('blink', 'swift', 2)).skillCooldown(SKILLS.blink)).toBeCloseTo(SKILLS.blink.cooldown * 0.65, 9);
  });

  it('Bariera Pustki: thicker, longer, reflecting', () => {
    const cap = (levels: Record<string, number>) => {
      const sim = lab('ward', levels);
      run(sim, 0.1, { skill: true });
      return sim.hero;
    };
    const base = cap({});
    expect(cap(at('ward', 'big', 2)).shield).toBeCloseTo(base.shield * 1.6, 5);
    expect(cap(at('ward', 'long', 2)).shieldT).toBeGreaterThan(base.shieldT + 5);
    const sim = lab('ward', at('ward', 'reflect', 1));
    const e = dummy(sim, 'brute', 1);
    run(sim, 0.1, { skill: true });
    sim.damageHero(10);
    expect(dmgTo(sim.drainEvents(), e, 'skill')[0]!.amount).toBe(Math.round(sim.hero.stats.damage));
  });

  it('Szron Otchłani: wider, longer freeze, a second pulse, extra damage to the frozen', () => {
    const sim = lab('frost', { ...at('frost', 'echo', 2), ...at('frost', 'shatter', 2) });
    const e = dummy(sim, 'brute', 2);
    e.state = 'chase';
    e.stateT = 0;
    const ev = run(sim, 1.4, { skill: true });
    const hits = dmgTo(ev, e, 'skill');
    const base = sim.hero.stats.damage * SKILLS.frost.damageMult;
    expect(hits.length).toBe(2);
    expect(hits[0]!.amount).toBe(Math.round(base));
    // the echo is 80% strong and the enemy is frozen by then: +100% from Kruszenie
    expect(hits[1]!.amount).toBe(Math.round(base * 0.8 * 2));
    expect(ev.filter((x) => x.type === 'skillFx' && x.skill === 'frost').length).toBe(2);

    const wide = (levels: Record<string, number>, dx: number) => {
      const s = lab('frost', levels);
      const t = dummy(s, 'thrall', dx);
      run(s, 0.1, { skill: true });
      return t.frozenT;
    };
    expect(wide({}, 4.3)).toBe(0);
    expect(wide(at('frost', 'wide', 2), 4.3)).toBeGreaterThan(0);
    expect(wide(at('frost', 'deep', 2), 2)).toBeGreaterThan(wide({}, 2) + 1);
  });

  it('Kryształowy Wartownik: shoots at several enemies, lasts longer, burns, blows up when it goes', () => {
    const shots = (levels: Record<string, number>) => {
      const sim = lab('sentry', levels);
      dummy(sim, 'brute', 4);
      dummy(sim, 'brute', 4, 1);
      dummy(sim, 'brute', 4, -1);
      run(sim, 0.1, { skill: true });
      const ev = run(sim, 1, {});
      return dmg(ev, 'bolt').length;
    };
    expect(shots(at('sentry', 'twin', 2))).toBeGreaterThan(shots({}) * 2);

    const long = lab('sentry', at('sentry', 'long', 2));
    run(long, 0.1, { skill: true });
    expect(long.zones.find((z) => z.kind === 'sentry')!.maxLife).toBeCloseTo(SKILLS.sentry.duration * 1.8, 9);

    const fire = lab('sentry', at('sentry', 'fire', 1));
    const e = dummy(fire, 'brute', 4);
    run(fire, 2, { skill: true });
    expect(e.burnT).toBeGreaterThan(0);

    const boom = lab('sentry', at('sentry', 'overload', 2));
    const t = dummy(boom, 'brute', 1.5);
    run(boom, 0.1, { skill: true });
    const ev = run(boom, SKILLS.sentry.duration + 0.5);
    expect(dmgTo(ev, t, 'skill').pop()!.amount).toBe(Math.round(boom.hero.stats.damage * 3.5));
  });

  it('Mina Pustki: a minefield, a bigger blast, a heavier blast', () => {
    const field = lab('mine', at('mine', 'cluster', 2));
    run(field, 0.1, { skill: true });
    expect(field.zones.filter((z) => z.kind === 'mine').length).toBe(3);
    for (let i = 0; i < 4; i++) {
      field.hero.skills[0]!.cd = 0;
      run(field, 0.3, { skill: true });
    }
    expect(field.zones.filter((z) => z.kind === 'mine').length).toBe(SKILLS.mine.max + 2);

    const big = lab('mine', at('mine', 'big', 2));
    run(big, 0.1, { skill: true });
    expect(big.zones.find((z) => z.kind === 'mine')!.r).toBeCloseTo(SKILLS.mine.radius * 1.5, 9);

    const hit = (levels: Record<string, number>) => {
      const sim = lab('mine', levels);
      run(sim, 0.1, { skill: true });
      const e = dummy(sim, 'brute', 0.8);
      return dmgTo(run(sim, 1), e, 'skill')[0]!.amount;
    };
    const d = lab('mine').hero.stats.damage;
    expect(hit({})).toBe(Math.round(d * SKILLS.mine.damageMult));
    expect(hit(at('mine', 'heavy', 2))).toBe(Math.round(d * SKILLS.mine.damageMult * 1.6));
  });

  it('Gwiezdny Deszcz: more stars, bigger stars, burning ground, a quicker but weaker rain', () => {
    const rain = lab('starfall', at('starfall', 'more', 2));
    for (let i = 0; i < 9; i++) dummy(rain, 'thrall', 1 + (i % 3) * 1.2, -2 + Math.floor(i / 3) * 2);
    run(rain, 0.05, { skill: true });
    expect(rain.zones.filter((z) => z.kind === 'star').length).toBe(SKILLS.starfall.count + 3);

    const wide = lab('starfall', at('starfall', 'wide', 2));
    dummy(wide, 'brute', 3);
    run(wide, 0.05, { skill: true });
    expect(wide.zones.find((z) => z.kind === 'star')!.r).toBeCloseTo(SKILLS.starfall.radius * 1.5, 9);

    const ember = lab('starfall', at('starfall', 'ember', 2));
    const e = dummy(ember, 'brute', 3);
    const ev = run(ember, SKILLS.starfall.delay + 1.2, { skill: true });
    expect(ember.zones.some((z) => z.kind === 'ground')).toBe(true);
    expect(dmgTo(ev, e, 'skill').length).toBeGreaterThanOrEqual(2);

    const quick = lab('starfall', at('starfall', 'quick', 1));
    const t = dummy(quick, 'brute', 3);
    const first = dmgTo(run(quick, SKILLS.starfall.delay + 0.3, { skill: true }), t, 'skill')[0]!.amount;
    expect(first).toBe(Math.round(quick.hero.stats.damage * SKILLS.starfall.damageMult * 0.85));
  });

  it('Przeciążenie: longer, faster, and its shots explode or burn only while it lasts', () => {
    const cast = (levels: Record<string, number>) => {
      const sim = lab('overload', levels);
      run(sim, 0.1, { skill: true });
      return sim.hero;
    };
    const base = cast({});
    expect(cast(at('overload', 'long', 2)).overloadT).toBeGreaterThan(base.overloadT + 3);
    expect(cast(at('overload', 'power', 2)).overloadHaste).toBeCloseTo(SKILLS.overload.haste * 1.6, 9);

    const shoot = (levels: Record<string, number>, wait: number) => {
      const sim = lab('overload', levels);
      const a = dummy(sim, 'brute', 3);
      const b = dummy(sim, 'brute', 3, 1.1);
      sim.hero.stats.attackRange = wait > 0 ? 0 : 4.6; // the hero holds fire while the buff runs out
      run(sim, 0.1, { skill: true });
      run(sim, wait);
      sim.hero.stats.attackRange = 4.6; // then shoots, unlike the other labs
      const ev = run(sim, 1.2);
      return { a, b, ev, sim };
    };
    const boom = shoot(at('overload', 'explosive', 2), 0);
    expect(dmgTo(boom.ev, boom.b, 'skill').some((x) => x.amount === Math.round(boom.sim.hero.stats.damage * 0.7))).toBe(true);
    const fire = shoot(at('overload', 'fire', 2), 0);
    expect(fire.a.burnT + fire.b.burnT).toBeGreaterThan(0);
    // after the buff has run out the same upgrade does nothing
    const late = shoot(at('overload', 'fire', 2), SKILLS.overload.duration + 0.5);
    expect(late.a.burnT + late.b.burnT).toBe(0);
  });
});

// ───────────────────────────── every upgrade does something ─────────────────────────────

/** Where the weakest enemy stands: far away, or right next to the hero (so single-target skills meet it first). */
type Layout = 'weak-far' | 'weak-near';

/** Plays a fixed little fight and returns a fingerprint of everything that happened in it. */
function fingerprint(skill: SkillId, levels: Record<string, number>, layout: Layout): string {
  const sim = sandbox(openRoom(), { hero: heroOf(skill), skills: [skill], seed: 5 });
  sim.hero.stats.critChance = 0;
  // the hero stands and watches, except where the upgrade is about his own attacks
  if (skill !== 'overload' && skill !== 'pact') sim.hero.stats.attackRange = 0;
  sim.setSkillUpgrades(levels);
  sim.hero.x = sim.hero.px = 3.5;
  sim.hero.y = sim.hero.py = 8.5;
  sim.hero.hp = sim.hero.stats.maxHp * 0.5;
  const spots: [('thrall' | 'brute'), number, number][] = [
    ['brute', 1.4, 0],
    ['brute', 2.2, 0.3],
    ['thrall', 3.0, 0.3],
    ['brute', 4.0, -0.5],
    ['thrall', 5.4, 0],
    ['thrall', 6.4, 0.2],
    ['brute', -2.0, 0.5],
    ['thrall', 0, 2.6],
    layout === 'weak-near' ? ['thrall', 0.9, -0.9] : ['thrall', -1.9, -1.2],
  ];
  const foes = spots.map(([k, dx, dy]) => dummy(sim, k, dx, dy));
  foes[foes.length - 1]!.hp = foes[foes.length - 1]!.maxHp * 0.2;
  const events: SimEvent[] = [];
  let peakZones = 0;
  let peakShots = 0;
  let frozen = 0;
  let chilled = 0;
  let burning = 0;
  let cdInt = 0;
  const timerInt = [0, 0, 0, 0, 0, 0];
  const powerPeak = [0, 0, 0, 0, 0, 0];
  let zoneRMax = 0;
  let zoneSteps = 0;
  const step = (n: number, intent: Parameters<typeof run>[2]) => {
    for (let i = 0; i < n; i++) {
      events.push(...run(sim, 1 / 60, i === 0 ? intent : { ...intent, skill: false, skill2: false, skill3: false, dodge: false }));
      peakZones = Math.max(peakZones, sim.zones.length);
      peakShots = Math.max(peakShots, sim.projectiles.length);
      const hh = sim.hero;
      cdInt += hh.skills[0]!.cd;
      [hh.guardT, hh.pactT, hh.whirlT, hh.overloadT, hh.shield, hh.shieldT].forEach((v, k) => (timerInt[k] += v));
      [hh.guardPower, hh.pactPower, hh.pactLifesteal, hh.whirlMove, hh.overloadHaste, hh.bannerHaste].forEach((v, k) => (powerPeak[k] = Math.max(powerPeak[k]!, v)));
      for (const z of sim.zones) zoneRMax = Math.max(zoneRMax, z.r);
      zoneSteps += sim.zones.length;
      for (const e of foes) {
        frozen += e.frozenT;
        chilled += e.chillT;
        burning += e.burnT;
      }
    }
  };
  step(18, { skill: true, moveX: 1 });
  step(40, { dodge: true, moveX: -1 });
  sim.hero.iframeT = 0;
  sim.hero.hurtT = 0;
  sim.damageHero(8);
  step(542, {});
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const h = sim.hero;
  const count: Record<string, number> = {};
  for (const e of events) count[e.type] = (count[e.type] ?? 0) + 1;
  return JSON.stringify({
    hero: [r(h.x), r(h.y), r(h.hp)],
    cds: h.skills.map((sl) => r(sl.cd)),
    timers: [h.guardT, h.pactT, h.whirlT, h.overloadT, h.shield, h.shieldT].map((v) => r(v)),
    powers: [h.guardPower, h.pactPower, h.pactLifesteal, h.whirlMove, h.overloadHaste, h.bannerHaste].map((v) => r(v, 3)),
    zones: sim.zones.map((z) => z.kind + ':' + r(z.r) + ':' + r(z.life, 1)).sort(),
    peak: [peakZones, peakShots],
    status: [r(frozen), r(chilled), r(burning)],
    over: [r(cdInt), timerInt.map((v) => r(v)), powerPeak.map((v) => r(v, 3)), r(zoneRMax), zoneSteps],
    foes: foes.map((e) => [r(e.hp), e.state, r(e.x, 1), r(e.y, 1)]),
    count,
    damage: dmg(events).reduce((a, d) => a + d.amount, 0),
  });
}

/** Upgrades whose only effect is a longer stun: the test fight keeps its enemies stunned for good, so each has its own test above. */
const STUN_ONLY = new Set(['charge.ram', 'warcry.terror', 'hook.shackles']);

describe('every upgrade changes how its skill really plays', () => {
  const LAYOUTS: Layout[] = ['weak-far', 'weak-near'];
  for (const skill of ALL_SKILLS) {
    const base = Object.fromEntries(LAYOUTS.map((l) => [l, fingerprint(skill, {}, l)])) as Record<Layout, string>;
    it(`${skill}: the fight is repeatable`, () => {
      for (const l of LAYOUTS) expect(fingerprint(skill, {}, l)).toBe(base[l]);
    });
    for (const u of upgradesOf(skill)) {
      if (STUN_ONLY.has(u.id)) continue;
      for (let lv = 1; lv <= maxLevel(u); lv++) {
        it(`${u.id} level ${lv} is not just a label`, () => {
          const differs = LAYOUTS.some((l) => fingerprint(skill, { [u.id]: lv }, l) !== base[l]);
          expect(differs).toBe(true);
        });
      }
    }
    it(`${skill}: all upgrades together stay sane`, () => {
      const sim = sandbox(openRoom(), { hero: heroOf(skill), skills: [skill] });
      sim.setSkillUpgrades(maxed(skill));
      for (let i = 0; i < 4; i++) dummy(sim, 'brute', 1.2 + i * 0.9, (i % 2) * 0.7);
      run(sim, 0.1, { skill: true, moveX: 1 });
      run(sim, 5);
      expect(Number.isFinite(sim.hero.x + sim.hero.y + sim.hero.hp)).toBe(true);
      for (const e of sim.enemies) expect(Number.isFinite(e.x + e.y + e.hp)).toBe(true);
      expect(sim.zones.filter((z) => z.kind === 'ground').length).toBeLessThanOrEqual(SKILL_UPGRADE_RULES.groundMax);
    });
  }
});

describe('random loadouts with random upgrades', () => {
  it('never produce a non-finite number, an unbounded pile of effects or a crash', () => {
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let round = 0; round < 30; round++) {
      const hero: HeroId = round % 2 ? 'wanderer' : 'warden';
      const pool = [...SKILL_ORDER[hero]];
      const worn: SkillId[] = [];
      while (worn.length < 3) worn.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
      const sim = sandbox(openRoom(), { hero, skills: worn, seed: round + 1 });
      const levels: Record<string, number> = {};
      for (const s of worn) for (const u of upgradesOf(s)) if (rnd() < 0.7) levels[u.id] = 1 + Math.floor(rnd() * maxLevel(u));
      sim.setSkillUpgrades(levels);
      for (let i = 0; i < 6; i++) sim.spawnEnemy(i % 3 ? 'thrall' : 'brute', 2 + rnd() * 10, 2 + rnd() * 10, { instant: true });
      for (let t = 0; t < 40; t++) {
        run(sim, 0.5, { moveX: Math.cos(t + round), moveY: Math.sin(t * 1.3), skill: t % 3 === 0, skill2: t % 3 === 1, skill3: t % 3 === 2, dodge: t % 7 === 0 });
        if (sim.hero.state === 'dead') break;
        if (sim.livingEnemyCount() < 3) sim.spawnEnemy('thrall', 3 + rnd() * 9, 3 + rnd() * 9, { instant: true });
      }
      expect(Number.isFinite(sim.hero.x + sim.hero.y + sim.hero.hp + sim.hero.shield), `round ${round}`).toBe(true);
      for (const e of sim.enemies) expect(Number.isFinite(e.x + e.y + e.hp)).toBe(true);
      expect(sim.zones.filter((z) => z.kind === 'ground').length).toBeLessThanOrEqual(SKILL_UPGRADE_RULES.groundMax);
      expect(sim.zones.length).toBeLessThan(80);
      expect(sim.delayed.length).toBeLessThan(40);
      expect(sim.projectiles.length).toBeLessThan(200);
    }
  });
});
