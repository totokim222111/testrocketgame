import * as T from 'three';
import type { Housing, StepOf } from '../content/types';
import { canvasTexture } from '../render/graphics';

export function makeLineArt(housing: Housing, anisotropy: number, bus?: StepOf<'wire_patch'>) {
  const { palette: p, lineArtTexture: options, dimensions: d } = housing;
  const size = options.resolution;
  const surface = canvasTexture(size, size, anisotropy);
  const { ctx, texture } = surface;
  const relief = canvasTexture(512, 512, anisotropy);
  const bump = relief.ctx;
  relief.texture.colorSpace = T.NoColorSpace;
  surface.texture.wrapS = relief.texture.wrapS = T.RepeatWrapping;
  ctx.scale(size / 2048, size / 2048);
  bump.scale(512 / 2048, 512 / 2048);
  const edge = 2048;
  const u = (angle: number) => angle / 360 * edge;
  const v = (height: number) => (1 - height) * edge;
  const line = (x: number, y: number, x2: number, y2: number, color: string, width = 2, target = ctx) => {
    target.strokeStyle = color;
    target.lineWidth = width;
    target.beginPath();
    target.moveTo(x, y);
    target.lineTo(x2, y2);
    target.stroke();
  };
  const stroke = (x: number, y: number, w: number, h: number) => ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = p.hullBase;
  ctx.fillRect(0, 0, edge, edge);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, edge, edge);
  ctx.fillStyle = p.hullShade;
  ctx.fillRect(0, v(d.nozzleRatio) - 20, edge, 38);
  ctx.fillRect(0, v(1 - d.noseconeRatio) - 12, edge, 26);
  const collar = v(1 - d.noseconeRatio + .015);
  for (let shift = -edge; shift <= edge; shift += edge) {
    ctx.fillStyle = p.inkLine;
    ctx.fillRect(shift - 14, 0, 28, collar);
    ctx.fillRect(shift - 14, v(1 - d.noseconeRatio), 28, v(.15) - v(1 - d.noseconeRatio));
  }
  if (options.showBlueprintGrid) {
    ctx.globalAlpha = .14;
    for (let i = 0; i < edge; i += 32) {
      line(i, v(d.nozzleRatio), i, v(1 - d.noseconeRatio), p.metalTrim, 1);
      line(0, i, edge, i, p.metalTrim, 1);
    }
    ctx.globalAlpha = 1;
  }
  for (const ratio of options.panelRings) {
    const y = v(ratio);
    line(0, y, edge, y, p.inkLine, 5);
    line(0, y + 7, edge, y + 7, p.hullShade, 5);
    line(0, y, edge, y, '#525252', 10, bump);
    for (let angle = options.rivetSpacingDeg / 2; angle < 360; angle += options.rivetSpacingDeg) {
      const x = u(angle);
      ctx.beginPath();
      ctx.arc(x, y + 17, 5.4, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = p.inkLine;
      ctx.stroke();
      line(x - 2.5, y + 17, x + 2.5, y + 17, p.inkLine, 1);
    }
  }
  for (const angle of options.longitudinalSeamsDeg) {
    for (const x of [u(angle), u(angle) - edge, u(angle) + edge]) {
      line(x, v(d.nozzleRatio), x, v(1 - d.noseconeRatio), p.metalTrim, 3);
      line(x, v(d.nozzleRatio), x, v(1 - d.noseconeRatio), '#5a5a5a', 8, bump);
    }
  }
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = p.inkLine;
  const azimuthY = v(1 - d.noseconeRatio) + 60;
  for (let a = 0; a < 360; a += options.azimuthTickStepDeg) {
    const major = (a % options.azimuthMajorStepDeg) < .001;
    const x = u(a);
    line(x, azimuthY - 21, x, azimuthY + (major ? 13 : -5), p.inkLine, major ? 4 : 2);
    if (major) ctx.fillText(a + '°', x + 5, azimuthY + 36);
  }
  const mm = d.lengthCm * 10;
  const axisX = u(28);
  const axisY = v(.08), axisTop = v(.89);
  line(axisX, axisY, axisX, axisTop, p.inkLine, 2);
  ctx.font = 'bold 16px monospace';
  const rulerCount = Math.min(500, Math.floor(mm / options.axialRulerTicksMm));
  for (let tick = 0; tick <= rulerCount; tick++) {
    const value = tick * options.axialRulerTicksMm;
    const y = T.MathUtils.lerp(axisY, axisTop, value / mm);
    line(axisX - (tick % 5 === 0 ? 24 : 12), y, axisX, y, p.inkLine);
    ctx.fillText(value + (tick === 0 || tick === rulerCount ? ' mm' : ''), axisX + 4, y + 4);
  }
  if (options.showHazardCollar) {
    const y = v(d.nozzleRatio + .06);
    ctx.fillStyle = p.accentSecondary;
    ctx.fillRect(0, y, edge, 38);
    for (let x = -32; x < edge; x += 32) line(x, y + 33, x + 30, y + 5, p.inkLine, 10);
    line(0, y, edge, y, p.inkLine, 3);
    line(0, y + 38, edge, y + 38, p.inkLine, 3);
  }
  for (const { angleDeg, heightRatio, text } of options.stencilLabels) {
    ctx.font = 'bold 22px monospace';
    const width = ctx.measureText(text).width + 22;
    const y = v(heightRatio);
    for (const x of [u(angleDeg), u(angleDeg) - edge, u(angleDeg) + edge]) {
      ctx.fillStyle = p.inkLine;
      ctx.fillRect(x - width / 2, y - 19, width, 31);
      ctx.fillStyle = p.hullBase;
      ctx.fillText(text, x - width / 2 + 11, y + 4);
      ctx.strokeStyle = p.metalTrim;
      ctx.lineWidth = 2;
      stroke(x - width / 2 - 9, y - 25, width + 18, 43);
      for (let i = 0; i < 5; i++) line(x - 30 + i * 12, y + 22, x - 30 + i * 12, y + 32, p.inkLine, i === 2 ? 3 : 1);
    }
  }
  if (options.showCircuitTraces && bus) {
    const mount = housing.mounts[bus.mountId];
    const wires = bus.params.wires;
    const sockets = [...wires.map(wire => wire.targetSocket)].sort();
    const y = v(mount.heightRatio);
    const textY = 52;
    ctx.font = 'bold 19px monospace';
    for (let i = 0; i < wires.length; i++) {
      const wire = wires[i];
      for (const anchor of [u(mount.angleDeg), u(mount.angleDeg) - edge, u(mount.angleDeg) + edge]) {
        const x = anchor + (i - (wires.length - 1) / 2) * 54;
        const dest = anchor + (sockets.indexOf(wire.targetSocket) - (wires.length - 1) / 2) * 54;
        ctx.strokeStyle = p.inkLine;
        ctx.lineWidth = 2;
        stroke(x - 16, y + textY - 123, 32, 30);
        ctx.fillStyle = p.inkLine;
        ctx.fillText(wire.label, x - 18, y + textY - 130);
        ctx.beginPath();
        ctx.moveTo(x, y + textY - 93);
        ctx.lineTo(x, y + textY - 26);
        ctx.lineTo(dest + (wire.note ? 19 : 0), y + textY);
        if (wire.note) ctx.lineTo(dest + 19, y + textY + 30);
        ctx.lineTo(dest, y + textY + 45);
        ctx.lineWidth = 6;
        ctx.strokeStyle = wire.color;
        ctx.stroke();
        if (wire.note) {
          const burn = x - 6;
          const scorch = ctx.createRadialGradient(burn, y + textY + 19, 1, burn, y + textY + 19, 27);
          scorch.addColorStop(0, p.inkLine);
          scorch.addColorStop(1, p.inkLine + '00');
          ctx.fillStyle = scorch;
          ctx.fillRect(burn - 27, y + textY - 8, 54, 54);
          line(burn - 8, y + textY + 12, burn + 8, y + textY + 27, p.accentHazard, 4);
        }
        ctx.fillStyle = p.inkLine;
        ctx.fillText(wire.targetSocket, dest - 11, y + textY + 65);
      }
    }
  }
  return { map: texture, bumpMap: relief.texture };
}
