import type { Mechanics, Mission, Pair, Step, Triple } from '../content/types';

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const wrapAngle = (angle: number) => ((angle % 360) + 360) % 360;
export const signedAngle = (angle: number) => wrapAngle(angle + 180) - 180;
export const angularError = (a: number, b: number) => Math.abs(signedAngle(a - b));

export function pressures(matrix: Mechanics['coupled_valves']['couplingMatrix'], valves: Triple): Triple {
  return matrix.map(row => row[0] * valves[0] + row[1] * valves[1] + row[2] * valves[2]) as Triple;
}

export type PuzzleState =
  | { kind: 'fastener_unlock'; turns: number[]; locked: boolean[] }
  | { kind: 'vernier_ring'; angle: number; dwell: number; locked: boolean }
  | { kind: 'coupled_valves'; valves: Triple; gauges: Triple; centers: Triple }
  | { kind: 'wire_patch'; connected: Set<string>; selected: string | null }
  | { kind: 'seam_weld'; welded: number }
  | { kind: 'wave_sliders'; values: Triple }
  | { kind: 'nozzle_trim'; offset: Pair; inserted: boolean }
  | { kind: 'nosecone_arm'; twist: number; sealed: boolean };

type Feedback = 'ratchet' | 'click' | 'hatch' | 'vernier' | 'valve' | 'wire' | 'spark' | 'weld' | 'resonance' | 'trim' | 'nose' | 'guard';
export type PuzzleEvent =
  | { type: 'feedback'; sound: Feedback; index?: number }
  | { type: 'substep' | 'mistake' | 'armed' }
  | { type: 'step'; completed: Step; next?: Step };

function initial(step: Step): PuzzleState {
  switch (step.mechanicType) {
    case 'fastener_unlock': return { kind: step.mechanicType, turns: Array(step.params.boltCount).fill(0), locked: Array(step.params.boltCount).fill(false) };
    case 'vernier_ring': return { kind: step.mechanicType, angle: step.params.initialOffsetDeg, dwell: 0, locked: false };
    case 'coupled_valves': return { kind: step.mechanicType, valves: [...step.params.initialValves],
      gauges: pressures(step.params.couplingMatrix, step.params.initialValves),
      centers: pressures(step.params.couplingMatrix, step.params.solutionValves) };
    case 'wire_patch': return { kind: step.mechanicType, connected: new Set(), selected: null };
    case 'seam_weld': return { kind: step.mechanicType, welded: 0 };
    case 'wave_sliders': return { kind: step.mechanicType, values: [...step.params.initialSliders] };
    case 'nozzle_trim': return { kind: step.mechanicType, offset: [...step.params.initialOffset], inserted: false };
    case 'nosecone_arm': return { kind: step.mechanicType, twist: 0, sealed: false };
  }
}

export class PuzzleEngine {
  readonly steps: Step[];
  states: PuzzleState[];
  index = 0;
  armed = false;
  launched = false;
  guardOpen = false;

  constructor(mission: Mission, private readonly emit: (event: PuzzleEvent) => void = () => {}) {
    this.steps = [...mission.steps].sort((a, b) => a.order - b.order);
    this.states = this.steps.map(initial);
  }
  get step() { return this.steps[this.index]; }
  get state() { return this.states[this.index]; }

  reset() {
    this.index = 0;
    this.armed = this.launched = this.guardOpen = false;
    this.states = this.steps.map(initial);
  }

  private sound(sound: Feedback, index?: number) { this.emit({ type: 'feedback', sound, index }); }
  private substep() { this.emit({ type: 'substep' }); }
  private finish() {
    const completed = this.step;
    if (!completed) return;
    this.index++;
    this.emit({ type: 'step', completed, next: this.step });
    if (!this.step && !this.launched) this.arm();
  }

  private arm() {
    if (this.armed) return;
    this.armed = true;
    this.emit({ type: 'armed' });
  }

