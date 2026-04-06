import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  RuleStatus,
  TechniqueEvent,
  LM,
} from "../types";
import { SWIPES_CONFIG as C } from "../config";
import { classify, sev, rankViolations } from "./utils";

const CONFIG_VERSION = "2.0";

/**
 * Swipes Evaluator — event-detection based (NOT single-frame)
 *
 * Phases of a swipe:
 * 1. Entry: hands plant on ground, body starts rotation
 * 2. Kick-through: legs swing through, hips rotate
 * 3. Aerial: feet leave ground briefly, body rotates
 * 4. Landing: hands re-plant for next rep
 */
export function evaluateSwipes(
  series: NormalizedTimeSeries,
  features: FeatureSet
): EvaluationResult {
  const violations: RuleViolation[] = [];
  const suggestions: string[] = [];

  if (series.frames.length < C.general.minFrames) {
    return {
      technique: "swipes",
      finalScore: 0,
      breakdown: [],
      violations: [{
        ruleId: "swipes_insufficient_frames", severity: "critical", status: "fail",
        bodyPart: "全体", message: `スワイプスの分析には動画が必要です（最低${C.general.minFrames}フレーム）`,
        actual: series.frames.length, ideal: C.general.minFrames,
        threshold: { warn: C.general.minFrames, fail: C.general.minFrames },
        deviation: C.general.minFrames - series.frames.length, unit: "frames", confidence: 0,
      }],
      events: [],
      suggestionsRaw: ["スワイプスは動作系の技のため、動画での分析が必要です。1-2回転が映る動画をアップロードしてください。"],
      meta: { analyzedFrameRange: [0, 0], staticIntervalUsed: null, totalFrames: series.frames.length, configVersion: CONFIG_VERSION },
    };
  }

  const confidence = Math.min(1, series.frames.length / 15);

  // ---- Event Detection ----
  const events = detectSwipeEvents(series, features);

  const handPlants = events.filter((e) => e.type === "hand_plant");
  const legSwings = events.filter((e) => e.type === "leg_swing");
  const phaseChanges = events.filter((e) => e.type === "phase_change");

  // Determine weights early
  const hasReps = handPlants.length >= 2;
  const weights = hasReps ? C.weights.fiveCategory : C.weights.fourCategory;

  // ---- 1. Hand Plant Timing ----
  const handPlantResult = evaluateHandPlantTiming(handPlants, confidence, weights[0]);
  violations.push(...handPlantResult.violations);
  if (handPlantResult.violations.length > 0) {
    suggestions.push("手の接地タイミングが不安定です。手をつくタイミングを一定にすることで回転がスムーズになります。ゆっくりした回転から始めてリズムを掴みましょう。");
  }

  // ---- 2. Entry Posture ----
  const entryResult = evaluateEntryPosture(handPlants, features, confidence, weights[1]);
  violations.push(...entryResult.violations);
  if (entryResult.violations.length > 0) {
    suggestions.push("進入時の姿勢を改善しましょう。手をつく瞬間に体を十分に開き、肩の上に体重を乗せることが重要です。");
  }

  // ---- 3. Leg Swing ----
  const legSwingResult = evaluateLegSwing(legSwings, confidence, weights[2]);
  violations.push(...legSwingResult.violations);
  if (legSwingResult.violations.length > 0) {
    suggestions.push("脚の振り上げが弱いです。腰の回転と連動させて大きく脚を振り上げましょう。股関節の柔軟性と下半身のパワーがポイントです。");
  }

  // ---- 4. Phase Transitions ----
  const phaseResult = evaluatePhaseTransitions(phaseChanges, confidence, weights[3]);
  violations.push(...phaseResult.violations);
  if (phaseResult.violations.length > 0) {
    suggestions.push("フェーズの切り替えがスムーズではありません。手→足→手の切り替えを滑らかにするため、腰の回転を止めないよう意識しましょう。");
  }

  // ---- 5. Repetition Consistency ----
  let repResult: ScoreBreakdown | null = null;
  if (hasReps) {
    repResult = evaluateRepConsistency(handPlants, legSwings, confidence, weights[4] as number);
    violations.push(...repResult.violations);
    if (repResult.violations.length > 0) {
      suggestions.push("各回転の一貫性にバラツキがあります。毎回同じフォームで回転できるよう反復練習しましょう。");
    }
  }

  // Build breakdown
  const breakdown: ScoreBreakdown[] = [
    { ...handPlantResult, weight: weights[0] },
    { ...entryResult, weight: weights[1] },
    { ...legSwingResult, weight: weights[2] },
    { ...phaseResult, weight: weights[3] },
  ];
  if (repResult) {
    breakdown.push({ ...repResult, weight: weights[4] as number });
  }

  const finalScore = Math.round(
    breakdown.reduce((sum, b) => sum + b.score * b.weight, 0)
  );

  return {
    technique: "swipes",
    finalScore,
    breakdown,
    violations: rankViolations(violations),
    events,
    suggestionsRaw: suggestions,
    meta: {
      analyzedFrameRange: [0, series.frames.length - 1],
      staticIntervalUsed: null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
    },
  };
}

