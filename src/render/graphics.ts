import * as T from 'three';

export const deg = T.MathUtils.degToRad;
export const damp = (value: number, target: number, rate: number, dt: number) =>
  T.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
export const unitBox = new T.BoxGeometry();
export const unitSphere = new T.SphereGeometry(1, 12, 8);
export const toonRamp = new T.DataTexture(new Uint8Array([87, 164, 255]), 3, 1, T.RedFormat);
toonRamp.minFilter = toonRamp.magFilter = T.NearestFilter;
toonRamp.needsUpdate = true;
export const toon = (color: T.ColorRepresentation) => new T.MeshToonMaterial({ color, gradientMap: toonRamp });
export const light = (color: T.ColorRepresentation) => new T.MeshBasicMaterial({ color });

export function mesh<G extends T.BufferGeometry, M extends T.Material>(parent: T.Object3D, geometry: G, material: M, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}
export function box<M extends T.Material>(parent: T.Object3D, material: M, w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const object = mesh(parent, unitBox, material, x, y, z);
  object.scale.set(w, h, d);
  return object;
}
export function cylinder<M extends T.Material>(parent: T.Object3D, material: M, r1: number, r2: number, height: number, x = 0, y = 0, z = 0, sides = 24) {
  return mesh(parent, new T.CylinderGeometry(r1, r2, height, sides), material, x, y, z);
}
export function outlineFrame(w: number, h: number, corner: number) {
  const x = w / 2, y = h / 2;
  return new T.Shape().moveTo(-x + corner, -y).lineTo(x - corner, -y)
    .lineTo(x, -y + corner).lineTo(x, y - corner).lineTo(x - corner, y)
    .lineTo(-x + corner, y).lineTo(-x, y - corner).lineTo(-x, -y + corner).closePath();
}
export function chamfer<M extends T.Material>(parent: T.Object3D, material: M, w: number, h: number, d: number, corner: number, z = 0) {
  return mesh(parent, new T.ExtrudeGeometry(outlineFrame(w, h, corner), { depth: d, bevelEnabled: false }), material, 0, 0, z);
}
export function canvasTexture(width: number, height: number, anisotropy = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { canvas, ctx, texture };
}
export function display(parent: T.Object3D, w: number, h: number, px: number, py: number, x = 0, y = 0, z = 0) {
  const surface = canvasTexture(px, py);
  const screen = mesh(parent, new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({
    map: surface.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }), x, y, z);
  return { ...surface, mesh: screen, refresh: () => { surface.texture.needsUpdate = true; } };
}

export function batch(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, count: number,
  place: (index: number, dummy: T.Object3D) => void) {
  const instances = new T.InstancedMesh(geometry, material, count);
  const dummy = new T.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    place(i, dummy);
    dummy.updateMatrix();
    instances.setMatrixAt(i, dummy.matrix);
  }
  instances.computeBoundingSphere();
  parent.add(instances);
  return instances;
}

export function tube(parent: T.Object3D, points: T.Vector3[], width: number, material: T.Material, segments = 14) {
  const curve = new T.CatmullRomCurve3(points);
  return mesh(parent, new T.TubeGeometry(curve, segments, width, 5, false), material);
}

export function label(parent: T.Object3D, text: string, color: string, w: number, h: number, x = 0, y = 0, z = 0) {
  const aspect = w / h;
  const tag = display(parent, w, h, Math.max(64, Math.round(48 * aspect)), 48, x, y, z);
  tag.ctx.font = '700 34px ui-monospace, monospace';
  tag.ctx.textAlign = 'center';
  tag.ctx.textBaseline = 'middle';
  tag.ctx.fillStyle = color;
  tag.ctx.fillText(text, tag.canvas.width / 2, 24, tag.canvas.width - 4);
  tag.refresh();
  return tag;
}
