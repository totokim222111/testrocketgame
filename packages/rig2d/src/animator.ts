import { clips, sampleClip, speechSample, speechTrack } from './clips';
import type { AnimationProfile, Clip, Syllable } from './clips';
import { keys, limit, neutralPose } from './pose';
import type { Pose } from './pose';

export class RigAnimator {
  private readonly rest: Pose;
  readonly pose = neutralPose();
  readonly controls: Partial<Pose> = {};
  readonly target = neutralPose();
  private velocity = neutralPose();
  private lastTime = NaN;
  protected clipAt = 0;
  private overlay: { id: string; at: number } | null = null;
  private priority = 0;
  private track: Syllable[] = [];
  private speechAt = 0;
  private blinkAt = Infinity;
  private doubleBlink = false;
  private seed = 571;
  private lookX = 0;
  private lookY = 0;
  private nextLook = 0;
  private queue: { id: string; priority: number }[] = [];
  private audio: number | null = null;
  readonly library: Record<string, Clip>;
  motion: string | null = null;
  level = 0;
  idle = true;
  constructor(readonly profile: AnimationProfile = {}) {
    this.rest = { ...neutralPose(), ...profile.parameters };
    this.library = { ...clips, ...profile.clips };
    this.reset();
  }

  reset() {
    Object.assign(this.pose, this.rest);
    for (const k of keys) this.velocity[k] = 0;
    this.motion = null;
    this.priority = 0;
    this.audio = null;
    this.queue.length = 0;
    this.track = [];
    this.level = 0;
    this.overlay = null;
    this.lastTime = NaN;
    this.blinkAt = Infinity;
    this.nextLook = 0;
    this.lookX = this.lookY = 0;
    this.doubleBlink = false;
    this.seed = 571;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  /** Normalized audio level, including silent frames. Null restores subtitle timing. */
  setMouthOpen(level: number | null) {
    this.audio = level !== null && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : null;
  }
  enqueue(id: string, priority = 0) {
    if (!Object.hasOwn(this.library, id)) throw new RangeError(id);
    this.queue.push({ id, priority });
    this.queue.sort((a, b) => b.priority - a.priority);
  }
  overlayClip(id: string, time: number) {
    if (!Object.hasOwn(this.library, id)) throw new RangeError(id);
    this.overlay = { id, at: time };
  }
  play(id: string, time: number, priority = 0) {
    if (!Object.hasOwn(this.library, id)) throw new RangeError(id);
    if (
      this.motion &&
      time >= this.clipAt &&
      time < this.clipAt + this.library[this.motion].duration &&
      priority < this.priority
    )
      return;
    this.motion = id;
    this.clipAt = time;
    this.priority = priority;
    this.overlay = null;
  }
  speak(text: string, time: number) {
    this.track = speechTrack(text);
    this.speechAt = time;
    return this.track.at(-1)?.end ?? 0;
  }
  private idlePose(t: number, p: Pose) {
    if (!Number.isFinite(this.blinkAt)) this.blinkAt = t + 2 + this.random() * 4;
    let age = t - this.blinkAt;
    if (age > 0.245) {
      this.doubleBlink = !this.doubleBlink && this.random() < 0.19;
      this.blinkAt = this.doubleBlink ? t + 0.11 : Math.max(t + 0.3, this.blinkAt + 2 + this.random() * 4);
      age = -1;
    }
    if (t >= this.nextLook) {
      this.lookX = (this.random() - 0.5) * 0.66;
      this.lookY = (this.random() - 0.5) * 0.42;
      this.nextLook = t + 0.85 + 2.3 * this.random();
    }
    p.breath = Math.sin(t * 1.86);
    p.yaw = 2.3 * Math.sin(t * 0.87) + this.lookX * 2;
    p.roll = 1.5 * Math.sin(t * 0.69);
    p.pitch = 1.2 * Math.sin(t * 1.04);
    const style = this.profile.idle;
    if (style) {
      if (style.breathHz !== undefined) p.breath = Math.sin(t * 2 * Math.PI * style.breathHz);
      const scale = style.headScale ?? 1;
      p.roll *= scale;
      p.pitch *= scale;
      p.yaw *= scale;
      for (const [k, value] of Object.entries(style.offsets ?? {})) p[k as keyof Pose] += value;
      for (const [key, amplitude, hz, phase] of style.oscillators ?? [])
        p[key] += amplitude * Math.sin(t * 2 * Math.PI * hz + phase);
      if (style.nodPeriod) {
        const phase = t % style.nodPeriod;
        if (phase < 0.56) p.pitch -= (style.nodDepth ?? 4) * Math.sin((Math.PI * phase) / 0.56) ** 2;
      }
    }
    p.gazeX = this.lookX;
    p.gazeY = this.lookY;
    return age >= 0 && age < 0.245
      ? Math.min(1, Math.max(0, age < 0.09 ? 1 - age / 0.09 : (age - 0.123) / 0.122))
      : 1;
  }
  protected sampleMotion(time: number, pose: Pose) {
    if (this.motion) sampleClip(this.motion, time - this.clipAt, pose, this.library, this.rest);
    if (this.overlay) {
      const age = time - this.overlay.at;
      if (age >= this.library[this.overlay.id].duration) this.overlay = null;
      else sampleClip(this.overlay.id, age, pose, this.library, this.rest);
    }
  }
  update(time: number) {
    const delta = time - this.lastTime;
    const jump = !Number.isFinite(delta) || delta < 0 || delta > 0.28;
    if (delta < 0) {
      this.blinkAt = Infinity;
      this.nextLook = time;
    }
    const dt = jump ? 0 : delta;
    this.lastTime = time;
    const p = this.target;
    for (const k of keys) p[k] = this.rest[k];
    const eyelid = this.idle ? this.idlePose(time, p) : 1;
    if (this.motion && time - this.clipAt >= this.library[this.motion].duration) this.motion = null;
    if (!this.motion && this.queue.length) {
      const next = this.queue.shift()!;
      this.play(next.id, time, next.priority);
    }
    this.sampleMotion(time, p);
    p.eye *= eyelid;
    Object.assign(p, this.controls);
    const age = time - this.speechAt;
    this.level = 0;
    if (this.track.length && age >= 0 && age < this.track[this.track.length - 1].end) {
      const speech = speechSample(this.track, age);
      p.mouth = speech.mouth;
      this.level = speech.level;
    }
    if (this.audio !== null) {
      this.level = this.audio;
      p.specialLip = 0;
      p.mouth = this.audio < 0.1 ? 0 : this.audio < 0.42 ? 1 : this.audio < 0.75 ? 2 : 3;
    }
    // Different spring rates at the three roots give a delayed secondary swing.
    const inertia = jump ? 0 : (p.roll - this.pose.roll) * 0.095 + (p.yaw - this.pose.yaw) * 0.035;
    p.fringe += inertia * 0.55;
    p.locks += inertia;
    p.rear += inertia * 0.75;
    for (const k of keys) {
      const value = limit(k, p[k]);
      if (jump || k === 'mouth' || k === 'brow' || k === 'gesture') {
        this.pose[k] = value;
        this.velocity[k] = 0;
        continue;
      }
      const rate = k === 'eye' ? 95 : k === 'locks' ? 10 : k === 'rear' ? 8 : k === 'fringe' ? 14 : 27;
      // Closed-form critically damped spring, independent of refresh rate.
      const error = this.pose[k] - value,
        impulse = this.velocity[k] + rate * error,
        decay = Math.exp(-rate * dt);
      this.pose[k] = limit(k, value + (error + impulse * dt) * decay);
      this.velocity[k] = (this.velocity[k] - rate * impulse * dt) * decay;
    }
    return this.pose;
  }
}
