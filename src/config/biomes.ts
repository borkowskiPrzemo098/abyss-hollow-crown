import type { EnemyKind } from './balance';

/**
 * Each dungeon floor is a different place: its own stone, light, enemies,
 * traps and boss. Floor N uses BIOMES[N - 1].
 */
export type BiomeId = 'crypt' | 'frost' | 'forge';
export type TrapKind = 'spikes' | 'ice' | 'lava' | 'vent';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  sub: string;
  /** Relative spawn weights of regular enemies on this floor (thralls fill the rest). */
  roster: Partial<Record<EnemyKind, number>>;
  /** Max of a ranged/special kind per room. */
  specialCap: number;
  /** Traps per combat/elite room: [kind, min, max] clusters. */
  traps: readonly [TrapKind, number, number][];
  boss: EnemyKind;
  palette: {
    floor: readonly number[];
    wallTop: number;
    wallLeft: number;
    wallRight: number;
    pillarTop: number;
    accent: number;
    flame: readonly [number, number, number];
    light: number;
  };
  /** Multiply tint for enemies native to this floor. */
  enemyTint: number;
}

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'crypt',
    name: 'Krypty Popiołu',
    sub: 'Groby strażników Korony. Kolce w posadzce nie śpią.',
    roster: { thrall: 6, acolyte: 2, brute: 1 },
    specialCap: 1,
    traps: [['spikes', 1, 2]],
    boss: 'bossCrypt',
    palette: {
      floor: [0x171920, 0x1f222a, 0x1c1e25, 0x20232b, 0x191b22, 0x23262e],
      wallTop: 0x3a3f4b,
      wallLeft: 0x23262e,
      wallRight: 0x2f333d,
      pillarTop: 0x474c58,
      accent: 0xf08a3c,
      flame: [0xffc073, 0xf08a3c, 0xb8461f],
      light: 0xf08a3c,
    },
    enemyTint: 0xffffff,
  },
  {
    id: 'frost',
    name: 'Lodowe Groby',
    sub: 'Zamarznięte lochy. Lód pod stopami nie wybacza zbyt szybkich kroków.',
    roster: { thrall: 5, hound: 3, acolyte: 2, brute: 1 },
    specialCap: 2,
    traps: [['ice', 1, 2]],
    boss: 'bossFrost',
    palette: {
      floor: [0x1a2029, 0x1f2731, 0x1c232c, 0x222b36, 0x18202a, 0x253040],
      wallTop: 0x4a5668,
      wallLeft: 0x232c38,
      wallRight: 0x323e4e,
      pillarTop: 0x5a6a80,
      accent: 0x9fd8ff,
      flame: [0xe6f6ff, 0x8fd0ff, 0x3a7fc0],
      light: 0x8fc8ff,
    },
    enemyTint: 0xcfe0ff,
  },
  {
    id: 'forge',
    name: 'Kuźnie Otchłani',
    sub: 'Tu wykuto Koronę. Lawa wciąż płynie szczelinami, a z kraty bucha ogień.',
    roster: { thrall: 4, pyre: 3, hound: 2, brute: 2 },
    specialCap: 2,
    traps: [['lava', 1, 2], ['vent', 1, 2]],
    boss: 'bossKing',
    palette: {
      floor: [0x1c1514, 0x221a18, 0x1f1716, 0x261c19, 0x1a1312, 0x2a1f1b],
      wallTop: 0x4a3a36,
      wallLeft: 0x2a201d,
      wallRight: 0x3a2b27,
      pillarTop: 0x55433e,
      accent: 0xff5a2a,
      flame: [0xffe0a0, 0xff7a2a, 0xc0301a],
      light: 0xff6a2a,
    },
    enemyTint: 0xffd2b8,
  },
];

export function biomeFor(depth: number): BiomeDef {
  return BIOMES[Math.min(BIOMES.length, Math.max(1, depth)) - 1]!;
}

export const TRAPS = {
  spikes: { period: 3.2, warn: 1.9, up: 2.6, damage: 12, enemyDamage: 20 },
  vent: { period: 4, warn: 2.6, up: 3.3, damage: 16, enemyDamage: 24, radius: 1.15 },
  lava: { tick: 0.5, damage: 5, enemyDamage: 8 },
  /** Ice: how quickly the hero's velocity follows the stick (1/s). Lower = more slide. */
  ice: { grip: 2.6 },
} as const;
