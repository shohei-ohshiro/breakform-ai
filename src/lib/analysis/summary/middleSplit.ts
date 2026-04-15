/**
 * Build a versioned StructuredSummary for middle_split.
 *
 * This is the canonical form that UI / history / Claude API input all consume.
 * Free-text summaries are derived from this — not the other way around.
 */

import {
  EvaluationResult,
  FeatureSet,
  QualityLevel,
  RetakeReason,
  StructuredSummary,
  RuleViolation,
} from "../types";
import { MIDDLE_SPLIT_ADVICE } from "../copy/middleSplit";

const EVALUATOR_VERSION = "middle_split_1.0";
const SUMMARY_VERSION = "middle_split_summary_v1";

interface BuildSummaryInput {
  evaluation: EvaluationResult;
  features: FeatureSet;
  reliability: number;
  qualityLevel: QualityLevel;
  retakeReasons: RetakeReason[];
}

export function buildMiddleSplitSummary(
  input: BuildSummaryInput,
): StructuredSummary {
  const { evaluation, features, reliability, qualityLevel, retakeReasons } =
    input;
  const f = features.middleSplit;

  const splitAngle = f?.splitAngleRaw ?? 0;
  const target = 180;
  const progressRatio = Math.max(0, Math.min(1, splitAngle / target));

  const headline =
    splitAngle > 0
      ? `開脚角度は約${Math.round(splitAngle)}°。180°まで残り${Math.max(0, Math.round(target - splitAngle))}°の目安です。`
      : "十分な計測ができませんでした。";

  // Positive notes — call out what's going well before surfacing limiters.
  const positiveNotes: string[] = [];
  if (f) {
    if (f.leftKneeExtension >= 170 && f.rightKneeExtension >= 170) {
      positiveNotes.push("両膝がしっかり伸びている状態です");
    }
    if (f.leftRightAngleDiff <= 5) {
      positiveNotes.push("左右の脚の高さはよく揃っています");
    }
    if (f.pelvisRollAngle <= 5) {
      positiveNotes.push("骨盤の左右傾きは小さく安定しています");
    }
    if (f.trunkLeanAngle <= 5) {
      positiveNotes.push("体幹もまっすぐ保たれています");
    }
  }

  // Rank violations by score impact, take top 3 as primary limiters.
  const ranked = [...evaluation.violations]
    .filter((v) => (v.scoreImpact ?? 0) > 0)
    .sort((a, b) => (b.scoreImpact ?? 0) - (a.scoreImpact ?? 0));

  const primaryLimiters = ranked.slice(0, 3).map((v) => ({
    id: v.ruleId,
    label: limiterLabel(v),
    severity: v.severity as "minor" | "major" | "critical",
    finding: v.message,
    evidence: {
      metric: v.ruleId,
      value: typeof v.actual === "number" ? v.actual : 0,
      unit: v.unit,
      threshold: v.threshold,
    },
    estimatedImpact: Math.round((v.scoreImpact ?? 0) * 10) / 10,
  }));

  // Improvement priorities — one per limiter, mapped to a template.
  const improvementPriorities = primaryLimiters.map((l) => ({
    forLimiterId: l.id,
    focus: focusForLimiter(l.id),
    practice: practiceForLimiter(l.id),
    durationHint: "片側30秒 × 3セットを目安に",
  }));

  // Reliability factors — surface the main inputs to reliability.
  const factors: StructuredSummary["reliabilitySummary"]["factors"] = [];
  if (f) {
    factors.push({ name: "正面視", score: round2(f.frontalityScore) });
    factors.push({
      name: "骨格検出",
      score: round2(f.keyLandmarkVisibility),
    });
  }

  const reliabilityNote = f
    ? `信頼度の目安: ${Math.round(reliability * 100)}% (正面視: ${Math.round(f.frontalityScore * 100)}%, 骨格検出: ${Math.round(f.keyLandmarkVisibility * 100)}%)`
    : `信頼度の目安: ${Math.round(reliability * 100)}%`;

  const urgency: "none" | "suggested" | "required" =
    qualityLevel === "retry"
      ? "required"
      : qualityLevel === "reference"
        ? "suggested"
        : "none";

  const mainFindings: string[] = [];
  if (primaryLimiters.length > 0) {
    mainFindings.push(`開脚角度 約${Math.round(splitAngle)}°`);
    for (const lim of primaryLimiters.slice(0, 2)) {
      mainFindings.push(lim.label);
    }
  } else if (splitAngle > 0) {
    mainFindings.push(`開脚角度 約${Math.round(splitAngle)}°（主要な改善点は見つかりませんでした）`);
  }

  return {
    version: SUMMARY_VERSION,
    currentStateSummary: {
      headline,
      score: evaluation.finalScore,
      mainMetric: {
        label: "開脚角度",
        value: Math.round(splitAngle),
        unit: "°",
        target,
        progressRatio: round2(progressRatio),
      },
      positiveNotes,
    },
    primaryLimiters,
    improvementPriorities,
    reliabilitySummary: {
      overall: round2(reliability),
      level: qualityLevel,
      factors,
      note: reliabilityNote,
    },
    retakeAdvice: {
      recommended: retakeReasons.length > 0,
      urgency,
      reasons: retakeReasons,
    },
    mainFindings,
    meta: {
      technique: "middle_split",
      evaluatorVersion: EVALUATOR_VERSION,
      configVersion: EVALUATOR_VERSION,
      generatedAt: new Date().toISOString(),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function limiterLabel(v: RuleViolation): string {
  const map: Record<string, string> = {
    middle_split_angle_insufficient: "開脚角度の不足",
    middle_split_pelvis_roll: "骨盤の左右傾き",
    middle_split_pelvis_tilt: "骨盤の前後傾き",
    middle_split_pelvis_tilt_back: "骨盤が後傾する傾向",
    middle_split_knee_bend_left: "左膝の軽い曲がり",
    middle_split_knee_bend_right: "右膝の軽い曲がり",
    middle_split_leg_line_left: "左脚のラインのズレ",
    middle_split_leg_line_right: "右脚のラインのズレ",
    middle_split_asymmetry_leg_height: "左右の脚の高さ差",
    middle_split_asymmetry_knee: "左右の膝伸展差",
    middle_split_turnout_asymmetry: "つま先方向の左右差",
    middle_split_trunk_lean: "体幹の傾き",
  };
  return map[v.ruleId] ?? v.bodyPart;
}

function focusForLimiter(id: string): string {
  if (id.includes("angle_insufficient")) return "股関節まわりの可動域づくり";
  if (id.includes("pelvis_tilt_back")) return "骨盤を立てる意識";
  if (id.includes("pelvis")) return "骨盤の向きを整える";
  if (id.includes("knee_bend") || id.includes("leg_line"))
    return "膝を伸ばしたまま止める";
  if (id.includes("asymmetry_leg_height") || id.includes("asymmetry_knee"))
    return "左右差を埋める";
  if (id.includes("trunk")) return "体幹をまっすぐ保つ";
  if (id.includes("turnout")) return "つま先方向のバランス調整";
  return "フォームの微調整";
}

function practiceForLimiter(id: string): string {
  if (id.includes("angle_insufficient")) return MIDDLE_SPLIT_ADVICE.splitAngle;
  if (id.includes("pelvis")) return MIDDLE_SPLIT_ADVICE.pelvis;
  if (id.includes("knee_bend") || id.includes("leg_line"))
    return MIDDLE_SPLIT_ADVICE.knee;
  if (id.includes("asymmetry_leg_height") || id.includes("asymmetry_knee"))
    return MIDDLE_SPLIT_ADVICE.asymmetry;
  if (id.includes("trunk")) return MIDDLE_SPLIT_ADVICE.trunk;
  return MIDDLE_SPLIT_ADVICE.splitAngle;
}
