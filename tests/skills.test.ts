import { describe, expect, it } from 'vitest';
import { COMMON } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import {
  NO_PROGRESS,
  SKILLS,
  SKILL_ORDER,
  SKILL_RULES,
  SKILLS_PER_CLASS,
  starterSkills,
  validateSkillData,
  type HeroProgress,
  type SkillId,
} from '../src/config/skills';
import { canAdd, checkLoadout, isUnlocked, newlyUnlocked, sanitizeLoadout, unlockedSkills, unlockText } from '../src/meta/loadout';
import { SAVE_VERSION, bankRun, defaultSave, equipSkill, parseSave, skillLoadout, unequipSkill } from '../src/meta/save';
import type { Enemy } from '../src/sim/types';
import { openRoom, run, sandbox } from './helpers';

const MAXED: HeroProgress = { runs: 99, kills: 9999, bestFloor: 3, wins: 9 };
const WARDEN = SKILL_ORDER.warden;
const WANDERER = SKILL_ORDER.wanderer;

// ───────────────────────────── data ─────────────────────────────

describe('skill data', () => {
  it('passes its own validation', () => {
    expect(validateSkillData()).toEqual([]);
  });

  it('gives each class exactly ten distinct skills, none shared', () => {
    for (const hero of ['warden', 'wanderer'] as HeroId[]) {
      const order = SKILL_ORDER[hero];
      expect(order.length).toBe(SKILLS_PER_CLASS);
      expect(new Set(order).size).toBe(SKILLS_PER_CLASS);
      for (const id of order) expect(SKILLS[id].hero).toBe(hero);
    }
    expect(Object.keys(SKILLS).length).toBe(20);
    expect(new Set([...WARDEN, ...WANDERER]).size).toBe(20);
  });

  it('covers many different jobs, not one attack under ten names', () => {
    for (const hero of ['warden', 'wanderer'] as HeroId[]) {
      const roles = new Set(SKILL_ORDER[hero].map((id) => SKILLS[id].role));
      expect(roles.size).toBeGreaterThanOrEqual(8);
    }
  });

  it('keeps the four original skills exactly as they were', () => {
    const { sunder, charge, volley, seal } = SKILLS;
    expect([sunder.cooldown, sunder.castTime, sunder.radius, sunder.damageMult, sunder.knockback, sunder.stun]).toEqual([7.5, 0.28, 2.4, 2.6, 9, 1.1]);
    expect([charge.cooldown, charge.distance, charge.duration, charge.width, charge.damageMult, charge.knockback, charge.stun]).toEqual([6, 4.2, 0.32, 0.75, 1.8, 6, 0.5]);
    expect([volley.cooldown, volley.bolts, volley.arcDeg, volley.damageMult, volley.pierce, volley.speed, volley.range]).toEqual([6, 7, 70, 1.2, 1, 15, 7]);
    expect([seal.cooldown, seal.radius, seal.duration, seal.tick, seal.damageMult, seal.slow]).toEqual([9, 2.3, 4, 0.5, 0.5, 0.5]);
  });

  it('starts every class with two usable skills and unlocks the rest with progress', () => {
    expect(starterSkills('warden')).toEqual(['sunder', 'charge']);
    expect(starterSkills('wanderer')).toEqual(['volley', 'seal']);
    expect(unlockedSkills('warden', NO_PROGRESS)).toEqual(['sunder', 'charge']);
    expect(unlockedSkills('wanderer', MAXED).length).toBe(SKILLS_PER_CLASS);
  });

  it('is able to catch a broken table', () => {
    const axe = SKILLS.axe as { cooldown: number };
    const old = axe.cooldown;
    axe.cooldown = 0;
    try {
      expect(validateSkillData().some((p) => p.includes('axe'))).toBe(true);
    } finally {
      axe.cooldown = old;
    }
    expect(validateSkillData()).toEqual([]);
  });
});

// ───────────────────────────── rules ─────────────────────────────

