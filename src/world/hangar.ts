import * as T from 'three';
import type { Environment } from '../content/types';
import { batch, box, cylinder, light, mesh, toon, unitBox } from '../render/graphics';

type Bar = { a: T.Vector3; b: T.Vector3; width: number; depth: number };
const point = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

function bars(parent: T.Object3D, material: T.Material, entries: Bar[]) {
  const up = point(0, 1, 0);
  const direction = new T.Vector3();
  batch(parent, unitBox, material, entries.length, (i, part) => {
    const { a, b, width, depth } = entries[i];
    direction.subVectors(b, a);
    part.position.copy(a).addScaledVector(direction, .5);
    part.scale.set(width, direction.length(), depth);
    part.quaternion.setFromUnitVectors(up, direction.normalize());
  });
}

export class Hangar {
  readonly group = new T.Group();
  readonly petals: T.Group[] = [];
  readonly shaftY = 6.3;

  constructor(environment: Environment, shaftX: number, shaftZ: number) {
    const { lighting, launchColumn: c } = environment;
    const frame = toon(c.gantryColor);
    const deck = toon(c.pedestalColor);
    const inset = toon(lighting.groundBounce);
    const accent = toon(c.gantryAccent);
    const cyan = light(c.beamColor);
    this.group.add(new T.HemisphereLight(lighting.skyHorizon, lighting.groundBounce, 1.85));
    const sun = new T.DirectionalLight(lighting.sunColor, lighting.sunIntensity);
    sun.position.set(...lighting.sunDirection);
    this.group.add(sun);
    const rim = new T.DirectionalLight(lighting.rimColor, lighting.rimIntensity);
    rim.position.set(-4, 2, -5);
    this.group.add(rim);

    box(this.group, deck, 18, .21, 18, 0, -.15, -4);
    const deckTiles = 18;
    batch(this.group, unitBox, inset, deckTiles, (i, panel) => {
      panel.position.set((i % 6 - 2.5) * 2.96, -.049, Math.floor(i / 6) * 2.35 - 8.6);
      panel.scale.set(2.92, .038, 2.3);
    });
    const tracks: Bar[] = [];
    for (const x of [-5.86, -2.73, -.92, 1.08, 2.73, 5.86]) {
      tracks.push({ a: point(x, -.028, -12), b: point(x, -.028, 4), width: .028, depth: .008 });
    }
    bars(this.group, frame, tracks);
    batch(this.group, unitBox, accent, 44, (i, tick) => {
      const side = i < 22 ? -1 : 1;
      tick.position.set(side * (2.73 + (i % 2 ? .13 : -.13)), -.021, -11.6 + i % 22 * .73);
      tick.rotation.y = side * .64;
      tick.scale.set(.19, .022, .068);
    });

    const beams: Bar[] = [];
    const braces: Bar[] = [];
    function beam(a: T.Vector3, b: T.Vector3, width = .21, depth = .29) { beams.push({ a, b, width, depth }); }
    function brace(a: T.Vector3, b: T.Vector3, width = .11, depth = .14) { braces.push({ a, b, width, depth }); }
    for (const x of [-6.9, 6.9]) {
      for (const z of [-12, -8, -4, 0, 4]) {
        beam(point(x, 0, z), point(x, 5.9, z), .4, .33);
        beam(point(x, 5.9, z), point(x * .68, 6.8, z), .23, .25);
        brace(point(x, 3.9, z), point(x * .78, 5.88, z));
        if (z < 4) {
          for (const y of [.52, 2.9, 5.45, 5.91]) beam(point(x, y, z), point(x, y, z + 4), .16, .22);
          brace(point(x, 4, z), point(x, 5.89, z + 2));
          brace(point(x, 5.89, z + 2), point(x, 4, z + 4));
        }
      }
    }
    for (const z of [-12, -8, 2, 4]) {
      beam(point(-5.3, 6.68, z), point(5.3, 6.68, z), .22);
      for (let i = -4; i < 5; i++) {
        const x = i * 1.02;
        brace(point(x, 6.67, z), point(x + .49, 6.08, z));
        brace(point(x + .49, 6.08, z), point(x + 1.02, 6.67, z));
      }
    }
    bars(this.group, frame, beams);
    bars(this.group, accent, braces);
    batch(this.group, unitBox, deck, 16, (i, pane) => {
      const side = i < 8 ? -1 : 1;
      pane.position.set(side * 6.92, i % 2 ? 5.1 : 1.2, -10 + Math.floor(i % 8 / 2) * 4);
      pane.scale.set(.12, i % 2 ? .9 : 1.45, 3.65);
    });
    batch(this.group, unitBox, cyan, 14, (i, lamp) => {
      lamp.position.set(i < 7 ? -6.71 : 6.71, 3.04, -10.8 + i % 7 * 2.14);
      lamp.scale.set(.054, .05, .92);
    });
    // An open observation deck lets the artist's panorama read behind the launch column.
    box(this.group, deck, 13.8, .58, .35, 0, .25, -12.2);
    box(this.group, frame, 13.8, .087, .29, 0, .56, -12.2);
    batch(this.group, unitBox, accent, 12, (i, part) => {
      part.position.set((i - 5.5) * 1.06, .38, -11.995);
      part.rotation.z = -.49;
      part.scale.set(.16, .24, .026);
    });
    this.buildRoof(shaftX, shaftZ, frame, deck, accent, cyan);
    this.sunbeams(lighting.sunColor);
  }

