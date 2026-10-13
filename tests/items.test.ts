import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/config/balance';
import { TRAPS } from '../src/config/biomes';
import { HEROES } from '../src/config/heroes';
import { BASES, EFFECT, UNIQUES, type Item } from '../src/config/items';
import { NO_RANKS } from '../src/config/progression';
import { Rng } from '../src/core/rng';
import { addItem, bagItems, defaultSave, equip, equippedItems, parseSave, salvage } from '../src/meta/save';
import { DungeonDirector } from '../src/sim/director';
import { generateItem, isItem, rollRarity } from '../src/sim/loot';
import { Simulation } from '../src/sim/simulation';
import { computeStats, emptyUpgrades } from '../src/sim/stats';
import { generateDungeon } from '../src/world/dungeon';
import { autoChoose, openRoom, run, sandbox } from './helpers';

const unique = (id: string, hero: 'warden' | 'wanderer' = 'warden'): Item => {
  // roll legendaries until we get the wanted unique
  const rng = new Rng(1);
  for (let i = 0; i < 500; i++) {
    const it = generateItem(rng, hero, 1, 'legendary');
    if (it.unique === id) return it;
  }
  throw new Error('unique not found ' + id);
};

function withGear(gear: Item[], hero: 'warden' | 'wanderer' = 'warden') {
  const sim = sandbox(openRoom(), { hero });
  sim.setGear(gear);
  sim.hero.stats.armor = 0;
  return sim;
}

describe('item generation', () => {
  it('weapons always fit the hero class; other slots fit everyone', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 300; i++) {
      for (const hero of ['warden', 'wanderer'] as const) {
        const it = generateItem(rng, hero, 1, rollRarity(rng, 'enemy', 1));
        const b = BASES[it.base]!;
        if (b.slot === 'weapon') expect(b.hero).toBe(hero);
        expect(isItem(it)).toBe(true);
      }
    }
  });

  it('rarity sets the number of rolled lines; legendaries carry their effect', () => {
    const rng = new Rng(5);
    const common = generateItem(rng, 'warden', 1, 'common');
    const epic = generateItem(rng, 'warden', 1, 'epic');
    expect(Object.keys(epic.stats).length).toBeGreaterThan(Object.keys(common.stats).length);
    const leg = generateItem(rng, 'warden', 1, 'legendary');
    expect(leg.effect).toBeDefined();
    expect(UNIQUES.some((u) => u.id === leg.unique)).toBe(true);
  });

  it('deeper floors make better items and rarer drops more likely', () => {
    const rng = new Rng(7);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 200; i++) {
      a += generateItem(rng, 'warden', 1, 'rare').stats.maxHp ?? 0;
      b += generateItem(rng, 'warden', 3, 'rare').stats.maxHp ?? 0;
    }
    expect(b).toBeGreaterThan(a);
    let rare1 = 0;
    let rare3 = 0;
    for (let i = 0; i < 4000; i++) {
      if (rollRarity(rng, 'enemy', 1) !== 'common') rare1++;
      if (rollRarity(rng, 'enemy', 3) !== 'common') rare3++;
    }
    expect(rare3).toBeGreaterThan(rare1);
  });

  it('gear stats feed the hero stats; the same effect twice does not stack', () => {
    const sword = unique('kiel');
    const base = computeStats(HEROES.warden, NO_RANKS, emptyUpgrades(), []);
    const geared = computeStats(HEROES.warden, NO_RANKS, emptyUpgrades(), [sword]);
    expect(geared.damage).toBeGreaterThan(base.damage);
    expect(geared.burn).toBe(EFFECT.burn.dpsOfDamage);
    const twice = computeStats(HEROES.warden, NO_RANKS, emptyUpgrades(), [sword, unique('zar')]);
    expect(twice.burn).toBe(EFFECT.burn.dpsOfDamage);
  });
});

