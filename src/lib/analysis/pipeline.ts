/**
 * Analysis Pipeline — orchestrates the full flow.
 *
 * ## Data storage design
 *
 * What is saved to DB (analyses table):
 * - feature_json: Extracted features (angles, CoG, velocities, static intervals).
 *   Purpose: enables offline re-analysis without re-running MediaPipe.
 * - event_json: Technique events (hand plants, leg swings, phase changes).
 *   Purpose: audit trail for dynamic technique evaluation.
 * - rule_result_json: Full EvaluationResult with score breakdown and violations.
 *   Purpose: explains exactly why a score was given. Primary audit artifact.
 * - quality_check_result: Quality metrics for the input data.
 * - viewpoint, final_score: Quick-access fields for queries.
 *
 * What is NOT saved:
 * - Raw pose time series (landmarks per frame). These are large and can be
 *   re-extracted from the original video. If we later need to re-evaluate
 *   with updated rules, the user re-uploads or we store video references.
 * - Normalized poses — derivable from raw poses.
 *
 * Re-analysis strategy:
 * - feature_json is sufficient to re-run evaluators without MediaPipe.
 * - To test new thresholds, load feature_json + pass to evaluators directly.
 */

import {
  PipelineInput,
  PipelineResult,
  PoseTimeSeries,
  QualityCheckResult,
  QualityLevel,
  QualityImpactSummary,
  QualityImpact,
  SamplingInfo,
  EvaluationResult,
  featureSetToJSON,
  FeatureSetJSON,
} from "./types";
import { normalizePoseTimeSeries, detectViewpoint } from "./pose-normalizer";
import { checkQuality } from "./quality-checker";
import { extractFeatures } from "./feature-extractor";
import { evaluate } from "./evaluators";
import { generateAdvice, buildFallbackAdvice } from "./advice-generator";

export async function runPipeline(
  input: PipelineInput,
  anthropicApiKey: string
): Promise<PipelineResult> {
  const timeSeries: PoseTimeSeries = {
    frames: input.frames,
    fps: input.fps,
    duration: input.duration,
    sourceType: input.sourceType,
  };

  // 1. Quality check (with technique-specific rules)
  const qualityCheck = checkQuality(timeSeries, input.technique);

  // 2. Detect viewpoint
  const viewpoint =
    input.frames.length > 0
      ? detectViewpoint(input.frames[0].landmarks)
      : "unknown";

  // If quality is too low AND not even reference-analyzable, return early
  if (!qualityCheck.passed && !qualityCheck.analyzableAsReference) {
    const qLevel = computeQualityLevel(qualityCheck);
    return {
      score: 0,
      issues: [
        {
          priority: 1,
          body_part: "全体",
          description: `品質チェック不合格: ${qualityCheck.failureReasons.join("、")}`,
        },
      ],
      advice: [
        {
          type: "training",
          related_issue: 1,
          content: qualityCheck.retryRecommended
            ? "人物がはっきり映るように撮影し直してください。全身が画面内に収まり、十分な明るさがあることを確認してください。"
            : "分析精度が低い可能性があります。",
        },
      ],
      summary: "分析に十分な品質のデータが得られませんでした。",
      qualityCheck,
      featureJson: emptyFeatureJson(),
      eventJson: [],
      ruleResultJson: {
        technique: input.technique,
        finalScore: 0,
        breakdown: [],
        violations: [],
        events: [],
        suggestionsRaw: [],
        meta: {
          analyzedFrameRange: [0, 0],
          staticIntervalUsed: null,
          totalFrames: 0,
          configVersion: "2.0",
        },
      },
      viewpoint,
      finalScore: 0,
      qualityLevel: qLevel,
      qualityExplanation: computeQualityExplanation(qualityCheck, qLevel),
    };
  }

  // 3. Normalize
  const normalized = normalizePoseTimeSeries(timeSeries);

  // 4. Extract features
  const features = extractFeatures(normalized);

  // 5. Evaluate (pass sampling so evaluators can include coverage info)
  const evaluation = evaluate(input.technique, normalized, features, input.sampling);

  // 5b. Attach sampling metadata if available
  if (input.sampling) {
    evaluation.meta.sampling = input.sampling;
  }

  // 5c. Compute quality impact summary
  evaluation.meta.qualityImpactSummary = computeQualityImpact(qualityCheck, evaluation);

  // 6. Generate advice
  let generatedAdvice;
  try {
    generatedAdvice = await generateAdvice(
      anthropicApiKey,
      evaluation,
      qualityCheck,
      viewpoint,
      input.userLevel ?? "beginner"
    );
  } catch (error) {
    console.error("Claude API advice generation failed, using fallback:", error);
    generatedAdvice = buildFallbackAdvice(evaluation);
  }

  const qualityLevel = computeQualityLevel(qualityCheck);

  return {
    score: evaluation.finalScore,
    issues: generatedAdvice.issues,
    advice: generatedAdvice.advice,
    summary: generatedAdvice.summary,
    qualityCheck,
    featureJson: featureSetToJSON(features),
    eventJson: evaluation.events,
    ruleResultJson: evaluation,
    viewpoint,
    finalScore: evaluation.finalScore,
    qualityLevel,
    qualityExplanation: computeQualityExplanation(qualityCheck, qualityLevel),
  };
}

