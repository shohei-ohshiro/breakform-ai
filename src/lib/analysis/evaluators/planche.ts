import {
  NormalizedTimeSeries,
  NormalizedFrame,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  TechniqueEvent,
  StaticInterval,
  SamplingInfo,
  LM,
} from "../types";
import { PLANCHE_CONFIG as C } from "../config";
import { STABILITY_THRESHOLDS } from "../config";
import { classify, sev, avg, scoreFromDeviation, computeScoreImpact, rankViolations, buildCoverageInfo } from "./utils";

const CONFIG_VERSION = "2.3";

type EvalMode = "hold" | "entry";

// ---- Entry-mode display labels ----
const ENTRY_LABELS: Record<string, string> = {
  hip_sag: "下半身の追従",
  // Others keep the same label for both modes
};

// ---- Entry-mode breakdown labels (category → label) ----
function getLabel(category: string, mode: EvalMode): string {
  const defaults: Record<string, string> = {
    shoulder_lean: "肩の前傾",
    body_line: "体幹ライン",
    hip_sag: "骨盤の落ち",
    elbow_lockout: "肘の伸展",
    stability: "安定性",
    entry_quality: "進入フォーム",
  };
  if (mode === "entry" && category in ENTRY_LABELS) {
    return ENTRY_LABELS[category];
  }
  return defaults[category] ?? category;
}

interface ModeClassification {
  mode: EvalMode;
  /** Frames to evaluate (best static interval for hold, best-pose frames for entry) */
  evalFrames: NormalizedFrame[];
  evalStartIdx: number;
  evalEndIdx: number;
  interval: StaticInterval | null;
  holdDuration: number;
  holdRatio: number;
  confidenceNote: string;
  /** Debug: entry frame selection details */
  entryFrameDetails?: EntryFrameSelection["details"];
}

/**
 * Classify whether this video is a hold or an entry attempt.
 */
function classifyMode(
  series: NormalizedTimeSeries,
  features: FeatureSet
): ModeClassification {
  const totalDuration = series.duration || 0;

  // Find longest static interval
  const interval = features.staticIntervals.length > 0
    ? features.staticIntervals.reduce((best, cur) =>
        cur.endTime - cur.startTime > best.endTime - best.startTime ? cur : best)
    : null;

  const holdDuration = interval
    ? interval.endTime - interval.startTime
    : 0;
  const holdRatio = totalDuration > 0 ? holdDuration / totalDuration : 0;

  // Single image → always hold mode
  if (series.sourceType === "image" || series.frames.length <= 1) {
    return {
      mode: "hold",
      evalFrames: series.frames,
      evalStartIdx: 0,
      evalEndIdx: series.frames.length - 1,
      interval: interval,
      holdDuration: 0,
      holdRatio: 1,
      confidenceNote: "静止画からの評価",
    };
  }

  // Video: check if static interval is long enough
  if (interval && holdDuration >= C.holdDetection.minHoldDuration) {
    const startIdx = interval.startIndex;
    const endIdx = interval.endIndex;
    let note = "";
    if (holdDuration < C.holdDetection.shortHoldWarning) {
      note = `静止保持が短め（${holdDuration.toFixed(1)}秒）。2秒以上の保持で精度が上がります。`;
    }
    return {
      mode: "hold",
      evalFrames: series.frames.slice(startIdx, endIdx + 1),
      evalStartIdx: startIdx,
      evalEndIdx: endIdx,
      interval,
      holdDuration,
      holdRatio,
      confidenceNote: note,
    };
  }

  // No sufficient static interval → entry mode
  // Find the "best frame" = frame where body is most horizontal (spine angle closest to 90°)
  const entrySelection = findBestEntryFrames(series, features);
  const bestFrames = entrySelection.frames;
  const startIdx = bestFrames.length > 0 ? series.frames.indexOf(bestFrames[0]) : 0;
  const endIdx = bestFrames.length > 0 ? series.frames.indexOf(bestFrames[bestFrames.length - 1]) : series.frames.length - 1;

  return {
    mode: "entry",
    evalFrames: bestFrames.length > 0 ? bestFrames : series.frames.slice(0, Math.min(3, series.frames.length)),
    evalStartIdx: Math.max(0, startIdx),
    evalEndIdx: Math.max(0, endIdx),
    interval,
    holdDuration,
    holdRatio,
    confidenceNote: holdDuration > 0
      ? `静止保持が${holdDuration.toFixed(1)}秒（基準: ${C.holdDetection.minHoldDuration}秒以上）のため進入フォーム評価として採点。`
      : "静止保持が検出されなかったため、進入フォーム評価として採点。最も水平に近いフレームを使用。",
    entryFrameDetails: entrySelection.details,
  };
}

