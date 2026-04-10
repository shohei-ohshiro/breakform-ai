import {
  NormalizedTimeSeries,
  NormalizedFrame,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  RuleStatus,
  TechniqueEvent,
  SamplingInfo,
  CandidateWindow,
  QualityImpactSummary,
  QualityImpact,
  SwipesCycleSummary,
  SwipesEventSummary,
  LM,
} from "../types";
import { SWIPES_CONFIG as C } from "../config";
import { classify, sev, avg, rankViolations, buildCoverageInfo, computeScoreImpact } from "./utils";

const CONFIG_VERSION = "3.0";

type SwipesMode = "multi_cycle" | "single_cycle" | "partial" | "insufficient";

/**
 * Swipes Evaluator v3.0 — event-based rotation analysis
 *
 * Pipeline:
 *   1. Detect events (hand_plant, leg_swing, kick_peak, phase_change, ...)
 *   2. Extract cycles between hand_plants
 *   3. Classify mode (multi_cycle / single_cycle / partial / insufficient)
 *   4. Score each cycle as a candidate window
 *   5. Pick the clearest cycle (or partial frames) as the scoring window
 *   6. Evaluate 4-5 categories on the selected window
 *   7. Build qualityImpactSummary + transparency meta
 */
export function evaluateSwipes(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo
): EvaluationResult {
  // ---- Insufficient frames ----
  if (series.frames.length < C.general.minFrames) {
    return buildInsufficientResult(series);
  }

  // ---- Phase 1: event detection ----
  const events = detectSwipeEvents(series, features);
  const handPlants = events.filter((e) => e.type === "hand_plant");
  const legSwings = events.filter((e) => e.type === "leg_swing");
  const kickPeaks = events.filter((e) => e.type === "kick_peak");
  const phaseChanges = events.filter((e) => e.type === "phase_change");

  // ---- Phase 2: cycle extraction ----
  const cycles = extractCycles(series, features, events);

  // ---- Phase 3: mode classification ----
  const mode = classifyMode(cycles);

  // ---- Phase 4: candidate windows + selection ----
  const { candidateWindows, selectedCycle, selectedReason } = selectCycleWindow(
    cycles,
    series.frames.length
  );

  // The frames we evaluate. For partial mode without a usable cycle, fall back
  // to whatever frames we have so we can still produce a (capped) result.
  const evalRange: [number, number] = selectedCycle
    ? [selectedCycle.startFrameIdx, selectedCycle.endFrameIdx]
    : [0, series.frames.length - 1];
  const evalFrames = series.frames.slice(evalRange[0], evalRange[1] + 1);
  const evalAngles = features.angles.slice(evalRange[0], evalRange[1] + 1);
  const evalCog = features.cog.slice(evalRange[0], evalRange[1] + 1);

  const confidence = Math.min(1, evalFrames.length / 10);

  // ---- Phase 5: weights based on mode ----
  const weights =
    mode === "multi_cycle"
      ? C.weights.multiCycle
      : mode === "single_cycle"
        ? C.weights.singleCycle
        : C.weights.partial;

  // ---- Phase 6: per-category evaluation ----
  const violations: RuleViolation[] = [];
  const suggestions: string[] = [];

  const supportResult = evaluateSupportStability(
    evalFrames,
    evalAngles,
    selectedCycle,
    handPlants,
    confidence,
    weights[0]
  );
  if (supportResult.violations.length > 0) {
    suggestions.push(
      "サポート時の肘ロックと手首位置を安定させましょう。プランク〜トリポッドで支持感覚を養うのが効果的です。"
    );
  }
  violations.push(...supportResult.violations);

  const entryResult = evaluateEntryQuality(
    series,
    features,
    handPlants,
    selectedCycle,
    confidence,
    weights[1]
  );
  if (entryResult.violations.length > 0) {
    suggestions.push(
      "進入時に股関節を開き、肩を手より前に出すことでスムーズに体重を乗せられます。"
    );
  }
  violations.push(...entryResult.violations);

  const kickResult = evaluateKickPower(
    selectedCycle,
    legSwings,
    kickPeaks,
    confidence,
    weights[2]
  );
  if (kickResult.violations.length > 0) {
    suggestions.push(
      "脚の振り上げを大きく速くし、腰の回転と連動させましょう。左右の蹴りの強さを揃えることも重要です。"
    );
  }
  violations.push(...kickResult.violations);

  const rotationResult = evaluateRotationQuality(
    evalAngles,
    evalCog,
    selectedCycle,
    phaseChanges,
    confidence,
    weights[3]
  );
  if (rotationResult.violations.length > 0) {
    suggestions.push(
      "回転中の体幹を水平に保ち、重心を大きく回旋させましょう。手→足→手の連続を止めないことが鍵です。"
    );
  }
  violations.push(...rotationResult.violations);

  // Rep consistency only in multi_cycle mode
  let repResult: ScoreBreakdown | null = null;
  if (mode === "multi_cycle" && cycles.length >= 2) {
    repResult = evaluateRepConsistency(cycles, confidence, weights[4] as number);
    if (repResult.violations.length > 0) {
      suggestions.push(
        "毎回同じフォーム・タイミングで回転できるよう反復練習しましょう。"
      );
    }
    violations.push(...repResult.violations);
  }

  // ---- Phase 7: build breakdown ----
  const breakdown: ScoreBreakdown[] = [
    { ...supportResult, weight: weights[0] },
    { ...entryResult, weight: weights[1] },
    { ...kickResult, weight: weights[2] },
    { ...rotationResult, weight: weights[3] },
  ];
  if (repResult) {
    breakdown.push({ ...repResult, weight: weights[4] as number });
  }

  let finalScore = Math.round(
    breakdown.reduce((sum, b) => sum + b.score * b.weight, 0)
  );

  // Partial mode score cap
  if (mode === "partial" && finalScore > C.mode.partialScoreCap) {
    finalScore = C.mode.partialScoreCap;
  }

  // ---- Phase 8: quality impact ----
  const qualityImpactSummary = buildQualityImpactSummary(
    series,
    features,
    selectedCycle,
    cycles
  );

  // ---- Phase 9: meta ----
  const cycleSummary: SwipesCycleSummary = {
    detectedCycles: cycles.length,
    selectedCycleIndex: selectedCycle
      ? cycles.findIndex((c) => c === selectedCycle)
      : -1,
    cycleDurations: cycles.map((c) => Math.round(c.duration * 100) / 100),
    avgCycleDuration:
      cycles.length > 0
        ? Math.round((cycles.reduce((s, c) => s + c.duration, 0) / cycles.length) * 100) / 100
        : 0,
  };

  const eventSummary: SwipesEventSummary = {
    handPlantCount: handPlants.length,
    legSwingCount: legSwings.length,
    phaseChangeCount: phaseChanges.length,
    kickPeakCount: kickPeaks.length,
  };

  const evaluationModeReason = buildModeReason(mode, cycles.length, handPlants.length);

  const scoringStartTime = series.frames[evalRange[0]]?.timestamp ?? 0;
  const scoringEndTime = series.frames[evalRange[1]]?.timestamp ?? series.duration;

  const coverageInfo = buildCoverageInfo(
    series,
    evalRange[0],
    evalRange[1],
    selectedCycle ? "選定したサイクル区間" : "サイクル未検出のため全フレームを使用",
    sampling
  );

  return {
    technique: "swipes",
    finalScore,
    breakdown,
    violations: rankViolations(violations),
    events,
    suggestionsRaw: suggestions,
    meta: {
      analyzedFrameRange: evalRange,
      staticIntervalUsed: null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
      evaluationMode: mode,
      coverageInfo,
      evaluationModeReason,
      selectedEvaluationWindow: { startTime: scoringStartTime, endTime: scoringEndTime },
      selectedReason,
      candidateWindowsTopN: candidateWindows,
      qualityImpactSummary,
      cycleSummary,
      eventSummary,
    },
  };
}