  turn(index: number, delta: number) {
    const { step, state } = this;
    if (this.launched || !step || !Number.isFinite(delta)) return;
    if (step.mechanicType === 'fastener_unlock' && state.kind === step.mechanicType && state.locked[index] === false) {
      const before = state.turns[index];
      const next = before + delta;
      const target = step.params.targetTurnsDeg;
      const closest = next + signedAngle(target - next);
      const crossed = closest >= Math.min(before, next) && closest <= Math.max(before, next);
      if (angularError(next, target) <= step.params.toleranceDeg || crossed) {
        state.turns[index] = target;
        state.locked[index] = true;
        this.sound('click', index);
        this.substep();
        if (state.locked.every(Boolean)) {
          this.sound('hatch');
          this.finish();
        }
      } else {
        state.turns[index] = next;
        if (Math.floor(before / 22.5) !== Math.floor(next / 22.5)) this.sound('ratchet', index);
      }
    }
    if (step.mechanicType === 'vernier_ring' && state.kind === step.mechanicType) {
      const before = state.angle;
      state.angle += delta;
      if (angularError(state.angle, step.params.targetDeg) > step.params.toleranceDeg) state.dwell = 0;
      if (Math.floor(before / 12) !== Math.floor(state.angle / 12)) this.sound('ratchet');
    }
    if (step.mechanicType === 'coupled_valves' && state.kind === step.mechanicType && index in state.valves) {
      const before = state.valves[index];
      state.valves[index] = clamp(before + delta);
      state.gauges = pressures(step.params.couplingMatrix, state.valves);
      if (Math.floor(before * 16) !== Math.floor(state.valves[index] * 16)) this.sound('valve', index);
      if (state.gauges.every((value, i) => Math.abs(value - state.centers[i]) <= step.params.safeBandHalfWidth)) {
        this.sound('vernier');
        this.finish();
      }
    }
    if (step.mechanicType === 'nozzle_trim' && state.kind === step.mechanicType && index in state.offset) {
      const before = state.offset[index];
      state.offset[index] = clamp(before + delta, -1, 1);
      if (Math.floor(before * 14) !== Math.floor(state.offset[index] * 14)) this.sound('trim', index);
      if (!step.params.requireIgniterInsert && this.nozzleCentered()) this.insertIgniter();
    }
    if (step.mechanicType === 'nosecone_arm' && state.kind === step.mechanicType && !state.sealed) {
      const before = state.twist;
      state.twist = clamp(before + delta, 0, step.params.requiredTwistDeg);
      if (step.params.requiredTwistDeg - state.twist <= step.params.toleranceDeg) {
        state.twist = step.params.requiredTwistDeg;
        state.sealed = true;
        this.sound('nose');
        if (!step.params.requireSafetyGuard) this.arm();
      } else if (Math.floor(before / 12) !== Math.floor(state.twist / 12)) this.sound('ratchet');
    }
  }

  update(dt: number) {
    const { step, state } = this;
    if (step?.mechanicType !== 'vernier_ring' || state.kind !== step.mechanicType) return;
    if (angularError(state.angle, step.params.targetDeg) > step.params.toleranceDeg) {
      state.dwell = 0;
      return;
    }
    state.dwell += dt;
    if (state.dwell >= step.params.holdLockSec) {
      state.angle = step.params.targetDeg;
      state.locked = true;
      this.sound('vernier');
      this.finish();
    }
  }

  selectWire(id: string) {
    const { step, state } = this;
    if (step?.mechanicType !== 'wire_patch' || state.kind !== step.mechanicType ||
      !step.params.wires.some(wire => wire.id === id) || state.connected.has(id)) return;
    state.selected = id;
    this.sound('click');
  }

