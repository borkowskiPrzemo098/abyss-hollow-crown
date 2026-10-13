import { expect, test, type Page } from '@playwright/test';
import { SKILL_UPGRADE_LIST } from '../src/config/skillUpgrades';

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
  // wear only the wanted skill: add it first (the last worn skill cannot be removed), then drop the rest
  const want = page.locator(`#skill-cards [data-skill="${skill}"]`);
  if ((await want.getAttribute('aria-pressed')) !== 'true') await want.click();
  const worn = await page.locator('#skill-cards .sk.is-on').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.skill));
  for (const id of worn) if (id !== skill) await page.locator(`#skill-cards [data-skill="${id}"]`).click();
  await page.locator('#btn-start').click();
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
  // the loadout screen: ten skills, two open at the start, three slots, one worn
  await expect(page.locator('#skill-cards .sk')).toHaveCount(10);
  await expect(page.locator('#skill-cards .sk.is-locked')).toHaveCount(8);
  await expect(page.locator('#skill-slots .lo-slot')).toHaveCount(3);
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(1);
  await expect(page.locator('[data-skill="crush"]')).toBeDisabled();
  await page.locator('#skill-cards [data-skill="charge"]').click();
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(2);
  await page.locator('#skill-cards [data-skill="charge"]').click();
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(1);
  await page.locator('#skill-cards [data-skill="sunder"]').click();
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(1);
  await expect(page.locator('#skill-msg')).toContainText('przynajmniej');
  await page.locator('#skill-cards [data-skill="charge"]').click();
  await page.screenshot({ path: info.outputPath('03-skill-select.png') });
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-skill2')).toBeVisible();
  await expect(page.locator('#btn-skill3')).toBeHidden();
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
  expect(await game<number>(page, 's.sim.hero.skills[0].cd')).toBeGreaterThan(4);

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
  expect(await game<number>(page, 's.sim.hero.skills[0].cd')).toBeGreaterThan(3);
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