// ============================================================
// Insufficient result
// ============================================================
function buildInsufficientResult(series: NormalizedTimeSeries): EvaluationResult {
  return {
    technique: "swipes",
    finalScore: 0,
    breakdown: [],
    violations: [
      {
        ruleId: "swipes_insufficient_frames",
        severity: "critical",
        status: "fail",
        bodyPart: "全体",
        message: `スワイプスの分析には動画が必要です（最低${C.general.minFrames}フレーム）`,
        actual: series.frames.length,
        ideal: C.general.minFrames,
        threshold: { warn: C.general.minFrames, fail: C.general.minFrames },
        deviation: C.general.minFrames - series.frames.length,
        unit: "frames",
        confidence: 0,
      },
    ],
    events: [],
    suggestionsRaw: [
      "スワイプスは動作系の技のため、動画での分析が必要です。1〜2回転が映る動画をアップロードしてください。",
    ],
    meta: {
      analyzedFrameRange: [0, 0],
      staticIntervalUsed: null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
      evaluationMode: "insufficient",
    },
  };
}

// ============================================================
// Event detection (rewritten — O(n) with timestamp→index Maps)
// ============================================================
function detectSwipeEvents(
  series: NormalizedTimeSeries,
  features: FeatureSet
): TechniqueEvent[] {
  const events: TechniqueEvent[] = [];
  const frames = series.frames;
  if (frames.length < 2) return events;

  // Precompute velocity Maps for O(1) lookup
  const wristLVels = velocityMap(features, LM.LEFT_WRIST);
  const wristRVels = velocityMap(features, LM.RIGHT_WRIST);
  const ankleLVels = velocityMap(features, LM.LEFT_ANKLE);
  const ankleRVels = velocityMap(features, LM.RIGHT_ANKLE);

  // Dynamic yThreshold: prefer static, but fall back to CoG-based if static
  // detects no contacts at all (camera-angle robust).
  const staticThreshold = C.handPlant.yThreshold;
  const cogYs = features.cog.map((c) => c.y);
  const cogMean = avg(cogYs);
  const cogStd = Math.sqrt(
    cogYs.reduce((s, y) => s + (y - cogMean) ** 2, 0) / Math.max(1, cogYs.length)
  );
  const dynamicThreshold = cogMean - cogStd * C.handPlant.dynamicOffsetSigma;

  // First pass: try static threshold; if no plants detected, retry with dynamic
  let yThreshold: number = staticThreshold;
  let plantedAny = false;
  for (let pass = 0; pass < 2; pass++) {
    const localEvents: TechniqueEvent[] = [];
    plantedAny = false;

    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      const prevFrame = frames[i - 1];
      const lm = frame.landmarks;
      const prevLm = prevFrame.landmarks;

      // Hand plant: wrist Y crossed below threshold (descending)
      const lWy = lm[LM.LEFT_WRIST].y;
      const plWy = prevLm[LM.LEFT_WRIST].y;
      if (lWy < yThreshold && plWy >= yThreshold) {
        localEvents.push({
          type: "hand_plant",
          timestamp: frame.timestamp,
          frameIndex: i,
          details: {
            hand: "left",
            wristY: round(lWy, 3),
            speed: round(wristLVels.get(frame.timestamp)?.speed ?? 0, 3),
          },
        });
        plantedAny = true;
      }
      const rWy = lm[LM.RIGHT_WRIST].y;
      const prWy = prevLm[LM.RIGHT_WRIST].y;
      if (rWy < yThreshold && prWy >= yThreshold) {
        localEvents.push({
          type: "hand_plant",
          timestamp: frame.timestamp,
          frameIndex: i,
          details: {
            hand: "right",
            wristY: round(rWy, 3),
            speed: round(wristRVels.get(frame.timestamp)?.speed ?? 0, 3),
          },
        });
        plantedAny = true;
      }

      // Hand lift: wrist Y crossed above threshold (ascending)
      if (lWy >= yThreshold && plWy < yThreshold) {
        localEvents.push({
          type: "hand_lift",
          timestamp: frame.timestamp,
          frameIndex: i,
          details: { hand: "left", wristY: round(lWy, 3) },
        });
      }
      if (rWy >= yThreshold && prWy < yThreshold) {
        localEvents.push({
          type: "hand_lift",
          timestamp: frame.timestamp,
          frameIndex: i,
          details: { hand: "right", wristY: round(rWy, 3) },
        });
      }
    }

    if (plantedAny || pass === 1) {
      events.push(...localEvents);
      break;
    }
    // Retry with dynamic threshold
    yThreshold = dynamicThreshold;
  }

  // Leg swing detection (O(n) using map lookups)
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    const prevFrame = frames[i - 1];

    const lA = ankleLVels.get(frame.timestamp);
    const plA = ankleLVels.get(prevFrame.timestamp);
    if (lA && lA.speed > C.legSwing.speedMin && (!plA || plA.speed <= C.legSwing.speedMin)) {
      events.push({
        type: "leg_swing",
        timestamp: frame.timestamp,
        frameIndex: i,
        details: { side: "left", speed: round(lA.speed, 3) },
      });
    }
    const rA = ankleRVels.get(frame.timestamp);
    const prA = ankleRVels.get(prevFrame.timestamp);
    if (rA && rA.speed > C.legSwing.speedMin && (!prA || prA.speed <= C.legSwing.speedMin)) {
      events.push({
        type: "leg_swing",
        timestamp: frame.timestamp,
        frameIndex: i,
        details: { side: "right", speed: round(rA.speed, 3) },
      });
    }
  }

  // Kick peak: local maxima in ankle speed above speedGood
  detectKickPeaks(frames, ankleLVels, "left", events);
  detectKickPeaks(frames, ankleRVels, "right", events);

  // Phase changes (with debounce)
  detectPhaseChanges(frames, yThreshold, events);

  // Landing contact: aerial → hands or aerial → feet (subset of phase_change)
  // Already covered by phase_change events; emit separate marker for clarity.
  // Skipped for v3.0 to keep events list lean — phase_change carries the info.

  events.sort((a, b) => a.timestamp - b.timestamp || a.frameIndex - b.frameIndex);
  return events;
}

