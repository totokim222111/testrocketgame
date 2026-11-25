import { neutralPose } from './pose';
import type { Param, Pose } from './pose';

type Key = [seconds: number, value: number];
export type Clip = {
  label: string;
  duration: number;
  tracks: Partial<Record<Param, Key[]>>;
  constants?: Partial<Pose>;
};
export interface AnimationProfile {
  parameters?: Partial<Pose>;
  idle?: {
    breathHz?: number;
    headScale?: number;
    offsets?: Partial<Pose>;
    oscillators?: [Param, number, number, number][];
    nodPeriod?: number;
    nodDepth?: number;
  };
  clips?: Record<string, Clip>;
}
export const clips = {
  greet: {
    label: '인사',
    duration: 1.9,
    tracks: {
      pitch: [
        [0.22, -11],
        [0.58, 5],
        [0.84, 0],
      ],
      roll: [
        [0.5, -6],
        [1.4, -4],
      ],
      wave: [
        [0.28, 1],
        [1.45, 1],
      ],
      wrist: [
        [0.3, -0.8],
        [0.55, 1],
        [0.8, -1],
        [1.05, 1],
        [1.3, -0.7],
      ],
      mouth: [
        [0.3, 4],
        [1.5, 4],
      ],
    },
  },
  cheer: {
    label: '응원',
    duration: 1.65,
    tracks: {
      bounce: [
        [0.16, -0.35],
        [0.38, 1],
        [0.63, -0.3],
        [0.86, 0.92],
        [1.12, -0.2],
      ],
      roll: [
        [0.35, -7],
        [0.9, 6],
      ],
      happy: [
        [0.22, 1],
        [1.25, 1],
      ],
      mouth: [
        [0.2, 3],
        [1.2, 3],
      ],
      blush: [
        [0.25, 0.8],
        [1.1, 0.7],
      ],
    },
  },
  praise: {
    label: '칭찬',
    constants: { gesture: 2 },
    duration: 1.82,
    tracks: {
      wave: [
        [0.12, 0.2],
        [0.36, 1],
        [1.34, 1],
        [1.71, 0],
      ],
      wrist: [
        [0.36, -0.5],
        [0.76, 0.22],
        [1.36, 0.1],
      ],
      pitch: [
        [0.16, 8],
        [0.45, -15],
        [0.77, 8],
        [1.05, -10],
        [1.32, 2],
      ],
      bounce: [
        [0.43, -0.34],
        [0.83, 0.24],
      ],
      mouth: [
        [0.16, 4],
        [1.48, 4],
      ],
      blush: [
        [0.3, 0.56],
        [1.36, 0.54],
      ],
      sparkle: [
        [0.26, 0],
        [0.41, 1],
        [0.6, 0],
        [0.83, 0],
        [0.97, 1],
        [1.15, 0],
      ],
    },
  },
  warn: {
    label: '경고',
    constants: { gesture: 1 },
    duration: 1.6,
    tracks: {
      wave: [
        [0.19, 0.62],
        [0.35, 1],
        [1.21, 1],
        [1.55, 0],
      ],
      wrist: [
        [0.22, -0.36],
        [0.46, 0.42],
        [0.7, -0.22],
        [1.12, 0.12],
      ],
      forward: [
        [0.22, 0.94],
        [0.8, 0.74],
        [1.26, 0.65],
      ],
      pitch: [
        [0.23, -12],
        [0.8, -7],
        [1.27, -6],
      ],
      brow: [
        [0.04, 2],
        [1.35, 2],
      ],
      eye: [
        [0.17, 0.78],
        [1.22, 0.83],
      ],
      mouth: [
        [0.1, 1],
        [0.5, 2],
        [0.84, 1],
        [1.3, 1],
      ],
    },
  },
  shock: {
    label: '놀람',
    duration: 1.15,
    tracks: {
      forward: [
        [0.13, -1],
        [0.44, -0.84],
        [0.7, -0.38],
      ],
      bounce: [
        [0.11, 0.88],
        [0.36, -0.32],
        [0.68, 0.1],
      ],
      roll: [
        [0.21, -6],
        [0.53, 2],
      ],
      pitch: [
        [0.13, 13],
        [0.43, 6],
        [0.73, -1],
      ],
      eye: [
        [0.06, 1.4],
        [0.76, 1.4],
      ],
      brow: [
        [0.04, 1],
        [0.78, 1],
      ],
      mouth: [
        [0.06, 2],
        [0.8, 2],
      ],
    },
  },
  pout: {
    label: '삐짐',
    duration: 2.15,
    tracks: {
      yaw: [
        [0.35, -14],
        [1.7, -12],
      ],
      roll: [
        [0.4, 6],
        [1.6, 5],
      ],
      gazeX: [
        [0.18, -1],
        [1.65, -0.9],
      ],
      cheek: [
        [0.28, 1],
        [1.83, 0.9],
      ],
      blush: [
        [0.35, 0.8],
        [1.65, 0.8],
      ],
      eye: [
        [0.2, 0.55],
        [1.75, 0.55],
      ],
      brow: [
        [0.15, 2],
        [1.72, 2],
      ],
      mouth: [
        [0.15, 5],
        [1.85, 5],
      ],
    },
  },
  talk: {
    label: '말하기',
    duration: 2.2,
    tracks: {
      pitch: [
        [0.3, -3],
        [0.64, 2],
        [1.2, -4],
        [1.6, 1],
      ],
      roll: [
        [0.7, 3],
        [1.72, -2],
      ],
      brow: [
        [0.5, 1],
        [0.74, 1],
      ],
    },
  },
  count: {
    label: '카운트다운',
    duration: 0.7,
    tracks: {
      pitch: [
        [0.13, 5],
        [0.32, -13],
        [0.58, 2],
      ],
      bounce: [
        [0.3, -0.35],
        [0.53, 0.12],
      ],
      eye: [
        [0.1, 1.16],
        [0.42, 1.16],
        [0.57, 1.1],
      ],
    },
  },
  finish: {
    label: '마무리',
    duration: 2.55,
    tracks: {
      bounce: [
        [0.23, -0.4],
        [0.53, 1],
        [0.84, -0.25],
        [1.12, 0.75],
      ],
      wave: [
        [0.4, 1],
        [2, 1],
      ],
      wrist: [
        [0.5, -0.7],
        [0.85, 0.9],
        [1.25, -0.8],
        [1.65, 0.8],
      ],
      roll: [
        [0.55, 8],
        [1.35, -6],
      ],
      happy: [
        [0.33, 1],
        [1.92, 1],
      ],
      mouth: [
        [0.3, 3],
        [1.95, 3],
      ],
      sparkle: [
        [0.34, 0],
        [0.5, 1],
        [0.68, 0],
        [1.19, 0],
        [1.35, 1],
        [1.54, 0],
      ],
    },
  },
} satisfies Record<string, Clip>;
export type Motion = keyof typeof clips;
const rest = neutralPose();

