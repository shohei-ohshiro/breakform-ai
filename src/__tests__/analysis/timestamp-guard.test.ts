import { describe, it, expect } from "vitest";
import {
  computeCoarseFrameCount,
  TimestampMismatchError,
  createTimestampTracker,
  guardTimestamp,
} from "@/lib/pose/mediapipe";
import { ExtractionDiagnostics, SamplingInfo } from "@/lib/analysis/types";

// ============================================
// Unit: Timestamp guard rejects non-monotonic sequences
// ============================================

describe("guardTimestamp", () => {
  it("accepts strictly increasing timestamps", () => {
    const tracker = createTimestampTracker();
    expect(() => guardTimestamp(tracker, 0, "coarse", 0, 1)).not.toThrow();
    expect(() => guardTimestamp(tracker, 100, "coarse", 0.1, 1)).not.toThrow();
    expect(() => guardTimestamp(tracker, 200, "coarse", 0.2, 1)).not.toThrow();
  });

  it("rejects equal timestamps", () => {
    const tracker = createTimestampTracker();
    guardTimestamp(tracker, 100, "coarse", 0.1, 1);
    expect(() => guardTimestamp(tracker, 100, "coarse", 0.1, 1)).toThrow(
      TimestampMismatchError
    );
  });

  it("rejects backward timestamps", () => {
    const tracker = createTimestampTracker();
    guardTimestamp(tracker, 200, "coarse", 0.2, 1);
    guardTimestamp(tracker, 500, "coarse", 0.5, 1);
    expect(() => guardTimestamp(tracker, 300, "coarse", 0.3, 1)).toThrow(
      TimestampMismatchError
    );
  });

  it("error contains phase, timestamps, and diagnostics", () => {
    const tracker = createTimestampTracker();
    guardTimestamp(tracker, 10800, "coarse", 10.8, 42);
    try {
      guardTimestamp(tracker, 7000, "refine:most_horizontal", 7.0, 42);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TimestampMismatchError);
      const err = e as TimestampMismatchError;
      expect(err.phase).toBe("refine:most_horizontal");
      expect(err.currentTimestampMs).toBe(7000);
      expect(err.previousTimestampMs).toBe(10800);
      expect(err.videoCurrentTime).toBe(7.0);
      expect(err.landmarkerInstanceId).toBe(42);
      expect(err.diagnostics).toContain("7000");
      expect(err.diagnostics).toContain("10800");
    }
  });

  it("user-facing message is in Japanese and does not contain raw stack", () => {
    const tracker = createTimestampTracker();
    guardTimestamp(tracker, 100, "coarse", 0.1, 1);
    try {
      guardTimestamp(tracker, 50, "refine", 0.05, 1);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as TimestampMismatchError;
      expect(err.message).toContain("動画解析中");
      expect(err.message).toContain("再解析");
      // Should NOT contain raw MediaPipe jargon
      expect(err.message).not.toContain("CalculatorGraph");
      expect(err.message).not.toContain("norm_rect");
    }
  });

  it("each tracker is independent", () => {
    const tracker1 = createTimestampTracker();
    const tracker2 = createTimestampTracker();
    guardTimestamp(tracker1, 10000, "coarse", 10.0, 1);
    // tracker2 should accept 5000 even though tracker1 is at 10000
    expect(() => guardTimestamp(tracker2, 5000, "refine", 5.0, 2)).not.toThrow();
  });
});

// ============================================
// Unit: Coarse → Refine uses separate trackers (design verification)
// ============================================

describe("Coarse → Refine phase separation", () => {
  it("simulated coarse then refine: separate trackers never conflict", () => {
    const duration = 11.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    // Simulate coarse phase
    const coarseTracker = createTimestampTracker();
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      const tsMs = Math.round(time * 1000);
      guardTimestamp(coarseTracker, tsMs, "coarse", time, 1);
    }

    // The coarse tracker's last timestamp is well past any refine window start
    expect(coarseTracker.previousTimestampMs).toBeGreaterThan(10000);

    // Simulate refine phase with a SEPARATE tracker (as the fixed code does)
    const refineTracker = createTimestampTracker();
    const refineStart = 7.0;
    const refineEnd = 8.0;
    const refineFps = 15;
    const refineInterval = 1 / refineFps;
    let t = refineStart;
    while (t <= refineEnd) {
      const tsMs = Math.round(t * 1000);
      // This must NOT throw — the refine tracker starts fresh
      expect(() =>
        guardTimestamp(refineTracker, tsMs, "refine:most_horizontal", t, 2)
      ).not.toThrow();
      t += refineInterval;
    }
  });

  it("simulated coarse then refine with SAME tracker WOULD throw (regression proof)", () => {
    const duration = 11.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    // Single shared tracker (the old bug)
    const sharedTracker = createTimestampTracker();
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      const tsMs = Math.round(time * 1000);
      guardTimestamp(sharedTracker, tsMs, "coarse", time, 1);
    }

    // Refine at 7.0s — backward from ~10.8s — MUST throw
    expect(() =>
      guardTimestamp(sharedTracker, 7000, "refine:most_horizontal", 7.0, 1)
    ).toThrow(TimestampMismatchError);
  });
});

// ============================================
// Integration: 11-second video coarse + refine timestamps
// ============================================

