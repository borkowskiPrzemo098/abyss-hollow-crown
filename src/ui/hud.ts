/**
 * DOM layer on top of the canvas: HUD readouts and the title / pause / death
 * screens. Kept in HTML for crisp text at any pixel ratio, real buttons
 * (focus, screen readers) and CSS safe-area insets on notched phones.
 * Writes to the DOM only when a displayed value actually changes.
 */
export interface HudState {
  hp: number;
  maxHp: number;
  wave: number;
  enemiesLeft: number;
  dodgeCd: number;
  dodgeMax: number;
  skillCd: number;
  skillMax: number;
  /** Skill can't be used right now for a reason other than cooldown (dodging, casting). */
  skillBlocked: boolean;
}

export interface RunSummary {
  wave: number;
  kills: number;
  seconds: number;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};


class CooldownButton {
  private lastFrac = -1;
  private lastLabel = '';
  private lastReady: boolean | null = null;
  private lastBlocked: boolean | null = null;

  constructor(private readonly el: HTMLElement, private readonly label: HTMLElement) {}

  set(remaining: number, max: number, blocked: boolean): void {
    const frac = max > 0 ? Math.min(1, Math.max(0, remaining / max)) : 0;
    const q = Math.round(frac * 200) / 200;
    if (q !== this.lastFrac) {
      this.el.style.setProperty('--cd', String(q));
      this.lastFrac = q;
    }
    const text = remaining <= 0 ? '' : remaining < 1 ? remaining.toFixed(1) : String(Math.ceil(remaining));
    if (text !== this.lastLabel) {
      this.label.textContent = text;
      this.lastLabel = text;
    }
    const ready = remaining <= 0;
    if (ready !== this.lastReady) {
      this.el.classList.toggle('is-ready', ready);
      if (ready && this.lastReady === false) {
        this.el.classList.remove('just-ready');
        void this.el.offsetWidth; // restart the CSS animation
        this.el.classList.add('just-ready');
      }
      this.lastReady = ready;
    }
    if (blocked !== this.lastBlocked) {
      this.el.classList.toggle('is-blocked', blocked);
      this.lastBlocked = blocked;
    }
  }
}

export class Hud {
  onStart: () => void = () => {};
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onMute: (muted: boolean) => void = () => {};
  onVolume: (v: number) => void = () => {};

  private readonly hud = $('#hud');
  private readonly hpFill = $('#hp-fill');
  private readonly hpGhost = $('#hp-ghost');
  private readonly hpText = $('#hp-text');
  private readonly hpMeter = $('#hp');
  private readonly waveNum = $('#wave-num');
  private readonly waveLeft = $('#wave-left');
  private readonly banner = $('#banner');
  private readonly bannerTitle = $('#banner-title');
  private readonly bannerSub = $('#banner-sub');
  private readonly hurt = $('#hurt');
  private readonly title = $('#screen-title');
  private readonly pause = $('#screen-pause');
  private readonly death = $('#screen-death');
  private readonly muteBtn = $<HTMLButtonElement>('#btn-mute');
  private readonly volume = $<HTMLInputElement>('#volume');
  private readonly dodge = new CooldownButton($('#btn-dodge'), $('#dodge-cd'));
  private readonly skill = new CooldownButton($('#btn-skill'), $('#skill-cd'));
  private lastHp = -1;
  private lastMax = -1;
  private ghostHp = 0;
  private lastWave = -1;
  private lastLeft = -1;
  private bannerTimer = 0;

  constructor() {
    $('#btn-start').addEventListener('click', () => this.onStart());
    $('#btn-pause').addEventListener('click', () => this.onPause());
    $('#btn-resume').addEventListener('click', () => this.onResume());
    $('#btn-restart').addEventListener('click', () => this.onRestart());
    $('#btn-retry').addEventListener('click', () => this.onRestart());
    this.muteBtn.addEventListener('click', () => {
      const muted = this.muteBtn.getAttribute('aria-pressed') !== 'true';
      this.setMuted(muted);
      this.onMute(muted);
    });
    this.volume.addEventListener('input', () => this.onVolume(Number(this.volume.value) / 100));
    const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.documentElement.classList.toggle('is-touch', touch);
  }

