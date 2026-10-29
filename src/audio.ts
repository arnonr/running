import type { CenterId } from './sim/types';

// Every sound is synthesised with WebAudio: no audio files to download.
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  muted = false;
  private musicOn = false;
  private nextBeat = 0;
  private beat = 0;
  private timer = 0;
  tempo = 116;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, when = 0, out?: AudioNode) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private hiss(dur: number, vol: number, f0: number, f1: number, when = 0, type: BiquadFilterType = 'bandpass', out?: AudioNode) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out || this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  jump(sup: boolean) {
    this.tone(sup ? 260 : 330, sup ? 0.32 : 0.18, 'square', 0.12, sup ? 1100 : 760);
    if (sup) this.tone(520, 0.3, 'sine', 0.1, 1600, 0.04);
  }
  slide() { this.hiss(0.28, 0.35, 2400, 500); }
  lane() { this.hiss(0.1, 0.18, 900, 2600, 0, 'bandpass'); }
  bump() { this.tone(140, 0.12, 'triangle', 0.25, 80); }
  land() { this.tone(110, 0.08, 'sine', 0.25, 60); }
  coin(streak: number) {
    const step = Math.min(streak, 12);
    const f = 880 * Math.pow(2, (step % 6) / 12);
    this.tone(f, 0.09, 'square', 0.07);
    this.tone(f * 1.5, 0.16, 'square', 0.06, undefined, 0.055);
  }
  centerPower(centerId: CenterId) {
    const base = 440 + centerId * 32;
    [base, base * 1.25, base * 1.5, base * 2].forEach((f, i) => {
      this.tone(f, 0.16, 'square', 0.09, undefined, i * 0.055);
    });
  }
  powerEnd() { this.tone(660, 0.18, 'triangle', 0.1, 330); }
  shieldBlock() {
    this.tone(580, 0.15, 'sine', 0.18, 980);
    this.tone(880, 0.2, 'triangle', 0.14, 440, 0.05);
  }
  armorSmash() {
    this.hiss(0.24, 0.45, 1800, 240, 0, 'lowpass');
    this.tone(180, 0.22, 'sawtooth', 0.18, 520);
  }
  stumble() {
    this.hiss(0.18, 0.45, 1500, 300);
    this.tone(200, 0.2, 'sawtooth', 0.12, 90);
  }
  eliminated() {
    this.hiss(0.42, 0.55, 1600, 140, 0, 'lowpass');
    this.tone(320, 0.16, 'sawtooth', 0.18, 180, 0);
    this.tone(220, 0.18, 'sawtooth', 0.16, 110, 0.1);
    this.tone(140, 0.28, 'triangle', 0.2, 55, 0.22);
  }
  countdownBeep(final: boolean) {
    this.tone(final ? 880 : 440, final ? 0.35 : 0.14, 'square', 0.12);
  }
  finishFanfare() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.28, 'triangle', 0.14, undefined, i * 0.1);
    });
  }
  click() { this.tone(660, 0.05, 'square', 0.06); }
  level() { [660, 880].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.1, undefined, i * 0.08)); }

  private rumbleGain: GainNode | null = null;
  horn() {
    [[311, 0], [262, 0.32]].forEach(([f, w]) => {
      this.tone(f, 0.42, 'sawtooth', 0.09, undefined, w);
      this.tone(f * 1.5, 0.42, 'square', 0.04, undefined, w);
    });
  }
  rumble(level: number) {
    const c = this.ctx;
    if (!c) return;
    if (!this.rumbleGain) {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 160;
      this.rumbleGain = c.createGain();
      this.rumbleGain.gain.value = 0;
      s.connect(f).connect(this.rumbleGain).connect(this.master);
      s.start();
    }
    this.rumbleGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.85, c.currentTime, 0.08);
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextBeat = this.ctx.currentTime + 0.05;
    this.beat = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stopMusic() {
    this.musicOn = false;
    window.clearInterval(this.timer);
  }
  private schedule() {
    const c = this.ctx;
    if (!c || !this.musicOn) return;
    const bass = [55, 55, 65.4, 49];
    while (this.nextBeat < c.currentTime + 0.12) {
      const when = this.nextBeat - c.currentTime;
      const step = this.beat % 16;
      const bar = Math.floor(this.beat / 16) % 4;
      if (step % 4 === 0) this.kick(when);
      if (step % 4 === 2) this.hiss(0.04, 0.12, 8000, 6000, when, 'highpass', this.musicGain);
      if (step === 4 || step === 12) this.hiss(0.12, 0.22, 1800, 900, when, 'bandpass', this.musicGain);
      if (step % 2 === 0 && step !== 6 && step !== 14) this.tone(bass[bar] * (step === 10 ? 2 : 1), 0.12, 'sawtooth', 0.09, undefined, when, this.musicGain);
      if (step === 0 || step === 7 || step === 10) this.tone(bass[bar] * 4 * (step === 7 ? 1.5 : 1), 0.1, 'triangle', 0.05, undefined, when, this.musicGain);
      this.nextBeat += 60 / this.tempo / 4;
      this.beat++;
    }
  }
  private kick(when: number) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + 0.2);
  }
}
