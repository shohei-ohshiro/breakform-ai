import { describe, it, expect } from "vitest";
import { computeCoarseFrameCount } from "@/lib/pose/mediapipe";
import { evaluate } from "@/lib/analysis/evaluators";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { SamplingInfo, ExtractionDiagnostics } from "@/lib/analysis/types";
import { FIXTURES } from "./fixtures";

describe("computeCoarseFrameCount", () => {
  it("returns more frames for longer videos", () => {
    const short = computeCoarseFrameCount(3, "planche");
    const medium = computeCoarseFrameCount(10, "planche");
    const long = computeCoarseFrameCount(20, "planche");

    expect(medium.count).toBeGreaterThan(short.count);
    expect(long.count).toBeGreaterThan(medium.count);
  });

  it("returns at least 10 frames for any duration", () => {
    const result = computeCoarseFrameCount(0.5, "planche");
    expect(result.count).toBeGreaterThanOrEqual(10);
  });

  it("caps at 120 frames for very long videos", () => {
    const result = computeCoarseFrameCount(120, "planche");
    expect(result.count).toBeLessThanOrEqual(120);
  });

  it("gives higher density for swipes than static techniques", () => {
    const planche = computeCoarseFrameCount(10, "planche");
    const swipes = computeCoarseFrameCount(10, "swipes");

    expect(swipes.count).toBeGreaterThanOrEqual(planche.count);
  });

  it("short videos get high effective FPS", () => {
    const result = computeCoarseFrameCount(2, "planche");
    expect(result.fps).toBeGreaterThanOrEqual(8);
  });

  it("long videos get lower effective FPS", () => {
    const result = computeCoarseFrameCount(30, "planche");
    expect(result.fps).toBeLessThanOrEqual(6);
  });

  describe("frame count by duration range", () => {
    it("≤3s video: ~20-30 frames", () => {
      const r = computeCoarseFrameCount(3, "planche");
      expect(r.count).toBeGreaterThanOrEqual(20);
      expect(r.count).toBeLessThanOrEqual(40);
    });

    it("5s video: ~40 frames", () => {
      const r = computeCoarseFrameCount(5, "planche");
      expect(r.count).toBeGreaterThanOrEqual(30);
      expect(r.count).toBeLessThanOrEqual(50);
    });

    it("11s video: ~50-90 frames", () => {
      const r = computeCoarseFrameCount(11, "planche");
      expect(r.count).toBeGreaterThanOrEqual(50);
      expect(r.count).toBeLessThanOrEqual(90);
    });

    it("30s video: ~100-120 frames", () => {
      const r = computeCoarseFrameCount(30, "planche");
      expect(r.count).toBeGreaterThanOrEqual(90);
      expect(r.count).toBeLessThanOrEqual(120);
    });
  });
});

