export type Triple = [number, number, number];
export type Pair = [number, number];

export interface Manifest {
  version: 1; title: string; subtitle: string; defaultLanguage: string;
  active: { heroine: string; housing: string; mission: string };
  paths: { heroinesDir: string; housingsDir: string; missionsDir: string };
  allowQueryOverride: boolean;
}
export interface Heroine {
  version: 1; id: string; displayName: string; englishName: string; role: string; tagline: string;
  rig: { rigJson: string; atlas: string; framing: { scale: number; y: number; vignette: boolean; brightness: number } };
  theme: { accent: string; accentSoft: string; secondary: string; cardBg: string; cardBorder: string; textPrimary: string; textMuted: string };
  voice: { engine: string; language: string; gain: number; lipSyncGain: number; audioDir: string; defaultExtension: string; voiceDesignKo?: string; h3ProfileEn?: string };
  emotionClips: Record<string, string>;
  modeLabels?: Record<string, string>;
  cardBehavior: { offsetFromRocket: Triple; widthMeters: number; heightMeters: number; lookAtPlayerStrength: number; trackRocketGaze: boolean; bobAmplitude: number; bobHz: number };
}
export interface DialogueLine {
  id: string; event: string; text: string; emotion: string; clip?: string; pace: 'fast' | 'normal' | 'slow';
  maxSec: number; priority: number; cooldownSec: number; audio?: string; mode?: string;
}
export interface Dialogue { version: 1; heroineId: string; language: string; lines: DialogueLine[] }
export interface Zone {
  id: string; yawMinDeg?: number; yawMaxDeg?: number; pitchMinDeg?: number; pitchMaxDeg?: number;
  dwellSec: number; emitEvent: string; oncePerStep: boolean;
}
export interface Events {
  version: 1; heroineId: string; globalCooldownSec: number; inspectionZones: Zone[];
  kinematicTriggers: { fastSpinAngularSpeedDegPerSec: number; fastSpinDurationSec: number; fastSpinEvent: string };
  idleTriggers: { nudgeAfterSec: number; repeatEverySec: number; emitEvent: string };
  easterEggs: { mistakeStreakForGemple38: number; gemple38Event: string };
  milestoneEvents: { halfwayStepIndex: number; halfwayEvent: string; almostDoneStepIndex: number; almostDoneEvent: string };
}
export interface Mount {
  angleDeg: number; heightRatio: number; spanDeg?: number;
  zone: 'front' | 'right' | 'back' | 'left' | 'lower_ring' | 'rear_right' | 'bottom' | 'top';
}
export interface Housing {
  version: 1; id: string; displayName: string; serialCode: string; description: string;
  dimensions: { lengthCm: number; circumferenceCm: number; noseconeRatio: number; bodyRatio: number; nozzleRatio: number; finCount: number; finSpanCm: number; magnifierScale: number };
  palette: { hullBase: string; hullShade: string; hullDark: string; inkLine: string; accentPrimary: string; accentSecondary: string; accentHazard: string; metalTrim: string; nozzleInner: string; glowActive: string; glowWarning: string; rimLight: string };
  lineArtTexture: { resolution: number; azimuthTickStepDeg: number; azimuthMajorStepDeg: number; axialRulerTicksMm: number; panelRings: number[]; longitudinalSeamsDeg: number[]; rivetSpacingDeg: number; showBlueprintGrid: boolean; showHazardCollar: boolean; showCircuitTraces: boolean; stencilLabels: { angleDeg: number; heightRatio: number; text: string }[] };
  mounts: Record<string, Mount>;
}
export interface SvgLayer {
  id: string; src: string; kind: 'cylinder' | 'dome_cap'; radiusMeters: number; heightMeters?: number;
  yOffsetMeters: number; opacity: number; driftSpeedRadPerSec?: number;
}
export interface Environment {
  version: 1; id: string; housingId: string; displayName: string; svgLayers: SvgLayer[];
  lighting: { skyTop: string; skyHorizon: string; groundBounce: string; sunColor: string; sunIntensity: number; sunDirection: Triple; rimColor: string; rimIntensity: number; bayFogColor: string; bayFogNear: number; bayFogFar: number };
  launchColumn: { pedestalColor: string; gantryColor: string; gantryAccent: string; beamColor: string; exhaustCoreColor: string; exhaustOuterColor: string; roofIrisOpenSec: number; ascentDurationSec: number };
}
export interface Wire { id: string; label: string; color: string; targetSocket: string; note?: string }
export interface Mechanics {
  fastener_unlock: { boltCount: number; targetTurnsDeg: number; toleranceDeg: number };
  vernier_ring: { initialOffsetDeg: number; targetDeg: number; toleranceDeg: number; holdLockSec: number };
  coupled_valves: { initialValves: Triple; solutionValves: Triple; couplingMatrix: [Triple, Triple, Triple]; safeBandHalfWidth: number };
  wire_patch: { wires: Wire[] };
  seam_weld: { checkpointCount: number; startAngleDeg: number; endAngleDeg: number; waveAmplitudeCm: number };
  wave_sliders: { initialSliders: Triple; targetSliders: Triple; labels: [string, string, string]; tolerance: number };
  nozzle_trim: { initialOffset: Pair; toleranceRadius: number; requireIgniterInsert: boolean };
  nosecone_arm: { requiredTwistDeg: number; toleranceDeg: number; requireSafetyGuard: boolean };
}
export type Mechanic = keyof Mechanics;
export type Step = { [K in Mechanic]: {
  id: string; order: number; title: string; shortLabel: string; instruction: string; mountId: string;
  mechanicType: K; params: Mechanics[K]; startEvent: string; hintEvent: string; completeEvent?: string;
} }[Mechanic];
export type StepOf<K extends Mechanic> = Extract<Step, { mechanicType: K }>;
export interface Mission { version: 1; id: string; displayName: string; targetDurationMinutes: number; steps: Step[] }
export interface ContentBundle {
  manifest: Manifest; heroine: Heroine; dialogue: Dialogue; events: Events; housing: Housing;
  environment: Environment; mission: Mission; heroineBase: URL; housingBase: URL;
}
