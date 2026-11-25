import * as T from 'three';
import type { Environment } from '../content/types';
import { box, cylinder, damp, display, light, mesh, toon } from '../render/graphics';
import { clamp } from '../puzzles/engine';
import type { Hangar } from './hangar';
import type { Sparks } from './particles';

export type LaunchEvent = 'launch_countdown' | 'launch_liftoff' | 'launch_orbit' | 'ending_complete';
const settleSec = 1.35;
const countdownSec = 3;

export class LaunchSequence {
  readonly view = new T.Group();
  readonly trajectory = new T.Group();
  readonly x = .08;
  readonly z = -1.26;
  readonly launchDeckY = 1.24;
  readonly landing = new T.Vector3(this.x, this.launchDeckY, this.z);
  readonly countdownScreen;
  readonly beacon;
  private readonly clamps: T.Group[] = [];
  private readonly lights: T.Mesh[] = [];
  private readonly flame = new T.Group();
  private readonly smoke: T.Mesh[] = [];
  private readonly trackMarker;
  private readonly lit;
  private readonly dim;
  private readonly startPosition = new T.Vector3();
  private readonly startRotation = new T.Quaternion();
  private readonly upright = new T.Quaternion();
  private readonly burstPoint = new T.Vector3();
  private readonly _end: number;
  private rocket?: T.Group;
  private hangar?: Hangar;
  private start = -Infinity;
  private startScale = 1;
  private phase = 0;
  private burstAt = 0;
  private launchAltitude = 0;
  private countDrawn = -1;
  countdown = 0;
  complete = false;
  get active() { return this.rocket !== undefined; }
  get ascent() { return this.launchAltitude; }