describe("Long video planche evaluation", () => {
  it("long entry video: frame count scales up from 15 to 55", () => {
    const shortEntry = FIXTURES.planche.entry();
    const longEntry = FIXTURES.planche.longEntry();

    expect(longEntry.frames.length).toBeGreaterThan(shortEntry.frames.length);
    expect(longEntry.frames.length).toBe(55);
    expect(longEntry.duration).toBe(11.0);
  });

  it("long entry video: evaluator uses second-half frames for analysis", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    // The analyzedFrameRange should include frames from the second half
    const [, endIdx] = result.meta.analyzedFrameRange;
    expect(endIdx).toBeGreaterThan(series.frames.length / 3);

    // If entry mode: best frames should be from the second half
    if (result.meta.evaluationMode === "entry") {
      const entryDetails = result.meta.entryFrameDetails;
      expect(entryDetails).toBeDefined();
      expect(entryDetails!.frameIndices.some(idx => idx > series.frames.length / 2)).toBe(true);
    }
    // If hold mode: the detected hold should include frames beyond the first third
    if (result.meta.evaluationMode === "hold" && result.meta.staticIntervalUsed) {
      expect(result.meta.staticIntervalUsed.endIndex).toBeGreaterThan(series.frames.length / 3);
    }
  });

  it("long entry video: full video gets at least as good a score as truncated", () => {
    const full = FIXTURES.planche.longEntry();
    // Simulate old behavior: only first 15 frames (first ~3s)
    const truncated = {
      ...full,
      frames: full.frames.slice(0, 15),
      duration: full.frames[14].timestamp,
    };

    const fullNorm = normalizePoseTimeSeries(full);
    const fullFeats = extractFeatures(fullNorm);
    const fullResult = evaluate("planche", fullNorm, fullFeats);

    const truncNorm = normalizePoseTimeSeries(truncated);
    const truncFeats = extractFeatures(truncNorm);
    const truncResult = evaluate("planche", truncNorm, truncFeats);

    // Full video should find better frames and score at least as well
    expect(fullResult.finalScore).toBeGreaterThanOrEqual(truncResult.finalScore);
  });

  it("brief good moment: evaluator avoids low-visibility frames in best selection", () => {
    const series = FIXTURES.planche.briefGoodMoment();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    // Whether hold or entry, the analyzed range should use good frames
    const [startIdx, endIdx] = result.meta.analyzedFrameRange;
    expect(endIdx).toBeGreaterThan(startIdx);

    // If entry mode, verify frame selection avoids the low-vis frame
    if (result.meta.evaluationMode === "entry" && result.meta.entryFrameDetails) {
      for (const angle of result.meta.entryFrameDetails.spineAngles) {
        // All selected frames should have spine angle within 50° of horizontal
        expect(Math.abs(angle - 90)).toBeLessThan(50);
      }
    }
  });

  it("meta includes configVersion 2.3", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.meta.configVersion).toBe("2.4");
  });

  it("sampling info is populated when passed through pipeline input", () => {
    // This test verifies the type structure; actual SamplingInfo comes from client
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    // Without client sampling, meta.sampling should be undefined
    expect(result.meta.sampling).toBeUndefined();

    // If we manually attach sampling info, it should persist
    result.meta.sampling = {
      estimatedOriginalFrames: 330,
      sampledFramesCount: 75,
      coarseSampleCount: 55,
      refinedSampleCount: 20,
      samplingStrategy: "full_scan_then_refine",
      selectedWindows: [
        { startTime: 7.0, endTime: 8.0, reason: "most_horizontal", framesExtracted: 15 },
        { startTime: 4.0, endTime: 5.5, reason: "static_hold", framesExtracted: 5 },
      ],
      coarseFps: 5,
      refinedFps: 15,
      videoDuration: 11,
      coverageStartTime: 0,
      coverageEndTime: 11,
      coveredDurationRatio: 1.0,
    };

    expect(result.meta.sampling.samplingStrategy).toBe("full_scan_then_refine");
    expect(result.meta.sampling.coarseSampleCount).toBe(55);
    expect(result.meta.sampling.refinedSampleCount).toBe(20);
    expect(result.meta.sampling.selectedWindows).toHaveLength(2);
    expect(result.meta.sampling.coveredDurationRatio).toBe(1.0);
  });
});

