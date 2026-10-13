import { expect, test, type Page } from '@playwright/test';

/** Reads a value from the running game through the ?test debug hook. */
async function game<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__abyss.scene; return ${fn}; })()`) as Promise<T>;
}

async function boot(page: Page, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?test&seed=42');
  await page.waitForFunction(() => {
    const w = window as unknown as { __abyss?: { scene?: { mode?: string } } };
    return w.__abyss?.scene?.mode === 'title';
  });
  await expect(page.locator('#screen-title')).toBeVisible();
}

test('boots, plays, pauses, dies and restarts without errors', async ({ page }, info) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.screenshot({ path: info.outputPath('01-title.png') });

  await page.locator('#btn-start').click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(await game<string>(page, 's.mode')).toBe('playing');

  // movement (keyboard on desktop, joystick drag on phone)
  const x0 = await game<number>(page, 's.sim.hero.x');
  const y0 = await game<number>(page, 's.sim.hero.y');
  if (info.project.name === 'phone') {
    const zone = await page.locator('#stick-zone').boundingBox();
    const sx = zone!.x + zone!.width * 0.4;
    const sy = zone!.y + zone!.height * 0.7;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 50, sy, { steps: 4 });
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyD');
  }
  const moved = Math.hypot((await game<number>(page, 's.sim.hero.x')) - x0, (await game<number>(page, 's.sim.hero.y')) - y0);
  expect(moved).toBeGreaterThan(1);

  // dodge via the on-screen button
  const cdBefore = await game<number>(page, 's.sim.hero.dodgeCd');
  expect(cdBefore).toBe(0);
  await page.locator('#btn-dodge').dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true });
  await page.waitForTimeout(120);
  expect(await game<number>(page, 's.sim.hero.dodgeCd')).toBeGreaterThan(0);

  // let wave 1 arrive and the auto-attack do its work
  await page.waitForFunction(() => {
    const w = window as unknown as { __abyss: { scene: { sim: { wave: number } } } };
    return w.__abyss.scene.sim.wave >= 1;
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: info.outputPath('02-combat.png') });
  expect(await game<number>(page, 's.sim.enemies.length')).toBeGreaterThan(0);

  // skill
  await page.locator('#btn-skill').dispatchEvent('pointerdown', { pointerId: 8, isPrimary: true });
  await page.waitForTimeout(500);
  expect(await game<number>(page, 's.sim.hero.skillCd')).toBeGreaterThan(5);
  await page.screenshot({ path: info.outputPath('03-skill.png') });

  // pause with the HUD button
  await page.locator('#btn-pause').click();
  await expect(page.locator('#screen-pause')).toBeVisible();
  const tPaused = await game<number>(page, 's.sim.time');
  await page.waitForTimeout(400);
  expect(await game<number>(page, 's.sim.time')).toBe(tPaused);
  await page.screenshot({ path: info.outputPath('04-pause.png') });
  await page.locator('#btn-resume').click();
  await expect(page.locator('#screen-pause')).toBeHidden();
  await page.waitForTimeout(200);
  expect(await game<number>(page, 's.sim.time')).toBeGreaterThan(tPaused);

  // force a death, then restart
  await game(page, '(s.sim.hero.iframeT = 0, s.sim.hero.hurtT = 0, s.sim.damageHero(9999))');
  await expect(page.locator('#screen-death')).toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: info.outputPath('05-death.png') });
  await page.locator('#btn-retry').click();
  await expect(page.locator('#screen-death')).toBeHidden();
  expect(await game<string>(page, 's.mode')).toBe('playing');
  expect(await game<number>(page, 's.sim.hero.hp')).toBe(100);
  expect(await game<number>(page, 's.sim.wave')).toBe(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('tab hidden pauses the game', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('#btn-start').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#screen-pause')).toBeVisible();
  expect(await game<string>(page, 's.mode')).toBe('paused');
  expect(errors).toEqual([]);
});

test('page does not scroll or zoom from touch gestures (CSS guards present)', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  const css = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return { touch: b.touchAction, select: b.userSelect || b.webkitUserSelect, overflow: b.overflow };
  });
  expect(css.touch).toBe('none');
  expect(css.select).toBe('none');
  expect(css.overflow).toBe('hidden');
});
