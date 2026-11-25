import * as T from 'three';

export interface Contact {
  object: T.Object3D;
  normal?: T.Object3D;
  step?: number;
  kind?: 'drag' | 'wire' | 'socket' | 'weld';
  nearRadius?: number;
  enabled?: () => boolean;
  press?: (direction: number) => void;
  drag?: (dx: number, dy: number) => void;
  twist?: (degrees: number) => void;
  carry?: (point: T.Vector3 | null) => void;
}

export class Targets {
  readonly contacts: Contact[] = [];
  private readonly caster = new T.Raycaster();
  private readonly normal = new T.Vector3();
  private readonly delta = new T.Vector3();
  private readonly position = new T.Vector3();
  private readonly matrix = new T.Matrix3();
  private readonly plane = new T.Plane();

  add(contact: Contact) { this.contacts.push(contact); return contact; }

  private eligible(contact: Contact, step: number, from: T.Vector3) {
    if ((contact.step !== undefined && contact.step !== step) || contact.enabled?.() === false) return false;
    if (contact.normal) {
      this.normal.set(0, 0, 1).applyMatrix3(this.matrix.getNormalMatrix(contact.normal.matrixWorld)).normalize();
      this.position.setFromMatrixPosition(contact.normal.matrixWorld);
      this.delta.subVectors(from, this.position).normalize();
      if (this.delta.dot(this.normal) < .12) return false;
    }
    return true;
  }

  pointer(x: number, y: number, camera: T.Camera, step: number, kind?: Contact['kind']) {
    this.caster.setFromCamera({ x, y } as T.Vector2, camera);
    return this.pick(step, kind);
  }

  pointerOnContact(x: number, y: number, camera: T.Camera, contact: Contact, out: T.Vector3) {
    this.caster.setFromCamera({ x, y } as T.Vector2, camera);
    camera.getWorldDirection(this.normal);
    contact.object.getWorldPosition(this.position);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.position);
    return this.caster.ray.intersectPlane(this.plane, out);
  }

  ray(origin: T.Vector3, direction: T.Vector3, step: number, kind?: Contact['kind']) {
    this.caster.set(origin, direction);
    return this.pick(step, kind);
  }

  private pick(step: number, kind?: Contact['kind']) {
    let best: Contact | undefined;
    let distance = Infinity;
    for (const contact of this.contacts) {
      if ((kind && contact.kind !== kind) || !this.eligible(contact, step, this.caster.ray.origin)) continue;
      const hit = this.caster.intersectObject(contact.object, false)[0];
      if (hit && hit.distance < distance) { distance = hit.distance; best = contact; }
    }
    return best ? { contact: best, distance } : undefined;
  }

  near(point: T.Vector3, from: T.Vector3, step: number, kind?: Contact['kind']) {
    let best: Contact | undefined;
    let distance = Infinity;
    for (const contact of this.contacts) {
      if (!contact.nearRadius || (kind && contact.kind !== kind) || !this.eligible(contact, step, from)) continue;
      const matrix = contact.object.matrixWorld;
      const gap = this.position.setFromMatrixPosition(matrix).distanceTo(point);
      if (gap < contact.nearRadius * Math.max(1, contact.normal?.matrixWorld.getMaxScaleOnAxis() ?? 1) && gap < distance) {
        distance = gap;
        best = contact;
      }
    }
    return best;
  }
}
