import * as T from 'three';
import { loadContent } from './content/loader';
import type { ContentBundle } from './content/types';
import { GameAudio } from './audio/sfx';
import { HeroineCard3D } from './heroine/card';
import { VoiceDirector } from './heroine/director';
import { Hud, byId, button } from './hud';
import { DesktopInput } from './input/desktop';
import { Targets, type Contact } from './input/targets';
import { XrInput } from './input/xr';
import { angularError, clamp, PuzzleEngine, wrapAngle, type PuzzleEvent } from './puzzles/engine';
import { buildStations } from './puzzles/stations';
import { damp, deg, mesh } from './render/graphics';
import { Guidance } from './rocket/guidance';
import { RocketModel } from './rocket/model';
import { Hangar } from './world/hangar';
import { LaunchSequence, type LaunchEvent } from './world/launchSequence';
import { Sparks } from './world/particles';
import { SvgBackdrop } from './world/svgBackdrop';
import { Workbench } from './world/workbench';
import './style.css';

const deckEye = 1.61;
const defaultHeight = deckEye - .24;
const standardAnchor = new T.Vector3(0, defaultHeight, -.46);
const axisX = new T.Vector3(1, 0, 0), axisY = new T.Vector3(0, 1, 0);
type Mode = 'entry' | 'desktop' | 'xr';

class Game {
  readonly renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(54, 1, .025, 96);
  readonly audio = new GameAudio();
  readonly targets = new Targets();
  readonly engine: PuzzleEngine;
  readonly model: RocketModel;
  readonly hud: Hud;
  readonly heroine: HeroineCard3D;
  readonly director: VoiceDirector;
  readonly launch: LaunchSequence;
  readonly hangar: Hangar;
  readonly sparks: Sparks;
  readonly bench: Workbench;
  readonly stations;
  readonly guidance;
  readonly desktop;
  readonly xr;
  readonly svg;

  mode: Mode = 'entry';
  ready = false;
  private xrAligned = false;
  private xrPending = false;
  private anchor = standardAnchor.clone();
  private readonly viewer = new T.Vector3();
  private readonly cardPosition = new T.Vector3();
  private readonly cameraAim = new T.Vector3();
  private readonly heading = new T.Vector3();
  private readonly destination = new T.Quaternion();
  private readonly before = new T.Quaternion();
  private readonly rotation = new T.Quaternion();
  private readonly pitch = new T.Quaternion();
  private readonly homeOrientation = new T.Quaternion();
  private readonly inverse = new T.Quaternion();
  private readonly eyeDirection = new T.Vector3();
  private readonly pointerMark;
  private readonly markWorld = new T.Vector3();
  private readonly localViewer = new T.Vector3();

  private target?: Contact;
  private time = 0;
  private previousMs?: number;
  private sessionStarted = 0;
  private elapsedAtEnd?: number;
  private yawDeg = 0;
  private pitchDeg = 0;
  private magnifier = false;
  private zoom = 0;
  private zoomTarget = 0;
  private freeInspect = false;
  private cameraAscent = 0;
  private quiet = false;
  private desktopPixelRatio = 1;
  private qualityCounter = 0;
  private qualityFrames = 0;
  private checkQualityAt = 0;
  private hapticAt = 0;