  constructor(private readonly settings: Environment['launchColumn'], private readonly sparks: Sparks,
    private readonly event: (event: LaunchEvent) => void, private readonly tick: (number: number) => void) {
    const c = settings;
    this._end = settleSec + c.roofIrisOpenSec + countdownSec + c.ascentDurationSec;
    const base = toon(c.pedestalColor), frame = toon(c.gantryColor), orange = toon(c.gantryAccent);
    this.dim = light(c.pedestalColor);
    this.lit = light(c.beamColor);
    const stand = new T.Group();
    stand.position.copy(this.landing);
    this.view.add(stand);
    cylinder(stand, base, .29, .35, .11, 0, .055 - this.launchDeckY, 0, 8);
    cylinder(stand, base, .125, .225, this.launchDeckY - .13, 0, -(this.launchDeckY - .13) / 2 - .041, 0, 8);
    cylinder(stand, frame, .235, .18, .073, 0, -.081, 0, 8);
    cylinder(stand, base, .174, .18, .04, 0, -.026, 0, 24);
    cylinder(stand, orange, .137, .137, .022, 0, -.005, 0, 12);
    cylinder(stand, base, .104, .104, .025, 0, .004, 0, 20);
    mesh(stand, new T.TorusGeometry(.15, .004, 6, 32), this.lit, 0, .005).rotation.x = Math.PI / 2;
    const panel = new T.Group();
    panel.position.set(0, -.205, .144);
    panel.rotation.x = -.14;
    stand.add(panel);
    box(panel, frame, .245, .158, .047);
    box(panel, base, .218, .131, .014, 0, 0, .028);
    this.countdownScreen = display(panel, .168, .088, 512, 256, 0, .009, .038);
    for (let i = 0; i < 3; i++) {
      this.lights.push(box(panel, this.dim, .032, .008, .012, (i - 1) * .055, -.050, .036));
    }
    for (let i = 0; i < 3; i++) {
      const azimuth = i * Math.PI * 2 / 3;
      const arm = new T.Group();
      arm.rotation.y = azimuth;
      stand.add(arm);
      box(arm, frame, .026, .084, .024, 0, .030, .062);
      const clamp = new T.Group();
      clamp.position.set(0, .061, .053);
      arm.add(clamp);
      box(clamp, orange, .029, .018, .063, 0, 0, -.011);
      box(clamp, base, .024, .014, .023, 0, .005, -.045);
      this.clamps.push(clamp);
    }

    this.view.add(this.flame);
    const outer = mesh(this.flame, new T.ConeGeometry(.058, .68, 10), light(c.exhaustOuterColor), 0, -.34);
    outer.rotation.z = Math.PI;
    const core = mesh(this.flame, new T.ConeGeometry(.028, .52, 8), light(c.exhaustCoreColor), 0, -.25);
    core.rotation.z = Math.PI;
    const smokeGeom = new T.TorusGeometry(.11, .036, 6, 12);
    const smokeMat = new T.MeshBasicMaterial({ color: c.exhaustCoreColor, transparent: true, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      this.smoke.push(mesh(this.view, smokeGeom, smokeMat.clone()));
      this.smoke[i].rotation.x = -Math.PI / 2;
    }

    const hologram = new T.MeshBasicMaterial({ color: c.beamColor, wireframe: true, opacity: .28, transparent: true, depthWrite: false });
    mesh(this.trajectory, new T.ConeGeometry(.069, .186, 12, 4, true), hologram, 0, .095);
    const orbit = mesh(this.trajectory, new T.TorusGeometry(.054, .00125, 5, 40), this.lit, 0, .152);
    orbit.rotation.x = 1.14;
    orbit.scale.y = .65;
    this.trackMarker = mesh(this.trajectory, new T.OctahedronGeometry(.008), light(c.exhaustCoreColor));
    this.beacon = mesh(this.trajectory, new T.OctahedronGeometry(.012), this.lit, -.041, .155, 0);
    this.reset();
  }

  begin(time: number, rocket: T.Group, hangar: Hangar, length: number) {
    if (this.active) return;
    this.start = time;
    this.rocket = rocket;
    this.hangar = hangar;
    this.startPosition.copy(rocket.position);
    this.startRotation.copy(rocket.quaternion);
    this.startScale = rocket.scale.x;
    this.landing.y = this.launchDeckY + length * .5 + .012;
    this.drawCount(0);
  }

  private drawCount(count: number) {
    if (this.countDrawn === count) return;
    this.countDrawn = count;
    const { ctx, canvas } = this.countdownScreen;
    ctx.fillStyle = this.settings.pedestalColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = this.settings.beamColor;
    ctx.font = '700 ' + (count > 0 ? 172 : 65) + 'px system-ui,sans-serif';
    ctx.fillText(count > 0 ? String(count) : count === -1 ? '점화' : '대기', 256, count > 0 ? 187 : 151);
    this.countdownScreen.refresh();
    this.lights.forEach((lamp, i) => { lamp.material = i < count || count === -1 ? this.lit : this.dim; });
  }

  update(time: number, dt: number) {
    const craft = this.rocket;
    if (!craft || !this.hangar) return;
    const t = time - this.start;
    const doorEnd = settleSec + this.settings.roofIrisOpenSec;
    const liftoffTime = doorEnd + countdownSec;
    const ascending = Math.max(0, t - liftoffTime);
    const progress = clamp(ascending / this.settings.ascentDurationSec);
    const dock = T.MathUtils.smoothstep(t / settleSec, 0, 1);
    this.hangar.setIris(clamp((t - settleSec) / this.settings.roofIrisOpenSec));
    this.clamps.forEach(clampMesh => {
      clampMesh.rotation.x = damp(clampMesh.rotation.x, this.phase >= 2 || dock < .83 ? -.8 : 0, 13, dt);
    });
    craft.position.lerpVectors(this.startPosition, this.landing, dock);
    craft.position.y += Math.sin(dock * Math.PI) * .13;
    craft.quaternion.slerpQuaternions(this.startRotation, this.upright, dock);
    craft.scale.setScalar(T.MathUtils.lerp(this.startScale, 1, dock));
    if (t >= doorEnd && t < liftoffTime) {
      if (this.phase === 0) { this.phase = 1; this.event('launch_countdown'); }
      const number = Math.ceil(liftoffTime - t);
      if (number !== this.countdown) this.tick(number);
      this.countdown = number;
      this.drawCount(number);
    }
    if (t >= liftoffTime) {
      if (this.phase < 2) {
        this.phase = 2;
        this.countdown = 0;
        this.drawCount(-1);
        this.event('launch_liftoff');
        this.trajectory.visible = true;
      }
      this.launchAltitude = ascending * .58 + 30 * progress ** 2.25;
      craft.position.y += this.launchAltitude;
      craft.visible = progress < .94;
      this.flame.visible = progress < .84;
      this.flame.position.set(this.x, craft.position.y - .063, this.z);
      const ignition = Math.min(1, .53 + ascending * 2.1);
      this.flame.scale.set((1 + Math.sin(time * 69) * .19) * ignition, (1 + Math.sin(time * 39) * .24) * ignition, ignition);
      if (ascending < 2.7 && time >= this.burstAt) {
        this.burstPoint.set(this.x, this.launchDeckY + Math.min(3, this.launchAltitude), this.z);
        this.sparks.emit(this.burstPoint, 13, 1.33);
        this.burstAt = time + .074;
      }
      this.smoke.forEach((puff, i) => {
        const age = ascending - i * .124;
        puff.visible = age >= 0 && age < 4.3;
        if (!puff.visible) return;
        puff.position.set(this.x + Math.sin(i * 2) * age * .18, this.launchDeckY - .08 + age * .22 + i * .014, this.z + Math.cos(i) * age * .14);
        puff.scale.setScalar(.75 + age * .97);
        (puff.material as T.MeshBasicMaterial).opacity = .64 * (1 - age / 4.3);
      });
      this.trackMarker.position.set(progress * .037, progress * .155, 0);
      this.beacon.visible = progress > .86;
      this.beacon.scale.setScalar(.75 + Math.sin(time * 12) * .31);
      if (progress >= .88 && this.phase === 2) {
        this.phase = 3;
        this.event('launch_orbit');
      }
    }
    if (!this.complete && t >= this._end + 2.6) {
      this.complete = true;
      this.event('ending_complete');
    }
  }

  reset() {
    this.rocket = undefined;
    this.phase = this.countdown = this.burstAt = this.launchAltitude = 0;
    this.complete = false;
    this.hangar?.setIris(0);
    this.clamps.forEach(arm => { arm.rotation.x = -.8; });
    this.flame.visible = this.trajectory.visible = false;
    this.smoke.forEach(puff => { puff.visible = false; });
    this.drawCount(0);
  }
}
