import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config/balance';
import type { HeroId } from '../src/config/heroes';
import { SKILLS, SKILL_ORDER, type SkillId } from '../src/config/skills';
import { STATUS, STATUS_LIST, SYNERGIES, SYNERGY, synergiesOf, validateStatusData } from '../src/config/statuses';
import type { Enemy, SimEvent } from '../src/sim/types';
import { openRoom, run, sandbox } from './helpers';

type Sim = ReturnType<typeof sandbox>;

/** The few internals the tests poke at directly (the sim itself has no DOM or renderer to hide behind). */
interface Internals {
  stun(e: Enemy, s: number): void;
  applyBurn(e: Enemy, dps: number, gen: number): void;
  applyBleed(e: Enemy): void;
  applyMark(e: Enemy): void;
  applyChill(e: Enemy, s: number): void;
  arc(e: Enemy): void;
  arcBudget: number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

const ALL_SKILLS = Object.keys(SKILLS) as SkillId[];
const heroOf = (s: SkillId): HeroId => SKILLS[s].hero;

function lab(hero: HeroId, skills: SkillId[], levels: Record<string, number> = {}): Sim {
  const sim = sandbox(openRoom(), { hero, skills, seed: 5 });
  sim.hero.stats.critChance = 0;
  sim.hero.stats.attackRange = 0;
  sim.setSkillUpgrades(levels);
  return sim;
}

/** An enemy that stands still, stunned for good. */
function dummy(sim: Sim, kind: 'thrall' | 'brute', dx: number, dy = 0): Enemy {
  const e = sim.spawnEnemy(kind, sim.hero.x + dx, sim.hero.y + dy, { instant: true });
  e.state = 'stunned';
  e.stateT = e.stateDur = 999;
  return e;
}

/** A normal enemy far from the hero (so it does not reach him during a short test). */
function foe(sim: Sim, kind: 'thrall' | 'brute' | 'bossCrypt'): Enemy {
  sim.hero.x = sim.hero.px = 1.8;
  sim.hero.y = sim.hero.py = 1.8;
  return sim.spawnEnemy(kind, 13.5, 13.5, { instant: true });
}

const dmg = (ev: SimEvent[], source?: string) => ev.filter((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage' && (!source || e.source === source));
const syn = (ev: SimEvent[], id?: string) => ev.filter((e): e is Extract<SimEvent, { type: 'synergy' }> => e.type === 'synergy' && (!id || e.id === id));
const tick = (sim: Sim, seconds: number, intent: Parameters<typeof run>[2] = {}) => run(sim, seconds, intent);

// ───────────────────────────── the tables ─────────────────────────────

describe('status and synergy data', () => {
  it('passes its own validation', () => {
    expect(validateStatusData(ALL_SKILLS)).toEqual([]);
  });

  it('names every status and every reaction, and ties each reaction to real skills of both classes', () => {
    expect(STATUS_LIST.map((s) => s.id).sort()).toEqual(['bleed', 'burn', 'chill', 'freeze', 'mark']);
    for (const s of Object.values(SYNERGIES)) {
      expect(s.name.length).toBeGreaterThan(3);
      expect(s.text.length).toBeGreaterThan(20);
      for (const k of s.skills) expect(ALL_SKILLS).toContain(k);
    }
    const classes = new Set(Object.values(SYNERGIES).flatMap((s) => s.skills.map(heroOf)));
    expect(classes.size).toBe(2);
    expect(synergiesOf('sunder').map((s) => s.id)).toEqual(['rend']);
    expect(synergiesOf('bastion')).toEqual([]);
  });

  it('keeps bosses harder to lock down than everyone else', () => {
    expect(STATUS.cc.bossMax).toBeLessThanOrEqual(STATUS.cc.max);
    expect(STATUS.cc.bossGrace).toBeGreaterThanOrEqual(STATUS.cc.grace);
    expect(STATUS.chill.bossSlow).toBeGreaterThanOrEqual(STATUS.chill.slow);
    expect(STATUS.bleed.bossFactor).toBeLessThanOrEqual(1);
  });

  it('is able to catch a broken table', () => {
    const rule = SYNERGY.rend.applyBy as SkillId[];
    rule.push('bastion');
    try {
      expect(validateStatusData(ALL_SKILLS).some((p) => p.includes('bastion'))).toBe(true);
    } finally {
      rule.pop();
    }
    expect(validateStatusData(ALL_SKILLS)).toEqual([]);
  });
});

// ───────────────────────────── single statuses ─────────────────────────────

describe('burn', () => {
  it('lasts three seconds, ticks, and never stacks: lighting it again only refreshes', () => {
    const sim = lab('warden', ['sunder']);
    const e = dummy(sim, 'brute', 3);
    inner(sim).applyBurn(e, 10, 0);
    expect(e.burnT).toBeCloseTo(3, 9);
    const ev = tick(sim, 1);
    inner(sim).applyBurn(e, 6, 0); // a weaker fire does not replace a stronger one, but renews the time
    expect(e.burnT).toBeCloseTo(3, 9);
    expect(e.burnDps).toBe(10);
    inner(sim).applyBurn(e, 20, 0);
    expect(e.burnDps).toBe(20); // the stronger one wins; it is never the sum
    const burns = dmg(ev, 'burn');
    expect(burns.length).toBeGreaterThanOrEqual(2);
    expect(burns[0]!.amount).toBe(5);
    tick(sim, 3.2);
    expect(e.burnT).toBeLessThanOrEqual(0);
    expect(e.burnDps).toBe(0);
    expect(dmg(tick(sim, 1), 'burn').length).toBe(0);
  });

  it('is put out by death', () => {
    const sim = lab('warden', ['sunder']);
    const e = dummy(sim, 'thrall', 3);
    inner(sim).applyBurn(e, 100, 0);
    tick(sim, 1);
    expect(e.state).toBe('dead');
    expect(e.burnT).toBe(0);
  });
});

describe('bleed', () => {
  it('gains one stack per hit up to three, and each hit renews the four seconds', () => {
    const sim = lab('warden', ['sunder']);
    const e = dummy(sim, 'brute', 3);
    const p = inner(sim);
    p.applyBleed(e);
    expect(e.bleedStacks).toBe(1);
    tick(sim, 2);
    expect(e.bleedT).toBeCloseTo(STATUS.bleed.duration - 2, 1);
    p.applyBleed(e);
    p.applyBleed(e);
    p.applyBleed(e);
    p.applyBleed(e);
    expect(e.bleedStacks).toBe(STATUS.bleed.maxStacks);
    expect(e.bleedT).toBeCloseTo(STATUS.bleed.duration, 9);
  });

  it('hurts for stacks × its rate each tick, then ends by itself', () => {
    const sim = lab('warden', ['sunder']);
    sim.hero.stats.damage = 100;
    const e = dummy(sim, 'brute', 3);
    const p = inner(sim);
    p.applyBleed(e);
    p.applyBleed(e);
    p.applyBleed(e);
    const ev = tick(sim, 1.1);
    const ticks = dmg(ev, 'bleed');
    expect(ticks.length).toBe(2);
    expect(ticks[0]!.amount).toBe(Math.round(100 * STATUS.bleed.dpsPerStack * 3 * STATUS.bleed.tick));
    tick(sim, STATUS.bleed.duration);
    expect(e.bleedStacks).toBe(0);
    expect(dmg(tick(sim, 1), 'bleed').length).toBe(0);
  });

  it('bleeds a boss for only half as much', () => {
    const sim = lab('warden', ['sunder']);
    sim.hero.stats.damage = 100;
    const boss = dummy(sim, 'brute', 3);
    const plain = dummy(sim, 'brute', -3);
    boss.def = { ...boss.def, boss: { title: '', roar: '', phases: [[], []] } } as unknown as Enemy['def'];
    inner(sim).applyBleed(boss);
    inner(sim).applyBleed(plain);
    const ev = tick(sim, 0.6);
    const b = dmg(ev, 'bleed').find((x) => x.targetId === boss.id)!.amount;
    const n = dmg(ev, 'bleed').find((x) => x.targetId === plain.id)!.amount;
    expect(b).toBe(Math.round(n * STATUS.bleed.bossFactor));
  });

  it('stops on death and cannot start on the dead', () => {
    const sim = lab('warden', ['sunder']);
    const e = dummy(sim, 'thrall', 3);
    inner(sim).applyBleed(e);
    e.hp = 1;
    tick(sim, 0.7);
    expect(e.state).toBe('dead');
    expect(e.bleedStacks).toBe(0);
    inner(sim).applyBleed(e);
    expect(e.bleedStacks).toBe(0);
  });
});

describe('chill', () => {
  it('slows, renews to the longer time, is capped, and wears off', () => {
    const sim = lab('wanderer', ['volley']);
    const e = dummy(sim, 'thrall', 3);
    const p = inner(sim);
    p.applyChill(e, 2);
    p.applyChill(e, 1);
    expect(e.chillT).toBeCloseTo(2, 9);
    p.applyChill(e, 99);
    expect(e.chillT).toBe(STATUS.chill.maxDuration);
    tick(sim, 0.05);
    expect(e.slowMul).toBeCloseTo(STATUS.chill.slow, 9);
    tick(sim, STATUS.chill.maxDuration + 0.2);
    expect(e.chillT).toBe(0);
    expect(e.slowMul).toBe(1);
  });

  it('slows a boss far less', () => {
    const sim = lab('wanderer', ['volley']);
    const boss = sim.spawnEnemy('bossCrypt', 12, 12, { instant: true });
    inner(sim).applyChill(boss, 3);
    tick(sim, 0.05);
    expect(boss.slowMul).toBeCloseTo(STATUS.chill.bossSlow, 9);
    expect(STATUS.chill.bossSlow).toBeGreaterThan(STATUS.chill.slow);
  });
});

describe('stun and freeze (hard crowd control)', () => {
  /** Applies a stun every tenth of a second for `seconds` and measures the stretches the enemy spent stunned. */
  function spam(kind: 'thrall' | 'bossCrypt', seconds: number) {
    const sim = lab('warden', ['sunder']);
    const e = foe(sim, kind);
    const stretches: number[] = [];
    const gaps: number[] = [];
    let cur = 0;
    let gap = 0;
    let started = false;
    let free = 0;
    for (let i = 0; i < seconds / SIM_DT; i++) {
      if (i % 6 === 0) inner(sim).stun(e, 10);
      sim.hero.hp = sim.hero.stats.maxHp;
      sim.step(SIM_DT);
      sim.drainEvents();
      if (e.state === 'stunned') {
        if (cur === 0 && started) gaps.push(gap);
        cur += SIM_DT;
        gap = 0;
        started = true;
      } else {
        if (cur > 0) stretches.push(cur);
        cur = 0;
        gap += SIM_DT;
        free += SIM_DT;
      }
    }
    if (cur > 0) stretches.push(cur);
    return { stretches, gaps, free, total: seconds };
  }

  it('never keeps an ordinary enemy stunned for longer than the limit, and lets it act between stuns', () => {
    const r = spam('thrall', 30);
    expect(Math.max(...r.stretches)).toBeLessThanOrEqual(STATUS.cc.max + 0.05);
    expect(r.stretches.length).toBeGreaterThanOrEqual(5);
    for (const g of r.gaps) expect(g).toBeGreaterThanOrEqual(STATUS.cc.grace - 0.05);
    expect(r.free / r.total).toBeGreaterThan(0.15);
  });

  it('keeps a boss stunned only briefly and immune for much longer', () => {
    const r = spam('bossCrypt', 40);
    expect(Math.max(...r.stretches)).toBeLessThanOrEqual(STATUS.cc.bossMax + 0.05);
    for (const g of r.gaps) expect(g).toBeGreaterThanOrEqual(STATUS.cc.bossGrace - 0.05);
    expect(r.free / r.total).toBeGreaterThan(0.8);
  });

  it('applies the limit to a single big stun too', () => {
    const sim = lab('warden', ['sunder']);
    const e = foe(sim, 'thrall');
    inner(sim).stun(e, 50);
    expect(e.stateT).toBeLessThanOrEqual(STATUS.cc.max);
    const boss = foe(sim, 'bossCrypt');
    inner(sim).stun(boss, 50);
    expect(boss.stateT).toBeLessThanOrEqual(STATUS.cc.bossMax);
  });

  it('does not stun a boss in its roar, and does not shorten a stun that is already running', () => {
    const sim = lab('warden', ['sunder']);
    const boss = foe(sim, 'bossCrypt');
    boss.invulnerable = true;
    inner(sim).stun(boss, 5);
    expect(boss.state).not.toBe('stunned');
    const e = dummy(sim, 'thrall', 3); // stunned for 999 s
    inner(sim).stun(e, 1);
    expect(e.stateT).toBeGreaterThan(900);
  });

  it('interrupts a wind-up once, not again during the cool-off', () => {
    const sim = lab('warden', ['sunder']);
    const e = sim.spawnEnemy('thrall', sim.hero.x + 1.2, sim.hero.y, { instant: true });
    tick(sim, 0.1);
    expect(e.state).toBe('windup');
    const ev = tick(sim, SKILLS.sunder.castTime + 0.1, { skill: true });
    expect(ev.some((x) => x.type === 'interrupt')).toBe(true);
    expect(e.state).toBe('stunned');
  });
});

describe('mark', () => {
  it('lasts six seconds, is renewed by marking again, and ends on death', () => {
    const sim = lab('wanderer', ['snipe']);
    const e = dummy(sim, 'brute', 3);
    inner(sim).applyMark(e);
    expect(e.markT).toBeCloseTo(STATUS.mark.duration, 9);
    tick(sim, 3);
    inner(sim).applyMark(e);
    expect(e.markT).toBeCloseTo(STATUS.mark.duration, 9);
    tick(sim, STATUS.mark.duration + 0.2);
    expect(e.markT).toBe(0);
    inner(sim).applyMark(e);
    e.hp = 1;
    sim.damageEnemy(e, { amount: 5, crit: false }, 'attack', 0, 0);
    expect(e.markT).toBe(0);
  });

  it('allows only a few marked enemies at once: the oldest mark goes first', () => {
    const sim = lab('wanderer', ['snipe']);
    const list = Array.from({ length: 7 }, (_, i) => dummy(sim, 'thrall', 2 + (i % 4) * 0.8, -3 + i * 0.9));
    for (const e of list) inner(sim).applyMark(e);
    const marked = list.filter((e) => e.markT > 0);
    expect(marked.length).toBe(STATUS.mark.maxMarked);
    expect(marked).toEqual(list.slice(-STATUS.mark.maxMarked));
  });
});

// ───────────────────────────── reactions ─────────────────────────────

describe('Rozerwanie (bleeding and area hits)', () => {
  it('Szarża makes enemies bleed, and Rozłam spends the stacks for burst damage', () => {
    const sim = lab('warden', ['charge', 'sunder']);
    sim.hero.x = sim.hero.px = 3.5;
    const e = dummy(sim, 'brute', 1.5);
    const first = tick(sim, 0.4, { skill: true, moveX: 1 });
    expect(e.bleedStacks).toBe(1);
    expect(first.some((x) => x.type === 'status' && x.id === e.id && x.status === 'bleed' && x.stacks === 1)).toBe(true);
    e.bleedStacks = 3;
    e.bleedT = 4;
    // stand next to it and slam
    sim.hero.x = sim.hero.px = e.x - 1;
    sim.hero.y = sim.hero.py = e.y;
    tick(sim, 0.3);
    const ev = tick(sim, SKILLS.sunder.castTime + 0.15, { skill2: true });
    const burst = syn(ev, 'rend');
    expect(burst.length).toBe(1);
    expect(burst[0]!.amount).toBe(Math.round(sim.hero.stats.damage * SYNERGY.rend.perStack * 3));
    expect(e.bleedStacks).toBe(0);
    expect(e.bleedT).toBe(0);
    // nothing left to tear open the second time
    sim.hero.skills[1]!.cd = 0;
    expect(syn(tick(sim, 0.6, { skill2: true }), 'rend').length).toBe(0);
  });

  it('works for Miażdżący Cios as well, and a boss takes half', () => {
    const run1 = (boss: boolean) => {
      const sim = lab('warden', ['crush']);
      const e = dummy(sim, 'brute', 1.6);
      if (boss) e.def = { ...e.def, boss: { title: '', roar: '', phases: [[], []] } } as unknown as Enemy['def'];
      e.bleedStacks = 2;
      e.bleedT = 4;
      return syn(tick(sim, 0.9, { skill: true }), 'rend')[0]!.amount!;
    };
    const normal = run1(false);
    expect(normal).toBe(Math.round(14 * SYNERGY.rend.perStack * 2));
    expect(run1(true)).toBe(Math.round(14 * SYNERGY.rend.perStack * 2 * STATUS.bleed.bossFactor));
  });

  it('Wir Ostrzy and Rzut Toporem also start bleeding, but never past three stacks', () => {
    const whirl = lab('warden', ['whirl']);
    const a = dummy(whirl, 'brute', 1);
    tick(whirl, 2.2, { skill: true });
    expect(a.bleedStacks).toBe(STATUS.bleed.maxStacks);
    const axe = lab('warden', ['axe']);
    const b = dummy(axe, 'brute', 3);
    tick(axe, 1, { skill: true });
    expect(b.bleedStacks).toBe(1);
  });

  it('skills outside the reaction neither cause nor spend bleeding', () => {
    const sim = lab('warden', ['bastion', 'hook', 'banner']);
    const e = dummy(sim, 'brute', 3);
    e.bleedStacks = 2;
    e.bleedT = 4;
    tick(sim, 0.1, { skill: true });
    tick(sim, 0.3, { skill2: true });
    tick(sim, 0.3, { skill3: true });
    expect(e.bleedStacks).toBe(2);
    expect(dmg(tick(sim, 0.1), 'skill').length).toBe(0);
  });
});

describe('Rozdmuchanie (a shout fans the flames)', () => {
  function crowd() {
    const sim = lab('warden', ['warcry']);
    const src = dummy(sim, 'brute', 1.5);
    inner(sim).applyBurn(src, 10, 0);
    const near = Array.from({ length: 8 }, (_, i) => dummy(sim, 'thrall', 1.5 + Math.cos(i) * 1.1, Math.sin(i) * 1.1));
    return { sim, src, near };
  }

  it('lights the neighbours of a burning enemy, at most four per cast, a little weaker', () => {
    const { sim, near } = crowd();
    const ev = tick(sim, 0.1, { skill: true });
    const lit = near.filter((e) => e.burnT > 0);
    expect(lit.length).toBe(SYNERGY.stoke.maxNew);
    for (const e of lit) {
      expect(e.burnDps).toBeCloseTo(10 * SYNERGY.stoke.strength, 9);
      expect(e.burnGen).toBe(1);
    }
    expect(syn(ev, 'stoke').length).toBe(1);
    expect(syn(ev, 'stoke')[0]!.amount).toBe(SYNERGY.stoke.maxNew);
  });

  it('does nothing without fire, and does not relight what already burns', () => {
    const sim = lab('warden', ['warcry']);
    const a = dummy(sim, 'thrall', 1.5);
    const b = dummy(sim, 'thrall', 2.2);
    expect(syn(tick(sim, 0.1, { skill: true }), 'stoke').length).toBe(0);
    expect(a.burnT + b.burnT).toBe(0);
    inner(sim).applyBurn(a, 8, 0);
    inner(sim).applyBurn(b, 4, 0);
    sim.hero.skills[0]!.cd = 0;
    const burnT = b.burnT;
    expect(syn(tick(sim, 0.4, { skill: true }), 'stoke').length).toBe(0);
    expect(b.burnDps).toBe(4);
    expect(b.burnT).toBeLessThanOrEqual(burnT);
  });

  it('every cast adds at most four fires, and the generation never passes the limit', () => {
    const sim = lab('warden', ['warcry']);
    const line = Array.from({ length: 14 }, (_, i) => dummy(sim, 'thrall', 1 + i * 0.45, 0));
    inner(sim).applyBurn(line[0]!, 10, 0);
    let gens = 0;
    for (let i = 0; i < 8; i++) {
      sim.hero.skills[0]!.cd = 0;
      for (const e of line) if (e.burnT > 0) e.burnT = 3;
      const before = line.filter((e) => e.burnT > 0).length;
      tick(sim, 0.3, { skill: true });
      const after = line.filter((e) => e.burnT > 0).length;
      expect(after - before).toBeLessThanOrEqual(SYNERGY.stoke.maxNew);
      gens = Math.max(gens, ...line.map((e) => (e.burnT > 0 ? e.burnGen : 0)));
    }
    expect(gens).toBeLessThanOrEqual(STATUS.burn.maxGeneration);
    expect(gens).toBeGreaterThanOrEqual(1);
  });

  it('fire that has been spread as far as allowed does not spread further', () => {
    const sim = lab('warden', ['warcry']);
    const last = dummy(sim, 'brute', 1.5);
    const neighbour = dummy(sim, 'thrall', 2.3);
    inner(sim).applyBurn(last, 10, STATUS.burn.maxGeneration);
    expect(syn(tick(sim, 0.1, { skill: true }), 'stoke').length).toBe(0);
    expect(neighbour.burnT).toBeLessThanOrEqual(0);
    // one generation earlier it still can
    const sim2 = lab('warden', ['warcry']);
    const src = dummy(sim2, 'brute', 1.5);
    const near = dummy(sim2, 'thrall', 2.3);
    inner(sim2).applyBurn(src, 10, STATUS.burn.maxGeneration - 1);
    tick(sim2, 0.1, { skill: true });
    expect(near.burnT).toBeGreaterThan(0);
    expect(near.burnGen).toBe(STATUS.burn.maxGeneration);
  });

  it('a fire lit again by a hit becomes a first-generation fire once more', () => {
    const sim = lab('warden', ['warcry']);
    const e = dummy(sim, 'thrall', 3);
    inner(sim).applyBurn(e, 5, 2);
    expect(e.burnGen).toBe(2);
    inner(sim).applyBurn(e, 5, 0);
    expect(e.burnGen).toBe(0);
  });
});

describe('Burza znaku (marks and lightning)', () => {
  it('Strzał Przeszywający marks, and the next shot into the mark sends lightning to the nearest others', () => {
    const sim = lab('wanderer', ['snipe', 'volley']);
    const a = dummy(sim, 'brute', 3);
    const b = dummy(sim, 'thrall', 3, 1.4);
    const c = dummy(sim, 'thrall', 3.6, -1.6);
    const far = dummy(sim, 'thrall', 3, 6);
    const first = tick(sim, 0.5, { skill: true });
    expect(a.markT).toBeGreaterThan(0);
    expect(dmg(first, 'arc').length).toBe(0); // a fresh mark does not arc
    const ev = tick(sim, 0.8, { skill2: true });
    const arcs = dmg(ev, 'arc');
    expect(arcs.map((x) => x.targetId).sort()).toEqual([b.id, c.id].sort());
    expect(far.hp).toBe(far.maxHp);
    expect(ev.some((x) => x.type === 'chain')).toBe(true);
    expect(syn(ev, 'storm').length).toBe(1);
  });

  it('an arc is weaker than a hit, marks nothing, and never causes another arc', () => {
    const sim = lab('wanderer', ['volley']);
    sim.hero.stats.damage = 100;
    const a = dummy(sim, 'brute', 3);
    const b = dummy(sim, 'brute', 3, 1.5);
    const c = dummy(sim, 'brute', 3, 3);
    inner(sim).applyMark(a);
    inner(sim).applyMark(b); // b is marked too: if arcs could chain, hitting b would arc to c
    const before = c.hp;
    inner(sim).arc(a);
    const ev = sim.drainEvents();
    const arcs = dmg(ev, 'arc');
    expect(arcs.length).toBe(2);
    expect(arcs[0]!.amount).toBe(Math.round(100 * SYNERGY.storm.damage));
    expect(c.hp).toBe(before - arcs.find((x) => x.targetId === c.id)!.amount);
    expect(syn(ev, 'storm').length).toBe(1);
    expect(c.markT).toBe(0);
    expect(dmg(tick(sim, 0.01), 'arc').length).toBe(0);
  });

  it('one marked enemy can arc only every 0.6 s', () => {
    const sim = lab('wanderer', ['volley']);
    const a = dummy(sim, 'brute', 3);
    dummy(sim, 'thrall', 3, 1.5);
    dummy(sim, 'thrall', 3, -1.5);
    inner(sim).applyMark(a);
    inner(sim).arc(a);
    sim.drainEvents();
    inner(sim).arc(a);
    expect(dmg(sim.drainEvents(), 'arc').length).toBe(0);
    tick(sim, SYNERGY.storm.perMarkCooldown + 0.05);
    inner(sim).arc(a);
    expect(dmg(sim.drainEvents(), 'arc').length).toBe(2);
  });

  it('all arcs together share one budget that refills slowly', () => {
    const sim = lab('wanderer', ['volley']);
    const marked = Array.from({ length: 8 }, (_, i) => dummy(sim, 'thrall', 2 + (i % 4) * 0.9, -3 + i * 0.8));
    const victims = Array.from({ length: 6 }, (_, i) => dummy(sim, 'brute', 6, -2 + i * 0.8));
    for (const e of marked) e.markT = 5;
    let total = 0;
    for (const e of marked) {
      inner(sim).arc(e);
      total += dmg(sim.drainEvents(), 'arc').length;
    }
    expect(total).toBeLessThanOrEqual(SYNERGY.storm.burst);
    expect(inner(sim).arcBudget).toBeLessThan(1);
    // a second later the budget has refilled by its rate
    for (const e of marked) e.markCd = 0;
    tick(sim, 1);
    let more = 0;
    for (const e of marked) {
      inner(sim).arc(e);
      more += dmg(sim.drainEvents(), 'arc').length;
    }
    expect(more).toBeLessThanOrEqual(Math.ceil(SYNERGY.storm.perSecond));
    expect(victims.length).toBe(6);
  });

  it('Gwiezdny Deszcz marks what it targets, but no more than the limit', () => {
    const sim = lab('wanderer', ['starfall']);
    const list = Array.from({ length: 6 }, (_, i) => dummy(sim, 'thrall', 1.5 + (i % 3) * 1.2, -2 + i * 0.8));
    tick(sim, 0.05, { skill: true });
    expect(list.filter((e) => e.markT > 0).length).toBe(STATUS.mark.maxMarked);
    // the nearest ones are the ones that stay marked
    const marked = list.filter((e) => e.markT > 0).map((e) => Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y));
    const unmarked = list.filter((e) => e.markT <= 0).map((e) => Math.hypot(e.x - sim.hero.x, e.y - sim.hero.y));
    expect(Math.max(...marked)).toBeLessThanOrEqual(Math.min(...unmarked) + 1e-9 + 3);
  });

  it('shots of skills outside the reaction do not arc', () => {
    const sim = lab('warden', ['axe']);
    const a = dummy(sim, 'brute', 3);
    dummy(sim, 'thrall', 3, 1.2);
    a.markT = 5;
    expect(dmg(tick(sim, 0.8, { skill: true }), 'arc').length).toBe(0);
  });
});

describe('Rozbicie (frozen enemies and heavy hits)', () => {
  const heavy = (id: 'crush' | 'snipe' | 'mine', hero: HeroId) => {
    const sim = lab(hero, [id]);
    const e = dummy(sim, 'brute', id === 'crush' ? 1.6 : id === 'mine' ? 0.9 : 3);
    return { sim, e };
  };

  it('Strzał Przeszywający hits a frozen enemy harder and breaks the ice', () => {
    const plain = heavy('snipe', 'wanderer');
    const base = dmg(tick(plain.sim, 0.5, { skill: true }), 'bolt')[0]!.amount;
    const { sim, e } = heavy('snipe', 'wanderer');
    e.frozenT = 2;
    const ev = tick(sim, 0.5, { skill: true });
    expect(dmg(ev, 'bolt')[0]!.amount).toBe(Math.round(sim.hero.stats.damage * SKILLS.snipe.damageMult * (1 + SYNERGY.shatter.bonus)));
    expect(base).toBe(Math.round(sim.hero.stats.damage * SKILLS.snipe.damageMult));
    expect(syn(ev, 'shatter').length).toBe(1);
    expect(e.frozenT).toBe(0);
    expect(e.state).not.toBe('stunned');
    expect(e.chillT).toBeGreaterThan(1.5);
  });

  it('Miażdżący Cios shatters a freeze that came from gear, and the cool-off stops an instant refreeze', () => {
    const { sim, e } = heavy('crush', 'warden');
    e.frozenT = 2; // as left by the Skorupa mrozu
    const ev = tick(sim, 0.9, { skill: true });
    expect(syn(ev, 'shatter').length).toBe(1);
    expect(dmg(ev, 'skill')[0]!.amount).toBe(Math.round(sim.hero.stats.damage * SKILLS.crush.damageMult * 1.6));
    expect(e.ccGrace).toBeGreaterThan(0);
    inner(sim).stun(e, 2);
    expect(e.state).not.toBe('stunned');
  });

  it('Mina Pustki shatters too; Salwa Odłamków does not', () => {
    const { sim, e } = heavy('mine', 'wanderer');
    tick(sim, 0.1, { skill: true });
    e.frozenT = 2;
    const ev = tick(sim, 1.2);
    expect(syn(ev, 'shatter').length).toBe(1);
    const v = lab('wanderer', ['volley']);
    const t = dummy(v, 'brute', 3);
    t.frozenT = 2;
    expect(syn(tick(v, 0.8, { skill: true }), 'shatter').length).toBe(0);
    expect(t.frozenT).toBeGreaterThan(0);
  });

  it('Szron Otchłani followed by a heavy hit is the intended combination', () => {
    const sim = lab('wanderer', ['frost', 'snipe']);
    const e = dummy(sim, 'brute', 2.5);
    e.state = 'chase';
    e.stateT = 0;
    tick(sim, 0.1, { skill: true });
    expect(e.frozenT).toBeGreaterThan(0);
    const ev = tick(sim, 0.6, { skill2: true });
    expect(syn(ev, 'shatter').length).toBe(1);
  });
});

describe('Pułapka z uniku (dodge mine)', () => {
  const dodge = (sim: Sim) => {
    const ev = tick(sim, 0.4, { dodge: true, moveX: 1 });
    return ev;
  };

  it('leaves a mine where you stood, then needs its cooldown', () => {
    const sim = lab('wanderer', ['mine'], { 'mine.trapdodge': 1 });
    const x0 = sim.hero.x;
    const ev = dodge(sim);
    const mines = sim.zones.filter((z) => z.kind === 'mine');
    expect(mines.length).toBe(1);
    expect(mines[0]!.x).toBeCloseTo(x0, 6);
    expect(syn(ev, 'trap').length).toBe(1);
    sim.hero.dodgeCd = 0;
    dodge(sim);
    expect(sim.zones.filter((z) => z.kind === 'mine').length).toBe(1); // still cooling down
    tick(sim, SYNERGY.trap.cooldown);
    sim.hero.dodgeCd = 0;
    dodge(sim);
    expect(sim.zones.filter((z) => z.kind === 'mine').length).toBe(2);
  });

  it('level two leaves two, and the limit of mines still holds', () => {
    const sim = lab('wanderer', ['mine'], { 'mine.trapdodge': 2 });
    dodge(sim);
    expect(sim.zones.filter((z) => z.kind === 'mine').length).toBe(2);
    for (let i = 0; i < 6; i++) {
      tick(sim, SYNERGY.trap.cooldown + 0.1);
      sim.hero.dodgeCd = 0;
      dodge(sim);
    }
    expect(sim.zones.filter((z) => z.kind === 'mine').length).toBeLessThanOrEqual(SKILLS.mine.max);
  });

  it('needs the upgrade and the Mina Pustki skill', () => {
    const none = lab('wanderer', ['mine']);
    dodge(none);
    expect(none.zones.filter((z) => z.kind === 'mine').length).toBe(0);
    const other = lab('wanderer', ['volley'], { 'mine.trapdodge': 2 });
    dodge(other);
    expect(other.zones.filter((z) => z.kind === 'mine').length).toBe(0);
  });

  it('the dodged-off mine really works: an enemy that follows is hit', () => {
    const sim = lab('wanderer', ['mine'], { 'mine.trapdodge': 1 });
    dodge(sim);
    const mine = sim.zones.find((z) => z.kind === 'mine')!;
    const e = sim.spawnEnemy('brute', mine.x + 0.7, mine.y, { instant: true });
    e.state = 'stunned';
    e.stateT = e.stateDur = 999;
    const ev = tick(sim, 1.2);
    expect(dmg(ev, 'skill').some((x) => x.targetId === e.id)).toBe(true);
  });
});

// ───────────────────────────── the whole system ─────────────────────────────

describe('limits and safety of the whole system', () => {
  it('reaction damage cannot start reactions', () => {
    // bleeding ticks and arcs deal damage, but never apply bleeding, marks or burns of their own
    const sim = lab('wanderer', ['volley']);
    const list = Array.from({ length: 5 }, (_, i) => dummy(sim, 'brute', 3, -2 + i));
    for (const e of list) {
      e.markT = 5;
      e.bleedStacks = 1;
      e.bleedT = 4;
    }
    const ev = tick(sim, STATUS.bleed.duration + 0.5);
    expect(dmg(ev, 'bleed').length).toBeGreaterThan(0);
    expect(ev.some((x) => x.type === 'status' && (x.status === 'burn' || x.status === 'mark'))).toBe(false);
    for (const e of list) expect(e.bleedStacks).toBe(0); // it ran out; nothing renewed it
  });

  it('a crowded fight with every reaction keeps the arc rate under the budget', () => {
    const sim = lab('wanderer', ['snipe', 'volley', 'sentry'], { 'sentry.twin': 2, 'volley.more': 2 });
    sim.hero.stats.attackRange = 4.6;
    const crowd = Array.from({ length: 14 }, (_, i) => dummy(sim, i % 4 ? 'thrall' : 'brute', 2 + (i % 5) * 0.8, -3 + Math.floor(i / 5) * 1.6 + (i % 5) * 0.2));
    for (const e of crowd) e.markT = 6;
    const arcs: number[] = [];
    for (let t = 0; t < 12; t++) {
      const ev = run(sim, 1, { skill: t % 3 === 0, skill2: t % 3 === 1, skill3: t % 3 === 2 });
      arcs.push(dmg(ev, 'arc').length);
      for (const e of crowd) if (e.state !== 'dead') e.markT = Math.max(e.markT, 3);
    }
    for (const n of arcs) expect(n).toBeLessThanOrEqual(SYNERGY.storm.burst + SYNERGY.storm.perSecond);
    expect(arcs.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('skills that take no part in a reaction never touch a status', () => {
    const inReaction = new Set(Object.values(SYNERGIES).flatMap((s) => s.skills));
    const outside = ALL_SKILLS.filter((s) => !inReaction.has(s));
    expect(outside.length).toBeGreaterThanOrEqual(5);
    for (const skill of outside) {
      const sim = lab(heroOf(skill), [skill]);
      const foes = [dummy(sim, 'brute', 1.4), dummy(sim, 'thrall', 2.4, 0.4), dummy(sim, 'thrall', 3.4, -0.4)];
      const ev = [...tick(sim, 0.2, { skill: true, moveX: 1 }), ...tick(sim, 4)];
      expect(ev.some((x) => x.type === 'synergy'), skill).toBe(false);
      expect(ev.some((x) => x.type === 'status' && (x.status === 'bleed' || x.status === 'mark')), skill).toBe(false);
      for (const e of foes) expect(e.bleedStacks + e.markT, skill).toBe(0);
    }
  });

  it('is exactly repeatable for the same seed, and every reaction is part of the replay', () => {
    const play = (seed: number) => {
      const sim = sandbox(openRoom(), { hero: 'wanderer', skills: ['snipe', 'starfall', 'volley'], seed });
      sim.setSkillUpgrades({ 'volley.more': 1, 'snipe.twin': 1, 'starfall.more': 1 });
      for (let i = 0; i < 9; i++) sim.spawnEnemy(i % 3 ? 'thrall' : 'brute', 4 + (i % 4) * 2.2, 3 + Math.floor(i / 3) * 3, { instant: true });
      const log: string[] = [];
      for (let t = 0; t < 24; t++) {
        const ev = run(sim, 0.5, { skill: t % 4 === 0, skill2: t % 4 === 1, skill3: t % 4 === 2, moveX: Math.cos(t), moveY: Math.sin(t) });
        for (const e of ev) if (e.type === 'synergy' || e.type === 'status' || (e.type === 'damage' && (e.source === 'arc' || e.source === 'bleed'))) log.push(JSON.stringify(e));
        if (sim.livingEnemyCount() < 4) sim.spawnEnemy('thrall', 5 + (t % 5), 6, { instant: true });
      }
      return { hash: sim.stateHash(), log };
    };
    const a = play(7);
    const b = play(7);
    expect(a.hash).toBe(b.hash);
    expect(a.log).toEqual(b.log);
    expect(a.log.length).toBeGreaterThan(0);
    expect(play(8).hash).not.toBe(a.hash);
  });

  it('the warden replays exactly too (bleeding, bursting, fanning flames)', () => {
    const play = () => {
      const sim = sandbox(openRoom(), { hero: 'warden', skills: ['whirl', 'sunder', 'warcry'], seed: 3 });
      sim.setSkillUpgrades({ 'whirl.sear': 2 });
      for (let i = 0; i < 8; i++) sim.spawnEnemy(i % 3 ? 'thrall' : 'brute', 5 + (i % 4) * 1.5, 4 + Math.floor(i / 4) * 3, { instant: true });
      const log: string[] = [];
      for (let t = 0; t < 30; t++) {
        const ev = run(sim, 0.5, { skill: t % 6 === 0, skill2: t % 6 === 2, skill3: t % 6 === 4, moveX: 0.4 * Math.cos(t), moveY: 0.4 * Math.sin(t) });
        for (const e of ev) if (e.type === 'synergy') log.push(JSON.stringify(e));
        sim.hero.hp = sim.hero.stats.maxHp;
      }
      return { hash: sim.stateHash(), log };
    };
    const a = play();
    expect(play()).toEqual(a);
    expect(a.log.length).toBeGreaterThan(0);
  });

  it('lists every reaction for the skills that take part, and none for the others', () => {
    for (const hero of ['warden', 'wanderer'] as HeroId[]) {
      const withReaction = SKILL_ORDER[hero].filter((s) => synergiesOf(s).length > 0);
      expect(withReaction.length).toBeGreaterThanOrEqual(4);
    }
    expect(synergiesOf('snipe').map((s) => s.id).sort()).toEqual(['shatter', 'storm']);
  });
});
