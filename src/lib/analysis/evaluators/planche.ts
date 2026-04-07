import {
  NormalizedTimeSeries,
  NormalizedFrame,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  TechniqueEvent,
  StaticInterval,
  LM,
} from "../types";
import { PLANCHE_CONFIG as C } from "../config";
import { STABILITY_THRESHOLDS } from "../config";
import { classify, sev, avg, scoreFromDeviation, computeScoreImpact, rankViolations } from "./utils";

const CONFIG_VERSION = "2.1";

type EvalMode = "hold" | "entry";

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
  const bestFrames = findBestEntryFrames(series, features);
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
  };
}

/**
 * For entry mode: find frames where the body is closest to horizontal (planche position).
 * Returns top N frames sorted by timestamp.
 */
function findBestEntryFrames(
  series: NormalizedTimeSeries,
  features: FeatureSet
): NormalizedFrame[] {
  if (series.frames.length === 0) return [];

  // Score each frame by how close spine angle is to 90° (horizontal)
  const scored = features.angles.map((a, i) => ({
    index: i,
    horizontalDev: Math.abs(a.spineAngle - 90),
  }));

  // Sort by closeness to horizontal
  scored.sort((a, b) => a.horizontalDev - b.horizontalDev);

  // Take up to 5 best frames
  const bestIndices = scored.slice(0, Math.min(5, scored.length)).map(s => s.index);
  bestIndices.sort((a, b) => a - b); // restore time order

  return bestIndices.map(i => series.frames[i]);
}

export function evaluatePlanche(
  series: NormalizedTimeSeries,
  features: FeatureSet
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
    violations.push({
      ruleId: "planche_body_line", severity: sev(spineStatus), status: spineStatus,
      bodyPart: "体幹", message: `体幹ラインが水平から${actualSpineDev.toFixed(1)}°ずれている`,
      actual: avgSpine, ideal: 90,
      threshold: { warn: C.bodyLine.spineDeviation.warn, fail: C.bodyLine.spineDeviation.fail },
      deviation: actualSpineDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(actualSpineDev, C.bodyLine.spineDeductionPerDeg, bodyLineWeight, sev(spineStatus)),
    });
    suggestions.push("肩から足首まで一直線を保つことが重要です。ホローボディホールドで体幹を鍛えましょう。");
  }

  const yStatus = classify(avgYRange, C.bodyLine.yRangeDeviation.warn, C.bodyLine.yRangeDeviation.fail);
  if (yStatus !== "pass") {
    violations.push({
      ruleId: "planche_body_not_straight", severity: sev(yStatus), status: yStatus,
      bodyPart: "全身", message: "肩・骨盤・足首のラインが崩れている",
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
    violations.push({
      ruleId: "planche_hip_sag", severity: sev(sagStatus), status: sagStatus,
      bodyPart: "骨盤", message: `骨盤が${(avgSag * 100).toFixed(0)}%下がっている`,
      actual: avgSag, ideal: 0,
      threshold: { warn: C.hipSag.sag.warn, fail: C.hipSag.sag.fail },
      deviation: avgSag, unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgSag, C.hipSag.deductionMultiplier, hipWeight, sev(sagStatus)),
    });
    suggestions.push("臀部を締め骨盤を後傾させましょう。プランクでの骨盤コントロール練習が有効です。");
  }

  const hipSagScore = scoreFromDeviation(avgSag, C.hipSag.deductionMultiplier);
  const hipSagBreakdown: ScoreBreakdown = {
    category: "hip_sag", label: "骨盤の落ち", score: hipSagScore, weight: 0,
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
        bodyPart: "全身",
        message: `最も水平に近い瞬間でも${bestSpineDev.toFixed(1)}°傾いている`,
        actual: bestSpineDev, ideal: 0,
        threshold: { warn: C.bodyLine.spineDeviation.warn, fail: C.bodyLine.spineDeviation.fail },
        deviation: bestSpineDev, unit: "deg", confidence,
        context: { frameRange },
        scoreImpact: computeScoreImpact(bestSpineDev, 0.8, entryWeight, "major"),
      });
    }

    entryBreakdown = {
      category: "entry_quality", label: "進入フォーム", score: entryScore, weight: 0,
      violations: violations.filter(v => v.ruleId === "planche_entry_incomplete"),
      measurements: { bestSpineDev, progression, approachScore, progressionBonus },
      frameRange,
    };

    suggestions.push(
      "進入動作の動画です。完成形を2秒以上保持する動画を撮影すると、より正確な保持評価が得られます。"
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