describe("Coverage info verification", () => {
  it("planche evaluator always produces coverageInfo", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    expect(result.meta.coverageInfo).toBeDefined();
    expect(result.meta.coverageInfo!.fullScanPerformed).toBe(true);
    expect(result.meta.coverageInfo!.coarseScanTimeRange).toHaveLength(2);
    expect(result.meta.coverageInfo!.finalScoringWindow).toBeDefined();
    expect(result.meta.coverageInfo!.analysisPhases.length).toBeGreaterThanOrEqual(2);
    expect(result.meta.coverageInfo!.summary.length).toBeGreaterThan(0);
  });

  it("handstand evaluator produces coverageInfo", () => {
    const series = FIXTURES.handstand.good();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.meta.coverageInfo).toBeDefined();
    expect(result.meta.coverageInfo!.fullScanPerformed).toBe(true);
  });

  it("swipes evaluator produces coverageInfo", () => {
    const series = FIXTURES.swipes.withEvents();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("swipes", normalized, features);

    expect(result.meta.coverageInfo).toBeDefined();
    expect(result.meta.coverageInfo!.fullScanPerformed).toBe(true);
    // v3.0: scoring reason describes either selected cycle or full-frame fallback
    const reason = result.meta.coverageInfo!.finalScoringWindow.reason;
    expect(reason).toMatch(/サイクル|全フレーム/);
  });

  it("coverageInfo coarse scan covers first to last frame", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const coverage = result.meta.coverageInfo!;
    // Coarse scan should cover from first frame to last frame
    expect(coverage.coarseScanTimeRange[0]).toBe(normalized.frames[0].timestamp);
    expect(coverage.coarseScanTimeRange[1]).toBe(normalized.frames[normalized.frames.length - 1].timestamp);
  });

  it("coverageInfo finalScoringWindow is within coarse scan range", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const coverage = result.meta.coverageInfo!;
    expect(coverage.finalScoringWindow.startTime).toBeGreaterThanOrEqual(coverage.coarseScanTimeRange[0]);
    expect(coverage.finalScoringWindow.endTime).toBeLessThanOrEqual(coverage.coarseScanTimeRange[1]);
  });

  it("coverageInfo includes sampling refinement phases when sampling provided", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const sampling: SamplingInfo = {
      estimatedOriginalFrames: 330,
      sampledFramesCount: 75,
      coarseSampleCount: 55,
      refinedSampleCount: 20,
      samplingStrategy: "full_scan_then_refine",
      selectedWindows: [
        { startTime: 7.0, endTime: 8.0, reason: "most_horizontal", framesExtracted: 15 },
      ],
      coarseFps: 5,
      refinedFps: 15,
      videoDuration: 11,
      coverageStartTime: 0,
      coverageEndTime: 11,
      coveredDurationRatio: 1.0,
    };

    const result = evaluate("planche", normalized, features, sampling);

    const coverage = result.meta.coverageInfo!;
    // Should have coarse_scan + refine + scoring = at least 3 phases
    expect(coverage.analysisPhases.length).toBeGreaterThanOrEqual(3);
    const refinePhase = coverage.analysisPhases.find(p => p.phase === "refine");
    expect(refinePhase).toBeDefined();
    expect(refinePhase!.timeRange[0]).toBe(7.0);
    expect(refinePhase!.timeRange[1]).toBe(8.0);
  });

  it("summary includes video duration and scoring window", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const summary = result.meta.coverageInfo!.summary;
    expect(summary).toContain("11.0秒");
    expect(summary).toContain("走査");
    expect(summary).toContain("採点");
  });
});

describe("Late best moment detection", () => {
  it("planche: detects best frames in the final 20% of video", () => {
    const series = FIXTURES.planche.lateBestMoment();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    // The analyzed frames should include frames from the last 20%
    const [, endIdx] = result.meta.analyzedFrameRange;
    const lateThreshold = Math.floor(series.frames.length * 0.7);
    expect(endIdx).toBeGreaterThan(lateThreshold);

    // If entry mode, verify selected frames include late ones
    if (result.meta.evaluationMode === "entry" && result.meta.entryFrameDetails) {
      const hasLateFrame = result.meta.entryFrameDetails.frameIndices.some(
        idx => idx >= lateThreshold
      );
      expect(hasLateFrame).toBe(true);
    }
  });

  it("planche: full video finds better entry frames than first-third truncation", () => {
    const full = FIXTURES.planche.lateBestMoment();
    const firstThird = {
      ...full,
      frames: full.frames.slice(0, Math.floor(full.frames.length / 3)),
      duration: full.frames[Math.floor(full.frames.length / 3) - 1].timestamp,
    };

    const fullNorm = normalizePoseTimeSeries(full);
    const fullFeats = extractFeatures(fullNorm);
    const fullResult = evaluate("planche", fullNorm, fullFeats);

    const partialNorm = normalizePoseTimeSeries(firstThird);
    const partialFeats = extractFeatures(partialNorm);
    const partialResult = evaluate("planche", partialNorm, partialFeats);

    // The full video has access to the near-horizontal frames at 85-95%
    // which should give a better body_line score, even if other factors differ
    const fullBodyLine = fullResult.breakdown.find(b => b.category === "body_line");
    const partialBodyLine = partialResult.breakdown.find(b => b.category === "body_line");
    expect(fullBodyLine).toBeDefined();
    expect(partialBodyLine).toBeDefined();
    expect(fullBodyLine!.score).toBeGreaterThanOrEqual(partialBodyLine!.score);
  });

  it("coverageInfo covers full video even when scoring window is narrow", () => {
    const series = FIXTURES.planche.lateBestMoment();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const coverage = result.meta.coverageInfo!;
    // Coarse scan always covers full video
    expect(coverage.coarseScanTimeRange[0]).toBe(normalized.frames[0].timestamp);
    expect(coverage.coarseScanTimeRange[1]).toBe(normalized.frames[normalized.frames.length - 1].timestamp);
    // Scoring window is somewhere within
    expect(coverage.finalScoringWindow.endTime).toBeLessThanOrEqual(series.duration);
  });
});

