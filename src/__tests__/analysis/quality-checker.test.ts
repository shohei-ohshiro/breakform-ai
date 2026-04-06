import { describe, it, expect } from "vitest";
import { checkQuality } from "@/lib/analysis/quality-checker";
import { PoseTimeSeries } from "@/lib/analysis/types";
import {
  makeStandingLandmarks,
  makeImageSeries,
  makeVideoSeries,
} from "./mock-data";

describe("QualityChecker", () => {
  it("passes for a good image with high visibility", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const result = checkQuality(series);

    expect(result.passed).toBe(true);
    expect(result.overallScore).toBeGreaterThan(0.5);
    expect(result.warnings).toHaveLength(0);
  });

  it("passes for a good video with sufficient frames", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 15, 10);
    const result = checkQuality(series);

    expect(result.passed).toBe(true);
    expect(result.details.sufficientFrames).toBe(true);
  });

  it("fails when no frames are provided", () => {
    const series: PoseTimeSeries = {
      frames: [],
      fps: 10,
      duration: 1,
      sourceType: "video",
    };
    const result = checkQuality(series);

    expect(result.passed).toBe(false);
    expect(result.overallScore).toBe(0);
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });

  it("fails when too few frames for video", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 2, 10);
    // Override duration to make it seem like frames are missing
    series.duration = 3;
    const result = checkQuality(series);

    expect(result.passed).toBe(false);
    expect(result.details.sufficientFrames).toBe(false);
  });

  it("warns on low visibility landmarks", () => {
    const landmarks = makeStandingLandmarks();
    // Set all visibilities to very low
    for (const lm of landmarks) {
      lm.visibility = 0.1;
    }
    const series = makeImageSeries(landmarks);
    const result = checkQuality(series);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.details.avgVisibility).toBeLessThan(0.3);
  });

  it("warns when landmarks are out of frame", () => {
    const landmarks = makeStandingLandmarks();
    // Move many landmarks off screen
    landmarks[11].x = 1.5;
    landmarks[12].x = -0.5;
    landmarks[23].y = 1.5;
    landmarks[24].y = -0.5;
    landmarks[25].x = 2.0;
    landmarks[26].x = -1.0;
    landmarks[27].y = 2.0;
    landmarks[28].y = -1.0;

    const series = makeImageSeries(landmarks);
    const result = checkQuality(series);

    expect(result.details.outOfFrameRatio).toBeGreaterThan(0);
  });
});

describe("QualityChecker technique-specific rules", () => {
  it("swipes: fails for image input", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const result = checkQuality(series, "swipes");

    expect(result.failureReasons.some(r => r.includes("動画"))).toBe(true);
  });

  it("swipes: warns on low frame count video", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 7, 10);
    const result = checkQuality(series, "swipes");

    // Should have warning about few frames
    const hasFrameWarning = result.warnings.some(w => w.includes("フレーム数"));
    expect(hasFrameWarning).toBe(true);
  });

  it("handstand: passes for good video input", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 15, 10);
    const result = checkQuality(series, "handstand");

    expect(result.passed).toBe(true);
  });

  it("planche: passes for good video input", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 15, 10);
    const result = checkQuality(series, "planche");

    expect(result.passed).toBe(true);
  });
});
