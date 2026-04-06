import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  TechniqueEvent,
  LM,
} from "../types";
import { PLANCHE_CONFIG as C } from "../config";
import { STABILITY_THRESHOLDS } from "../config";
import { classify, sev, avg, scoreFromDeviation, computeScoreImpact, rankViolations } from "./utils";

const CONFIG_VERSION = "2.0";

export function evaluatePlanche(
  series: NormalizedTimeSeries,
  features: FeatureSet
): EvaluationResult {
  const violations: RuleViolation[] = [];
  const events: TechniqueEvent[] = [];
  const suggestions: string[] = [];

  const interval = features.staticIntervals.length > 0
    ? features.staticIntervals.reduce((best, cur) =>
        cur.endTime - cur.startTime > best.endTime - best.startTime ? cur : best)
    : null;

  const startIdx = interval?.startIndex ?? 0;
  const endIdx = interval?.endIndex ?? series.frames.length - 1;
  const staticFrames = series.frames.slice(startIdx, endIdx + 1);
  const staticAngles = features.angles.slice(startIdx, endIdx + 1);
  const staticCoG = features.cog.slice(startIdx, endIdx + 1);
  const frameRange: [number, number] = [startIdx, endIdx];
  const confidence = Math.min(1, staticFrames.length / 5);

  if (staticFrames.length === 0) {
    return {
      technique: "planche", finalScore: 0, breakdown: [],
      violations: [{ ruleId: "no_frames", severity: "critical", status: "fail",
        bodyPart: "全体", message: "分析可能なフレームがありません",
        actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 }, deviation: 1, unit: "frames", confidence: 0 }],
      events: [], suggestionsRaw: ["プランシェの姿勢がはっきり映る動画を再度アップロードしてください"],
      meta: { analyzedFrameRange: [0, 0], staticIntervalUsed: null, totalFrames: series.frames.length, configVersion: CONFIG_VERSION },
    };
  }

  // Determine weights early for scoreImpact
  const hasStability = staticFrames.length >= 3;
  const weights = hasStability ? C.weights.videoMode : C.weights.imageMode;

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

  // ---- 5. Stability ----
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

  const breakdown: ScoreBreakdown[] = [
    { ...shoulderBreakdown, weight: weights[0] },
    { ...bodyLineBreakdown, weight: weights[1] },
    { ...hipSagBreakdown, weight: weights[2] },
    { ...elbowBreakdown, weight: weights[3] },
  ];
  if (stabilityBreakdown) breakdown.push({ ...stabilityBreakdown, weight: weights[4] as number });

  const finalScore = Math.round(breakdown.reduce((sum, b) => sum + b.score * b.weight, 0));

  return {
    technique: "planche", finalScore, breakdown,
    violations: rankViolations(violations),
    events, suggestionsRaw: suggestions,
    meta: { analyzedFrameRange: frameRange, staticIntervalUsed: interval ?? null, totalFrames: series.frames.length, configVersion: CONFIG_VERSION },
  };
}