export function sampleClip(
  id: string,
  age: number,
  target: Pose,
  library: Record<string, Clip> = clips,
  baseline: Pose = rest,
) {
  const { duration, tracks, constants } = library[id];
  if (age < 0 || age >= duration) return;
  Object.assign(target, constants);
  for (const [name, points] of Object.entries(tracks)) {
    const k = name as Param;
    let t0 = 0,
      v0 = baseline[k],
      t1 = duration,
      v1 = baseline[k];
    for (const [t, v] of points) {
      if (t >= age) {
        t1 = t;
        v1 = v;
        break;
      }
      t0 = t;
      v0 = v;
    }
    const u = t1 > t0 ? (age - t0) / (t1 - t0) : 1;
    if (k === 'brow' || k === 'mouth') target[k] = u < 0.5 ? v0 : v1;
    else target[k] = v0 + (v1 - v0) * u * u * (3 - 2 * u);
  }
}

export type Syllable = { end: number; vowel: number; pause: boolean };
export function speechTrack(text: string): Syllable[] {
  let time = 0;
  return Array.from(text.trim(), (ch) => {
    const n = ch.codePointAt(0)! - 0xac00,
      pause = /[\s\p{P}]/u.test(ch);
    const vowel = n >= 0 && n < 11172 ? Math.floor(n / 28) % 21 : -1;
    time += pause ? (/\s/.test(ch) ? 0.071 : 0.17) : 0.139 + (ch.codePointAt(0)! % 3) * 0.012;
    return { end: time, vowel, pause };
  });
}
export function speechSample(track: Syllable[], age: number) {
  let start = 0;
  for (const s of track) {
    if (age >= start && age < s.end && !s.pause) {
      const phase = (age - start) / (s.end - start),
        level = Math.sin(phase * Math.PI) ** 0.75;
      const round = [8, 9, 12, 13, 14, 17, 18].includes(s.vowel);
      const wide = [0, 2, 4, 6].includes(s.vowel);
      return { mouth: level < 0.27 ? 0 : level < 0.62 ? 1 : round ? 2 : wide ? 3 : 4, level };
    }
    start = s.end;
  }
  return { mouth: 0, level: 0 };
}