  constructor(readonly content: ContentBundle) {
    this.hud = new Hud(content);
    const { renderer, scene } = this;
    const { environment, housing } = content;
    renderer.setClearColor(environment.lighting.skyTop);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(.87);
    renderer.xr.setFoveation(.55);
    renderer.domElement.setAttribute('aria-label', housing.displayName);
    byId('viewport').append(renderer.domElement);
    scene.fog = new T.Fog(environment.lighting.bayFogColor, environment.lighting.bayFogNear, environment.lighting.bayFogFar);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.engine = new PuzzleEngine(content.mission, event => this.onPuzzle(event));
    const bus = content.mission.steps.find(step => step.mechanicType === 'wire_patch');
    this.model = new RocketModel(housing, anisotropy, bus);
    this.stations = buildStations(this.model, this.engine, this.targets);
    this.guidance = new Guidance(this.model);
    this.sparks = new Sparks(housing.palette.glowWarning);
    this.launch = new LaunchSequence(environment.launchColumn, this.sparks, event => this.onLaunch(event), count => {
      this.audio.countdown(count);
      this.xr.haptic(.22, 60, true);
    });
    this.hangar = new Hangar(environment, this.launch.x, this.launch.z);
    this.svg = new SvgBackdrop(environment, content.housingBase, anisotropy);
    this.heroine = new HeroineCard3D(content);
    this.director = new VoiceDirector(content, this.audio, line => { this.heroine.setLine(line); this.hud.line(line); });

    this.bench = new Workbench(housing, environment, this.targets, {
      hint: this.requestHint, zoom: this.toggleMagnifier, reset: this.resetPose, guard: () => this.engine.toggleGuard(),
      launch: this.triggerLaunch, replay: this.replay, inspect: this.inspect,
    }, -this.model.length * .5 - .042);
    this.model.root.position.copy(this.anchor);
    this.bench.group.position.copy(this.anchor);
    scene.add(this.model.root, this.bench.group, this.hangar.group, this.svg.group, this.launch.view, this.launch.trajectory,
      this.heroine.group, this.sparks.view);

    const markMat = new T.MeshBasicMaterial({ color: housing.palette.glowActive, transparent: true, opacity: .80,
      depthWrite: false, side: T.DoubleSide });
    this.pointerMark = mesh(scene, new T.RingGeometry(.83, 1, 22), markMat);
    this.pointerMark.visible = false;
    this.pointerMark.renderOrder = 5;

    this.desktop = new DesktopInput(renderer.domElement, this.camera, this.targets, {
      enabled: () => this.mode === 'desktop' && !(this.launch.complete && !this.freeInspect), step: () => this.targetStep(),
      activity: this.activity,
      rotate: this.rotate, zoom: delta => {
        if (!this.launch.active) this.zoomTarget = clamp(this.zoomTarget + delta * .059, -.205, .95);
      },
      magnify: this.toggleMagnifier, hint: this.requestHint, reset: this.resetPose, mute: this.toggleMute,
      launch: this.triggerLaunch, arcball: this.arcball, hover: this.hover,
    });
    this.xr = new XrInput(renderer, scene, this.targets, housing.palette, {
      active: () => this.mode === 'xr', busy: () => this.launch.active, step: () => this.targetStep(),
      activity: this.activity, grab: this.arcball, rotate: this.rotate,
      magnify: this.toggleMagnifier, hint: this.requestHint, hover: this.hover,
    });
    this.bind();
    this.resize();
    renderer.setAnimationLoop(this.frame);
    void this.heroine.ready.then(() => { this.director.actor = this.heroine.actor; });
    void Promise.all([this.heroine.ready, this.svg.ready]).then(() => {
      this.ready = true;
      this.hud.loaded();
    });
  }

  private bind() {
    button('play-desktop').addEventListener('click', this.startDesktop);
    button('play-xr').addEventListener('click', () => { void this.startXR(); });
    button('resume-xr').addEventListener('click', () => { void this.startXR(); });
    button('hint').addEventListener('click', this.requestHint);
    button('magnify').addEventListener('click', this.toggleMagnifier);
    button('reset').addEventListener('click', this.resetPose);
    button('mute').addEventListener('click', this.toggleMute);
    button('replay').addEventListener('click', this.replay);
    button('inspect').addEventListener('click', this.inspect);
    window.addEventListener('resize', this.resize);
    this.hud.scale(false);
    const xr = navigator.xr;
    if (xr) {
      const update = () => void xr.isSessionSupported('immersive-vr').then(result => this.hud.support(result), () => this.hud.support(false));
      xr.addEventListener('devicechange', update);
      update();
    }
    this.renderer.xr.addEventListener('sessionend', () => {
      this.mode = 'desktop';
      this.xrAligned = false;
      this.anchor.copy(standardAnchor);
      this.homeOrientation.identity();
      this.bench.group.rotation.set(0, 0, 0);
      this.resetPose();
      this.hud.mode(this.mode);
      this.resize();
    });
  }

  private resize = () => {
    if (this.renderer.xr.isPresenting) return;
    this.desktopPixelRatio = Math.min(window.devicePixelRatio, 1.65);
    const view = byId('viewport');
    this.camera.aspect = view.clientWidth / Math.max(1, view.clientHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.desktopPixelRatio);
    this.renderer.setSize(view.clientWidth, view.clientHeight, false);
  };

