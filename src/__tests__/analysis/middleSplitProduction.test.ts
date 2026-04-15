import { describe, it, expect } from "vitest";
import {
  MIDDLE_SPLIT_ADVICE,
  MIDDLE_SPLIT_BANNED_TERMS,
  findBannedTerms,
  sanitizeMiddleSplitText,
} from "@/lib/analysis/copy/middleSplit";
import { buildMiddleSplitSummary } from "@/lib/analysis/summary/middleSplit";
import { evaluate } from "@/lib/analysis/evaluators";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { buildFallbackAdvice } from "@/lib/analysis/advice-generator";
import {
  makeMiddleSplitLandmarks,
  makeImageSeries,
} from "./mock-data";
import type {
  EvaluationResult,
  FeatureSet,
  RetakeReason,
} from "@/lib/analysis/types";

/**
 * Sprint 1 productionization tests for middle_split:
 * - UX copy tone guardrails (banned terms)
 * - Structured summary shape and content
 * - Fallback advice sanitization
 */

function runMiddleSplit(angleDeg: number): {
  evaluation: EvaluationResult;
  features: FeatureSet;
} {
  const series = makeImageSeries(makeMiddleSplitLandmarks(angleDeg));
  const normalized = normalizePoseTimeSeries(series);
  const features = extractFeatures(normalized, "middle_split");
  const evaluation = evaluate("middle_split", normalized, features);
  return { evaluation, features };
}

