import type { RigDefinition, LayerName } from '../src/format';

// A little training timer, drawn directly into the v1 atlas. No external art.
export function makeDummy() {
  const atlas = document.createElement('canvas');
  atlas.width = 2048;
  atlas.height = 1024;
  const ctx = atlas.getContext('2d')!;
  const def: RigDefinition = {
    version: 1,
    canvas: [360, 480],
    size: [atlas.width, atlas.height],
    atlas: '',
    continuous: true,
    layers: [],
    animation: { idle: { breathHz: 0.24, oscillators: [['roll', 2, 0.28, 0]] } },
  };
  let left = 0,
    top = 0,
    row = 0;
  function fill(color: string, x: number, y: number, w: number, h: number, r: number) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function oval(color: string, x: number, y: number, rx: number, ry: number) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function layer(name: LayerName, rect: number[], frames: number, draw: (i: number) => void) {
    const [, , w, h] = rect,
      stride = w + 4;
    if (left + stride * frames > atlas.width) {
      left = 0;
      top += row;
      row = 0;
    }
    if (top + h + 4 > atlas.height) throw Error('Dummy atlas overflow');
    const tile = [left + 2, top + 2, w, h];
    for (let i = 0; i < frames; i++) {
      ctx.save();
      ctx.translate(tile[0] + i * stride, tile[1]);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(i);
      ctx.restore();
    }
    const grid = [8, 8];
    def.layers.push({ name, rect, tile, frames, stride, grid, depth: Array(81).fill(145) });
    left += stride * frames;
    row = Math.max(row, h + 4);
  }
  const navy = '#183940',
    deep = '#10282e',
    mint = '#bcf6d7',
    peach = '#ffb583',
    shadow = '#c57458';
  layer('rear', [29, 123, 302, 140], 1, () => {
    fill(shadow, 0, 9, 302, 125, 46);
    fill(peach, 0, 7, 302, 109, 41);
    for (const x of [6, 276]) {
      fill(navy, x, 40, 20, 57, 8);
      fill(mint, x + 6, 47, 4, 22, 2);
    }
  });
  layer('neck', [154, 258, 52, 100], 1, () => {
    fill(navy, 0, 0, 52, 100, 12);
    for (const y of [40, 52, 64]) fill('#43646a', 0, y, 52, 4, 2);
  });
  layer('body', [47, 322, 266, 220], 1, () => {
    fill(shadow, 0, 7, 266, 222, 60);
    fill(peach, 3, 1, 260, 214, 58);
    fill(navy, 29, 20, 208, 175, 47);
    fill('#3b5c60', 44, 28, 178, 142, 34);
    fill(deep, 62, 45, 142, 76, 23);
    for (let i = 0; i < 6; i++) fill(i < 4 ? mint : '#42676a', 78 + i * 18, 89 - i * 5, 10, 12 + i * 5, 4);
    fill(peach, 53, 144, 160, 10, 5);
  });
  layer('face', [47, 72, 266, 226], 1, () => {
    fill(shadow, 0, 7, 266, 218, 76);
    fill(peach, 0, 0, 266, 214, 72);
    fill('#ffe1b9', 13, 9, 240, 151, 64);
    fill('#496566', 13, 48, 240, 136, 43);
    fill(deep, 18, 48, 230, 128, 39);
    fill('#315055', 30, 60, 204, 8, 4);
    for (const x of [40, 214]) oval(shadow, x, 193, 5, 5);
  });
  layer('blush', [75, 199, 210, 30], 1, () => {
    oval('#fa957f', 17, 13, 16, 7);
    oval('#fa957f', 193, 13, 16, 7);
  });
  function eye(name: 'eyeL' | 'eyeR', x: number) {
    layer(name, [x, 155, 48, 45], 6, (i) => {
      const h = [5, 14, 31, 8, 41, 35][i];
      fill(mint, 5, (45 - h) / 2, 38, h, Math.min(h / 2, 13));
      if (i === 3) fill(deep, 5, 23, 38, 8, 4);
      if (i === 2 || i === 4 || i === 5) fill('#f0fff1', 10, 13, 7, 6, 3);
    });
  }
  eye('eyeL', 95);
  eye('eyeR', 217);
  layer('brows', [94, 138, 172, 15], 4, (i) => {
    for (const x of [0, 123]) {
      ctx.save();
      ctx.translate(x + 24, 8);
      ctx.rotate((x ? -1 : 1) * [0, 0.14, 0.24, -0.18][i]);
      fill('#72aea0', -20, -2, 40, 4, 2);
      ctx.restore();
    }
  });
  layer('mouth', [153, 210, 54, 26], 6, (i) => {
    const width = [27, 17, 25, 41, 33, 15][i],
      height = [4, 8, 19, 16, 6, 4][i];
    fill('#ffb69d', (54 - width) / 2, (26 - height) / 2, width, height, height / 2);
  });
  layer('fringe', [155, 30, 50, 58], 1, () => {
    fill(shadow, 18, 18, 13, 39, 6);
    oval('#54837e', 25, 19, 18, 18);
    oval(mint, 25, 17, 12, 12);
    oval('#efffe9', 21, 12, 4, 4);
  });
  layer('locks', [47, 246, 266, 32], 1, () => {
    for (const x of [0, 245]) fill('#f39972', x, 0, 20, 26, 9);
  });
  layer('hand', [15, 258, 80, 160], 3, (i) => {
    fill(shadow, 20, 73, 40, 88, 18);
    fill(peach, 10, 45, 60, 60, 22);
    for (let j = 0; j < 3; j++) {
      const y = i === 0 ? 8 + Math.abs(j - 1) * 7 : i === 1 && j === 1 ? 4 : 43;
      fill(peach, 12 + j * 17, y, 16, 65 - y, 8);
    }
    fill(peach, 54, i === 2 ? 0 : 45, 17, i === 2 ? 68 : 28, 8);
  });
  layer('spark', [300, 18, 40, 46], 1, () => {
    ctx.fillStyle = mint;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        r = i % 2 ? 6 : 20;
      const x = 20 + Math.cos(a) * r,
        y = 23 + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.fill();
  });
  def.atlas = atlas.toDataURL();
  const url = URL.createObjectURL(new Blob([JSON.stringify(def)], { type: 'application/json' }));
  return { url, definition: def, dispose: () => URL.revokeObjectURL(url) };
}