function velocityMap(features: FeatureSet, lmIdx: number): Map<number, { speed: number }> {
  const m = new Map<number, { speed: number }>();
  const arr = features.velocities.get(lmIdx) ?? [];
  for (const v of arr) m.set(v.timestamp, { speed: v.speed });
  return m;
}

function detectKickPeaks(
  frames: NormalizedFrame[],
  velMap: Map<number, { speed: number }>,
  side: "left" | "right",
  events: TechniqueEvent[]
) {
  // Local maxima with speed > speedGood, separated by at least 3 frames
  let lastPeakIdx = -10;
  for (let i = 1; i < frames.length - 1; i++) {
    const cur = velMap.get(frames[i].timestamp)?.speed ?? 0;
    const prev = velMap.get(frames[i - 1].timestamp)?.speed ?? 0;
    const next = velMap.get(frames[i + 1].timestamp)?.speed ?? 0;
    if (cur > C.legSwing.speedGood && cur >= prev && cur >= next && i - lastPeakIdx >= 3) {
      events.push({
        type: "kick_peak",
        timestamp: frames[i].timestamp,
        frameIndex: i,
        details: { side, speed: round(cur, 3) },
      });
      lastPeakIdx = i;
    }
  }
}

function detectPhaseChanges(
  frames: NormalizedFrame[],
  yThreshold: number,
  events: TechniqueEvent[]
) {
  // Compute raw phase per frame
  const phases: string[] = frames.map((f) => {
    const lm = f.landmarks;
    const wristMinY = Math.min(lm[LM.LEFT_WRIST].y, lm[LM.RIGHT_WRIST].y);
    const ankleMinY = Math.min(lm[LM.LEFT_ANKLE].y, lm[LM.RIGHT_ANKLE].y);
    if (wristMinY < yThreshold) return "hands";
    if (ankleMinY < yThreshold) return "feet";
    return "aerial";
  });

  // Debounce: a phase must persist for `debounceFrames` consecutive frames
  // before it's committed.
  const debounce = C.phaseTransition.debounceFrames;
  const stable: (string | null)[] = new Array(phases.length).fill(null);
  let i = 0;
  while (i < phases.length) {
    let j = i;
    while (j < phases.length && phases[j] === phases[i]) j++;
    const runLen = j - i;
    if (runLen >= debounce) {
      for (let k = i; k < j; k++) stable[k] = phases[i];
    }
    i = j;
  }
  // Forward-fill nulls with previous stable phase
  let last: string | null = null;
  for (let k = 0; k < stable.length; k++) {
    if (stable[k] === null) stable[k] = last;
    else last = stable[k];
  }

  // Emit phase_change events
  let prev: string | null = null;
  for (let k = 0; k < stable.length; k++) {
    const cur = stable[k];
    if (cur && cur !== prev && prev !== null) {
      events.push({
        type: "phase_change",
        timestamp: frames[k].timestamp,
        frameIndex: k,
        details: { from: prev, to: cur },
      });
    }
    if (cur) prev = cur;
  }
}

// ============================================================
// Cycle extraction
// ============================================================
interface DetectedCycle {
  index: number;
  startFrameIdx: number;
  endFrameIdx: number;
  startTime: number;
  endTime: number;
  duration: number;
  /** Events occurring within this cycle */
  events: TechniqueEvent[];
  // Cached features
  cycleClarity: number;
  avgHorizontality: number;
  kickPeakSpeed: number;
  visibilityScore: number;
  cogHorizontalRange: number;
  isEdgeCycle: boolean;
  edgeProximity: number;
}

function extractCycles(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  events: TechniqueEvent[]
): DetectedCycle[] {
  const handPlants = events.filter((e) => e.type === "hand_plant");
  const totalFrames = series.frames.length;
  if (handPlants.length === 0) return [];

  // Dedupe hand_plants that are too close together (e.g. simultaneous L+R plants).
  // The remaining list represents distinct rotation boundaries.
  const cycleStarts: number[] = [];
  let lastTs = -Infinity;
  for (const plant of handPlants) {
    if (plant.timestamp - lastTs >= C.cycle.minCycleDuration) {
      cycleStarts.push(plant.frameIndex);
      lastTs = plant.timestamp;
    }
  }

  // A cycle is defined by a pair of consecutive cycleStarts: from plant N to plant N+1.
  // N distinct plants → N-1 cycles. Fewer than 2 plants = no complete rotation.
  const cycles: DetectedCycle[] = [];
  for (let i = 0; i + 1 < cycleStarts.length; i++) {
    const startIdx = Math.max(0, cycleStarts[i] - C.cycle.cycleBufferFrames);
    const endIdx = Math.min(totalFrames - 1, cycleStarts[i + 1]);

    const startTime = series.frames[startIdx].timestamp;
    const endTime = series.frames[endIdx].timestamp;
    const duration = endTime - startTime;

    // Skip cycles too short or unreasonably long
    if (duration < C.cycle.minCycleDuration) continue;
    if (duration > C.cycle.maxCycleDuration) continue;

    const cycleEvents = events.filter(
      (e) => e.frameIndex >= startIdx && e.frameIndex <= endIdx
    );

    cycles.push({
      index: cycles.length,
      startFrameIdx: startIdx,
      endFrameIdx: endIdx,
      startTime,
      endTime,
      duration,
      events: cycleEvents,
      ...computeCycleFeatures(series, features, startIdx, endIdx, cycleEvents, totalFrames),
    });
  }

  return cycles;
}