// ---- Event Detection ----

function detectSwipeEvents(
  series: NormalizedTimeSeries,
  features: FeatureSet
): TechniqueEvent[] {
  const events: TechniqueEvent[] = [];

  const wristLVels = features.velocities.get(LM.LEFT_WRIST) ?? [];
  const wristRVels = features.velocities.get(LM.RIGHT_WRIST) ?? [];
  const ankleLVels = features.velocities.get(LM.LEFT_ANKLE) ?? [];
  const ankleRVels = features.velocities.get(LM.RIGHT_ANKLE) ?? [];

  for (let i = 1; i < series.frames.length; i++) {
    const frame = series.frames[i];
    const prevFrame = series.frames[i - 1];
    const lm = frame.landmarks;
    const prevLm = prevFrame.landmarks;

    // Left wrist hand plant
    const lWristY = lm[LM.LEFT_WRIST].y;
    const prevLWristY = prevLm[LM.LEFT_WRIST].y;
    const lWristVel = wristLVels.find((v) => v.timestamp === frame.timestamp);

    if (lWristY < C.handPlant.yThreshold && prevLWristY >= C.handPlant.yThreshold) {
      events.push({
        type: "hand_plant", timestamp: frame.timestamp, frameIndex: i,
        details: { hand: "left", wristY: lWristY, speed: lWristVel?.speed ?? 0 },
      });
    }

    // Right wrist hand plant
    const rWristY = lm[LM.RIGHT_WRIST].y;
    const prevRWristY = prevLm[LM.RIGHT_WRIST].y;
    const rWristVel = wristRVels.find((v) => v.timestamp === frame.timestamp);

    if (rWristY < C.handPlant.yThreshold && prevRWristY >= C.handPlant.yThreshold) {
      events.push({
        type: "hand_plant", timestamp: frame.timestamp, frameIndex: i,
        details: { hand: "right", wristY: rWristY, speed: rWristVel?.speed ?? 0 },
      });
    }

    // Left ankle leg swing
    const lAnkleVel = ankleLVels.find((v) => v.timestamp === frame.timestamp);
    const prevLAnkleVel = ankleLVels.find((v) => v.timestamp === prevFrame.timestamp);
    if (lAnkleVel && lAnkleVel.speed > C.legSwing.speedMin &&
        (!prevLAnkleVel || prevLAnkleVel.speed <= C.legSwing.speedMin)) {
      events.push({
        type: "leg_swing", timestamp: frame.timestamp, frameIndex: i,
        details: { side: "left", speed: lAnkleVel.speed },
      });
    }

    // Right ankle leg swing
    const rAnkleVel = ankleRVels.find((v) => v.timestamp === frame.timestamp);
    const prevRAnkleVel = ankleRVels.find((v) => v.timestamp === prevFrame.timestamp);
    if (rAnkleVel && rAnkleVel.speed > C.legSwing.speedMin &&
        (!prevRAnkleVel || prevRAnkleVel.speed <= C.legSwing.speedMin)) {
      events.push({
        type: "leg_swing", timestamp: frame.timestamp, frameIndex: i,
        details: { side: "right", speed: rAnkleVel.speed },
      });
    }
  }

  // Phase changes
  let prevPhase = "unknown";
  for (let i = 0; i < series.frames.length; i++) {
    const lm = series.frames[i].landmarks;
    const wristMinY = Math.min(lm[LM.LEFT_WRIST].y, lm[LM.RIGHT_WRIST].y);
    const ankleMinY = Math.min(lm[LM.LEFT_ANKLE].y, lm[LM.RIGHT_ANKLE].y);

    let phase: string;
    if (wristMinY < C.handPlant.yThreshold) phase = "hands";
    else if (ankleMinY < C.handPlant.yThreshold) phase = "feet";
    else phase = "aerial";

    if (phase !== prevPhase && prevPhase !== "unknown") {
      events.push({
        type: "phase_change", timestamp: series.frames[i].timestamp, frameIndex: i,
        details: { from: prevPhase, to: phase },
      });
    }
    prevPhase = phase;
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

// ---- Sub-evaluators ----

function evaluateHandPlantTiming(
  handPlants: TechniqueEvent[],
  confidence: number,
  categoryWeight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (handPlants.length === 0) {
    violations.push({
      ruleId: "swipes_no_hand_plant", severity: "critical", status: "fail",
      bodyPart: "手", message: "手の接地イベントが検出されませんでした",
      actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 },
      deviation: 1, unit: "count", confidence,
      scoreImpact: 40 * categoryWeight,
    });
    return { category: "hand_plant", label: "手の接地タイミング", score: 20, weight: 0, violations };
  }

  if (handPlants.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < handPlants.length; i++) {
      intervals.push(handPlants[i].timestamp - handPlants[i - 1].timestamp);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + (v - avgInterval) ** 2, 0) / intervals.length;
    const cv = avgInterval > 0 ? Math.sqrt(variance) / avgInterval : 0;

    const cvStatus = classify(cv, C.handPlant.timingCV.warn, C.handPlant.timingCV.fail);
    if (cvStatus !== "pass") {
      violations.push({
        ruleId: "swipes_timing_inconsistent", severity: sev(cvStatus), status: cvStatus,
        bodyPart: "手", message: `手の接地タイミングにバラツキがあります（変動係数: ${(cv * 100).toFixed(0)}%）`,
        actual: cv, ideal: C.handPlant.timingCV.ideal,
        threshold: { warn: C.handPlant.timingCV.warn, fail: C.handPlant.timingCV.fail },
        deviation: cv, unit: "ratio", confidence,
        scoreImpact: (sev(cvStatus) === "critical" ? 20 : 10) * categoryWeight,
      });
    }
  }

  const baseScore = handPlants.length >= 2 ? 80 : 60;
  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "critical" ? 40 : v.severity === "major" ? 20 : 10), 0
  );
  const score = Math.max(0, baseScore - penalty);

  return {
    category: "hand_plant", label: "手の接地タイミング", score, weight: 0, violations,
    measurements: { handPlantCount: handPlants.length },
  };
}

