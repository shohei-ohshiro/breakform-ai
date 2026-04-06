/**
 * Shared evaluator utilities — single source of truth for
 * threshold classification, severity mapping, and violation ranking.
 */

import { RuleStatus, RuleViolation } from "../types";

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