  private targetStep() { return this.engine.launched ? -1 : this.engine.index; }

  private activity = () => {
    this.audio.unlock();
    this.director.monitor.activity(this.time);
  };
  private hover = (contact?: Contact) => {
    this.target = contact;
    this.renderer.domElement.dataset.target = String(Boolean(contact));
  };
  private rotate = (yaw: number, pitch: number) => {
    if (this.launch.active) return;
    this.rotation.setFromAxisAngle(axisY, -deg(yaw));
    this.pitch.setFromAxisAngle(axisX, deg(pitch));
    this.destination.premultiply(this.rotation.multiply(this.pitch)).normalize();
  };
  private arcball = (delta: T.Quaternion) => {
    if (!this.launch.active) this.destination.premultiply(delta).normalize();
  };
  private setRotation = (yaw: number, pitch: number) => {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || this.launch.active) return;
    this.rotation.setFromAxisAngle(axisY, -deg(yaw));
    this.pitch.setFromAxisAngle(axisX, deg(pitch));
    this.destination.copy(this.homeOrientation).multiply(this.pitch).multiply(this.rotation);
    this.model.root.quaternion.copy(this.destination);
  };

  private resetPose = () => {
    this.activity();
    this.setRotation(0, 0);
    this.zoomTarget = 0;
  };
  private toggleMute = () => {
    this.activity();
    this.hud.mute(this.audio.mute());
  };
  private openMission() {
    this.sessionStarted = performance.now() / 1000;
    this.director.reset(this.time);
    this.director.emit('session_start', this.time, 5, true);
    this.director.emit('session_start_follow', this.time, 15);
    if (this.engine.step) this.director.emit(this.engine.step.startEvent, this.time, 18);
  }

  startDesktop = () => {
    if (this.mode !== 'entry' || !this.ready) return;
    this.activity();
    this.mode = 'desktop';
    this.hud.mode(this.mode);
    this.openMission();
  };
  private async startXR() {
    if (!navigator.xr || this.xrPending || this.mode === 'xr' || !this.ready) return;
    this.activity();
    this.xrPending = true;
    let session: XRSession | undefined;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
      });
      await this.renderer.xr.setSession(session);
      if (this.mode === 'entry') this.openMission();
      this.mode = 'xr';
      this.xrAligned = false;
      this.hud.mode(this.mode);
      this.director.emit('vr_entered', this.time, 15);
    } catch {
      if (session) void session.end().catch(() => {});
      this.hud.status('헤드셋에 연결할 수 없습니다. 헤드셋 브라우저에서 다시 시도해 주세요.');
      if (this.mode === 'desktop') button('resume-xr').textContent = 'VR 다시 연결';
    } finally {
      this.xrPending = false;
    }
  }

  requestHint = () => {
    this.activity();
    const step = this.engine.step;
    if (step && !this.engine.launched) {
      this.director.emit(step.hintEvent, this.time, 10, true);
    }
  };
  toggleMagnifier = () => {
    if (this.launch.active) return;
    this.activity();
    this.magnifier = !this.magnifier;
    this.hud.scale(this.magnifier);
    this.director.emit('magnifier_toggle', this.time);
    this.audio.hit('ratchet');
    this.xr.haptic(.18, 36);
  };

  private onPuzzle(event: PuzzleEvent) {
    if (this.quiet) return;
    if (event.type === 'feedback') {
      this.audio.hit(event.sound);
      this.xr?.haptic(event.sound === 'spark' ? .34 : event.sound === 'weld' ? .25 : .18, event.sound === 'weld' ? 61 : 31);
      if (event.sound === 'spark' || event.sound === 'weld') {
        const station = this.stations[this.engine.index];
        const at = station?.sparkPoint?.(event.index ?? 0) ?? this.model.root.position;
        this.sparks.emit(at, event.sound === 'weld' ? 11 : 19, event.sound === 'weld' ? .15 : .25);
      }
      return;
    }
    if (event.type === 'step') {
      this.director.monitor.success();
      this.director.router.discard(event.completed.startEvent);
      this.director.router.discard(event.completed.hintEvent);
      if (!this.engine.launched) {
        this.director.emit(event.completed.completeEvent ?? 'step_complete', this.time, 5);
        if (event.next) this.director.emit(event.next.startEvent, this.time, 16);
      }
    }
    if (event.type === 'substep') {
      this.director.monitor.success();
      this.director.emit('repair_substep', this.time, 3.5);
    }
    if (event.type === 'mistake') {
      this.director.monitor.mistake();
      this.director.emit('repair_mistake', this.time, 5);
    }
    if (event.type === 'armed') this.director.emit('launch_armed', this.time, 9);
  }

  triggerLaunch = () => {
    this.activity();
    if (!this.engine.launch()) return false;
    this.director.router.clear();
    this.launch.begin(this.time, this.model.root, this.hangar, this.model.length);
    return true;
  };

  private onLaunch(event: LaunchEvent) {
    if (event === 'launch_liftoff') {
      this.audio.hit('ignition');
      this.xr.haptic(.74, 730, true);
      this.hapticAt = this.time + .65;
    }
    if (event === 'ending_complete') this.elapsedAtEnd = performance.now() / 1000 - this.sessionStarted;
    this.director.router.clear();
    this.director.emit(event, this.time, 12, true);
  }
  private replay = () => {
    this.launch.reset();
    this.sparks.reset();
    this.engine.reset();
    this.model.root.visible = true;
    this.model.root.position.copy(this.anchor);
    this.model.root.scale.setScalar(1);
    this.magnifier = this.freeInspect = false;
    this.elapsedAtEnd = undefined;
    this.cameraAscent = 0;
    this.hud.scale(false);
    this.hud.ending(false, '');
    this.resetPose();
    this.openMission();
  };
  private inspect = () => {
    if (!this.launch.complete) return;
    this.launch.reset();
    this.sparks.reset();
    this.freeInspect = true;
    this.model.root.visible = true;
    this.model.root.position.copy(this.anchor);
    this.model.root.scale.setScalar(1);
    this.magnifier = false;
    this.hud.scale(false);
    this.resetPose();
  };

  private get elapsed() {
    const seconds = this.mode === 'entry' ? 0 : Math.max(0, Math.floor(this.elapsedAtEnd ?? performance.now() / 1000 - this.sessionStarted));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  private get sealed() {
    const state = this.engine.states.at(-1);
    return state?.kind === 'nosecone_arm' && state.sealed;
  }

  private cameraFrame(dt: number, xrFrame?: XRFrame) {
    if (this.mode === 'xr') {
      const space = this.renderer.xr.getReferenceSpace();
      const pose = xrFrame && space ? xrFrame.getViewerPose(space) : undefined;
      if (!pose) return;
      const { position, orientation } = pose.transform;
      this.viewer.set(position.x, position.y, position.z);
      if (!this.xrAligned) {
        this.rotation.set(orientation.x, orientation.y, orientation.z, orientation.w);
        this.heading.set(0, 0, -1).applyQuaternion(this.rotation);
        this.heading.y = 0;
        this.heading.normalize();
        if (this.heading.lengthSq() < .01) this.heading.set(0, 0, -1);
        this.anchor.copy(this.viewer).addScaledVector(this.heading, .46);
        this.anchor.y -= .24;
        const facing = Math.atan2(-this.heading.x, -this.heading.z);
        this.homeOrientation.setFromAxisAngle(axisY, facing);
        this.bench.group.rotation.y = facing;
        if (!this.launch.active) this.setRotation(0, 0);
        this.xrAligned = true;
      }
      return;
    }
    this.zoom = damp(this.zoom, this.zoomTarget, 7.6, dt);
    const narrow = clamp((1.35 - this.camera.aspect) * 1.19, 0, 1.10);
    this.camera.position.set(.021, deckEye + narrow * .18 - this.zoom * .13, .163 + this.zoom + narrow);
    const launchFocus = this.launch.active && this.launch.ascent > 0 && !this.launch.complete ?
      Math.min(.98, .21 + this.launch.ascent * .24) : 0;
    this.cameraAscent = damp(this.cameraAscent, launchFocus, launchFocus ? 2.5 : 1.65, dt);
    const intro = this.mode === 'entry' ? -.235 + Math.min(.16, narrow * .17) : -.045 - narrow * .043;
    const framing = this.magnifier && !this.launch.active ? .045 : 0;
    const dockFocus = this.launch.active && this.launch.ascent <= 0 ? .145 : 0;
    this.cameraAim.set(intro + dockFocus + this.cameraAscent * .34, defaultHeight + .085 + framing + this.cameraAscent * 1.70,
      -.497 - this.cameraAscent * .72);
    this.camera.lookAt(this.cameraAim);
    this.camera.updateMatrixWorld();
    this.viewer.copy(this.camera.position);
  }

  private updateMark() {
    this.pointerMark.visible = Boolean(this.target && this.target.kind !== 'weld' && !this.launch.active);
    if (!this.target || !this.pointerMark.visible) return;
    this.target.object.getWorldPosition(this.markWorld);
    this.pointerMark.position.copy(this.markWorld).lerp(this.viewer, .009);
    const edge = Math.min(.018, Math.max(.0022, this.target.object.matrixWorld.getMaxScaleOnAxis() * .60));
    this.pointerMark.scale.setScalar(edge);
    this.pointerMark.lookAt(this.viewer);
  }

  private adapt(dt: number) {
    if (this.mode === 'xr' || this.time < 3 || this.launch.active) return;
    this.qualityCounter += dt;
    this.qualityFrames++;
    if (this.time < this.checkQualityAt || this.qualityFrames < 100) return;
    const average = this.qualityCounter / this.qualityFrames;
    this.qualityCounter = this.qualityFrames = 0;
    this.checkQualityAt = this.time + 4;
    const current = this.renderer.getPixelRatio();
    const next = average > .027 ? Math.max(.8, current - .18) : average < .017 ? Math.min(this.desktopPixelRatio, current + .08) : current;
    if (next !== current) this.renderer.setPixelRatio(next);
  }

  private frame = (ms: number, xrFrame?: XRFrame) => {
    const delta = this.previousMs === undefined ? .016 : clamp((ms - this.previousMs) / 1000, .001, .25);
    const dt = Math.min(.055, delta);
    this.previousMs = ms;
    this.time += delta;
    this.director.setClock(this.time);
    this.cameraFrame(dt, xrFrame);
    this.scene.updateMatrixWorld(true);
    this.desktop.update(dt);
    this.xr.update(dt);
    this.engine.update(dt);
    this.bench.group.position.copy(this.anchor);

    const { root } = this.model;
    this.before.copy(root.quaternion);
    if (this.launch.active) this.launch.update(this.time, dt);
    else {
      const scale = damp(root.scale.x, this.magnifier ? this.content.housing.dimensions.magnifierScale : 1, 9.5, dt);
      root.scale.setScalar(scale);
      root.position.copy(this.anchor);
      root.position.y += (scale - 1) * this.model.length * .5;
      root.quaternion.slerp(this.destination, 1 - Math.exp(-19 * dt));
    }
    if (this.launch.ascent > 0 && this.launch.ascent < 2.8 && this.time >= this.hapticAt) {
      this.xr.haptic(.24, 160, true);
      this.hapticAt = this.time + .24;
    }

    this.inverse.copy(root.quaternion).invert();
    this.eyeDirection.set(0, 0, 1).applyQuaternion(this.homeOrientation).applyQuaternion(this.inverse);
    this.yawDeg = wrapAngle(T.MathUtils.radToDeg(Math.atan2(this.eyeDirection.x, this.eyeDirection.z)));
    this.pitchDeg = T.MathUtils.radToDeg(Math.asin(clamp(this.eyeDirection.y, -1, 1)));
    const speed = T.MathUtils.radToDeg(root.quaternion.angleTo(this.before)) / dt;
    const step = this.engine.step;
    const state = this.engine.state;
    if (this.mode !== 'entry' && !this.engine.launched) {
      this.director.monitor.update(this.time, dt, this.engine.index, this.yawDeg, this.pitchDeg, speed);
    }
    const interacting = this.desktop.touching || this.xr.touching;
    const proximity = step?.mechanicType === 'vernier_ring' && state.kind === 'vernier_ring' &&
      (interacting || angularError(this.yawDeg, this.content.housing.mounts[step.mountId].angleDeg) < 50);
    this.audio.vernier(proximity ? 1 - angularError(state.angle, step.params.targetDeg) / 180 : null);
    this.director.update(this.time);
    this.localViewer.copy(this.viewer);
    root.worldToLocal(this.localViewer).normalize();
    this.stations.forEach(station => station.update(dt, this.time, this.localViewer));
    const mount = step && !this.engine.launched && !this.sealed ? this.content.housing.mounts[step.mountId] : undefined;
    root.updateMatrixWorld(true);
    const fraction = step?.mechanicType === 'seam_weld' && state.kind === 'seam_weld' ? state.welded / Math.max(1, step.params.checkpointCount - 1) : 0;
    this.guidance.update(dt, this.mode === 'entry' ? undefined : mount, this.viewer, this.time, fraction);
    this.cardPosition.copy(this.anchor);
    if (this.mode === 'desktop') this.cardPosition.y -= .045;
    this.heroine.update(this.time, dt, this.cardPosition, root.position, this.viewer, this.yawDeg, this.pitchDeg, interacting, this.homeOrientation);
    this.heroine.group.visible = this.mode !== 'entry';
    this.heroine.showBubble(this.mode === 'xr');
    this.launch.trajectory.position.copy(this.heroine.group.position);
    this.heading.set(.23, -.16, .025).applyQuaternion(this.homeOrientation);
    this.launch.trajectory.position.add(this.heading);
    this.launch.trajectory.quaternion.copy(this.heroine.group.quaternion);
    this.svg.update(dt);
    this.sparks.update(dt);
    this.updateMark();
    const ended = this.launch.complete && !this.freeInspect;
    const elapsed = this.elapsed;
    this.bench.update(dt, step, this.engine.index, this.engine.steps.length, {
      zoom: this.magnifier, sealed: this.sealed && !this.engine.launched, armed: this.engine.armed && !this.engine.launched,
      guard: this.engine.guardOpen, launched: this.launch.active, ended, elapsed, count: this.launch.countdown,
    });
    this.hud.step(step, this.engine.index, this.engine.armed && !this.engine.launched, this.sealed, this.launch.active, this.freeInspect);
    this.hud.launchStatus(this.launch.active && !ended, this.launch.countdown, this.launch.ascent);
    this.hud.ending(ended && this.mode === 'desktop', ended ? elapsed : '');
    this.adapt(dt);
    this.renderer.render(this.scene, this.camera);
  };

  hooks() {
    const game = this;
    return {
      get ready() { return game.ready; },
      get mode() { return game.mode; },
      get stepIndex() { return game.engine.index; },
      get stepId() { return game.engine.step?.id ?? null; },
      get totalSteps() { return game.engine.steps.length; },
      get rocketAngles() { return { yawDeg: game.yawDeg, pitchDeg: game.pitchDeg }; },
      get magnifier() { return game.magnifier; },
      get armed() { return game.engine.armed; },
      get launched() { return game.engine.launched; },
      get endingComplete() { return game.elapsedAtEnd !== undefined; },
      get activeDialogue() { return game.director.active ?? null; },
      get heroineId() { return game.content.heroine.id; },
      get housingId() { return game.content.housing.id; },
      get drawCalls() { return game.renderer.info.render.calls; },
      get triangles() { return game.renderer.info.render.triangles; },
      get svgLoadedCount() { return game.svg.loadedCount; },
      startDesktop: game.startDesktop,
      requestHint: game.requestHint,
      toggleMagnifier: game.toggleMagnifier,
      setRocketRotation: game.setRotation,
      solveCurrentStep: () => game.engine.solveCurrentStep(),
      jumpToLaunchReady: () => {
        game.startDesktop();
        game.quiet = true;
        for (let i = 0; i <= game.engine.steps.length && !game.engine.armed; i++) {
          if (!game.engine.solveCurrentStep()) break;
        }
        game.quiet = false;
        return game.engine.armed;
      },
      triggerLaunch: game.triggerLaunch,
    };
  }
}

declare global {
  interface Window { __TESTROCKET__: ReturnType<Game['hooks']> | { ready: false } }
}
window.__TESTROCKET__ = { ready: false };

async function boot() {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const content = await loadContent(base, new URLSearchParams(location.search));
  const game = new Game(content);
  window.__TESTROCKET__ = game.hooks();
}
void boot().catch(error => {
  byId('entry-status').textContent = '격납고를 열 수 없습니다. ' + (error instanceof Error ? error.message : String(error));
  console.error(error);
});
