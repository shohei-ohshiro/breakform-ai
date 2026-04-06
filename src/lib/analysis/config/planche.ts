import { ThresholdRange } from "./shared";

/**
 * Planche evaluation thresholds.
 *
 * Ideal planche: shoulders well forward of wrists, body horizontal,
 * hips in line, elbows locked out.
 */
export const PLANCHE_CONFIG = {
  shoulderLean: {
    /** Shoulder-wrist horizontal separation (normalized) */
    leanDistance: { ideal: 0.5, warn: 0.3, fail: 0.15 } satisfies ThresholdRange,
    /** Angle from wrist to shoulder vs horizontal */
    leanAngle: { ideal: 75, warn: 55, fail: 35 } satisfies ThresholdRange,
    deductionPerDeg: 2.0,
  },

  bodyLine: {
    /** Spine angle deviation from 90° (horizontal) */
    spineDeviation: { ideal: 0, warn: 20, fail: 40 } satisfies ThresholdRange,
    /** Body Y-range (shoulder-hip-ankle height spread, normalized) */
    yRangeDeviation: { ideal: 0, warn: 0.5, fail: 1.0 } satisfies ThresholdRange,
    spineDeductionPerDeg: 1.5,
    yRangeDeductionMultiplier: 30,
  },

  hipSag: {
    /** How far hip drops below shoulder-ankle midline (normalized) */
    sag: { ideal: 0, warn: 0.15, fail: 0.4 } satisfies ThresholdRange,
    deductionMultiplier: 200,
  },

  elbowLockout: {
    /** Elbow angle — ideal is fully extended */
    angle: { ideal: 180, warn: 165, fail: 150 } satisfies ThresholdRange,
    deductionPerDeg: 3.0,
  },

  weights: {
    imageMode: [0.35, 0.30, 0.25, 0.10],
    videoMode: [0.25, 0.25, 0.20, 0.10, 0.20],
  },
} as const;