describe('loadout rules', () => {
  it('refuses locked skills, skills of the other class, repeats and a fourth skill', () => {
    expect(canAdd('warden', [], 'crush', NO_PROGRESS)).toBe('locked');
    expect(canAdd('warden', [], 'volley', MAXED)).toBe('wrongClass');
    expect(canAdd('wanderer', [], 'sunder', MAXED)).toBe('wrongClass');
    expect(canAdd('warden', ['sunder'], 'sunder', MAXED)).toBe('duplicate');
    expect(canAdd('warden', ['sunder', 'charge', 'crush'], 'pact', MAXED)).toBe('full');
    expect(canAdd('warden', ['sunder'], 'charge', NO_PROGRESS)).toBeNull();
    expect(canAdd('warden', [], 'nonsense' as SkillId, MAXED)).toBe('unknown');
  });

  it('validates a whole loadout', () => {
    expect(checkLoadout('warden', ['sunder', 'charge'], NO_PROGRESS)).toBeNull();
    expect(checkLoadout('warden', [], NO_PROGRESS)).toBe('empty');
    expect(checkLoadout('warden', ['sunder', 'charge', 'crush', 'pact'], MAXED)).toBe('full');
    expect(checkLoadout('warden', ['sunder', 'crush'], NO_PROGRESS)).toBe('locked');
    expect(checkLoadout('warden', ['sunder', 'seal'], MAXED)).toBe('wrongClass');
    expect(checkLoadout('warden', ['sunder', 'sunder'], MAXED)).toBe('duplicate');
    expect(checkLoadout('warden', [7], MAXED)).toBe('unknown');
  });

  it('opens each requirement exactly at its threshold', () => {
    const at = (patch: Partial<HeroProgress>): HeroProgress => ({ ...NO_PROGRESS, ...patch });
    expect(isUnlocked('crush', at({ runs: 1 }))).toBe(false);
    expect(isUnlocked('crush', at({ runs: 2 }))).toBe(true);
    expect(isUnlocked('warcry', at({ kills: 59 }))).toBe(false);
    expect(isUnlocked('warcry', at({ kills: 60 }))).toBe(true);
    expect(isUnlocked('bastion', at({ bestFloor: 1 }))).toBe(false);
    expect(isUnlocked('bastion', at({ bestFloor: 2 }))).toBe(true);
    expect(isUnlocked('pact', at({ wins: 0 }))).toBe(false);
    expect(isUnlocked('pact', at({ wins: 1 }))).toBe(true);
  });

  it('describes every requirement in words', () => {
    for (const id of Object.keys(SKILLS) as SkillId[]) expect(unlockText(SKILLS[id].unlock).length).toBeGreaterThan(4);
    expect(unlockText({ type: 'kills', n: 60 })).toContain('60');
    expect(unlockText({ type: 'runs', n: 2 })).toContain('2 wyprawy');
  });

  it('repairs a tampered loadout instead of trusting it', () => {
    expect(sanitizeLoadout('warden', ['crush', 'volley', 'sunder', 'sunder', 'pact', 'bogus', 42], NO_PROGRESS)).toEqual(['sunder']);
    expect(sanitizeLoadout('warden', ['pact', 'crush', 'warcry', 'bastion'], MAXED)).toEqual(['pact', 'crush', 'warcry']);
    expect(sanitizeLoadout('wanderer', 'not an array', NO_PROGRESS)).toEqual(['volley']);
    expect(sanitizeLoadout('wanderer', [], MAXED)).toEqual(['volley']);
  });

  it('reports skills a run unlocked, in display order', () => {
    expect(newlyUnlocked('warden', NO_PROGRESS, { runs: 2, kills: 70, bestFloor: 2, wins: 0 })).toEqual(['crush', 'warcry', 'bastion']);
    expect(newlyUnlocked('warden', MAXED, MAXED)).toEqual([]);
  });
});

// ───────────────────────────── save ─────────────────────────────

