import * as T from 'three';

export class Sparks {
  readonly view: T.Points;
  private readonly data: Float32Array;
  private readonly life: Float32Array;
  private readonly velocity: Float32Array;
  private readonly max = 132;
  private cursor = 0;
  private seed = 831719;

  constructor(color: string) {
    this.data = new Float32Array(this.max * 3).fill(1000);
    this.velocity = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.data, 3).setUsage(T.DynamicDrawUsage));
    this.view = new T.Points(geo, new T.PointsMaterial({
      color, size: .012, transparent: true, opacity: .88, depthWrite: false, blending: T.AdditiveBlending,
    }));
    this.view.frustumCulled = false;
    this.view.visible = false;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  emit(point: T.Vector3, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const n = this.cursor++ % this.max;
      this.life[n] = .15 + this.random() * .42;
      point.toArray(this.data, n * 3);
      const v = n * 3;
      this.velocity[v] = (this.random() * 2 - 1) * speed;
      this.velocity[v + 1] = this.random() * speed;
      this.velocity[v + 2] = (this.random() * 2 - 1) * speed;
    }
  }
  update(dt: number) {
    let active = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const index = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.data[index] = this.data[index + 1] = this.data[index + 2] = 1000; continue; }
      this.velocity[index + 1] -= dt * 2;
      for (let axis = 0; axis < 3; axis++) this.data[index + axis] += this.velocity[index + axis] * dt;
      active = true;
    }
    this.view.visible = active;
    if (active) this.view.geometry.attributes.position.needsUpdate = true;
  }
  reset() {
    this.life.fill(0);
    this.data.fill(1000);
    this.view.visible = false;
  }
}
