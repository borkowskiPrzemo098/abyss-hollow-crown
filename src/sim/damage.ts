import type { Rng } from '../core/rng';

export interface DamageRoll {
  amount: number;
  crit: boolean;
}

/**
 * Single damage formula for the whole game:
 *   base × (crit ? critMult : 1) × (1 − reduction), rounded, at least 1.
 * Reduction is clamped to [0, 0.8] so armour can never make anything immortal.
 */
export function rollDamage(base: number, critChance: number, critMult: number, reduction: number, rng: Rng): DamageRoll {
  const crit = critChance > 0 && rng.next() < critChance;
  const r = Math.min(0.8, Math.max(0, reduction));
  const raw = base * (crit ? critMult : 1) * (1 - r);
  return { amount: Math.max(1, Math.round(raw)), crit };
}

/** Damage taken after flat reduction, without crits (enemy → hero). */
export function applyReduction(amount: number, reduction: number): number {
  const r = Math.min(0.8, Math.max(0, reduction));
  return Math.max(1, Math.round(amount * (1 - r)));
}