describe('skills in the save', () => {
  it('starts a new save with one starter skill per class and no progress', () => {
    const s = defaultSave();
    expect(s.loadout).toEqual({ warden: ['sunder'], wanderer: ['volley'] });
    expect(s.progress.warden).toEqual(NO_PROGRESS);
  });

  it('will not equip locked, foreign or a fourth skill, and keeps the last one', () => {
    const s = defaultSave();
    expect(equipSkill(s, 'warden', 'crush')).toBe('locked');
    expect(equipSkill(s, 'warden', 'volley')).toBe('wrongClass');
    expect(equipSkill(s, 'warden', 'sunder')).toBe('duplicate');
    expect(skillLoadout(s, 'warden')).toEqual(['sunder']);
    s.progress.warden = { ...MAXED };
    expect(equipSkill(s, 'warden', 'charge')).toBeNull();
    expect(equipSkill(s, 'warden', 'pact')).toBeNull();
    expect(equipSkill(s, 'warden', 'axe')).toBe('full');
    expect(skillLoadout(s, 'warden')).toEqual(['sunder', 'charge', 'pact']);
    expect(unequipSkill(s, 'warden', 'charge')).toBeNull();
    expect(unequipSkill(s, 'warden', 'pact')).toBeNull();
    expect(unequipSkill(s, 'warden', 'sunder')).toBe('last');
    expect(skillLoadout(s, 'warden')).toEqual(['sunder']);
    // the other class is untouched
    expect(skillLoadout(s, 'wanderer')).toEqual(['volley']);
  });

  it('turns finished runs into class progress and unlocks', () => {
    const s = defaultSave();
    const r1 = bankRun(s, { hero: 'warden', ash: 10, won: false, floor: 1, kills: 10, keepFraction: 0.6, bonus: 40 });
    expect(r1.unlocked).toEqual([]);
    const r2 = bankRun(s, { hero: 'warden', ash: 10, won: false, floor: 2, kills: 60, keepFraction: 0.6, bonus: 40 });
    expect(r2.unlocked).toEqual(['crush', 'warcry', 'bastion']);
    expect(s.progress.warden).toEqual({ runs: 2, kills: 70, bestFloor: 2, wins: 0 });
    expect(s.progress.wanderer).toEqual(NO_PROGRESS);
    expect(equipSkill(s, 'warden', 'crush')).toBeNull();
    expect(equipSkill(s, 'wanderer', 'snipe')).toBe('locked');
  });

  it('keeps the loadout and progress through save and load', () => {
    const s = defaultSave();
    s.progress.wanderer = { ...MAXED };
    expect(equipSkill(s, 'wanderer', 'blink')).toBeNull();
    expect(equipSkill(s, 'wanderer', 'mine')).toBeNull();
    const back = parseSave(JSON.parse(JSON.stringify(s)))!;
    expect(back.loadout.wanderer).toEqual(['volley', 'blink', 'mine']);
    expect(back.progress.wanderer).toEqual(MAXED);
    expect(back).toEqual(s);
  });

  it('migrates a version 2 save to the starter loadout', () => {
    const v2 = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    v2.version = 2;
    delete v2.progress;
    delete v2.loadout;
    const s = parseSave(v2)!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.loadout).toEqual({ warden: ['sunder'], wanderer: ['volley'] });
    expect(s.progress.warden).toEqual(NO_PROGRESS);
  });

  it('does not let a hand-edited save unlock or equip skills it has not earned', () => {
    const raw = JSON.parse(JSON.stringify(defaultSave())) as Record<string, any>;
    raw.loadout = { warden: ['pact', 'sunder', 'volley'], wanderer: ['starfall', 'ward', 'volley', 'seal'] };
    raw.progress = { warden: { runs: -5, kills: 'lots', bestFloor: 1e99, wins: 0 }, wanderer: {} };
    const s = parseSave(raw)!;
    expect(s.loadout.warden).toEqual(['sunder']);
    expect(s.loadout.wanderer).toEqual(['volley', 'seal']);
    expect(s.progress.warden.runs).toBe(0);
    expect(s.progress.warden.kills).toBe(0);
  });
});

