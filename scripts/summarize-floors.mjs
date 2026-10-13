// Prints a table from a floor-metrics JSON written by tests/floormetrics.test.ts (ABYSS_REPORT=<file>).
// Usage: node scripts/summarize-floors.mjs reports/before.json [reports/after.json]
import { readFileSync } from 'node:fs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const min = (xs) => (xs.length ? Math.min(...xs) : 0);
const max = (xs) => (xs.length ? Math.max(...xs) : 0);
const m = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

for (const file of process.argv.slice(2)) {
  const runs = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n### ${file}  (${runs.length} expeditions)`);
  console.log('| klasa | piętro | wypraw | ukończone | zgony | czas śr. (min–maks) | walka | marsz | pokoje (główne/opcj.) | starcia | wrogowie | poziomy |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const hero of ['warden', 'wanderer']) {
    for (const depth of [1, 2, 3]) {
      const fs = runs.filter((r) => r.hero === hero).flatMap((r) => r.floors.filter((f) => f.depth === depth));
      if (!fs.length) continue;
      const done = fs.filter((f) => f.completed);
      const secs = fs.map((f) => f.seconds);
      console.log(
        `| ${hero} | ${depth} | ${fs.length} | ${done.length} | ${fs.filter((f) => f.died).length} | ${m(mean(secs))} (${m(min(secs))}–${m(max(secs))}) | ${m(mean(fs.map((f) => f.fightSeconds)))} | ${m(mean(fs.map((f) => f.walkSeconds)))} | ${mean(fs.map((f) => f.mainVisited)).toFixed(1)}/${mean(fs.map((f) => f.optionalVisited)).toFixed(1)} z ${mean(fs.map((f) => f.roomsTotal)).toFixed(0)} | ${mean(fs.map((f) => f.fights)).toFixed(1)} | ${mean(fs.map((f) => f.kills)).toFixed(0)} | +${mean(fs.map((f) => f.levelsGained)).toFixed(1)} |`,
      );
    }
  }
  const completedF1 = runs.flatMap((r) => r.floors.filter((f) => f.depth === 1 && f.completed));
  if (completedF1.length) console.log(`\nPiętro 1, tylko ukończone: średnio ${m(mean(completedF1.map((f) => f.seconds)))}`);
}
