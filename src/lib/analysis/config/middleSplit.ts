import { ThresholdRange } from "./shared";

/**
 * Middle Split (horizontal / straddle split, 横開脚) evaluation thresholds.
 *
 * Ideal: legs fully open to 180° on the ground, pelvis upright (neutral or
 * slightly anterior tilt), knees straight, feet pointing up, symmetric L/R.
 *
 * Important: we measure from pose landmarks only. These are proxies for
 * mobility/flexibility, not medical assessments.
 */
export const MIDDLE_SPLIT_CONFIG = {
  splitAngle: {
    /** Ideal angle between left-leg vector and right-leg vector (hip→ankle). */
    ideal: 180,
    /** warn/fail expressed as "degrees short of 180°". */
    warn: 10,
    fail: 25,
    /** Penalty per degree short of 180°. */
    deductionPerDeg: 1.0,
  },

  pelvis: {
    /** Hip-line roll from horizontal (front view). */
    roll: { ideal: 0, warn: 8, fail: 15 } satisfies ThresholdRange,
    /** Trunk backward lean proxy (shoulder–hip vector vs vertical). */
    tiltProxy: { ideal: 0, warn: 12, fail: 22 } satisfies ThresholdRange,
    /** Shoulder-vs-hip depth (z) difference — larger = more posterior tilt proxy. */
    tiltZProxy: { ideal: 0, warn: 0.15, fail: 0.3 } satisfies ThresholdRange,
    deductionPerDeg: 1.5,
    /** Penalty applied per unit of tiltZProxy deviation. */
    zDeductionPerUnit: 80,
  },

  kneeExtension: {
    /** Full knee extension target. */
    ideal: 180,
    warn: 10,
    fail: 25,
    /** Leg line (hip-knee-ankle) straightness — deviation from 180°. */
    legLineDeviationWarn: 12,
    legLineDeviationFail: 22,
    deductionPerDeg: 1.5,
  },

  symmetry: {
    /** Left vs right leg angle from horizontal (front view). */
    legAngleDiff: { ideal: 0, warn: 8, fail: 18 } satisfies ThresholdRange,
    /** Left vs right knee extension difference. */
    kneeExtensionDiff: { ideal: 0, warn: 8, fail: 18 } satisfies ThresholdRange,
    penaltyMultiplier: 3.0,
  },

  trunk: {
    /** Trunk lean from vertical (any direction). */
    leanAngle: { ideal: 0, warn: 18, fail: 30 } satisfies ThresholdRange,
    deductionPerDeg: 0.8,
  },

  turnoutHint: {
    /** L/R turnout asymmetry that triggers a "turnout bias" hint (non-scoring). */
    asymmetryWarn: 15,
  },

  /**
   * Category weights for the final score.
   * split_angle is intentionally dominant — that is the user-visible goal.
   */
  weights: {
    splitAngle: 0.4,
    pelvisPosture: 0.2,
    kneeExtension: 0.15,
    symmetry: 0.15,
    trunkCompensation: 0.1,
  },

  /** Minimum visibility to trust pelvis-related proxies. */
  minPelvisVisibility: 0.5,
  /** Minimum visibility to trust knee/leg line. */
  minLegVisibility: 0.4,
  /** Base confidence for pelvis tilt proxy in front-view images. */
  pelvisTiltBaseConfidence: 0.6,
} as const;
