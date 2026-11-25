import { clamp } from '../puzzles/engine';

type Effect = 'ratchet' | 'click' | 'hatch' | 'vernier' | 'valve' | 'wire' | 'spark' | 'weld' | 'resonance' | 'trim' | 'nose' | 'guard' | 'ignition';

export class GameAudio {
  context?: AudioContext;
  output?: GainNode;
  muted = false;
  private noise?: AudioBuffer;
  private hum?: { oscillator: OscillatorNode; gain: GainNode };
  private played = new Map<Effect, number>();

  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = this.muted ? 0 : .77;
        const compressor = this.context.createDynamicsCompressor();
        this.output.connect(compressor).connect(this.context.destination);
      }
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch { /* Visual and syllable feedback remain available. */ }
  }
  mute(next = !this.muted) {
    this.muted = next;
    if (this.context && this.output) this.output.gain.setTargetAtTime(next ? 0 : .77, this.context.currentTime, .025);
    return next;
  }
  tone(hz: number, duration: number, gain: number, end = hz, wave: OscillatorType = 'sine', delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.output || this.muted || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const source = ctx.createOscillator();
    const level = ctx.createGain();
    source.type = wave;
    source.frequency.setValueAtTime(hz, start);
    source.frequency.exponentialRampToValueAtTime(end, start + duration);
    level.gain.setValueAtTime(.0001, start);
    level.gain.exponentialRampToValueAtTime(gain, start + Math.min(.025, duration * .22));
    level.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(level).connect(this.output);
    source.start(start);
    source.stop(start + duration + .012);
  }

  private grit(duration: number, gain: number, hz: number, end = hz, kind: BiquadFilterType = 'bandpass') {
    const ctx = this.context;
    if (!ctx || !this.output || this.muted || ctx.state !== 'running') return;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = this.noise.getChannelData(0);
      let seed = 261293;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = seed / 2147483648 - 1;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    const level = ctx.createGain();
    const then = ctx.currentTime;
    filter.type = kind;
    filter.Q.value = .74;
    filter.frequency.setValueAtTime(hz, then);
    filter.frequency.exponentialRampToValueAtTime(end, then + duration);
    level.gain.setValueAtTime(.0001, then);
    level.gain.exponentialRampToValueAtTime(gain, then + Math.min(.19, duration * .20));
    level.gain.exponentialRampToValueAtTime(.0001, then + duration);
    source.connect(filter).connect(level).connect(this.output);
    source.start(then);
    source.stop(then + duration + .015);
  }

  hit(name: Effect) {
    const now = this.context?.currentTime ?? 0;
    if (now - (this.played.get(name) ?? -Infinity) < .035) return;
    this.played.set(name, now);
    switch (name) {
      case 'ratchet': this.tone(1450, .043, .045, 630, 'triangle'); break;
      case 'click': this.tone(900, .092, .075, 490, 'triangle'); this.grit(.050, .08, 1900); break;
      case 'hatch': this.grit(.46, .11, 3200, 740); this.tone(193, .32, .06, 91); break;
      case 'vernier': [523, 784, 1047].forEach((hz, i) => this.tone(hz, .45, .075, hz, 'sine', i * .036)); break;
      case 'valve': this.tone(618, .052, .05, 477, 'triangle'); this.grit(.034, .09, 930); break;
      case 'wire': this.tone(1250, .11, .062, 496, 'triangle'); this.tone(790, .18, .05, 900, 'sine', .07); break;
      case 'spark': this.grit(.21, .14, 4400, 1600); this.tone(321, .12, .05, 119, 'sawtooth'); break;
      case 'weld': this.grit(.16, .12, 5800, 2250); this.tone(741, .075, .03, 430, 'triangle'); break;
      case 'resonance': [440, 659, 880, 1318].forEach((hz, i) => this.tone(hz, .54, .06, hz, 'sine', .05 * i)); break;
      case 'trim': this.tone(822, .068, .04, 695, 'triangle'); break;
      case 'nose': this.tone(305, .12, .10, 139, 'triangle'); this.tone(626, .18, .045, 626, 'sine', .04); break;
      case 'guard': this.tone(400, .12, .053, 220, 'triangle'); this.grit(.12, .055, 1800); break;
      case 'ignition': this.grit(5.3, .55, 620, 107, 'lowpass'); this.grit(2.6, .28, 1722, 365); this.tone(86, 2.25, .26, 32, 'triangle'); break;
    }
  }
  countdown(number: number) { this.tone(number === 1 ? 1047 : 650, .23, .12, number === 1 ? 1047 : 650, 'triangle'); }

  vernier(proximity: number | null) {
    const ctx = this.context;
    if (!ctx || !this.output || ctx.state !== 'running') return;
    if (proximity !== null && !this.hum) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      gain.gain.value = 0;
      oscillator.connect(gain).connect(this.output);
      oscillator.start();
      this.hum = { oscillator, gain };
    }
    if (!this.hum) return;
    const level = clamp(proximity ?? 0);
    const now = ctx.currentTime;
    if (proximity !== null) this.hum.oscillator.frequency.setTargetAtTime(280 + level * 655, now, .035);
    this.hum.gain.gain.setTargetAtTime(proximity === null ? 0 : .012 + level * .041, now, .045);
  }
}
