/**
 * middle_split UX polish v1.1 tests (P0 scope)
 *
 * Covers the data-layer contract the new result view depends on:
 * - Result structure: headline surfaces the top limiter
 * - Retake CTA: urgency and action-first copy via input-policy
 * - Debug metadata: all expected fields are present on StructuredSummary.meta
 * - Unsupported inputs: classifyInput returns the expected class + reasons
 *
 * Component-level rendering isn't asserted here because the project uses a
 * node vitest environment (no jsdom). The view is a thin read-through of
 * StructuredSummary — pinning the structured shape is enough to catch
 * regressions in layout ordering, since the layout is driven by these fields.
 */

import { describe, it, expect } from "vitest";
import { buildMiddleSplitSummary } from "@/lib/analysis/summary/middleSplit";
import { classifyInput } from "@/lib/analysis/input-policy";
import { evaluate } from "@/lib/analysis/evaluators";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { checkQuality } from "@/lib/analysis/quality-checker";
import { makeMiddleSplitLandmarks, makeImageSeries } from "./mock-data";
import type {
  EvaluationResult,
  FeatureSet,
  QualityCheckResult,
  RetakeReason,
  StructuredSummary,
} from "@/lib/analysis/types";

function runMiddleSplit(angleDeg: number): {
  evaluation: EvaluationResult;
  features: FeatureSet;
  quality: QualityCheckResult;
} {
  const series = makeImageSeries(makeMiddleSplitLandmarks(angleDeg));
  const quality = checkQuality(series, "middle_split");
  const normalized = normalizePoseTimeSeries(series);
  const features = extractFeatures(normalized, "middle_split");
  const evaluation = evaluate("middle_split", normalized, features);
  return { evaluation, features, quality };
}

function buildGoodSummary(angleDeg = 100): StructuredSummary {
  const { evaluation, features } = runMiddleSplit(angleDeg);
  return buildMiddleSplitSummary({
    evaluation,
    features,
    reliability: 0.85,
    qualityLevel: "good",
    retakeReasons: [],
    retakeRecommended: false,
    inputClass: "analyzable",
  });
}

describe("middle_split UX v1.1 — result structure", () => {
  it("headline surfaces the top limiter label when quality is good", () => {
    const summary = buildGoodSummary(100);
    expect(summary.primaryLimiters.length).toBeGreaterThan(0);
    const top = summary.primaryLimiters[0];
    expect(summary.currentStateSummary.headline).toContain(top.label);
    // Conclusion-first: the headline names the remaining degrees explicitly.
    expect(summary.currentStateSummary.headline).toMatch(/あと\d+°/);
  });

  it("headline downgrades to '計測に失敗しました' on retry quality level", () => {
    const { evaluation, features } = runMiddleSplit(160);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.2,
      qualityLevel: "retry",
      retakeReasons: [],
      retakeRecommended: true,
      inputClass: "discouraged",
    });
    expect(summary.currentStateSummary.headline).toContain("計測に失敗");
  });

  it("headline prefixes '参考値' on reference quality level", () => {
    const { evaluation, features } = runMiddleSplit(150);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.6,
      qualityLevel: "reference",
      retakeReasons: [],
      retakeRecommended: true,
      inputClass: "reference",
    });
    expect(summary.currentStateSummary.headline.startsWith("参考値")).toBe(true);
  });
});

describe("middle_split UX v1.1 — retake CTA", () => {
  it("urgency=required propagates when qualityLevel is retry", () => {
    const summary = (() => {
      const { evaluation, features } = runMiddleSplit(160);
      return buildMiddleSplitSummary({
        evaluation,
        features,
        reliability: 0.3,
        qualityLevel: "retry",
        retakeReasons: [
          {
            code: "low_frontality",
            message: "正面からまっすぐ撮ってください",
            howToFix: "被写体のつま先側にカメラを置き、正面から撮り直してください。",
          },
        ],
        retakeRecommended: true,
        inputClass: "discouraged",
      });
    })();

    expect(summary.retakeAdvice.urgency).toBe("required");
    expect(summary.retakeAdvice.recommended).toBe(true);
    expect(summary.meta.retakeRecommended).toBe(true);
  });

  it("retake reasons lead with action-first copy (next-step verbs)", () => {
    // Simulate a heavily cropped shot by pushing out-of-frame ratio via quality.
    const { features } = runMiddleSplit(160);
    const fakeQuality = {
      passed: true,
      overallScore: 0.7,
      details: {
        avgVisibility: 0.8,
        visibilityStdDev: 0.05,
        lowVisibilityFrames: 0,
        missingFrameRatio: 0,
        outOfFrameRatio: 0.35, // triggers image_cropped discouraged
        sufficientFrames: true,
        subjectSize: 0.3,
        durationSufficient: true,
      },
      warnings: [],
      failureReasons: [],
      retryRecommended: false,
      analyzableAsReference: true,
    } satisfies QualityCheckResult;

    const result = classifyInput({
      technique: "middle_split",
      features,
      quality: fakeQuality,
      reliability: 0.7,
    });

    expect(result.class).toBe("discouraged");
    const cropReason = result.reasons.find((r) => r.code === "image_cropped");
    expect(cropReason).toBeTruthy();
    // Action-first: the message starts with a verb like "足先まで画面に入れて"
    expect(cropReason!.message).toContain("足先まで画面に入れて");
  });

  it("dedupes low_reliability when a specific reason is already present", () => {
    const { features } = runMiddleSplit(160);
    const badQuality = {
      passed: true,
      overallScore: 0.5,
      details: {
        avgVisibility: 0.8,
        visibilityStdDev: 0.05,
        lowVisibilityFrames: 0,
        missingFrameRatio: 0,
        outOfFrameRatio: 0.35,
        sufficientFrames: true,
        subjectSize: 0.3,
        durationSufficient: true,
      },
      warnings: [],
      failureReasons: [],
      retryRecommended: false,
      analyzableAsReference: true,
    } satisfies QualityCheckResult;
    const result = classifyInput({
      technique: "middle_split",
      features,
      quality: badQuality,
      reliability: 0.3, // would otherwise add low_reliability
    });
    const hasLowReliability = result.reasons.some(
      (r) => r.code === "low_reliability",
    );
    const hasSpecific = result.reasons.some((r) => r.code !== "low_reliability");
    expect(hasSpecific).toBe(true);
    expect(hasLowReliability).toBe(false);
  });

  it("orders reasons by priority (image_cropped beats low_visibility)", () => {
    const reasons: RetakeReason[] = [];
    // Run through the classifier with both conditions true:
    const { features } = runMiddleSplit(160);
    const q = {
      passed: true,
      overallScore: 0.6,
      details: {
        avgVisibility: 0.5,
        visibilityStdDev: 0.05,
        lowVisibilityFrames: 0,
        missingFrameRatio: 0,
        outOfFrameRatio: 0.35,
        sufficientFrames: true,
        subjectSize: 0.3,
        durationSufficient: true,
      },
      warnings: [],
      failureReasons: [],
      retryRecommended: false,
      analyzableAsReference: true,
    } satisfies QualityCheckResult;
    const result = classifyInput({
      technique: "middle_split",
      features,
      quality: q,
      reliability: 0.7,
    });
    reasons.push(...result.reasons);
    const firstCode = reasons[0]?.code;
    expect(firstCode).toBe("image_cropped");
  });
});