  private buildRoof(x: number, z: number, frame: T.Material, deck: T.Material, accent: T.Material, cyan: T.Material) {
    const y = this.shaftY, radius = 2.75;
    const collar = mesh(this.group, new T.TorusGeometry(radius, .145, 6, 48), frame, x, y, z);
    collar.rotation.x = Math.PI / 2;
    mesh(this.group, new T.TorusGeometry(radius - .155, .035, 5, 48), cyan, x, y - .115, z).rotation.x = Math.PI / 2;
    const sector = new T.Shape().moveTo(-1.01, 0).lineTo(1.01, 0).lineTo(.57, -1.31)
      .lineTo(.075, -2.58).lineTo(-.15, -2.64).lineTo(-.72, -1.36).closePath();
    const geometry = new T.ExtrudeGeometry(sector, { depth: .085, bevelEnabled: false });
    for (let i = 0; i < 8; i++) {
      const azimuth = i * Math.PI / 4;
      const arm = new T.Group();
      arm.position.set(x + Math.sin(azimuth) * radius, y, z + Math.cos(azimuth) * radius);
      arm.rotation.y = azimuth;
      this.group.add(arm);
      const petal = new T.Group();
      arm.add(petal);
      mesh(petal, geometry, i % 2 ? deck : frame).rotation.x = Math.PI / 2;
      box(petal, accent, .08, .035, 1.13, 0, -.11, -1.12);
      this.petals.push(petal);
    }

    const supports: Bar[] = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      supports.push({ a: point(x + Math.sin(a) * (radius + .16), y, z + Math.cos(a) * (radius + .16)),
        b: point(x + Math.sin(a) * 6.35, y + .49, z + Math.cos(a) * 6.35), width: .20, depth: .25 });
    }
    bars(this.group, frame, supports);
  }

  setIris(open: number) {
    this.petals.forEach((petal, i) => {
      const phase = T.MathUtils.clamp((open - i * .014) / (1 - i * .014), 0, 1);
      petal.rotation.x = -T.MathUtils.smoothstep(phase, 0, 1) * 1.37;
    });
  }

  private sunbeams(color: string) {
    const material = new T.ShaderMaterial({
      side: T.FrontSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { sun: { value: new T.Color(color) } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 sun; varying vec2 vUv; void main() {
        float fade = sin(vUv.y * 3.14159) * sin(vUv.x * 3.14159);
        gl_FragColor = vec4(sun, fade * 0.07);
        #include <colorspace_fragment>
      }`,
    });
    for (let i = 0; i < 3; i++) {
      const beam = mesh(this.group, new T.CylinderGeometry(.14, 1.45 + i * .18, 8, 12, 1, true), material, 4.1 + i * .64, 3.8, -4.9 - i * 1.17);
      beam.rotation.z = -.55;
    }
  }
}
