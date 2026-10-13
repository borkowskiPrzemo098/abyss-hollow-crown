import type { SkillId } from '../config/skills';

/**
 * In-game DOM HUD over the canvas: health, XP, level, ash, location, cooldowns,
 * banners and screen flashes. Kept in HTML for crisp text at any pixel ratio,
 * real buttons and CSS safe-area insets. Writes to the DOM only on change.
 */
export interface HudState {
  hp: number;
  maxHp: number;
  xp: number;
  xpNext: number;
  level: number;
  ash: number;
  dodgeCd: number;
  dodgeMax: number;
  skillCd: number;
  skillMax: number;
  /** Skill can't be used right now for a reason other than cooldown (dodging, casting). */
  skillBlocked: boolean;
}

export const $ = <T extends HTMLElement>(sel: string): T => {
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
  onPause: () => void = () => {};
  onHero: () => void = () => {};

  private readonly hud = $('#hud');
  private readonly hpFill = $('#hp-fill');
  private readonly hpGhost = $('#hp-ghost');
  private readonly hpText = $('#hp-text');
  private readonly hpMeter = $('#hp');
  private readonly xpFill = $('#xp-fill');
  private readonly lvl = $('#lvl');
  private readonly ashEl = $('#ash');
  private readonly where = $('#where');
  private readonly banner = $('#banner');
  private readonly bannerTitle = $('#banner-title');
  private readonly bannerSub = $('#banner-sub');
  private readonly hurt = $('#hurt');
  private readonly fade = $('#fade');
  private readonly fadeText = $('#fade-text');
  private readonly skillIcon = document.getElementById('skill-icon') as unknown as SVGUseElement;
  private readonly skillBtn = $('#btn-skill');
  private readonly dodge = new CooldownButton($('#btn-dodge'), $('#dodge-cd'));
  private readonly skill = new CooldownButton($('#btn-skill'), $('#skill-cd'));
  private readonly last = { hp: -1, max: -1, xp: -1, lvl: -1, ash: -1 };
  private ghostHp = 0;
  private bannerTimer = 0;

  constructor() {
    $('#btn-pause').addEventListener('click', () => this.onPause());
    $('#btn-hero').addEventListener('click', () => this.onHero());
    const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.documentElement.classList.toggle('is-touch', touch);
  }

  show(show: boolean): void {
    this.hud.hidden = !show;
  }

  setSkill(id: SkillId, name: string): void {
    this.skillIcon.setAttribute('href', `#i-${id}`);
    this.skillBtn.setAttribute('aria-label', `Umiejętność: ${name}`);
  }

  setWhere(text: string): void {
    this.where.textContent = text;
  }

  showBanner(title: string, sub: string, seconds = 2.2): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('is-on');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-on');
    this.bannerTimer = seconds;
  }

  clearBanner(): void {
    this.banner.classList.remove('is-on');
    this.bannerTimer = 0;
  }

  hurtFlash(strength: number): void {
    this.hurt.style.setProperty('--hurt', String(Math.min(1, strength)));
    this.hurt.classList.remove('is-on');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('is-on');
  }

  /** Full-screen fade used between floors. Resolves once the screen is black. */
  fadeOut(text: string): Promise<void> {
    this.fadeText.textContent = text;
    this.fade.classList.add('is-on');
    return new Promise((r) => setTimeout(r, 650));
  }

  fadeIn(): void {
    this.fade.classList.remove('is-on');
  }

  update(s: HudState, dt: number): void {
    const L = this.last;
    if (s.hp !== L.hp || s.maxHp !== L.max) {
      if (s.hp > L.hp) this.ghostHp = s.hp;
      this.hpFill.style.transform = `scaleX(${s.hp / s.maxHp})`;
      this.hpText.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
      this.hpMeter.setAttribute('aria-valuenow', String(Math.ceil(s.hp)));
      this.hpMeter.setAttribute('aria-valuemax', String(s.maxHp));
      this.hpMeter.classList.toggle('is-low', s.hp / s.maxHp <= 0.3);
      L.hp = s.hp;
      L.max = s.maxHp;
    }
    // the "lost health" ghost drains after a short delay, so big hits read as big
    if (this.ghostHp > s.hp) {
      this.ghostHp = Math.max(s.hp, this.ghostHp - s.maxHp * 0.6 * dt);
      this.hpGhost.style.transform = `scaleX(${this.ghostHp / s.maxHp})`;
    } else if (this.ghostHp !== s.hp) {
      this.ghostHp = s.hp;
      this.hpGhost.style.transform = `scaleX(${s.hp / s.maxHp})`;
    }
    const xpFrac = Math.min(1, s.xp / s.xpNext);
    if (xpFrac !== L.xp) {
      this.xpFill.style.transform = `scaleX(${xpFrac})`;
      L.xp = xpFrac;
    }
    if (s.level !== L.lvl) {
      this.lvl.textContent = String(s.level);
      L.lvl = s.level;
    }
    if (s.ash !== L.ash) {
      this.ashEl.textContent = String(s.ash);
      L.ash = s.ash;
    }
    this.dodge.set(s.dodgeCd, s.dodgeMax, false);
    this.skill.set(s.skillCd, s.skillMax, s.skillBlocked);
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-on');
    }
  }
}
