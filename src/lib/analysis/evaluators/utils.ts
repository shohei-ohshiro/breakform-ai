/**
 * Shared evaluator utilities — single source of truth for
 * threshold classification, severity mapping, and violation ranking.
 */

import { RuleStatus, RuleViolation, CoverageInfo, AnalysisPhase, NormalizedTimeSeries, SamplingInfo } from "../types";

// ---- Threshold classification ----

/**
 * Classify a measured value against warn/fail thresholds.
 *
 * @param lowerIsBetter - true (default): value ≤ warn → pass.
 *                        false: value ≥ warn → pass (higher is better).
 */
export function classify(
  value: number,
  warn: number,
  fail: number,
  lowerIsBetter = true
): RuleStatus {
  if (lowerIsBetter) {
    if (value <= warn) return "pass";
    if (value <= fail) return "warn";
    return "fail";
  }
  if (value >= warn) return "pass";
  if (value >= fail) return "warn";
  return "fail";
}

/** Map RuleStatus → severity label. */
export function sev(status: RuleStatus): "critical" | "major" | "minor" {
  if (status === "fail") return "critical";
  if (status === "warn") return "major";
  return "minor";
}

// ---- Math helpers ----

export function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Compute a 0-100 sub-score from deviation and a per-unit deduction rate.
 * Clamps to [0, 100].
 */
export function scoreFromDeviation(
  deviation: number,
  deductionPerUnit: number
): number {
  return Math.round(Math.max(0, Math.min(100, 100 - deviation * deductionPerUnit)));
}

// ---- Violation ranking ----

const SEVERITY_ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 };

/**
 * Compute scoreImpact for a violation based on its deviation, weight, and severity.
 *
 * scoreImpact = deviation-based loss × category weight × severity multiplier
 * This gives a single number representing how much this violation hurt the final score.
 */
export function computeScoreImpact(
  deviation: number,
  deductionRate: number,
  categoryWeight: number,
  severity: "critical" | "major" | "minor"
): number {
  const severityMultiplier = severity === "critical" ? 1.0 : severity === "major" ? 0.7 : 0.4;
  const rawLoss = Math.min(100, deviation * deductionRate);
  return Math.round(rawLoss * categoryWeight * severityMultiplier * 10) / 10;
}

// ---- Coverage info builder ----

/**
 * Build a CoverageInfo object describing what was scanned and what was scored.
 * Called from each evaluator after determining the scoring window.
 */
export function buildCoverageInfo(
  series: NormalizedTimeSeries,
  scoringStartIdx: number,
  scoringEndIdx: number,
  scoringReason: string,
  sampling?: SamplingInfo
): CoverageInfo {
  const duration = series.duration;
  const scoringStartTime = series.frames[scoringStartIdx]?.timestamp ?? 0;
  const scoringEndTime = series.frames[scoringEndIdx]?.timestamp ?? duration;

  // Coarse scan always covers the full video (from first to last frame provided)
  const firstFrameTime = series.frames[0]?.timestamp ?? 0;
  const lastFrameTime = series.frames[series.frames.length - 1]?.timestamp ?? duration;

  // Use extraction diagnostics for more accurate reporting if available
  const diag = sampling?.extractionDiagnostics;
  const coarseFrameCount = diag
    ? diag.coarseFrameTimestamps.length
    : (sampling?.coarseSampleCount ?? series.frames.length);
  const refinedFrameCount = diag
    ? diag.refinedFrameTimestamps.length
    : (sampling?.refinedSampleCount ?? 0);

  const phases: AnalysisPhase[] = [
    {
      phase: "coarse_scan",
      description: diag
        ? `動画全体 ${firstFrameTime.toFixed(1)}〜${lastFrameTime.toFixed(1)}秒を ${coarseFrameCount} フレームで走査`
        : `動画全体 ${duration.toFixed(1)}秒を走査`,
      timeRange: [firstFrameTime, lastFrameTime],
      frameCount: coarseFrameCount,
    },
  ];

  // Add refine phases from sampling windows
  if (sampling && sampling.selectedWindows.length > 0) {
    for (const w of sampling.selectedWindows) {
      phases.push({
        phase: "refine",
        description: w.reason === "most_horizontal" ? "最も水平に近い区間を重点分析" :
          w.reason === "most_vertical" ? "最も垂直に近い区間を重点分析" :
          w.reason === "static_hold" ? "静止保持区間を重点分析" :
          w.reason === "high_movement" ? "動きの大きい区間を重点分析" :
          `${w.reason}区間を重点分析`,
        timeRange: [w.startTime, w.endTime],
        frameCount: w.framesExtracted,
      });
    }
  }

  phases.push({
    phase: "scoring",
    description: `${scoringStartTime.toFixed(1)}〜${scoringEndTime.toFixed(1)}秒を採点に使用`,
    timeRange: [scoringStartTime, scoringEndTime],
    frameCount: scoringEndIdx - scoringStartIdx + 1,
  });

  // Build human-readable summary with concrete time range
  let summary: string;
  const scanRangeStr = `${firstFrameTime.toFixed(1)}〜${lastFrameTime.toFixed(1)}秒`;
  const scoringRangeStr = `${scoringStartTime.toFixed(1)}〜${scoringEndTime.toFixed(1)}秒`;

  if (sampling && sampling.selectedWindows.length > 0) {
    const windowDescs = sampling.selectedWindows.map(w =>
      `${w.startTime.toFixed(1)}〜${w.endTime.toFixed(1)}秒`
    ).join("、");
    summary = `動画全体 ${scanRangeStr} を粗い走査（${coarseFrameCount}フレーム）で確認後、${windowDescs}の区間を重点分析（${refinedFrameCount}フレーム追加）し、最終採点には ${scoringRangeStr} を使用しました`;
  } else {
    summary = `動画全体 ${scanRangeStr} を ${coarseFrameCount} フレームで走査し、${scoringRangeStr} を採点に使用しました`;
  }

  return {
    fullScanPerformed: true,
    coarseScanTimeRange: [firstFrameTime, lastFrameTime],
    finalScoringWindow: {
      startTime: scoringStartTime,
      endTime: scoringEndTime,
      reason: scoringReason,
    },
    analysisPhases: phases,
    summary,
  };
}

/**
 * Rank violations by priority:
 * 1. scoreImpact (descending)
 * 2. severity (critical > major > minor)
 * 3. confidence (higher first — more certain issues surface)
 */
export function rankViolations(violations: RuleViolation[]): RuleViolation[] {
  return [...violations].sort((a, b) => {
    // Primary: scoreImpact (higher = more important)
    const impactDiff = (b.scoreImpact ?? 0) - (a.scoreImpact ?? 0);
    if (Math.abs(impactDiff) > 0.01) return impactDiff;

    // Secondary: severity
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;

    // Tertiary: confidence
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}
