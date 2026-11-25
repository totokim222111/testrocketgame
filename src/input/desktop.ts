import * as T from 'three';
import { Targets, type Contact } from './targets';

export interface DesktopActions {
  enabled(): boolean; step(): number; activity(): void;
  rotate(yaw: number, pitch: number): void; zoom(delta: number): void; magnify(): void;
  hint(): void; reset(): void; mute(): void; launch(): void;
  arcball(delta: T.Quaternion): void; hover(contact?: Contact): void;
}

export class DesktopInput {
  private readonly keys = new Set<string>();
  private pointer?: { id: number; contact?: Contact; lastX: number; lastY: number; move: number; direction: number };
  private readonly from = new T.Vector3();
  private readonly to = new T.Vector3();
  private readonly twist = new T.Quaternion();
  private readonly cameraRotation = new T.Quaternion();
  private readonly cameraInverse = new T.Quaternion();
  private readonly carried = new T.Vector3();
  private ndc = new T.Vector2();
  private inside = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly camera: T.Camera,
    private readonly targets: Targets, private readonly actions: DesktopActions) {
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.cancel);
    canvas.addEventListener('pointerleave', () => {
      this.inside = false;
      if (!this.pointer) this.actions.hover();
    });
    canvas.addEventListener('wheel', event => {
      if (!this.actions.enabled()) return;
      event.preventDefault();
      this.actions.activity();
      this.actions.zoom(Math.max(-1, Math.min(1, event.deltaY * .015)));
    }, { passive: false });
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', event => { this.keys.delete(event.code); });
    window.addEventListener('blur', this.cancel);
  }

  private locate(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    this.inside = true;
  }
  private pick(kind?: Contact['kind']) { return this.targets.pointer(this.ndc.x, this.ndc.y, this.camera, this.actions.step(), kind)?.contact; }

  private down = (event: PointerEvent) => {
    if (!this.actions.enabled() || this.pointer || ![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.locate(event);
    const contact = event.button !== 2 ? this.pick() : undefined;
    const direction = event.shiftKey || event.button === 1 ? -1 : 1;
    this.pointer = { id: event.pointerId, contact, lastX: event.clientX, lastY: event.clientY, move: 0, direction };
    this.actions.activity();
    this.actions.hover(contact);
    if (contact?.kind === 'wire' || contact?.kind === 'weld') contact.press?.(direction);
  };

  private projectArc(x: number, y: number, out: T.Vector3) {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) * .31;
    out.set((x - rect.left - rect.width * .51) / size, -(y - rect.top - rect.height * .51) / size, 0);
    const square = out.lengthSq();
    out.z = square < .5 ? Math.sqrt(1 - square) : .5 / Math.sqrt(square);
    return out.normalize();
  }

  private move = (event: PointerEvent) => {
    if (!this.actions.enabled()) return;
    this.locate(event);
    const p = this.pointer;
    this.actions.hover(this.pick());
    if (!p || p.id !== event.pointerId) return;
    const x = event.clientX - p.lastX, y = p.lastY - event.clientY;
    if (x === 0 && y === 0) return;
    p.move += Math.hypot(x, y);
    this.actions.activity();
    if ((event.buttons & 2) && p.contact?.kind === 'weld') this.rotateArc(p.lastX, p.lastY, event.clientX, event.clientY);
    else if (p.contact?.carry && p.move > 4) {
      const point = this.targets.pointerOnContact(this.ndc.x, this.ndc.y, this.camera, p.contact, this.carried);
      if (point) p.contact.carry(point);
    }
    else if (p.contact?.drag && p.move > 2 && p.contact.enabled?.() !== false &&
      (p.contact.step === undefined || p.contact.step === this.actions.step())) p.contact.drag(x, y);
    else if (!p.contact) this.rotateArc(p.lastX, p.lastY, event.clientX, event.clientY);
    p.lastX = event.clientX;
    p.lastY = event.clientY;
  };

  private rotateArc(x0: number, y0: number, x1: number, y1: number) {
    this.projectArc(x0, y0, this.from);
    this.projectArc(x1, y1, this.to);
    this.camera.getWorldQuaternion(this.cameraRotation);
    this.cameraInverse.copy(this.cameraRotation).invert();
    this.twist.setFromUnitVectors(this.from, this.to).premultiply(this.cameraRotation).multiply(this.cameraInverse);
    this.actions.arcball(this.twist);
  }

  private up = (event: PointerEvent) => {
    const p = this.pointer;
    if (!p || p.id !== event.pointerId) return;
    this.locate(event);
    if (p.contact?.kind === 'wire') {
      if (p.move > 4) this.pick('socket')?.press?.(p.direction);
      p.contact.carry?.(null);
    } else if (p.contact?.kind !== 'weld' && p.move < 5 && (p.contact?.step === undefined || p.contact.step === this.actions.step())) {
      p.contact?.press?.(p.direction);
    }
    this.pointer = undefined;
  };

  private cancel = () => {
    this.pointer?.contact?.carry?.(null);
    this.pointer = undefined;
    this.keys.clear();
    this.actions.hover();
  };

  private keydown = (event: KeyboardEvent) => {
    if (!this.actions.enabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) ||
      (event.code === 'Space' && event.target.tagName === 'BUTTON'))) return;
    const code = event.code;
    const motion = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code);
    if (motion) {
      event.preventDefault();
      this.keys.add(code);
      return;
    }
    if (event.repeat) return;
    const keys: Record<string, (() => void) | undefined> = {
      KeyZ: this.actions.magnify, KeyH: this.actions.hint, KeyR: this.actions.reset, KeyM: this.actions.mute, Space: this.actions.launch,
    };
    if (keys[code]) {
      event.preventDefault();
      this.actions.activity();
      keys[code]();
    }
  };

  update(dt: number) {
    if (!this.actions.enabled()) return;
    const has = (...items: string[]) => items.some(item => this.keys.has(item));
    const yaw = Number(has('KeyA', 'ArrowLeft')) - Number(has('KeyD', 'ArrowRight'));
    const pitch = Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown'));
    if (yaw || pitch) {
      this.actions.activity();
      this.actions.rotate(yaw * dt * 106, pitch * dt * 103);
    }
    if (this.inside) this.actions.hover(this.pick());
    if (this.pointer?.contact?.kind === 'weld') this.pick('weld')?.press?.(1);
  }

  get touching() { return this.pointer?.contact !== undefined; }
}
