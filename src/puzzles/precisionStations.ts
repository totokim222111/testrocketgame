import * as T from 'three';
import type { StepOf } from '../content/types';
import { box, damp, deg, display, label, mesh, tube } from '../render/graphics';
import { plateArc, StationContext, type StationView } from './stationCommon';

export function seam(c: StationContext, step: StepOf<'seam_weld'>): StationView {
  const { checkpointCount: count, startAngleDeg, endAngleDeg, waveAmplitudeCm } = step.params;
  const origin = c.mount.angleDeg;
  const span = c.mount.spanDeg ?? endAngleDeg - startAngleDeg;
  const angleAt = (t: number) => origin + span * t;
  const y = c.model.height(c.mount.heightRatio);
  const outer = c.r + c.mm(.55);
  const at = (t: number) => c.model.surface(angleAt(t), y + Math.sin(t * 4 * Math.PI) * waveAmplitudeCm / 100, outer);
  const segments = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const anchor = new T.Group();
    anchor.position.copy(at(t));
    anchor.rotation.y = deg(angleAt(t));
    c.group.add(anchor);
    const hit = c.hit(anchor, c.mm(4.6), c.mm(4.7), c.mm(2.8));
    const node = c.faceCylinder(anchor, c.warning, c.mm(.84), c.mm(.38), 0, 0, c.mm(.44), 8);
    const points = Array.from({ length: 5 }, (_, j) => at(Math.max(0, (i - 1 + j / 4) / (count - 1))));
    const segment = i ? tube(c.group, points, c.mm(.47), c.warning, 9) : undefined;
    c.register(hit, anchor, { kind: 'weld', nearRadius: c.mm(3.5), enabled: () => {
      const state = c.state();
      return state.kind === 'seam_weld' && state.welded === i;
    }, press: () => c.engine.weld(i) });
    return { node, segment };
  });
  return {
    sparkPoint(i) { return segments[i]?.node.getWorldPosition(new T.Vector3()); },
    update(_dt, time) {
      const state = c.state();
      if (state.kind !== 'seam_weld') return;
      segments.forEach(({ node, segment }, i) => {
        if (segment) segment.material = i < state.welded ? c.active : c.warning;
        node.material = i < state.welded ? c.active : c.warning;
        node.scale.setScalar(c.current && state.welded === i ? 1.48 + Math.sin(time * 9) * .28 : .64);
      });
    },
  };
}

export function sliders(c: StationContext, step: StepOf<'wave_sliders'>): StationView {
  const pivot = c.pivot();
  const m = c.mm.bind(c);
  plateArc(pivot, c.r, m(24), 1.18, c.dark, m(1.4));
  box(pivot, c.ink, m(19), m(10.8), m(1.6), 0, m(6), m(1.12));
  const scope = display(pivot, m(18.1), m(9.6), 384, 192, 0, m(6), m(2.2));
  const handles = step.params.labels.map((name, i) => {
    const x = m((i - 1) * 6);
    box(pivot, c.ink, m(2.7), m(7), m(1), x, m(-4.9), m(1.05));
    for (let j = 0; j < 4; j++) box(pivot, c.trim, m(1), m(.24), m(.33), x + m(1.7), m(-7.9 + j * 2), m(1.5));
    const grip = box<T.Material>(pivot, c.brass, m(3.4), m(1.8), m(1.25), x, m(-5), m(2.55));
    const stripe = box(pivot, c.ink, m(2.8), m(.29), m(.25), x, m(-5), m(3.24));
    label(pivot, name, c.p.hullBase, m(5.6), m(1.75), x, m(-10.5), m(1.8));
    const hit = c.hit(pivot, m(5.6), m(8.6), m(3.4), x, m(-4.9), m(2.5));
    c.register(hit, pivot, { kind: 'drag', press: direction => c.engine.slide(i, direction * .07),
      drag: (dx, dy) => c.engine.slide(i, dy * .052 + dx * .006) });
    return { grip, stripe };
  });
  let previous = '';
  let lastFrame = -Infinity;
  return { update(_dt, time) {
    const s = c.state();
    if (s.kind !== 'wave_sliders') return;
    handles.forEach(({ grip, stripe }, i) => {
      grip.position.y = stripe.position.y = m(-8.3 + 6.5 * s.values[i]);
      grip.material = Math.abs(s.values[i] - step.params.targetSliders[i]) <= step.params.tolerance ? c.status : c.brass;
    });
    const key = s.values.map(value => value.toFixed(3)).join('/');
    if (key === previous || time - lastFrame < .034) return;
    previous = key;
    lastFrame = time;
    const { ctx, canvas } = scope;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = c.p.nozzleInner;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c.p.metalTrim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 12; i++) { ctx.moveTo(w * i / 12, 0); ctx.lineTo(w * i / 12, h); }
    for (let i = 1; i < 6; i++) { ctx.moveTo(0, h * i / 6); ctx.lineTo(w, h * i / 6); }
    ctx.stroke();
    function wave(values: number[], color: string, width: number) {
      const [a, f, p] = values;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = 0; x < w; x += 2) {
        const y = h / 2 - Math.sin((x / w * (1.1 + f * 2.6) + p) * Math.PI * 2) * (20 + a * 53);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    wave(step.params.targetSliders, c.p.accentSecondary, 7);
    wave(s.values, c.p.glowActive, 3.5);
    scope.refresh();
  }};
}

