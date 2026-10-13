import { describe, expect, it } from 'vitest';
import { COMMON, ENEMIES } from '../src/config/balance';
import { HEROES } from '../src/config/heroes';
import { NO_RANKS, RANKS, xpToNext } from '../src/config/progression';
import { SKILLS } from '../src/config/skills';
import { UPGRADES, type UpgradeId } from '../src/config/upgrades';
import { isoMoveScale, worldToScreenX, worldToScreenY } from '../src/core/iso';
import { bankRun, buyRank, defaultSave, parseSave } from '../src/meta/save';
import { computeStats, emptyUpgrades } from '../src/sim/stats';
import { openRoom, run, sandbox } from './helpers';

describe('stats', () => {
  it('class base, ranks and upgrades stack in one formula', () => {
    const base = computeStats(HEROES.warden, NO_RANKS, emptyUpgrades());
    expect(base.maxHp).toBe(HEROES.warden.maxHp);
    const ranked = computeStats(HEROES.warden, { ...NO_RANKS, vitality: 2, might: 1 }, emptyUpgrades());
    expect(ranked.maxHp).toBe(HEROES.warden.maxHp + 20);
    expect(ranked.damage).toBeCloseTo(HEROES.warden.attack.damage * 1.06, 6);
    const up = { ...emptyUpgrades(), haste: 2, power: 1 };
    const s = computeStats(HEROES.warden, NO_RANKS, up);
    expect(s.attackInterval).toBeCloseTo(HEROES.warden.attack.interval / 1.2, 6);
    expect(s.damage).toBeCloseTo(HEROES.warden.attack.damage * 1.12, 6);
  });

  it('armour is capped so nothing becomes immortal', () => {
    const s = computeStats(HEROES.warden, { ...NO_RANKS, guard: 4 }, { ...emptyUpgrades(), ward: 4 });
    expect(s.armor).toBeLessThanOrEqual(0.6);
  });
});

describe('xp, levels and upgrade choices', () => {
  it('kills grant xp; reaching the threshold levels up and opens a choice of 3', () => {
    const sim = sandbox();
    sim.grantXp(xpToNext(1));
    expect(sim.hero.level).toBe(2);
    expect(sim.choices).toHaveLength(1);
    expect(sim.choices[0]!.options).toHaveLength(3);
    expect(new Set(sim.choices[0]!.options).size).toBe(3);
  });

  it('applying a choice raises the stat; an invalid choice changes nothing', () => {
    const sim = sandbox();
    sim.grantXp(xpToNext(1));
    const opts = sim.choices[0]!.options;
    const notOffered = (Object.keys(UPGRADES) as UpgradeId[]).find((u) => !opts.includes(u))!;
    expect(sim.applyChoice(notOffered)).toBe(false);
    expect(sim.choices).toHaveLength(1);
    expect(sim.applyChoice(opts[0]!)).toBe(true);
    expect(sim.hero.upgrades[opts[0] as UpgradeId]).toBe(1);
    expect(sim.choices).toHaveLength(0);
  });

  it('vigor raises max HP and heals the same amount', () => {
    const sim = sandbox();
    sim.hero.hp = 50;
    sim.hero.upgrades.vigor = 1;
    sim.recomputeStats();
    expect(sim.hero.stats.maxHp).toBe(HEROES.warden.maxHp + 20);
    expect(sim.hero.hp).toBe(70);
  });

  it('never offers upgrades past their stack cap or for the wrong hero', () => {
    const sim = sandbox(openRoom(), { hero: 'warden' });
    for (const id of Object.keys(UPGRADES) as UpgradeId[]) if (id !== 'feast') sim.hero.upgrades[id] = UPGRADES[id].maxStacks;
    sim.queueChoice('level');
    // the stat cards are exactly what is left; anything else on offer is an upgrade of a worn skill
    const offered = sim.choices[0]!.options;
    expect(offered.filter((id) => id in UPGRADES)).toEqual(['feast']);
    expect(offered.filter((id) => !(id in UPGRADES)).every((id) => id.startsWith('sunder.'))).toBe(true);
    const w = sandbox(openRoom(), { hero: 'wanderer' });
    for (let i = 0; i < 40; i++) w.queueChoice('chest');
    expect(w.choices.flatMap((c) => c.options)).not.toContain('wideArc');
  });

  it('killing an enemy drops ash that the hero collects by walking near it', () => {
    const sim = sandbox();
    const e = sim.spawnEnemy('brute', sim.hero.x + 1.2, sim.hero.y, { instant: true });
    e.hp = 1;
    run(sim, 0.4);
    expect(e.state).toBe('dead');
    expect(sim.pickups.length + sim.ash).toBeGreaterThanOrEqual(ENEMIES.brute.ash);
    run(sim, 2);
    expect(sim.ash).toBe(ENEMIES.brute.ash);
  });
});