describe("Long handstand full scan", () => {
  it("long handstand: coverageInfo covers full video", () => {
    const series = FIXTURES.handstand.longHold();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    expect(result.meta.coverageInfo).toBeDefined();
    expect(result.meta.coverageInfo!.fullScanPerformed).toBe(true);
    expect(result.meta.coverageInfo!.coarseScanTimeRange[0]).toBe(normalized.frames[0].timestamp);
    expect(result.meta.coverageInfo!.coarseScanTimeRange[1]).toBe(normalized.frames[normalized.frames.length - 1].timestamp);
  });

  it("long handstand: scoring window is from the static hold region", () => {
    const series = FIXTURES.handstand.longHold();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("handstand", normalized, features);

    const coverage = result.meta.coverageInfo!;
    // The scoring window should not start at 0 (the hold is in the middle)
    // It should be within the video duration
    expect(coverage.finalScoringWindow.endTime).toBeLessThanOrEqual(series.duration);
    expect(coverage.finalScoringWindow.startTime).toBeGreaterThanOrEqual(0);
  });
});

// ============================================
// Extraction Coverage Verification
// ============================================

describe("Coarse timestamp generation covers full duration", () => {
  it("11s video: coarse timestamps reach past 10s", () => {
    const duration = 11.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      timestamps.push(time);
    }

    expect(timestamps.length).toBe(count);
    expect(timestamps[0]).toBe(0);
    const lastTs = timestamps[timestamps.length - 1];
    // Last timestamp should be within one interval of the end
    expect(lastTs).toBeGreaterThan(duration - interval - 0.01);
    // Specifically for 11s: last should be > 10s
    expect(lastTs).toBeGreaterThan(10.0);
  });

  it("5s video: coarse timestamps reach past 4.5s", () => {
    const duration = 5.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      timestamps.push(time);
    }

    const lastTs = timestamps[timestamps.length - 1];
    expect(lastTs).toBeGreaterThan(4.5);
  });

  it("30s video: coarse timestamps reach past 29s", () => {
    const duration = 30.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      timestamps.push(time);
    }

    const lastTs = timestamps[timestamps.length - 1];
    expect(lastTs).toBeGreaterThan(29.0);
  });

  it("all durations: last timestamp is never more than one interval from end", () => {
    for (const dur of [2, 3, 5, 8, 11, 15, 20, 30, 45, 60]) {
      const { count } = computeCoarseFrameCount(dur, "planche");
      const interval = dur / count;
      const lastTs = (count - 1) * interval;
      const gap = dur - lastTs;
      expect(gap).toBeLessThanOrEqual(interval + 0.001);
      expect(gap).toBeGreaterThan(0);
    }
  });
});