test('three skills: the limit holds, locked ones stay shut, the choice survives a reload, all buttons work', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  // earn everything for the Strażnik through the debug hook (the real unlocks are covered by unit tests)
  await game(page, '(s.services.save.data.progress.warden = { runs: 9, kills: 999, bestFloor: 3, wins: 1 }, 0)');
  await page.locator('#btn-new').click();
  await page.locator('[data-hero="warden"]').click();
  await expect(page.locator('#skill-cards .sk.is-locked')).toHaveCount(0);
  // the other class's skills are not on this screen at all
  await expect(page.locator('#skill-cards [data-skill="volley"]')).toHaveCount(0);
  await page.locator('#skill-cards [data-skill="warcry"]').click();
  await page.locator('#skill-cards [data-skill="bastion"]').click();
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(3);
  await page.locator('#skill-cards [data-skill="axe"]').click();
  await expect(page.locator('#skill-msg')).toContainText('zdejmij');
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('loadout-full.png') });

  // the choice is saved: reload the page and look again
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __abyss?: { scene?: { mode?: string } } }).__abyss?.scene?.mode === 'menu');
  await page.locator('#btn-new').click();
  await page.locator('[data-hero="warden"]').click();
  await expect(page.locator('#skill-slots .lo-slot:not(.is-empty)')).toHaveCount(3);
  await expect(page.locator('#skill-cards .sk.is-on')).toHaveCount(3);
  expect(await game<string[]>(page, 's.services.save.data.loadout.warden')).toEqual(['sunder', 'warcry', 'bastion']);

  await page.locator('#btn-start').click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(await game<string[]>(page, 's.sim.hero.skills.map((x) => x.def.id)')).toEqual(['sunder', 'warcry', 'bastion']);

  // the three buttons fit on screen and do not overlap each other or the dodge button
  const boxes = await page.locator('.act:visible').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.id, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  expect(boxes.map((b) => b.id).sort()).toEqual(['btn-dodge', 'btn-skill', 'btn-skill2', 'btn-skill3']);
  const vw = page.viewportSize()!;
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(vw.width);
    expect(b.y + b.h).toBeLessThanOrEqual(vw.height);
    expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(60);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, a.id + ' vs ' + b.id).toBe(false);
    }

  // each button fires its own skill (touch on phones, keyboard on desktop)
  const press = async (slot: 1 | 2 | 3) => {
    if (info.project.name === 'desktop') await page.keyboard.press(slot === 1 ? 'KeyE' : slot === 2 ? 'KeyR' : 'KeyF');
    else await page.locator(slot === 1 ? '#btn-skill' : '#btn-skill' + slot).tap();
  };
  await press(2);
  await page.waitForTimeout(450);
  let cds = await game<number[]>(page, 's.sim.hero.skills.map((x) => x.cd)');
  expect(cds[0]).toBe(0);
  expect(cds[1]).toBeGreaterThan(5);
  expect(cds[2]).toBe(0);
  await press(3);
  await page.waitForTimeout(300);
  cds = await game<number[]>(page, 's.sim.hero.skills.map((x) => x.cd)');
  expect(cds[2]).toBeGreaterThan(5);
  expect(await game<number>(page, 's.sim.hero.guardT')).toBeGreaterThan(0);
  await press(1);
  await page.waitForTimeout(300);
  cds = await game<number[]>(page, 's.sim.hero.skills.map((x) => x.cd)');
  expect(cds[0]).toBeGreaterThan(3);
  await page.screenshot({ path: info.outputPath('three-skills-hud.png') });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('skill upgrades: offered with exact numbers, applied, listed in the pause sheet, remembered', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await game(page, '(s.services.save.data.progress.warden = { runs: 9, kills: 999, bestFloor: 3, wins: 1 }, 0)');
  await startRun(page, 'warden', 'sunder');

  // a chest offers three cards: one stat, two upgrades of the worn skill
  await game(page, "(s.sim.queueChoice('chest'), 0)");
  await expect(page.locator('#screen-choice')).toBeVisible();
  await expect(page.locator('#choice-cards .card')).toHaveCount(3);
  const up = page.locator('#choice-cards .card-skillup');
  await expect(up).toHaveCount(2);
  for (const card of await up.all()) {
    await expect(card.locator('.up-lines li').first()).toBeVisible();
    await expect(card.locator('.card-role')).toContainText('Rozłam');
  }
  // nothing runs off the screen
  const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(width.doc).toBeLessThanOrEqual(width.win);
  await page.screenshot({ path: info.outputPath('skill-upgrade-cards.png') });

  const taken = await up.first().getAttribute('data-up');
  await up.first().click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(await game<number>(page, `s.sim.hero.skillUpgrades['${taken}']`)).toBe(1);
  expect(await game<string[]>(page, 's.sim.skillUpgradeLog')).toEqual([taken]);

  // the pause sheet lists it with its level
  await page.locator('#btn-hero').click();
  await expect(page.locator('#sheet')).toContainText('Ulepszenia umiejętności');
  await expect(page.locator('#sheet .sheet-ups').last()).toContainText('1/');
  await page.screenshot({ path: info.outputPath('skill-upgrade-sheet.png') });
  await page.keyboard.press('Escape');

  // dying banks it into the codex, and the loadout screen shows the count after a reload
  await game(page, '(s.sim.hero.hp = 1, s.sim.hero.iframeT = 0, s.sim.hero.hurtT = 0, s.sim.damageHero(99), 0)');
  await expect(page.locator('#screen-end')).toBeVisible({ timeout: 8000 });
  expect(await game<string[]>(page, 's.services.save.data.codex')).toEqual([taken]);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __abyss?: { scene?: { mode?: string } } }).__abyss?.scene?.mode === 'menu');
  await page.locator('#btn-new').click();
  await page.locator('[data-hero="warden"]').click();
  await expect(page.locator('#skill-cards [data-skill="sunder"] .sk-codex')).toContainText('1 / 4');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('statuses and reactions: named on the cards and in the sheet, drawn on enemies without errors', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await game(page, '(s.services.save.data.progress.wanderer = { runs: 9, kills: 999, bestFloor: 3, wins: 1 }, 0)');
  await page.locator('#btn-new').click();
  await page.locator('[data-hero="wanderer"]').click();
  // the cards say which reactions a skill takes part in; skills outside every reaction say nothing
  await expect(page.locator('[data-skill="snipe"] .sk-syn')).toContainText('Burza znaku');
  await expect(page.locator('[data-skill="snipe"] .sk-syn')).toContainText('Rozbicie');
  await expect(page.locator('[data-skill="ward"] .sk-syn')).toHaveCount(0);
  await page.locator('#skill-cards [data-skill="snipe"]').click();
  await page.locator('#btn-start').click();
  await expect(page.locator('#hud')).toBeVisible();

  // every kind of status on a small crowd, then let the renderer draw a few frames
  await game(
    page,
    `(() => {
      const sim = s.sim; const h = sim.hero;
      const mk = (dx, dy) => { const e = sim.spawnEnemy('brute', h.x + dx, h.y + dy, { instant: true }); e.state = 'stunned'; e.stateT = e.stateDur = 999; return e; };
      const a = mk(2.5, 0), b = mk(3.5, 1.2), c = mk(2.2, -1.5), d = mk(4.5, -0.5);
      a.markT = 6; a.markSeq = 1;
      b.bleedStacks = 3; b.bleedT = 4; b.bleedTick = 0.5;
      c.burnT = 3; c.burnDps = 4;
      d.chillT = 3;
      return 0;
    })()`,
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath('statuses-in-play.png') });

  await page.locator('#btn-hero').click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toContainText('Reakcje twoich umiejętności');
  await expect(sheet).toContainText('Burza znaku');
  await expect(sheet).toContainText('Rozbicie');
  await expect(sheet).not.toContainText('Rozerwanie'); // no warden skills worn
  await expect(sheet).toContainText('Krwawienie');
  await expect(sheet).toContainText('Oznaczenie');
  await page.screenshot({ path: info.outputPath('statuses-sheet.png') });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('character menu: every skill with its effect, unlock requirement and upgrades, for both classes', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await page.locator('#btn-codex').click();
  await expect(page.locator('#screen-codex')).toBeVisible();
  // a new player sees all ten skills of the Strażnik, two open and eight locked, each saying how to open it
  await expect(page.locator('#codex-skills .cx')).toHaveCount(10);
  await expect(page.locator('#codex-skills .cx.is-locked')).toHaveCount(8);
  await expect(page.locator('#codex-skills .cx.is-locked .cx-state').first()).toContainText('Zablokowana');
  await expect(page.locator('#codex-head')).toContainText('2 / 10');
  // open a locked skill: the requirement with progress, the reactions and every upgrade level are readable
  const byName = (name: string) => page.locator('#codex-skills .cx').filter({ has: page.locator('.cx-name', { hasText: new RegExp(`^${name}$`) }) });
  const crush = byName('Miażdżący Cios');
  await crush.locator('summary').click();
  await expect(crush.locator('.cx-unlock')).toContainText('Ukończ 2 wyprawy');
  await expect(crush.locator('.cx-unlock')).toContainText('0 z 2');
  await expect(crush).toContainText('Reakcje ze statusami');
  await expect(crush).toContainText('Rozbicie');
  await expect(crush.locator('.cx-ups > li')).toHaveCount(3);
  await expect(crush.locator('.cx-levels li').first()).toContainText('Poz. 1');
  await expect(crush).toContainText('Obrażenia: +25%');
  await page.screenshot({ path: info.outputPath('codex-warden.png') });
  // the other class
  await page.locator('#codex-tabs [data-tab="wanderer"]').click();
  await expect(page.locator('#codex-skills .cx')).toHaveCount(10);
  await expect(byName('Gwiezdny Deszcz')).toContainText('Pokonaj 350 wrogów');
  // all upgrades of both classes are listed somewhere in the menu
  let total = 0;
  for (const hero of ['warden', 'wanderer']) {
    await page.locator(`#codex-tabs [data-tab="${hero}"]`).click();
    total += await page.locator('#codex-skills .cx-ups > li').count();
  }
  expect(total).toBe(SKILL_UPGRADE_LIST.length);
  await page.locator('#screen-codex [data-back]').click();
  await expect(page.locator('#screen-title')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a run can be put down and picked up again, even after the page is reloaded', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await expect(page.locator('#btn-continue')).toBeHidden();
  await startRun(page, 'warden', 'sunder');
  // some progress: a level, ash, a few steps
  await game(page, '(s.sim.grantXp(40), 0)');
  await expect(page.locator('#screen-choice')).toBeVisible();
  await page.locator('#choice-cards .card').first().click();
  await expect(page.locator('#hud')).toBeVisible();
  await game(page, '(s.sim.ash = 17, s.sim.hero.x += 1.5, s.sim.hero.px = s.sim.hero.x, 0)');
  const before = await game<{ level: number; x: number; y: number; ash: number; skills: string[] }>(
    page,
    '({ level: s.sim.hero.level, x: s.sim.hero.x, y: s.sim.hero.y, ash: s.sim.ash, skills: s.sim.hero.skills.map((k) => k.def.id) })',
  );
  expect(before.level).toBeGreaterThanOrEqual(2);

  // pause (which also writes a checkpoint), save and leave
  await page.locator('#btn-pause').click();
  await expect(page.locator('#screen-pause')).toBeVisible();
  await page.locator('#btn-save-quit').click();
  await expect(page.locator('#screen-title')).toBeVisible();
  await expect(page.locator('#btn-continue')).toBeVisible();
  await expect(page.locator('#continue-note')).toContainText('piętro 1');
  await page.screenshot({ path: info.outputPath('title-with-saved-run.png') });

  // the save is on disk, not in memory: reload the page and it is still there
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __abyss?: { scene?: { mode?: string } } }).__abyss?.scene?.mode === 'menu');
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.locator('#btn-continue').click();
  await expect(page.locator('#hud')).toBeVisible();
  expect(await game<string>(page, 's.mode')).toBe('playing');
  const after = await game<{ level: number; x: number; y: number; ash: number; skills: string[]; depth: number }>(
    page,
    '({ level: s.sim.hero.level, x: s.sim.hero.x, y: s.sim.hero.y, ash: s.sim.ash, skills: s.sim.hero.skills.map((k) => k.def.id), depth: s.dungeon.depth })',
  );
  expect(after.level).toBe(before.level);
  expect(after.ash).toBe(before.ash);
  expect(after.skills).toEqual(before.skills);
  expect(after.depth).toBe(1);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.05);

  // a new run replaces the saved one
  await page.locator('#btn-pause').click();
  await page.locator('#btn-abandon').click();
  await expect(page.locator('#screen-end')).toBeVisible();
  await page.locator('#btn-again').click();
  await page.locator('[data-hero="warden"]').click();
  await page.locator('#btn-start').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#btn-pause').click();
  await page.locator('#btn-save-quit').click();
  await expect(page.locator('#continue-note')).toContainText('poz. 1');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a big floor costs little to draw: rooms are built when found and only the ones on screen are shown', async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page);
  await startRun(page, 'warden', 'sunder');
  const floor = await game<{ rooms: number; tiles: number }>(page, '({ rooms: s.dungeon.rooms.length, tiles: s.dungeon.map.w * s.dungeon.map.h })');
  expect(floor.rooms).toBeGreaterThanOrEqual(20);
  expect(floor.tiles).toBeGreaterThanOrEqual(100 * 100);
  const atStart = await game<{ regions: number; built: number; objects: number }>(page, 's.world.stats()');
  // only the entrance has been built, though the floor holds dozens of regions and thousands of tiles
  expect(atStart.built).toBeLessThanOrEqual(3);
  expect(atStart.regions).toBeGreaterThan(40);
  const gameObjectsAtStart = await game<number>(page, 's.children.length');

  // walk the whole main route (teleporting; the rooms are revealed as the hero enters them)
  const route = await game<number[]>(page, 's.dungeon.mainRoute');
  for (const id of route.slice(1)) {
    await game(page, `(() => { const r = s.dungeon.rooms[${id}]; const h = s.sim.hero; h.x = h.px = r.x0 + 1.5; h.y = h.py = r.y0 + 1.5; h.hp = h.stats.maxHp; s.sim.enemies.forEach((e) => { if (e.state !== 'dead') s.sim.damageEnemy(e, { amount: 99999, crit: false }, 'attack', 0, 0); }); return 0; })()`);
    await page.waitForTimeout(120);
    if (await page.locator('#screen-choice').isVisible()) await page.locator('#choice-cards .card').first().click();
  }
  await page.waitForTimeout(600);
  const explored = await game<{ regions: number; built: number; revealed: number; objects: number; shown: number }>(page, 's.world.stats()');
  expect(explored.built).toBeGreaterThanOrEqual(route.length);
  // far fewer objects are shown than exist: what is off screen is hidden
  expect(explored.shown).toBeLessThan(explored.objects * 0.35);

  // frame time over a few seconds of play in the middle of the floor
  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const tick = (t: number) => {
          out.push(t - last);
          last = t;
          if (out.length < 180) requestAnimationFrame(tick);
          else resolve(out.slice(10));
        };
        requestAnimationFrame(tick);
      }),
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  test.info().annotations.push({ type: 'perf', description: `${floor.rooms} rooms, ${floor.tiles} tiles; built ${explored.built}/${explored.regions} regions, ${explored.shown}/${explored.objects} objects shown, objects at start ${gameObjectsAtStart}; frame mean ${mean.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${info.project.name}, desktop Edge, not a phone)` });
  expect(mean).toBeLessThan(34);
  await page.screenshot({ path: info.outputPath('big-floor.png') });
  expect(errors, errors.join('\n')).toEqual([]);
});