interface EntryFrameSelection {
  frames: NormalizedFrame[];
  details: {
    frameIndices: number[];
    spineAngles: number[];
    selectionReason: string;
  };
}

/** Key landmarks that must be visible for a reliable planche evaluation */
const PLANCHE_KEY_LANDMARKS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

/**
 * Compute a skeleton quality score (0-1) for a normalized frame.
 * Factors in visibility of key landmarks for planche evaluation.
 */
function frameSkeletonQuality(frame: NormalizedFrame): number {
  let totalVis = 0;
  let count = 0;
  for (const idx of PLANCHE_KEY_LANDMARKS) {
    if (idx < frame.landmarks.length) {
      totalVis += frame.landmarks[idx].visibility;
      count++;
    }
  }
  return count > 0 ? totalVis / count : 0;
}

/**
 * For entry mode: find frames where the body is closest to horizontal (planche position).
 * Factors in spine angle closeness to 90°, skeleton visibility, and
 * shoulder-hip-ankle alignment to avoid selecting frames with missing bones.
 *
 * Returns top N frames sorted by timestamp, plus selection details for debug.
 */
function findBestEntryFrames(
  series: NormalizedTimeSeries,
  features: FeatureSet
): EntryFrameSelection {
  if (series.frames.length === 0) {
    return { frames: [], details: { frameIndices: [], spineAngles: [], selectionReason: "フレームなし" } };
  }

  // Score each frame: lower = better candidate
  // Composite score = horizontalDev * (1 + visibilityPenalty)
  const scored = features.angles.map((a, i) => {
    const frame = series.frames[i];
    const horizontalDev = Math.abs(a.spineAngle - 90);
    const skelQuality = frameSkeletonQuality(frame);

    // Penalty for low visibility (0 = perfect, up to 2x penalty for very poor)
    const visPenalty = skelQuality >= 0.7 ? 0 : (0.7 - skelQuality) * 3;

    // Bonus: how well aligned are shoulder-hip-ankle in Y (body straightness)
    const lm = frame.landmarks;
    const sY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const hY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
    const aY = (lm[LM.LEFT_ANKLE].y + lm[LM.RIGHT_ANKLE].y) / 2;
    const ySpread = Math.max(sY, hY, aY) - Math.min(sY, hY, aY);
    // ySpread near 0 = very horizontal, add a small penalty for spread
    const spreadPenalty = ySpread * 10;

    return {
      index: i,
      spineAngle: a.spineAngle,
      horizontalDev,
      skelQuality,
      compositeScore: horizontalDev * (1 + visPenalty) + spreadPenalty,
    };
  });

  // Sort by composite score (lower is better)
  scored.sort((a, b) => a.compositeScore - b.compositeScore);

  // Take up to 5 best frames, but reject any with very poor skeleton quality
  const MIN_SKEL_QUALITY = 0.3;
  const candidates = scored.filter(s => s.skelQuality >= MIN_SKEL_QUALITY);
  const best = (candidates.length > 0 ? candidates : scored).slice(0, Math.min(5, scored.length));
  const bestIndices = best.map(s => s.index);
  bestIndices.sort((a, b) => a - b); // restore time order

  const sortedBest = bestIndices.map(idx => best.find(b => b.index === idx)!);
  const topCandidate = scored[0];

  return {
    frames: bestIndices.map(i => series.frames[i]),
    details: {
      frameIndices: bestIndices,
      spineAngles: sortedBest.map(b => Math.round(b.spineAngle * 10) / 10),
      selectionReason: `体幹角度+骨格品質の複合スコアで${bestIndices.length}フレームを選択（最小偏差: ${topCandidate.horizontalDev.toFixed(1)}°, 骨格品質: ${(topCandidate.skelQuality * 100).toFixed(0)}%）`,
    },
  };
}