function computeCycleFeatures(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  startIdx: number,
  endIdx: number,
  cycleEvents: TechniqueEvent[],
  totalFrames: number
): {
  cycleClarity: number;
  avgHorizontality: number;
  kickPeakSpeed: number;
  visibilityScore: number;
  cogHorizontalRange: number;
  isEdgeCycle: boolean;
  edgeProximity: number;
} {
  const frames = series.frames.slice(startIdx, endIdx + 1);
  const angles = features.angles.slice(startIdx, endIdx + 1);
  const cogs = features.cog.slice(startIdx, endIdx + 1);

  // Cycle clarity: presence of distinct event categories (out of 4)
  const hasHandPlant = cycleEvents.some((e) => e.type === "hand_plant");
  const hasLegSwing = cycleEvents.some((e) => e.type === "leg_swing");
  const hasKickPeak = cycleEvents.some((e) => e.type === "kick_peak");
  const hasPhaseChange = cycleEvents.some((e) => e.type === "phase_change");
  const cycleClarity =
    ((hasHandPlant ? 1 : 0) +
      (hasLegSwing ? 1 : 0) +
      (hasKickPeak ? 1 : 0) +
      (hasPhaseChange ? 1 : 0)) /
    4;

  // Horizontality: avg |spineAngle - 90| during the cycle
  const avgHorizontality =
    angles.length > 0
      ? avg(angles.map((a) => Math.abs(a.spineAngle - 90)))
      : 90;

  // Peak ankle speed within the cycle
  const peaks = cycleEvents.filter((e) => e.type === "kick_peak");
  const kickPeakSpeed =
    peaks.length > 0
      ? Math.max(...peaks.map((p) => (p.details.speed as number) ?? 0))
      : 0;

  // Visibility score: avg of wrist + ankle visibility
  let visSum = 0;
  let visCount = 0;
  for (const f of frames) {
    const lm = f.landmarks;
    visSum +=
      lm[LM.LEFT_WRIST].visibility +
      lm[LM.RIGHT_WRIST].visibility +
      lm[LM.LEFT_ANKLE].visibility +
      lm[LM.RIGHT_ANKLE].visibility;
    visCount += 4;
  }
  const visibilityScore = visCount > 0 ? visSum / visCount : 0;

  // CoG horizontal range
  const cogXs = cogs.map((c) => c.x);
  const cogHorizontalRange =
    cogXs.length > 0 ? Math.max(...cogXs) - Math.min(...cogXs) : 0;

  // Edge proximity
  const edgeDistanceFrames = Math.max(0, totalFrames - 1 - endIdx);
  const edgeProximity =
    totalFrames > 1 ? edgeDistanceFrames / (totalFrames - 1) : 0;
  const isEdgeCycle = edgeDistanceFrames <= 2;

  return {
    cycleClarity,
    avgHorizontality,
    kickPeakSpeed,
    visibilityScore,
    cogHorizontalRange,
    isEdgeCycle,
    edgeProximity,
  };
}

// ============================================================
// Mode classification
// ============================================================
function classifyMode(cycles: DetectedCycle[]): SwipesMode {
  if (cycles.length >= C.mode.multiCycleMinCycles) return "multi_cycle";
  if (cycles.length === 1) return "single_cycle";
  return "partial";
}

function buildModeReason(mode: SwipesMode, cycleCount: number, handPlantCount: number): string {
  if (mode === "multi_cycle") {
    return `${cycleCount}個のサイクルが検出されたため、複数回転モード（multi_cycle）として採点しました。`;
  }
  if (mode === "single_cycle") {
    return `1サイクルのみ検出されたため、単一回転モード（single_cycle）として採点しました。反復一貫性は評価対象外です。`;
  }
  if (mode === "partial") {
    return `完全なサイクルが検出されませんでした（手接地${handPlantCount}回）。部分評価モード（partial）としてスコアを${C.mode.partialScoreCap}点で上限制約しています。`;
  }
  return "フレーム数不足のため評価できませんでした。";
}

// ============================================================
// Candidate window selection
// ============================================================
function selectCycleWindow(
  cycles: DetectedCycle[],
  totalFrames: number
): {
  candidateWindows: CandidateWindow[];
  selectedCycle: DetectedCycle | null;
  selectedReason: string;
} {
  if (cycles.length === 0) {
    return {
      candidateWindows: [],
      selectedCycle: null,
      selectedReason: "サイクルが検出されなかったため、全フレームを評価対象としました。",
    };
  }

  // Score each cycle (lower is better)
  const scored = cycles.map((c) => ({
    cycle: c,
    composite: cycleCompositeScore(c),
  }));
  scored.sort((a, b) => a.composite - b.composite);

  const topN = scored.slice(0, C.general.candidateWindowsTopN);
  const candidateWindows: CandidateWindow[] = topN.map((s, rank) => ({
    rank: rank + 1,
    startTime: round(s.cycle.startTime, 2),
    endTime: round(s.cycle.endTime, 2),
    frameIndices: rangeToIndices(s.cycle.startFrameIdx, s.cycle.endFrameIdx),
    compositeScore: round(s.composite, 2),
    features: {
      frameCount: s.cycle.endFrameIdx - s.cycle.startFrameIdx + 1,
      continuity: 1.0, // cycles are by construction continuous
      edgeProximity: round(s.cycle.edgeProximity, 3),
      isEdgeWindow: s.cycle.isEdgeCycle,
      cycleClarity: round(s.cycle.cycleClarity, 2),
      rotationHorizontality: round(s.cycle.avgHorizontality, 1),
      kickPeakSpeed: round(s.cycle.kickPeakSpeed, 2),
      visibilityScore: round(s.cycle.visibilityScore, 2),
    },
  }));

  const best = scored[0].cycle;

  // Determine selection category
  const category =
    best.cycleClarity >= 0.75 && !best.isEdgeCycle
      ? "最も支持が安定"
      : best.avgHorizontality <= 25
        ? "最も回旋が明瞭"
        : best.kickPeakSpeed >= C.legSwing.speedGood
          ? "最も蹴りが明確"
          : best.visibilityScore >= 0.9
            ? "品質優先"
            : "総合最良";

  const edgeNote = best.isEdgeCycle ? " ※動画終端付近のサイクル。" : "";
  const runnerUp =
    scored.length >= 2
      ? ` 次点候補: ${scored[1].cycle.startTime.toFixed(1)}〜${scored[1].cycle.endTime.toFixed(1)}秒。`
      : "";

  const selectedReason =
    `${cycles.length}サイクル中、${best.startTime.toFixed(1)}〜${best.endTime.toFixed(1)}秒のサイクルを選択。` +
    `選定根拠: ${category}（明瞭度: ${(best.cycleClarity * 100).toFixed(0)}%、` +
    `水平偏差: ${best.avgHorizontality.toFixed(1)}°、` +
    `骨格品質: ${(best.visibilityScore * 100).toFixed(0)}%）。${edgeNote}${runnerUp}`;

  // Suppress unused warning
  void totalFrames;

  return { candidateWindows, selectedCycle: best, selectedReason };
}