// ───────────────────────────── in the simulation ─────────────────────────────

/** Parks an enemy next to the hero so it cannot fight back. */
function dummy(sim: ReturnType<typeof sandbox>, kind: 'thrall' | 'brute', dx: number, dy = 0): Enemy {
  const e = sim.spawnEnemy(kind, sim.hero.x + dx, sim.hero.y + dy, { instant: true });
  e.state = 'stunned';
  e.stateT = e.stateDur = 999;
  return e;
}

const noCrit = <T extends ReturnType<typeof sandbox>>(sim: T): T => {
  sim.hero.stats.critChance = 0;
  return sim;
};

/** No crits and no auto-attack, so only the skill under test deals damage. */
const quiet = <T extends ReturnType<typeof sandbox>>(sim: T): T => {
  noCrit(sim);
  sim.hero.stats.attackRange = 0;
  return sim;
};

const dealt = (ev: ReturnType<typeof run>, source: string) => ev.filter((x) => x.type === 'damage' && x.source === source);

const casts = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'skillCast');

describe('three skill slots', () => {
  it('wears at most three skills, whatever the build asks for', () => {
    const sim = sandbox(openRoom(), { skills: ['sunder', 'charge', 'crush', 'pact'] });
    expect(sim.hero.skills.map((s) => s.def.id)).toEqual(['sunder', 'charge', 'crush']);
  });

  it('casts only the slot that was pressed and gives each its own cooldown', () => {
    const sim = sandbox(openRoom(), { skills: ['bastion', 'warcry', 'whirl'] });
    const ev = run(sim, 0.1, { skill2: true });
    expect(casts(ev).map((e) => (e as { skill: SkillId }).skill)).toEqual(['warcry']);
    const [a, b, c] = sim.hero.skills;
    expect(a!.cd).toBe(0);
    expect(b!.cd).toBeGreaterThan(SKILLS.warcry.cooldown - 0.5);
    expect(c!.cd).toBe(0);
    const ev2 = run(sim, 0.4, { skill3: true });
    expect(casts(ev2).map((e) => (e as { skill: SkillId }).skill)).toEqual(['whirl']);
    expect(b!.cd).toBeGreaterThan(SKILLS.warcry.cooldown - 1.2);
  });

  it('never fires two skills in the same instant', () => {
    const sim = sandbox(openRoom(), { skills: ['bastion', 'warcry', 'overload'] });
    const ev = run(sim, 0.3, { skill: true, skill2: true, skill3: true });
    expect(casts(ev).length).toBe(1);
    expect((casts(ev)[0] as { skill: SkillId }).skill).toBe('bastion');
    // after the short lock another slot works
    const ev2 = run(sim, 0.1, { skill2: true });
    expect(casts(ev2).length).toBe(1);
  });

  it('lets a slot be pressed in the lock window and still fire (input buffer)', () => {
    expect(SKILL_RULES.globalCooldown).toBeGreaterThan(COMMON.inputBuffer);
    const sim = sandbox(openRoom(), { skills: ['bastion', 'warcry'] });
    run(sim, 0.05, { skill: true });
    expect(sim.hero.skillLock).toBeGreaterThan(0);
  });
});

