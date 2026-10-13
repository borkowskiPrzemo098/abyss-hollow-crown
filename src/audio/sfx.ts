/**
 * Tiny synthesised sound layer (Web Audio, no asset files). Placeholder sounds,
 * but each cue has a distinct shape so combat stays readable by ear.
 * The game is fully playable without audio; any failure here is swallowed.
 */
export type SfxName =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'whiff'
  | 'dodge'
  | 'evade'
  | 'cast'
  | 'slam'
  | 'windupThrall'
  | 'windupBrute'
  | 'hurt'
  | 'death'
  | 'spawn'
  | 'wave'
  | 'heroDeath'
  | 'ui';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<SfxName, number>();
  private _volume = 0.7;
  private _muted = false;

  get volume(): number {
    return this._volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Must be called from a user gesture (iOS requirement). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyGain();
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume * 0.6, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.035) return; // never stack the same cue in one burst
    this.lastPlayed.set(name, now);
    try {
      switch (name) {
        case 'swing': this.noiseSweep(1800, 500, 0.09, 0.22, 'bandpass'); break;
        case 'whiff': this.noiseSweep(1400, 600, 0.08, 0.1, 'bandpass'); break;
        case 'hit': this.tone(150, 55, 0.09, 0.5, 'sine'); this.noiseSweep(2500, 900, 0.04, 0.22, 'bandpass'); break;
        case 'crit': this.tone(160, 50, 0.12, 0.6, 'sine'); this.tone(1320, 990, 0.18, 0.12, 'triangle'); this.noiseSweep(3500, 1200, 0.05, 0.3, 'bandpass'); break;
        case 'dodge': this.noiseSweep(500, 2200, 0.14, 0.16, 'bandpass'); break;
        case 'evade': this.tone(880, 1320, 0.12, 0.12, 'triangle'); break;
        case 'cast': this.tone(70, 110, 0.28, 0.25, 'sawtooth', 600); break;
        case 'slam': this.tone(90, 32, 0.45, 0.8, 'sine'); this.noiseSweep(900, 120, 0.4, 0.5, 'lowpass'); break;
        case 'windupThrall': this.tone(210, 330, 0.22, 0.1, 'triangle'); break;
        case 'windupBrute': this.tone(70, 120, 0.5, 0.22, 'sawtooth', 380); break;
        case 'hurt': this.tone(120, 60, 0.18, 0.5, 'square', 700); this.noiseSweep(1200, 300, 0.12, 0.3, 'lowpass'); break;
        case 'death': this.noiseSweep(1600, 200, 0.35, 0.18, 'bandpass'); this.tone(330, 110, 0.4, 0.06, 'sine'); break;
        case 'spawn': this.tone(440, 220, 0.5, 0.05, 'sine'); break;
        case 'wave': this.tone(220, 218, 1.4, 0.18, 'sine'); this.tone(330, 329, 1.2, 0.1, 'sine'); break;
        case 'heroDeath': this.tone(110, 40, 1.4, 0.4, 'sawtooth', 500); break;
        case 'ui': this.tone(660, 660, 0.06, 0.08, 'triangle'); break;
      }
    } catch {
      /* audio is optional */
    }
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType, lowpass?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
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
