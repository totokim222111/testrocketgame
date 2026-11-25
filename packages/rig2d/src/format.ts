import type { AnimationProfile } from './clips';
import type { Pose } from './pose';
export const kinds = [
  'body',
  'rear',
  'face',
  'fringe',
  'locks',
  'eyeL',
  'eyeR',
  'brows',
  'mouth',
  'blush',
  'hand',
  'spark',
  'neck',
] as const;
export type LayerName = (typeof kinds)[number];
export interface Layer {
  name: LayerName;
  rect: number[];
  tile: number[];
  stride: number;
  grid: number[];
  depth: number[];
  frames: number;
}
export interface RigDefinition {
  version: number;
  canvas: number[];
  size: number[];
  atlas: string;
  layers: Layer[];
  continuous?: boolean;
  animation?: AnimationProfile;
  handRect?: number[];
  /** Canvas-space crop and elbow pivot for each registered arm cel. */
  armFrames?: { rect: number[]; elbow: number[] }[];
  bustFade?: [number, number];
}

export function posedArm(def: RigDefinition, pose: Pose) {
  if (!def.armFrames) return;
  const signature = pose.specialHand > 0.001 && def.armFrames.length > 4;
  const index = signature
    ? (def.armFrames.length > 5 && pose.wrist < -0.15 ? 5 : 4)
    : Math.max(0, Math.min(def.armFrames.length - 1, 3, Math.round(pose.gesture)));
  return {
    ...def.armFrames[index], index, lift: signature ? pose.specialHand : pose.wave,
    angle: pose.wrist * (signature ? 0.025 : 0.10),
  };
}
