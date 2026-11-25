import * as T from 'three';
import { RigAnimator } from '@rig2d/engine';
import { Portrait } from '@rig2d/engine/three';
import type { ContentBundle, DialogueLine } from '../content/types';
import { box, chamfer, damp, display, light } from '../render/graphics';

function wrap(ctx: CanvasRenderingContext2D, content: string, max: number) {
  const words = content.split(/(?<=\s)/);
  const rows: string[] = [];
  let row = '';
  for (const word of words) {
    if (ctx.measureText(row + word).width <= max) row += word;
    else {
      if (row) rows.push(row.trim());
      row = '';
      for (const ch of word) {
        if (ctx.measureText(row + ch).width > max) { rows.push(row.trim()); row = ''; }
        row += ch;
      }
    }
  }
  if (row) rows.push(row.trim());
  return rows;
}

export class HeroineCard3D {
  readonly group = new T.Group();
  readonly view: Portrait;
  readonly ready: Promise<void>;
  actor?: RigAnimator;
  private readonly screen;
  private readonly bubble;
  private readonly at = new T.Vector3();
  private readonly look = new T.Object3D();
  private readonly aim = new T.Vector3();
  private readonly relative = new T.Vector3();
  private readonly neutral = new T.Quaternion();
  private readonly offset = new T.Vector3();
  private readonly positionedOffset = new T.Vector3();
  private reveal = 0;
  private lineVisible = false;
  private readonly portraitWidth: number;
  private readonly portraitHeight: number;

