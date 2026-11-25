import * as T from 'three';
import type { Housing, Mount, StepOf } from '../content/types';
import { deg, mesh, toon, batch, light } from '../render/graphics';
import { makeLineArt } from './lineArtTexture';

export class RocketModel {
  readonly root = new T.Group();
  readonly nose = new T.Group();
  readonly length: number;
  readonly radius: number;
  readonly bottom: number;
  readonly nozzleTop: number;
  readonly noseStart: number;

  constructor(readonly housing: Housing, anisotropy: number, bus?: StepOf<'wire_patch'>) {
    const { dimensions: d, palette: p } = housing;
    this.length = d.lengthCm / 100;
    this.radius = d.circumferenceCm / (200 * Math.PI);
    this.bottom = -this.length / 2;
    this.nozzleTop = this.height(d.nozzleRatio);
    this.noseStart = this.height(1 - d.noseconeRatio);
    const r = this.radius;
    const art = makeLineArt(housing, anisotropy, bus);
    const ceramic = new T.MeshStandardMaterial({ ...art, bumpScale: .00024, metalness: .21, roughness: .34 });
    const trim = toon(p.metalTrim);
    const dark = toon(p.hullDark);
    const accent = toon(p.accentPrimary);
    const fin = toon(p.hullShade);
    const bodyLength = d.bodyRatio * this.length;
    const outline = new T.MeshBasicMaterial({ color: p.inkLine, side: T.BackSide });
    const body = new T.CylinderGeometry(r, r, bodyLength, 64, 1, true);
    this.setAxialUv(body, d.nozzleRatio, d.bodyRatio);
    mesh(this.root, body, ceramic, 0, this.nozzleTop + bodyLength / 2);
    mesh(this.root, body, outline, 0, this.nozzleTop + bodyLength / 2).scale.set(1.016, 1, 1.016);
    const skirtLength = this.nozzleTop - this.bottom;
    const skirt = new T.CylinderGeometry(r, r * .80, skirtLength, 40, 1, true);
    this.setAxialUv(skirt, 0, d.nozzleRatio);
    mesh(this.root, skirt, ceramic, 0, this.bottom + skirtLength / 2);
    mesh(this.root, new T.TorusGeometry(r * .83, r * .075, 6, 36), dark, 0, this.bottom + r * .075).rotation.x = Math.PI / 2;
    mesh(this.root, new T.TorusGeometry(r * .98, r * .035, 5, 48), accent, 0, this.nozzleTop + .001).rotation.x = Math.PI / 2;

    this.nose.position.y = this.noseStart;
    this.root.add(this.nose);
    const noseHeight = this.length * d.noseconeRatio;
    const circleRadius = (noseHeight * noseHeight + r * r) / (2 * r);
    const profile = Array.from({ length: 21 }, (_, i) => {
      const height = noseHeight * (1 - i / 20);
      const ogive = Math.sqrt(circleRadius ** 2 - height ** 2) + r - circleRadius;
      return new T.Vector2(Math.max(.00003, ogive), height);
    }).reverse();
    const ogive = new T.LatheGeometry(profile, 48);
    this.setAxialUv(ogive, 1 - d.noseconeRatio, d.noseconeRatio);
    mesh(this.nose, ogive, ceramic);
    mesh(this.nose, ogive, outline).scale.set(1.025, 1, 1.025);
    mesh(this.nose, new T.TorusGeometry(r, r * .025, 5, 48), trim).rotation.x = Math.PI / 2;
    const collar = new T.BoxGeometry(r * .08, noseHeight * .07, r * .038);
    batch(this.nose, collar, trim, 30, (i, item) => {
      const a = i / 30 * Math.PI * 2;
      item.position.set(Math.sin(a) * r, noseHeight * .052, Math.cos(a) * r);
      item.rotation.y = a;
    });

    const span = d.finSpanCm / 100;
    const outlineFin = new T.Shape()
      .moveTo(r * .81, this.bottom + skirtLength * .10)
      .lineTo(r + span * .93, this.bottom + skirtLength * .10)
      .lineTo(r + span, this.bottom + skirtLength * .25)
      .lineTo(r * 1.54, this.nozzleTop + skirtLength * .22)
      .lineTo(r * .97, this.nozzleTop + skirtLength * .36).closePath();
    const geometry = new T.ExtrudeGeometry(outlineFin, {
      depth: r * .045, bevelEnabled: true, bevelSegments: 1, bevelSize: r * .027, bevelThickness: r * .022,
    });
    batch(this.root, geometry, fin, d.finCount, (i, item) => { item.rotation.y = (i + .5) * Math.PI * 2 / d.finCount; });
    const finMark = new T.BoxGeometry(span * .47, r * .079, r * .055);
    batch(this.root, finMark, light(p.accentSecondary), d.finCount, (i, item) => {
      const a = (i + .5) * Math.PI * 2 / d.finCount;
      item.rotation.y = a;
      item.position.set(Math.cos(a) * (r + span * .32), this.bottom + skirtLength * .18, -Math.sin(a) * (r + span * .32));
    });
  }

  private setAxialUv(geometry: T.BufferGeometry, start: number, span: number) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, start + uv.getY(i) * span);
  }
  height(ratio: number) { return this.bottom + this.length * ratio; }
  surface(angle: number, height: number, radius = this.radius) {
    return new T.Vector3(Math.sin(deg(angle)) * radius, height, Math.cos(deg(angle)) * radius);
  }
  station(mount: Mount, radius = this.radius + .0008) {
    const pivot = new T.Group();
    const angle = deg(mount.angleDeg);
    if (mount.zone === 'bottom') pivot.rotation.set(Math.PI / 2, 0, angle);
    else if (mount.zone === 'top') pivot.rotation.set(-Math.PI / 2, 0, angle);
    else pivot.rotation.y = angle;
    pivot.position.copy(this.surface(mount.angleDeg, this.height(mount.heightRatio),
      mount.zone === 'bottom' || mount.zone === 'top' ? 0 : radius));
    this.root.add(pivot);
    return pivot;
  }
}
