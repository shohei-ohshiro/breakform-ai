import { describe, it, expect } from "vitest";
import {
  normalizePoseTimeSeries,
  detectViewpoint,
} from "@/lib/analysis/pose-normalizer";
import { LM } from "@/lib/analysis/types";
import {
  makeStandingLandmarks,
  makeImageSeries,
} from "./mock-data";

describe("PoseNormalizer", () => {
  it("normalizes hip midpoint to origin", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);

    expect(normalized.frames).toHaveLength(1);

    const frame = normalized.frames[0];
    const hipMidX =
      (frame.landmarks[LM.LEFT_HIP].x + frame.landmarks[LM.RIGHT_HIP].x) / 2;
    const hipMidY =
      (frame.landmarks[LM.LEFT_HIP].y + frame.landmarks[LM.RIGHT_HIP].y) / 2;

    expect(hipMidX).toBeCloseTo(0, 1);
    expect(hipMidY).toBeCloseTo(0, 1);
  });

  it("normalizes shoulder width to 1.0", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);

    const frame = normalized.frames[0];
    const lShoulder = frame.landmarks[LM.LEFT_SHOULDER];
    const rShoulder = frame.landmarks[LM.RIGHT_SHOULDER];
    const shoulderWidth = Math.sqrt(
      (rShoulder.x - lShoulder.x) ** 2 + (rShoulder.y - lShoulder.y) ** 2
    );

    expect(shoulderWidth).toBeCloseTo(1.0, 1);
  });

  it("flips Y axis so up is positive", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);

    const frame = normalized.frames[0];
    // In standing pose, nose should be above hips (positive Y after flip)
    expect(frame.landmarks[LM.NOSE].y).toBeGreaterThan(0);
  });

  it("preserves visibility", () => {
    const landmarks = makeStandingLandmarks();
    landmarks[LM.NOSE].visibility = 0.42;
    const series = makeImageSeries(landmarks);
    const normalized = normalizePoseTimeSeries(series);

    expect(normalized.frames[0].landmarks[LM.NOSE].visibility).toBe(0.42);
  });

  it("records shoulderWidth", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);

    expect(normalized.frames[0].shoulderWidth).toBeGreaterThan(0);
  });
});

describe("detectViewpoint", () => {
  it("returns front for a normal standing pose", () => {
    const landmarks = makeStandingLandmarks();
    expect(detectViewpoint(landmarks)).toBe("front");
  });

  it("returns unknown for very low visibility", () => {
    const landmarks = makeStandingLandmarks();
    for (const lm of landmarks) {
      lm.visibility = 0.1;
    }
    expect(detectViewpoint(landmarks)).toBe("unknown");
  });

  it("returns side when shoulders are narrow in XY", () => {
    const landmarks = makeStandingLandmarks();
    // Make shoulders appear very narrow (side view)
    landmarks[LM.LEFT_SHOULDER].x = 0.49;
    landmarks[LM.RIGHT_SHOULDER].x = 0.51;
    // Add depth difference
    landmarks[LM.LEFT_SHOULDER].z = -0.2;
    landmarks[LM.RIGHT_SHOULDER].z = 0.2;
    expect(detectViewpoint(landmarks)).toBe("side");
  });
});
