import type { HeroClassDef } from '../config/heroes';
import { RANK_EFFECT, type MetaRanks } from '../config/progression';
import { UPGRADE_EFFECT as U, UPGRADES, type UpgradeId } from '../config/upgrades';
import type { HeroStats } from './types';

export const MAX_ARMOR = 0.6;

export function emptyUpgrades(): Record<UpgradeId, number> {
  const out = {} as Record<UpgradeId, number>;
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) out[id] = 0;
  return out;
}

/**
 * The single place where a hero's numbers are derived:
 * class base → permanent Sanctuary ranks → in-run upgrades.
 */
export function computeStats(cls: HeroClassDef, ranks: MetaRanks, up: Record<UpgradeId, number>): HeroStats {
  const melee = cls.attack.kind === 'melee';
  const shatter = up.shatter > 0 ? U.shatterBase + U.shatterPerStack * (up.shatter - 1) : 0;
  return {
    maxHp: Math.round(cls.maxHp + RANK_EFFECT.vitality * ranks.vitality + U.vigor * up.vigor),
    moveSpeed: cls.moveSpeed * (1 + RANK_EFFECT.agility * ranks.agility + U.swift * up.swift),
    damage: cls.attack.damage * (1 + RANK_EFFECT.might * ranks.might + U.power * up.power),
    attackInterval: cls.attack.interval / (1 + RANK_EFFECT.haste * ranks.haste + U.haste * up.haste),
    attackRange: cls.attack.range + (melee ? U.reachMelee : U.reachRanged) * up.reach,
    critChance: Math.min(0.75, cls.crit.chance + RANK_EFFECT.precision * ranks.precision + U.keen * up.keen),
    critMult: cls.crit.mult + U.brutal * up.brutal,
    armor: Math.min(MAX_ARMOR, cls.armor + RANK_EFFECT.guard * ranks.guard + U.ward * up.ward),
    skillCooldownMult: Math.pow(U.focus, up.focus),
    pierce: cls.attack.pierce + up.piercing,
    cleaveArcDeg: cls.attack.cleaveArcDeg + U.wideArcDeg * up.wideArc,
    cleaveRatio: cls.attack.cleaveRatio + U.wideArcRatio * up.wideArc,
    lifeOnKill: U.feastHeal * up.feast,
    shatter,
    lastStand: U.lastStandBonus * up.lastStand,
    dodgeStrike: up.dodgeStrike > 0 ? U.dodgeStrikeBonus : 0,
  };
}
