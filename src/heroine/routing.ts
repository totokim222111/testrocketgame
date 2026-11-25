import type { DialogueLine, Events, Zone } from '../content/types';
import { wrapAngle } from '../puzzles/engine';

export function inZone(zone: Zone, yaw: number, pitch: number) {
  const { yawMinDeg: lo = 0, yawMaxDeg: hi = 360, pitchMinDeg = -90, pitchMaxDeg = 90 } = zone;
  const azimuth = wrapAngle(yaw);
  const azimuthMatches = lo <= hi ? azimuth >= lo && azimuth <= hi : azimuth >= lo || azimuth <= hi;
  return azimuthMatches && pitch >= pitchMinDeg && pitch <= pitchMaxDeg;
}

export class TriggerMonitor {
  private zones = new Map<string, number>();
  private seen = new Set<string>();
  private step = -1;
  private spin = 0;
  private idleAt = 0;
  private streak = 0;
  private milestones = new Set<string>();
  constructor(private readonly rules: Events, private readonly send: (event: string) => void) {}

  reset(time: number) {
    this.step = -1;
    this.spin = this.streak = 0;
    this.zones.clear();
    this.seen.clear();
    this.milestones.clear();
    this.activity(time);
  }

  activity(time: number) { this.idleAt = time + this.rules.idleTriggers.nudgeAfterSec; }

  mistake() {
    this.streak++;
    if (this.streak >= this.rules.easterEggs.mistakeStreakForGemple38) {
      this.streak = 0;
      this.send(this.rules.easterEggs.gemple38Event);
    }
  }

  success() { this.streak = 0; }

  update(time: number, dt: number, index: number, yaw: number, pitch: number, speed: number) {
    if (this.step !== index) {
      this.step = index;
      this.seen.clear();
      this.zones.clear();
      const milestone = this.rules.milestoneEvents;
      for (const [at, event] of [[milestone.halfwayStepIndex, milestone.halfwayEvent], [milestone.almostDoneStepIndex, milestone.almostDoneEvent]] as const) {
        if (index >= at && !this.milestones.has(event)) {
          this.milestones.add(event);
          this.send(event);
        }
      }
    }
    for (const zone of this.rules.inspectionZones) {
      if (!inZone(zone, yaw, pitch)) {
        this.zones.delete(zone.id);
        continue;
      }
      if (zone.oncePerStep && this.seen.has(zone.id)) continue;
      const dwell = (this.zones.get(zone.id) ?? 0) + dt;
      if (dwell >= zone.dwellSec) {
        if (!this.zones.has(zone.id) || this.zones.get(zone.id)! < zone.dwellSec) this.send(zone.emitEvent);
        this.seen.add(zone.id);
      }
      this.zones.set(zone.id, dwell);
    }
    const { fastSpinAngularSpeedDegPerSec, fastSpinDurationSec, fastSpinEvent } = this.rules.kinematicTriggers;
    if (speed >= fastSpinAngularSpeedDegPerSec) {
      if (this.spin < fastSpinDurationSec && this.spin + dt >= fastSpinDurationSec) this.send(fastSpinEvent);
      this.spin += dt;
    } else this.spin = 0;
    if (time >= this.idleAt) {
      this.send(this.rules.idleTriggers.emitEvent);
      this.idleAt = time + this.rules.idleTriggers.repeatEverySec;
    }
  }
}

type PendingLine = { line: DialogueLine; expires: number; urgent: boolean; order: number };

export class DialogueRouter {
  private readonly events = new Map<string, DialogueLine[]>();
  private readonly lastPlayed = new Map<string, number>();
  private pending: PendingLine[] = [];
  private nextGlobal = -Infinity;
  private order = 0;

  constructor(lines: DialogueLine[], private readonly cooldown: number) {
    for (const line of lines) {
      const options = this.events.get(line.event) ?? [];
      options.push(line);
      this.events.set(line.event, options);
    }
  }

  reset() {
    this.lastPlayed.clear();
    this.pending = [];
    this.nextGlobal = -Infinity;
    this.order = 0;
  }

  queue(event: string, time: number, ttl = 6, urgent = false) {
    if (this.pending.some(item => item.line.event === event)) {
      if (!urgent) return false;
      this.pending = this.pending.filter(item => item.line.event !== event);
    }
    const options = (this.events.get(event) ?? []).filter(line =>
      time >= (this.lastPlayed.get(line.id) ?? -Infinity) + line.cooldownSec);
    const last = (line: DialogueLine) => this.lastPlayed.get(line.id) ?? -Infinity;
    const line = options.sort((a, b) => b.priority - a.priority || last(a) - last(b))[0];
    if (!line) return false;
    this.pending.push({ line, expires: time + ttl, urgent, order: this.order++ });
    return true;
  }

  discard(event: string) { this.pending = this.pending.filter(item => item.line.event !== event); }
  clear() { this.pending = []; }

  next(time: number, active?: DialogueLine) {
    this.pending = this.pending.filter(item => item.expires >= time);
    const available = this.pending.filter(item =>
      item.urgent || (time >= this.nextGlobal && (!active || item.line.priority > active.priority)));
    const item = available.sort((a, b) => Number(b.urgent) - Number(a.urgent) ||
      b.line.priority - a.line.priority || a.order - b.order)[0];
    if (!item) return undefined;
    this.pending = this.pending.filter(entry => entry !== item);
    this.lastPlayed.set(item.line.id, time);
    this.nextGlobal = time + this.cooldown;
    return item.line;
  }
}
