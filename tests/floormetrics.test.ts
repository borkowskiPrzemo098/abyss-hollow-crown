import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mean, runExpedition, type ExpeditionMetrics } from './floorbot';

/**
 * Floor length, measured with a bot that really walks (see floorbot.ts). With ABYSS_REPORT=<file> this writes the
 * full measurement as JSON (many seeds, both classes); without it, a short run checks that the tool itself works.
 */
const REPORT = process.env.ABYSS_REPORT;
const SEEDS = REPORT ? Array.from({ length: Number(process.env.ABYSS_SEEDS ?? 8) }, (_, i) => 101 + i * 37) : [101];

describe('floor metrics', () => {
  it('measures floors with a walking bot', () => {
    const runs: ExpeditionMetrics[] = [];
    for (const hero of ['warden', 'wanderer'] as const) for (const seed of SEEDS) runs.push(runExpedition({ hero, seed, floors: REPORT ? 3 : 1, optionalShare: Number(process.env.ABYSS_SHARE ?? 0.6) }));
    if (REPORT) {
      writeFileSync(REPORT, JSON.stringify(runs));
      return; // measuring, not asserting
    }
    const first = runs.flatMap((r) => r.floors.filter((f) => f.depth === 1));
    expect(first.length).toBe(runs.length);
    for (const f of first) {
      expect(f.seconds).toBeGreaterThan(20);
      expect(f.roomsTotal).toBeGreaterThan(3);
      expect(f.stuck).toBeLessThanOrEqual(3);
    }
    expect(mean(first.map((f) => f.seconds))).toBeGreaterThan(30);
  }, 600_000);
});
