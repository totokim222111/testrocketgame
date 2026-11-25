import { loadRig } from './loader';
import { posedArm, type Layer, type RigDefinition } from './format';
import { eyeFrame, mouthFrame, type Pose } from './pose';

type Artwork = { definition: RigDefinition; atlas: CanvasImageSource };
const radians = Math.PI / 180;

/** Canvas-only view. Assemble at display resolution, then bend horizontal bands
 * around the neck. All adjacent cutouts receive the same head/body transform. */
export class CanvasPortrait {
  private readonly plate = document.createElement('canvas');
  private readonly bent = document.createElement('canvas');
  private readonly warp: CanvasRenderingContext2D;
  private readonly surface: CanvasRenderingContext2D;
  private readonly paint: CanvasRenderingContext2D;
  private disposed = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly art: Artwork,
  ) {
    const surface = canvas.getContext('2d'),
      paint = this.plate.getContext('2d');
    if (!surface || !paint) throw Error('Canvas2D context unavailable');
    this.surface = surface;
    this.paint = paint;
    this.warp = this.bent.getContext('2d')!;
  }
  static async load(canvas: HTMLCanvasElement, url: string | URL, signal?: AbortSignal) {
    return new CanvasPortrait(canvas, await loadRig(url, signal));
  }
  private drawLayer(layer: Layer, p: Pose) {
    const ctx = this.paint,
      def = this.art.definition;
    let [x, y, w, h] = layer.rect,
      frame = 0;
    const [cw, ch] = def.canvas;
    ctx.save();
    switch (layer.name) {
      case 'eyeL':
      case 'eyeR':
        frame = layer.name === 'eyeL' && p.wink > 0.5 ? 0 : eyeFrame(p);
        if ([1, 2, 4, 5].includes(frame)) {
          x += p.gazeX * w * 0.024;
          y -= p.gazeY * h * 0.022;
        }
        break;
      case 'mouth':
        frame = mouthFrame(p, layer.frames);
        break;
      case 'brows':
        frame = Math.round(p.brow);
        break;
      case 'blush':
        ctx.globalAlpha = p.blush;
        break;
      case 'hand':
        if (def.armFrames) {
          const arm = posedArm(def, p)!;
          [x, y, w, h] = arm.rect;
          frame = arm.index;
          const [ex, ey] = arm.elbow;
          ctx.translate(ex, ey + (1 - arm.lift) * ch * .78);
          ctx.rotate(-arm.angle);
          x -= ex;
          y -= ey;
          const lift = Math.min(1, arm.lift / .12);
          ctx.globalAlpha = lift * lift * (3 - 2 * lift);
          break;
        }
        if (p.specialHand > 0 && def.handRect && layer.frames >= 4) {
          [x, y, w, h] = def.handRect;
          frame = p.wrist < -0.15 ? 4 : 3;
          y += (1 - p.specialHand) * ch * (def.bustFade ? 0.30 : 0.46);
          ctx.globalAlpha = Math.min(1, p.specialHand / (def.bustFade ? 0.62 : 0.5));
          if (def.bustFade || layer.frames >= 5) {
            ctx.translate(x + w * 0.54, y + h);
            ctx.rotate(-p.wrist * 0.075);
            x = -w * 0.54;
            y = -h;
          }
        } else {
          frame = Math.round(p.gesture);
          ctx.globalAlpha = Math.min(1, p.wave * 6);
          const compact = def.bustFade && def.continuous;
          const elbow = compact ? 0.838 : def.bustFade ? 0.873 : 0.935;
          ctx.translate(cw * 0.5 - ch * (compact ? 0.190 : 0.238),
            ch * (elbow + (1 - p.wave) * 0.52));
          ctx.rotate(-0.056 - p.wrist * 0.135);
          w = ch * 0.207;
          h = ch * 0.401;
          x = -w / 2;
          y = -h;
        }
        break;
      case 'spark':
        ctx.globalAlpha = p.sparkle;
        w = ch * 0.116 * (0.68 + 0.32 * p.sparkle);
        h = w * 1.2;
        x = cw - ch * 0.068 - w / 2;
        y = ch * 0.084 - h / 2;
        break;
      case 'rear':
        x += p.rear * ch * 0.004;
        break;
      case 'locks':
        x += p.locks * ch * 0.003;
        break;
      case 'fringe':
        frame = eyeFrame(p) === 4 ? 1 : 0;
        x += p.fringe * ch * 0.001;
        break;
    }
    if (ctx.globalAlpha > 0) {
      const [tx, ty, tw, th] = layer.tile;
      ctx.drawImage(
        this.art.atlas,
        tx + Math.min(layer.frames - 1, frame) * layer.stride,
        ty,
        tw,
        th,
        x,
        y,
        w,
        h,
      );
    }
    ctx.restore();
  }
  apply(p: Pose) {
    if (this.disposed) return;
    const ctx = this.surface,
      plate = this.plate,
      [cw, ch] = this.art.definition.canvas;
    const scale = Math.min(this.canvas.width / cw, this.canvas.height / ch);
    const w = Math.max(1, Math.round(cw * scale)),
      h = Math.max(1, Math.round(ch * scale));
    if (plate.width !== w || plate.height !== h) {
      plate.width = this.bent.width = w;
      plate.height = this.bent.height = h;
    }
    this.paint.setTransform(w / cw, 0, 0, h / ch, 0, 0);
    this.paint.clearRect(0, 0, cw, ch);
    for (const layer of this.art.definition.layers) this.drawLayer(layer, p);
    const fade = this.art.definition.bustFade;
    if (fade) {
      const gradient = this.paint.createLinearGradient(0, fade[0], 0, fade[1]);
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(1, '#fff0');
      this.paint.save();
      this.paint.globalCompositeOperation = 'destination-in';
      this.paint.fillStyle = gradient;
      this.paint.fillRect(0, 0, cw, ch);
      this.paint.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.canvas.width / 2, (this.canvas.height - h) / 2 + h * 0.98);
    ctx.rotate(-p.lean * 0.055);
    const zoom = 0.96 * (1 + 0.14 * p.forward);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h * 0.98 - h * (p.breath * 0.009 + p.bounce * 0.044 - p.forward * 0.026));
    const hinge = h * 0.619,
      roll = p.roll * radians;
    // Warp onto an integer scanline grid first. Rotating individual translucent
    // strips would leave antialiased seams across opaque artwork.
    this.warp.clearRect(0, 0, w, h);
    let previous = 0;
    for (let row = 0; row < h; row += 3) {
      const count = Math.min(3, h - row),
        end = row + count;
      const weight = Math.min(1, Math.max(0, (0.78 - end / h) / 0.23));
      const ease = weight * weight * (3 - 2 * weight);
      const yaw = p.yaw * radians * ease,
        pitch = p.pitch * radians * ease;
      const width = w * Math.cos(yaw);
      const x = (w - width) / 2 + Math.sin(yaw) * w * 0.12 + (row - hinge) * Math.sin(roll) * (ease - 0.55);
      const bottom = Math.round(
        hinge + (end - hinge) * Math.cos(pitch) - Math.sin(pitch) * h * 0.08 - h * 0.018 * p.shrug * (1 - ease),
      );
      if (bottom > previous)
        this.warp.drawImage(plate, 0, row, w, count, x, previous, width, bottom - previous);
      previous = bottom;
    }
    ctx.translate(w / 2, hinge);
    ctx.rotate(-roll * 0.55);
    ctx.drawImage(this.bent, -w / 2, -hinge);
    ctx.restore();
  }
  dispose() {
    this.disposed = true;
    this.bent.width = this.bent.height = this.plate.width = this.plate.height = 1;
    this.surface.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
