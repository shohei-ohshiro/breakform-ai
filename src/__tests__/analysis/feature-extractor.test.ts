import { describe, it, expect } from "vitest";
import { extractFeatures, calcAngle } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { NormalizedLandmark } from "@/lib/analysis/types";
import {
  makeStandingLandmarks,
  makeImageSeries,
  makeVideoSeries,
} from "./mock-data";

describe("calcAngle", () => {
  it("returns 90 for a right angle", () => {
    const a: NormalizedLandmark = { x: 0, y: 1, z: 0, visibility: 1 };
    const b: NormalizedLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    const c: NormalizedLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    expect(calcAngle(a, b, c)).toBeCloseTo(90, 0);
  });

  it("returns 180 for a straight line", () => {
    const a: NormalizedLandmark = { x: -1, y: 0, z: 0, visibility: 1 };
    const b: NormalizedLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    const c: NormalizedLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    expect(calcAngle(a, b, c)).toBeCloseTo(180, 0);
  });

  it("returns 0 for overlapping rays", () => {
    const a: NormalizedLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    const b: NormalizedLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    const c: NormalizedLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    expect(calcAngle(a, b, c)).toBeCloseTo(0, 0);
  });
});

describe("extractFeatures", () => {
  it("extracts angles for a single image frame", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    expect(features.angles).toHaveLength(1);
    expect(features.frameCount).toBe(1);
    expect(features.angles[0].leftShoulder).toBeGreaterThan(0);
    expect(features.angles[0].leftElbow).toBeGreaterThan(0);
  });

  it("computes CoG for each frame", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    expect(features.cog).toHaveLength(1);
    // CoG should be within reasonable range
    expect(Math.abs(features.cog[0].x)).toBeLessThan(3);
    expect(Math.abs(features.cog[0].y)).toBeLessThan(5);
  });

  it("computes velocities for video frames", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 10, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    // Should have velocity data for tracked landmarks
    expect(features.velocities.size).toBeGreaterThan(0);
    // First frame has no velocity, rest should
    const wristVels = features.velocities.get(15); // LEFT_WRIST
    expect(wristVels).toBeDefined();
    expect(wristVels!.length).toBeGreaterThan(0);
  });

  it("detects static intervals for still video", () => {
    const series = makeVideoSeries(makeStandingLandmarks(), 15, 10);
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    // Standing still → should find at least one static interval
    expect(features.staticIntervals.length).toBeGreaterThanOrEqual(1);
  });

  it("detects static interval for single image", () => {
    const series = makeImageSeries(makeStandingLandmarks());
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    expect(features.staticIntervals).toHaveLength(1);
    expect(features.staticIntervals[0].startIndex).toBe(0);
    expect(features.staticIntervals[0].endIndex).toBe(0);
  });
});