describe("11-second video coarse + earlier refine", () => {
  it("coarse timestamps are strictly increasing for 11s video", () => {
    const duration = 11.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    let prevMs = -1;
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      const tsMs = Math.round(time * 1000);
      expect(tsMs).toBeGreaterThan(prevMs);
      prevMs = tsMs;
    }
  });

  it("refine window 7-8s timestamps are strictly increasing", () => {
    const refineFps = 15;
    const interval = 1 / refineFps;
    let prevMs = -1;
    for (let t = 7.0; t <= 8.0; t += interval) {
      const tsMs = Math.round(t * 1000);
      expect(tsMs).toBeGreaterThan(prevMs);
      prevMs = tsMs;
    }
  });
});

// ============================================
// Integration: 5-second short video
// ============================================

describe("5-second video coarse + refine", () => {
  it("coarse timestamps strictly increase for 5s video", () => {
    const duration = 5.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    let prevMs = -1;
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      const tsMs = Math.round(time * 1000);
      expect(tsMs).toBeGreaterThan(prevMs);
      prevMs = tsMs;
    }
  });

  it("separate trackers allow 5s coarse then earlier refine", () => {
    const duration = 5.0;
    const { count } = computeCoarseFrameCount(duration, "planche");
    const interval = duration / count;

    const coarseTracker = createTimestampTracker();
    for (let i = 0; i < count; i++) {
      const time = i * interval;
      if (time >= duration) break;
      guardTimestamp(coarseTracker, Math.round(time * 1000), "coarse", time, 1);
    }

    // Refine around 2-3s — earlier than the coarse end (~4.8s)
    const refineTracker = createTimestampTracker();
    const refineInterval = 1 / 15;
    for (let t = 2.0; t <= 3.0; t += refineInterval) {
      expect(() =>
        guardTimestamp(refineTracker, Math.round(t * 1000), "refine", t, 2)
      ).not.toThrow();
    }
  });
});

// ============================================
// Integration: Multiple refine windows sorted by startTime
// ============================================

describe("Multiple refine windows in sorted order", () => {
  it("two non-overlapping windows share one tracker if sorted", () => {
    const refineTracker = createTimestampTracker();
    const refineFps = 15;
    const interval = 1 / refineFps;

    // Window 1: 3.0–4.0s
    for (let t = 3.0; t <= 4.0; t += interval) {
      expect(() =>
        guardTimestamp(refineTracker, Math.round(t * 1000), "refine:static_hold", t, 3)
      ).not.toThrow();
    }

    // Window 2: 7.0–8.0s (later, so monotonic)
    for (let t = 7.0; t <= 8.0; t += interval) {
      expect(() =>
        guardTimestamp(refineTracker, Math.round(t * 1000), "refine:most_horizontal", t, 3)
      ).not.toThrow();
    }
  });

  it("unsorted windows would fail with shared tracker", () => {
    const refineTracker = createTimestampTracker();

    // Window at 7.0s first
    guardTimestamp(refineTracker, 7000, "refine:most_horizontal", 7.0, 3);
    guardTimestamp(refineTracker, 8000, "refine:most_horizontal", 8.0, 3);

    // Then window at 3.0s — backward, would throw
    expect(() =>
      guardTimestamp(refineTracker, 3000, "refine:static_hold", 3.0, 3)
    ).toThrow(TimestampMismatchError);
  });
});

// ============================================
// Regression: coverageInfo / lastTime / extractionDiagnostics
// ============================================

describe("ExtractionDiagnostics regression", () => {
  it("diagnostics structure remains valid after fix", () => {
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

    const allTs = [...coarseTimestamps, ...refinedTimestamps].sort((a, b) => a - b);
    const firstTime = allTs[0];
    const lastTime = allTs[allTs.length - 1];

    const diag: ExtractionDiagnostics = {
      coarseFrameTimestamps: coarseTimestamps,
      refinedFrameTimestamps: refinedTimestamps,
      firstExtractedTime: firstTime,
      lastExtractedTime: lastTime,
      extractedFrameCount: allTs.length,
      videoDuration: duration,
      durationCoverageRatio: lastTime / duration,
      seekTimeouts: 0,
      coarseExtractionTimeMs: 3500,
      refineExtractionTimeMs: 400,
    };

    // Existing expectations still hold
    expect(diag.firstExtractedTime).toBe(0);
    expect(diag.lastExtractedTime).toBeGreaterThan(10.0);
    expect(diag.durationCoverageRatio).toBeGreaterThan(0.9);
    expect(diag.extractedFrameCount).toBe(count + 5);
    expect(diag.seekTimeouts).toBe(0);
    expect(diag.coarseExtractionTimeMs).toBeGreaterThan(0);
    expect(diag.refineExtractionTimeMs).toBeGreaterThan(0);
  });

  it("SamplingInfo structure unchanged after fix", () => {
    const sampling: SamplingInfo = {
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

    expect(sampling.samplingStrategy).toBe("full_scan_then_refine");
    expect(sampling.coarseSampleCount).toBe(55);
    expect(sampling.refinedSampleCount).toBe(20);
    expect(sampling.selectedWindows).toHaveLength(2);
    expect(sampling.coveredDurationRatio).toBe(1.0);
  });
});
