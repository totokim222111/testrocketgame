import * as T from 'three';
import type { Mount } from '../content/types';
import { damp, deg, mesh } from '../render/graphics';
import type { RocketModel } from './model';

export class Guidance {
  private readonly group = new T.Group();
  private readonly ring: T.Mesh;
  private readonly arrow: T.Mesh;
  private readonly material;
  private readonly cameraLocal = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly tangential = new T.Vector3();
  private readonly eye = new T.Vector3();

  constructor(private readonly model: RocketModel) {
    this.material = new T.MeshBasicMaterial({ color: model.housing.palette.glowActive, transparent: true,
      opacity: 0, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending });
    this.ring = mesh(this.group, new T.TorusGeometry(model.radius * 1.42, .00051, 4, 28, Math.PI * 1.24), this.material);
    this.ring.rotation.set(Math.PI / 2, 0, -.85);
    const guide = new T.Shape().moveTo(-.0058, .0068).lineTo(.007, 0).lineTo(-.0058, -.0068)
      .lineTo(-.0058, -.0031).lineTo(.0007, 0).lineTo(-.0058, .0031).closePath();
    this.arrow = mesh(model.root, new T.ShapeGeometry(guide), this.material);
    model.root.add(this.group);
  }

  update(dt: number, mount: Mount | undefined, viewer: T.Vector3, time: number, progress = 0) {
    if (!mount) {
      this.material.opacity = damp(this.material.opacity, 0, 12, dt);
      this.group.visible = this.arrow.visible = this.material.opacity > .006;
      return;
    }
    this.cameraLocal.copy(viewer);
    this.model.root.worldToLocal(this.cameraLocal).normalize();
    const pitch = mount.zone === 'top' || mount.zone === 'bottom';
    const targetAngle = deg(mount.angleDeg + (mount.spanDeg ?? 0) * progress);
    if (pitch) this.normal.set(0, mount.zone === 'top' ? 1 : -1, 0);
    else this.normal.set(Math.sin(targetAngle), 0, Math.cos(targetAngle));
    const facing = this.cameraLocal.dot(this.normal);
    const opacity = T.MathUtils.clamp((.81 - facing) * .94, 0, .76) * (.91 + Math.sin(time * 3) * .09);
    this.material.opacity = damp(this.material.opacity, opacity, 8, dt);
    this.group.visible = this.arrow.visible = this.material.opacity > .006;
    if (!this.group.visible) return;
    const cameraAngle = Math.atan2(this.cameraLocal.x, this.cameraLocal.z);
    const radius = this.model.radius * 1.38;
    this.group.position.y = this.model.height(mount.heightRatio);
    this.group.rotation.y = cameraAngle;
    this.arrow.position.set(Math.sin(cameraAngle) * radius, this.group.position.y,
      Math.cos(cameraAngle) * radius);
    this.eye.copy(this.cameraLocal).multiplyScalar(2);
    this.arrow.lookAt(this.model.root.localToWorld(this.eye));
    if (pitch) this.arrow.rotateZ(mount.zone === 'top' ? Math.PI / 2 : -Math.PI / 2);
    else {
      this.tangential.set(Math.cos(cameraAngle), 0, -Math.sin(cameraAngle));
      const delta = this.normal.dot(this.tangential);
      if (delta < 0) this.arrow.rotateZ(Math.PI);
    }
  }
}