describe('warden skills', () => {
  it('Miażdżący Cios: one huge hit on the nearest enemy, nothing (and no cooldown) without one', () => {
    const sim = noCrit(sandbox(openRoom(), { skills: ['crush'] }));
    const none = run(sim, 0.1, { skill: true });
    expect(none.some((e) => e.type === 'skillFizzle')).toBe(true);
    expect(sim.hero.skills[0]!.cd).toBe(0);
    const e = dummy(sim, 'brute', 1.6);
    const ev = run(sim, SKILLS.crush.castTime + 0.1, { skill: true });
    const hit = ev.find((x) => x.type === 'damage' && x.targetId === e.id);
    expect(hit && hit.type === 'damage' ? hit.amount : 0).toBe(Math.round(sim.hero.stats.damage * SKILLS.crush.damageMult));
    expect(sim.hero.skills[0]!.cd).toBeGreaterThan(SKILLS.crush.cooldown - 0.5);
  });

  it('Miażdżący Cios: gives half the cooldown back when the target is gone', () => {
    const sim = noCrit(sandbox(openRoom(), { skills: ['crush'] }));
    const e = dummy(sim, 'thrall', 1.6);
    run(sim, 0.1, { skill: true });
    e.hp = 0;
    e.state = 'dead';
    run(sim, SKILLS.crush.castTime + 0.1);
    expect(sim.hero.skills[0]!.cd).toBeLessThan(SKILLS.crush.cooldown * 0.6);
  });

  it('Bastion: cuts incoming damage for its duration only', () => {
    const plain = sandbox(openRoom(), { skills: ['bastion'] });
    plain.damageHero(40);
    const lossPlain = plain.hero.stats.maxHp - plain.hero.hp;
    const sim = sandbox(openRoom(), { skills: ['bastion'] });
    run(sim, 0.1, { skill: true });
    sim.damageHero(40);
    const loss = sim.hero.stats.maxHp - sim.hero.hp;
    expect(loss).toBeCloseTo(lossPlain * (1 - SKILLS.bastion.reduction), 5);
    run(sim, SKILLS.bastion.duration + 0.2);
    const before = sim.hero.hp;
    sim.damageHero(40);
    expect(before - sim.hero.hp).toBeCloseTo(lossPlain, 5);
  });

  it('Okrzyk Wojny: shoves everything away without hurting it', () => {
    const sim = sandbox(openRoom(), { skills: ['warcry'] });
    const e = dummy(sim, 'thrall', 2);
    const d0 = Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y);
    run(sim, 0.6, { skill: true });
    expect(Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y)).toBeGreaterThan(d0 + 0.8);
    expect(e.hp).toBe(e.maxHp);
  });

  it('Rzut Toporem: one throw goes through a whole line of enemies', () => {
    const sim = quiet(sandbox(openRoom(), { skills: ['axe'] }));
    const line = [dummy(sim, 'brute', 2), dummy(sim, 'brute', 3.4), dummy(sim, 'brute', 4.8)];
    run(sim, 1, { skill: true });
    for (const e of line) expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('Łańcuch Popiołu: drags distant enemies in next to you', () => {
    const sim = sandbox(openRoom(), { skills: ['hook'] });
    const e = dummy(sim, 'thrall', 4.5);
    run(sim, 1, { skill: true });
    expect(Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y)).toBeLessThan(SKILLS.hook.stopAt + 0.8);
  });

  it('Łańcuch Popiołu: cannot reach through a wall', () => {
    const map = openRoom({ 8: '#' + '.'.repeat(9) + '#' + '.'.repeat(4) + '#' });
    const sim = sandbox(map, { skills: ['hook'] });
    const e = sim.spawnEnemy('thrall', 11.5, sim.hero.y, { instant: true });
    e.state = 'stunned';
    e.stateT = e.stateDur = 999;
    const x0 = e.x;
    run(sim, 0.8, { skill: true });
    expect(e.x).toBeCloseTo(x0, 1);
  });

  it('Sztandar Popiołu: speeds attacks and heals only while you stand in it', () => {
    const sim = sandbox(openRoom(), { skills: ['banner'] });
    sim.hero.hp = 50;
    run(sim, 0.1, { skill: true });
    run(sim, 2);
    expect(sim.hero.inBanner).toBe(true);
    expect(sim.hero.hp).toBeGreaterThan(50 + sim.hero.stats.maxHp * SKILLS.banner.regen * 1.5);
    run(sim, 1.2, { moveX: 1 });
    run(sim, 1.2, { moveX: 1 });
    expect(sim.hero.inBanner).toBe(false);
    const hp = sim.hero.hp;
    run(sim, 1);
    expect(sim.hero.hp).toBeCloseTo(hp, 0);
  });

  it('Wir Ostrzy: hits every few moments, slows walking, then ends', () => {
    const sim = noCrit(sandbox(openRoom(), { skills: ['whirl'] }));
    const e = dummy(sim, 'brute', 1);
    const ev = run(sim, SKILLS.whirl.duration + 0.4, { skill: true });
    const hits = ev.filter((x) => x.type === 'damage' && x.targetId === e.id && x.source === 'skill');
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(sim.hero.whirlT).toBe(0);

    const walkPlain = sandbox(openRoom(), { skills: ['whirl'] });
    const walkWhirl = sandbox(openRoom(), { skills: ['whirl'] });
    const x0 = walkPlain.hero.x;
    run(walkPlain, 1, { moveX: 1 });
    run(walkWhirl, 1, { moveX: 1, skill: true });
    const plain = walkPlain.hero.x - x0;
    const slowed = walkWhirl.hero.x - x0;
    expect(slowed).toBeLessThan(plain * 0.85);
    expect(slowed).toBeGreaterThan(plain * 0.4);
  });

  it('Krwawy Pakt: costs health (never all of it), then hits harder and heals from hits', () => {
    const sim = noCrit(sandbox(openRoom(), { skills: ['pact', 'crush'] }));
    run(sim, 0.1, { skill: true });
    expect(sim.hero.hp).toBeCloseTo(sim.hero.stats.maxHp * (1 - SKILLS.pact.selfCost), 5);
    expect(sim.hero.pactT).toBeGreaterThan(0);
    const e = dummy(sim, 'brute', 1.6);
    const hpBefore = sim.hero.hp;
    const ev = run(sim, 0.3 + SKILLS.crush.castTime + 0.2, { skill2: true });
    const hit = ev.find((x) => x.type === 'damage' && x.targetId === e.id);
    const amount = hit && hit.type === 'damage' ? hit.amount : 0;
    expect(amount).toBe(Math.round(sim.hero.stats.damage * SKILLS.crush.damageMult * (1 + SKILLS.pact.damageBonus)));
    expect(sim.hero.hp).toBeGreaterThan(hpBefore);

    const low = sandbox(openRoom(), { skills: ['pact'] });
    low.hero.hp = 4;
    run(low, 0.1, { skill: true });
    expect(low.hero.hp).toBe(1);
    expect(low.hero.state).not.toBe('dead');
  });
});

