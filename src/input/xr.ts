import * as T from 'three';
import { box, cylinder, light, toon } from '../render/graphics';
import type { Housing } from '../content/types';
import { Targets, type Contact } from './targets';

interface XrActions {
  active(): boolean; busy(): boolean; step(): number; activity(): void;
  grab(delta: T.Quaternion): void; rotate(yaw: number, pitch: number): void;
  magnify(): void; hint(): void; hover(contact?: Contact): void;
}

type XrHand = {
  target: T.XRTargetRaySpace;
  grip: T.XRGripSpace;
  hand: T.XRHandSpace;
  ray: T.Line;
  tipVisual: T.Mesh;
  tool: T.Group;
  source?: XRInputSource;
  squeezing: boolean;
  selecting: boolean;
  touched?: Contact;
  distance: number;
  lastLocal: T.Vector3;
  lastAim: T.Vector3;
  lastWrist: T.Quaternion;
  lastDragWrist: T.Quaternion;
  direction: number;
  motion: number;
  buttons: boolean[];
};

export class XrInput {
  readonly hands: XrHand[] = [];
  private readonly location = new T.Vector3();
  private readonly tip = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly local = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly inverse = new T.Quaternion();
  private readonly twist = new T.Quaternion();
  private readonly rayRotation = new T.Quaternion();
  private readonly delta = new T.Vector3();
  private lastActuator: XrHand | undefined;
  private lastPulse = 0;