function evaluateEntryPosture(
  handPlants: TechniqueEvent[],
  features: FeatureSet,
  confidence: number,
  categoryWeight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (handPlants.length === 0) {
    violations.push({
      ruleId: "swipes_no_entry", severity: "major", status: "fail",
      bodyPart: "全体", message: "進入姿勢を評価するための手接地イベントがありません",
      actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 },
      deviation: 1, unit: "count", confidence,
      scoreImpact: 20 * categoryWeight,
    });
    return { category: "entry_posture", label: "進入姿勢", score: 30, weight: 0, violations };
  }

  let avgHipAngle = 0;
  let avgShoulderAngle = 0;
  let count = 0;

  for (const plant of handPlants) {
    const idx = plant.frameIndex;
    if (idx < features.angles.length) {
      const a = features.angles[idx];
      avgHipAngle += (a.leftHip + a.rightHip) / 2;
      avgShoulderAngle += (a.leftShoulder + a.rightShoulder) / 2;
      count++;
    }
  }

  if (count > 0) {
    avgHipAngle /= count;
    avgShoulderAngle /= count;

    const hipStatus = classify(avgHipAngle, C.entryPosture.hipAngle.warn, C.entryPosture.hipAngle.fail, false);
    if (hipStatus !== "pass") {
      const dev = Math.abs(C.entryPosture.hipAngle.ideal - avgHipAngle);
      violations.push({
        ruleId: "swipes_entry_hip_closed", severity: sev(hipStatus), status: hipStatus,
        bodyPart: "股関節",
        message: `進入時の股関節角度が狭いです（${avgHipAngle.toFixed(1)}°、理想: ${C.entryPosture.hipAngle.ideal}°以上）`,
        actual: avgHipAngle, ideal: C.entryPosture.hipAngle.ideal,
        threshold: { warn: C.entryPosture.hipAngle.warn, fail: C.entryPosture.hipAngle.fail },
        deviation: dev, unit: "deg", confidence,
        scoreImpact: (sev(hipStatus) === "critical" ? 40 : sev(hipStatus) === "major" ? 20 : 10) * categoryWeight,
      });
    }
  }

  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "critical" ? 40 : v.severity === "major" ? 20 : 10), 0
  );
  const score = Math.max(0, 80 - penalty);

  return {
    category: "entry_posture", label: "進入姿勢", score, weight: 0, violations,
    measurements: { avgHipAngle, avgShoulderAngle },
  };
}