  connectWire(socket: string) {
    const { step, state } = this;
    if (step?.mechanicType !== 'wire_patch' || state.kind !== step.mechanicType || !state.selected) return;
    const wire = step.params.wires.find(wire => wire.id === state.selected);
    if (!wire || !step.params.wires.some(entry => entry.targetSocket === socket)) return;
    if (wire.targetSocket !== socket) {
      this.sound('spark', [...step.params.wires.map(wire => wire.targetSocket)].sort().indexOf(socket));
      this.emit({ type: 'mistake' });
      return;
    }
    state.connected.add(wire.id);
    state.selected = null;
    this.sound('wire');
    this.substep();
    if (state.connected.size === step.params.wires.length) this.finish();
  }

  weld(index: number) {
    const { step, state } = this;
    if (step?.mechanicType !== 'seam_weld' || state.kind !== step.mechanicType || index !== state.welded) return;
    state.welded++;
    this.sound('weld', index);
    if (state.welded === step.params.checkpointCount) this.finish();
    else if (state.welded % 3 === 0) this.substep();
  }

  slide(index: number, delta: number) {
    const { step, state } = this;
    if (step?.mechanicType !== 'wave_sliders' || state.kind !== step.mechanicType || !(index in state.values)) return;
    state.values[index] = clamp(state.values[index] + delta);
    if (state.values.every((value, i) => Math.abs(value - step.params.targetSliders[i]) <= step.params.tolerance)) {
      state.values = [...step.params.targetSliders];
      this.sound('resonance');
      this.finish();
    }
  }

  nozzleCentered() {
    return this.state?.kind === 'nozzle_trim' && this.step?.mechanicType === 'nozzle_trim' &&
      Math.hypot(...this.state.offset) <= this.step.params.toleranceRadius;
  }

  insertIgniter() {
    const state = this.state;
    if (state?.kind !== 'nozzle_trim') return;
    if (!this.nozzleCentered()) {
      this.sound('spark');
      this.emit({ type: 'mistake' });
      return;
    }
    state.inserted = true;
    this.sound('click');
    this.finish();
  }

  toggleGuard() {
    if (this.state?.kind !== 'nosecone_arm' || !this.state.sealed || this.launched) return;
    this.guardOpen = !this.guardOpen;
    this.sound('guard');
    if (this.guardOpen) this.arm();
    else if (this.step?.mechanicType === 'nosecone_arm' && this.step.params.requireSafetyGuard) this.armed = false;
  }

  launch() {
    if (!this.armed || this.launched) return false;
    this.launched = true;
    if (this.step?.mechanicType === 'nosecone_arm') this.finish();
    return true;
  }

  solveCurrentStep() {
    const { step, state } = this;
    if (this.launched || !step) return false;
    switch (step.mechanicType) {
      case 'fastener_unlock':
        if (state.kind === step.mechanicType) state.turns.forEach((value, i) => this.turn(i, step.params.targetTurnsDeg - value));
        break;
      case 'vernier_ring':
        if (state.kind === step.mechanicType) this.turn(0, signedAngle(step.params.targetDeg - state.angle));
        this.update(step.params.holdLockSec);
        break;
      case 'coupled_valves':
        if (state.kind === step.mechanicType) step.params.solutionValves.forEach((value, i) => this.turn(i, value - state.valves[i]));
        break;
      case 'wire_patch':
        for (const wire of step.params.wires) {
          this.selectWire(wire.id);
          this.connectWire(wire.targetSocket);
        }
        break;
      case 'seam_weld':
        if (state.kind === step.mechanicType) while (state.welded < step.params.checkpointCount) this.weld(state.welded);
        break;
      case 'wave_sliders':
        if (state.kind === step.mechanicType) step.params.targetSliders.forEach((value, i) => this.slide(i, value - state.values[i]));
        break;
      case 'nozzle_trim':
        if (state.kind === step.mechanicType) state.offset.forEach((value, i) => this.turn(i, -value));
        this.insertIgniter();
        break;
      case 'nosecone_arm':
        if (state.kind === step.mechanicType) this.turn(0, step.params.requiredTwistDeg - state.twist);
        if (step.params.requireSafetyGuard && !this.guardOpen) this.toggleGuard();
        break;
    }
    return true;
  }
}
