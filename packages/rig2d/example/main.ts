import { RigAnimator } from '../src/core';
import { CanvasPortrait } from '../src/canvas';
import { makeDummy } from './dummy';
import { mountStudio } from './studio';

const dummy = makeDummy();
const backend = new URLSearchParams(location.search).get('renderer') === 'three' ? 'three' : 'canvas';
void mountStudio({
  title: 'Rig2D 스튜디오',
  choices: { canvas: 'Canvas 2D', three: 'Three.js' },
  selection: backend,
  name: '타이머',
  select(value) {
    const url = new URL(location.href);
    url.searchParams.set('renderer', value);
    location.assign(url);
  },
  makeActor: () => new RigAnimator(dummy.definition.animation),
  play: (actor, id, time) => actor.play(id, time),
  async view(canvas) {
    if (backend === 'three') {
      const [{ threeView }, { Portrait }] = await Promise.all([import('./threeView'), import('../src/three')]);
      return threeView(canvas, new Portrait(dummy.url));
    }
    const view = await CanvasPortrait.load(canvas, dummy.url);
    return {
      resize: (w, h) => {
        canvas.width = w;
        canvas.height = h;
      },
      draw: (p) => view.apply(p),
      dispose: () => view.dispose(),
    };
  },
});
window.addEventListener('pagehide', (e) => {
  if (!e.persisted) dummy.dispose();
});