function evaluateLegSwing(
  legSwings: TechniqueEvent[],
  confidence: number,
  categoryWeight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (legSwings.length === 0) {
    violations.push({
      ruleId: "swipes_no_leg_swing", severity: "major", status: "fail",
      bodyPart: "脚", message: "明確な脚の振り上げが検出されませんでした",
      actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 },
      deviation: 1, unit: "count", confidence,
      scoreImpact: 25 * categoryWeight,
    });
    return { category: "leg_swing", label: "脚の振り上げ", score: 30, weight: 0, violations };
  }

  const avgSpeed = legSwings.reduce((s, e) => s + (e.details.speed as number), 0) / legSwings.length;

  if (avgSpeed < C.legSwing.speedGood) {
    const speedStatus: RuleStatus = avgSpeed < C.legSwing.speedMin ? "fail" : "warn";
    violations.push({
      ruleId: "swipes_weak_leg_swing", severity: sev(speedStatus), status: speedStatus,
      bodyPart: "脚",
      message: `脚の振り上げ速度が不十分です（${avgSpeed.toFixed(1)}、推奨: ${C.legSwing.speedGood}以上）`,
      actual: avgSpeed, ideal: C.legSwing.speedIdeal,
      threshold: { warn: C.legSwing.speedGood, fail: C.legSwing.speedMin },
      deviation: Math.abs(C.legSwing.speedIdeal - avgSpeed), unit: "speed", confidence,
      scoreImpact: (sev(speedStatus) === "critical" ? 40 : 10) * categoryWeight,
    });
  }

  const speedScore = Math.min(100, (avgSpeed / C.legSwing.speedIdeal) * 100);
  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "critical" ? 40 : v.severity === "major" ? 25 : 10), 0
  );
  const score = Math.max(0, Math.round(speedScore) - penalty);

  return {
    category: "leg_swing", label: "脚の振り上げ", score, weight: 0, violations,
    measurements: { avgSpeed, legSwingCount: legSwings.length },
  };
}

function evaluatePhaseTransitions(
  phaseChanges: TechniqueEvent[],
  confidence: number,
  categoryWeight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (phaseChanges.length < 2) {
    violations.push({
      ruleId: "swipes_no_rotation", severity: "major", status: "fail",
      bodyPart: "全体", message: "回転のフェーズ切り替えが検出されませんでした",
      actual: phaseChanges.length, ideal: 3,
      threshold: { warn: 2, fail: 2 },
      deviation: 3 - phaseChanges.length, unit: "count", confidence,
      scoreImpact: 15 * categoryWeight,
    });
    return { category: "phase_transition", label: "フェーズ遷移", score: 25, weight: 0, violations };
  }

  const sequence = phaseChanges.map((e) => e.details.to as string);
  const hasHandsPhase = sequence.includes("hands");
  const hasFeetPhase = sequence.includes("feet");

  if (!hasHandsPhase || !hasFeetPhase) {
    violations.push({
      ruleId: "swipes_incomplete_rotation", severity: "major", status: "warn",
      bodyPart: "全体", message: "手支持→足支持の完全な回転サイクルが検出されませんでした",
      actual: 0, ideal: 1, threshold: { warn: 1, fail: 1 },
      deviation: 1, unit: "cycle", confidence,
      scoreImpact: 15 * categoryWeight,
    });
  }

  const phaseDurations: number[] = [];
  for (let i = 1; i < phaseChanges.length; i++) {
    phaseDurations.push(phaseChanges[i].timestamp - phaseChanges[i - 1].timestamp);
  }

  if (phaseDurations.length > 0) {
    const minDuration = Math.min(...phaseDurations);
    if (minDuration < C.phaseTransition.minPhaseDuration) {
      violations.push({
        ruleId: "swipes_jerky_transition", severity: "minor", status: "warn",
        bodyPart: "全体", message: "フェーズ遷移が急すぎる箇所があります",
        actual: minDuration, ideal: C.phaseTransition.minPhaseDuration * 2,
        threshold: { warn: C.phaseTransition.minPhaseDuration, fail: C.phaseTransition.minPhaseDuration / 2 },
        deviation: C.phaseTransition.minPhaseDuration - minDuration, unit: "sec", confidence,
        scoreImpact: 5 * categoryWeight,
      });
    }
  }

  const baseScore = hasHandsPhase && hasFeetPhase ? 75 : (hasHandsPhase || hasFeetPhase ? 50 : 25);
  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "critical" ? 30 : v.severity === "major" ? 15 : 5), 0
  );
  const score = Math.max(0, baseScore - penalty);

  return {
    category: "phase_transition", label: "フェーズ遷移", score, weight: 0, violations,
    measurements: { phaseChangeCount: phaseChanges.length, hasHandsPhase: hasHandsPhase ? 1 : 0, hasFeetPhase: hasFeetPhase ? 1 : 0 },
  };
}

