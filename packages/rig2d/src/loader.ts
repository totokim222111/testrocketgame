import { kinds, type RigDefinition } from './format';
import { parameters, type Param } from './pose';
import type { AnimationProfile } from './clips';

function check(value: unknown, field: string): asserts value {
  if (!value) throw new TypeError('Invalid rig2d field: ' + field);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function numbers(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}
function checkValue(key: string, value: unknown) {
  check(Object.hasOwn(parameters, key), key);
  const [, min, max] = parameters[key as Param];
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, key);
}
function checkPose(value: unknown) {
  check(object(value), 'parameters');
  for (const [k, v] of Object.entries(value)) checkValue(k, v);
}
export function validateProfile(value: unknown): asserts value is AnimationProfile {
  check(object(value), 'animation');
  if (value.parameters !== undefined) checkPose(value.parameters);
  if (value.idle !== undefined) {
    const idle = value.idle;
    check(object(idle), 'idle');
    for (const k of ['headScale', 'breathHz', 'nodPeriod', 'nodDepth']) {
      const v = idle[k];
      if (v !== undefined) check(typeof v === 'number' && Number.isFinite(v) && v >= 0, k);
    }
    if (idle.offsets !== undefined) checkPose(idle.offsets);
    if (idle.oscillators !== undefined) {
      check(Array.isArray(idle.oscillators), 'oscillators');
      for (const o of idle.oscillators)
        check(
          Array.isArray(o) &&
            o.length === 4 &&
            Object.hasOwn(parameters, o[0]) &&
            o.slice(1).every(Number.isFinite),
          'oscillator',
        );
    }
  }
  if (value.clips === undefined) return;
  check(object(value.clips), 'clips');
  for (const [id, clip] of Object.entries(value.clips)) {
    check(
      object(clip) &&
        typeof clip.label === 'string' &&
        typeof clip.duration === 'number' &&
        Number.isFinite(clip.duration) &&
        clip.duration > 0 &&
        object(clip.tracks),
      id,
    );
    if (clip.constants !== undefined) checkPose(clip.constants);
    for (const [key, track] of Object.entries(clip.tracks)) {
      check(Object.hasOwn(parameters, key) && Array.isArray(track), id + '.' + key);
      let previous = -1;
      for (const point of track) {
        check(
          numbers(point, 2) && point[0] > previous && point[0] >= 0 && point[0] <= clip.duration,
          id + '.' + key,
        );
        checkValue(key, point[1]);
        previous = point[0];
      }
    }
  }
}
export function validateDefinition(input: unknown): asserts input is RigDefinition {
  check(object(input) && input.version === 1, 'version');
  for (const pair of [input.canvas, input.size])
    check(numbers(pair, 2) && pair.every((n) => Number.isInteger(n) && n > 0), 'size');
  check(typeof input.atlas === 'string' && input.atlas.length > 0, 'atlas');
  const [aw, ah] = input.size as number[];
  check(Array.isArray(input.layers) && input.layers.length > 0, 'layers');
  const seen = new Set<string>();
  for (const layer of input.layers) {
    check(object(layer) && kinds.some((k) => k === layer.name) && !seen.has(String(layer.name)), 'layer.name');
    seen.add(String(layer.name));
    check(numbers(layer.rect, 4) && layer.rect[2] > 0 && layer.rect[3] > 0, 'rect');
    check(
      numbers(layer.grid, 2) && layer.grid.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 256),
      'grid',
    );
    check(
      numbers(layer.depth, (layer.grid[0] + 1) * (layer.grid[1] + 1)) &&
        layer.depth.every((n) => Number.isInteger(n) && n >= 0 && n <= 255),
      'depth',
    );
    check(numbers(layer.tile, 4) && layer.tile.every(Number.isInteger), 'tile');
    const [x, y, w, h] = layer.tile;
    check(typeof layer.frames === 'number' && Number.isInteger(layer.frames) && layer.frames > 0, 'frames');
    check(typeof layer.stride === 'number' && Number.isInteger(layer.stride) && layer.stride >= w, 'stride');
    check(
      x >= 0 && y >= 0 && w > 0 && h > 0 && x + w + (layer.frames - 1) * layer.stride <= aw && y + h <= ah,
      'tile bounds',
    );
  }
  if (input.handRect !== undefined)
    check(numbers(input.handRect, 4) && input.handRect[2] > 0 && input.handRect[3] > 0, 'handRect');
  if (input.bustFade !== undefined) {
    const range = input.bustFade;
    check(numbers(range, 2) && range[0] >= 0 && range[0] < range[1] &&
      range[1] <= (input.canvas as number[])[1], 'bustFade');
  }
  if (input.armFrames !== undefined) {
    const hand = input.layers.find((layer) => layer.name === 'hand');
    check(Array.isArray(input.armFrames) && input.armFrames.length === hand?.frames, 'armFrames');
    for (const frame of input.armFrames)
      check(object(frame) && numbers(frame.rect, 4) && frame.rect[2] > 0 && frame.rect[3] > 0
        && numbers(frame.elbow, 2), 'arm frame');
  }
  if (input.continuous !== undefined) check(typeof input.continuous === 'boolean', 'continuous');
  if (input.animation !== undefined) validateProfile(input.animation);
}
export async function loadDefinition(url: string | URL, signal?: AbortSignal) {
  const result = await fetch(url, { signal });
  if (!result.ok) throw new Error('Rig HTTP ' + result.status + ' ' + url);
  const definition: unknown = await result.json();
  validateDefinition(definition);
  return definition;
}
export async function loadRig(url: string | URL, signal?: AbortSignal) {
  const absolute = new URL(url, document.baseURI);
  const definition = await loadDefinition(absolute, signal);
  const atlas = new Image();
  atlas.crossOrigin = 'anonymous';
  atlas.src = new URL(definition.atlas, absolute).href;
  await atlas.decode();
  signal?.throwIfAborted();
  check(
    atlas.naturalWidth === definition.size[0] && atlas.naturalHeight === definition.size[1],
    'atlas dimensions',
  );
  return { definition, atlas };
}
