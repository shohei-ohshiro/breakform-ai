import { ThresholdRange } from "./shared";

/**
 * Swipes evaluation thresholds.
 *
 * Swipes is a dynamic rotational move — evaluated via event detection,
 * NOT single-frame analysis.
 */
export const SWIPES_CONFIG = {
  general: {
    minFrames: 5,
  },

  handPlant: {
    /** Wrist Y below this = hand on ground (normalized, Y-up) */
    yThreshold: -1.5,
    /** Timing consistency: coefficient of variation */
    timingCV: { ideal: 0, warn: 0.3, fail: 0.5 } satisfies ThresholdRange,
  },

  entryPosture: {
    /** Hip angle at hand plant moment */
    hipAngle: { ideal: 110, warn: 90, fail: 60 } satisfies ThresholdRange,
  },

  legSwing: {
    /** Minimum ankle speed to count as a kick (normalized units/sec) */
    speedMin: 2.0,
    /** Good kick speed */
    speedGood: 3.0,
    /** Speed for perfect score */
    speedIdeal: 4.0,
  },

  phaseTransition: {
    /** Minimum phase duration before it's considered jerky */
    minPhaseDuration: 0.05, // seconds
  },

  repConsistency: {
    /** Timing relative deviation */
    timingDeviation: { ideal: 0, warn: 0.3, fail: 0.5 } satisfies ThresholdRange,
    /** Swing speed relative deviation */
    speedDeviation: { ideal: 0, warn: 0.4, fail: 0.7 } satisfies ThresholdRange,
  },

  weights: {
    fourCategory: [0.25, 0.25, 0.25, 0.25],
    fiveCategory: [0.20, 0.20, 0.20, 0.25, 0.15],
  },
} as const;
