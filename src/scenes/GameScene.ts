import Phaser from 'phaser';
import type { Sfx } from '../audio/sfx';
import { HERO, MAX_STEPS_PER_FRAME, SIM_DT, SKILLS } from '../config/balance';
import { screenDirToWorld, worldDirToScreenAngle, worldToScreenX, worldToScreenY } from '../core/iso';
import type { Controls } from '../input/controls';
import { EnemyView, HeroView } from '../render/actorView';
import { Fx } from '../render/fx';
import { Overlays } from '../render/overlays';
import { PAL } from '../render/palette';
import { WorldView } from '../render/worldView';
import { Simulation } from '../sim/simulation';
import type { SimEvent } from '../sim/types';
import type { Hud } from '../ui/hud';
import { ANTECHAMBER_LAYOUT, parseArena, type ArenaMap } from '../world/arena';

export interface Services {
  hud: Hud;
  controls: Controls;
  sfx: Sfx;
  dpr: () => number;
}

export type Mode = 'title' | 'playing' | 'paused' | 'dead';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Visible world height target: the short side of the screen shows ~this many CSS px of world at zoom 1. */
const BASE_SHORT_SIDE = 330;

export class GameScene extends Phaser.Scene {
  mode: Mode = 'title';
  sim!: Simulation;
  private services!: Services;
  private map!: ArenaMap;
  private world!: WorldView;
  private fx!: Fx;
  private overlays!: Overlays;
  private heroView!: HeroView;
  private readonly enemyViews = new Map<number, EnemyView>();
  private acc = 0;
  private runTime = 0;
  private deadTimer = 0;
  private deathShown = false;
  private ghostT = 0;
  private lastSwingAngle = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    super('game');
  }

  create(): void {
    this.services = this.registry.get('services') as Services;
    this.map = parseArena(ANTECHAMBER_LAYOUT);
    this.cameras.main.setBackgroundColor(PAL.void);
    this.world = new WorldView(this, this.map);
    this.fx = new Fx(this);
    this.overlays = new Overlays(this);
    this.heroView = new HeroView(this);
    this.newRun();
    this.cameras.main.startFollow(this.heroView.root, false, 0.14, 0.14, 0, 26);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.wireUi();

    const onVisibility = () => {
      if (document.hidden) {
        this.pauseGame();
        this.services.sfx.suspend();
      } else {
        this.services.sfx.resume();
      }
    };
    const onBlur = () => this.pauseGame();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.cleanups.push(() => window.removeEventListener('blur', onBlur));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanups.forEach((c) => c()));

    this.services.hud.showScreen('title');
    this.services.hud.showHud(false);
  }

  private wireUi(): void {
    const { hud, controls, sfx } = this.services;
    hud.onStart = () => {
      sfx.unlock();
      sfx.play('ui');
      this.startPlaying();
    };
    hud.onPause = () => this.pauseGame();
    hud.onResume = () => this.resumeGame();
    hud.onRestart = () => {
      sfx.play('ui');
      if (this.scene.isPaused()) this.scene.resume();
      this.newRun();
      this.startPlaying();
    };
    hud.onMute = (m) => sfx.setMuted(m);
    hud.onVolume = (v) => sfx.setVolume(v);
    controls.onPause = () => {
      if (this.mode === 'playing') this.pauseGame();
      else if (this.mode === 'paused') this.resumeGame();
    };
    controls.onGesture = () => sfx.unlock();
  }

  private seedFromUrl(): number {
    const p = new URLSearchParams(location.search).get('seed');
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) ? n >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  }

  newRun(): void {
    this.sim = new Simulation(this.map, { seed: this.seedFromUrl(), waves: true });
    for (const v of this.enemyViews.values()) v.destroy();
    this.enemyViews.clear();
    this.overlays.reset();
    this.acc = 0;
    this.runTime = 0;
    this.deadTimer = 0;
    this.deathShown = false;
    const h = this.sim.hero;
    this.heroView.update(h, h.x, h.y, 0, 0);
    this.cameras.main.centerOn(this.heroView.sx, this.heroView.sy - 26);
  }

  private startPlaying(): void {
    this.mode = 'playing';
    this.services.controls.release();
    this.services.controls.enabled = true;
    this.services.hud.showScreen(null);
    this.services.hud.showHud(true);
  }

  pauseGame(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.services.controls.enabled = false;
    this.services.controls.release();
    this.services.hud.showScreen('pause');
    this.scene.pause();
  }

  resumeGame(): void {
    if (this.mode !== 'paused') return;
    this.services.sfx.play('ui');
    this.scene.resume();
    this.startPlaying();
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

  override update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const t = time / 1000;
    const sim = this.sim;

    if (this.mode === 'playing' || this.mode === 'dead') {
      if (this.mode === 'playing') {
        const inp = this.services.controls.poll();
        const w = screenDirToWorld(inp.sx, inp.sy);
        sim.setInput({ moveX: w.x, moveY: w.y, dodge: inp.dodge, skill: inp.skill });
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
      if (this.mode === 'playing') this.runTime += dt;
      for (const ev of sim.drainEvents()) this.handleEvent(ev);
    }

    const alpha = this.mode === 'title' ? 1 : Math.min(1, this.acc / SIM_DT);
    const h = sim.hero;
    this.heroView.update(h, lerp(h.px, h.x, alpha), lerp(h.py, h.y, alpha), dt, t);
    if (h.state === 'dodge') {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.045;
        this.fx.afterimage(this.heroView.sx, this.heroView.sy, this.isHeroFlipped(), this.heroView.body.rotation);
      }
    }

    const alive = new Set<number>();
    for (const e of sim.enemies) {
      alive.add(e.id);
      let v = this.enemyViews.get(e.id);
      if (!v) {
        v = new EnemyView(this, e);
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

    this.overlays.draw(sim, this.enemyViews, dt, t);
    this.fx.update(dt);
    this.world.update(t);
    this.world.updateOcclusion(this.heroView.sx, this.heroView.sy, this.heroView.root.depth);

    this.services.hud.update(
      {
        hp: h.hp,
        maxHp: h.stats.maxHp,
        wave: sim.wave,
        enemiesLeft: sim.livingEnemyCount(),
        dodgeCd: h.dodgeCd,
        dodgeMax: HERO.dodge.cooldown,
        skillCd: h.skillCd,
        skillMax: SKILLS.sunder.cooldown * h.stats.skillCooldownMult,
        skillBlocked: h.state === 'dodge' || h.state === 'cast' || h.state === 'dead',
      },
      dt,
    );

    if (this.mode === 'dead') {
      this.deadTimer += dt;
      if (!this.deathShown && this.deadTimer > 1.4) {
        this.deathShown = true;
        this.services.hud.showHud(false);
        this.services.hud.showScreen('death', { wave: sim.wave, kills: sim.kills, seconds: this.runTime });
      }
    }
  }

  private isHeroFlipped(): boolean {
    const h = this.sim.hero;
    return Math.cos(worldDirToScreenAngle(Math.cos(h.facing), Math.sin(h.facing))) < 0;
  }

  private screenOf(x: number, y: number): { x: number; y: number } {
    return { x: worldToScreenX(x, y), y: worldToScreenY(x, y) };
  }

  private handleEvent(ev: SimEvent): void {
    const { sfx, hud } = this.services;
    const h = this.sim.hero;
    switch (ev.type) {
      case 'swing':
        this.heroView.onSwing();
        this.lastSwingAngle = worldDirToScreenAngle(Math.cos(ev.angle), Math.sin(ev.angle));
        sfx.play('swing');
        break;
      case 'whiff':
        this.fx.slash(this.heroView.sx, this.heroView.sy - 20, this.lastSwingAngle, false);
        sfx.play('whiff');
        break;
      case 'damage': {
        const v = this.enemyViews.get(ev.targetId);
        v?.onHit();
        const p = this.screenOf(ev.x, ev.y);
        const head = v ? v.headY : -48;
        this.fx.floater(p.x, p.y + head - 6, ev.crit ? `${ev.amount}!` : String(ev.amount), ev.crit ? 'crit' : 'hit');
        this.fx.sparksAt(p.x, p.y + head * 0.45, ev.crit ? 14 : 7);
        this.fx.boneAt(p.x, p.y + head * 0.45, ev.source === 'skill' ? 6 : 3);
        if (ev.source === 'attack') {
          const ang = worldDirToScreenAngle(ev.x - h.x, ev.y - h.y);
          this.fx.slash(this.heroView.sx + Math.cos(ang) * 10, this.heroView.sy - 20 + Math.sin(ang) * 6, ang, ev.crit);
          sfx.play(ev.crit ? 'crit' : 'hit');
          if (ev.crit) this.fx.shake(0.0035, 90);
        }
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
        this.fx.dustAt(this.heroView.sx, this.heroView.sy - 2, 8);
        sfx.play('dodge');
        break;
      case 'evade':
        this.fx.floater(this.heroView.sx, this.heroView.sy - 62, 'UNIK', 'evade');
        sfx.play('evade');
        break;
      case 'skillCast':
        this.heroView.onCast();
        sfx.play('cast');
        break;
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
      case 'interrupt': {
        const e = this.sim.getEnemy(ev.id);
        const v = this.enemyViews.get(ev.id);
        if (e && v) this.fx.floater(v.sx, v.sy + v.headY - 40, 'PRZERWANY', 'evade');
        break;
      }
      case 'windup':
        sfx.play(ev.kind === 'brute' ? 'windupBrute' : 'windupThrall');
        break;
      case 'strike': {
        const e = this.sim.getEnemy(ev.id);
        if (e) this.overlays.onStrike(e);
        break;
      }
      case 'heroHurt':
        this.heroView.onHurt();
        this.fx.floater(this.heroView.sx, this.heroView.sy - 62, `-${ev.amount}`, 'hurt');
        this.fx.shake(0.009, 160);
        hud.hurtFlash(0.35 + ev.amount / 40);
        sfx.play('hurt');
        try {
          navigator.vibrate?.(35);
        } catch {
          /* haptics are optional */
        }
        break;
      case 'heroDeath':
        this.mode = 'dead';
        this.services.controls.enabled = false;
        this.services.controls.release();
        sfx.play('heroDeath');
        this.fx.shake(0.014, 300);
        break;
      case 'spawn':
        sfx.play('spawn');
        break;
      case 'waveStart':
        hud.showBanner(`Fala ${ev.wave}`, ev.wave === 1 ? 'Otchłań się budzi' : `${ev.count} cieni wypełza z ciemności`);
        sfx.play('wave');
        break;
      case 'waveClear':
        hud.showBanner('Fala odparta', 'Złap oddech, zanim przyjdą następni', 2.0);
        break;
    }
  }
}
