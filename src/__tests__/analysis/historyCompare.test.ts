/**
 * Tests for buildMiddleSplitComparison — the data layer behind the
 * HistoryCompareRow UI. Covers:
 * - Null-return guards (no previous, wrong technique, missing middleSplit)
 * - Retry hard-block and reliability-gap block
 * - Frontality caution note (comparable but noisy)
 * - Per-metric verdicts (improved / regressed / same) with tolerances
 * - Limiter change detection
 */

import { describe, it, expect } from "vitest";
import { buildMiddleSplitComparison } from "@/lib/analysis/history-compare";
import type { HistoryEntry } from "@/lib/analysis/history";

function makeEntry(
  overrides: Omit<Partial<HistoryEntry>, "middleSplit"> & {
    middleSplit?: Partial<NonNullable<HistoryEntry["middleSplit"]>> | undefined;
  } = {},
): HistoryEntry {
  const defaultMiddleSplit = {
    splitAngle: 150,
    leftRightAngleDiff: 4,
    pelvisRollAngle: 6,
    trunkLeanAngle: 3,
    primaryLimiterId: "split_angle_open",
    primaryLimiterLabel: "開脚角度不足",
  };

  // Distinguish "not passed" vs "explicitly passed as undefined"
  const middleSplit = !("middleSplit" in overrides)
    ? defaultMiddleSplit
    : overrides.middleSplit
      ? { ...defaultMiddleSplit, ...overrides.middleSplit }
      : undefined;

  const { middleSplit: _ms, ...rest } = overrides;
  return {
    id: `id-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    technique: "middle_split",
    trickNameJa: "開脚",
    score: 70,
    qualityLevel: "good",
    reliability: 0.85,
    frontalityScore: 0.9,
    ...rest,
    middleSplit,
  };
}

describe("buildMiddleSplitComparison — guards", () => {
  it("returns null when there is no previous entry", () => {
    expect(buildMiddleSplitComparison(makeEntry(), undefined)).toBeNull();
  });

  it("returns null when techniques differ", () => {
    const latest = makeEntry();
    const previous = makeEntry({ technique: "handstand" });
    expect(buildMiddleSplitComparison(latest, previous)).toBeNull();
  });

  it("returns null when either side is missing the middleSplit block", () => {
    const latest = makeEntry();
    const previous = makeEntry({ middleSplit: undefined });
    expect(buildMiddleSplitComparison(latest, previous)).toBeNull();
  });
});

describe("buildMiddleSplitComparison — block cases", () => {
  it("is incomparable when either side has qualityLevel=retry", () => {
    const latest = makeEntry({ qualityLevel: "retry" });
    const previous = makeEntry();
    const out = buildMiddleSplitComparison(latest, previous);
    expect(out).not.toBeNull();
    expect(out!.comparable).toBe(false);
    expect(out!.incomparableReason).toMatch(/再撮影/);
  });

  it("is incomparable when reliability gap is >= 0.2", () => {
    const latest = makeEntry({ reliability: 0.9 });
    const previous = makeEntry({ reliability: 0.6 });
    const out = buildMiddleSplitComparison(latest, previous);
    expect(out).not.toBeNull();
    expect(out!.comparable).toBe(false);
    expect(out!.incomparableReason).toMatch(/信頼度/);
  });
});

describe("buildMiddleSplitComparison — comparable deltas", () => {
  it("marks splitAngle improved when latest > previous beyond tolerance", () => {
    const latest = makeEntry({ middleSplit: { splitAngle: 160 } });
    const previous = makeEntry({ middleSplit: { splitAngle: 150 } });
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.comparable).toBe(true);
    const split = out.deltas.find((d) => d.key === "splitAngle")!;
    expect(split.verdict).toBe("improved");
    expect(split.delta).toBe(10);
  });

  it("marks splitAngle regressed when latest < previous", () => {
    const latest = makeEntry({ middleSplit: { splitAngle: 140 } });
    const previous = makeEntry({ middleSplit: { splitAngle: 150 } });
    const out = buildMiddleSplitComparison(latest, previous)!;
    const split = out.deltas.find((d) => d.key === "splitAngle")!;
    expect(split.verdict).toBe("regressed");
    expect(split.delta).toBe(-10);
  });

  it("marks deltas under the noise tolerance as 'same'", () => {
    const latest = makeEntry({ middleSplit: { splitAngle: 151 } });
    const previous = makeEntry({ middleSplit: { splitAngle: 150 } });
    const out = buildMiddleSplitComparison(latest, previous)!;
    const split = out.deltas.find((d) => d.key === "splitAngle")!;
    // 1° < 2° tolerance
    expect(split.verdict).toBe("same");
  });

  it("smaller leftRightAngleDiff counts as improved (smaller-is-better)", () => {
    const latest = makeEntry({ middleSplit: { leftRightAngleDiff: 2 } });
    const previous = makeEntry({ middleSplit: { leftRightAngleDiff: 6 } });
    const out = buildMiddleSplitComparison(latest, previous)!;
    const lr = out.deltas.find((d) => d.key === "leftRightAngleDiff")!;
    expect(lr.verdict).toBe("improved");
    expect(lr.delta).toBe(-4);
  });

  it("attaches a cautionNote when frontality gap is >= 0.15", () => {
    const latest = makeEntry({ frontalityScore: 0.9 });
    const previous = makeEntry({ frontalityScore: 0.7 });
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.comparable).toBe(true);
    expect(out.cautionNote).toBeDefined();
  });

  it("no cautionNote when frontality scores are close", () => {
    const latest = makeEntry({ frontalityScore: 0.92 });
    const previous = makeEntry({ frontalityScore: 0.88 });
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.cautionNote).toBeUndefined();
  });
});

describe("buildMiddleSplitComparison — limiter change", () => {
  it("reports kind='same' when primary limiter id matches", () => {
    const latest = makeEntry();
    const previous = makeEntry();
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.limiter.kind).toBe("same");
  });

  it("reports kind='changed' when primary limiter id differs", () => {
    const latest = makeEntry({
      middleSplit: {
        primaryLimiterId: "pelvis_roll",
        primaryLimiterLabel: "骨盤傾き",
      },
    });
    const previous = makeEntry();
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.limiter.kind).toBe("changed");
    expect(out.limiter.latestLabel).toBe("骨盤傾き");
    expect(out.limiter.previousLabel).toBe("開脚角度不足");
  });

  it("reports kind='unknown' when either side lacks a limiter id", () => {
    const latest = makeEntry({
      middleSplit: { primaryLimiterId: undefined },
    });
    const previous = makeEntry();
    const out = buildMiddleSplitComparison(latest, previous)!;
    expect(out.limiter.kind).toBe("unknown");
  });
});
