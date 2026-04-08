import { describe, it, expect } from "vitest";
import { evaluate } from "@/lib/analysis/evaluators";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import {
  makeHandstandLandmarks,
  makePlancheLandmarks,
  makeStandingLandmarks,
  makeImageSeries,
  makeVideoSeries,
} from "./mock-data";
import { FIXTURES } from "./fixtures";

describe("HandstandEvaluator", () => {
  it("returns a score for a single handstand image", () => {
    const series = makeImageSeries(makeHandstandLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.technique).toBe("handstand");
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("returns a higher score for a good handstand than a standing pose", () => {
    const hs = makeImageSeries(makeHandstandLandmarks());
    const hsNorm = normalizePoseTimeSeries(hs);
    const hsFeats = extractFeatures(hsNorm);
    const hsResult = evaluate("handstand", hsNorm, hsFeats);

    const st = makeImageSeries(makeStandingLandmarks());
    const stNorm = normalizePoseTimeSeries(st);
    const stFeats = extractFeatures(stNorm);
    const stResult = evaluate("handstand", stNorm, stFeats);

    expect(hsResult.finalScore).toBeGreaterThan(stResult.finalScore);
  });

  it("returns a score for video handstand with stability", () => {
    const series = makeVideoSeries(makeHandstandLandmarks(), 20, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.technique).toBe("handstand");
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    const stabilityBreakdown = result.breakdown.find(
      (b) => b.category === "stability"
    );
    expect(stabilityBreakdown).toBeDefined();
  });

  it("includes suggestions when violations found", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.suggestionsRaw.length).toBeGreaterThan(0);
  });

  it("includes meta with configVersion and frame info", () => {
    const series = makeImageSeries(makeHandstandLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.meta).toBeDefined();
    expect(result.meta.configVersion).toBe("2.0");
    expect(result.meta.totalFrames).toBe(1);
    expect(result.meta.analyzedFrameRange).toHaveLength(2);
  });

  it("violations include threshold, status, and confidence", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    for (const v of result.violations) {
      expect(v.status).toBeDefined();
      expect(["pass", "warn", "fail"]).toContain(v.status);
      expect(v.threshold).toBeDefined();
      expect(typeof v.threshold.warn).toBe("number");
      expect(typeof v.threshold.fail).toBe("number");
      expect(typeof v.confidence).toBe("number");
    }
  });
});

describe("PlancheEvaluator", () => {
  it("returns a score for a planche image", () => {
    const series = makeImageSeries(makePlancheLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.technique).toBe("planche");
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("evaluates elbow lockout", () => {
    const series = makeImageSeries(makePlancheLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const elbowBreakdown = result.breakdown.find(
      (b) => b.category === "elbow_lockout"
    );
    expect(elbowBreakdown).toBeDefined();
    expect(elbowBreakdown!.score).toBeGreaterThanOrEqual(0);
  });

  it("includes meta with configVersion and evaluationMode", () => {
    const series = makeImageSeries(makePlancheLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.meta).toBeDefined();
    expect(result.meta.configVersion).toBe("2.3");
    expect(result.meta.evaluationMode).toBe("hold"); // image → always hold
  });

  it("breakdown categories have measurements", () => {
    const series = makeImageSeries(makePlancheLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    for (const b of result.breakdown) {
      expect(b.measurements).toBeDefined();
    }
  });

  it("classifies entry video as entry mode", () => {
    const series = FIXTURES.planche.entry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.meta.evaluationMode).toBe("entry");
    expect(result.meta.confidenceNote).toBeDefined();
    expect(result.meta.confidenceNote!.length).toBeGreaterThan(0);
    // Entry mode should have an entry_quality breakdown
    const entryBreakdown = result.breakdown.find(b => b.category === "entry_quality");
    expect(entryBreakdown).toBeDefined();
    expect(entryBreakdown!.label).toBe("進入フォーム");
  });

  it("hold video with sufficient static interval → hold mode", () => {
    const series = FIXTURES.planche.hipSag();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.meta.evaluationMode).toBe("hold");
    // Hold mode should NOT have entry_quality
    const entryBreakdown = result.breakdown.find(b => b.category === "entry_quality");
    expect(entryBreakdown).toBeUndefined();
  });
});

describe("SwipesEvaluator", () => {
  it("rejects single-frame analysis", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    expect(result.technique).toBe("swipes");
    expect(result.finalScore).toBe(0);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe("swipes_insufficient_frames");
  });

  it("includes meta even on rejection", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    expect(result.meta).toBeDefined();
    expect(result.meta.configVersion).toBe("2.0");
  });

  it("produces a result for video with enough frames", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 20, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    expect(result.technique).toBe("swipes");
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("detects events for dynamic movement", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 15, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    expect(result.events).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("violations from swipes include extended fields", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 20, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    for (const v of result.violations) {
      expect(v.status).toBeDefined();
      expect(v.threshold).toBeDefined();
      expect(typeof v.confidence).toBe("number");
    }
  });
});

describe("Evaluator dispatcher", () => {
  it("throws for unknown technique", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    expect(() =>
      evaluate("unknown" as any, normalized, features)
    ).toThrow("Unknown technique");
  });
});
