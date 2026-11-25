import * as T from 'three';
import type { Step } from '../content/types';
import { Targets, type Contact } from '../input/targets';
import { batch, box, cylinder, light, mesh, toon, unitBox } from '../render/graphics';
import { RocketModel } from '../rocket/model';
import { PuzzleEngine } from './engine';

export type StationView = { update(dt: number, time: number, viewer?: T.Vector3): void; sparkPoint?(i: number): T.Vector3 | undefined };

export class StationContext {
  readonly mount;
  readonly group = new T.Group();
  readonly p;
  readonly r;
  readonly scale;
  readonly dark;
  readonly trim;
  readonly hull;
  readonly brass;
  readonly ink;
  readonly active;
  readonly warning;
  readonly status;
  constructor(readonly model: RocketModel, readonly engine: PuzzleEngine, readonly targets: Targets, readonly step: Step, readonly index: number) {
    this.mount = model.housing.mounts[step.mountId];
    model.root.add(this.group);
    this.p = model.housing.palette;
    this.r = model.radius;
    this.scale = this.r / .02069;
    const p = this.p;
    this.dark = toon(p.hullDark);
    this.trim = toon(p.metalTrim);
    this.hull = toon(p.hullShade);
    this.brass = toon(p.accentSecondary);
    this.ink = toon(p.inkLine);
    this.active = light(p.glowActive);
    this.warning = light(p.glowWarning);
    this.status = light(p.accentPrimary);
  }
  mm(value: number) { return value * .001 * this.scale; }
  pivot() {
    const pivot = this.model.station(this.mount);
    this.group.add(pivot);
    return pivot;
  }
  register(object: T.Object3D, normal: T.Object3D, action: Omit<Contact, 'object' | 'normal' | 'step'>) {
    return this.targets.add({ object, normal, step: this.index, nearRadius: this.mm(3.5), ...action });
  }
  state() { return this.engine.states[this.index]; }
  get done() { return this.engine.index > this.index; }
  get current() { return this.engine.index === this.index; }

  faceCylinder(parent: T.Object3D, material: T.Material, radius: number, depth: number, x: number, y: number, z: number, sides = 20) {
    const disk = cylinder(parent, material, radius, radius * 1.02, depth, x, y, z, sides);
    disk.rotation.x = Math.PI / 2;
    return disk;
  }

  knob(parent: T.Object3D, x: number, y: number, z: number, radius: number, material = this.brass, teeth = 10) {
    const rig = new T.Group();
    rig.position.set(x, y, z);
    parent.add(rig);
    this.faceCylinder(rig, this.dark, radius * 1.12, this.mm(1.2), 0, 0, -.001);
    const face = this.faceCylinder(rig, material, radius, this.mm(2), 0, 0, .0005, teeth * 2);
    batch(rig, unitBox, material, teeth, (i, tooth) => {
      const angle = i * Math.PI * 2 / teeth;
      tooth.rotation.z = angle;
      tooth.position.set(Math.sin(angle) * -radius, Math.cos(angle) * radius, .0005);
      tooth.scale.set(radius * .24, radius * .33, this.mm(1.7));
    });
    box(rig, this.ink, radius * .25, radius * .79, this.mm(.22), 0, radius * .35, this.mm(1.63));
    const dot = this.faceCylinder(rig, this.ink, radius * .17, this.mm(.21), 0, 0, this.mm(1.68), 8);
    return { rig, face, dot };
  }

  hit(parent: T.Object3D, w: number, h: number, depth: number, x = 0, y = 0, z = 0) {
    return box(parent, invisible, w, h, depth, x, y, z);
  }
}

const invisible = new T.MeshBasicMaterial({ visible: false });

export function plateArc(parent: T.Object3D, r: number, h: number, angle: number, material: T.Material, depth = .0012) {
  const geo = new T.CylinderGeometry(r, r, h, 20, 1, true, -angle / 2, angle);
  const panel = mesh(parent, geo, material, 0, 0, -r + depth);
  return panel;
}
