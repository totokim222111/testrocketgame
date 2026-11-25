import * as T from 'three';
import type { StepOf } from '../content/types';
import { box, cylinder, damp, deg, display, label, mesh, tube, batch, unitBox } from '../render/graphics';
import { angularError, clamp, signedAngle } from './engine';
import { plateArc, StationContext, type StationView } from './stationCommon';

function carriedTube(geometry: T.TubeGeometry, start: T.Vector3, end: T.Vector3, radius: number) {
  const bend = new T.Vector3(start.x, start.y - .001, start.z + .007);
  const lead = new T.Vector3(end.x, end.y + .004, end.z + .003);
  const curve = new T.CubicBezierCurve3(start, bend, lead, end);
  const { tubularSegments, radialSegments } = geometry.parameters;
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const center = new T.Vector3(), tangent = new T.Vector3(), normal = new T.Vector3(), other = new T.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPoint(t, center);
    curve.getTangent(t, tangent);
    normal.set(Math.abs(tangent.z) > .95 ? 1 : 0, 0, Math.abs(tangent.z) > .95 ? 0 : 1).cross(tangent).normalize();
    other.crossVectors(tangent, normal);
    for (let j = 0; j <= radialSegments; j++) {
      const angle = j / radialSegments * Math.PI * 2;
      const x = normal.x * Math.cos(angle) + other.x * Math.sin(angle);
      const y = normal.y * Math.cos(angle) + other.y * Math.sin(angle);
      const z = normal.z * Math.cos(angle) + other.z * Math.sin(angle);
      const index = i * (radialSegments + 1) + j;
      positions.setXYZ(index, center.x + x * radius, center.y + y * radius, center.z + z * radius);
      normals.setXYZ(index, x, y, z);
    }
  }
  positions.needsUpdate = normals.needsUpdate = true;
}

export function hatch(c: StationContext, step: StepOf<'fastener_unlock'>): StationView {
  const pivot = c.pivot();
  const m = c.mm.bind(c);
  const panel = new T.Group();
  pivot.add(panel);
  plateArc(pivot, c.r, m(24), 1.13, c.dark, m(.32));
  const board = box(pivot, c.dark, m(15), m(18), m(1), 0, 0, m(.7));
  const chips = new T.Group();
  pivot.add(chips);
  box(chips, c.trim, m(9), m(9.5), m(1.8), m(2), m(.5), m(2));
  batch(chips, unitBox, c.brass, 12, (i, object) => {
    object.position.set(i < 6 ? -m(4) : m(8), m((i % 6 - 2.5) * 1.6), m(2.5));
    object.scale.set(m(2), m(.6), m(.6));
  });
  batch(chips, unitBox, c.active, 6, (i, object) => {
    object.position.set(m(-5.5 + i * 2.2), m(-6.9), m(2));
    object.scale.set(m(1.1), m(.66), m(.65));
  });
  plateArc(panel, c.r, m(21), 1.04, c.hull, m(2.4));
  plateArc(panel, c.r + m(.5), m(2.8), .91, c.brass, m(1.46)).position.y = m(8.35);
  label(panel, c.model.housing.lineArtTexture.stencilLabels.find(label => label.angleDeg === c.mount.angleDeg)?.text ?? step.shortLabel,
    c.p.inkLine, m(15.6), m(2.4), 0, m(8.25), m(3));
  box(panel, c.trim, m(10), m(.7), m(.7), 0, m(-7), m(2.5));
  const knobs = Array.from({ length: step.params.boltCount }, (_, i) => {
    const angle = i * Math.PI * 2 / step.params.boltCount;
    const x = Math.sin(angle) * m(6.8), y = Math.cos(angle) * m(-4.2);
    const knob = c.knob(panel, x, y, m(3), m(step.params.boltCount > 5 ? 1.1 : 1.95), c.trim, 6);
    box(knob.rig, c.ink, m(3.1), m(.50), m(.25), 0, 0, m(1.65));
    box(knob.rig, c.brass, m(.55), m(.55), m(.25), m(1.1), 0, m(1.68));
    const stop = c.faceCylinder(panel, c.brass, m(.56), m(.35), x - m(2.45), y, m(4.1), 8);
    const hit = c.hit(knob.rig, m(4.5), m(4.5), m(3), 0, 0, m(1.4));
    c.register(hit, pivot, { kind: 'drag', enabled: () => {
      const state = c.state();
      return state.kind === 'fastener_unlock' && !state.locked[i];
    }, press: dir => c.engine.turn(i, dir * 45), drag: (x, y) => c.engine.turn(i, x * 13 - y * 5),
    twist: angle => c.engine.turn(i, angle * 2.2) });
    return { knob, stop };
  });
  let opening = 0;
  return { update(dt, time) {
    const s = c.state();
    if (s.kind !== 'fastener_unlock') return;
    opening = damp(opening, Number(c.done), 6.5, dt);
    panel.position.set(m(13) * opening, m(2) * opening, m(4) * opening);
    panel.rotation.y = opening * .42;
    board.visible = chips.visible = opening > .035;
    chips.position.y = Math.sin(time * 3) * m(.09);
    knobs.forEach(({ knob, stop }, i) => {
      knob.rig.rotation.z = -deg(s.turns[i]);
      knob.dot.material = stop.material = s.locked[i] ? c.active : c.brass;
    });
  }};
}

