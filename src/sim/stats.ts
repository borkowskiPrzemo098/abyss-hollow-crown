import type { HeroClassDef } from '../config/heroes';
import { EFFECT, type Item, type StatKey } from '../config/items';
import { RANK_EFFECT, type MetaRanks } from '../config/progression';
import { UPGRADE_EFFECT as U, UPGRADES, type UpgradeId } from '../config/upgrades';
import type { HeroStats } from './types';

export const MAX_ARMOR = 0.6;
export const MAX_CDR = 0.5;

export function emptyUpgrades(): Record<UpgradeId, number> {
  const out = {} as Record<UpgradeId, number>;
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) out[id] = 0;
  return out;
}

/** Sums the stat lines of all equipped items. */
export function gearTotals(gear: readonly Item[]): Record<StatKey, number> {
  const t: Record<StatKey, number> = {
    maxHp: 0,
    damagePct: 0,
    attackSpeedPct: 0,
    armor: 0,
    critChance: 0,
    critMult: 0,
    movePct: 0,
    cdr: 0,
    lifeOnKill: 0,
    range: 0,
  };
  for (const it of gear) for (const [k, v] of Object.entries(it.stats) as [StatKey, number][]) t[k] += v;
  return t;
}

/**
 * The single place where a hero's numbers are derived:
 * class base → permanent Sanctuary ranks → equipped gear → in-run upgrades.
 * Gear effects don't stack with themselves; the best copy counts.
 */
export function computeStats(cls: HeroClassDef, ranks: MetaRanks, up: Record<UpgradeId, number>, gear: readonly Item[] = []): HeroStats {
  const melee = cls.attack.kind === 'melee';
  const g = gearTotals(gear);
  const fx = new Set(gear.map((i) => i.effect).filter((e) => !!e));
  const barrierIlvl = Math.max(0, ...gear.filter((i) => i.effect === 'barrier').map((i) => i.ilvl));
  const shatter = up.shatter > 0 ? U.shatterBase + U.shatterPerStack * (up.shatter - 1) : 0;
  return {
    maxHp: Math.round(cls.maxHp + RANK_EFFECT.vitality * ranks.vitality + U.vigor * up.vigor + g.maxHp),
    moveSpeed: cls.moveSpeed * Math.max(0.6, 1 + RANK_EFFECT.agility * ranks.agility + U.swift * up.swift + g.movePct),
    damage: cls.attack.damage * (1 + RANK_EFFECT.might * ranks.might + U.power * up.power + g.damagePct),
    attackInterval: cls.attack.interval / Math.max(0.5, 1 + RANK_EFFECT.haste * ranks.haste + U.haste * up.haste + g.attackSpeedPct),
    attackRange: cls.attack.range + (melee ? U.reachMelee : U.reachRanged) * up.reach + (melee ? g.range : g.range * 2.5),
    critChance: Math.min(0.75, cls.crit.chance + RANK_EFFECT.precision * ranks.precision + U.keen * up.keen + g.critChance),
    critMult: cls.crit.mult + U.brutal * up.brutal + g.critMult,
    armor: Math.min(MAX_ARMOR, cls.armor + RANK_EFFECT.guard * ranks.guard + U.ward * up.ward + g.armor),
    skillCooldownMult: Math.max(1 - MAX_CDR, Math.pow(U.focus, up.focus) * (1 - g.cdr)),
    pierce: cls.attack.pierce + up.piercing,
    cleaveArcDeg: cls.attack.cleaveArcDeg + U.wideArcDeg * up.wideArc,
    cleaveRatio: cls.attack.cleaveRatio + U.wideArcRatio * up.wideArc,
    lifeOnKill: U.feastHeal * up.feast + Math.round(g.lifeOnKill),
    shatter,
    lastStand: U.lastStandBonus * up.lastStand,
    dodgeStrike: up.dodgeStrike > 0 ? U.dodgeStrikeBonus : 0,
    burn: fx.has('burn') ? EFFECT.burn.dpsOfDamage : 0,
    frostShell: fx.has('frostShell'),
    chainEvery: fx.has('chain') ? EFFECT.chain.every : 0,
    leech: fx.has('leech') ? EFFECT.leech.fraction : 0,
    thorns: fx.has('thorns') ? EFFECT.thorns.damage : 0,
    barrierMax: fx.has('barrier') ? EFFECT.barrier.amount + EFFECT.barrier.perIlvl * (barrierIlvl - 1) : 0,
    emberStep: fx.has('emberStep'),
    critNova: fx.has('critNova'),
    frenzy: fx.has('frenzy'),
    executioner: fx.has('executioner'),
  };
}
