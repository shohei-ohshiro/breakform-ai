import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  TechniqueEvent,
  SamplingInfo,
  LM,
} from "../types";
import { HANDSTAND_CONFIG as C } from "../config";
import { STABILITY_THRESHOLDS, SYMMETRY_THRESHOLDS } from "../config";
import { classify, sev, avg, scoreFromDeviation, computeScoreImpact, rankViolations, buildCoverageInfo } from "./utils";

const CONFIG_VERSION = "2.0";

export function evaluateHandstand(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo
): EvaluationResult {
  const violations: RuleViolation[] = [];
  const events: TechniqueEvent[] = [];
  const suggestions: string[] = [];

  const interval =
    features.staticIntervals.length > 0
      ? features.staticIntervals.reduce((best, cur) =>
          cur.endTime - cur.startTime > best.endTime - best.startTime ? cur : best
        )
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
      technique: "handstand",
      finalScore: 0,
      breakdown: [],
      violations: [{
        ruleId: "no_frames", severity: "critical", status: "fail",
        bodyPart: "全体", message: "分析可能なフレームがありません",
        actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 },
        deviation: 1, unit: "frames", confidence: 0,
      }],
      events: [],
      suggestionsRaw: ["倒立の姿勢がはっきり映る動画を再度アップロードしてください"],
      meta: { analyzedFrameRange: [0, 0], staticIntervalUsed: null, totalFrames: series.frames.length, configVersion: CONFIG_VERSION },
    };
  }

  // ---- Determine weights early (needed for scoreImpact) ----
  const hasStability = staticFrames.length >= 3;
  const weights = hasStability ? C.weights.videoMode : C.weights.imageMode;

  // ---- 1. Alignment ----
  const avgSpine = avg(staticAngles.map(a => a.spineAngle));
  const avgHip = avg(staticAngles.map(a => (a.leftHip + a.rightHip) / 2));
  const avgKnee = avg(staticAngles.map(a => (a.leftKnee + a.rightKnee) / 2));
  const hipDev = Math.abs(180 - avgHip);
  const kneeDev = Math.abs(180 - avgKnee);
  const alignmentWeight = weights[0];

  const spineStatus = classify(avgSpine, C.alignment.spine.warn, C.alignment.spine.fail);
  if (spineStatus !== "pass") {
    violations.push({
      ruleId: "handstand_spine_bend", severity: sev(spineStatus), status: spineStatus,
      bodyPart: "体幹", message: `体幹が${avgSpine.toFixed(1)}°傾いています`,
      actual: avgSpine, ideal: C.alignment.spine.ideal,
      threshold: { warn: C.alignment.spine.warn, fail: C.alignment.spine.fail },
      deviation: avgSpine, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgSpine, C.alignment.spineDeductionPerDeg, alignmentWeight * C.alignment.weights.spine, sev(spineStatus)),
    });
    suggestions.push("体を一直線に保つことを意識しましょう。腰が反る場合は腹筋を引き締めて骨盤を後傾させます。");
  }

  const hipStatus = classify(hipDev, Math.abs(180 - C.alignment.hipExtension.warn), Math.abs(180 - C.alignment.hipExtension.fail));
  if (hipStatus !== "pass") {
    violations.push({
      ruleId: "handstand_hip_bend", severity: sev(hipStatus), status: hipStatus,
      bodyPart: "股関節", message: `股関節が${hipDev.toFixed(1)}°曲がっています（理想: 180°）`,
      actual: avgHip, ideal: 180,
      threshold: { warn: Math.abs(180 - C.alignment.hipExtension.warn), fail: Math.abs(180 - C.alignment.hipExtension.fail) },
      deviation: hipDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(hipDev, C.alignment.hipDeductionPerDeg, alignmentWeight * C.alignment.weights.hip, sev(hipStatus)),
    });
  }

  const kneeStatus = classify(kneeDev, Math.abs(180 - C.alignment.kneeExtension.warn), Math.abs(180 - C.alignment.kneeExtension.fail));
  if (kneeStatus !== "pass") {
    violations.push({
      ruleId: "handstand_knee_bend", severity: sev(kneeStatus), status: kneeStatus,
      bodyPart: "膝", message: `膝が${kneeDev.toFixed(1)}°曲がっています（理想: 180°）`,
      actual: avgKnee, ideal: 180,
      threshold: { warn: Math.abs(180 - C.alignment.kneeExtension.warn), fail: Math.abs(180 - C.alignment.kneeExtension.fail) },
      deviation: kneeDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(kneeDev, C.alignment.kneeDeductionPerDeg, alignmentWeight * C.alignment.weights.knee, sev(kneeStatus)),
    });
  }

  const spineScore = scoreFromDeviation(avgSpine, C.alignment.spineDeductionPerDeg);
  const hipScore = scoreFromDeviation(hipDev, C.alignment.hipDeductionPerDeg);
  const kneeScore = scoreFromDeviation(kneeDev, C.alignment.kneeDeductionPerDeg);
  const w = C.alignment.weights;
  const alignmentScore = Math.round(spineScore * w.spine + hipScore * w.hip + kneeScore * w.knee);

  const alignmentBreakdown: ScoreBreakdown = {
    category: "alignment", label: "一直線性", score: alignmentScore, weight: 0,
    violations: violations.filter(v => v.ruleId.startsWith("handstand_spine") || v.ruleId.startsWith("handstand_hip_bend") || v.ruleId.startsWith("handstand_knee")),
    measurements: { avgSpine, avgHip, avgKnee, hipDev, kneeDev },
    frameRange,
  };

  // ---- 2. Shoulder Push ----
  const avgShoulder = avg(staticAngles.map(a => (a.leftShoulder + a.rightShoulder) / 2));
  const shoulderDev = Math.abs(180 - avgShoulder);
  const shoulderWeight = weights[1];

  let avgElevation = 0;
  for (const frame of staticFrames) {
    const lm = frame.landmarks;
    const sMidY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
    const eMidY = (lm[LM.LEFT_EAR].y + lm[LM.RIGHT_EAR].y) / 2;
    avgElevation += (sMidY - eMidY);
  }
  avgElevation /= staticFrames.length;

  const shoulderAngleStatus = classify(shoulderDev, Math.abs(180 - C.shoulderPush.angle.warn), Math.abs(180 - C.shoulderPush.angle.fail));
  if (shoulderAngleStatus !== "pass") {
    violations.push({
      ruleId: "handstand_shoulder_push", severity: sev(shoulderAngleStatus), status: shoulderAngleStatus,
      bodyPart: "肩", message: `肩の押し上げ不足（肩角度: ${avgShoulder.toFixed(1)}°、理想: 170-180°）`,
      actual: avgShoulder, ideal: 180,
      threshold: { warn: Math.abs(180 - C.shoulderPush.angle.warn), fail: Math.abs(180 - C.shoulderPush.angle.fail) },
      deviation: shoulderDev, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(shoulderDev, C.shoulderPush.deductionPerDeg, shoulderWeight, sev(shoulderAngleStatus)),
    });
    suggestions.push("肩をしっかり押し上げ(シュラッグ)、耳と腕の間にスペースを作りましょう。");
  }

  const elevStatus = classify(avgElevation, C.shoulderPush.elevation.warn, C.shoulderPush.elevation.fail, false);
  if (elevStatus !== "pass") {
    violations.push({
      ruleId: "handstand_shoulder_shrug", severity: sev(elevStatus), status: elevStatus,
      bodyPart: "肩", message: "肩をもっと耳から遠ざけるように押し上げてください",
      actual: avgElevation, ideal: C.shoulderPush.elevation.ideal,
      threshold: { warn: C.shoulderPush.elevation.warn, fail: C.shoulderPush.elevation.fail },
      deviation: Math.abs(C.shoulderPush.elevation.ideal - avgElevation), unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(Math.abs(C.shoulderPush.elevation.ideal - avgElevation), 50, shoulderWeight, sev(elevStatus)),
    });
  }

  const shoulderScore = scoreFromDeviation(shoulderDev, C.shoulderPush.deductionPerDeg);
  const shoulderBreakdown: ScoreBreakdown = {
    category: "shoulder_push", label: "肩の押し上げ", score: shoulderScore, weight: 0,
    violations: violations.filter(v => v.ruleId.startsWith("handstand_shoulder")),
    measurements: { avgShoulder, shoulderDev, avgElevation },
    frameRange,
  };

  // ---- 3. Center of Gravity ----
  const cogWeight = weights[2];
  let avgCogOffsetX = 0;
  for (let i = 0; i < staticFrames.length; i++) {
    const lm = staticFrames[i].landmarks;
    const wristMidX = (lm[LM.LEFT_WRIST].x + lm[LM.RIGHT_WRIST].x) / 2;
    avgCogOffsetX += Math.abs(staticCoG[i].x - wristMidX);
  }
  avgCogOffsetX /= staticFrames.length;

  const cogStatus = classify(avgCogOffsetX, C.centerOfGravity.offset.warn, C.centerOfGravity.offset.fail);
  if (cogStatus !== "pass") {
    violations.push({
      ruleId: "handstand_cog_offset", severity: sev(cogStatus), status: cogStatus,
      bodyPart: "重心", message: `重心が支持基底面から${(avgCogOffsetX * 100).toFixed(0)}%ずれています`,
      actual: avgCogOffsetX, ideal: 0,
      threshold: { warn: C.centerOfGravity.offset.warn, fail: C.centerOfGravity.offset.fail },
      deviation: avgCogOffsetX, unit: "ratio", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgCogOffsetX, C.centerOfGravity.deductionMultiplier, cogWeight, sev(cogStatus)),
    });
    suggestions.push("重心が手のひらの上に来るよう微調整しましょう。壁倒立で感覚を養うのが効果的です。");
  }

  const cogScore = scoreFromDeviation(avgCogOffsetX, C.centerOfGravity.deductionMultiplier);
  const cogBreakdown: ScoreBreakdown = {
    category: "center_of_gravity", label: "重心位置", score: cogScore, weight: 0,
    violations: violations.filter(v => v.ruleId === "handstand_cog_offset"),
    measurements: { avgCogOffsetX },
    frameRange,
  };

  // ---- 4. Symmetry ----
  const S = SYMMETRY_THRESHOLDS;
  const symmetryWeight = weights[3];
  const avgShoulderDiff = avg(staticAngles.map(a => Math.abs(a.leftShoulder - a.rightShoulder)));
  const avgHipDiff = avg(staticAngles.map(a => Math.abs(a.leftHip - a.rightHip)));
  const avgKneeDiff = avg(staticAngles.map(a => Math.abs(a.leftKnee - a.rightKnee)));
  const avgHipTilt = avg(staticAngles.map(a => Math.abs(a.hipAlignment)));

  const shSymSt = classify(avgShoulderDiff, S.shoulderDiff.warn, S.shoulderDiff.fail);
  if (shSymSt !== "pass") {
    violations.push({
      ruleId: "handstand_shoulder_asymmetry", severity: sev(shSymSt), status: shSymSt,
      bodyPart: "肩", message: `左右の肩角度に${avgShoulderDiff.toFixed(1)}°の差`,
      actual: avgShoulderDiff, ideal: 0,
      threshold: { warn: S.shoulderDiff.warn, fail: S.shoulderDiff.fail },
      deviation: avgShoulderDiff, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgShoulderDiff, S.penaltyMultiplier, symmetryWeight, sev(shSymSt)),
    });
    suggestions.push("左右のバランスが偏っています。壁倒立で左右均等な荷重を練習しましょう。");
  }

  const hipSymSt = classify(avgHipDiff, S.hipDiff.warn, S.hipDiff.fail);
  if (hipSymSt !== "pass") {
    violations.push({
      ruleId: "handstand_hip_asymmetry", severity: sev(hipSymSt), status: hipSymSt,
      bodyPart: "股関節", message: `左右の股関節角度に${avgHipDiff.toFixed(1)}°の差`,
      actual: avgHipDiff, ideal: 0,
      threshold: { warn: S.hipDiff.warn, fail: S.hipDiff.fail },
      deviation: avgHipDiff, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgHipDiff, S.penaltyMultiplier, symmetryWeight, sev(hipSymSt)),
    });
  }

  const tiltSt = classify(avgHipTilt, S.hipTilt.warn, S.hipTilt.fail);
  if (tiltSt !== "pass") {
    violations.push({
      ruleId: "handstand_hip_tilt", severity: sev(tiltSt), status: tiltSt,
      bodyPart: "骨盤", message: `骨盤が${avgHipTilt.toFixed(1)}°傾いている`,
      actual: avgHipTilt, ideal: 0,
      threshold: { warn: S.hipTilt.warn, fail: S.hipTilt.fail },
      deviation: avgHipTilt, unit: "deg", confidence, context: { frameRange },
      scoreImpact: computeScoreImpact(avgHipTilt, S.penaltyMultiplier, symmetryWeight, sev(tiltSt)),
    });
  }

  const totalDiff = avgShoulderDiff + avgHipDiff + avgKneeDiff + avgHipTilt;
  const symmetryScore = Math.round(Math.max(0, 100 - totalDiff * S.penaltyMultiplier));
  const symmetryBreakdown: ScoreBreakdown = {
    category: "symmetry", label: "左右対称性", score: symmetryScore, weight: 0,
    violations: violations.filter(v => v.ruleId.includes("asymmetry") || v.ruleId.includes("tilt")),
    measurements: { avgShoulderDiff, avgHipDiff, avgKneeDiff, avgHipTilt },
    frameRange,
  };

  // ---- 5. Stability ----
  let stabilityBreakdown: ScoreBreakdown | null = null;
  if (hasStability) {
    const ST = STABILITY_THRESHOLDS;
    const stabilityWeight = weights[4] as number;
    const avgX = avg(staticCoG.map(c => c.x));
    const avgY = avg(staticCoG.map(c => c.y));
    const totalVar = Math.sqrt(
      staticCoG.reduce((s, c) => s + (c.x - avgX) ** 2 + (c.y - avgY) ** 2, 0) / staticCoG.length
    );

    const stabStatus = classify(totalVar, ST.cogVariance.warn, ST.cogVariance.fail);
    if (stabStatus !== "pass") {
      violations.push({
        ruleId: "handstand_instability", severity: sev(stabStatus), status: stabStatus,
        bodyPart: "重心", message: `姿勢のブレが大きい（重心分散: ${(totalVar * 100).toFixed(1)}）`,
        actual: totalVar, ideal: 0,
        threshold: { warn: ST.cogVariance.warn, fail: ST.cogVariance.fail },
        deviation: totalVar, unit: "ratio", confidence, context: { frameRange },
        scoreImpact: computeScoreImpact(totalVar, ST.scorePenaltyMultiplier, stabilityWeight, sev(stabStatus)),
      });
      suggestions.push("姿勢のブレが大きいです。指先での微調整を意識しましょう。");
    }

    const stabScore = scoreFromDeviation(totalVar, ST.scorePenaltyMultiplier);
    stabilityBreakdown = {
      category: "stability", label: "安定性", score: stabScore, weight: 0,
      violations: violations.filter(v => v.ruleId === "handstand_instability"),
      measurements: { totalVariance: totalVar },
      frameRange,
    };
  }

  // ---- Build breakdown with weights ----
  const breakdown: ScoreBreakdown[] = [
    { ...alignmentBreakdown, weight: weights[0] },
    { ...shoulderBreakdown, weight: weights[1] },
    { ...cogBreakdown, weight: weights[2] },
    { ...symmetryBreakdown, weight: weights[3] },
  ];
  if (stabilityBreakdown) {
    breakdown.push({ ...stabilityBreakdown, weight: weights[4] as number });
  }

  const finalScore = Math.round(breakdown.reduce((sum, b) => sum + b.score * b.weight, 0));

  const scoringReason = interval
    ? "静止保持区間（最長の安定区間）"
    : "全フレームを使用";
  const coverageInfo = buildCoverageInfo(series, startIdx, endIdx, scoringReason, sampling);

  return {
    technique: "handstand",
    finalScore,
    breakdown,
    violations: rankViolations(violations),
    events,
    suggestionsRaw: suggestions,
    meta: {
      analyzedFrameRange: frameRange,
      staticIntervalUsed: interval ?? null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
      evaluationMode: "hold" as const,
      holdDuration: interval ? interval.endTime - interval.startTime : 0,
      holdRatio: interval
        ? (interval.endTime - interval.startTime) / (series.duration || 1)
        : 0,
      coverageInfo,
    },
  };
}
