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
  SamplingInfo,
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
    // Update coverageInfo with sampling refinement phases
    if (evaluation.meta.coverageInfo && input.sampling.selectedWindows.length > 0) {
      evaluation.meta.coverageInfo.summary = evaluation.meta.coverageInfo.summary;
    }
  }

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