function cycleCompositeScore(c: DetectedCycle): number {
  // Each component contributes to a "lower is better" score in [0, ~100]
  const clarityPart = (1 - c.cycleClarity) * 100 * C.candidate.cycleClarityWeight;
  const horizPart = c.avgHorizontality * C.candidate.rotationHorizontalityWeight;
  const visPart = (1 - c.visibilityScore) * 100 * C.candidate.visibilityWeight;
  // Higher kick = better, so invert relative to ideal
  const kickPart =
    Math.max(0, C.legSwing.speedIdeal - c.kickPeakSpeed) *
    10 *
    C.candidate.kickPeakWeight;
  const edgePart = c.isEdgeCycle ? C.candidate.edgePenaltyMax : 0;
  return clarityPart + horizPart + visPart + kickPart + edgePart;
}

function rangeToIndices(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// ============================================================
// Sub-evaluators
// ============================================================
function evaluateSupportStability(
  evalFrames: NormalizedFrame[],
  evalAngles: { leftElbow: number; rightElbow: number }[],
  cycle: DetectedCycle | null,
  handPlants: TechniqueEvent[],
  confidence: number,
  weight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (handPlants.length === 0 || evalFrames.length === 0) {
    violations.push({
      ruleId: "swipes_no_support",
      severity: "critical",
      status: "fail",
      bodyPart: "手",
      message: "手の接地イベントが検出されませんでした",
      actual: 0,
      ideal: 1,
      threshold: { warn: 1, fail: 1 },
      deviation: 1,
      unit: "count",
      confidence,
      scoreImpact: 40 * weight,
    });
    return {
      category: "support_stability",
      label: "サポート安定性",
      score: 20,
      weight: 0,
      violations,
    };
  }

  // Min elbow angle within the eval window (proxy for support phase)
  const elbowAngles = evalAngles.map((a) => (a.leftElbow + a.rightElbow) / 2);
  const minElbow = elbowAngles.length > 0 ? Math.min(...elbowAngles) : 180;
  const elbowDev = Math.max(0, C.supportStability.elbowAngle.ideal - minElbow);

  // Wrist jitter: stddev of wrist X position during eval window
  const wristXs = evalFrames.map(
    (f) => (f.landmarks[LM.LEFT_WRIST].x + f.landmarks[LM.RIGHT_WRIST].x) / 2
  );
  const wMean = avg(wristXs);
  const wristJitter =
    wristXs.length > 1
      ? Math.sqrt(wristXs.reduce((s, x) => s + (x - wMean) ** 2, 0) / wristXs.length)
      : 0;

  const elbowStatus = classify(
    minElbow,
    C.supportStability.elbowAngle.warn,
    C.supportStability.elbowAngle.fail,
    false
  );
  if (elbowStatus !== "pass") {
    violations.push({
      ruleId: "swipes_elbow_bend",
      severity: sev(elbowStatus),
      status: elbowStatus,
      bodyPart: "肘",
      message: `サポート時の肘が${(180 - minElbow).toFixed(0)}°曲がっています（理想: 170°以上）`,
      actual: minElbow,
      ideal: C.supportStability.elbowAngle.ideal,
      threshold: {
        warn: C.supportStability.elbowAngle.warn,
        fail: C.supportStability.elbowAngle.fail,
      },
      deviation: elbowDev,
      unit: "deg",
      confidence,
      scoreImpact: computeScoreImpact(
        elbowDev,
        C.supportStability.deductionPerDeg,
        weight,
        sev(elbowStatus)
      ),
    });
  }

  const jitterStatus = classify(
    wristJitter,
    C.supportStability.wristJitter.warn,
    C.supportStability.wristJitter.fail
  );
  if (jitterStatus !== "pass") {
    violations.push({
      ruleId: "swipes_wrist_jitter",
      severity: sev(jitterStatus),
      status: jitterStatus,
      bodyPart: "手首",
      message: `サポート中の手首位置がブレています（${(wristJitter * 100).toFixed(0)}%）`,
      actual: wristJitter,
      ideal: 0,
      threshold: {
        warn: C.supportStability.wristJitter.warn,
        fail: C.supportStability.wristJitter.fail,
      },
      deviation: wristJitter,
      unit: "ratio",
      confidence,
      scoreImpact: computeScoreImpact(
        wristJitter,
        C.supportStability.jitterMultiplier,
        weight,
        sev(jitterStatus)
      ),
    });
  }

  const elbowScore = Math.max(0, 100 - elbowDev * C.supportStability.deductionPerDeg);
  const jitterScore = Math.max(0, 100 - wristJitter * C.supportStability.jitterMultiplier);
  const score = Math.round((elbowScore + jitterScore) / 2);

  void cycle;
  return {
    category: "support_stability",
    label: "サポート安定性",
    score,
    weight: 0,
    violations,
    measurements: {
      minElbow: round(minElbow, 1),
      elbowDev: round(elbowDev, 1),
      wristJitter: round(wristJitter, 3),
    },
  };
}

function evaluateEntryQuality(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  handPlants: TechniqueEvent[],
  cycle: DetectedCycle | null,
  confidence: number,
  weight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  // Use hand plants within the selected cycle if any, else all
  const targetPlants = cycle
    ? handPlants.filter(
        (e) => e.frameIndex >= cycle.startFrameIdx && e.frameIndex <= cycle.endFrameIdx
      )
    : handPlants;

  if (targetPlants.length === 0) {
    violations.push({
      ruleId: "swipes_no_entry",
      severity: "major",
      status: "fail",
      bodyPart: "全体",
      message: "進入姿勢を評価する手接地イベントがありません",
      actual: 0,
      ideal: 1,
      threshold: { warn: 1, fail: 1 },
      deviation: 1,
      unit: "count",
      confidence,
      scoreImpact: 20 * weight,
    });
    return {
      category: "entry_quality",
      label: "進入フォーム",
      score: 30,
      weight: 0,
      violations,
    };
  }

  let avgHipAngle = 0;
  let avgShoulderForward = 0;
  let count = 0;

  for (const plant of targetPlants) {
    const idx = plant.frameIndex;
    if (idx < features.angles.length && idx < series.frames.length) {
      const a = features.angles[idx];
      avgHipAngle += (a.leftHip + a.rightHip) / 2;
      const lm = series.frames[idx].landmarks;
      const sX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
      const wX = (lm[LM.LEFT_WRIST].x + lm[LM.RIGHT_WRIST].x) / 2;
      avgShoulderForward += sX - wX; // positive = shoulder ahead of wrist
      count++;
    }
  }

  if (count > 0) {
    avgHipAngle /= count;
    avgShoulderForward /= count;
  }

  const hipStatus = classify(
    avgHipAngle,
    C.entryQuality.hipAngle.warn,
    C.entryQuality.hipAngle.fail,
    false
  );
  if (hipStatus !== "pass") {
    const dev = Math.abs(C.entryQuality.hipAngle.ideal - avgHipAngle);
    violations.push({
      ruleId: "swipes_entry_hip_closed",
      severity: sev(hipStatus),
      status: hipStatus,
      bodyPart: "股関節",
      message: `進入時の股関節角度が狭いです（${avgHipAngle.toFixed(1)}°、理想: ${C.entryQuality.hipAngle.ideal}°以上）`,
      actual: avgHipAngle,
      ideal: C.entryQuality.hipAngle.ideal,
      threshold: { warn: C.entryQuality.hipAngle.warn, fail: C.entryQuality.hipAngle.fail },
      deviation: dev,
      unit: "deg",
      confidence,
      scoreImpact: computeScoreImpact(
        dev,
        C.entryQuality.deductionPerDeg,
        weight,
        sev(hipStatus)
      ),
    });
  }

  const fwdStatus = classify(
    avgShoulderForward,
    C.entryQuality.shoulderForward.warn,
    C.entryQuality.shoulderForward.fail,
    false
  );
  if (fwdStatus !== "pass") {
    const dev = Math.abs(C.entryQuality.shoulderForward.ideal - avgShoulderForward);
    violations.push({
      ruleId: "swipes_entry_shoulder_back",
      severity: sev(fwdStatus),
      status: fwdStatus,
      bodyPart: "肩",
      message: `進入時に肩が手より前に出ていません（前進量: ${(avgShoulderForward * 100).toFixed(0)}%）`,
      actual: avgShoulderForward,
      ideal: C.entryQuality.shoulderForward.ideal,
      threshold: {
        warn: C.entryQuality.shoulderForward.warn,
        fail: C.entryQuality.shoulderForward.fail,
      },
      deviation: dev,
      unit: "ratio",
      confidence,
      scoreImpact: computeScoreImpact(
        dev,
        C.entryQuality.forwardMultiplier,
        weight,
        sev(fwdStatus)
      ),
    });
  }

  const hipScore = Math.max(
    0,
    100 -
      Math.abs(C.entryQuality.hipAngle.ideal - avgHipAngle) * C.entryQuality.deductionPerDeg
  );
  const fwdScore = Math.max(
    0,
    100 -
      Math.abs(C.entryQuality.shoulderForward.ideal - avgShoulderForward) *
        C.entryQuality.forwardMultiplier
  );
  const score = Math.round((hipScore + fwdScore) / 2);

  return {
    category: "entry_quality",
    label: "進入フォーム",
    score,
    weight: 0,
    violations,
    measurements: {
      avgHipAngle: round(avgHipAngle, 1),
      avgShoulderForward: round(avgShoulderForward, 3),
    },
  };
}

function evaluateKickPower(
  cycle: DetectedCycle | null,
  legSwings: TechniqueEvent[],
  kickPeaks: TechniqueEvent[],
  confidence: number,
  weight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  // Limit to events within selected cycle if available
  const targetSwings = cycle
    ? legSwings.filter(
        (e) => e.frameIndex >= cycle.startFrameIdx && e.frameIndex <= cycle.endFrameIdx
      )
    : legSwings;
  const targetPeaks = cycle
    ? kickPeaks.filter(
        (e) => e.frameIndex >= cycle.startFrameIdx && e.frameIndex <= cycle.endFrameIdx
      )
    : kickPeaks;

  if (targetSwings.length === 0 && targetPeaks.length === 0) {
    violations.push({
      ruleId: "swipes_no_kick",
      severity: "major",
      status: "fail",
      bodyPart: "脚",
      message: "明確な脚の振り上げが検出されませんでした",
      actual: 0,
      ideal: 1,
      threshold: { warn: 1, fail: 1 },
      deviation: 1,
      unit: "count",
      confidence,
      scoreImpact: 25 * weight,
    });
    return {
      category: "kick_power",
      label: "蹴りの強さ",
      score: 30,
      weight: 0,
      violations,
    };
  }

  // Use kick peaks if available (more reliable), else fall back to leg swings
  const speedSource = targetPeaks.length > 0 ? targetPeaks : targetSwings;
  const speeds = speedSource.map((e) => (e.details.speed as number) ?? 0);
  const peakSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  const avgSpeed = speeds.length > 0 ? avg(speeds) : 0;

  // Symmetry: compare left vs right peak speeds
  const leftSpeeds = speedSource
    .filter((e) => e.details.side === "left")
    .map((e) => (e.details.speed as number) ?? 0);
  const rightSpeeds = speedSource
    .filter((e) => e.details.side === "right")
    .map((e) => (e.details.speed as number) ?? 0);
  const leftMax = leftSpeeds.length > 0 ? Math.max(...leftSpeeds) : 0;
  const rightMax = rightSpeeds.length > 0 ? Math.max(...rightSpeeds) : 0;
  const meanMax = (leftMax + rightMax) / 2;
  const asymmetry = meanMax > 0 ? Math.abs(leftMax - rightMax) / meanMax : 0;

  // Power violation
  if (peakSpeed < C.legSwing.speedGood) {
    const status: RuleStatus = peakSpeed < C.legSwing.speedMin ? "fail" : "warn";
    violations.push({
      ruleId: "swipes_weak_kick",
      severity: sev(status),
      status,
      bodyPart: "脚",
      message: `蹴りの速度が不十分です（ピーク: ${peakSpeed.toFixed(1)}、推奨: ${C.legSwing.speedGood}以上）`,
      actual: peakSpeed,
      ideal: C.legSwing.speedIdeal,
      threshold: { warn: C.legSwing.speedGood, fail: C.legSwing.speedMin },
      deviation: Math.max(0, C.legSwing.speedIdeal - peakSpeed),
      unit: "speed",
      confidence,
      scoreImpact: computeScoreImpact(
        Math.max(0, C.legSwing.speedIdeal - peakSpeed),
        C.kickPower.deductionPerSpeedUnit,
        weight,
        sev(status)
      ),
    });
  }

  // Symmetry violation
  if (leftSpeeds.length > 0 && rightSpeeds.length > 0) {
    const symStatus = classify(
      asymmetry,
      C.legSwing.symmetry.warn,
      C.legSwing.symmetry.fail
    );
    if (symStatus !== "pass") {
      violations.push({
        ruleId: "swipes_kick_asymmetric",
        severity: sev(symStatus),
        status: symStatus,
        bodyPart: "脚",
        message: `左右の蹴りの強さに偏りがあります（差: ${(asymmetry * 100).toFixed(0)}%）`,
        actual: asymmetry,
        ideal: 0,
        threshold: { warn: C.legSwing.symmetry.warn, fail: C.legSwing.symmetry.fail },
        deviation: asymmetry,
        unit: "ratio",
        confidence,
        scoreImpact: computeScoreImpact(
          asymmetry,
          C.kickPower.asymmetryMultiplier,
          weight,
          sev(symStatus)
        ),
      });
    }
  }

  const speedScore = Math.min(100, (peakSpeed / C.legSwing.speedIdeal) * 100);
  const symPenalty = asymmetry * C.kickPower.asymmetryMultiplier;
  const score = Math.max(0, Math.round(speedScore - symPenalty));

  return {
    category: "kick_power",
    label: "蹴りの強さ",
    score,
    weight: 0,
    violations,
    measurements: {
      peakSpeed: round(peakSpeed, 2),
      avgSpeed: round(avgSpeed, 2),
      asymmetry: round(asymmetry, 2),
      kickCount: speedSource.length,
    },
  };
}

function evaluateRotationQuality(
  evalAngles: { spineAngle: number }[],
  evalCog: { x: number; y: number }[],
  cycle: DetectedCycle | null,
  phaseChanges: TechniqueEvent[],
  confidence: number,
  weight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  // Limit phase changes to selected cycle
  const targetPhases = cycle
    ? phaseChanges.filter(
        (e) => e.frameIndex >= cycle.startFrameIdx && e.frameIndex <= cycle.endFrameIdx
      )
    : phaseChanges;

  if (evalAngles.length === 0) {
    return {
      category: "rotation_quality",
      label: "回旋の質",
      score: 0,
      weight: 0,
      violations: [
        {
          ruleId: "swipes_no_rotation_data",
          severity: "major",
          status: "fail",
          bodyPart: "全体",
          message: "回旋を評価するデータがありません",
          actual: 0,
          ideal: 1,
          threshold: { warn: 1, fail: 1 },
          deviation: 1,
          unit: "count",
          confidence,
          scoreImpact: 30 * weight,
        },
      ],
    };
  }

  const horizontality = avg(evalAngles.map((a) => Math.abs(a.spineAngle - 90)));
  const cogXs = evalCog.map((c) => c.x);
  const cogRange = cogXs.length > 0 ? Math.max(...cogXs) - Math.min(...cogXs) : 0;

  const horizStatus = classify(
    horizontality,
    C.rotationQuality.horizontality.warn,
    C.rotationQuality.horizontality.fail
  );
  if (horizStatus !== "pass") {
    violations.push({
      ruleId: "swipes_rotation_not_horizontal",
      severity: sev(horizStatus),
      status: horizStatus,
      bodyPart: "体幹",
      message: `回転中の体幹が水平から${horizontality.toFixed(1)}°ずれています`,
      actual: horizontality,
      ideal: 0,
      threshold: {
        warn: C.rotationQuality.horizontality.warn,
        fail: C.rotationQuality.horizontality.fail,
      },
      deviation: horizontality,
      unit: "deg",
      confidence,
      scoreImpact: computeScoreImpact(
        horizontality,
        C.rotationQuality.deductionPerDeg,
        weight,
        sev(horizStatus)
      ),
    });
  }

  const cogStatus = classify(
    cogRange,
    C.rotationQuality.cogRange.warn,
    C.rotationQuality.cogRange.fail,
    false
  );
  if (cogStatus !== "pass") {
    const dev = Math.max(0, C.rotationQuality.cogRange.ideal - cogRange);
    violations.push({
      ruleId: "swipes_small_cog_range",
      severity: sev(cogStatus),
      status: cogStatus,
      bodyPart: "重心",
      message: `重心の回旋幅が小さいです（${cogRange.toFixed(2)}、理想: ${C.rotationQuality.cogRange.ideal}以上）`,
      actual: cogRange,
      ideal: C.rotationQuality.cogRange.ideal,
      threshold: { warn: C.rotationQuality.cogRange.warn, fail: C.rotationQuality.cogRange.fail },
      deviation: dev,
      unit: "ratio",
      confidence,
      scoreImpact: computeScoreImpact(
        dev,
        C.rotationQuality.cogMultiplier,
        weight,
        sev(cogStatus)
      ),
    });
  }

  if (targetPhases.length < C.rotationQuality.minPhaseChanges) {
    violations.push({
      ruleId: "swipes_few_phase_changes",
      severity: "major",
      status: "warn",
      bodyPart: "全体",
      message: `フェーズ遷移が少ないです（${targetPhases.length}回、理想: ${C.rotationQuality.minPhaseChanges}回以上）`,
      actual: targetPhases.length,
      ideal: C.rotationQuality.minPhaseChanges,
      threshold: { warn: C.rotationQuality.minPhaseChanges, fail: 0 },
      deviation: C.rotationQuality.minPhaseChanges - targetPhases.length,
      unit: "count",
      confidence,
      scoreImpact: 10 * weight,
    });
  }

  const horizScore = Math.max(0, 100 - horizontality * C.rotationQuality.deductionPerDeg);
  const cogScore = Math.min(
    100,
    Math.max(0, (cogRange / C.rotationQuality.cogRange.ideal) * 100)
  );
  const phaseBonus = targetPhases.length >= C.rotationQuality.minPhaseChanges ? 0 : -10;
  const score = Math.round(Math.max(0, (horizScore + cogScore) / 2 + phaseBonus));

  return {
    category: "rotation_quality",
    label: "回旋の質",
    score,
    weight: 0,
    violations,
    measurements: {
      horizontality: round(horizontality, 1),
      cogRange: round(cogRange, 3),
      phaseChangeCount: targetPhases.length,
    },
  };
}

function evaluateRepConsistency(
  cycles: DetectedCycle[],
  confidence: number,
  weight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];
  const durations = cycles.map((c) => c.duration);
  const speeds = cycles.map((c) => c.kickPeakSpeed);

  // Cycle duration variation
  const dMean = avg(durations);
  const dMaxDev = Math.max(...durations.map((d) => Math.abs(d - dMean)));
  const durationDev = dMean > 0 ? dMaxDev / dMean : 0;

  const dStatus = classify(
    durationDev,
    C.repConsistency.timingDeviation.warn,
    C.repConsistency.timingDeviation.fail
  );
  if (dStatus !== "pass") {
    violations.push({
      ruleId: "swipes_rep_timing",
      severity: sev(dStatus),
      status: dStatus,
      bodyPart: "全体",
      message: `サイクル時間にバラツキがあります（最大偏差: ${(durationDev * 100).toFixed(0)}%）`,
      actual: durationDev,
      ideal: 0,
      threshold: {
        warn: C.repConsistency.timingDeviation.warn,
        fail: C.repConsistency.timingDeviation.fail,
      },
      deviation: durationDev,
      unit: "ratio",
      confidence,
      scoreImpact: 15 * weight,
    });
  }

  // Speed variation
  const sMean = avg(speeds);
  const sMaxDev = sMean > 0 ? Math.max(...speeds.map((s) => Math.abs(s - sMean))) : 0;
  const speedDev = sMean > 0 ? sMaxDev / sMean : 0;

  const sStatus = classify(
    speedDev,
    C.repConsistency.speedDeviation.warn,
    C.repConsistency.speedDeviation.fail
  );
  if (sStatus !== "pass" && sMean > 0) {
    violations.push({
      ruleId: "swipes_rep_speed",
      severity: sev(sStatus),
      status: sStatus,
      bodyPart: "脚",
      message: `蹴り速度のバラツキが大きいです（${(speedDev * 100).toFixed(0)}%）`,
      actual: speedDev,
      ideal: 0,
      threshold: {
        warn: C.repConsistency.speedDeviation.warn,
        fail: C.repConsistency.speedDeviation.fail,
      },
      deviation: speedDev,
      unit: "ratio",
      confidence,
      scoreImpact: 10 * weight,
    });
  }

  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "critical" ? 30 : v.severity === "major" ? 20 : 10),
    0
  );
  const score = Math.max(0, 90 - penalty);

  return {
    category: "rep_consistency",
    label: "反復一貫性",
    score,
    weight: 0,
    violations,
    measurements: {
      cycleCount: cycles.length,
      durationDev: round(durationDev, 2),
      speedDev: round(speedDev, 2),
    },
  };
}