  setMuted(muted: boolean): void {
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.muteBtn.querySelector('.label')!.textContent = muted ? 'Dźwięk: wyłączony' : 'Dźwięk: włączony';
  }

  setVolume(v: number): void {
    this.volume.value = String(Math.round(v * 100));
  }

  showHud(show: boolean): void {
    this.hud.hidden = !show;
  }

  showScreen(which: 'title' | 'pause' | 'death' | null, summary?: RunSummary): void {
    this.title.hidden = which !== 'title';
    this.pause.hidden = which !== 'pause';
    this.death.hidden = which !== 'death';
    if (which === 'death' && summary) {
      $('#stat-wave').textContent = String(summary.wave);
      $('#stat-kills').textContent = String(summary.kills);
      const m = Math.floor(summary.seconds / 60);
      const s = Math.floor(summary.seconds % 60);
      $('#stat-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    const focusTarget = which === 'title' ? '#btn-start' : which === 'pause' ? '#btn-resume' : which === 'death' ? '#btn-retry' : null;
    if (focusTarget) requestAnimationFrame(() => document.querySelector<HTMLElement>(focusTarget)?.focus({ preventScroll: true }));
  }

  showBanner(title: string, sub: string, seconds = 2.2): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('is-on');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-on');
    this.bannerTimer = seconds;
  }

  hurtFlash(strength: number): void {
    this.hurt.style.setProperty('--hurt', String(Math.min(1, strength)));
    this.hurt.classList.remove('is-on');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('is-on');
  }

  update(s: HudState, dt: number): void {
    if (s.hp !== this.lastHp || s.maxHp !== this.lastMax) {
      if (s.hp > this.lastHp) this.ghostHp = s.hp;
      this.hpFill.style.transform = `scaleX(${s.hp / s.maxHp})`;
      this.hpText.textContent = `${Math.ceil(s.hp)}`;
      this.hpMeter.setAttribute('aria-valuenow', String(Math.ceil(s.hp)));
      this.hpMeter.setAttribute('aria-valuemax', String(s.maxHp));
      this.hpMeter.classList.toggle('is-low', s.hp / s.maxHp <= 0.3);
      this.lastHp = s.hp;
      this.lastMax = s.maxHp;
    }
    // the "lost health" ghost drains after a short delay, so big hits read as big
    if (this.ghostHp > s.hp) {
      this.ghostHp = Math.max(s.hp, this.ghostHp - s.maxHp * 0.6 * dt);
      this.hpGhost.style.transform = `scaleX(${this.ghostHp / s.maxHp})`;
    } else if (this.ghostHp !== s.hp) {
      this.ghostHp = s.hp;
      this.hpGhost.style.transform = `scaleX(${s.hp / s.maxHp})`;
    }
    if (s.wave !== this.lastWave) {
      this.waveNum.textContent = s.wave > 0 ? String(s.wave) : '—';
      this.lastWave = s.wave;
    }
    if (s.enemiesLeft !== this.lastLeft) {
      this.waveLeft.textContent = s.enemiesLeft > 0 ? `${s.enemiesLeft} ${plural(s.enemiesLeft)}` : 'cisza';
      this.lastLeft = s.enemiesLeft;
    }
    this.dodge.set(s.dodgeCd, s.dodgeMax, false);
    this.skill.set(s.skillCd, s.skillMax, s.skillBlocked);
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-on');
    }
  }
}

function plural(n: number): string {
  if (n === 1) return 'wróg';
  const d = n % 10;
  const t = n % 100;
  if (d >= 2 && d <= 4 && (t < 12 || t > 14)) return 'wrogowie';
  return 'wrogów';
}
