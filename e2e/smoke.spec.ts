import { expect, test, type Page } from '@playwright/test';

/** Evaluates an expression against the running game (`s` = scene, `w` = debug hook) via the ?test hook. */
async function game<T>(page: Page, expr: string): Promise<T> {
  return page.evaluate(`(() => { const w = window.__abyss; const s = w.scene; return ${expr}; })()`) as Promise<T>;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function boot(page: Page, query = '?test&seed=42') {
  await page.goto('/' + query);
  await page.waitForFunction(() => {
    const w = window as unknown as { __abyss?: { scene?: { mode?: string } } };
    return w.__abyss?.scene?.mode === 'menu';
  });
}

async function startRun(page: Page, hero: 'warden' | 'wanderer', skill: string) {
  await page.locator('#btn-new').click();
  await expect(page.locator('#screen-hero')).toBeVisible();
  await page.locator(`[data-hero="${hero}"]`).click();
  await expect(page.locator('#screen-skill')).toBeVisible();
  await page.locator(`[data-skill="${skill}"]`).click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(await game<string>(page, 's.mode')).toBe('playing');
}

/** Moves the hero into the first room of a type (through the debug hook) and returns its id. */
async function enterRoom(page: Page, type: string): Promise<number> {
  return game<number>(
    page,
    `(() => { const r = s.dungeon.rooms.find((x) => x.type === '${type}'); const h = s.sim.hero; h.x = h.px = r.x0 + 1.5; h.y = h.py = r.cy; return r.id; })()`,
  );
}

test('full run: pick hero, explore, fight, level up, descend, die, sanctuary', async ({ page }, info) => {
  const errors = watchErrors(page);
  // start from an empty save, but only once — the reload at the end must keep it
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('wiped')) {
      sessionStorage.setItem('wiped', '1');
      indexedDB.deleteDatabase('abyss-hollow-crown');
    }
  });
  await boot(page);
  await page.screenshot({ path: info.outputPath('01-title.png') });

  await page.locator('#btn-new').click();
  await expect(page.locator('#hero-cards .card')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('02-hero-select.png') });
  await page.locator('[data-hero="warden"]').click();
  await expect(page.locator('#skill-cards .card')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('03-skill-select.png') });
  await page.locator('[data-skill="sunder"]').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('04-start-room.png') });

  // sound is live after the first tap
  expect(await game<string>(page, 'w.sfx.state')).toBe('running');

  // walking
  const x0 = await game<number>(page, 's.sim.hero.x');
  const y0 = await game<number>(page, 's.sim.hero.y');
  if (info.project.name === 'phone') {
    const zone = await page.locator('#stick-zone').boundingBox();
    const sx = zone!.x + zone!.width * 0.4;
    const sy = zone!.y + zone!.height * 0.7;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy - 10, { steps: 4 });
    await page.waitForTimeout(600);
    await page.mouse.up();
  } else {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
  }
  const moved = Math.hypot((await game<number>(page, 's.sim.hero.x')) - x0, (await game<number>(page, 's.sim.hero.y')) - y0);
  expect(moved).toBeGreaterThan(1);

  // enter a combat room: doors lock, enemies spawn, the auto-attack connects
  const roomId = await enterRoom(page, 'combat');
  await page.waitForFunction((id) => {
    const s = (window as unknown as { __abyss: { scene: { director: { states: string[] } } } }).__abyss.scene;
    return s.director.states[id] === 'active';
  }, roomId);
  expect(await game<number>(page, 's.sim.livingEnemyCount()')).toBeGreaterThan(0);
  await page.waitForFunction(() => { const s = (window as unknown as { __abyss: { scene: { sim: { kills: number; enemies: { hp: number; maxHp: number }[] } } } }).__abyss.scene.sim; return s.kills > 0 || s.enemies.some((e) => e.hp < e.maxHp); }, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('05-combat.png') });
  expect(await game<number>(page, 's.sim.enemies.filter((e) => e.hp < e.maxHp).length + s.sim.kills')).toBeGreaterThan(0);
  await page.locator('#btn-skill').dispatchEvent('pointerdown', { pointerId: 8, isPrimary: true });
  await page.waitForTimeout(450);
  expect(await game<number>(page, 's.sim.hero.skillCd')).toBeGreaterThan(4);

  // clear the room through the hook and check the doors reopen
  for (let i = 0; i < 10; i++) {
    const active = await game<boolean>(page, `s.director.states[${roomId}] === 'active'`);
    if (!active) break;
    await game(page, `(s.sim.hero.hp = s.sim.hero.stats.maxHp, s.sim.enemies.forEach((e) => { if (e.state !== 'spawning' && e.state !== 'dead') s.sim.damageEnemy(e, { amount: 99999, crit: false }, 'attack', 0, 0); }))`);
    await page.waitForTimeout(1200);
    // close any level-up choice that popped up meanwhile
    if (await page.locator('#screen-choice').isVisible()) await page.locator('#choice-cards .card').first().click();
  }
  expect(await game<string>(page, `s.director.states[${roomId}]`)).toBe('cleared');

  // level up → choice of three
  await game(page, 's.sim.grantXp(500)');
  await expect(page.locator('#screen-choice')).toBeVisible();
  await expect(page.locator('#choice-cards .card')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('06-choice.png') });
  while (await page.locator('#screen-choice').isVisible()) await page.locator('#choice-cards .card').first().click();
  const ups = await game<number>(page, 'Object.values(s.sim.hero.upgrades).reduce((a, b) => a + b, 0)');
  expect(ups).toBeGreaterThan(0);

  // character sheet in the pause menu; the world is frozen meanwhile
  await page.locator('#btn-hero').click();
  await expect(page.locator('#screen-pause')).toBeVisible();
  await expect(page.locator('#sheet')).toContainText('Szybkość ataku');
  const tPaused = await game<number>(page, 's.sim.time');
  await page.waitForTimeout(300);
  expect(await game<number>(page, 's.sim.time')).toBe(tPaused);
  await page.screenshot({ path: info.outputPath('07-pause-sheet.png') });
  await page.locator('#btn-resume').click();
  await expect(page.locator('#screen-pause')).toBeHidden();

  // the boss lair: the boss rises, its health bar shows; beating it opens the stairs
  await enterRoom(page, 'exit');
  await expect(page.locator('#boss-bar')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#boss-name')).toHaveText('Strażnik Krypt');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('07b-boss.png') });
  await game(page, `(() => { const b = s.sim.getEnemy(s.director.bossId); s.sim.hero.hp = 1e6; b.phase = 2; b.invulnerable = false; b.hp = 1; s.sim.damageEnemy(b, { amount: 5, crit: false }, 'attack', 0, 0); })()`);
  await page.waitForFunction(() => {
    const s = (window as unknown as { __abyss: { scene: { sim: { objects: { kind: string; active: boolean }[] } } } }).__abyss.scene.sim;
    return s.objects.some((o) => o.kind === 'stairs' && o.active);
  });
  await expect(page.locator('#boss-bar')).toBeHidden();
  if (await page.locator('#screen-choice').isVisible()) while (await page.locator('#screen-choice').isVisible()) await page.locator('#choice-cards .card').first().click();
  // boss loot lands in the inventory once walked over
  await game(page, `(() => { for (const p of s.sim.pickups) { p.x = s.sim.hero.x; p.y = s.sim.hero.y; p.age = 1; } })()`);
  await page.waitForTimeout(400);
  expect(await game<number>(page, 'w.save.data.inventory.items.length')).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('07c-loot.png') });

  // stairs → floor 2
  await game(page, `(() => { const o = s.sim.objects.find((x) => x.kind === 'stairs'); s.sim.hero.x = o.x + 2; s.sim.hero.y = o.y; })()`);
  await page.waitForTimeout(150);
  await game(page, `(() => { const o = s.sim.objects.find((x) => x.kind === 'stairs'); s.sim.hero.x = o.x; s.sim.hero.y = o.y; })()`);
  await page.waitForFunction(() => (window as unknown as { __abyss: { scene: { run?: { depth: number } } } }).__abyss.scene.run?.depth === 2, null, {
    timeout: 5000,
  });
  await page.waitForFunction(() => (window as unknown as { __abyss: { scene: { mode: string } } }).__abyss.scene.mode === 'playing');
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath('08-floor2.png') });

  // death → summary → sanctuary
  await game(page, '(s.sim.ash = 50, s.sim.hero.iframeT = 0, s.sim.hero.hurtT = 0, s.sim.damageHero(99999))');
  await expect(page.locator('#screen-end')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#end-ash')).toHaveText('30');
  await page.screenshot({ path: info.outputPath('09-end.png') });
  await page.locator('#btn-end-sanct').click();
  await expect(page.locator('#ranks .rank')).toHaveCount(6);
  await page.locator('[data-rank="vitality"]').click();
  await expect(page.locator('#sanct-ash')).toHaveText('15');
  await page.screenshot({ path: info.outputPath('10-sanctuary.png') });

  // progress survives a reload
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __abyss?: { scene?: { mode?: string } } }).__abyss?.scene?.mode === 'menu');
  await expect(page.locator('#title-ash')).toHaveText('15');
  expect(await game<number>(page, 'w.save.data.ranks.vitality')).toBe(1);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('inventory: found gear is worn, compared and changes the stats', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await startRun(page, 'warden', 'sunder');
  // drop a legendary sword at the hero's feet
  await game(page, `(() => { const h = s.sim.hero; let it; for (let i = 0; i < 400 && !(it && it.unique === 'kiel'); i++) { s.sim.pickups = []; it = s.sim.dropItem('boss', h.x, h.y); } for (const p of s.sim.pickups) { p.age = 1; } })()`);
  await page.waitForTimeout(500);
  await expect(page.locator('#toast')).toContainText('Żarzący Kieł');
  expect(await game<number>(page, 's.sim.hero.stats.burn')).toBeGreaterThan(0);
  // a second, worse sword goes to the bag; the inventory compares them
  await game(page, `(() => { const h = s.sim.hero; s.sim.pickups = []; let it; do { s.sim.pickups = []; it = s.sim.dropItem('enemy', h.x, h.y); } while (it.base !== 'sword' && it.base !== 'axe' && it.base !== 'mace'); for (const p of s.sim.pickups) p.age = 1; })()`);
  await page.waitForTimeout(400);
  await page.locator('#btn-bag').click();
  await expect(page.locator('#screen-inv')).toBeVisible();
  await expect(page.locator('#inv-slots .slot').first()).toContainText('Żarzący Kieł');
  await page.locator('#inv-bag .tile').first().click();
  await expect(page.locator('#inv-detail')).toContainText(/Zamień|Załóż/);
  await page.screenshot({ path: info.outputPath('inventory.png') });
  const dmgBefore = await game<number>(page, 's.sim.hero.stats.damage');
  await page.locator('#inv-detail [data-act="equip"]').click();
  expect(await game<number>(page, 's.sim.hero.stats.damage')).not.toBe(dmgBefore);
  await page.locator('#screen-inv [data-back]').click();
  await expect(page.locator('#screen-inv')).toBeHidden();
  expect(await game<string>(page, 's.mode')).toBe('playing');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('deeper floors look different and bring new enemies', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await startRun(page, 'wanderer', 'seal');
  for (const depth of [2, 3]) {
    await game(page, `(() => { const o = s.sim.objects.find((x) => x.kind === 'stairs'); o.active = true; s.sim.hero.x = o.x; s.sim.hero.y = o.y; })()`);
    await page.waitForFunction((d) => (window as unknown as { __abyss: { scene: { run?: { depth: number }; mode: string } } }).__abyss.scene.run?.depth === d && (window as unknown as { __abyss: { scene: { mode: string } } }).__abyss.scene.mode === 'playing', depth, { timeout: 6000 });
    expect(await game<string>(page, 's.dungeon.biome')).toBe(depth === 2 ? 'frost' : 'forge');
    await enterRoom(page, 'combat');
    await page.waitForTimeout(2200);
    await page.screenshot({ path: info.outputPath(`floor${depth}.png`) });
    await game(page, 's.sim.hero.hp = s.sim.hero.stats.maxHp');
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('wanderer shoots bolts and the volley fan', async ({ page }) => {
  const errors = watchErrors(page);
  await boot(page);
  await startRun(page, 'wanderer', 'volley');
  await enterRoom(page, 'combat');
  await page.waitForFunction(() => { const s = (window as unknown as { __abyss: { scene: { sim: { kills: number; enemies: { hp: number; maxHp: number }[] } } } }).__abyss.scene.sim; return s.kills > 0 || s.enemies.some((e) => e.hp < e.maxHp); }, null, { timeout: 10000 });

  expect(await game<number>(page, 's.sim.enemies.filter((e) => e.hp < e.maxHp).length + s.sim.kills')).toBeGreaterThan(0);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(100);
  expect(await game<number>(page, 's.sim.hero.skillCd')).toBeGreaterThan(3);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('tab hidden pauses the game', async ({ page }) => {
  await boot(page);
  await startRun(page, 'warden', 'charge');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#screen-pause')).toBeVisible();
  expect(await game<string>(page, 's.mode')).toBe('paused');
});

test('page does not scroll or zoom from touch gestures (CSS guards present)', async ({ page }) => {
  await boot(page);
  const css = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return { touch: b.touchAction, select: b.userSelect || b.webkitUserSelect, overflow: b.overflow };
  });
  expect(css.touch).toBe('none');
  expect(css.select).toBe('none');
  expect(css.overflow).toBe('hidden');
});
