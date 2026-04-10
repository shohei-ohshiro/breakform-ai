import { ThresholdRange } from "./shared";

/**
 * Swipes evaluation thresholds — v3.0
 *
 * Swipes is a dynamic rotational move. The v3.0 evaluator decomposes one
 * rotation into 5 phases (entry → support → kick → rotation → landing),
 * extracts cycles via event detection, picks the clearest cycle as the
 * scoring window, and grades it on 5 categories (or 4 in single-cycle mode).
 */
export const SWIPES_CONFIG = {
  general: {
    minFrames: 5,
    /** Top-N candidate windows to retain for transparency */
    candidateWindowsTopN: 5,
  },

  // ---- Event detection ----
  handPlant: {
    /** Wrist Y below this = hand on ground (normalized, Y-up). Static fallback. */
    yThreshold: -1.5,
    /** Dynamic threshold offset from CoG.y (sigma below center of gravity) */
    dynamicOffsetSigma: 1.0,
    /** Timing consistency: coefficient of variation */
    timingCV: { ideal: 0, warn: 0.3, fail: 0.5 } satisfies ThresholdRange,
  },

  legSwing: {
    /** Minimum ankle speed to count as a kick (normalized units/sec) */
    speedMin: 2.0,
    speedGood: 3.0,
    speedIdeal: 4.0,
    /** Symmetry: |L - R| / mean. Higher = more asymmetric */
    symmetry: { ideal: 0, warn: 0.3, fail: 0.6 } satisfies ThresholdRange,
  },

  phaseTransition: {
    /** Phases must persist this long (sec) before being committed (debounce) */
    debounceFrames: 2,
    minPhaseDuration: 0.05,
  },

  // ---- Cycle extraction ----
  cycle: {
    /** Min duration for a valid cycle (sec) */
    minCycleDuration: 0.3,
    /** Max duration before splitting into separate cycles (sec) */
    maxCycleDuration: 4.0,
    /** Buffer added to cycle frame range for evaluation (frames) */
    cycleBufferFrames: 2,
  },

  // ---- Evaluator categories ----
  supportStability: {
    /** Min elbow angle during support (lower = more bent) */
    elbowAngle: { ideal: 170, warn: 150, fail: 120 } satisfies ThresholdRange,
    /** Wrist position jitter during support (normalized units) */
    wristJitter: { ideal: 0, warn: 0.15, fail: 0.3 } satisfies ThresholdRange,
    deductionPerDeg: 0.5,
    jitterMultiplier: 100,
  },

  entryQuality: {
    /** Hip angle at hand plant moment (open → good) */
    hipAngle: { ideal: 110, warn: 90, fail: 60 } satisfies ThresholdRange,
    /** Shoulder forward distance from wrist (X-axis, normalized) */
    shoulderForward: { ideal: 0.3, warn: 0.1, fail: -0.1 } satisfies ThresholdRange,
    deductionPerDeg: 0.5,
    forwardMultiplier: 80,
  },

  kickPower: {
    deductionPerSpeedUnit: 25,
    asymmetryMultiplier: 50,
  },

  rotationQuality: {
    /** Spine deviation from horizontal (90°) during rotation phase */
    horizontality: { ideal: 0, warn: 25, fail: 50 } satisfies ThresholdRange,
    /** CoG horizontal range during cycle (shoulder-width units) */
    cogRange: { ideal: 1.0, warn: 0.5, fail: 0.2 } satisfies ThresholdRange,
    /** Min number of phase changes per cycle (hands→aerial→feet etc.) */
    minPhaseChanges: 2,
    deductionPerDeg: 0.6,
    cogMultiplier: 30,
  },

  repConsistency: {
    /** Cycle duration relative deviation */
    timingDeviation: { ideal: 0, warn: 0.3, fail: 0.5 } satisfies ThresholdRange,
    /** Kick speed relative deviation */
    speedDeviation: { ideal: 0, warn: 0.4, fail: 0.7 } satisfies ThresholdRange,
  },

  // ---- Quality impact ----
  quality: {
    /** Wrist visibility threshold below which support_stability is penalized */
    wristVisibilityWarn: 0.5,
    wristVisibilityFail: 0.3,
    /** Ankle visibility threshold below which kick_power is penalized */
    ankleVisibilityWarn: 0.5,
    ankleVisibilityFail: 0.3,
    /** Frame movement above which motion blur is suspected (normalized units) */
    motionBlurThreshold: 0.4,
    /** Out-of-frame ratio above which warning fires */
    outOfFrameWarn: 0.1,
    outOfFrameFail: 0.25,
  },

  // ---- Mode rules ----
  mode: {
    /** Cycles required for multi_cycle mode */
    multiCycleMinCycles: 2,
    /** Score upper cap for partial mode */
    partialScoreCap: 70,
  },

  weights: {
    /** multi_cycle mode: support / entry / kick / rotation / rep */
    multiCycle: [0.20, 0.20, 0.20, 0.25, 0.15] as const,
    /** single_cycle mode: support / entry / kick / rotation */
    singleCycle: [0.20, 0.25, 0.25, 0.30] as const,
    /** partial mode: same shape as singleCycle, but score is capped */
    partial: [0.20, 0.25, 0.25, 0.30] as const,
  },

  // ---- Candidate window scoring weights (composite score, lower = better) ----
  candidate: {
    cycleClarityWeight: 0.35,
    rotationHorizontalityWeight: 0.25,
    visibilityWeight: 0.20,
    kickPeakWeight: 0.10,
    edgeProximityWeight: 0.10,
    /** Edge bonus penalty for cycles ending within last few frames */
    edgePenaltyMax: 5,
  },
} as const;
