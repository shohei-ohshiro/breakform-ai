/**
 * Shared evaluation config — thresholds used across multiple evaluators.
 *
 * All angles in degrees, distances in shoulder-width-normalized units.
 * Each threshold has:
 *   - warn: triggers a "minor" or "major" violation
 *   - fail: triggers a "critical" violation
 *   - ideal: the target value
 */

export interface ThresholdRange {
  ideal: number;
  warn: number;
  fail: number;
}

export interface RangeWindow {
  ideal: [number, number]; // [min, max]
  warn: [number, number];
  fail: [number, number];
}

export const STABILITY_THRESHOLDS = {
  cogVariance: {
    ideal: 0,
    warn: 0.05,
    fail: 0.15,
  } satisfies ThresholdRange,
  scorePenaltyMultiplier: 500,
};

export const SYMMETRY_THRESHOLDS = {
  shoulderDiff: { ideal: 0, warn: 15, fail: 30 } satisfies ThresholdRange,
  hipDiff: { ideal: 0, warn: 15, fail: 25 } satisfies ThresholdRange,
  hipTilt: { ideal: 0, warn: 10, fail: 20 } satisfies ThresholdRange,
  penaltyMultiplier: 1.5,
};

export const STATIC_DETECTION = {
  movementThreshold: 0.15, // normalized units per second
  minDuration: 0.3, // seconds
};

export const QUALITY_THRESHOLDS = {
  minVisibility: 0.3,
  minFramesImage: 1,
  minFramesVideo: 5,
  maxOutOfFrameRatio: 0.5,
  maxLowVisRatio: 0.4,
  minSubjectSize: 0.15, // shoulder width must be at least 15% of frame
  maxVisibilityVariance: 0.15, // std dev of per-frame avg visibility
  minDurationSwipes: 1.5, // seconds — swipes need longer video
  qualityPassThreshold: 0.4,
};
