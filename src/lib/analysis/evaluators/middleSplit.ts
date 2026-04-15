import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  ScoreBreakdown,
  RuleViolation,
  TechniqueEvent,
  SamplingInfo,
  MiddleSplitFeatures,
} from "../types";
import { MIDDLE_SPLIT_CONFIG as C } from "../config";
import {
  classify,
  sev,
  scoreFromDeviation,
  computeScoreImpact,
  rankViolations,
  buildCoverageInfo,
} from "./utils";
import { MIDDLE_SPLIT_ADVICE } from "../copy/middleSplit";

const CONFIG_VERSION = "middle_split_1.0";

/**
 * Middle split evaluator (static image MVP).
 *
 * Scoring categories:
 *   split_angle       (weight 0.40) — how close to 180°
 *   pelvis_posture    (weight 0.20) — pelvic roll + tilt proxy
 *   knee_extension    (weight 0.15) — straight knees, leg line quality
 *   symmetry          (weight 0.15) — left vs right balance
 *   trunk_compensation(weight 0.10) — trunk lean
 *
 * Turnout asymmetry is surfaced as a non-scoring hint (proxy).
 *
 * All violation messages use proxy language ("〜の傾向" / "可能性") — no
 * medical or muscle-specific claims.
 */
export function evaluateMiddleSplit(
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo,
): EvaluationResult {
  const violations: RuleViolation[] = [];
  const events: TechniqueEvent[] = [];
  const suggestions: string[] = [];

  if (series.frames.length === 0 || !features.middleSplit) {
    return {
      technique: "middle_split",
      finalScore: 0,
      breakdown: [],
      violations: [
        {
          ruleId: "middle_split_no_frames",
          severity: "critical",
          status: "fail",
          bodyPart: "全体",
          message: "分析可能な画像が読み込めませんでした",
          actual: 0,
          ideal: 1,
          threshold: { warn: 1, fail: 1 },
          deviation: 1,
          unit: "frames",
          confidence: 0,
        },
      ],
      events: [],
      suggestionsRaw: [
        "正面から撮った横開脚の写真を再度アップロードしてください",
      ],
      meta: {
        analyzedFrameRange: [0, 0],
        staticIntervalUsed: null,
        totalFrames: series.frames.length,
        configVersion: CONFIG_VERSION,
      },
    };
  }

  const f: MiddleSplitFeatures = features.middleSplit;
  const frameRange: [number, number] = [0, 0];

  // Confidence scales with frontality + key landmark visibility.
  const baseConfidence = Math.max(
    0.2,
    Math.min(1, 0.4 + 0.3 * f.frontalityScore + 0.3 * f.keyLandmarkVisibility),
  );
  const pelvisConfidence = Math.max(
    0.2,
    Math.min(1, C.pelvisTiltBaseConfidence * baseConfidence * (0.5 + 0.5 * f.frontalityScore)),
  );

  // ---------- 1. Split angle ----------
  const splitDev = Math.max(0, C.splitAngle.ideal - f.splitAngleRaw);
  const splitStatus = classify(splitDev, C.splitAngle.warn, C.splitAngle.fail);
  if (splitStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_angle_insufficient",
      severity: sev(splitStatus),
      status: splitStatus,
      bodyPart: "脚",
      message: `開脚角度は約${f.splitAngleRaw.toFixed(0)}°です（目標: 180°）`,
      actual: f.splitAngleRaw,
      ideal: C.splitAngle.ideal,
      threshold: { warn: C.splitAngle.warn, fail: C.splitAngle.fail },
      deviation: splitDev,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        splitDev,
        C.splitAngle.deductionPerDeg,
        C.weights.splitAngle,
        sev(splitStatus),
      ),
    });
    suggestions.push(MIDDLE_SPLIT_ADVICE.splitAngle);
  }
  const splitScore = scoreFromDeviation(splitDev, C.splitAngle.deductionPerDeg);
  const splitBreakdown: ScoreBreakdown = {
    category: "split_angle",
    label: "開脚角度",
    score: splitScore,
    weight: 0,
    violations: violations.filter((v) =>
      v.ruleId.startsWith("middle_split_angle"),
    ),
    measurements: {
      splitAngleRaw: f.splitAngleRaw,
      splitAngleHipKnee: f.splitAngleHipKnee,
      leftLegAngleFromHorizon: f.leftLegAngleFromHorizon,
      rightLegAngleFromHorizon: f.rightLegAngleFromHorizon,
    },
    frameRange,
  };

  // ---------- 2. Pelvis posture ----------
  const pelvisRollStatus = classify(
    f.pelvisRollAngle,
    C.pelvis.roll.warn,
    C.pelvis.roll.fail,
  );
  if (pelvisRollStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_pelvis_roll",
      severity: sev(pelvisRollStatus),
      status: pelvisRollStatus,
      bodyPart: "骨盤",
      message: `骨盤が左右に約${f.pelvisRollAngle.toFixed(0)}°傾いています`,
      actual: f.pelvisRollAngle,
      ideal: C.pelvis.roll.ideal,
      threshold: { warn: C.pelvis.roll.warn, fail: C.pelvis.roll.fail },
      deviation: f.pelvisRollAngle,
      unit: "deg",
      confidence: pelvisConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.pelvisRollAngle,
        C.pelvis.deductionPerDeg,
        C.weights.pelvisPosture,
        sev(pelvisRollStatus),
      ),
    });
  }

  const absTilt = Math.abs(f.pelvisTiltProxy);
  const pelvisTiltStatus = classify(
    absTilt,
    C.pelvis.tiltProxy.warn,
    C.pelvis.tiltProxy.fail,
  );
  if (pelvisTiltStatus !== "pass" || f.pelvisTiltZProxy > C.pelvis.tiltZProxy.warn) {
    const isBack = f.pelvisTiltZProxy > C.pelvis.tiltZProxy.warn;
    const statusUsed =
      pelvisTiltStatus === "pass" && isBack ? "warn" : pelvisTiltStatus;
    const message = isBack
      ? "骨盤が後傾している傾向があります。体幹がやや後ろに倒れて見え、見かけの開脚角度が狭く出ている可能性があります"
      : `体幹が約${absTilt.toFixed(0)}°傾いており、骨盤の向きに影響している可能性があります`;
    violations.push({
      ruleId: isBack ? "middle_split_pelvis_tilt_back" : "middle_split_pelvis_tilt",
      severity: sev(statusUsed),
      status: statusUsed,
      bodyPart: "骨盤",
      message,
      actual: isBack ? f.pelvisTiltZProxy : absTilt,
      ideal: 0,
      threshold: isBack
        ? { warn: C.pelvis.tiltZProxy.warn, fail: C.pelvis.tiltZProxy.fail }
        : { warn: C.pelvis.tiltProxy.warn, fail: C.pelvis.tiltProxy.fail },
      deviation: isBack ? f.pelvisTiltZProxy : absTilt,
      unit: isBack ? "ratio" : "deg",
      confidence: pelvisConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        isBack ? f.pelvisTiltZProxy : absTilt,
        isBack ? C.pelvis.zDeductionPerUnit : C.pelvis.deductionPerDeg,
        C.weights.pelvisPosture,
        sev(statusUsed),
      ),
    });
    suggestions.push(MIDDLE_SPLIT_ADVICE.pelvis);
  }

  const pelvisScore = Math.round(
    (scoreFromDeviation(f.pelvisRollAngle, C.pelvis.deductionPerDeg) +
      scoreFromDeviation(absTilt, C.pelvis.deductionPerDeg) +
      scoreFromDeviation(
        Math.max(0, f.pelvisTiltZProxy) * 100,
        C.pelvis.zDeductionPerUnit / 100,
      )) /
      3,
  );
  const pelvisBreakdown: ScoreBreakdown = {
    category: "pelvis_posture",
    label: "骨盤の向き",
    score: pelvisScore,
    weight: 0,
    violations: violations.filter((v) =>
      v.ruleId.startsWith("middle_split_pelvis"),
    ),
    measurements: {
      pelvisRollAngle: f.pelvisRollAngle,
      pelvisTiltProxy: f.pelvisTiltProxy,
      pelvisTiltZProxy: f.pelvisTiltZProxy,
    },
    frameRange,
  };

  // ---------- 3. Knee extension / leg line ----------
  const leftKneeDev = Math.max(0, C.kneeExtension.ideal - f.leftKneeExtension);
  const rightKneeDev = Math.max(0, C.kneeExtension.ideal - f.rightKneeExtension);

  const leftKneeStatus = classify(
    leftKneeDev,
    C.kneeExtension.warn,
    C.kneeExtension.fail,
  );
  if (leftKneeStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_knee_bend_left",
      severity: sev(leftKneeStatus),
      status: leftKneeStatus,
      bodyPart: "左膝",
      message: `左膝が曲がって代償している可能性があります（膝角度 ${f.leftKneeExtension.toFixed(0)}°）`,
      actual: f.leftKneeExtension,
      ideal: C.kneeExtension.ideal,
      threshold: { warn: C.kneeExtension.warn, fail: C.kneeExtension.fail },
      deviation: leftKneeDev,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        leftKneeDev,
        C.kneeExtension.deductionPerDeg,
        C.weights.kneeExtension,
        sev(leftKneeStatus),
      ),
    });
  }

  const rightKneeStatus = classify(
    rightKneeDev,
    C.kneeExtension.warn,
    C.kneeExtension.fail,
  );
  if (rightKneeStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_knee_bend_right",
      severity: sev(rightKneeStatus),
      status: rightKneeStatus,
      bodyPart: "右膝",
      message: `右膝が曲がって代償している可能性があります（膝角度 ${f.rightKneeExtension.toFixed(0)}°）`,
      actual: f.rightKneeExtension,
      ideal: C.kneeExtension.ideal,
      threshold: { warn: C.kneeExtension.warn, fail: C.kneeExtension.fail },
      deviation: rightKneeDev,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        rightKneeDev,
        C.kneeExtension.deductionPerDeg,
        C.weights.kneeExtension,
        sev(rightKneeStatus),
      ),
    });
  }

  if (leftKneeStatus !== "pass" || rightKneeStatus !== "pass") {
    suggestions.push(MIDDLE_SPLIT_ADVICE.knee);
  }

  // Leg line deviation (shape quality) — surfaced as minor warnings
  if (f.leftLegLineDeviation > C.kneeExtension.legLineDeviationWarn) {
    const statusUsed: "warn" | "fail" =
      f.leftLegLineDeviation > C.kneeExtension.legLineDeviationFail ? "fail" : "warn";
    violations.push({
      ruleId: "middle_split_leg_line_left",
      severity: sev(statusUsed),
      status: statusUsed,
      bodyPart: "左脚",
      message: "左脚のラインにズレが見られます（股関節〜膝〜足首の直線性）",
      actual: f.leftLegLineDeviation,
      ideal: 0,
      threshold: {
        warn: C.kneeExtension.legLineDeviationWarn,
        fail: C.kneeExtension.legLineDeviationFail,
      },
      deviation: f.leftLegLineDeviation,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.leftLegLineDeviation,
        C.kneeExtension.deductionPerDeg * 0.5,
        C.weights.kneeExtension,
        sev(statusUsed),
      ),
    });
  }
  if (f.rightLegLineDeviation > C.kneeExtension.legLineDeviationWarn) {
    const statusUsed: "warn" | "fail" =
      f.rightLegLineDeviation > C.kneeExtension.legLineDeviationFail ? "fail" : "warn";
    violations.push({
      ruleId: "middle_split_leg_line_right",
      severity: sev(statusUsed),
      status: statusUsed,
      bodyPart: "右脚",
      message: "右脚のラインにズレが見られます（股関節〜膝〜足首の直線性）",
      actual: f.rightLegLineDeviation,
      ideal: 0,
      threshold: {
        warn: C.kneeExtension.legLineDeviationWarn,
        fail: C.kneeExtension.legLineDeviationFail,
      },
      deviation: f.rightLegLineDeviation,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.rightLegLineDeviation,
        C.kneeExtension.deductionPerDeg * 0.5,
        C.weights.kneeExtension,
        sev(statusUsed),
      ),
    });
  }

  const kneeScore = Math.round(
    (scoreFromDeviation(leftKneeDev, C.kneeExtension.deductionPerDeg) +
      scoreFromDeviation(rightKneeDev, C.kneeExtension.deductionPerDeg) +
      scoreFromDeviation(
        f.leftLegLineDeviation,
        C.kneeExtension.deductionPerDeg * 0.5,
      ) +
      scoreFromDeviation(
        f.rightLegLineDeviation,
        C.kneeExtension.deductionPerDeg * 0.5,
      )) /
      4,
  );
  const kneeBreakdown: ScoreBreakdown = {
    category: "knee_extension",
    label: "膝の伸展",
    score: kneeScore,
    weight: 0,
    violations: violations.filter(
      (v) =>
        v.ruleId.startsWith("middle_split_knee_bend") ||
        v.ruleId.startsWith("middle_split_leg_line"),
    ),
    measurements: {
      leftKneeExtension: f.leftKneeExtension,
      rightKneeExtension: f.rightKneeExtension,
      leftLegLineDeviation: f.leftLegLineDeviation,
      rightLegLineDeviation: f.rightLegLineDeviation,
    },
    frameRange,
  };

  // ---------- 4. Symmetry ----------
  const legDiffStatus = classify(
    f.leftRightAngleDiff,
    C.symmetry.legAngleDiff.warn,
    C.symmetry.legAngleDiff.fail,
  );
  if (legDiffStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_asymmetry_leg_height",
      severity: sev(legDiffStatus),
      status: legDiffStatus,
      bodyPart: "脚",
      message: `左右の脚の高さに約${f.leftRightAngleDiff.toFixed(0)}°の差があります`,
      actual: f.leftRightAngleDiff,
      ideal: 0,
      threshold: {
        warn: C.symmetry.legAngleDiff.warn,
        fail: C.symmetry.legAngleDiff.fail,
      },
      deviation: f.leftRightAngleDiff,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.leftRightAngleDiff,
        C.symmetry.penaltyMultiplier,
        C.weights.symmetry,
        sev(legDiffStatus),
      ),
    });
    suggestions.push(MIDDLE_SPLIT_ADVICE.asymmetry);
  }

  const kneeDiffStatus = classify(
    f.kneeExtensionAsymmetry,
    C.symmetry.kneeExtensionDiff.warn,
    C.symmetry.kneeExtensionDiff.fail,
  );
  if (kneeDiffStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_asymmetry_knee",
      severity: sev(kneeDiffStatus),
      status: kneeDiffStatus,
      bodyPart: "膝",
      message: `左右の膝の伸び具合に約${f.kneeExtensionAsymmetry.toFixed(0)}°の差があります`,
      actual: f.kneeExtensionAsymmetry,
      ideal: 0,
      threshold: {
        warn: C.symmetry.kneeExtensionDiff.warn,
        fail: C.symmetry.kneeExtensionDiff.fail,
      },
      deviation: f.kneeExtensionAsymmetry,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.kneeExtensionAsymmetry,
        C.symmetry.penaltyMultiplier,
        C.weights.symmetry,
        sev(kneeDiffStatus),
      ),
    });
  }

  // Turnout asymmetry — non-scoring hint only (proxy reliability is low)
  if (f.turnoutAsymmetry >= C.turnoutHint.asymmetryWarn) {
    violations.push({
      ruleId: "middle_split_turnout_asymmetry",
      severity: "minor",
      status: "warn",
      bodyPart: "足先方向",
      message:
        "つま先方向から見て、片側で外旋依存が強い可能性があります（参考情報）",
      actual: f.turnoutAsymmetry,
      ideal: 0,
      threshold: { warn: C.turnoutHint.asymmetryWarn, fail: 99 },
      deviation: f.turnoutAsymmetry,
      unit: "deg",
      confidence: Math.max(0.3, baseConfidence * 0.7),
      context: { frameRange },
      scoreImpact: 0,
    });
  }

  const symmetryScore = Math.round(
    Math.max(
      0,
      100 -
        (f.leftRightAngleDiff + f.kneeExtensionAsymmetry) *
          C.symmetry.penaltyMultiplier,
    ),
  );
  const symmetryBreakdown: ScoreBreakdown = {
    category: "symmetry",
    label: "左右対称性",
    score: symmetryScore,
    weight: 0,
    violations: violations.filter((v) =>
      v.ruleId.startsWith("middle_split_asymmetry") ||
      v.ruleId === "middle_split_turnout_asymmetry",
    ),
    measurements: {
      leftRightAngleDiff: f.leftRightAngleDiff,
      kneeExtensionAsymmetry: f.kneeExtensionAsymmetry,
      turnoutAsymmetry: f.turnoutAsymmetry,
    },
    frameRange,
  };

  // ---------- 5. Trunk compensation ----------
  const trunkStatus = classify(
    f.trunkLeanAngle,
    C.trunk.leanAngle.warn,
    C.trunk.leanAngle.fail,
  );
  if (trunkStatus !== "pass") {
    violations.push({
      ruleId: "middle_split_trunk_lean",
      severity: sev(trunkStatus),
      status: trunkStatus,
      bodyPart: "体幹",
      message: `体幹が約${f.trunkLeanAngle.toFixed(0)}°傾いています（${directionLabel(f.trunkLeanDirection)}）`,
      actual: f.trunkLeanAngle,
      ideal: 0,
      threshold: {
        warn: C.trunk.leanAngle.warn,
        fail: C.trunk.leanAngle.fail,
      },
      deviation: f.trunkLeanAngle,
      unit: "deg",
      confidence: baseConfidence,
      context: { frameRange },
      scoreImpact: computeScoreImpact(
        f.trunkLeanAngle,
        C.trunk.deductionPerDeg,
        C.weights.trunkCompensation,
        sev(trunkStatus),
      ),
    });
    suggestions.push(MIDDLE_SPLIT_ADVICE.trunk);
  }
  const trunkScore = scoreFromDeviation(
    f.trunkLeanAngle,
    C.trunk.deductionPerDeg,
  );
  const trunkBreakdown: ScoreBreakdown = {
    category: "trunk_compensation",
    label: "体幹の代償",
    score: trunkScore,
    weight: 0,
    violations: violations.filter((v) => v.ruleId === "middle_split_trunk_lean"),
    measurements: {
      trunkLeanAngle: f.trunkLeanAngle,
    },
    frameRange,
  };

  // ---------- Assemble final score ----------
  const weights = C.weights;
  const breakdown: ScoreBreakdown[] = [
    { ...splitBreakdown, weight: weights.splitAngle },
    { ...pelvisBreakdown, weight: weights.pelvisPosture },
    { ...kneeBreakdown, weight: weights.kneeExtension },
    { ...symmetryBreakdown, weight: weights.symmetry },
    { ...trunkBreakdown, weight: weights.trunkCompensation },
  ];

  const finalScore = Math.round(
    breakdown.reduce((sum, b) => sum + b.score * b.weight, 0),
  );

  const coverageInfo = buildCoverageInfo(
    series,
    0,
    0,
    "静止画入力のため単一フレームを使用",
    sampling,
  );

  return {
    technique: "middle_split",
    finalScore,
    breakdown,
    violations: rankViolations(violations),
    events,
    suggestionsRaw: suggestions,
    meta: {
      analyzedFrameRange: frameRange,
      staticIntervalUsed: features.staticIntervals[0] ?? null,
      totalFrames: series.frames.length,
      configVersion: CONFIG_VERSION,
      evaluationMode: "hold",
      holdDuration: 0,
      holdRatio: 0,
      evaluationModeReason: "静止画入力のため単一フレームを評価",
      selectedReason: "静止画入力（1フレーム）",
      confidenceNote: `信頼度の目安: ${(baseConfidence * 100).toFixed(0)}% (正面視: ${(f.frontalityScore * 100).toFixed(0)}%, 骨格検出: ${(f.keyLandmarkVisibility * 100).toFixed(0)}%)`,
      coverageInfo,
    },
  };
}

function directionLabel(dir: MiddleSplitFeatures["trunkLeanDirection"]): string {
  switch (dir) {
    case "left": return "左方向";
    case "right": return "右方向";
    case "forward": return "前方向";
    case "back": return "後方向";
    default: return "—";
  }
}