export function vernier(c: StationContext, step: StepOf<'vernier_ring'>): StationView {
  const m = c.mm.bind(c);
  const pivot = c.pivot();
  const ring = new T.Group();
  ring.position.y = c.model.height(c.mount.heightRatio);
  c.model.root.add(ring);
  const base = cylinder(ring, c.brass, c.r + m(.9), c.r + m(1.15), m(2.8), 0, 0, 0, 64);
  const geometry = new T.BoxGeometry(m(.52), m(1.65), m(.47));
  batch(ring, geometry, c.ink, 72, (i, item) => {
    const angle = i * Math.PI * 2 / 72;
    const radius = c.r + m(1.05);
    item.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    item.rotation.y = angle;
    item.scale.y = i % 6 === 0 ? 1.45 : .71;
  });
  const pointer = c.model.surface(c.mount.angleDeg, 0, c.r + m(1.6));
  const markerGeometry = new T.ConeGeometry(m(1.12), m(1.8), 3);
  const mark = mesh(ring, markerGeometry, c.active, pointer.x, 0, pointer.z);
  mark.rotation.z = Math.PI;
  mesh(pivot, markerGeometry, c.hull, 0, m(2.5), m(1.2)).rotation.z = Math.PI;
  const led = c.faceCylinder(pivot, c.warning, m(.8), m(.6), m(6.3), m(4), m(1));
  const readout = display(pivot, m(12), m(3.7), 192, 64, 0, m(6.3), m(1.7));
  const hit = c.hit(pivot, m(20), m(5.5), m(4), 0, 0, m(1.2));
  c.register(hit, pivot, { kind: 'drag', press: direction => c.engine.turn(0, direction * 4),
    drag: (x, y) => c.engine.turn(0, x * 3.1 - y * .7), twist: angle => c.engine.turn(0, angle * 1.1) });
  let cached = '';
  return { update() {
    const s = c.state();
    if (s.kind !== 'vernier_ring') return;
    ring.rotation.y = deg(s.angle - step.params.targetDeg);
    base.material = s.locked ? c.hull : c.brass;
    const aligned = angularError(s.angle, step.params.targetDeg) <= step.params.toleranceDeg;
    led.material = aligned ? c.active : c.warning;
    const offset = signedAngle(s.angle - step.params.targetDeg);
    const value = (offset > 0 ? '+' : '') + offset.toFixed(1) + '°';
    if (value === cached) return;
    cached = value;
    const { ctx, canvas } = readout;
    ctx.fillStyle = c.p.inkLine;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 43px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = aligned ? c.p.glowActive : c.p.hullBase;
    ctx.fillText(value, canvas.width / 2, 48);
    readout.refresh();
  }};
}

