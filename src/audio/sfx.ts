/**
 * Synthesised sound (Web Audio, no asset files): combat cues plus a low dungeon
 * ambience. Placeholder sounds, but every cue has a distinct shape so combat
 * stays readable by ear. The game is fully playable without audio.
 *
 * Mobile notes:
 *  - iOS routes Web Audio through the ringer channel, so the silent switch mutes
 *    it. `navigator.audioSession.type = 'playback'` (Safari 17+) opts out of that.
 *  - The context must be created/resumed inside a user gesture, and iOS can leave
 *    it 'interrupted' after a call or tab switch — unlock() resumes any non-running state.
 */
export type SfxName =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'whiff'
  | 'shoot'
  | 'emberShot'
  | 'dodge'
  | 'evade'
  | 'cast'
  | 'slam'
  | 'dash'
  | 'volley'
  | 'seal'
  | 'windupThrall'
  | 'windupBrute'
  | 'windupAcolyte'
  | 'hurt'
  | 'heal'
  | 'death'
  | 'spawn'
  | 'door'
  | 'chest'
  | 'levelUp'
  | 'pickup'
  | 'stairs'
  | 'heroDeath'
  | 'ui'
  | 'roar'
  | 'bossDeath'
  | 'blast'
  | 'spike'
  | 'vent'
  | 'frost'
  | 'zap'
  | 'barrier'
  | 'loot'
  | 'legendary';

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambience: GainNode | null = null;
  private readonly lastPlayed = new Map<SfxName, number>();
  private _volume = 0.7;
  private _muted = false;
  /** Number of cues actually started (used by automated tests). */
  played = 0;

  get volume(): number {
    return this._volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** Call from any user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      const nav = navigator as AudioSessionNavigator;
      if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyGain();
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        // iOS only fully unlocks after a sound starts inside the gesture
        const silent = this.ctx.createBufferSource();
        silent.buffer = this.ctx.createBuffer(1, 1, 22050);
        silent.connect(this.ctx.destination);
        silent.start(0);
        this.startAmbience();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  setVolume(v: number): void {
    this._volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume * 0.9, this.ctx.currentTime, 0.02);
  }

  /** A slow, low drone with filtered wind: the sound of being underground. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.0001;
    this.ambience.connect(this.master!);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 80 ? 0.025 : 0.05;
      o.connect(g);
      g.connect(this.ambience);
      o.start();
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(lp);
    lp.connect(wg);
    wg.connect(this.ambience);
    wind.start();
    lfo.start();
  }

  /** Fades the dungeon ambience in or out (on in runs, off in menus). */
  setAmbience(on: boolean): void {
    if (!this.ctx || !this.ambience) return;
    this.ambience.gain.setTargetAtTime(on ? 0.55 : 0.0001, this.ctx.currentTime, 0.8);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < (name === 'pickup' ? 0.05 : 0.035)) return; // never stack the same cue in one burst
    this.lastPlayed.set(name, now);
    this.played++;
    try {
      switch (name) {
        case 'swing': this.noiseSweep(1800, 500, 0.09, 0.3, 'bandpass'); break;
        case 'whiff': this.noiseSweep(1400, 600, 0.08, 0.14, 'bandpass'); break;
        case 'hit': this.tone(150, 55, 0.09, 0.7, 'sine'); this.noiseSweep(2500, 900, 0.04, 0.3, 'bandpass'); break;
        case 'crit': this.tone(160, 50, 0.12, 0.8, 'sine'); this.tone(1320, 990, 0.18, 0.16, 'triangle'); this.noiseSweep(3500, 1200, 0.05, 0.4, 'bandpass'); break;
        case 'shoot': this.tone(900, 1700, 0.07, 0.12, 'triangle'); this.noiseSweep(4000, 2000, 0.05, 0.12, 'highpass'); break;
        case 'emberShot': this.noiseSweep(700, 250, 0.22, 0.3, 'bandpass'); this.tone(240, 140, 0.2, 0.12, 'sawtooth', 900); break;
        case 'dodge': this.noiseSweep(500, 2200, 0.14, 0.22, 'bandpass'); break;
        case 'evade': this.tone(880, 1320, 0.12, 0.16, 'triangle'); break;
        case 'cast': this.tone(70, 110, 0.28, 0.35, 'sawtooth', 600); break;
        case 'slam': this.tone(90, 32, 0.45, 1, 'sine'); this.noiseSweep(900, 120, 0.4, 0.6, 'lowpass'); break;
        case 'dash': this.noiseSweep(300, 1600, 0.28, 0.4, 'bandpass'); this.tone(80, 50, 0.3, 0.4, 'sine'); break;
        case 'volley': for (let i = 0; i < 4; i++) this.tone(800 + i * 220, 1500 + i * 200, 0.08, 0.08, 'triangle', 0, i * 0.025); break;
        case 'seal': this.tone(110, 112, 0.9, 0.25, 'sine'); this.tone(165, 166, 0.8, 0.12, 'triangle'); break;
        case 'windupThrall': this.tone(210, 330, 0.22, 0.14, 'triangle'); break;
        case 'windupBrute': this.tone(70, 120, 0.5, 0.3, 'sawtooth', 380); break;
        case 'windupAcolyte': this.tone(300, 620, 0.5, 0.08, 'sine'); this.noiseSweep(600, 2400, 0.5, 0.06, 'bandpass'); break;
        case 'hurt': this.tone(120, 60, 0.18, 0.7, 'square', 700); this.noiseSweep(1200, 300, 0.12, 0.4, 'lowpass'); break;
        case 'heal': this.tone(523, 784, 0.25, 0.12, 'sine'); break;
        case 'death': this.noiseSweep(1600, 200, 0.35, 0.24, 'bandpass'); this.tone(330, 110, 0.4, 0.08, 'sine'); break;
        case 'spawn': this.tone(440, 220, 0.5, 0.07, 'sine'); break;
        case 'door': this.tone(60, 40, 0.35, 0.6, 'square', 300); this.noiseSweep(500, 100, 0.3, 0.4, 'lowpass'); break;
        case 'chest': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.35, 0.12, 'triangle', 0, i * 0.07)); break;
        case 'levelUp': [392, 523, 659, 784].forEach((f, i) => this.tone(f, f * 1.01, 0.4, 0.14, 'sine', 0, i * 0.08)); break;
        case 'pickup': this.tone(1200 + Math.random() * 300, 1800, 0.05, 0.05, 'sine'); break;
        case 'stairs': this.tone(220, 55, 1.2, 0.35, 'sine'); this.noiseSweep(1200, 80, 1, 0.2, 'lowpass'); break;
        case 'heroDeath': this.tone(110, 40, 1.4, 0.5, 'sawtooth', 500); break;
        case 'ui': this.tone(660, 660, 0.06, 0.1, 'triangle'); break;
        case 'roar': this.tone(70, 45, 0.9, 0.6, 'sawtooth', 420); this.noiseSweep(400, 90, 0.8, 0.4, 'lowpass'); break;
        case 'bossDeath': this.tone(140, 35, 1.8, 0.7, 'sawtooth', 500); this.noiseSweep(1500, 60, 1.5, 0.5, 'lowpass'); [392, 494, 587, 784].forEach((f, i) => this.tone(f, f, 0.8, 0.1, 'sine', 0, 0.6 + i * 0.12)); break;
        case 'blast': this.tone(110, 40, 0.3, 0.6, 'sine'); this.noiseSweep(1400, 150, 0.28, 0.45, 'lowpass'); break;
        case 'spike': this.noiseSweep(3000, 1500, 0.08, 0.25, 'highpass'); this.tone(500, 300, 0.06, 0.1, 'square', 1800); break;
        case 'vent': this.noiseSweep(300, 1200, 0.45, 0.35, 'bandpass'); break;
        case 'frost': this.tone(1800, 900, 0.4, 0.12, 'sine'); this.noiseSweep(6000, 2500, 0.35, 0.18, 'highpass'); break;
        case 'zap': this.noiseSweep(5000, 800, 0.12, 0.3, 'bandpass'); this.tone(1200, 200, 0.1, 0.12, 'square', 3000); break;
        case 'barrier': this.tone(700, 500, 0.15, 0.15, 'triangle'); break;
        case 'loot': [660, 880].forEach((f, i) => this.tone(f, f, 0.2, 0.12, 'triangle', 0, i * 0.06)); break;
        case 'legendary': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.6, 0.13, 'sine', 0, i * 0.09)); break;
      }
    } catch {
      /* audio is optional */
    }
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType, lowpass = 0, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseSweep(f0: number, f1: number, dur: number, gain: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
