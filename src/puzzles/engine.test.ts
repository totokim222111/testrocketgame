import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { Mission, StepOf } from '../content/types';
import { angularError, pressures, PuzzleEngine, type PuzzleEvent } from './engine';

const mission = load(readFileSync(new URL('../../public/content/missions/orbital-repair-15m.yaml', import.meta.url), 'utf8')) as Mission;
const step = <K extends Mission['steps'][number]['mechanicType']>(kind: K) =>
  mission.steps.find(item => item.mechanicType === kind) as StepOf<K>;

describe('repair simulation', () => {
  it('maps the valve solution into all three exact band centers', () => {
    const valves = step('coupled_valves');
    const { couplingMatrix, solutionValves, initialValves } = valves.params;
    const center = pressures(couplingMatrix, solutionValves);
    [0.5904, 0.5550, 0.6564].forEach((value, i) => expect(center[i]).toBeCloseTo(value, 8));
    const one = [...initialValves] as typeof initialValves;
    one[1] += .04;
    pressures(couplingMatrix, initialValves).forEach((before, i) => expect(pressures(couplingMatrix, one)[i]).toBeGreaterThan(before));
    const engine = new PuzzleEngine({ ...mission, steps: [valves] });
    solutionValves.forEach((value, i) => engine.turn(i, value - initialValves[i]));
    expect(engine.index).toBe(1);
  });

  it('measures wrap-around error and requires a continuous aligned dwell', () => {
    const gyro = step('vernier_ring');
    const engine = new PuzzleEngine({ ...mission, steps: [gyro] });
    expect(angularError(359, 1)).toBe(2);
    expect(angularError(179, -179)).toBe(2);
    const { initialOffsetDeg, targetDeg, holdLockSec } = gyro.params;
    engine.turn(0, targetDeg + 359 - initialOffsetDeg);
    engine.update(holdLockSec * .75);
    expect(engine.index).toBe(0);
    engine.turn(0, 12);
    engine.update(holdLockSec);
    engine.turn(0, -12);
    engine.update(holdLockSec * .50);
    expect(engine.index).toBe(0);
    engine.update(holdLockSec * .51);
    expect(engine.index).toBe(1);
    expect(engine.states[0]).toMatchObject({ angle: targetDeg, locked: true });
  });

  it('emits a wrong-socket mistake without connecting and accepts the bypass', () => {
    const bus = step('wire_patch');
    const events: PuzzleEvent[] = [];
    const engine = new PuzzleEngine({ ...mission, steps: [bus] }, event => events.push(event));
    const bypass = bus.params.wires.find(wire => wire.note)!;
    const wrong = bus.params.wires.find(wire => wire !== bypass)!;
    engine.selectWire(bypass.id);
    engine.connectWire(wrong.targetSocket);
    expect(events.some(event => event.type === 'mistake')).toBe(true);
    expect(engine.state).toMatchObject({ selected: bypass.id, connected: new Set() });
    engine.connectWire(bypass.targetSocket);
    expect(engine.state).toMatchObject({ selected: null, connected: new Set([bypass.id]) });
    engine.solveCurrentStep();
    expect(engine.index).toBe(1);
  });

  it('enforces sequential weld nodes and allows continuation after a pause', () => {
    const weld = step('seam_weld');
    const engine = new PuzzleEngine({ ...mission, steps: [weld] });
    engine.weld(1);
    expect(engine.state).toMatchObject({ welded: 0 });
    engine.weld(0);
    engine.update(2);
    engine.weld(1);
    expect(engine.state).toMatchObject({ welded: 2 });
    engine.solveCurrentStep();
    expect(engine.index).toBe(1);
  });

  it('enforces trim, igniter, nose lock and open safety guard before launch', () => {
    const engine = new PuzzleEngine(mission);
    for (let i = 0; i < 6; i++) engine.solveCurrentStep();
    expect(engine.step.mechanicType).toBe('nozzle_trim');
    engine.insertIgniter();
    expect(engine.index).toBe(6);
    engine.solveCurrentStep();
    expect(engine.index).toBe(7);
    expect(engine.launch()).toBe(false);
    engine.toggleGuard();
    expect(engine.guardOpen).toBe(false);
    engine.turn(0, step('nosecone_arm').params.requiredTwistDeg);
    expect(engine.armed).toBe(false);
    engine.toggleGuard();
    expect(engine.armed).toBe(true);
    expect(engine.launch()).toBe(true);
    expect(engine.launch()).toBe(false);
    expect(engine.index).toBe(mission.steps.length);
    engine.reset();
    expect(engine.index).toBe(0);
    expect(engine.launched).toBe(false);
  });
});