describe('legendary effects', () => {
  it('fire: attacks set enemies burning for damage over time', () => {
    const sim = withGear([unique('kiel')]);
    const e = sim.spawnEnemy('brute', sim.hero.x + 1.2, sim.hero.y, { instant: true });
    e.state = 'stunned';
    e.stateT = 99;
    e.hp = e.maxHp = 5000;
    const ev = run(sim, 2);
    expect(ev.some((x) => x.type === 'damage' && x.source === 'burn')).toBe(true);
  });

  it('frost shell: being hit freezes nearby enemies, then waits 10 s', () => {
    const sim = withGear([unique('zima')]);
    const e = sim.spawnEnemy('thrall', sim.hero.x + 1, sim.hero.y, { instant: true });
    expect(sim.damageHero(5, e)).toBe(true);
    expect(e.state).toBe('stunned');
    expect(e.frozenT).toBeGreaterThan(0);
    expect(sim.hero.frostCd).toBeCloseTo(EFFECT.frostShell.cooldown, 5);
    const ev = sim.drainEvents();
    expect(ev.filter((x) => x.type === 'frostShell')).toHaveLength(1);
    run(sim, 1);
    sim.hero.hurtT = 0;
    sim.damageHero(5, e);
    expect(sim.drainEvents().some((x) => x.type === 'frostShell')).toBe(false);
  });

  it('barrier absorbs damage and refills after a quiet moment', () => {
    const sim = withGear([unique('wieniec')]);
    const max = sim.hero.stats.barrierMax;
    expect(sim.hero.barrier).toBe(max);
    const hp = sim.hero.hp;
    sim.damageHero(10);
    expect(sim.hero.hp).toBe(hp);
    expect(sim.hero.barrier).toBe(max - 10);
    run(sim, EFFECT.barrier.delay + 0.1);
    expect(sim.hero.barrier).toBe(max);
  });

  it('thorns hurt a melee attacker', () => {
    const sim = withGear([unique('ciernie')]);
    const e = sim.spawnEnemy('thrall', sim.hero.x + 1, sim.hero.y, { instant: true });
    sim.damageHero(8, e);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('chain lightning jumps from the target to nearby enemies every few attacks', () => {
    const sim = withGear([unique('burza', 'wanderer')], 'wanderer');
    const h = sim.hero;
    for (const dy of [0, 1.2, -1.2]) {
      const e = sim.spawnEnemy('brute', h.x + 3, h.y + dy, { instant: true });
      e.state = 'stunned';
      e.stateT = 99;
      e.hp = e.maxHp = 5000;
    }
    const ev = run(sim, 4);
    expect(ev.some((x) => x.type === 'chain')).toBe(true);
  });

  it('leech heals from damage dealt', () => {
    const sim = withGear([unique('pijawka')]);
    sim.hero.hp = 50;
    const e = sim.spawnEnemy('brute', sim.hero.x + 1.2, sim.hero.y, { instant: true });
    e.state = 'stunned';
    e.stateT = 99;
    e.hp = e.maxHp = 5000;
    run(sim, 3);
    expect(sim.hero.hp).toBeGreaterThan(50);
  });
});

describe('traps', () => {
  it('spikes only hurt while raised, and hurt enemies too', () => {
    const sim = sandbox();
    const h = sim.hero;
    sim.setTraps([{ kind: 'spikes', tx: Math.floor(h.x), ty: Math.floor(h.y) }]);
    sim.traps[0]!.phase = 0;
    sim.time = 0;
    run(sim, TRAPS.spikes.up - 0.1);
    expect(h.hp).toBe(h.stats.maxHp);
    run(sim, 0.3);
    expect(h.hp).toBeLessThan(h.stats.maxHp);
  });

  it('a dodge carries the hero over raised spikes unharmed', () => {
    const sim = sandbox();
    const h = sim.hero;
    sim.setTraps([{ kind: 'spikes', tx: Math.floor(h.x), ty: Math.floor(h.y) }]);
    sim.traps[0]!.phase = TRAPS.spikes.period - TRAPS.spikes.up + 0.95; // fires in ~0.05 s
    sim.time = 0;
    run(sim, 0.2, { moveX: 1, dodge: true });
    expect(h.hp).toBe(h.stats.maxHp);
  });

  it('lava burns while you stand in it', () => {
    const sim = sandbox();
    const h = sim.hero;
    sim.setTraps([{ kind: 'lava', tx: Math.floor(h.x), ty: Math.floor(h.y) }]);
    run(sim, 1.2);
    expect(h.hp).toBeLessThanOrEqual(h.stats.maxHp - 2 * TRAPS.lava.damage);
  });

  it('ice makes the hero slide on after letting go of the stick', () => {
    const sim = sandbox();
    const h = sim.hero;
    const tiles = [];
    for (let x = 2; x < 14; x++) for (let y = 2; y < 14; y++) tiles.push({ kind: 'ice' as const, tx: x, ty: y });
    sim.setTraps(tiles);
    run(sim, 1, { moveX: 1 });
    const x0 = h.x;
    run(sim, 0.3);
    expect(h.x - x0).toBeGreaterThan(0.2);
  });
});

describe('bosses', () => {
  it('turns invulnerable and changes attacks at half health', () => {
    const sim = sandbox();
    const b = sim.spawnEnemy('bossCrypt', sim.hero.x + 3, sim.hero.y, { instant: true });
    sim.damageEnemy(b, { amount: Math.ceil(b.maxHp * 0.55), crit: false }, 'attack', 0, 0);
    expect(b.phase).toBe(2);
    expect(b.invulnerable).toBe(true);
    const hp = b.hp;
    sim.damageEnemy(b, { amount: 100, crit: false }, 'attack', 0, 0);
    expect(b.hp).toBe(hp);
    expect(ENEMIES.bossCrypt.boss!.phases[1]).toContain(b.atk);
    run(sim, ENEMIES.bossCrypt.boss!.roar + 0.1);
    expect(b.invulnerable).toBe(false);
  });

  it('every floor ends with its own boss, whose death opens the stairs and drops loot', () => {
    for (const depth of [1, 2, 3]) {
      const d = generateDungeon(30 + depth, depth);
      const sim = new Simulation(d.map, { seed: 3, build: { heroId: 'warden', skillId: 'sunder', ranks: { ...NO_RANKS }, gear: [] } });
      const dir = new DungeonDirector(sim, d);
      sim.director = dir;
      const lair = d.rooms[d.exitRoom]!;
      sim.hero.x = sim.hero.px = lair.x0 + 1.5;
      sim.hero.y = sim.hero.py = lair.y0 + 1.5;
      run(sim, 0.1);
      const boss = sim.getEnemy(dir.bossId)!;
      expect(boss.def.boss).toBeDefined();
      expect(boss.kind).toBe(['bossCrypt', 'bossFrost', 'bossKing'][depth - 1]);
      sim.hero.hp = 1e9;
      boss.state = 'chase';
      boss.hp = 1;
      boss.phase = 2;
      sim.damageEnemy(boss, { amount: 5, crit: false }, 'attack', 0, 0);
      run(sim, 1);
      autoChoose(sim);
      expect(sim.objects.find((o) => o.kind === 'stairs')!.active).toBe(true);
      expect(sim.pickups.filter((p) => p.kind === 'item').length + sim.loot.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('boss minions die with their master', () => {
    const sim = sandbox();
    const b = sim.spawnEnemy('bossCrypt', sim.hero.x + 3, sim.hero.y, { instant: true });
    const m = sim.spawnEnemy('thrall', sim.hero.x - 3, sim.hero.y, { instant: true, minion: true });
    b.hp = 0;
    b.state = 'dead';
    sim.killMinions();
    expect(m.state).toBe('dead');
  });
});

describe('inventory in the save', () => {
  it('a found item goes on automatically when the slot is empty', () => {
    const s = defaultSave();
    const it = generateItem(new Rng(1), 'warden', 1, 'rare');
    expect(addItem(s, it, 'warden').equipped).toBe(true);
    expect(equippedItems(s, 'warden')).toEqual([it]);
  });

  it('class weapons cannot be worn by the other hero', () => {
    const s = defaultSave();
    const staff = generateItem(new Rng(2), 'wanderer', 1, 'rare');
    while (BASES[staff.base]!.slot !== 'weapon') Object.assign(staff, generateItem(new Rng(Math.random() * 1e6), 'wanderer', 1, 'rare'));
    addItem(s, staff, 'warden');
    expect(equip(s, 'warden', staff.uid)).toBe(false);
    expect(equip(s, 'wanderer', staff.uid)).toBe(true);
  });

  it('a full bag breaks new items into ash instead of losing them', () => {
    const s = defaultSave();
    const rng = new Rng(4);
    for (let i = 0; i < 40; i++) addItem(s, generateItem(rng, 'warden', 1, 'common'), 'warden');
    expect(bagItems(s).length).toBeLessThanOrEqual(30);
    expect(s.ash).toBeGreaterThan(0);
  });

  it('salvaging gives ash and never destroys worn items', () => {
    const s = defaultSave();
    const it = generateItem(new Rng(1), 'warden', 1, 'epic');
    addItem(s, it, 'warden');
    expect(salvage(s, it.uid)).toBe(0); // worn
    const spare = generateItem(new Rng(9), 'warden', 1, 'epic');
    s.inventory.items.push(spare);
    expect(salvage(s, spare.uid)).toBeGreaterThan(0);
  });

  it('round-trips through storage and migrates old saves without an inventory', () => {
    const s = defaultSave();
    addItem(s, generateItem(new Rng(1), 'warden', 2, 'legendary'), 'warden');
    expect(parseSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const v1 = { version: 1, ash: 40, ranks: { might: 2 }, settings: { volume: 0.5, muted: false } };
    const migrated = parseSave(v1)!;
    expect(migrated.ash).toBe(40);
    expect(migrated.ranks.might).toBe(2);
    expect(migrated.inventory.items).toEqual([]);
  });
});