  constructor(renderer: T.WebGLRenderer, scene: T.Scene, targets: Targets, palette: Housing['palette'],
    private readonly actions: XrActions) {
    for (let i = 0; i < 2; i++) {
      const target = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      const ray = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 0, -1)]),
        new T.LineBasicMaterial({ color: palette.glowActive, opacity: .65, transparent: true }));
      ray.scale.z = .82;
      target.add(ray);
      const tool = new T.Group();
      grip.add(tool);
      tool.rotation.x = -Math.PI / 2;
      const trim = toon(palette.metalTrim), gripMat = toon(palette.hullDark);
      const signal = light(palette.glowActive);
      cylinder(tool, trim, .010, .016, .077, 0, .026, 0, 8);
      cylinder(tool, gripMat, .014, .013, .033, 0, -.024, 0, 8);
      cylinder(tool, signal, .006, .010, .011, 0, .066, 0, 8);
      const button = box(tool, signal, .009, .020, .006, 0, .015, .011);
      button.rotation.z = .1;
      const tipVisual = new T.Mesh(new T.SphereGeometry(.006, 10, 7), signal);
      scene.add(target, grip, hand, tipVisual);
      tipVisual.visible = false;

      const state: XrHand = {
        target, grip, hand, ray, tool, tipVisual, squeezing: false, selecting: false,
        distance: .4, lastLocal: new T.Vector3(), lastAim: new T.Vector3(),
        lastWrist: new T.Quaternion(), lastDragWrist: new T.Quaternion(), motion: 0, direction: 1, buttons: [],
      };
      this.hands.push(state);

      const current = (type?: Contact['kind']) => {
        target.getWorldPosition(this.location);
        target.getWorldQuaternion(this.rayRotation);
        this.direction.set(0, 0, -1).applyQuaternion(this.rayRotation);
        const tracked = this.fingertip(state, this.tip);
        const near = tracked ? targets.near(this.tip, this.location, actions.step(), type) : undefined;
        const rayHit = targets.ray(this.location, this.direction, actions.step(), type);
        return { contact: near ?? rayHit?.contact, distance: near ? .076 : Math.min(rayHit?.distance ?? .78, .95), tracked };
      };
      const basis = () => {
        const results = current();
        const near = results.tracked && (state.source?.hand || this.tip.distanceTo(this.location) < .13);
        state.lastAim.copy(near && state.source?.hand ? this.tip : this.location).addScaledVector(this.direction, near && state.source?.hand ? 0 : state.distance);
        if (state.touched?.normal) state.touched.normal.worldToLocal(state.lastLocal.copy(state.lastAim));
        this.wrist(state, state.lastWrist);
        state.lastDragWrist.copy(state.lastWrist);
      };
      target.addEventListener('connected', event => {
        state.source = event.data;
        state.tool.visible = !event.data.hand;
      });
      target.addEventListener('disconnected', () => {
        state.source = undefined;
        state.squeezing = state.selecting = state.tipVisual.visible = false;
        state.touched?.carry?.(null);
        state.touched = undefined;
        state.buttons = [];
      });
      target.addEventListener('squeezestart', () => {
        if (!actions.active() || actions.busy()) return;
        actions.activity();
        state.squeezing = true;
        this.wrist(state, state.lastWrist);
      });
      target.addEventListener('squeezeend', () => { state.squeezing = false; });
      target.addEventListener('selectstart', () => {
        if (!actions.active()) return;
        actions.activity();
        this.lastActuator = state;
        state.selecting = true;
        const hit = current();
        state.touched = hit.contact;
        state.distance = Math.min(.70, hit.distance);
        state.motion = 0;
        basis();
        if (hit.contact?.kind !== 'drag') hit.contact?.press?.(1);
      });
      target.addEventListener('selectend', () => {
        state.selecting = false;
        if (state.touched?.kind === 'wire') current('socket').contact?.press?.(1);
        if (state.touched?.kind === 'drag' && state.motion < 2 && state.touched.step === actions.step()) state.touched.press?.(1);
        state.touched?.carry?.(null);
        state.touched = undefined;
      });

      state.target.userData.updateRocketController = (dt: number) => {
        if (!state.source || !target.visible) return;
        const hit = current();
        ray.visible = !state.source.hand || state.selecting;
        ray.scale.z = Math.max(.055, hit.distance);
        state.tipVisual.visible = hit.tracked && Boolean(state.source.hand);
        if (state.tipVisual.visible) state.tipVisual.position.copy(this.tip);
        if (hit.contact) actions.hover(hit.contact);
        if (state.squeezing && !actions.busy()) {
          this.wrist(state, this.quaternion);
          this.inverse.copy(state.lastWrist).invert();
          this.twist.multiplyQuaternions(this.quaternion, this.inverse);
          if (this.twist.angleTo(identity) > .0004) {
            actions.grab(this.twist);
            actions.activity();
          }
          state.lastWrist.copy(this.quaternion);
        }
        if (state.selecting && state.touched?.kind === 'weld') current('weld').contact?.press?.(1);
        const raw = state.touched;
        if (state.selecting && raw?.carry && raw.step === actions.step()) {
          const at = state.source.hand && hit.tracked ? this.tip : this.local.copy(this.location).addScaledVector(this.direction, state.distance);
          raw.carry(at);
        }
        if (state.selecting && raw?.drag && raw.normal && raw.step === actions.step() && raw.enabled?.() !== false) {
          current();
          this.local.copy(state.source.hand && hit.tracked ? this.tip : this.location)
            .addScaledVector(this.direction, state.source.hand && hit.tracked ? 0 : state.distance);
          raw.normal.worldToLocal(this.local);
          this.delta.subVectors(this.local, state.lastLocal);
          state.lastLocal.copy(this.local);
          const dx = T.MathUtils.clamp(this.delta.x * 1250, -13, 13);
          const dy = T.MathUtils.clamp(this.delta.y * 1250, -13, 13);
          const turn = Math.hypot(dx, dy);
          if (turn > .18) {
            state.motion += turn;
            raw.drag(dx, dy);
            actions.activity();
          }
          if (raw.twist && raw.step === actions.step()) {
            this.wrist(state, this.quaternion);
            this.twist.multiplyQuaternions(this.quaternion, this.inverse.copy(state.lastDragWrist).invert());
            const projection = this.twist.x * this.direction.x + this.twist.y * this.direction.y + this.twist.z * this.direction.z;
            const degrees = T.MathUtils.radToDeg(Math.atan2(projection, this.twist.w) * 2);
            const deltaRoll = T.MathUtils.euclideanModulo(degrees + 180, 360) - 180;
            if (Math.abs(deltaRoll) >= .24) {
              state.motion += Math.abs(deltaRoll);
              raw.twist(deltaRoll);
              actions.activity();
              state.lastDragWrist.copy(this.quaternion);
            }
          }
        }
        const pad = state.source.gamepad;
        if (!pad) return;
        const n = pad.axes.length;
        const deadzone = (value: number) => Math.abs(value) > .16 ? Math.sign(value) * (Math.abs(value) - .16) / .84 : 0;
        const x = deadzone(pad.axes[n - 2] ?? 0), y = deadzone(pad.axes[n - 1] ?? 0);
        if ((x || y) && !actions.busy()) {
          actions.activity();
          actions.rotate(x * dt * 116, -y * dt * 104);
        }
        for (const index of [4, 5]) {
          const pressed = !!pad.buttons[index]?.pressed;
          if (pressed && !state.buttons[index]) { if (index === 4) actions.magnify(); else actions.hint(); }
          state.buttons[index] = pressed;
        }
      };
    }
  }

  private wrist(state: XrHand, out: T.Quaternion) {
    if (state.source?.hand) {
      const wrist = state.hand.joints.wrist;
      if (wrist?.visible) return wrist.getWorldQuaternion(out);
    }
    return (state.grip.visible ? state.grip : state.target).getWorldQuaternion(out);
  }

  private fingertip(state: XrHand, out: T.Vector3) {
    const tip = state.hand.joints['index-finger-tip'];
    if (state.source?.hand && tip?.visible) {
      tip.getWorldPosition(out);
      return true;
    }
    if (!state.source?.hand && state.grip.visible) {
      state.tool.localToWorld(out.set(0, .071, 0));
      return true;
    }
    return false;
  }

  get touching() { return this.hands.some(state => state.selecting); }

  update(dt: number) {
    if (!this.actions.active()) return;
    this.actions.hover();
    this.hands.forEach(state => state.target.userData.updateRocketController(dt));
  }

  haptic(strength: number, duration: number, both = false) {
    const now = performance.now();
    if (!both && now - this.lastPulse < 38) return;
    this.lastPulse = now;
    const each = both ? this.hands : this.lastActuator ? [this.lastActuator] : this.hands;
    for (const controller of each) {
      const gamepad = controller.source?.gamepad as (Gamepad & {
        hapticActuators?: { pulse(value: number, ms: number): Promise<boolean> }[];
      }) | undefined;
      void gamepad?.hapticActuators?.[0]?.pulse(strength, duration).catch(() => {});
    }
  }
}

const identity = new T.Quaternion();
