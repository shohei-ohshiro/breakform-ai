/**
 * Compare two middle_split history entries and produce the data the
 * HistoryCompareRow UI needs.
 *
 * Responsibilities:
 * - Decide if the two entries can be compared fairly.
 * - Emit a per-metric delta with a 3-way verdict (improved / regressed / same).
 * - Emit a human-readable note when reliability or frontality differ too much.
 *
 * Kept UI-independent so it can be unit-tested without rendering.
 */

import type { HistoryEntry } from "./history";

export type DeltaVerdict = "improved" | "regressed" | "same";

export interface MetricDelta {
  key:
    | "splitAngle"
    | "leftRightAngleDiff"
    | "pelvisRollAngle"
    | "trunkLeanAngle";
  label: string;
  unit: "°";
  /** Most recent value. */
  latest: number;
  /** Previous value we're comparing against. */
  previous: number;
  /** latest − previous, rounded to 1 decimal. */
  delta: number;
  /** Improvement direction: for angle this is "larger", for diffs it's "smaller". */
  verdict: DeltaVerdict;
}

export interface LimiterChange {
  /** "same" if the primary limiter id didn't change, "changed" if it did,
   *  "unknown" if either side is missing a limiter id. */
  kind: "same" | "changed" | "unknown";
  latestLabel?: string;
  previousLabel?: string;
}

export interface MiddleSplitComparison {
  /** True when the comparison UI should render numeric chips. */
  comparable: boolean;
  /** When not comparable, a short reason the UI can display. */
  incomparableReason?: string;
  /** Optional note to show *alongside* numbers when they are still shown
   *  but should be taken with caution (not enough to block the compare). */
  cautionNote?: string;
  deltas: MetricDelta[];
  limiter: LimiterChange;
  /** The pair of entries we actually compared. */
  latest: HistoryEntry;
  previous: HistoryEntry;
}

const RELIABILITY_GAP_BLOCK = 0.2;
const FRONTALITY_GAP_BLOCK = 0.15;

// Per-metric "same" tolerances, in degrees.
const NOISE_TOLERANCE: Record<MetricDelta["key"], number> = {
  splitAngle: 2,
  leftRightAngleDiff: 1,
  pelvisRollAngle: 2,
  trunkLeanAngle: 2,
};

/** Bigger-is-better metrics (only splitAngle for middle_split). */
const BIGGER_IS_BETTER: ReadonlySet<MetricDelta["key"]> = new Set(["splitAngle"]);

/**
 * Given the current analysis entry and a candidate previous entry, build a
 * comparison. Returns `null` when we should not render a compare row at all
 * (e.g. no previous entry, different techniques, missing middleSplit block).
 */
export function buildMiddleSplitComparison(
  latest: HistoryEntry,
  previous: HistoryEntry | undefined,
): MiddleSplitComparison | null {
  if (!previous) return null;
  if (latest.technique !== "middle_split" || previous.technique !== "middle_split") {
    return null;
  }
  if (!latest.middleSplit || !previous.middleSplit) return null;

  // Hard-block comparisons when either side is a retry — numbers are noise.
  if (latest.qualityLevel === "retry" || previous.qualityLevel === "retry") {
    return {
      comparable: false,
      incomparableReason:
        "いずれかの測定結果が信頼できないため比較できません。再撮影してください。",
      deltas: [],
      limiter: { kind: "unknown" },
      latest,
      previous,
    };
  }

  // Large reliability gap — show an incomparable state with a pointer to why.
  const relGap = Math.abs(latest.reliability - previous.reliability);
  if (relGap >= RELIABILITY_GAP_BLOCK) {
    return {
      comparable: false,
      incomparableReason: `信頼度が大きく異なるため単純比較は避けてください（前回 ${(previous.reliability * 100).toFixed(0)}% / 今回 ${(latest.reliability * 100).toFixed(0)}%）`,
      deltas: [],
      limiter: {
        kind: limiterKind(latest, previous),
        latestLabel: latest.middleSplit.primaryLimiterLabel,
        previousLabel: previous.middleSplit.primaryLimiterLabel,
      },
      latest,
      previous,
    };
  }

  // Large frontality gap — comparable but worth a caution note.
  let cautionNote: string | undefined;
  if (
    latest.frontalityScore != null &&
    previous.frontalityScore != null &&
    Math.abs(latest.frontalityScore - previous.frontalityScore) >= FRONTALITY_GAP_BLOCK
  ) {
    cautionNote =
      "撮影角度が前回と違う可能性があるため、数値差はあくまで参考として見てください。";
  }

  const deltas: MetricDelta[] = [
    makeDelta(
      "splitAngle",
      "開脚角度",
      latest.middleSplit.splitAngle,
      previous.middleSplit.splitAngle,
    ),
    makeDelta(
      "leftRightAngleDiff",
      "左右差",
      latest.middleSplit.leftRightAngleDiff,
      previous.middleSplit.leftRightAngleDiff,
    ),
    makeDelta(
      "pelvisRollAngle",
      "骨盤傾き",
      latest.middleSplit.pelvisRollAngle,
      previous.middleSplit.pelvisRollAngle,
    ),
    makeDelta(
      "trunkLeanAngle",
      "体幹傾き",
      latest.middleSplit.trunkLeanAngle,
      previous.middleSplit.trunkLeanAngle,
    ),
  ];

  return {
    comparable: true,
    cautionNote,
    deltas,
    limiter: {
      kind: limiterKind(latest, previous),
      latestLabel: latest.middleSplit.primaryLimiterLabel,
      previousLabel: previous.middleSplit.primaryLimiterLabel,
    },
    latest,
    previous,
  };
}

function makeDelta(
  key: MetricDelta["key"],
  label: string,
  latest: number,
  previous: number,
): MetricDelta {
  const raw = latest - previous;
  const delta = Math.round(raw * 10) / 10;
  const tol = NOISE_TOLERANCE[key];
  let verdict: DeltaVerdict;
  if (Math.abs(delta) < tol) {
    verdict = "same";
  } else if (BIGGER_IS_BETTER.has(key)) {
    verdict = delta > 0 ? "improved" : "regressed";
  } else {
    verdict = delta < 0 ? "improved" : "regressed";
  }
  return { key, label, unit: "°", latest, previous, delta, verdict };
}

function limiterKind(
  latest: HistoryEntry,
  previous: HistoryEntry,
): LimiterChange["kind"] {
  const a = latest.middleSplit?.primaryLimiterId;
  const b = previous.middleSplit?.primaryLimiterId;
  if (!a || !b) return "unknown";
  return a === b ? "same" : "changed";
}
