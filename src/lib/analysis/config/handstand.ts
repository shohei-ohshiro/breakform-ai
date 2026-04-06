import { ThresholdRange } from "./shared";

/**
 * Handstand evaluation thresholds.
 *
 * Ideal handstand: body straight vertical, shoulders fully open,
 * CoG directly over wrist base, perfect L-R symmetry.
 */
export const HANDSTAND_CONFIG = {
  alignment: {
    spine: { ideal: 0, warn: 15, fail: 30 } satisfies ThresholdRange,
    hipExtension: { ideal: 180, warn: 165, fail: 150 } satisfies ThresholdRange,
    kneeExtension: { ideal: 180, warn: 170, fail: 155 } satisfies ThresholdRange,
    /** Sub-category weights within alignment score */
    weights: { spine: 0.5, hip: 0.3, knee: 0.2 },
    /** Penalty per degree of deviation */
    spineDeductionPerDeg: 2.5,
    hipDeductionPerDeg: 2.0,
    kneeDeductionPerDeg: 2.0,
  },

  shoulderPush: {
    angle: { ideal: 180, warn: 165, fail: 150 } satisfies ThresholdRange,
    /** Shoulder-to-ear separation (normalized) */
    elevation: { ideal: 0.5, warn: 0.3, fail: 0.15 } satisfies ThresholdRange,
    deductionPerDeg: 2.5,
  },

  centerOfGravity: {
    /** CoG X-offset from wrist midpoint (normalized) */
    offset: { ideal: 0, warn: 0.3, fail: 0.6 } satisfies ThresholdRange,
    deductionMultiplier: 150,
  },

  /** Breakdown weights: [alignment, shoulder, cog, symmetry] or +stability */
  weights: {
    imageMode: [0.35, 0.25, 0.25, 0.15],
    videoMode: [0.25, 0.20, 0.20, 0.15, 0.20],
  },
} as const;
