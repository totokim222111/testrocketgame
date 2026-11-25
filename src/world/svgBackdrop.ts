import * as T from 'three';
import type { Environment, SvgLayer } from '../content/types';
import { canvasTexture, mesh } from '../render/graphics';

export class SvgBackdrop {
  readonly group = new T.Group();
  loadedCount = 0;
  readonly ready: Promise<void>;
  private readonly layers: { layer: SvgLayer; view: T.Mesh }[] = [];

  constructor(environment: Environment, base: URL, anisotropy: number) {
    const { lighting } = environment;
    const gradient = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { skyTop: { value: new T.Color(lighting.skyTop) }, horizon: { value: new T.Color(lighting.skyHorizon) } },
      vertexShader: `varying vec3 direction;
        void main() { direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 skyTop; uniform vec3 horizon; varying vec3 direction;
        void main() {
          gl_FragColor = vec4(mix(horizon, skyTop, smoothstep(-0.2, 0.85, direction.y)), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const skyRadius = Math.max(36, ...environment.svgLayers.map(layer => layer.radiusMeters + Math.abs(layer.yOffsetMeters) + 4));
    mesh(this.group, new T.SphereGeometry(skyRadius, 28, 16), gradient).renderOrder = -30;
    const jobs = environment.svgLayers.map(async layer => {
      const dome = layer.kind === 'dome_cap';
      const surface = canvasTexture(2048, dome ? 2048 : 1024, anisotropy);
      const geometry = dome ? new T.SphereGeometry(layer.radiusMeters, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2)
        : new T.CylinderGeometry(layer.radiusMeters, layer.radiusMeters, layer.heightMeters, 48, 1, true);
      const material = new T.MeshBasicMaterial({ map: surface.texture, side: T.BackSide, opacity: layer.opacity,
        transparent: true, depthWrite: false, fog: false, toneMapped: false });
      const view = mesh(this.group, geometry, material, 0, layer.yOffsetMeters);
      view.visible = false;
      view.renderOrder = dome ? -12 : layer.driftSpeedRadPerSec === undefined ? -20 : -16;
      if (dome) {
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, T.MathUtils.clamp(uv.getY(i) * 2 - 1, 0, 1));
      }
      if (layer.driftSpeedRadPerSec) this.layers.push({ layer, view });
      try {
        const image = new Image();
        image.src = new URL(layer.src, base).href;
        await image.decode();
        surface.ctx.drawImage(image, 0, 0, surface.canvas.width, surface.canvas.height);
        surface.texture.needsUpdate = true;
        this.loadedCount++;
        view.visible = true;
      } catch {
        if (dome) {
          this.paintStars(surface.ctx, surface.canvas.width, lighting.skyTop, lighting.rimColor);
          surface.texture.needsUpdate = true;
          view.visible = true;
        }
      }
    });
    this.ready = Promise.all(jobs).then(() => undefined);
  }

  private paintStars(ctx: CanvasRenderingContext2D, size: number, dark: string, bright: string) {
    const background = ctx.createLinearGradient(0, 0, 0, size);
    background.addColorStop(0, dark);
    background.addColorStop(.64, dark);
    background.addColorStop(1, dark + '00');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = bright;
    for (let i = 1; i < 380; i++) {
      const x = ((i * 524287) % 1031) / 1031 * size;
      const y = ((i * 74527) % 997) / 997 * size * .78;
      ctx.globalAlpha = .2 + (i % 9) / 14;
      ctx.beginPath();
      ctx.arc(x, y, i % 19 === 0 ? 3.4 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  update(dt: number) {
    for (const { layer, view } of this.layers) view.rotation.y += dt * (layer.driftSpeedRadPerSec ?? 0);
  }
}