export function evaluatePlanche(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo
): EvaluationResult {
  const violations: RuleViolation[] = [];
  const events: TechniqueEvent[] = [];
  const suggestions: string[] = [];

  if (series.frames.length === 0) {
    return {
      technique: "planche", finalScore: 0, breakdown: [],
      violations: [{ ruleId: "no_frames", severity: "critical", status: "fail",
        bodyPart: "全体", message: "分析可能なフレームがありません",
        actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 }, deviation: 1, unit: "frames", confidence: 0 }],
      events: [], suggestionsRaw: ["プランシェの姿勢がはっきり映る動画を再度アップロードしてください"],
      meta: { analyzedFrameRange: [0, 0], staticIntervalUsed: null, totalFrames: 0, configVersion: CONFIG_VERSION },
    };
  }

  // Classify hold vs entry
  const mode = classifyMode(series, features);
  const staticFrames = mode.evalFrames;
  const startIdx = mode.evalStartIdx;
  const endIdx = mode.evalEndIdx;
  const frameRange: [number, number] = [startIdx, endIdx];

  const staticAngles = features.angles.slice(startIdx, endIdx + 1);
  const staticCoG = features.cog.slice(startIdx, endIdx + 1);

  // Confidence based on frame count and mode
  const baseConfidence = Math.min(1, staticFrames.length / 5);
  const confidence = mode.mode === "entry"
    ? baseConfidence * C.holdDetection.entryConfidenceMultiplier
    : baseConfidence;

  // Determine weights based on mode
  const hasStability = mode.mode === "hold" && staticFrames.length >= 3;
  const weights = mode.mode === "entry"
    ? C.weights.entryMode
    : hasStability
      ? C.weights.videoMode
      : C.weights.imageMode;

  // ---- 1. Shoulder Lean ----
  const shoulderWeight = weights[0];
  let avgLean = 0;
  let avgLeanAngle = 0;
  for (const frame of staticFrames) {
    const lm = frame.landmarks;
    const sMidX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
    const wMidX = (lm[LM.LEFT_WRIST].x + lm[LM.RIGHT_WRIST].x) / 2;
    avgLean += Math.abs(sMidX - wMidX);
    const sMidY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const wMidY = (lm[LM.LEFT_WRIST].y + lm[LM.RIGHT_WRIST].y) / 2;
    avgLeanAngle += Math.abs(Math.atan2(sMidY - wMidY, sMidX - wMidX) * (180 / Math.PI));
  }
  avgLean /= staticFrames.length;
  avgLeanAngle /= staticFrames.length;

  const leanDistStatus = classify(avgLean, C.shoulderLean.leanDistance.warn, C.shoulderLean.leanDistance.fail, false);
  if (leanDistStatus !== "pass") {
    violations.push({
      ruleId: "planche_shoulder_lean_insufficient", severity: sev(leanDistStatus), status: leanDistStatus,
      bodyPart: "肩", message: `肩の前傾が不足（前傾量: ${(avgLean * 100).toFixed(0)}%）`,
      actual: avgLean, ideal: C.shoulderLean.leanDistance.ideal,
      threshold: { warn: C.shoulderLean.leanDistance.warn, fail: C.shoulderLean.leanDistance.fail },
      deviation: Math.abs(C.shoulderLean.leanDistance.ideal - avgLean), unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(Math.abs(C.shoulderLean.leanAngle.ideal - avgLeanAngle), C.shoulderLean.deductionPerDeg, shoulderWeight, sev(leanDistStatus)),
    });
    suggestions.push("肩を手首より前方に出すことがプランシェの鍵です。プランシェリーンで感覚を養いましょう。");
  }

  const angleDev = Math.abs(avgLeanAngle - C.shoulderLean.leanAngle.ideal);
  const shoulderScore = scoreFromDeviation(angleDev, C.shoulderLean.deductionPerDeg);
  const shoulderBreakdown: ScoreBreakdown = {
    category: "shoulder_lean", label: "肩の前傾", score: shoulderScore, weight: 0,
    violations: violations.filter(v => v.ruleId.includes("shoulder_lean")),
    measurements: { avgLean, avgLeanAngle, angleDev }, frameRange,
  };

  // ---- 2. Body Line ----
  const bodyLineWeight = weights[1];
  const avgSpine = avg(staticAngles.map(a => a.spineAngle));
  const actualSpineDev = Math.abs(avgSpine - 90);

  let avgYRange = 0;
  for (const frame of staticFrames) {
    const lm = frame.landmarks;
    const sY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const hY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
    const aY = (lm[LM.LEFT_ANKLE].y + lm[LM.RIGHT_ANKLE].y) / 2;
    avgYRange += Math.max(sY, hY, aY) - Math.min(sY, hY, aY);
  }
  avgYRange /= staticFrames.length;

  const spineStatus = classify(actualSpineDev, C.bodyLine.spineDeviation.warn, C.bodyLine.spineDeviation.fail);
  if (spineStatus !== "pass") {
    const spineMsg = mode.mode === "entry"
      ? `進入時の体幹が水平から${actualSpineDev.toFixed(1)}°傾いている`
      : `体幹ラインが水平から${actualSpineDev.toFixed(1)}°ずれている`;
    violations.push({
      ruleId: "planche_body_line", severity: sev(spineStatus), status: spineStatus,
      bodyPart: "体幹", message: spineMsg,
      actual: avgSpine, ideal: 90,
      threshold: { warn: C.bodyLine.spineDeviation.warn, fail: C.bodyLine.spineDeviation.fail },
      deviation: actualSpineDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(actualSpineDev, C.bodyLine.spineDeductionPerDeg, bodyLineWeight, sev(spineStatus)),
    });
    suggestions.push(mode.mode === "entry"
      ? "進入時にもう少し体を前に倒して水平に近づけましょう。タックプランシェでの前傾練習が効果的です。"
      : "肩から足首まで一直線を保つことが重要です。ホローボディホールドで体幹を鍛えましょう。");
  }

  const yStatus = classify(avgYRange, C.bodyLine.yRangeDeviation.warn, C.bodyLine.yRangeDeviation.fail);
  if (yStatus !== "pass") {
    const yMsg = mode.mode === "entry"
      ? "進入中の全身ラインがまだ揃っていない"
      : "肩・骨盤・足首のラインが崩れている";
    violations.push({
      ruleId: "planche_body_not_straight", severity: sev(yStatus), status: yStatus,
      bodyPart: "全身", message: yMsg,
      actual: avgYRange, ideal: 0,
      threshold: { warn: C.bodyLine.yRangeDeviation.warn, fail: C.bodyLine.yRangeDeviation.fail },
      deviation: avgYRange, unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgYRange, C.bodyLine.yRangeDeductionMultiplier, bodyLineWeight, sev(yStatus)),
    });
  }

  const bodyLineScore = Math.round(Math.max(0,
    100 - actualSpineDev * C.bodyLine.spineDeductionPerDeg - avgYRange * C.bodyLine.yRangeDeductionMultiplier));
  const bodyLineBreakdown: ScoreBreakdown = {
    category: "body_line", label: "体幹ライン", score: bodyLineScore, weight: 0,
    violations: violations.filter(v => v.ruleId.includes("body_line") || v.ruleId.includes("body_not")),
    measurements: { avgSpine, actualSpineDev, avgYRange }, frameRange,
  };

  // ---- 3. Hip Sag ----
  const hipWeight = weights[2];
  let avgSag = 0;
  for (const frame of staticFrames) {
    const lm = frame.landmarks;
    const sY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const hY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
    const aY = (lm[LM.LEFT_ANKLE].y + lm[LM.RIGHT_ANKLE].y) / 2;
    const expected = (sY + aY) / 2;
    const sag = expected - hY;
    if (sag > 0) avgSag += sag;
  }
  avgSag /= staticFrames.length;

  const sagStatus = classify(avgSag, C.hipSag.sag.warn, C.hipSag.sag.fail);
  if (sagStatus !== "pass") {
    const sagMsg = mode.mode === "entry"
      ? `骨盤の持ち上がりが不十分（${(avgSag * 100).toFixed(0)}%）`
      : `骨盤が${(avgSag * 100).toFixed(0)}%下がっている`;
    const sagBodyPart = mode.mode === "entry" ? "下半身" : "骨盤";
    violations.push({
      ruleId: "planche_hip_sag", severity: sev(sagStatus), status: sagStatus,
      bodyPart: sagBodyPart, message: sagMsg,
      actual: avgSag, ideal: 0,
      threshold: { warn: C.hipSag.sag.warn, fail: C.hipSag.sag.fail },
      deviation: avgSag, unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgSag, C.hipSag.deductionMultiplier, hipWeight, sev(sagStatus)),
    });
    suggestions.push(mode.mode === "entry"
      ? "進入中の骨盤持ち上げは途中段階です。タックプランシェからの骨盤コントロールを意識しましょう。"
      : "臀部を締め骨盤を後傾させましょう。プランクでの骨盤コントロール練習が有効です。");
  }

  const hipSagScore = scoreFromDeviation(avgSag, C.hipSag.deductionMultiplier);
  const hipSagBreakdown: ScoreBreakdown = {
    category: "hip_sag", label: getLabel("hip_sag", mode.mode), score: hipSagScore, weight: 0,
    violations: violations.filter(v => v.ruleId === "planche_hip_sag"),
    measurements: { avgSag }, frameRange,
  };

  // ---- 4. Elbow Lockout ----
  const elbowWeight = weights[3];
  const avgElbow = avg(staticAngles.map(a => (a.leftElbow + a.rightElbow) / 2));
  const elbowDev = Math.abs(180 - avgElbow);

  const elbowStatus = classify(elbowDev, Math.abs(180 - C.elbowLockout.angle.warn), Math.abs(180 - C.elbowLockout.angle.fail));
  if (elbowStatus !== "pass") {
    violations.push({
      ruleId: "planche_elbow_bend", severity: sev(elbowStatus), status: elbowStatus,
      bodyPart: "肘", message: `肘が${elbowDev.toFixed(1)}°曲がっている（理想: 170-180°）`,
      actual: avgElbow, ideal: 180,
      threshold: { warn: Math.abs(180 - C.elbowLockout.angle.warn), fail: Math.abs(180 - C.elbowLockout.angle.fail) },
      deviation: elbowDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(elbowDev, C.elbowLockout.deductionPerDeg, elbowWeight, sev(elbowStatus)),
    });
    suggestions.push("肘をしっかり伸ばしきりましょう。タックプランシェで肘ロックアウトの感覚を掴みましょう。");
  }

  const elbowScore = scoreFromDeviation(elbowDev, C.elbowLockout.deductionPerDeg);
  const elbowBreakdown: ScoreBreakdown = {
    category: "elbow_lockout", label: "肘の伸展", score: elbowScore, weight: 0,
    violations: violations.filter(v => v.ruleId === "planche_elbow_bend"),
    measurements: { avgElbow, elbowDev }, frameRange,
  };

  // ---- 5. Stability (hold mode only, 3+ frames) ----
  let stabilityBreakdown: ScoreBreakdown | null = null;
  if (hasStability) {
    const ST = STABILITY_THRESHOLDS;
    const stabilityWeight = weights[4] as number;
    const mx = avg(staticCoG.map(c => c.x));
    const my = avg(staticCoG.map(c => c.y));
    const totalVar = Math.sqrt(staticCoG.reduce((s, c) => s + (c.x - mx) ** 2 + (c.y - my) ** 2, 0) / staticCoG.length);

    const st = classify(totalVar, ST.cogVariance.warn, ST.cogVariance.fail);
    if (st !== "pass") {
      violations.push({
        ruleId: "planche_instability", severity: sev(st), status: st,
        bodyPart: "重心", message: `ホールド中のブレが大きい（分散: ${(totalVar * 100).toFixed(1)}）`,
        actual: totalVar, ideal: 0,
        threshold: { warn: ST.cogVariance.warn, fail: ST.cogVariance.fail },
        deviation: totalVar, unit: "ratio", confidence, context: { frameRange },
        scoreImpact: computeScoreImpact(totalVar, ST.scorePenaltyMultiplier, stabilityWeight, sev(st)),
      });
      suggestions.push("短時間(2-3秒)から安定キープを目指し、徐々にホールド時間を延ばしましょう。");
    }
    const stabScore = scoreFromDeviation(totalVar, ST.scorePenaltyMultiplier);
    stabilityBreakdown = {
      category: "stability", label: "安定性", score: stabScore, weight: 0,
      violations: violations.filter(v => v.ruleId === "planche_instability"),
      measurements: { totalVariance: totalVar }, frameRange,
    };
  }

  // ---- 6. Entry Quality (entry mode only) ----
  let entryBreakdown: ScoreBreakdown | null = null;
  if (mode.mode === "entry") {
    const entryWeight = weights[4] as number;

    // Measure how close the best frame got to horizontal
    const bestSpineDev = Math.min(...features.angles.map(a => Math.abs(a.spineAngle - 90)));
    // Measure progression: did body line improve over time?
    const progression = computeEntryProgression(features);

    // Entry quality score: based on how close they got + whether they're progressing
    const approachScore = Math.round(Math.max(0, 100 - bestSpineDev * 1.2));
    const progressionBonus = Math.round(progression * 20); // up to +20 for good progression
    const entryScore = Math.min(100, approachScore + progressionBonus);

    if (bestSpineDev > C.bodyLine.spineDeviation.warn) {
      violations.push({
        ruleId: "planche_entry_incomplete", severity: "major", status: "warn",
        bodyPart: "進入到達度",
        message: `最も水平に近い瞬間でも${bestSpineDev.toFixed(1)}°傾いている`,
        actual: bestSpineDev, ideal: 0,
        threshold: { warn: C.bodyLine.spineDeviation.warn, fail: C.bodyLine.spineDeviation.fail },
        deviation: bestSpineDev, unit: "deg", confidence,
        context: { frameRange },
        scoreImpact: computeScoreImpact(bestSpineDev, 0.8, entryWeight, "major"),
      });
    }

    entryBreakdown = {
      category: "entry_quality", label: getLabel("entry_quality", mode.mode), score: entryScore, weight: 0,
      violations: violations.filter(v => v.ruleId === "planche_entry_incomplete"),
      measurements: { bestSpineDev, progression, approachScore, progressionBonus },
      frameRange,
    };

    suggestions.push(
      "進入動作としての評価です。完成形を2秒以上保持する動画を撮影すると、より正確な保持評価が得られます。"
    );
  }

  // ---- Build breakdown ----
  const breakdown: ScoreBreakdown[] = [
    { ...shoulderBreakdown, weight: weights[0] },
    { ...bodyLineBreakdown, weight: weights[1] },
    { ...hipSagBreakdown, weight: weights[2] },
    { ...elbowBreakdown, weight: weights[3] },
  ];
  if (stabilityBreakdown) breakdown.push({ ...stabilityBreakdown, weight: weights[4] as number });
  if (entryBreakdown) breakdown.push({ ...entryBreakdown, weight: weights[4] as number });

  const finalScore = Math.round(breakdown.reduce((sum, b) => sum + b.score * b.weight, 0));

  // Build scoring reason for coverageInfo
  const scoringReason = mode.mode === "hold"
    ? "静止保持区間（最長の安定区間）"
    : "体幹角度+骨格品質の複合スコアで選定した代表フレーム";

  const coverageInfo = buildCoverageInfo(series, startIdx, endIdx, scoringReason, sampling);

  return {
    technique: "planche", finalScore, breakdown,
    violations: rankViolations(violations),
    events, suggestionsRaw: suggestions,
    meta: {
      analyzedFrameRange: frameRange,
      staticIntervalUsed: mode.interval ?? null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
      evaluationMode: mode.mode,
      holdDuration: mode.holdDuration,
      holdRatio: mode.holdRatio,
      confidenceNote: mode.confidenceNote,
      ...(mode.entryFrameDetails ? { entryFrameDetails: mode.entryFrameDetails } : {}),
      coverageInfo,
    },
  };
}

/**
 * Compute a 0-1 progression score: how much did the body line improve
 * from the first half to the second half of the video?
 * 1.0 = significant improvement, 0 = no improvement or worsening.
 */
function computeEntryProgression(features: FeatureSet): number {
  const angles = features.angles;
  if (angles.length < 4) return 0;

  const mid = Math.floor(angles.length / 2);
  const firstHalf = angles.slice(0, mid);
  const secondHalf = angles.slice(mid);

  const avgFirst = avg(firstHalf.map(a => Math.abs(a.spineAngle - 90)));
  const avgSecond = avg(secondHalf.map(a => Math.abs(a.spineAngle - 90)));

  // Improvement: first half had worse (higher) deviation than second half
  const improvement = avgFirst - avgSecond;
  // Normalize: 30° improvement → 1.0
  return Math.max(0, Math.min(1, improvement / 30));
}