function evaluateRepConsistency(
  handPlants: TechniqueEvent[],
  legSwings: TechniqueEvent[],
  confidence: number,
  categoryWeight: number
): ScoreBreakdown {
  const violations: RuleViolation[] = [];

  if (handPlants.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < handPlants.length; i++) {
      intervals.push(handPlants[i].timestamp - handPlants[i - 1].timestamp);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxDev = Math.max(...intervals.map((v) => Math.abs(v - avgInterval)));
    const relDev = avgInterval > 0 ? maxDev / avgInterval : 0;

    const devStatus = classify(relDev, C.repConsistency.timingDeviation.warn, C.repConsistency.timingDeviation.fail);
    if (devStatus !== "pass") {
      violations.push({
        ruleId: "swipes_rep_inconsistent", severity: sev(devStatus), status: devStatus,
        bodyPart: "全体",
        message: `回転ごとのタイミングにバラツキがあります（最大偏差: ${(relDev * 100).toFixed(0)}%）`,
        actual: relDev, ideal: C.repConsistency.timingDeviation.ideal,
        threshold: { warn: C.repConsistency.timingDeviation.warn, fail: C.repConsistency.timingDeviation.fail },
        deviation: relDev, unit: "ratio", confidence,
        scoreImpact: (sev(devStatus) === "major" ? 20 : 10) * categoryWeight,
      });
    }
  }

  if (legSwings.length >= 2) {
    const speeds = legSwings.map((e) => e.details.speed as number);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const maxSpeedDev = Math.max(...speeds.map((s) => Math.abs(s - avgSpeed)));
    const relSpeedDev = avgSpeed > 0 ? maxSpeedDev / avgSpeed : 0;

    const speedDevStatus = classify(relSpeedDev, C.repConsistency.speedDeviation.warn, C.repConsistency.speedDeviation.fail);
    if (speedDevStatus !== "pass") {
      violations.push({
        ruleId: "swipes_swing_inconsistent", severity: sev(speedDevStatus), status: speedDevStatus,
        bodyPart: "脚",
        message: `脚の振り上げ速度にバラツキがあります（偏差: ${(relSpeedDev * 100).toFixed(0)}%）`,
        actual: relSpeedDev, ideal: C.repConsistency.speedDeviation.ideal,
        threshold: { warn: C.repConsistency.speedDeviation.warn, fail: C.repConsistency.speedDeviation.fail },
        deviation: relSpeedDev, unit: "ratio", confidence,
        scoreImpact: 10 * categoryWeight,
      });
    }
  }

  const penalty = violations.reduce(
    (p, v) => p + (v.severity === "major" ? 20 : 10), 0
  );
  const score = Math.max(0, 80 - penalty);

  return {
    category: "rep_consistency", label: "反復の一貫性", score, weight: 0, violations,
    measurements: { handPlantCount: handPlants.length, legSwingCount: legSwings.length },
  };
}