export function valves(c: StationContext, step: StepOf<'coupled_valves'>): StationView {
  const pivot = c.pivot();
  const m = c.mm.bind(c);
  plateArc(pivot, c.r, m(24), 1.41, c.dark);
  const max = step.params.couplingMatrix.map(row => row.reduce((sum, value) => sum + value, 0));
  const state = c.state();
  const height = m(11);
  const gauges = Array.from({ length: 3 }, (_, i) => {
    const x = m((i - 1) * 7.3);
    const y = m(4.1);
    label(pivot, 'P' + (i + 1), c.p.hullBase, m(4.9), m(2), x, m(11), m(.9));
    box(pivot, c.ink, m(4.8), height + m(1.2), m(.9), x, y, m(1.2));
    const center = state.kind === 'coupled_valves' ? state.centers[i] / max[i] : .5;
    const low = clamp(center - step.params.safeBandHalfWidth / max[i]);
    const high = clamp(center + step.params.safeBandHalfWidth / max[i]);
    box(pivot, c.status, m(4), (high - low) * height, m(.24), x, y - height / 2 + (high + low) * height / 2, m(1.74));
    box(pivot, c.hull, m(4.6), m(.24), m(.25), x, y - height / 2 + center * height, m(1.93));
    const fill = box(pivot, c.warning, m(2.25), height, m(.36), x, y, m(2.02));
    const knob = c.knob(pivot, x, m(-7.8), m(2), m(2.23), c.brass, 6);
    const hit = c.hit(knob.rig, m(6.3), m(6.3), m(3), 0, 0, m(1.4));
    c.register(hit, pivot, { kind: 'drag', press: direction => c.engine.turn(i, direction * .045),
      drag: (x, y) => c.engine.turn(i, x * .033 + y * .045), twist: angle => c.engine.turn(i, angle * .011) });
    return { knob, fill, y };
  });
  return { update() {
    const s = c.state();
    if (s.kind !== 'coupled_valves') return;
    gauges.forEach(({ knob, fill, y }, i) => {
      const ratio = clamp(s.gauges[i] / max[i]);
      knob.rig.rotation.z = -s.valves[i] * Math.PI * 1.65;
      fill.scale.y = Math.max(m(.2), ratio * height);
      fill.position.y = y - height / 2 + fill.scale.y / 2;
      fill.material = Math.abs(s.gauges[i] - s.centers[i]) <= step.params.safeBandHalfWidth ? c.active : c.warning;
    });
  }};
}