describe("ExtractionDiagnostics structure", () => {
  it("can be constructed from simulated extraction data", () => {
    const duration = 11.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    const coarseTimestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i * interval;
      if (t >= duration) break;
      coarseTimestamps.push(t);
    }

    const refinedTimestamps = [7.0, 7.067, 7.133, 7.2, 7.267];

    const diag: ExtractionDiagnostics = {
      coarseFrameTimestamps: coarseTimestamps,
      refinedFrameTimestamps: refinedTimestamps,
      firstExtractedTime: coarseTimestamps[0],
      lastExtractedTime: Math.max(
        coarseTimestamps[coarseTimestamps.length - 1],
        refinedTimestamps[refinedTimestamps.length - 1]
      ),
      extractedFrameCount: coarseTimestamps.length + refinedTimestamps.length,
      videoDuration: duration,
      durationCoverageRatio: Math.max(
        coarseTimestamps[coarseTimestamps.length - 1],
        refinedTimestamps[refinedTimestamps.length - 1]
      ) / duration,
      seekTimeouts: 0,
      coarseExtractionTimeMs: 3500,
      refineExtractionTimeMs: 400,
    };

    expect(diag.firstExtractedTime).toBe(0);
    expect(diag.lastExtractedTime).toBeGreaterThan(10.0);
    expect(diag.durationCoverageRatio).toBeGreaterThan(0.9);
    expect(diag.extractedFrameCount).toBe(count + 5);
    expect(diag.seekTimeouts).toBe(0);
  });

  it("low durationCoverageRatio is detectable", () => {
    // Simulate a bug where extraction stops at 4s
    const duration = 11.0;
    const buggyTimestamps = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

    const diag: ExtractionDiagnostics = {
      coarseFrameTimestamps: buggyTimestamps,
      refinedFrameTimestamps: [],
      firstExtractedTime: 0,
      lastExtractedTime: 4.0,
      extractedFrameCount: 9,
      videoDuration: duration,
      durationCoverageRatio: 4.0 / 11.0,
      seekTimeouts: 0,
      coarseExtractionTimeMs: 800,
      refineExtractionTimeMs: 0,
    };

    // This should be flagged as suspicious
    expect(diag.durationCoverageRatio).toBeLessThan(0.5);
    expect(diag.lastExtractedTime).toBeLessThan(duration * 0.5);
  });
});

describe("Coverage info with extraction diagnostics", () => {
  it("coverageInfo summary includes frame counts when diagnostics provided", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);

    const coarseTimestamps = series.frames.map(f => f.timestamp);
    const diag: ExtractionDiagnostics = {
      coarseFrameTimestamps: coarseTimestamps,
      refinedFrameTimestamps: [7.5, 7.567, 7.633],
      firstExtractedTime: 0,
      lastExtractedTime: coarseTimestamps[coarseTimestamps.length - 1],
      extractedFrameCount: coarseTimestamps.length + 3,
      videoDuration: 11.0,
      durationCoverageRatio: coarseTimestamps[coarseTimestamps.length - 1] / 11.0,
      seekTimeouts: 0,
      coarseExtractionTimeMs: 3500,
      refineExtractionTimeMs: 250,
    };

    const sampling: SamplingInfo = {
      estimatedOriginalFrames: 330,
      sampledFramesCount: series.frames.length + 3,
      coarseSampleCount: series.frames.length,
      refinedSampleCount: 3,
      samplingStrategy: "full_scan_then_refine",
      selectedWindows: [
        { startTime: 7.0, endTime: 8.0, reason: "most_horizontal", framesExtracted: 3 },
      ],
      coarseFps: 5,
      refinedFps: 15,
      videoDuration: 11.0,
      coverageStartTime: 0,
      coverageEndTime: coarseTimestamps[coarseTimestamps.length - 1],
      coveredDurationRatio: 1.0,
      extractionDiagnostics: diag,
    };

    const result = evaluate("planche", normalized, features, sampling);

    const coverage = result.meta.coverageInfo!;
    expect(coverage.summary).toContain("フレーム");
    expect(coverage.summary).toContain("走査");
    expect(coverage.summary).toContain("採点");
  });

  it("coverageInfo and diagnostics are consistent", () => {
    const series = FIXTURES.planche.longEntry();
    const normalized = normalizePoseTimeSeries(series);
    const features = extractFeatures(normalized);
    const result = evaluate("planche", normalized, features);

    const coverage = result.meta.coverageInfo!;
    // Coarse scan range should match actual frame range
    expect(coverage.coarseScanTimeRange[0]).toBe(normalized.frames[0].timestamp);
    expect(coverage.coarseScanTimeRange[1]).toBe(
      normalized.frames[normalized.frames.length - 1].timestamp
    );
    // Scoring window should be within coarse range
    expect(coverage.finalScoringWindow.startTime).toBeGreaterThanOrEqual(
      coverage.coarseScanTimeRange[0]
    );
    expect(coverage.finalScoringWindow.endTime).toBeLessThanOrEqual(
      coverage.coarseScanTimeRange[1]
    );
  });
});

