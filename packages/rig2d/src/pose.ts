export const parameters = {
  yaw: ['고개 좌우', -15, 15, 0],
  pitch: ['고개 상하', -15, 15, 0],
  roll: ['갸웃', -15, 15, 0],
  lean: ['몸 기울기', -1, 1, 0],
  forward: ['몸 앞뒤', -1, 1, 0],
  breath: ['호흡', -1, 1, 0],
  bounce: ['몸 높이', -1, 1, 0],
  eye: ['눈 뜸', 0, 1.4, 1],
  happy: ['웃는 눈', 0, 1, 0],
  gazeX: ['시선 좌우', -1, 1, 0],
  gazeY: ['시선 상하', -1, 1, 0],
  brow: ['눈썹', 0, 3, 0],
  mouth: ['입 모양', 0, 5, 0],
  cheek: ['볼 부풀림', 0, 1, 0],
  blush: ['홍조', 0, 1, 0],
  fringe: ['앞머리', -1, 1, 0],
  locks: ['옆머리', -1, 1, 0],
  rear: ['뒷머리', -1, 1, 0],
  wave: ['손 높이', 0, 1, 0],
  gesture: ['손 모양', 0, 3, 0],
  wrist: ['손 흔들기', -1, 1, 0],
  wink: ['한쪽 눈 감기', 0, 1, 0],
  shrug: ['어깨 올림', 0, 1, 0],
  specialLip: ['고유 입 모양', 0, 1, 0],
  specialHand: ['고유 손동작', 0, 1, 0],
  sparkle: ['반짝임', 0, 1, 0],
} as const;
export type Param = keyof typeof parameters;
export type Pose = Record<Param, number>;
export const keys = Object.keys(parameters) as Param[];
export const neutralPose = () => Object.fromEntries(keys.map((k) => [k, parameters[k][3]])) as Pose;
export const limit = (k: Param, value: number) => Math.min(parameters[k][2], Math.max(parameters[k][1], value));
export const browNames = ['기본', '올림', '화남', '처짐'];
export const mouthNames = ['다묾', '작게', '크게', '활짝', '웃음', '삐죽'];
export const expressions = {
  기본: {},
  미소: { mouth: 4, blush: 0.3 },
  웃음: { happy: 1, mouth: 3, blush: 0.6 },
  졸림: { eye: 0.46, brow: 3 },
  깜빡: { eye: 0 },
  놀람: { eye: 1.4, brow: 1, mouth: 2 },
  삐짐: { eye: 0.55, brow: 2, mouth: 5, cheek: 1 },
  수줍음: { gazeX: -0.6, brow: 3, blush: 1, mouth: 4 },
} satisfies Record<string, Partial<Pose>>;
export function eyeFrame(p: Pose) {
  return p.happy > 0.5 ? 3 : p.eye < 0.19 ? 0 : p.eye < 0.72 ? 1 : p.eye > 1.23 ? 4 : p.eye > 1.06 ? 5 : 2;
}
export function mouthFrame(p: Pose, frames: number) {
  if (frames >= 7 && p.specialLip > 0.5) return 6;
  if (frames >= 8 && p.mouth === 3 && p.eye < 0.72 && Math.round(p.brow) === 3) return 7;
  return Math.round(p.mouth);
}