/**
 * Compute a 3-level quality classification for UI display.
 * - "good": quality passed, few warnings
 * - "reference": borderline quality, results should be treated as reference
 * - "retry": quality too low, re-record recommended
 */
function computeQualityLevel(quality: QualityCheckResult): QualityLevel {
  if (quality.passed && quality.warnings.length <= 1) return "good";
  if (quality.passed) return "good"; // passed but with warnings is still "good"
  if (quality.analyzableAsReference) return "reference";
  return "retry";
}

function computeQualityExplanation(quality: QualityCheckResult, level: QualityLevel): string {
  if (level === "good") return "";
  if (level === "reference") {
    return "品質に注意点がありますが、参考分析として採点しました。数値は目安としてご活用ください。";
  }
  return "分析に十分な品質のデータが得られませんでした。再撮影をおすすめします。";
}

/**
 * Compute how quality warnings affected the analysis results.
 * Produces a reliability score and per-warning impact descriptions.
 */
function computeQualityImpact(
  quality: QualityCheckResult,
  evaluation: EvaluationResult
): QualityImpactSummary {
  const impacts: QualityImpact[] = [];
  let reliabilityPenaltyTotal = 0;

  const details = quality.details;

  // Subject size impact
  if (details.subjectSize > 0 && details.subjectSize < 0.15) {
    const penalty = details.subjectSize < 0.08 ? 0.25 : 0.12;
    reliabilityPenaltyTotal += penalty;
    impacts.push({
      category: "subject_size",
      description: `被写体が小さく（肩幅: フレームの${(details.subjectSize * 100).toFixed(0)}%）、関節角度の推定精度が低下しています。肘伸展と体幹ラインの評価に影響します。`,
      reliabilityPenalty: penalty,
      affectedCategories: ["elbow_lockout", "body_line"],
    });
  }

  // Visibility impact
  if (details.avgVisibility < 0.7) {
    const penalty = details.avgVisibility < 0.4 ? 0.3 : 0.15;
    reliabilityPenaltyTotal += penalty;
    const desc = details.avgVisibility < 0.4
      ? `骨格検出精度が低く（${(details.avgVisibility * 100).toFixed(0)}%）、全カテゴリの評価信頼度が低下しています。`
      : `骨格検出精度がやや低く（${(details.avgVisibility * 100).toFixed(0)}%）、微細な角度差の判定が不安定な可能性があります。`;
    impacts.push({
      category: "visibility",
      description: desc,
      reliabilityPenalty: penalty,
      affectedCategories: ["shoulder_lean", "body_line", "hip_sag", "elbow_lockout"],
    });
  }

  // Skeleton gap / missing frames
  if (details.missingFrameRatio > 0.1) {
    const penalty = details.missingFrameRatio > 0.3 ? 0.2 : 0.1;
    reliabilityPenaltyTotal += penalty;
    impacts.push({
      category: "skeleton_gap",
      description: `一部の区間で骨格が検出できておらず（${(details.missingFrameRatio * 100).toFixed(0)}%欠損）、最適な採点区間を見逃している可能性があります。`,
      reliabilityPenalty: penalty,
      affectedCategories: ["stability", "entry_quality"],
    });
  }

  // Out of frame
  if (details.outOfFrameRatio > 0.15) {
    const penalty = details.outOfFrameRatio > 0.4 ? 0.2 : 0.1;
    reliabilityPenaltyTotal += penalty;
    impacts.push({
      category: "out_of_frame",
      description: `体の一部がフレーム外に出ているフレームが${(details.outOfFrameRatio * 100).toFixed(0)}%あり、脚や足先の評価精度が低下しています。`,
      reliabilityPenalty: penalty,
      affectedCategories: ["hip_sag", "body_line"],
    });
  }

  // Short hold (for hold mode)
  if (evaluation.meta.evaluationMode === "hold" && evaluation.meta.holdDuration != null) {
    if (evaluation.meta.holdDuration < 2.0 && evaluation.meta.holdDuration >= 1.0) {
      const penalty = 0.1;
      reliabilityPenaltyTotal += penalty;
      impacts.push({
        category: "short_hold",
        description: `静止保持が${evaluation.meta.holdDuration.toFixed(1)}秒と短めです。2秒以上の保持でより安定した評価になります。`,
        reliabilityPenalty: penalty,
        affectedCategories: ["stability"],
      });
    }
  }

  // Frame instability
  if (details.visibilityStdDev > 0.1) {
    const penalty = 0.08;
    reliabilityPenaltyTotal += penalty;
    impacts.push({
      category: "frame_instability",
      description: `フレーム間でvisibilityが不安定（σ=${details.visibilityStdDev.toFixed(2)}）で、フレームごとの評価にばらつきが出ています。`,
      reliabilityPenalty: penalty,
      affectedCategories: ["stability", "entry_quality"],
    });
  }

  const reliability = Math.max(0, Math.min(1, 1 - reliabilityPenaltyTotal));

  return { reliability, impacts };
}

function emptyFeatureJson(): FeatureSetJSON {
  return {
    angles: [],
    cog: [],
    velocities: {},
    staticIntervals: [],
    frameCount: 0,
    duration: 0,
  };
}
