import Phaser from 'phaser';
import type { Sfx } from '../audio/sfx';
import { ENEMIES, MAX_STEPS_PER_FRAME, SIM_DT } from '../config/balance';
import { biomeFor } from '../config/biomes';
import { BASES, RARITY, SLOT_NAMES, type Item, type Slot } from '../config/items';
import { HEROES, type HeroId } from '../config/heroes';
import { RUN, xpToNext, type RankId } from '../config/progression';
import { SKILLS, SKILL_RULES, type SkillId } from '../config/skills';
import { SKILL_UPGRADES } from '../config/skillUpgrades';
import { SYNERGIES } from '../config/statuses';
import { screenDirToWorld, worldDirToScreenAngle, worldToScreenX, worldToScreenY } from '../core/iso';
import type { Controls } from '../input/controls';
import { addItem, bankRun, buyRank, equip, equipSkill, equippedItems, salvage, skillLoadout, unequip, unequipSkill, type SaveStore } from '../meta/save';
import { computeStats, emptyUpgrades } from '../sim/stats';
import { InventoryScreen } from '../ui/inventory';
import { EnemyView, HeroView } from '../render/actorView';
import { EntityViews } from '../render/entityViews';
import { Fx } from '../render/fx';
import { Overlays } from '../render/overlays';
import { PAL } from '../render/palette';
import { WorldView } from '../render/worldView';
import { DungeonDirector } from '../sim/director';
import { Simulation } from '../sim/simulation';
import type { ChoiceId, HeroBuild, SimEvent } from '../sim/types';
import type { Hud } from '../ui/hud';
import { Menus, type MenuActions, type ScreenId } from '../ui/menus';
import { Minimap } from '../ui/minimap';
import { generateDungeon, type Dungeon, type RoomType } from '../world/dungeon';

export interface Services {
  hud: Hud;
  controls: Controls;
  sfx: Sfx;
  save: SaveStore;
  dpr: () => number;
}

export type Mode = 'menu' | 'playing' | 'paused' | 'choice' | 'transition' | 'ended';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The short side of the screen shows about this many CSS px of world at zoom 1. */
const BASE_SHORT_SIDE = 330;

const ROOM_NAMES: Record<RoomType, string> = {
  start: 'Wejście',
  combat: 'Komnata',
  elite: 'Legowisko elity',
  treasure: 'Skarbiec',
  shrine: 'Kapliczka',
  exit: 'Strażnica schodów',
};

interface RunState {
  build: HeroBuild;
  seed: number;
  depth: number;
  time: number;
}

/** Sound played when a skill is cast (Rozłam, Szarża, Salwa and Pieczęć keep their own cues). */
const CAST_CUE: Partial<Record<SkillId, 'cast' | 'barrier' | 'roar' | 'volley' | 'zap' | 'seal' | 'dash' | 'shoot' | 'dodge' | 'frost' | 'ui'>> = {
  crush: 'cast',
  bastion: 'barrier',
  warcry: 'roar',
  axe: 'volley',
  hook: 'zap',
  banner: 'seal',
  whirl: 'dash',
  pact: 'cast',
  snipe: 'shoot',
  blink: 'dodge',
  ward: 'barrier',
  frost: 'frost',
  sentry: 'seal',
  mine: 'ui',
  starfall: 'cast',
  overload: 'zap',
};