describe('skills and projectiles', () => {
  it('wanderer auto-attack fires bolts that hit and are stopped by walls', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer' });
    const h = sim.hero;
    const e = sim.spawnEnemy('thrall', h.x + 4, h.y, { instant: true });
    e.state = 'stunned';
    e.stateT = 99;
    const ev = run(sim, 1);
    expect(ev.some((x) => x.type === 'shoot' && x.team === 'hero')).toBe(true);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('acolyte embers can be dodged through, but hit a hero who stands still', () => {
    const still = sandbox();
    const a = still.spawnEnemy('acolyte', still.hero.x + 4, still.hero.y, { instant: true });
    run(still, ENEMIES.acolyte.attack.windup + 1.2);
    expect(a.state).not.toBe('dead');
    expect(still.hero.hp).toBeLessThan(still.hero.stats.maxHp);

    const roll = sandbox();
    roll.spawnEnemy('acolyte', roll.hero.x + 4, roll.hero.y, { instant: true });
    // dodge sideways just as the ember would arrive
    run(roll, ENEMIES.acolyte.attack.windup + 0.35);
    run(roll, 0.4, { moveY: 1, dodge: true });
    run(roll, 0.6, { moveY: 1 });
    expect(roll.hero.hp).toBe(roll.hero.stats.maxHp);
  });

  it('charge carries the hero forward, is invulnerable and damages enemies on the line', () => {
    const sim = sandbox(openRoom(), { skill: 'charge' });
    const h = sim.hero;
    h.x = 4.5;
    const e = sim.spawnEnemy('thrall', 6.5, h.y, { instant: true });
    e.state = 'stunned';
    e.stateT = 99;
    const x0 = h.x;
    const ev = run(sim, SKILLS.charge.duration + 0.05, { moveX: 1, skill: true });
    expect(h.x - x0).toBeGreaterThan(SKILLS.charge.distance * 0.9);
    expect(ev.some((x) => x.type === 'damage' && x.targetId === e.id && x.source === 'skill')).toBe(true);
  });

  it('seal slows enemies standing in it', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer', skill: 'seal' });
    const e = sim.spawnEnemy('thrall', sim.hero.x + 1, sim.hero.y, { instant: true });
    run(sim, 0.1, { skill: true });
    expect(sim.zones).toHaveLength(1);
    expect(e.slowMul).toBe(SKILLS.seal.slow);
  });

  it('volley fires its full fan', () => {
    const sim = sandbox(openRoom(), { hero: 'wanderer', skill: 'volley' });
    const ev = run(sim, 0.05, { skill: true });
    expect(ev.filter((x) => x.type === 'shoot' && x.team === 'hero')).toHaveLength(SKILLS.volley.bolts);
  });
});

describe('movement feel', () => {
  it('on-screen speed differs far less between directions than raw isometric speed', () => {
    const screenSpeed = (dx: number, dy: number) => {
      const l = Math.hypot(dx, dy);
      const k = isoMoveScale(dx, dy, COMMON.isoCompensation);
      return Math.hypot(worldToScreenX((dx / l) * k, (dy / l) * k), worldToScreenY((dx / l) * k, (dy / l) * k));
    };
    const horizontal = screenSpeed(1, -1);
    const vertical = screenSpeed(1, 1);
    expect(horizontal / vertical).toBeLessThan(1.3); // raw 2:1 projection would be 2.0
    expect(isoMoveScale(1, 0, COMMON.isoCompensation)).toBeCloseTo(1, 9);
  });

  it('walking speed stays constant while the auto-attack is hitting (no hit-stop stutter)', () => {
    const sim = sandbox();
    const h = sim.hero;
    h.x = 3.5;
    sim.hero.stats.critChance = 0;
    const e = sim.spawnEnemy('brute', 4.6, h.y + 1.0, { instant: true });
    e.state = 'stunned';
    e.stateT = 99;
    e.hp = e.maxHp = 1e6;
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) {
      run(sim, 1 / 60, { moveY: -1 });
      xs.push(h.y);
    }
    const steps = xs.slice(1).map((y, i) => xs[i]! - y);
    expect(sim.kills).toBe(0);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6);
  });
});

describe('save data', () => {
  it('round-trips and rejects garbage instead of treating it as empty', () => {
    const s = defaultSave();
    s.ash = 50;
    s.ranks.might = 2;
    expect(parseSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseSave(null)).toBeNull();
    expect(parseSave({ version: 1, ash: -5, ranks: {} })).toBeNull();
    expect(parseSave({ version: 1, ash: 10, ranks: { might: 99 } })).toBeNull();
    expect(parseSave({ version: 999, ash: 10, ranks: {} })).toBeNull();
  });

  it('buying a rank spends ash and respects the cap', () => {
    const s = defaultSave();
    s.ash = 1000;
    const max = RANKS.agility.costs.length;
    for (let i = 0; i < max + 2; i++) buyRank(s, 'agility');
    expect(s.ranks.agility).toBe(max);
    expect(s.ash).toBe(1000 - RANKS.agility.costs.reduce((a, b) => a + b, 0));
    const poor = defaultSave();
    expect(buyRank(poor, 'might')).toBe(false);
    expect(poor.ranks.might).toBe(0);
  });

  it('banks part of the ash on death and all of it (plus a bonus) on victory', () => {
    const s = defaultSave();
    expect(bankRun(s, { hero: 'warden', ash: 100, won: false, floor: 2, kills: 30, keepFraction: 0.6, bonus: 40 }).gained).toBe(60);
    expect(bankRun(s, { hero: 'warden', ash: 100, won: true, floor: 3, kills: 50, keepFraction: 0.6, bonus: 40 }).gained).toBe(140);
    expect(s.ash).toBe(200);
    expect(s.stats).toEqual({ runs: 2, wins: 1, bestFloor: 3, kills: 80 });
  });
});
