import * as T from 'three';
import type { Portrait } from '../src/three';
import type { Pose } from '../src/pose';

export async function threeView(canvas: HTMLCanvasElement, portrait: Portrait) {
  await portrait.ready;
  if (portrait.status !== 'ready') {
    portrait.dispose();
    throw portrait.error;
  }
  let renderer: T.WebGLRenderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    portrait.dispose();
    throw error;
  }
  renderer.setClearColor(0, 0);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-0.375, 0.375, 0.5, -0.5, 0.01, 10);
  camera.position.z = 2;
  scene.add(portrait.mesh);
  return {
    resize: (w: number, h: number) => renderer.setSize(w, h, false),
    draw: (pose: Pose) => {
      portrait.apply(pose);
      renderer.render(scene, camera);
    },
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    dispose: () => {
      portrait.dispose();
      renderer.dispose();
    },
  };
}