export function nozzle(c: StationContext, step: StepOf<'nozzle_trim'>): StationView {
  const pivot = c.pivot();
  const m = c.mm.bind(c);
  const lipZ = c.model.height(c.mount.heightRatio) - c.model.bottom;
  const shell = new T.LatheGeometry([
    new T.Vector2(c.r * .73, lipZ), new T.Vector2(c.r * .66, lipZ - m(1.1)),
    new T.Vector2(c.r * .50, lipZ - m(3.3)), new T.Vector2(c.r * .40, lipZ - m(5.6)),
    new T.Vector2(c.r * .34, lipZ - m(6.6)),
  ], 32);
  const innerMaterial = c.trim.clone();
  innerMaterial.side = T.DoubleSide;
  mesh(pivot, shell, innerMaterial).rotation.x = Math.PI / 2;
  const cone = new T.Group();
  pivot.add(cone);
  cone.position.z = lipZ - m(5.2);
  const coneMaterial = c.ink.clone();
  coneMaterial.side = T.DoubleSide;
  const inner = new T.LatheGeometry([
    new T.Vector2(m(3), -m(2)), new T.Vector2(m(5), -m(.2)),
    new T.Vector2(m(8.1), m(2)), new T.Vector2(m(8.65), m(2.7)),
  ], 24);
  mesh(cone, inner, coneMaterial).rotation.x = Math.PI / 2;
  mesh(cone, new T.TorusGeometry(m(8.6), m(.39), 5, 32), c.brass, 0, 0, m(2.8));
  mesh(pivot, new T.TorusGeometry(m(3.3), m(.20), 5, 24), c.hull, 0, 0, lipZ + m(.2));
  const reticle = new T.Group();
  pivot.add(reticle);
  reticle.position.z = lipZ + m(.29);
  const reticleParts = [-1, 1].flatMap(side => [
    box(reticle, c.warning, m(2.9), m(.38), m(.3), side * m(2.65), 0),
    box(reticle, c.warning, m(.38), m(2.9), m(.3), 0, side * m(2.65)),
  ]);
  const knobs = [-1, 1].map((side, i) => {
    const x = side * m(12);
    const knob = c.knob(pivot, x, 0, lipZ - m(2.05), m(2.45), c.trim, 7);
    label(pivot, (i ? 'Y' : 'X') + '-TRIM', c.p.hullBase, m(7), m(1.8), x, -m(4.1), lipZ - m(.52));
    const hit = c.hit(pivot, m(6.7), m(7), m(3.2), x, 0, lipZ);
    c.register(hit, pivot, { kind: 'drag', press: direction => c.engine.turn(i, direction * .095),
      drag: (dx, dy) => c.engine.turn(i, (dx + dy * .55) * .052), twist: angle => c.engine.turn(i, angle * .012) });
    return knob;
  });
  const igniter = c.faceCylinder(pivot, c.hull, m(1.62), m(2), 0, 0, lipZ - m(1.24), 8);
  const signal = c.faceCylinder(pivot, c.warning, m(.55), m(.32), 0, 0, lipZ - m(.20), 8);
  const hit = c.hit(pivot, m(5.2), m(5.2), m(4), 0, 0, lipZ + m(.8));
  if (step.params.requireIgniterInsert) c.register(hit, pivot, { press: () => c.engine.insertIgniter() });
  return { update(dt) {
    const s = c.state();
    if (s.kind !== 'nozzle_trim') return;
    const [x, y] = s.offset;
    cone.rotation.y = damp(cone.rotation.y, x * .36, 18, dt);
    cone.rotation.x = damp(cone.rotation.x, -y * .36, 18, dt);
    reticle.position.set(m(x * 6), m(y * 6), lipZ + m(.30));
    const centered = Math.hypot(x, y) <= step.params.toleranceRadius;
    reticleParts.forEach(part => { part.material = centered ? c.active : c.warning; });
    knobs.forEach((knob, i) => { knob.rig.rotation.z = -s.offset[i] * 2.7; });
    igniter.position.z = damp(igniter.position.z, lipZ - m(s.inserted ? 2.64 : 1.24), 17, dt);
    signal.position.z = igniter.position.z + m(1.04);
    signal.material = centered ? c.active : c.warning;
  }};
}

export function nosecone(c: StationContext, step: StepOf<'nosecone_arm'>): StationView {
  const m = c.mm.bind(c);
  const nose = c.model.nose;
  const pivot = c.pivot();
  const hit = c.hit(pivot, c.r * 1.95, c.r * 1.95, m(17));
  const indicator = mesh(c.model.root, new T.TorusGeometry(c.r + m(.18), m(.31), 5, 42), c.warning, 0, c.model.noseStart - m(1.1));
  indicator.rotation.x = Math.PI / 2;
  c.register(hit, pivot, { kind: 'drag', nearRadius: c.r * .82, enabled: () => {
    const s = c.state();
    return s.kind === 'nosecone_arm' && !s.sealed;
  }, press: direction => c.engine.turn(0, direction * 15),
    drag: (dx, dy) => c.engine.turn(0, dx * 5.8 + dy * 1.32), twist: angle => c.engine.turn(0, angle * 1.9) });
  return { update(dt) {
    const s = c.state();
    if (s.kind !== 'nosecone_arm') return;
    nose.rotation.y = damp(nose.rotation.y, deg(step.params.requiredTwistDeg - s.twist), 19, dt);
    indicator.material = s.sealed ? c.active : c.warning;
  }};
}
