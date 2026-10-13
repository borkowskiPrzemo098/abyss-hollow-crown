// Rasterises public/icons/icon.svg into the PNG sizes the manifest and iOS need.
// Uses the locally installed Microsoft Edge through Playwright (no downloads).
// Run: node scripts/gen-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = await readFile(dir + 'icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: dir + name, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