describe("middle_split UX copy guardrails", () => {
  it("canonical advice templates contain no banned terms", () => {
    for (const [key, text] of Object.entries(MIDDLE_SPLIT_ADVICE)) {
      const hits = findBannedTerms(text);
      expect(
        hits,
        `MIDDLE_SPLIT_ADVICE.${key} contains banned term(s): ${hits.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("sanitizeMiddleSplitText replaces every banned term", () => {
    for (const term of MIDDLE_SPLIT_BANNED_TERMS) {
      const withTerm = `前提として${term}があります`;
      const cleaned = sanitizeMiddleSplitText(withTerm);
      expect(cleaned).not.toContain(term);
    }
  });

  it("evaluator suggestions use sanctioned copy only", () => {
    // A narrow split triggers most violation paths (split_angle, knee, etc.)
    const { evaluation } = runMiddleSplit(110);
    for (const s of evaluation.suggestionsRaw) {
      expect(findBannedTerms(s)).toEqual([]);
    }
    for (const v of evaluation.violations) {
      expect(findBannedTerms(v.message)).toEqual([]);
    }
  });

  it("buildFallbackAdvice output is sanitized for middle_split", () => {
    const { evaluation } = runMiddleSplit(110);
    const fallback = buildFallbackAdvice(evaluation);
    expect(findBannedTerms(fallback.summary)).toEqual([]);
    for (const i of fallback.issues) {
      expect(findBannedTerms(i.description)).toEqual([]);
      expect(findBannedTerms(i.body_part)).toEqual([]);
    }
    for (const a of fallback.advice) {
      expect(findBannedTerms(a.content)).toEqual([]);
    }
    // Safety footer must appear in the summary
    expect(fallback.summary).toContain("痛みを感じたら中止してください");
  });
});

describe("middle_split structured summary (middle_split_summary_v1)", () => {
  it("builds a v1 summary with the expected top-level shape", () => {
    const { evaluation, features } = runMiddleSplit(160);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.82,
      qualityLevel: "good",
      retakeReasons: [],
    });

    expect(summary.version).toBe("middle_split_summary_v1");
    expect(summary.meta.technique).toBe("middle_split");
    expect(summary.meta.evaluatorVersion).toBe("middle_split_1.0");
    expect(summary.currentStateSummary.mainMetric.label).toBe("開脚角度");
    expect(summary.currentStateSummary.mainMetric.target).toBe(180);
    expect(summary.currentStateSummary.mainMetric.unit).toBe("°");
    // Score is forwarded from evaluation
    expect(summary.currentStateSummary.score).toBe(evaluation.finalScore);
  });

  it("headline mentions split angle when features are present", () => {
    const { evaluation, features } = runMiddleSplit(150);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.8,
      qualityLevel: "good",
      retakeReasons: [],
    });
    expect(summary.currentStateSummary.headline).toMatch(/°/);
    // MainMetric value should be close to the generated angle
    expect(summary.currentStateSummary.mainMetric.value).toBeGreaterThanOrEqual(
      140,
    );
    expect(summary.currentStateSummary.mainMetric.value).toBeLessThanOrEqual(
      160,
    );
  });

  it("primaryLimiters respect the top-3 cap and include evidence", () => {
    const { evaluation, features } = runMiddleSplit(100);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.7,
      qualityLevel: "reference",
      retakeReasons: [],
    });
    expect(summary.primaryLimiters.length).toBeLessThanOrEqual(3);
    for (const lim of summary.primaryLimiters) {
      expect(lim.id).toBeTruthy();
      expect(lim.label).toBeTruthy();
      expect(lim.evidence.metric).toBeTruthy();
      expect(["minor", "major", "critical"]).toContain(lim.severity);
    }
  });

  it("improvementPriorities map 1:1 to primaryLimiters", () => {
    const { evaluation, features } = runMiddleSplit(100);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.7,
      qualityLevel: "reference",
      retakeReasons: [],
    });
    expect(summary.improvementPriorities.length).toBe(
      summary.primaryLimiters.length,
    );
    for (let i = 0; i < summary.primaryLimiters.length; i++) {
      expect(summary.improvementPriorities[i].forLimiterId).toBe(
        summary.primaryLimiters[i].id,
      );
      expect(summary.improvementPriorities[i].practice).toBeTruthy();
    }
  });

  it("reliabilitySummary carries level, overall, factors, and a note", () => {
    const { evaluation, features } = runMiddleSplit(160);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.6,
      qualityLevel: "reference",
      retakeReasons: [],
    });
    expect(summary.reliabilitySummary.overall).toBe(0.6);
    expect(summary.reliabilitySummary.level).toBe("reference");
    expect(summary.reliabilitySummary.factors.length).toBeGreaterThan(0);
    expect(summary.reliabilitySummary.note).toContain("信頼度");
  });

  it("retakeAdvice urgency tracks qualityLevel and reflects reasons", () => {
    const { evaluation, features } = runMiddleSplit(160);
    const reasons: RetakeReason[] = [
      {
        code: "low_frontality",
        message: "正面から撮影されていない可能性があります",
        howToFix: "カメラをつま先側に置き直してください",
      },
    ];
    const requiredSummary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.3,
      qualityLevel: "retry",
      retakeReasons: reasons,
    });
    expect(requiredSummary.retakeAdvice.urgency).toBe("required");
    expect(requiredSummary.retakeAdvice.recommended).toBe(true);
    expect(requiredSummary.retakeAdvice.reasons).toHaveLength(1);

    const suggestedSummary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.6,
      qualityLevel: "reference",
      retakeReasons: reasons,
    });
    expect(suggestedSummary.retakeAdvice.urgency).toBe("suggested");

    const noneSummary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.9,
      qualityLevel: "good",
      retakeReasons: [],
    });
    expect(noneSummary.retakeAdvice.urgency).toBe("none");
    expect(noneSummary.retakeAdvice.recommended).toBe(false);
  });
});

describe("RetakeReason shape", () => {
  it("every retake reason carries message and howToFix", () => {
    // Synthesize a few reasons by hand to validate required fields.
    const reasons: RetakeReason[] = [
      {
        code: "low_frontality",
        message: "テスト",
        howToFix: "テスト",
      },
      {
        code: "subject_too_small",
        message: "テスト",
        howToFix: "テスト",
      },
    ];
    for (const r of reasons) {
      expect(r.code).toBeTruthy();
      expect(r.message.length).toBeGreaterThan(0);
      expect(r.howToFix.length).toBeGreaterThan(0);
    }
  });
});
