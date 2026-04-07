import { Landmark } from "@/lib/types";

// ============================================
// Pose Data Types
// ============================================

/** Single frame of pose data with timestamp */
export interface PoseFrame {
  timestamp: number; // seconds from video start
  landmarks: Landmark[];
}

/** Time series of pose frames extracted from video */
export interface PoseTimeSeries {
  frames: PoseFrame[];
  fps: number;
  duration: number; // seconds
  sourceType: "image" | "video";
}

/** Normalized landmark (shoulder-width = 1.0, origin = hip midpoint) */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** Normalized pose frame */
export interface NormalizedFrame {
  timestamp: number;
  landmarks: NormalizedLandmark[];
  shoulderWidth: number; // original shoulder width in px-normalized coords
}

/** Normalized time series */
export interface NormalizedTimeSeries {
  frames: NormalizedFrame[];
  fps: number;
  duration: number;
  sourceType: "image" | "video";
}

// ============================================
// MediaPipe Landmark Indices
// ============================================

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

// ============================================
// Quality Check
// ============================================

export interface QualityCheckResult {
  passed: boolean;
  overallScore: number; // 0-1
  details: {
    avgVisibility: number;
    visibilityStdDev: number;
    lowVisibilityFrames: number;
    missingFrameRatio: number;
    outOfFrameRatio: number;
    sufficientFrames: boolean;
    subjectSize: number; // avg shoulder width as fraction of frame
    durationSufficient: boolean;
  };
  warnings: string[];
  failureReasons: string[];
  /** Should the user re-record? */
  retryRecommended: boolean;
  /** Low quality but still analyzable — results should be marked as reference only */
  analyzableAsReference: boolean;
}

// ============================================
// Feature Extraction
// ============================================

/** Per-frame joint angles */
export interface FrameAngles {
  timestamp: number;
  leftShoulder: number;
  rightShoulder: number;
  leftElbow: number;
  rightElbow: number;
  leftHip: number;
  rightHip: number;
  leftKnee: number;
  rightKnee: number;
  spineAngle: number;
  hipAlignment: number;
  shoulderAlignment: number;
}

/** Per-frame center of gravity */
export interface FrameCoG {
  timestamp: number;
  x: number;
  y: number;
}

/** Velocity of a landmark between frames */
export interface FrameVelocity {
  timestamp: number;
  landmarkIndex: number;
  vx: number;
  vy: number;
  speed: number;
}

/** Complete feature set for a time series */
export interface FeatureSet {
  angles: FrameAngles[];
  cog: FrameCoG[];
  velocities: Map<number, FrameVelocity[]>; // keyed by landmark index
  staticIntervals: StaticInterval[];
  frameCount: number;
  duration: number;
}

/** A detected interval where the pose is roughly static */
export interface StaticInterval {
  startTime: number;
  endTime: number;
  startIndex: number;
  endIndex: number;
  avgMovement: number; // average landmark movement per frame
}

// ============================================
// Serializable Feature Set (for JSON storage)
// ============================================

/**
 * **DB column: `feature_json`**
 *
 * Responsibility: Computed features derived from normalized pose data.
 * Contains everything needed to re-run evaluators WITHOUT re-running MediaPipe.
 *
 * What's here:
 * - Per-frame joint angles (time series)
 * - Per-frame center of gravity (time series)
 * - Per-landmark velocities (time series, keyed by landmark index)
 * - Detected static intervals
 * - Frame count and duration metadata
 *
 * What's NOT here (and why):
 * - Raw landmarks → too large; re-extractable from original video
 * - Normalized landmarks → derivable from raw landmarks
 * - Evaluation results → stored separately in rule_result_json
 *
 * Re-analysis: Load this + pass to evaluator directly.
 * Useful for: threshold tuning, A/B testing new evaluator logic.
 */
export interface FeatureSetJSON {
  angles: FrameAngles[];
  cog: FrameCoG[];
  velocities: Record<string, FrameVelocity[]>;
  staticIntervals: StaticInterval[];
  frameCount: number;
  duration: number;
}

export function featureSetToJSON(fs: FeatureSet): FeatureSetJSON {
  const velocities: Record<string, FrameVelocity[]> = {};
  for (const [key, value] of fs.velocities) {
    velocities[String(key)] = value;
  }
  return { ...fs, velocities };
}

// ============================================
// Evaluation (Rule-based)
// ============================================

export type TechniqueId = "handstand" | "planche" | "swipes";

export type RuleStatus = "pass" | "warn" | "fail";

export interface RuleViolation {
  ruleId: string;
  severity: "critical" | "major" | "minor";
  status: RuleStatus;
  bodyPart: string;
  message: string;
  actual: number;
  ideal: number;
  threshold: { warn: number; fail: number };
  deviation: number; // abs(actual - ideal)
  unit: string; // "deg", "ratio", etc.
  confidence: number; // 0-1, based on visibility / frame count
  /** How much this violation contributed to score loss (0–100 scale).
   *  Computed from deviation × deduction rate × category weight × severity multiplier.
   *  Used for ranking violations by importance. */
  scoreImpact?: number;
  /** Which static interval or phase this violation relates to */
  context?: {
    frameRange?: [number, number]; // [startIndex, endIndex]
    timeRange?: [number, number]; // [startTime, endTime]
    phase?: string;
  };
}