export class GameScene extends Phaser.Scene {
  mode: Mode = 'menu';
  sim!: Simulation;
  dungeon!: Dungeon;
  director!: DungeonDirector;
  run: RunState | null = null;
  private services!: Services;
  private menus!: Menus;
  private inventory!: InventoryScreen;
  /** Where the inventory's back button goes. */
  private invReturn: 'title' | 'game' = 'title';
  private minimap!: Minimap;
  private world: WorldView | null = null;
  private fx!: Fx;
  private overlays!: Overlays;
  private entities!: EntityViews;
  private heroView: HeroView | null = null;
  private readonly enemyViews = new Map<number, EnemyView>();
  private acc = 0;
  private ghostT = 0;
  private camX = 0;
  private camY = 0;
  private minimapT = 0;
  private lastReveal = -1;
  private pendingHero: HeroId = 'warden';
  private sanctReturn: ScreenId = 'title';
  private saving = true;
  private readonly portraits = new Map<string, string>();
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    super('game');
  }

  create(): void {
    this.services = this.registry.get('services') as Services;
    this.cameras.main.setBackgroundColor(PAL.void);
    this.fx = new Fx(this);
    this.overlays = new Overlays(this);
    this.entities = new EntityViews(this);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
    this.menus = new Menus(this.menuActions(), (k) => this.portrait(k));
    this.inventory = new InventoryScreen({
      equip: (hero, uid) => {
        if (equip(this.services.save.data, hero, uid)) this.gearChanged(hero);
      },
      unequip: (hero, slot: Slot) => {
        unequip(this.services.save.data, hero, slot);
        this.gearChanged(hero);
      },
      salvage: (uid) => {
        if (salvage(this.services.save.data, uid) > 0) {
          this.services.sfx.play('pickup');
          this.persist();
        }
      },
      statsFor: (hero, gear) =>
        computeStats(HEROES[hero], this.services.save.data.ranks, this.run && this.sim.hero.cls.id === hero ? this.sim.hero.upgrades : emptyUpgrades(), gear),
    });

    const { hud, controls, sfx, save } = this.services;
    this.menus.setVolume(save.data.settings.volume);
    this.menus.setMuted(save.data.settings.muted);
    sfx.setVolume(save.data.settings.volume);
    sfx.setMuted(save.data.settings.muted);
    hud.onPause = () => this.pauseGame();
    hud.onHero = () => this.pauseGame();
    hud.onBag = () => this.openInventoryInRun();
    const toggle = () => {
      if (this.mode === 'playing') this.pauseGame();
      else if (this.mode === 'paused') this.resumeGame();
    };
    controls.onPause = toggle;
    controls.onSheet = toggle;

    this.showMenuWorld();
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    const onVisibility = () => {
      if (document.hidden) {
        this.pauseGame();
        sfx.suspend();
      } else sfx.resume();
    };
    const onBlur = () => this.pauseGame();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.cleanups.push(() => window.removeEventListener('blur', onBlur));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanups.forEach((c) => c()));

    if (save.status === 'corrupted') {
      this.saving = false;
      this.menus.show('corrupt');
    } else {
      this.saving = save.status !== 'unavailable';
      this.toTitle();
    }
  }

  // ───────────────────────────── menus & run flow ─────────────────────────────

  private portrait(key: string): string {
    let url = this.portraits.get(key);
    if (!url) {
      const src = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
      url = src.toDataURL();
      this.portraits.set(key, url);
    }
    return url;
  }

  private menuActions(): MenuActions {
    const click = () => {
      this.services.sfx.unlock();
      this.services.sfx.play('ui');
    };
    const persist = () => {
      if (this.saving) void this.services.save.save();
    };
    return {
      newRun: () => {
        click();
        this.menus.renderHeroes();
        this.menus.show('hero');
      },
      pickHero: (id) => {
        click();
        this.pendingHero = id;
        this.menus.renderSkills(id, this.services.save.data);
        this.menus.setLoadoutMessage('');
        this.menus.show('skill');
      },
      toggleSkill: (id) => {
        click();
        const save = this.services.save.data;
        const hero = this.pendingHero;
        let msg = '';
        if (save.loadout[hero].includes(id)) {
          if (unequipSkill(save, hero, id) === 'last') msg = 'Potrzebujesz przynajmniej jednej umiejętności.';
        } else {
          const err = equipSkill(save, hero, id);
          if (err === 'full') msg = `Masz już ${SKILL_RULES.maxSlots} umiejętności — najpierw zdejmij jedną.`;
          else if (err === 'locked') msg = 'Ta umiejętność jest jeszcze zablokowana.';
          else if (err) msg = 'Nie można wyposażyć tej umiejętności.';
        }
        persist();
        this.menus.renderSkills(hero, save);
        this.menus.setLoadoutMessage(msg);
      },
      startRun: () => {
        click();
        this.startRun(this.pendingHero);
      },
      openInventory: () => {
        click();
        this.invReturn = 'title';
        this.inventory.open(this.services.save.data, this.pendingHero, false);
        this.menus.show('inv');
      },
      openCodex: () => {
        click();
        this.menus.renderCodex(this.services.save.data, this.pendingHero);
        this.menus.show('codex');
      },
      openSanctuary: () => {
        click();
        this.sanctReturn = this.menus.current === 'end' ? 'end' : 'title';
        this.menus.renderSanctuary(this.services.save.data);
        this.menus.show('sanct');
      },
      buyRank: (id: RankId) => {
        if (!buyRank(this.services.save.data, id)) return;
        this.services.sfx.play('levelUp');
        persist();
        this.menus.renderSanctuary(this.services.save.data);
      },
      back: () => {
        click();
        const cur = this.menus.current;
        if (cur === 'inv' && this.invReturn === 'game') {
          this.closeInventoryInRun();
          return;
        }
        if (cur === 'skill') this.menus.show('hero');
        else if (cur === 'sanct' && this.sanctReturn === 'end') this.menus.show('end');
        else this.toTitle();
      },
      choose: (id: ChoiceId) => this.choose(id),
      resume: () => this.resumeGame(),
      abandon: () => {
        click();
        if (this.scene.isPaused()) this.scene.resume();
        this.endRun(false);
      },
      mute: (m) => {
        this.services.sfx.setMuted(m);
        this.services.save.data.settings.muted = m;
        persist();
      },
      volume: (v) => {
        this.services.sfx.setVolume(v);
        this.services.save.data.settings.volume = v;
        persist();
      },
      noSave: () => {
        click();
        this.saving = false;
        this.toTitle();
      },
      wipe: () => {
        click();
        void this.services.save.resetCorrupted().then(() => {
          this.saving = true;
          this.toTitle();
        });
      },
    };
  }

  private toTitle(): void {
    this.mode = 'menu';
    this.services.hud.show(false);
    this.services.sfx.setAmbience(false);
    this.menus.renderTitle(this.services.save.data, this.saving);
    this.menus.show('title');
  }

  /** A quiet dungeon start room behind the menus. */
  private showMenuWorld(): void {
    const build: HeroBuild = { heroId: 'warden', skills: ['sunder'], ranks: { ...this.services.save.data.ranks }, gear: [] };
    const d = generateDungeon(20261013, 1);
    this.sim = new Simulation(d.map, { seed: 1, build });
    this.setupFloor(d, build.heroId);
  }

  private seedFromUrl(): number {
    const p = new URLSearchParams(location.search).get('seed');
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) ? n >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  }

  startRun(heroId: HeroId): void {
    const { hud, controls, sfx, save } = this.services;
    const skills = skillLoadout(save.data, heroId);
    const build: HeroBuild = { heroId, skills, ranks: { ...save.data.ranks }, gear: equippedItems(save.data, heroId) };
    const seed = this.seedFromUrl();
    this.run = { build, seed, depth: 1, time: 0 };
    const d = generateDungeon(seed, 1);
    this.sim = new Simulation(d.map, { seed, build });
    this.setupFloor(d, heroId);
    hud.setSkills(skills.map((id) => ({ id, name: SKILLS[id].name })));
    this.menus.show(null);
    hud.show(true);
    controls.release();
    controls.enabled = true;
    sfx.setAmbience(true);
    this.mode = 'playing';
    const b1 = biomeFor(1);
    hud.showBanner(b1.name, b1.sub, 3);
  }

  private setupFloor(d: Dungeon, heroId: HeroId): void {
    this.dungeon = d;
    this.world?.destroy();
    this.world = new WorldView(this, d);
    this.director = new DungeonDirector(this.sim, d);
    this.sim.director = this.director;
    this.world.reveal(this.director.revealedRooms, this.director.revealedCorridors, true);
    this.lastReveal = this.director.revealVersion;
    this.minimap.setDungeon(d);
    this.entities.clear();
    for (const v of this.enemyViews.values()) v.destroy();
    this.enemyViews.clear();
    this.overlays.reset();
    if (!this.heroView || this.heroView.heroId !== heroId) {
      this.heroView?.destroy();
      this.heroView = new HeroView(this, heroId);
    }
    this.acc = 0;
    const h = this.sim.hero;
    this.heroView.update(h, h.x, h.y, 0, 0);
    this.camX = this.heroView.sx;
    this.camY = this.heroView.sy - 26;
    this.cameras.main.centerOn(this.camX, this.camY);
    this.services.hud.setWhere(`Poziom ${d.depth} · ${ROOM_NAMES.start}`);
  }

  private async nextFloor(): Promise<void> {
    const run = this.run;
    if (!run || this.mode !== 'playing') return;
    const { hud, controls } = this.services;
    this.mode = 'transition';
    controls.enabled = false;
    controls.release();
    const next = run.depth + 1;
    if (next > RUN.floors) {
      await hud.fadeOut('Na powierzchnię');
      hud.fadeIn();
      this.endRun(true);
      return;
    }
    await hud.fadeOut(`Poziom ${next}`);
    run.depth = next;
    const d = generateDungeon((run.seed + next * 7349) >>> 0, next);
    this.sim.loadMap(d.map);
    this.setupFloor(d, run.build.heroId);
    hud.fadeIn();
    const bio = biomeFor(next);
    hud.showBanner(bio.name, bio.sub, 3);
    controls.enabled = true;
    this.mode = 'playing';
  }

  private endRun(won: boolean): void {
    const run = this.run;
    const { hud, controls, sfx, save } = this.services;
    controls.enabled = false;
    controls.release();
    hud.show(false);
    sfx.setAmbience(false);
    this.mode = 'ended';
    if (!run) {
      this.toTitle();
      return;
    }
    const { gained, unlocked } = bankRun(save.data, {
      hero: run.build.heroId,
      ash: this.sim.ash,
      won,
      floor: run.depth,
      kills: this.sim.kills,
      keepFraction: RUN.ashKeptOnDeath,
      bonus: RUN.victoryAshBonus,
      skillUpgrades: this.sim.skillUpgradeLog,
    });
    if (this.saving) void save.save();
    this.menus.renderEnd({ won, floor: run.depth, kills: this.sim.kills, level: this.sim.hero.level, seconds: run.time, ashKept: gained, loot: [...this.sim.loot], unlocked });
    this.menus.show('end');
    this.run = null;
  }

  pauseGame(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.services.controls.enabled = false;
    this.services.controls.release();
    this.services.hud.clearBanner();
    this.services.hud.show(false);
    this.menus.renderSheet(this.sim.hero);
    this.menus.show('pause');
    this.scene.pause();
  }

  resumeGame(): void {
    if (this.mode !== 'paused') return;
    this.services.sfx.play('ui');
    this.scene.resume();
    this.menus.show(null);
    this.services.hud.show(true);
    this.services.controls.release();
    this.services.controls.enabled = true;
    this.mode = 'playing';
  }

  private persist(): void {
    if (this.saving) void this.services.save.save();
  }

  /** After equipping/unequipping: save, and if that hero is in the dungeon, re-derive its stats. */
  private gearChanged(hero: HeroId): void {
    this.services.sfx.play('ui');
    this.persist();
    if (this.run && this.sim.hero.cls.id === hero) this.sim.setGear(equippedItems(this.services.save.data, hero));
  }

  /** The bag button: the world pauses while you change gear. */
  private openInventoryInRun(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.services.controls.enabled = false;
    this.services.controls.release();
    this.services.hud.clearBanner();
    this.services.hud.show(false);
    this.invReturn = 'game';
    this.inventory.open(this.services.save.data, this.sim.hero.cls.id, true);
    this.menus.show('inv');
    this.scene.pause();
  }

  private closeInventoryInRun(): void {
    this.scene.resume();
    this.menus.show(null);
    this.services.hud.show(true);
    this.services.controls.release();
    this.services.controls.enabled = true;
    this.mode = 'playing';
  }

  /** A picked-up item goes straight into the saved inventory. */
  private onLoot(item: Item): void {
    const { hud, sfx, save } = this.services;
    const hero = this.sim.hero.cls.id;
    const res = addItem(save.data, item, hero);
    const r = RARITY[item.rarity];
    const slot = SLOT_NAMES[BASES[item.base]!.slot];
    if (res.salvaged > 0) hud.toast(`Torba pełna — <b>${item.name}</b> rozbity na ${res.salvaged} popiołu`, r.css);
    else hud.toast(`<b>${item.name}</b> · ${r.name.toLowerCase()} ${slot.toLowerCase()}${res.equipped ? ' — założony' : ''}`, r.css);
    if (res.equipped) this.sim.setGear(equippedItems(save.data, hero));
    sfx.play(item.rarity === 'legendary' ? 'legendary' : 'loot');
    if (item.rarity === 'legendary') hud.showBanner(item.name, 'Przedmiot legendarny', 2.4);
    this.persist();
  }

  private openChoice(): void {
    this.mode = 'choice';
    this.services.controls.enabled = false;
    this.services.controls.release();
    this.services.hud.clearBanner();
    this.services.hud.show(false);
    this.menus.renderChoice(this.sim.choices[0]!, this.sim.hero);
    this.menus.show('choice');
  }

  private choose(id: ChoiceId): void {
    if (this.mode !== 'choice' || !this.sim.applyChoice(id)) return;
    this.services.sfx.play('ui');
    if (this.sim.choices.length > 0) {
      this.menus.renderChoice(this.sim.choices[0]!, this.sim.hero);
      return;
    }
    this.menus.show(null);
    this.services.hud.show(true);
    this.services.controls.enabled = true;
    this.mode = 'playing';
  }

  /** Camera zoom keeps world scale constant in CSS pixels across devices and orientations. */
  private layout(): void {
    const dpr = this.services.dpr();
    const w = this.scale.width;
    const h = this.scale.height;
    const shortCss = Math.min(w, h) / dpr;
    const zoom = Phaser.Math.Clamp(shortCss / BASE_SHORT_SIDE, 0.95, 1.8) * dpr;
    this.cameras.main.setSize(w, h);
    this.cameras.main.setZoom(zoom);
  }

  // ───────────────────────────── frame loop ─────────────────────────────

  override update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const t = time / 1000;
    const sim = this.sim;
    const hv = this.heroView!;

    if (this.mode === 'playing' || this.mode === 'ended') {
      if (this.mode === 'playing') {
        const inp = this.services.controls.poll();
        const w = screenDirToWorld(inp.sx, inp.sy);
        sim.setInput({ moveX: w.x, moveY: w.y, dodge: inp.dodge, skill: inp.skills[0], skill2: inp.skills[1], skill3: inp.skills[2] });
        if (this.run) this.run.time += dt;
      } else {
        sim.setInput({ moveX: 0, moveY: 0, dodge: false, skill: false });
      }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        sim.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      for (const ev of sim.drainEvents()) this.handleEvent(ev);
      if (this.mode === 'playing' && sim.choices.length > 0) this.openChoice();
    }

    const alpha = this.mode === 'playing' || this.mode === 'ended' ? Math.min(1, this.acc / SIM_DT) : 1;
    const h = sim.hero;
    hv.update(h, lerp(h.px, h.x, alpha), lerp(h.py, h.y, alpha), dt, t);
    if (h.state === 'dodge' || h.state === 'dash') {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.045;
        this.fx.afterimage(hv.sx, hv.sy, hv.flipped, hv.body.rotation, hv.bodyKey);
      }
    }

    // frame-rate independent camera smoothing (the old per-frame lerp lagged more at low FPS)
    const k = 1 - Math.exp(-dt * 14);
    this.camX += (hv.sx - this.camX) * k;
    this.camY += (hv.sy - 26 - this.camY) * k;
    this.cameras.main.centerOn(this.camX, this.camY);

    const alive = new Set<number>();
    for (const e of sim.enemies) {
      alive.add(e.id);
      let v = this.enemyViews.get(e.id);
      if (!v) {
        v = new EnemyView(this, e, e.def.boss ? 0xffffff : biomeFor(this.dungeon.depth).enemyTint);
        this.enemyViews.set(e.id, v);
      }
      v.update(e, lerp(e.px, e.x, alpha), lerp(e.py, e.y, alpha), dt, t);
    }
    for (const [id, v] of this.enemyViews) {
      if (!alive.has(id)) {
        v.destroy();
        this.enemyViews.delete(id);
      }
    }

    const world = this.world!;
    if (this.director.revealVersion !== this.lastReveal) {
      world.reveal(this.director.revealedRooms, this.director.revealedCorridors);
      this.lastReveal = this.director.revealVersion;
    }
    world.updateDoors();
    world.updateTraps(sim, t);
    world.update(t);
    world.updateOcclusion(hv.sx, hv.sy, hv.root.depth);
    this.entities.sync(sim, alpha, t, (roomId) => world.isRevealed(roomId));
    this.overlays.draw(sim, this.enemyViews, dt, t);
    this.fx.update(dt);

    if (this.run) {
      this.minimapT -= dt;
      if (this.minimapT <= 0) {
        this.minimapT = 0.1;
        this.minimap.draw(this.dungeon, this.director, sim, t);
      }
      const boss = this.director.bossId !== null ? sim.getEnemy(this.director.bossId) : undefined;
      this.services.hud.setBoss(
        boss && boss.state !== 'dead' && boss.state !== 'spawning'
          ? { name: boss.def.name, title: boss.def.boss!.title, hp: boss.hp, maxHp: boss.maxHp, phase: boss.phase }
          : null,
      );
      const chips: { id: string; label: string; cd: number; active: boolean }[] = [];
      if (h.stats.frostShell) chips.push({ id: 'frostShell', label: '', cd: h.frostCd / 10, active: h.frostCd <= 0 });
      if (h.stats.barrierMax > 0) chips.push({ id: 'barrier', label: String(Math.ceil(h.barrier)), cd: 0, active: h.barrier > 0 });
      if (h.stats.frenzy) chips.push({ id: 'frenzy', label: '', cd: 0, active: h.frenzyT > 0 });
      if (h.guardT > 0) chips.push({ id: 'guard', label: '', cd: h.guardT / SKILLS.bastion.duration, active: true });
      if (h.pactT > 0) chips.push({ id: 'pact', label: '', cd: h.pactT / SKILLS.pact.duration, active: true });
      if (h.shield > 0) chips.push({ id: 'shield', label: String(Math.ceil(h.shield)), cd: h.shieldT / SKILLS.ward.duration, active: true });
      if (h.overloadT > 0) chips.push({ id: 'overload', label: '', cd: h.overloadT / SKILLS.overload.duration, active: true });
      this.services.hud.setEffects(chips);
      this.services.hud.update(
        {
          hp: h.hp,
          maxHp: h.stats.maxHp,
          xp: h.xp,
          xpNext: xpToNext(h.level),
          level: h.level,
          ash: sim.ash,
          dodgeCd: h.dodgeCd,
          dodgeMax: h.cls.dodge.cooldown,
          skills: h.skills.map((sl) => ({
            cd: sl.cd,
            max: sim.skillCooldown(sl.def),
            blocked: h.state === 'dodge' || h.state === 'dash' || h.state === 'cast' || h.state === 'dead' || h.skillLock > 0,
          })),
        },
        dt,
      );
    }
  }

  private screenOf(x: number, y: number): { x: number; y: number } {
    return { x: worldToScreenX(x, y), y: worldToScreenY(x, y) };
  }

  private handleEvent(ev: SimEvent): void {
    const { sfx, hud } = this.services;
    const h = this.sim.hero;
    const hv = this.heroView!;
    switch (ev.type) {
      case 'swing':
        hv.onSwing(worldDirToScreenAngle(Math.cos(ev.angle), Math.sin(ev.angle)));
        if (h.cls.attack.kind === 'melee') sfx.play('swing');
        break;
      case 'whiff':
        if (h.cls.attack.kind === 'melee') {
          this.fx.slash(hv.sx, hv.sy - 20, worldDirToScreenAngle(Math.cos(h.facing), Math.sin(h.facing)), false);
          sfx.play('whiff');
        }
        break;
      case 'shoot':
        sfx.play(ev.team === 'hero' ? 'shoot' : 'emberShot');
        break;
      case 'projectileEnd': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.sparksAt(p.x, p.y - 18, ev.team === 'hero' ? 3 : 6);
        break;
      }
      case 'damage': {
        const v = this.enemyViews.get(ev.targetId);
        v?.onHit();
        const p = this.screenOf(ev.x, ev.y);
        const head = v ? v.headY : -48;
        this.fx.floater(p.x, p.y + head - 6, ev.crit ? `${ev.amount}!` : String(ev.amount), ev.crit ? 'crit' : ev.source === 'burn' ? 'burn' : ev.source === 'bleed' ? 'bleed' : ev.source === 'chain' || ev.source === 'arc' ? 'evade' : 'hit');
        if (ev.source === 'burn' || ev.source === 'bleed') break;
        this.fx.sparksAt(p.x, p.y + head * 0.45, ev.crit ? 14 : 6);
        this.fx.boneAt(p.x, p.y + head * 0.45, ev.source === 'skill' ? 6 : 3);
        if (ev.source === 'attack') {
          const ang = worldDirToScreenAngle(ev.x - h.x, ev.y - h.y);
          this.fx.slash(hv.sx + Math.cos(ang) * 10, hv.sy - 20 + Math.sin(ang) * 6, ang, ev.crit);
        }
        if (ev.source === 'attack' || ev.source === 'bolt') sfx.play(ev.crit ? 'crit' : 'hit');
        if (ev.crit) this.fx.shake(0.0035, 90);
        break;
      }
      case 'death': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.soulAt(p.x, p.y - 24, ev.kind === 'brute' ? 16 : 9);
        this.fx.boneAt(p.x, p.y - 20, ev.kind === 'brute' ? 14 : 8);
        sfx.play('death');
        break;
      }
      case 'dodge':
        this.ghostT = 0;
        this.fx.dustAt(hv.sx, hv.sy - 2, 8);
        sfx.play('dodge');
        break;
      case 'dash':
        this.ghostT = 0;
        this.fx.dustAt(hv.sx, hv.sy - 2, 12);
        this.fx.shake(0.004, 120);
        sfx.play('dash');
        break;
      case 'evade':
        this.fx.floater(hv.sx, hv.sy - 62, 'UNIK', 'evade');
        sfx.play('evade');
        break;
      case 'skillCast':
        hv.onCast();
        if (ev.skill === 'sunder') sfx.play('cast');
        else if (CAST_CUE[ev.skill]) sfx.play(CAST_CUE[ev.skill]!);
        break;
      case 'skillUpgrade': {
        const u = SKILL_UPGRADES[ev.id];
        if (u) hud.toast(`<b>${u.name}</b> · ${SKILLS[u.skill].name} ${ev.level}/${u.levels.length}`, 'var(--ember-hot)');
        sfx.play('levelUp');
        break;
      }
      case 'synergy': {
        // a reaction between a skill and a status: name it above the enemy and give it its own flourish
        const p = this.screenOf(ev.x, ev.y);
        const v = this.enemyViews.get(ev.targetId);
        const head = v ? v.headY : -48;
        this.fx.floater(p.x, p.y + head - 28, SYNERGIES[ev.id].name.toUpperCase(), 'evade');
        if (ev.id === 'rend') {
          this.fx.ring(p.x, p.y, 1.1, 0xe0647a, 0.3);
          this.fx.boneAt(p.x, p.y + head * 0.45, 8);
          sfx.play('crit');
        } else if (ev.id === 'stoke') {
          this.fx.ring(p.x, p.y, 1.4, PAL.ember, 0.4);
          this.fx.flamesAt(p.x, p.y - 8, 16);
          sfx.play('blast');
        } else if (ev.id === 'shatter') {
          this.fx.ring(p.x, p.y, 1.3, 0x9fd8ff, 0.35);
          this.fx.frostAt(p.x, p.y - 18, 22);
          sfx.play('frost');
        } else if (ev.id === 'trap') {
          this.fx.ring(p.x, p.y, 0.9, PAL.hollow, 0.3);
          sfx.play('ui');
        }
        break;
      }
      case 'skillFizzle':
        this.fx.floater(hv.sx, hv.sy - 62, 'BRAK CELU', 'evade');
        break;
      case 'skillFx': {
        const p = this.screenOf(ev.x, ev.y);
        if (ev.blast) {
          this.fx.ring(p.x, p.y, ev.radius, PAL.emberHot, 0.3);
          this.fx.flamesAt(p.x, p.y - 4, 10);
          this.fx.shake(0.003, 90);
          sfx.play('blast');
          break;
        }
        const color = ev.skill === 'frost' ? 0x9fd8ff : ev.skill === 'mine' || ev.skill === 'sentry' || ev.skill === 'ward' || ev.skill === 'blink' ? PAL.hollow : PAL.emberHot;
        this.fx.ring(p.x, p.y, ev.radius, color, ev.skill === 'whirl' ? 0.22 : 0.4);
        if (ev.skill === 'frost') this.fx.frostAt(p.x, p.y - 18, 22);
        else if (ev.skill === 'mine' || ev.skill === 'starfall') {
          this.fx.flamesAt(p.x, p.y - 4, 16);
          this.fx.debrisAt(p.x, p.y - 4, 8);
          this.fx.shake(0.006, 140);
          sfx.play('blast');
        } else if (ev.skill === 'blink') {
          const q = this.screenOf(ev.x2 ?? ev.x, ev.y2 ?? ev.y);
          this.fx.dustAt(q.x, q.y - 2, 8);
          this.fx.dustAt(p.x, p.y - 2, 8);
          this.fx.ring(q.x, q.y, ev.radius, PAL.hollow, 0.3);
        } else if (ev.skill === 'whirl') this.fx.sparksAt(p.x, p.y - 22, 6);
        else if (ev.skill === 'warcry' || ev.skill === 'hook') this.fx.dustAt(p.x, p.y, 14);
        break;
      }
      case 'skillImpact': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, PAL.ember, 0.42);
        this.fx.ring(p.x, p.y, ev.radius * 0.7, PAL.bone, 0.3);
        this.fx.debrisAt(p.x, p.y - 4, 26);
        this.fx.dustAt(p.x, p.y, 16);
        this.fx.shake(0.011, 220);
        sfx.play('slam');
        break;
      }
      case 'volley':
        sfx.play('volley');
        break;
      case 'seal': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, PAL.emberHot, 0.5);
        sfx.play('seal');
        break;
      }
      case 'shatter': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, PAL.hollow, 0.3);
        this.fx.soulAt(p.x, p.y - 16, 8);
        break;
      }
      case 'interrupt': {
        const v = this.enemyViews.get(ev.id);
        if (v) this.fx.floater(v.sx, v.sy + v.headY - 40, 'PRZERWANY', 'evade');
        break;
      }
      case 'windup':
        sfx.play(ev.kind === 'brute' ? 'windupBrute' : ev.kind === 'acolyte' ? 'windupAcolyte' : 'windupThrall');
        break;
      case 'strike': {
        const e = this.sim.getEnemy(ev.id);
        if (e && e.def.attack.shape.kind !== 'bolt') this.overlays.onStrike(e);
        break;
      }
      case 'heroHurt':
        hv.onHurt();
        this.fx.floater(hv.sx, hv.sy - 62, `-${ev.amount}`, 'hurt');
        this.fx.shake(0.009, 160);
        hud.hurtFlash(0.35 + ev.amount / 40);
        sfx.play('hurt');
        try {
          navigator.vibrate?.(35);
        } catch {
          /* haptics are optional */
        }
        break;
      case 'heroHeal':
        this.fx.floater(hv.sx, hv.sy - 66, `+${ev.amount}`, 'heal');
        sfx.play('heal');
        break;
      case 'heroDeath':
        sfx.play('heroDeath');
        this.fx.shake(0.014, 300);
        this.services.controls.enabled = false;
        this.services.controls.release();
        this.time.delayedCall(1400, () => {
          if (this.run) this.endRun(false);
        });
        break;
      case 'levelUp':
        this.fx.floater(hv.sx, hv.sy - 80, `POZIOM ${ev.level}`, 'level');
        this.fx.ring(hv.sx, hv.sy, 1.4, PAL.gold, 0.5);
        sfx.play('levelUp');
        break;
      case 'pickup':
        if (ev.kind === 'ash') sfx.play('pickup');
        break;
      case 'chest':
        sfx.play('chest');
        break;
      case 'shrine':
        this.fx.ring(hv.sx, hv.sy, 1.6, PAL.gold, 0.6);
        break;
      case 'roomEnter':
        hud.setWhere(`Poziom ${this.dungeon.depth} · ${ROOM_NAMES[ev.roomType]}`);
        if (ev.roomType === 'elite') hud.showBanner('Legowisko elity', 'Silniejsi wrogowie. Po walce skrzynia.');
        else if (ev.roomType === 'exit') hud.showBanner('Strażnica schodów', 'Pokonaj strażników, by zejść niżej');
        else if (ev.roomType === 'treasure') hud.showBanner('Skarbiec', 'Podejdź do skrzyni');
        else if (ev.roomType === 'shrine') hud.showBanner('Kapliczka', 'Dotknij ołtarza, by odzyskać siły');
        break;
      case 'doors':
        sfx.play('door');
        if (!ev.open) this.fx.shake(0.003, 120);
        break;
      case 'roomClear':
        if (ev.roomType !== 'exit') hud.showBanner('Komnata oczyszczona', 'Drzwi stoją otworem', 1.6);
        break;
      case 'stairsOpen':
        hud.showBanner('Schody otwarte', this.run && this.run.depth >= RUN.floors ? 'Prowadzą na powierzchnię' : 'Wejdź na nie, by zejść niżej', 2.4);
        break;
      case 'floorExit':
        sfx.play('stairs');
        void this.nextFloor();
        break;
      case 'spawn':
        sfx.play('spawn');
        break;
      case 'loot':
        this.onLoot(ev.item);
        break;
      case 'bossSpawn': {
        const def = ENEMIES[ev.kind];
        hud.showBanner(def.name, def.boss?.title ?? '', 2.8);
        sfx.play('roar');
        this.fx.shake(0.008, 400);
        break;
      }
      case 'bossPhase': {
        const v = this.enemyViews.get(ev.id);
        hud.showBanner('Gniew', 'Druga faza — nowe ataki, krótsze ostrzeżenia', 2.2);
        if (v) this.fx.ring(v.sx, v.sy, 3, PAL.danger, 0.6);
        sfx.play('roar');
        this.fx.shake(0.012, 500);
        break;
      }
      case 'bossDeath': {
        const p = this.screenOf(ev.x, ev.y);
        hud.showBanner(`Pokonany: ${ENEMIES[ev.kind].name}`, 'Łup leży na ziemi. Schody w dół są otwarte.', 3);
        this.fx.soulAt(p.x, p.y - 30, 30);
        this.fx.ring(p.x, p.y, 3.5, PAL.gold, 0.8);
        this.fx.shake(0.016, 600);
        sfx.play('bossDeath');
        break;
      }
      case 'enemyCharge':
        sfx.play('dash');
        break;
      case 'hazardBlast': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, ev.kind === 'frost' ? 0x9fd8ff : 0xff7a3a, 0.3);
        if (ev.kind === 'frost') this.fx.frostAt(p.x, p.y - 6, 14);
        else this.fx.flamesAt(p.x, p.y - 4, 16);
        this.fx.debrisAt(p.x, p.y, 8);
        sfx.play('blast');
        break;
      }
      case 'trapFire': {
        const p = this.screenOf(ev.x, ev.y);
        if (!this.world?.isRevealedAt(ev.x, ev.y)) break;
        if (ev.kind === 'vent') {
          this.fx.flamesAt(p.x, p.y - 6, 18);
          sfx.play('vent');
        } else {
          this.fx.dustAt(p.x, p.y, 4);
          sfx.play('spike');
        }
        break;
      }
      case 'frostShell': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, 0x9fd8ff, 0.45);
        this.fx.frostAt(p.x, p.y - 20, 24);
        sfx.play('frost');
        break;
      }
      case 'emberStep': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, PAL.ember, 0.35);
        this.fx.flamesAt(p.x, p.y - 4, 14);
        sfx.play('blast');
        break;
      }
      case 'nova': {
        const p = this.screenOf(ev.x, ev.y);
        this.fx.ring(p.x, p.y, ev.radius, PAL.hollow, 0.3);
        this.fx.sparksAt(p.x, p.y - 20, 10);
        break;
      }
      case 'chain':
        this.fx.lightning(
          ev.segments.map(([x0, y0, x1, y1]) => [worldToScreenX(x0, y0), worldToScreenY(x0, y0) - 22, worldToScreenX(x1, y1), worldToScreenY(x1, y1) - 22]),
        );
        sfx.play('zap');
        break;
      case 'barrierHit':
        this.fx.floater(hv.sx, hv.sy - 62, ev.broken ? 'BARIERA PĘKA' : `-${Math.round(ev.absorbed)}`, 'evade');
        sfx.play('barrier');
        break;
      case 'immune': {
        const v = this.enemyViews.get(ev.id);
        if (v) this.fx.floater(v.sx, v.sy + v.headY - 10, 'ODPORNY', 'evade');
        break;
      }
      case 'xp':
      case 'choice':
        break;
    }
  }
}