export function wires(c: StationContext, step: StepOf<'wire_patch'>): StationView {
  const pivot = c.pivot();
  const m = c.mm.bind(c);
  const sorted = [...step.params.wires.map(wire => wire.targetSocket)].sort();
  const sockets = sorted.length;
  const offset = (i: number) => m((i / (sockets - 1) - .5) * 23);
  const sourceY = m(10), socketY = m(-7);
  plateArc(pivot, c.r, m(26), 1.43, c.dark, m(.9));
  const at = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const terminals = sorted.map((key, i) => {
    const x = offset(i);
    const radius = m(Math.min(2.18, 10 / sockets));
    c.faceCylinder(pivot, c.trim, radius, m(1.85), x, socketY, m(2.6), 8);
    const terminal = c.faceCylinder(pivot, c.ink, radius * .62, m(.48), x, socketY, m(3.65), 12);
    label(pivot, key, c.p.hullBase, m(5), m(2.2), x, socketY - m(3.45), m(2.8));
    const hit = c.hit(pivot, m(24 / sockets), m(5.4), m(3), x, socketY, m(3.4));
    c.register(hit, pivot, { kind: 'socket', press: () => c.engine.connectWire(key) });
    return terminal;
  });

  const harness = step.params.wires.map((wire, i) => {
    const x = offset(i), dest = offset(sorted.indexOf(wire.targetSocket));
    const cable = new T.MeshStandardMaterial({ color: wire.color, roughness: .58 });
    const trace = new T.MeshBasicMaterial({ color: wire.color });
    const anchor = at(x, sourceY, m(3));
    const freeEnd = at(x + (i % 2 ? m(.6) : m(-.6)), m(1.6) - m(i % 2), m(7.8));
    const plug = c.faceCylinder(pivot, cable, m(Math.min(1.51, 7 / sockets)), m(2.35), freeEnd.x, freeEnd.y, freeEnd.z, 10);
    const selectedCap = c.faceCylinder(pivot, c.active, m(.66), m(.30), freeEnd.x, freeEnd.y, freeEnd.z + m(1.3), 9);
    const radius = m(Math.min(.62, 3 / sockets));
    const loose = tube(pivot, [anchor, at(x, m(7), m(8)), freeEnd], radius, cable, 12);
    const carried = tube(pivot, [anchor, at(x, m(7), m(8)), freeEnd], radius, cable, 12);
    carried.frustumCulled = false;
    carried.visible = false;
    const link = tube(pivot, [anchor, at(x, m(5.4 + i * .7), m(7.4 + i * .25)), at(dest, m(-2), m(7.4)), at(dest, socketY, m(4.1))], radius, cable, 14);
    c.faceCylinder(pivot, cable, m(.99), m(.88), x, sourceY, m(2.9), 9);
    label(pivot, wire.label, wire.color, m(6.2), m(2.15), x, m(12.2), m(3));
    const routeY = m(5.4 - i * 1.75);
    const points = [at(x, m(9), m(2)), at(x, routeY, m(2))];
    if (wire.note) {
      points.push(at(dest + m(2), routeY, m(2)), at(dest + m(2), socketY + m(2), m(2)));
      const burn = c.faceCylinder(pivot, c.ink, m(2.1), m(.22), x - m(.7), socketY + m(2.1), m(2.1), 7);
      burn.rotation.y = .25;
      const score = box(pivot, c.warning, m(2.3), m(.45), m(.25), x - m(.7), socketY + m(2.25), m(2.35));
      score.rotation.z = -.51;
    } else points.push(at(dest, routeY - m(1.5), m(2)));
    points.push(at(dest, socketY + m(1), m(2)));
    tube(pivot, points, m(.25), trace, 12);
    const pulse = c.faceCylinder(pivot, c.active, m(.52), m(.3), 0, 0, 0, 8);
    const pulsePoint = new T.Vector3();
    const hit = c.hit(pivot, m(23 / sockets), m(4.5), m(3.1), freeEnd.x, freeEnd.y, freeEnd.z);
    const end = new T.Vector3();
    let carrying = false;
    c.register(hit, pivot, { kind: 'wire', enabled: () => {
      const s = c.state();
      return s.kind === 'wire_patch' && !s.connected.has(wire.id);
    }, press: () => c.engine.selectWire(wire.id), carry: point => {
      carrying = Boolean(point);
      if (!point) return;
      pivot.worldToLocal(end.copy(point));
      carriedTube(carried.geometry, anchor, end, radius);
    } });
    return { wire, loose, carried, link, selectedCap, plug, freeEnd, dest, pulse, pulsePoint, end, carrying: () => carrying };
  });
  return {
    sparkPoint(i) { return terminals[i]?.getWorldPosition(new T.Vector3()); },
    update(_dt, time) {
      const s = c.state();
      if (s.kind !== 'wire_patch') return;
      harness.forEach(({ wire, loose, carried, link, plug, freeEnd, dest, selectedCap, pulse, pulsePoint, end, carrying }, i) => {
        const connected = s.connected.has(wire.id);
        const chosen = s.selected === wire.id;
        carried.visible = chosen && carrying();
        loose.visible = !connected && !carried.visible;
        link.visible = pulse.visible = connected;
        selectedCap.visible = chosen;
        plug.position.copy(carried.visible ? end : freeEnd);
        selectedCap.position.copy(plug.position);
        selectedCap.position.z += m(1.3);
        if (connected) {
          plug.position.set(dest, socketY, m(4.0));
          link.geometry.parameters.path.getPointAt((time * .85 + i / sockets) % 1, pulsePoint);
          pulse.position.copy(pulsePoint);
          pulse.position.z += m(.59);
        }
        terminals[sorted.indexOf(wire.targetSocket)].material = connected ? c.active : c.ink;
      });
    },
  };
}