// ============================================================
// Quality impact summary
// ============================================================
function buildQualityImpactSummary(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  cycle: DetectedCycle | null,
  cycles: DetectedCycle[]
): QualityImpactSummary {
  const impacts: QualityImpact[] = [];
  let reliability = 1.0;

  // Wrist visibility
  const wristVis = avg(
    series.frames.flatMap((f) => [
      f.landmarks[LM.LEFT_WRIST].visibility,
      f.landmarks[LM.RIGHT_WRIST].visibility,
    ])
  );
  if (wristVis < C.quality.wristVisibilityWarn) {
    const isFail = wristVis < C.quality.wristVisibilityFail;
    const penalty = isFail ? 0.3 : 0.15;
    impacts.push({
      category: "visibility",
      description: `手首の可視性が${(wristVis * 100).toFixed(0)}%と${isFail ? "非常に" : ""}低いため、サポート安定性の評価精度が下がります`,
      reliabilityPenalty: penalty,
      affectedCategories: ["support_stability", "entry_quality"],
    });
    reliability -= penalty;
  }

  // Ankle visibility
  const ankleVis = avg(
    series.frames.flatMap((f) => [
      f.landmarks[LM.LEFT_ANKLE].visibility,
      f.landmarks[LM.RIGHT_ANKLE].visibility,
    ])
  );
  if (ankleVis < C.quality.ankleVisibilityWarn) {
    const isFail = ankleVis < C.quality.ankleVisibilityFail;
    const penalty = isFail ? 0.3 : 0.15;
    impacts.push({
      category: "visibility",
      description: `足首の可視性が${(ankleVis * 100).toFixed(0)}%と${isFail ? "非常に" : ""}低いため、蹴りの強さの評価精度が下がります`,
      reliabilityPenalty: penalty,
      affectedCategories: ["kick_power"],
    });
    reliability -= penalty;
  }

  // Motion blur proxy
  let motionSum = 0;
  let motionCount = 0;
  for (let i = 1; i < series.frames.length; i++) {
    const f = series.frames[i].landmarks;
    const p = series.frames[i - 1].landmarks;
    let frameMove = 0;
    let n = 0;
    for (const idx of [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
      const dx = f[idx].x - p[idx].x;
      const dy = f[idx].y - p[idx].y;
      frameMove += Math.sqrt(dx * dx + dy * dy);
      n++;
    }
    motionSum += frameMove / n;
    motionCount++;
  }
  const avgMotion = motionCount > 0 ? motionSum / motionCount : 0;
  if (avgMotion > C.quality.motionBlurThreshold) {
    impacts.push({
      category: "motion_blur",
      description: `フレーム間の動きが大きく（平均${avgMotion.toFixed(2)}単位/フレーム）、モーションブラーで関節検出が不安定になっている可能性があります`,
      reliabilityPenalty: 0.1,
      affectedCategories: ["kick_power", "rotation_quality"],
    });
    reliability -= 0.1;
  }

  // Out-of-frame ratio
  let oofCount = 0;
  for (const f of series.frames) {
    const lm = f.landmarks;
    for (const idx of [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
      if (Math.abs(lm[idx].x) > 2 || Math.abs(lm[idx].y) > 2) {
        oofCount++;
        break;
      }
    }
  }
  const oofRatio = series.frames.length > 0 ? oofCount / series.frames.length : 0;
  if (oofRatio > C.quality.outOfFrameWarn) {
    const isFail = oofRatio > C.quality.outOfFrameFail;
    const penalty = isFail ? 0.2 : 0.1;
    impacts.push({
      category: "out_of_frame",
      description: `${(oofRatio * 100).toFixed(0)}%のフレームで主要関節が画角外に出ています`,
      reliabilityPenalty: penalty,
      affectedCategories: ["entry_quality", "rotation_quality"],
    });
    reliability -= penalty;
  }

  // Low cycle clarity
  if (cycle && cycle.cycleClarity < 0.5) {
    impacts.push({
      category: "low_cycle_clarity",
      description: `選定サイクルの明瞭度が低い（${(cycle.cycleClarity * 100).toFixed(0)}%）ため、評価の信頼性が下がります`,
      reliabilityPenalty: 0.15,
      affectedCategories: ["rotation_quality", "rep_consistency"],
    });
    reliability -= 0.15;
  }

  void cycles;

  return {
    reliability: Math.max(0, Math.round(reliability * 100) / 100),
    impacts,
  };
}

// ============================================================
// Helpers
// ============================================================
function round(n: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