export interface ScoreBreakdown {
  category: string;
  label: string;
  score: number; // 0-100
  weight: number; // 0-1, sum of all weights = 1
  violations: RuleViolation[];
  /** Key measured values used to compute this score */
  measurements?: Record<string, number>;
  /** Frame range used for this evaluation */
  frameRange?: [number, number];
}

/**
 * **DB column: `rule_result_json`**
 *
 * Responsibility: Complete evaluation output — the primary audit artifact.
 * Explains exactly why a score was given.
 *
 * What's here:
 * - Final score + per-category breakdown (scores, weights, measurements)
 * - All violations with threshold comparisons, severity, confidence, scoreImpact
 * - Suggestion drafts (for Claude API to polish into natural language)
 * - Meta: which frames were analyzed, which config version, static interval used
 *
 * What's NOT here (and why):
 * - Raw feature data → stored in feature_json
 * - Claude API generated text → stored as issues/advice/summary
 * - Quality check → stored separately in quality_check_result
 *
 * events field: For swipes, contains detected events (hand_plant, leg_swing, phase_change).
 * For static techniques, this is empty. Also saved to `event_json` column separately
 * for indexed querying.
 */
export interface EvaluationResult {
  technique: TechniqueId;
  finalScore: number; // 0-100
  breakdown: ScoreBreakdown[];
  violations: RuleViolation[];
  events: TechniqueEvent[];
  suggestionsRaw: string[];
  meta: {
    analyzedFrameRange: [number, number];
    staticIntervalUsed: StaticInterval | null;
    totalFrames: number;
    configVersion: string;
    /** For static techniques: was the video classified as hold or entry? */
    evaluationMode?: "hold" | "entry";
    /** Duration (seconds) of the static interval used for evaluation */
    holdDuration?: number;
    /** Ratio of hold duration to total video duration (0-1) */
    holdRatio?: number;
    /** Human-readable note about confidence / evaluation mode */
    confidenceNote?: string;
  };
}

/**
 * **DB column: `event_json`** (array of these)
 *
 * Responsibility: Time-stamped events detected during dynamic techniques.
 * Stored separately from rule_result_json for indexed querying
 * (e.g. "find all analyses where hand_plant count < 2").
 *
 * Event types:
 * - "hand_plant": hand contacts ground (swipes)
 * - "leg_swing": ankle speed exceeds threshold (swipes)
 * - "phase_change": support phase transition (swipes)
 *
 * Empty for static techniques (handstand, planche).
 */
export interface TechniqueEvent {
  type: string;
  timestamp: number;
  frameIndex: number;
  details: Record<string, number | string>;
}

// ============================================
// Viewpoint Detection
// ============================================

export type Viewpoint = "front" | "side" | "back" | "top" | "unknown";

// ============================================
// Advice Generation (Claude API output)
// ============================================

export interface GeneratedAdvice {
  issues: {
    priority: number;
    body_part: string;
    description: string;
    ideal_angle?: number;
    actual_angle?: number;
  }[];
  advice: {
    type: "training" | "stretch" | "warmup" | "injury_prevention";
    related_issue: number;
    content: string;
  }[];
  summary: string;
}

// ============================================
// Full Pipeline Result
// ============================================

export interface PipelineInput {
  frames: PoseFrame[];
  technique: TechniqueId;
  sourceType: "image" | "video";
  fps: number;
  duration: number;
  userLevel?: "beginner" | "intermediate" | "advanced" | "expert";
}

export interface PipelineResult {
  // Final output (compatible with existing UI via adapter)
  score: number;
  issues: GeneratedAdvice["issues"];
  advice: GeneratedAdvice["advice"];
  summary: string;

  // Detailed data for storage
  qualityCheck: QualityCheckResult;
  featureJson: FeatureSetJSON;
  eventJson: TechniqueEvent[];
  ruleResultJson: EvaluationResult;
  viewpoint: Viewpoint;
  finalScore: number;
}

// ============================================
// DB Storage Schema (analyses table)
// ============================================

/**
 * Maps 1:1 to the `analyses` table columns added by the pipeline.
 * Used for type-safe DB reads when re-analyzing stored data.
 *
 * Columns and their source:
 * | Column               | Source           | Purpose                                      |
 * |----------------------|------------------|----------------------------------------------|
 * | feature_json         | FeatureSetJSON   | Re-run evaluators without MediaPipe           |
 * | event_json           | TechniqueEvent[] | Indexed event queries                         |
 * | rule_result_json     | EvaluationResult | Full audit: why was this score given?          |
 * | quality_check_result | QualityCheckResult| Was the input good enough?                   |
 * | viewpoint            | Viewpoint        | Camera angle for context                      |
 * | final_score          | number           | Quick-access score (denormalized from rule_result_json) |
 *
 * Re-analysis workflow:
 * 1. Load feature_json → deserialize as FeatureSetJSON
 * 2. Call evaluator(technique, features) with new thresholds
 * 3. Compare new rule_result_json with stored one
 */
export interface StoredAnalysisData {
  feature_json: FeatureSetJSON;
  event_json: TechniqueEvent[];
  rule_result_json: EvaluationResult;
  quality_check_result: QualityCheckResult;
  viewpoint: Viewpoint;
  final_score: number;
}