describe('wanderer skills', () => {
  it('Strzał Przeszywający: one hard shot through several enemies; no target, no shot', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['snipe'] }));
    const none = run(sim, 0.1, { skill: true });
    expect(none.some((e) => e.type === 'skillFizzle')).toBe(true);
    expect(sim.hero.skills[0]!.cd).toBe(0);
    const a = dummy(sim, 'brute', 3);
    const b = dummy(sim, 'brute', 5);
    const ev = run(sim, 0.8, { skill: true });
    const dmg = dealt(ev, 'bolt');
    expect(dmg.map((x) => (x.type === 'damage' ? x.targetId : -1)).sort()).toEqual([a.id, b.id].sort());
    expect(dmg[0]!.type === 'damage' ? dmg[0]!.amount : 0).toBe(Math.round(sim.hero.stats.damage * SKILLS.snipe.damageMult));
  });

  it('Krok Otchłani: hops along the stick, stops at a wall, and is untouchable for a moment', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer', skills: ['blink'] });
    const x0 = sim.hero.x;
    run(sim, 0.02, { moveX: 1, skill: true });
    expect(sim.hero.x - x0).toBeGreaterThan(SKILLS.blink.distance - 0.2);
    expect(sim.hero.x - x0).toBeLessThan(SKILLS.blink.distance + 0.6);
    expect(sim.hero.iframeT).toBeGreaterThan(0);

    const wall = sandbox(openRoom(), { hero: 'wanderer', skills: ['blink'] });
    wall.hero.x = wall.hero.px = 13.3;
    run(wall, 0.02, { moveX: 1, skill: true });
    expect(wall.hero.x).toBeLessThan(15 - wall.hero.r + 1e-6);
  });

  it('Bariera Pustki: soaks damage until used up or expired', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer', skills: ['ward'] });
    run(sim, 0.1, { skill: true });
    const cap = SKILLS.ward.flat + SKILLS.ward.hpFraction * sim.hero.stats.maxHp;
    expect(sim.hero.shield).toBeCloseTo(cap, 5);
    sim.damageHero(30);
    expect(sim.hero.hp).toBe(sim.hero.stats.maxHp);
    run(sim, COMMON.hurtIframes + 0.05);
    sim.damageHero(30);
    expect(sim.hero.shield).toBe(0);
    expect(sim.hero.hp).toBeCloseTo(sim.hero.stats.maxHp - (60 - cap), 5);

    const lapse = sandbox(openRoom(), { hero: 'wanderer', skills: ['ward'] });
    run(lapse, 0.1, { skill: true });
    run(lapse, SKILLS.ward.duration + 0.2);
    expect(lapse.hero.shield).toBe(0);
  });

  it('Szron Otchłani: freezes and hurts what is inside the ring, not what is outside', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['frost'] }));
    const near = dummy(sim, 'thrall', 2);
    const far = dummy(sim, 'thrall', 5.5);
    run(sim, 0.1, { skill: true });
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(near.frozenT).toBeGreaterThan(0);
    expect(far.hp).toBe(far.maxHp);
    expect(far.frozenT).toBe(0);
  });

  it('Kryształowy Wartownik: shoots on its own, then goes away', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['sentry'] }));
    const e = dummy(sim, 'brute', 4);
    run(sim, 0.1, { skill: true });
    expect(sim.zones.some((z) => z.kind === 'sentry')).toBe(true);
    const ev = run(sim, 3);
    expect(dealt(ev, 'bolt').filter((x) => x.type === 'damage' && x.targetId === e.id).length).toBeGreaterThanOrEqual(2);
    run(sim, SKILLS.sentry.duration);
    expect(sim.zones.some((z) => z.kind === 'sentry')).toBe(false);
  });

  it('Mina Pustki: waits to be armed, blows only for an enemy that comes close, and there are at most three', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['mine'] }));
    run(sim, 0.1, { skill: true });
    const mine = sim.zones.find((z) => z.kind === 'mine')!;
    expect(mine).toBeTruthy();
    const e = sim.spawnEnemy('brute', mine.x + 0.8, mine.y, { instant: true });
    e.state = 'stunned';
    e.stateT = e.stateDur = 999;
    const early = run(sim, 0.3);
    expect(sim.zones.some((z) => z.kind === 'mine')).toBe(true); // not armed yet
    expect(dealt(early, 'skill').length).toBe(0);
    run(sim, 0.6);
    expect(sim.zones.some((z) => z.kind === 'mine')).toBe(false);
    expect(e.hp).toBeLessThan(e.maxHp - sim.hero.stats.damage * SKILLS.mine.damageMult * 0.9);

    const many = sandbox(openRoom(), { hero: 'wanderer', skills: ['mine'] });
    for (let i = 0; i < 5; i++) {
      many.hero.skills[0]!.cd = 0;
      run(many, 0.3, { skill: true });
    }
    expect(many.zones.filter((z) => z.kind === 'mine').length).toBe(SKILLS.mine.max);
  });

  it('Mina Pustki: an enemy far away does not set it off', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['mine'] }));
    run(sim, 0.1, { skill: true });
    dummy(sim, 'brute', 4);
    const ev = run(sim, 2);
    expect(sim.zones.some((z) => z.kind === 'mine')).toBe(true);
    expect(dealt(ev, 'skill').length).toBe(0);
  });

  it('Gwiezdny Deszcz: marks enemies, then a star lands on each; with nobody around it does nothing', () => {
    const sim = quiet(sandbox(openRoom(), { hero: 'wanderer', skills: ['starfall'] }));
    const none = run(sim, 0.1, { skill: true });
    expect(none.some((e) => e.type === 'skillFizzle')).toBe(true);
    expect(sim.hero.skills[0]!.cd).toBe(0);
    const a = dummy(sim, 'brute', 3);
    const b = dummy(sim, 'brute', -3);
    run(sim, 0.05, { skill: true });
    expect(sim.zones.filter((z) => z.kind === 'star').length).toBe(2);
    expect(a.hp).toBe(a.maxHp);
    run(sim, SKILLS.starfall.delay + 0.2);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(sim.zones.some((z) => z.kind === 'star')).toBe(false);
  });

  it('Przeciążenie: shoots faster and pierces one more, only for a while', () => {
    const fast = sandbox(openRoom(), { hero: 'wanderer', skills: ['overload'] });
    const slow = sandbox(openRoom(), { hero: 'wanderer', skills: ['overload'] });
    fast.hero.attackCd = slow.hero.attackCd = 1;
    run(fast, 0.4, { skill: true });
    run(slow, 0.4);
    expect(fast.hero.attackCd).toBeLessThan(slow.hero.attackCd - 0.1);

    const sim = sandbox(openRoom(), { hero: 'wanderer', skills: ['overload'] });
    dummy(sim, 'brute', 3);
    run(sim, 0.1, { skill: true });
    let pierce = -1;
    for (let i = 0; i < 90 && pierce < 0; i++) {
      run(sim, 1 / 60);
      const p = sim.projectiles.find((q) => q.team === 'hero');
      if (p) pierce = p.pierceLeft;
    }
    expect(pierce).toBe(sim.hero.stats.pierce + SKILLS.overload.pierce);
    run(sim, SKILLS.overload.duration + 0.3);
    expect(sim.hero.overloadT).toBe(0);
  });
});

