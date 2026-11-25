import { RigAnimator } from '@rig2d/engine';
import type { ContentBundle, DialogueLine } from '../content/types';
import { GameAudio } from '../audio/sfx';
import { DialogueRouter, TriggerMonitor } from './routing';

export class VoiceDirector {
  readonly router: DialogueRouter;
  readonly monitor: TriggerMonitor;
  active?: DialogueLine;
  actor?: RigAnimator;
  private end = 0;
  private serial = 0;
  private source?: AudioBufferSourceNode;
  private sourceGain?: GainNode;
  private analyser?: AnalyserNode;
  private samples?: Float32Array<ArrayBuffer>;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private time = 0;

  constructor(private readonly bundle: ContentBundle, private readonly audio: GameAudio,
    private readonly show: (line?: DialogueLine) => void) {
    this.router = new DialogueRouter(bundle.dialogue.lines, bundle.events.globalCooldownSec);
    this.monitor = new TriggerMonitor(bundle.events, event => {
      const streakReaction = event === bundle.events.easterEggs.gemple38Event;
      this.emit(event, this.time, streakReaction ? 15 : 7, streakReaction);
    });
  }

  setClock(time: number) { this.time = time; }
  emit(event: string, time: number, ttl = 7, urgent = false) { this.router.queue(event, time, ttl, urgent); }
  silence() {
    this.serial++;
    const source = this.source;
    this.source = undefined;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sourceGain?.disconnect();
    this.sourceGain = undefined;
    this.actor?.setMouthOpen(null);
    this.active = undefined;
    this.show();
  }

  reset(time: number) {
    this.silence();
    this.actor?.reset();
    this.actor?.speak('', time);
    this.router.reset();
    this.monitor.reset(time);
  }

  private async playAudio(line: DialogueLine, ticket: number, time: number) {
    const ctx = this.audio.context;
    const output = this.audio.output;
    if (!line.audio || !ctx || !output || ctx.state !== 'running') return;
    const url = new URL(this.bundle.heroine.voice.audioDir + '/' + line.audio, this.bundle.heroineBase).href;
    if (!this.cache.has(url)) {
      this.cache.set(url, fetch(url).then(response => {
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return null;
        return response.arrayBuffer().then(bytes => ctx.decodeAudioData(bytes));
      }).catch(() => null));
    }
    const buffer = await this.cache.get(url);
    if (!buffer || ticket !== this.serial || this.audio.muted || ctx.state !== 'running') return;
    const elapsed = Math.max(0, this.time - time);
    const remaining = Math.min(this.end - this.time, buffer.duration - elapsed);
    if (remaining < .12) return;
    if (!this.analyser) {
      const gain = ctx.createGain();
      gain.gain.value = this.bundle.heroine.voice.gain;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.samples = new Float32Array(this.analyser.fftSize);
      gain.connect(this.analyser).connect(output);
      this.voiceGain = gain;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain!);
    source.onended = () => {
      source.disconnect();
      if (this.source === source) {
        this.source = undefined;
        this.actor?.setMouthOpen(null);
      }
    };
    if (elapsed + .08 < buffer.duration && remaining < buffer.duration - elapsed) {
      const sourceGain = ctx.createGain();
      this.sourceGain = sourceGain;
      sourceGain.gain.setValueAtTime(1, ctx.currentTime);
      sourceGain.gain.setValueAtTime(1, ctx.currentTime + Math.max(0, remaining - .075));
      sourceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + remaining);
      source.disconnect();
      source.connect(sourceGain).connect(this.voiceGain!);
      source.onended = () => {
        source.disconnect();
        sourceGain.disconnect();
        if (this.source === source) {
          this.source = undefined;
          this.sourceGain = undefined;
          this.actor?.setMouthOpen(null);
        }
      };
    }
    source.start(0, elapsed, remaining);
    this.source = source;
  }
  private voiceGain?: GainNode;

  update(time: number) {
    this.time = time;
    if (this.active && time >= this.end) this.silence();
    const next = this.router.next(time, this.active);
    if (next) {
      if (this.active) this.silence();
      this.active = next;
      const actor = this.actor;
      const clip = next.clip ?? this.bundle.heroine.emotionClips[next.emotion];
      if (clip) actor?.play(clip, time, next.priority);
      const estimate = actor?.speak(next.text, time) ?? next.maxSec;
      this.end = time + Math.min(next.maxSec, next.audio ? next.maxSec : Math.max(2.2, estimate + .25));
      this.show(next);
      if (!this.audio.muted) void this.playAudio(next, ++this.serial, time);
    }
    if (!this.actor) return;
    if (this.source && this.analyser && this.samples && !this.audio.muted && this.audio.context?.state === 'running') {
      this.analyser.getFloatTimeDomainData(this.samples);
      let energy = 0;
      for (const sample of this.samples) energy += sample * sample;
      const rms = Math.sqrt(energy / this.samples.length);
      this.actor.setMouthOpen(Math.min(1, this.bundle.heroine.voice.lipSyncGain * rms));
    } else this.actor.setMouthOpen(null);
  }
}