  constructor(private readonly bundle: ContentBundle) {
    const { heroine } = bundle;
    const { theme: p, cardBehavior: b } = heroine;
    const w = b.widthMeters, h = b.heightMeters;
    this.offset.set(...b.offsetFromRocket);
    this.portraitHeight = h * .835;
    this.portraitWidth = w * .942;
    const border = new T.MeshBasicMaterial({ color: p.cardBorder, opacity: .66, transparent: true, depthWrite: false });
    const frame = chamfer(this.group, border, w, h, .004, w * .045, -.009);
    frame.renderOrder = 1;
    const bg = new T.MeshBasicMaterial({ color: p.cardBg });
    chamfer(this.group, bg, w * .982, h * .986, .006, w * .035, -.009);
    const backSurface = display(this.group, w * .963, h * .967, 768, 1024, 0, 0, -.0028);
    const ctx = backSurface.ctx;
    const gradient = ctx.createRadialGradient(415, 460, 35, 415, 460, 535);
    gradient.addColorStop(0, p.accent + '60');
    gradient.addColorStop(.62, p.accent + '25');
    gradient.addColorStop(1, p.cardBg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 768, 1024);
    ctx.strokeStyle = p.accent + '30';
    ctx.lineWidth = 2;
    for (const r of [175, 248, 324]) {
      ctx.beginPath(); ctx.arc(400, 460, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = p.accent + '2b';
    for (let y = 80; y < 830; y += 30) {
      ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(748, y); ctx.stroke();
    }
    backSurface.refresh();
    for (const side of [-1, 1]) {
      box(this.group, light(p.cardBorder), w * .154, .004, .004, side * w * .397, h * .488, .001);
      box(this.group, light(p.cardBorder), .004, h * .098, .004, side * w * .491, h * .431, .001);
    }
    this.view = new Portrait(new URL(heroine.rig.rigJson, bundle.heroineBase));
    this.view.mesh.position.set(0, h * .055, .005);
    this.view.mesh.scale.setScalar(this.portraitHeight);
    this.view.mesh.renderOrder = 2;
    this.view.mesh.name = 'assistant:portrait';
    this.group.add(this.view.mesh);
    this.ready = this.view.ready.then(() => {
      if (this.view.status !== 'ready' || !this.view.definition) return;
      this.actor = new RigAnimator(this.view.definition.animation);
      this.view.setBrightness(heroine.rig.framing.brightness);
      this.applyFraming();
    });
    this.screen = display(this.group, w * .972, h * .134, 960, 168, 0, -h * .426, .015);
    this.screen.mesh.renderOrder = 3;
    this.bubble = display(this.group, w * 1.06, h * .28, 960, 320, 0, -h * .655, .022);
    this.bubble.mesh.renderOrder = 4;
    this.setLine();
  }

  private modeLabel(mode: string) {
    return this.bundle.heroine.modeLabels?.[mode] ?? (mode === 'gemple38' ? '젬플3.8' :
      mode.charAt(0).toUpperCase() + mode.slice(1));
  }

  setLine(line?: DialogueLine) {
    const { theme, displayName } = this.bundle.heroine;
    const mode = line?.mode ? this.modeLabel(line.mode) : '';
    const accent = line?.event === this.bundle.events.easterEggs.gemple38Event ? theme.secondary : theme.accent;
    const { ctx } = this.screen;
    ctx.fillStyle = theme.cardBg;
    ctx.fillRect(0, 0, 960, 168);
    ctx.fillStyle = accent;
    ctx.fillRect(27, 32, 12, 105);
    ctx.font = '750 82px system-ui,sans-serif';
    ctx.fillStyle = theme.textPrimary;
    ctx.textAlign = 'left';
    ctx.fillText(displayName, 68, 112, mode ? 637 : 814);
    if (mode) {
      ctx.font = '700 48px system-ui,sans-serif';
      const width = Math.min(220, ctx.measureText(mode).width + 58);
      ctx.fillStyle = accent;
      ctx.fillRect(921 - width, 50, width, 68);
      ctx.fillStyle = theme.cardBg;
      ctx.textAlign = 'center';
      ctx.fillText(mode, 921 - width / 2, 101, width - 24);
    }
    this.screen.refresh();
    const bubble = this.bubble;
    this.lineVisible = Boolean(line);
    if (!line) return;
    const g = bubble.ctx;
    g.clearRect(0, 0, 960, 320);
    let font = 54;
    g.font = '600 ' + font + 'px system-ui,sans-serif';
    let rows = wrap(g, line.text, 850);
    while (rows.length > 4 && font > 34) {
      font -= 4;
      g.font = '600 ' + font + 'px system-ui,sans-serif';
      rows = wrap(g, line.text, 850);
    }
    const height = Math.min(314, 35 + rows.length * (font + 13));
    g.fillStyle = theme.cardBg;
    g.beginPath();
    g.roundRect(4, 5, 952, height, 25);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = accent;
    g.stroke();
    g.fillStyle = theme.textPrimary;
    rows.slice(0, 5).forEach((row, index) => g.fillText(row, 54, 24 + font + index * (font + 13), 852));
    bubble.refresh();
  }
  showBubble(value: boolean) { this.bubble.mesh.visible = value && this.lineVisible; }

  private applyFraming() {
    const f = this.bundle.heroine.rig.framing;
    this.view.setFraming(f.scale - this.reveal * .40, f.y + this.reveal * .19,
      this.portraitWidth / (2 * this.portraitHeight), f.vignette);
  }
  update(time: number, dt: number, base: T.Vector3, rocket: T.Vector3, viewer: T.Vector3, yaw: number, pitch: number, touching: boolean,
    homeOrientation: T.Quaternion) {
    const b = this.bundle.heroine.cardBehavior;
    this.at.copy(base).add(this.positionedOffset.copy(this.offset).applyQuaternion(homeOrientation));
    this.at.y += Math.sin(time * b.bobHz * Math.PI * 2) * b.bobAmplitude;
    this.group.position.copy(this.at);
    this.look.position.copy(this.at);
    this.look.lookAt(viewer);
    this.group.quaternion.slerpQuaternions(this.neutral.copy(homeOrientation), this.look.quaternion, b.lookAtPlayerStrength);
    const actor = this.actor;
    if (!actor) return;
    if (b.trackRocketGaze) {
      this.aim.copy(rocket);
      this.relative.copy(this.aim).sub(this.at);
      actor.controls.gazeX = T.MathUtils.clamp(this.relative.x * (touching ? 2.6 : 1.22) + Math.sin(T.MathUtils.degToRad(yaw)) * .18, -.87, .87);
      actor.controls.gazeY = T.MathUtils.clamp(this.relative.y * 1.55 + pitch / 270, -.74, .61);
      actor.controls.yaw = actor.controls.gazeX * 8;
      actor.controls.pitch = actor.controls.gazeY * 7;
    }
    const pose = actor.update(time);
    const lift = this.view.definition?.armFrames ? T.MathUtils.clamp(Math.max(pose.wave, pose.specialHand) / .75, 0, 1) : 0;
    this.reveal = damp(this.reveal, lift * lift * (3 - 2 * lift), 12, dt);
    this.applyFraming();
    this.view.apply(pose);
  }
}