describe('every skill can be cast without breaking the simulation', () => {
  for (const hero of ['warden', 'wanderer'] as HeroId[]) {
    for (const id of SKILL_ORDER[hero]) {
      it(`${hero}: ${id}`, () => {
        const sim = sandbox(openRoom(), { hero, skills: [id] });
        sim.spawnEnemy('thrall', sim.hero.x + 2, sim.hero.y, { instant: true });
        sim.spawnEnemy('brute', sim.hero.x - 2.5, sim.hero.y + 1, { instant: true });
        run(sim, 0.2);
        const ev = run(sim, 3, { skill: true, moveX: 0.3 });
        expect(ev.some((e) => e.type === 'skillCast' && e.skill === id)).toBe(true);
        for (const e of sim.enemies) expect(Number.isFinite(e.x + e.y + e.hp)).toBe(true);
        expect(Number.isFinite(sim.hero.x + sim.hero.y + sim.hero.hp)).toBe(true);
        expect(sim.hero.hp).toBeGreaterThan(0);
      });
    }
  }
});

describe('determinism with skills', () => {
  it('replays the same fight with all three slots in use', () => {
    const play = () => {
      const sim = sandbox(openRoom(), { seed: 7, skills: ['whirl', 'hook', 'warcry'] });
      sim.spawnEnemy('thrall', 11, 8, { instant: true });
      sim.spawnEnemy('thrall', 5, 8, { instant: true });
      sim.spawnEnemy('brute', 8, 12, { instant: true });
      for (let i = 0; i < 12; i++) run(sim, 0.5, { skill: i % 3 === 0, skill2: i % 3 === 1, skill3: i % 3 === 2, moveX: Math.cos(i), moveY: Math.sin(i) });
      return sim.stateHash();
    };
    expect(play()).toBe(play());
  });
});