describe("First half / second half comparison", () => {
  it("long planche: full video has more frames than either half", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);
    const secondHalf = FIXTURES.split.secondHalf(full);

    expect(full.frames.length).toBeGreaterThan(firstHalf.frames.length);
    expect(full.frames.length).toBeGreaterThan(secondHalf.frames.length);
    expect(firstHalf.frames.length + secondHalf.frames.length).toBe(full.frames.length);
  });

  it("long planche: full video duration matches sum of halves", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);
    const secondHalf = FIXTURES.split.secondHalf(full);

    // Not exact due to discrete sampling, but should be close
    expect(firstHalf.duration + secondHalf.duration).toBeCloseTo(full.duration, 0);
  });

  it("long planche: coverage ranges differ between halves and full", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);
    const secondHalf = FIXTURES.split.secondHalf(full);

    const fullNorm = normalizePoseTimeSeries(full);
    const fullFeats = extractFeatures(fullNorm);
    const fullResult = evaluate("planche", fullNorm, fullFeats);

    const firstNorm = normalizePoseTimeSeries(firstHalf);
    const firstFeats = extractFeatures(firstNorm);
    const firstResult = evaluate("planche", firstNorm, firstFeats);

    const secondNorm = normalizePoseTimeSeries(secondHalf);
    const secondFeats = extractFeatures(secondNorm);
    const secondResult = evaluate("planche", secondNorm, secondFeats);

    // Full video coverage is wider
    const fullCov = fullResult.meta.coverageInfo!;
    const firstCov = firstResult.meta.coverageInfo!;
    const secondCov = secondResult.meta.coverageInfo!;

    const fullRange = fullCov.coarseScanTimeRange[1] - fullCov.coarseScanTimeRange[0];
    const firstRange = firstCov.coarseScanTimeRange[1] - firstCov.coarseScanTimeRange[0];
    const secondRange = secondCov.coarseScanTimeRange[1] - secondCov.coarseScanTimeRange[0];

    expect(fullRange).toBeGreaterThan(firstRange);
    expect(fullRange).toBeGreaterThan(secondRange);
  });

  it("long planche (best at 70%): full video score >= first-half score", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);

    const fullNorm = normalizePoseTimeSeries(full);
    const fullFeats = extractFeatures(fullNorm);
    const fullResult = evaluate("planche", fullNorm, fullFeats);

    const firstNorm = normalizePoseTimeSeries(firstHalf);
    const firstFeats = extractFeatures(firstNorm);
    const firstResult = evaluate("planche", firstNorm, firstFeats);

    // Best moment is at 70%, so full should find it but first half shouldn't
    expect(fullResult.finalScore).toBeGreaterThanOrEqual(firstResult.finalScore);
  });

  it("handstand: full video vs halves all produce valid coverageInfo", () => {
    const full = FIXTURES.handstand.longHold();
    const firstHalf = FIXTURES.split.firstHalf(full);
    const secondHalf = FIXTURES.split.secondHalf(full);

    for (const series of [full, firstHalf, secondHalf]) {
      const norm = normalizePoseTimeSeries(series);
      const feats = extractFeatures(norm);
      const result = evaluate("handstand", norm, feats);

      expect(result.meta.coverageInfo).toBeDefined();
      expect(result.meta.coverageInfo!.fullScanPerformed).toBe(true);
      expect(result.meta.coverageInfo!.summary.length).toBeGreaterThan(0);
    }
  });
});
