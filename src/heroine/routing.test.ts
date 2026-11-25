import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { Dialogue, Events } from '../content/types';
import { DialogueRouter, inZone, TriggerMonitor } from './routing';

const base = new URL('../../public/content/heroines/gemhwang/', import.meta.url);
const rules = load(readFileSync(new URL('events.yaml', base), 'utf8')) as Events;
const { lines } = load(readFileSync(new URL('dialogue.yaml', base), 'utf8')) as Dialogue;

describe('inspection and dialogue routing', () => {
  it('recognizes normalized and seam-crossing yaw zones and vertical-only zones', () => {
    const back = rules.inspectionZones.find(zone => zone.emitEvent === 'inspect_back')!;
    const bottom = rules.inspectionZones.find(zone => zone.emitEvent === 'inspect_bottom')!;
    expect(inZone(back, -180, 0)).toBe(true);
    expect(inZone(back, 180, -55)).toBe(false);
    expect(inZone(bottom, 260, -55)).toBe(true);
    expect(inZone({ ...back, yawMinDeg: 350, yawMaxDeg: 15 }, 7, 0)).toBe(true);
    expect(inZone({ ...back, yawMinDeg: 350, yawMaxDeg: 15 }, 180, 0)).toBe(false);
  });

  it('requires dwell and allows a once-per-step zone again on the next step', () => {
    const sent: string[] = [];
    const monitor = new TriggerMonitor(rules, event => sent.push(event));
    monitor.reset(0);
    monitor.update(.3, .3, 0, 90, 0, 0);
    monitor.update(.45, .15, 0, 0, 0, 0);
    monitor.update(1, .55, 0, 90, 0, 0);
    expect(sent).toEqual([]);
    monitor.update(1.3, .3, 0, 90, 0, 0);
    monitor.update(2, .7, 0, 90, 0, 0);
    monitor.update(3, 1, 1, 90, 0, 0);
    expect(sent).toEqual(['inspect_right', 'inspect_right']);
  });

  it('emits configurable spin, idle, mistake streak and milestones', () => {
    const sent: string[] = [];
    const monitor = new TriggerMonitor(rules, event => sent.push(event));
    monitor.reset(0);
    monitor.update(.6, .6, 0, 0, 0, 310);
    monitor.update(24.1, .1, 4, 0, 0, 0);
    monitor.mistake();
    monitor.success();
    monitor.mistake();
    monitor.mistake();
    monitor.mistake();
    monitor.update(25, .1, 6, 0, 0, 0);
    expect(sent).toEqual(['rocket_spin_fast', 'mission_halfway', 'player_idle', 'easter_gemple38', 'mission_almost_done']);
  });

  it('prioritizes queued lines, respects global and per-line cooldown, and rotates alternatives', () => {
    const router = new DialogueRouter(lines, rules.globalCooldownSec);
    router.queue('inspect_back', 0);
    router.queue('repair_substep', 0);
    const first = router.next(0)!;
    expect(first.event).toBe('repair_substep');
    expect(router.next(1)).toBeUndefined();
    expect(router.queue('repair_substep', 2)).toBe(true);
    const next = router.next(2.3)!;
    expect(next.event).toBe(first.event);
    expect(next.id).not.toBe(first.id);
    expect(router.next(4.6, next)).toBeUndefined();
    expect(router.next(4.6)?.event).toBe('inspect_back');
  });

  it('interrupts for explicit launch or hint events and expires stale dialogue', () => {
    const router = new DialogueRouter(lines, 2.2);
    router.queue('player_idle', 0, 1);
    router.queue('session_start', 0);
    const active = router.next(0)!;
    router.queue('launch_countdown', .1, 2, true);
    expect(router.next(.1, active)?.event).toBe('launch_countdown');
    expect(router.next(4)).toBeUndefined();
    const launch = lines.find(line => line.event === 'launch_countdown')!;
    expect(launch.clip).toBe('count');
  });
});