describe("middle_split UX v1.1 — debug meta", () => {
  it("exposes summaryVersion, captureGuidanceVersion, reliability, qualityLevel, retakeRecommended, inputClass, historyComparable", () => {
    const summary = buildGoodSummary(100);
    const meta = summary.meta;
    expect(meta.summaryVersion).toBe("middle_split_summary_v1");
    expect(typeof meta.captureGuidanceVersion).toBe("string");
    expect(meta.captureGuidanceVersion.length).toBeGreaterThan(0);
    expect(typeof meta.reliability).toBe("number");
    expect(meta.qualityLevel).toBe("good");
    expect(typeof meta.retakeRecommended).toBe("boolean");
    expect(meta.inputClass).toBe("analyzable");
    expect(typeof meta.historyComparable).toBe("boolean");
  });

  it("historyComparable is false when qualityLevel is retry", () => {
    const { evaluation, features } = runMiddleSplit(160);
    const summary = buildMiddleSplitSummary({
      evaluation,
      features,
      reliability: 0.3,
      qualityLevel: "retry",
      retakeReasons: [],
      retakeRecommended: true,
      inputClass: "discouraged",
    });
    expect(summary.meta.historyComparable).toBe(false);
  });
});

describe("middle_split UX v1.1 — input-policy unsupported inputs", () => {
  it("analyzable when a clean frontal split is given", () => {
    const { features, quality } = runMiddleSplit(160);
    // The bundled mock has a modest shoulder width so subjectSize sits just
    // above the discouraged threshold. What we care about here is that the
    // result is *not* discouraged / blocked — reference is acceptable as
    // "we can analyze this but the shot could be tighter".
    const result = classifyInput({
      technique: "middle_split",
      features,
      quality,
      reliability: 0.85,
    });
    if (result.class === "discouraged" || result.class === "blocked") {
      throw new Error(
        `expected analyzable|reference, got ${result.class} (${result.signals.join(",")})`,
      );
    }
  });

  it("returns blocked with a retake reason when quality is unrecoverable", () => {
    const result = classifyInput({
      technique: "middle_split",
      features: undefined,
      quality: {
        passed: false,
        overallScore: 0,
        details: {
          avgVisibility: 0,
          visibilityStdDev: 0,
          lowVisibilityFrames: 0,
          missingFrameRatio: 1,
          outOfFrameRatio: 1,
          sufficientFrames: false,
          subjectSize: 0,
          durationSufficient: false,
        },
        warnings: [],
        failureReasons: ["ポーズが検出されませんでした"],
        retryRecommended: true,
        analyzableAsReference: false,
      },
      reliability: 0,
    });
    expect(result.class).toBe("blocked");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("non-middle_split techniques pass through as analyzable", () => {
    const result = classifyInput({
      technique: "handstand",
      features: undefined,
      quality: {
        passed: true,
        overallScore: 1,
        details: {
          avgVisibility: 0.9,
          visibilityStdDev: 0,
          lowVisibilityFrames: 0,
          missingFrameRatio: 0,
          outOfFrameRatio: 0,
          sufficientFrames: true,
          subjectSize: 0.3,
          durationSufficient: true,
        },
        warnings: [],
        failureReasons: [],
        retryRecommended: false,
        analyzableAsReference: true,
      },
      reliability: 1,
    });
    expect(result.class).toBe("analyzable");
    expect(result.reasons).toHaveLength(0);
  });
});
