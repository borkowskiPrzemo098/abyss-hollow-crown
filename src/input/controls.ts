import { STICK_RADIUS, stickVector } from './stick';

/**
 * Player input from the DOM: a floating virtual joystick (left thumb), dodge and
 * skill buttons (right thumb), and keyboard for desktop testing.
 * Produces a screen-space movement vector plus edge-triggered presses.
 */
export interface PolledInput {
  /** Screen-space direction (y down), magnitude 0..1. */
  sx: number;
  sy: number;
  dodge: boolean;
  skill: boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const DODGE_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyK']);
const SKILL_KEYS = new Set(['KeyE', 'KeyQ', 'KeyJ']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
const SHEET_KEYS = new Set(['KeyC', 'Tab']);

export class Controls {
  enabled = false;
  onPause: () => void = () => {};
  onSheet: () => void = () => {};
  /** Fired on any first interaction (used to unlock audio on iOS). */
  onGesture: () => void = () => {};

  private stickId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private vx = 0;
  private vy = 0;
  private readonly held = new Set<string>();
  private dodgeQueued = false;
  private skillQueued = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly zone: HTMLElement,
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    dodgeBtn: HTMLElement,
    skillBtn: HTMLElement,
  ) {
    this.listen(zone, 'pointerdown', (e) => this.stickDown(e as PointerEvent));
    this.listen(zone, 'pointermove', (e) => this.stickMove(e as PointerEvent));
    this.listen(zone, 'pointerup', (e) => this.stickUp(e as PointerEvent));
    this.listen(zone, 'pointercancel', (e) => this.stickUp(e as PointerEvent));
    this.bindButton(dodgeBtn, () => (this.dodgeQueued = true));
    this.bindButton(skillBtn, () => (this.skillQueued = true));
    this.listen(window, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.held.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.release());
    this.restStick();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn, { passive: false });
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private bindButton(btn: HTMLElement, press: () => void): void {
    this.listen(btn, 'pointerdown', (e) => {
      e.preventDefault();
      this.onGesture();
      if (!this.enabled) return;
      btn.classList.add('is-pressed');
      try {
        btn.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* capture is best-effort */
      }
      press();
    });
    const up = () => btn.classList.remove('is-pressed');
    this.listen(btn, 'pointerup', up);
    this.listen(btn, 'pointercancel', up);
    this.listen(btn, 'lostpointercapture', up);
    // keyboard / assistive activation
    this.listen(btn, 'click', (e) => {
      if ((e as MouseEvent).detail === 0 && this.enabled) press();
    });
  }

  private stickDown(e: PointerEvent): void {
    e.preventDefault();
    this.onGesture();
    if (!this.enabled || this.stickId !== null) return;
    this.stickId = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    const m = STICK_RADIUS + 12;
    this.baseX = Math.min(Math.max(e.clientX, m), window.innerWidth - m);
    this.baseY = Math.min(Math.max(e.clientY, m), window.innerHeight - m);
    this.stick.classList.add('is-active');
    this.stick.style.transform = `translate(${this.baseX}px, ${this.baseY}px)`;
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    const out = stickVector(e.clientX - this.baseX, e.clientY - this.baseY);
    if (out.baseShiftX !== 0 || out.baseShiftY !== 0) {
      // floating stick: the base follows a thumb that slides past the ring
      this.baseX += out.baseShiftX;
      this.baseY += out.baseShiftY;
      this.stick.style.transform = `translate(${this.baseX}px, ${this.baseY}px)`;
    }
    this.knob.style.transform = `translate(${out.knobX}px, ${out.knobY}px)`;
    this.vx = out.x;
    this.vy = out.y;
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.vx = this.vy = 0;
    this.restStick();
  }

  /** Parks the joystick ghost in the lower-left so new players know where to put a thumb. */
  restStick(): void {
    this.stick.classList.remove('is-active');
    this.stick.style.transform = '';
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private keyDown(e: KeyboardEvent): void {
    this.onGesture();
    if (PAUSE_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.onPause();
      return;
    }
    if (SHEET_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.onSheet();
      return;
    }
    if (!this.enabled) return;
    if (MOVE_KEYS[e.code] || DODGE_KEYS.has(e.code) || SKILL_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (DODGE_KEYS.has(e.code)) this.dodgeQueued = true;
    else if (SKILL_KEYS.has(e.code)) this.skillQueued = true;
    this.held.add(e.code);
  }

  /** Drops every held key / touch (focus loss, pause, restart). */
  release(): void {
    this.held.clear();
    this.stickId = null;
    this.vx = this.vy = 0;
    this.dodgeQueued = this.skillQueued = false;
    this.restStick();
  }

  poll(): PolledInput {
    let kx = 0;
    let ky = 0;
    for (const code of this.held) {
      const d = MOVE_KEYS[code];
      if (d) {
        kx += d[0];
        ky += d[1];
      }
    }
    let sx = this.vx;
    let sy = this.vy;
    if (kx !== 0 || ky !== 0) {
      const l = Math.hypot(kx, ky);
      sx = kx / l;
      sy = ky / l;
    }
    const out: PolledInput = { sx, sy, dodge: this.dodgeQueued, skill: this.skillQueued };
    this.dodgeQueued = this.skillQueued = false;
    return out;
  }

  destroy(): void {
    for (const c of this.cleanups) c();
  }
}
