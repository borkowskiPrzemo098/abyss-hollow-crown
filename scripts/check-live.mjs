// Smoke-checks the deployed GitHub Pages build on an emulated phone, including an offline reload.
// Run: node scripts/check-live.mjs [url]
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'https://borkowskiprzemo098.github.io/abyss-hollow-crown/';
const titleReady = () => window.__abyss?.scene?.mode === 'title';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url + '?test');
await page.waitForFunction(titleReady, null, { timeout: 30000 });
const swReady = await page.evaluate(() =>
  Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]),
);
// a second load runs under the worker and caches every asset it fetches
await page.reload();
await page.waitForFunction(titleReady, null, { timeout: 30000 });
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
await ctx.setOffline(true);
await page.reload().catch(() => {});
const offlineOk = await page
  .waitForFunction(titleReady, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
await ctx.setOffline(false);
console.log(JSON.stringify({ url, swReady, controlled, offlineOk, errors }, null, 1));
await browser.close();
