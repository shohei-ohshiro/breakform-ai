import { PoseTimeSeries, QualityCheckResult, TechniqueId, LM } from "./types";
import { QUALITY_THRESHOLDS } from "./config";

/** Key body landmarks that must be visible for analysis */
const KEY_LANDMARKS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

const Q = QUALITY_THRESHOLDS;

/**
 * Check the quality of extracted pose data.
 * Returns pass/fail, detailed metrics, retry recommendation, and reference-only flag.
 *
 * When `technique` is provided, applies technique-specific quality rules
 * in addition to universal checks.
 */
export function checkQuality(
  series: PoseTimeSeries,
  technique?: TechniqueId
): QualityCheckResult {
  const warnings: string[] = [];
  const failureReasons: string[] = [];
  const totalFrames = series.frames.length;
  const minFrames = series.sourceType === "image" ? Q.minFramesImage : Q.minFramesVideo;

  // --- Sufficient frames? ---
  const sufficientFrames = totalFrames >= minFrames;
  if (!sufficientFrames) {
    failureReasons.push(`フレーム数が不足 (${totalFrames}/${minFrames})`);
  }

  if (totalFrames === 0) {
    return {
      passed: false,
      overallScore: 0,
      details: {
        avgVisibility: 0,
        visibilityStdDev: 0,
        lowVisibilityFrames: 0,
        missingFrameRatio: 1,
        outOfFrameRatio: 1,
        sufficientFrames: false,
        subjectSize: 0,
        durationSufficient: false,
      },
      warnings: [],
      failureReasons: ["ポーズが検出されませんでした"],
      retryRecommended: true,
      analyzableAsReference: false,
    };
  }

  // --- Per-frame visibility stats ---
  const frameVisibilities: number[] = [];
  let lowVisFrames = 0;
  let outOfFrameFrames = 0;
  const shoulderWidths: number[] = [];

  for (const frame of series.frames) {
    const lm = frame.landmarks;

    let frameVis = 0;
    let outOfFrame = false;

    for (const idx of KEY_LANDMARKS) {
      if (idx >= lm.length) continue;
      frameVis += lm[idx].visibility;
      if (lm[idx].x < -0.1 || lm[idx].x > 1.1 || lm[idx].y < -0.1 || lm[idx].y > 1.1) {
        outOfFrame = true;
      }
    }

    frameVis /= KEY_LANDMARKS.length;
    frameVisibilities.push(frameVis);

    if (frameVis < Q.minVisibility) lowVisFrames++;
    if (outOfFrame) outOfFrameFrames++;

    // Subject size: shoulder width in raw coordinates
    if (lm.length > LM.RIGHT_SHOULDER) {
      const sw = Math.sqrt(
        (lm[LM.RIGHT_SHOULDER].x - lm[LM.LEFT_SHOULDER].x) ** 2 +
        (lm[LM.RIGHT_SHOULDER].y - lm[LM.LEFT_SHOULDER].y) ** 2
      );
      shoulderWidths.push(sw);
    }
  }

  const avgVisibility = frameVisibilities.reduce((a, b) => a + b, 0) / totalFrames;
  const lowVisRatio = lowVisFrames / totalFrames;
  const outOfFrameRatio = outOfFrameFrames / totalFrames;

  // --- Visibility stability (standard deviation) ---
  const visMean = avgVisibility;
  const visVariance = frameVisibilities.reduce((s, v) => s + (v - visMean) ** 2, 0) / totalFrames;
  const visibilityStdDev = Math.sqrt(visVariance);

  // --- Subject size ---
  const avgSubjectSize = shoulderWidths.length > 0
    ? shoulderWidths.reduce((a, b) => a + b, 0) / shoulderWidths.length
    : 0;

  // --- Duration check (technique-specific) ---
  const minDuration = technique === "swipes" ? Q.minDurationSwipes : 0;
  const durationSufficient = series.sourceType === "image" || series.duration >= minDuration;

  // --- Missing frame ratio ---
  const expectedFrames = series.sourceType === "video"
    ? Math.max(1, Math.floor(series.fps * series.duration))
    : 1;
  const missingFrameRatio = Math.max(0, 1 - totalFrames / expectedFrames);

  // --- Build warnings & failure reasons (universal) ---
  if (avgVisibility < Q.minVisibility) {
    failureReasons.push(`骨格検出精度が低い (visibility: ${(avgVisibility * 100).toFixed(0)}%)`);
  } else if (avgVisibility < 0.5) {
    warnings.push(`骨格検出精度がやや低い (visibility: ${(avgVisibility * 100).toFixed(0)}%)`);
  }

  if (visibilityStdDev > Q.maxVisibilityVariance) {
    warnings.push(`フレーム間でvisibilityが不安定 (σ=${visibilityStdDev.toFixed(2)})`);
  }

  if (lowVisRatio > Q.maxLowVisRatio) {
    warnings.push(`${(lowVisRatio * 100).toFixed(0)}%のフレームで骨格検出が不安定`);
  }

  if (outOfFrameRatio > Q.maxOutOfFrameRatio) {
    warnings.push("体の一部がフレーム外に出ているフレームが多い");
  }

  if (avgSubjectSize < Q.minSubjectSize && avgSubjectSize > 0) {
    warnings.push(`被写体が小さい (肩幅: フレームの${(avgSubjectSize * 100).toFixed(0)}%)。もう少し近くで撮影してください`);
  }

  if (!durationSufficient) {
    if (technique === "swipes") {
      failureReasons.push(`スワイプスには${Q.minDurationSwipes}秒以上の動画が必要です (現在: ${series.duration.toFixed(1)}秒)`);
    }
  }

  if (missingFrameRatio > 0.3) {
    warnings.push("一部の区間で骨格が検出できていない");
  }

  // --- Technique-specific quality rules ---
  if (technique) {
    applyTechniqueRules(technique, series, {
      avgVisibility, avgSubjectSize, totalFrames, outOfFrameRatio,
    }, warnings, failureReasons);
  }

  // --- Overall quality score ---
  const visScore = Math.min(1, avgVisibility / 0.7);
  const frameScore = sufficientFrames ? 1 : totalFrames / minFrames;
  const lowVisScore = 1 - lowVisRatio;
  const outScore = 1 - outOfFrameRatio;
  const sizeScore = Math.min(1, avgSubjectSize / Q.minSubjectSize);
  const stabilityScore = Math.max(0, 1 - visibilityStdDev / Q.maxVisibilityVariance);

  const overallScore =
    visScore * 0.25 +
    frameScore * 0.20 +
    lowVisScore * 0.15 +
    outScore * 0.15 +
    sizeScore * 0.10 +
    stabilityScore * 0.15;

  // --- Pass / retry / reference ---
  const hasCriticalFailure = failureReasons.length > 0;
  const passed = overallScore >= Q.qualityPassThreshold && sufficientFrames && !hasCriticalFailure;

  // analyzableAsReference: quality is borderline but we can still produce results
  const analyzableAsReference = !passed && overallScore >= 0.25 && totalFrames >= 1;
  const retryRecommended = !passed && !analyzableAsReference;

  return {
    passed,
    overallScore,
    details: {
      avgVisibility,
      visibilityStdDev,
      lowVisibilityFrames: lowVisFrames,
      missingFrameRatio,
      outOfFrameRatio,
      sufficientFrames,
      subjectSize: avgSubjectSize,
      durationSufficient,
    },
    warnings,
    failureReasons,
    retryRecommended,
    analyzableAsReference,
  };
}

// ---- Technique-specific quality rules ----

interface BasicMetrics {
  avgVisibility: number;
  avgSubjectSize: number;
  totalFrames: number;
  outOfFrameRatio: number;
}

function applyTechniqueRules(
  technique: TechniqueId,
  series: PoseTimeSeries,
  metrics: BasicMetrics,
  warnings: string[],
  failureReasons: string[]
): void {
  switch (technique) {
    case "handstand":
    case "planche":
      applyStaticTechniqueRules(technique, series, metrics, warnings, failureReasons);
      break;
    case "swipes":
      applySwipesRules(series, metrics, warnings, failureReasons);
      break;
    case "middle_split":
      applyMiddleSplitRules(series, warnings, failureReasons);
      break;
  }
}

/**
 * Static techniques (handstand, planche):
 * - Need full body visible (especially extremities)
 * - For video: need a stable hold interval ≥ 0.3s
 * - Subject must be large enough to detect joint angles
 */
function applyStaticTechniqueRules(
  technique: "handstand" | "planche",
  series: PoseTimeSeries,
  metrics: BasicMetrics,
  warnings: string[],
  failureReasons: string[]
): void {
  const techniqueName = technique === "handstand" ? "倒立" : "プランシェ";

  // Full body must be visible — ankles/wrists are critical
  if (series.sourceType === "video" && metrics.outOfFrameRatio > 0.3) {
    warnings.push(`${techniqueName}では全身がフレーム内に収まっている必要があります。カメラを引いて撮影してください`);
  }

  // Subject size for static techniques needs to be larger (joint angles need pixel resolution)
  const minStaticSubjectSize = 0.12;
  if (metrics.avgSubjectSize > 0 && metrics.avgSubjectSize < minStaticSubjectSize) {
    warnings.push(`${techniqueName}では被写体がやや小さいです。関節角度を正確に検出するために、もう少し近くで撮影してください`);
  }

  // For video: check if there's enough stable time
  if (series.sourceType === "video" && series.frames.length >= 3) {
    // Simple stability check: average inter-frame movement of key landmarks
    let stableFrameCount = 0;
    for (let i = 1; i < series.frames.length; i++) {
      const prev = series.frames[i - 1].landmarks;
      const curr = series.frames[i].landmarks;
      let totalMove = 0;
      const checkLandmarks = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
      for (const idx of checkLandmarks) {
        if (idx < prev.length && idx < curr.length) {
          totalMove += Math.abs(curr[idx].x - prev[idx].x) + Math.abs(curr[idx].y - prev[idx].y);
        }
      }
      const avgMove = totalMove / checkLandmarks.length;
      if (avgMove < 0.02) stableFrameCount++;
    }
    const stableRatio = stableFrameCount / (series.frames.length - 1);
    if (stableRatio < 0.2) {
      warnings.push(`${techniqueName}の静止区間が短いです。ホールド姿勢を長めにキープした動画だと精度が上がります`);
    }
  }
}

/**
 * Swipes (dynamic technique):
 * - Must be video (not image)
 * - Duration must be sufficient for at least one rotation
 * - Need enough frame rate to capture hand plants and leg swings
 * - Upper body landmarks especially important (hands drive detection)
 */
function applySwipesRules(
  series: PoseTimeSeries,
  metrics: BasicMetrics,
  warnings: string[],
  failureReasons: string[]
): void {
  // Image mode is not supported at all for swipes
  if (series.sourceType === "image") {
    failureReasons.push("スワイプスは動画での分析が必要です。写真では回転動作を評価できません");
    return;
  }

  // Need enough frames for event detection (hand plant transitions need ≥2 consecutive frames)
  if (metrics.totalFrames < 10) {
    warnings.push("フレーム数が少ないため、イベント検出精度が低い可能性があります。より長い動画でお試しください");
  }

  // Check effective FPS (if frames are too sparse, event detection fails)
  if (series.duration > 0) {
    const effectiveFps = metrics.totalFrames / series.duration;
    if (effectiveFps < 5) {
      warnings.push(`フレームレートが低い (${effectiveFps.toFixed(1)}fps)。手接地の検出が不安定になる可能性があります`);
    }
  }

  // Wrist visibility is critical for hand plant detection
  let lowWristVisCount = 0;
  for (const frame of series.frames) {
    const lm = frame.landmarks;
    if (lm.length > LM.RIGHT_WRIST) {
      const wristVis = (lm[LM.LEFT_WRIST].visibility + lm[LM.RIGHT_WRIST].visibility) / 2;
      if (wristVis < 0.3) lowWristVisCount++;
    }
  }
  const lowWristRatio = lowWristVisCount / metrics.totalFrames;
  if (lowWristRatio > 0.3) {
    warnings.push("手首の検出精度が低いフレームが多いです。手がはっきり映るアングルで撮影してください");
  }
}

/**
 * Middle split (static image):
 * - Front view recommended — detect via shoulder/hip z-spread.
 * - Both feet must be inside the frame (hip/knee/ankle/foot_index visibility).
 * - Pelvis region must be reasonably visible to trust proxies.
 */
function applyMiddleSplitRules(
  series: PoseTimeSeries,
  warnings: string[],
  failureReasons: string[]
): void {
  const frame = series.frames[0];
  if (!frame) return;
  const lm = frame.landmarks;
  if (lm.length < 33) return;

  const lHip = lm[LM.LEFT_HIP];
  const rHip = lm[LM.RIGHT_HIP];
  const lKnee = lm[LM.LEFT_KNEE];
  const rKnee = lm[LM.RIGHT_KNEE];
  const lAnkle = lm[LM.LEFT_ANKLE];
  const rAnkle = lm[LM.RIGHT_ANKLE];
  const lFoot = lm[LM.LEFT_FOOT_INDEX];
  const rFoot = lm[LM.RIGHT_FOOT_INDEX];
  const lSh = lm[LM.LEFT_SHOULDER];
  const rSh = lm[LM.RIGHT_SHOULDER];

  // --- Hip visibility ---
  const hipVis = (lHip.visibility + rHip.visibility) / 2;
  if (hipVis < 0.4) {
    failureReasons.push("骨盤付近の検出精度が極端に低いです。正面から骨盤がはっきり映るように撮影してください");
  } else if (hipVis < 0.6) {
    warnings.push("骨盤付近の検出がやや不安定です。タイトめの服装 or 正面からの撮影をおすすめします");
  }

  // --- Knee visibility ---
  const kneeVis = (lKnee.visibility + rKnee.visibility) / 2;
  if (kneeVis < 0.4) {
    warnings.push("膝の検出精度が低いため、膝の伸びや脚ラインの判定が不安定になる可能性があります");
  } else if (kneeVis < 0.6) {
    warnings.push("膝の検出がやや不安定です");
  }

  // --- Foot in frame (both feet required) ---
  const footInFrame = (foot: { x: number; y: number; visibility: number }) =>
    foot.visibility >= 0.3 &&
    foot.x >= -0.05 && foot.x <= 1.05 &&
    foot.y >= -0.05 && foot.y <= 1.05;

  const leftFootOk = footInFrame(lFoot) && footInFrame(lAnkle);
  const rightFootOk = footInFrame(rFoot) && footInFrame(rAnkle);

  if (!leftFootOk && !rightFootOk) {
    failureReasons.push("両足先がフレーム外です。カメラを引いて、両足のつま先までフレーム内に収めてください");
  } else if (!leftFootOk || !rightFootOk) {
    warnings.push(`${leftFootOk ? "右" : "左"}足のつま先がフレーム外か、検出できていません。両足先までフレーム内に収めてください`);
  }

  // --- Frontality check ---
  const shoulderZSpread = Math.abs(lSh.z - rSh.z);
  const hipZSpread = Math.abs(lHip.z - rHip.z);
  const frontality = Math.max(0, 1 - (shoulderZSpread + hipZSpread) * 2.5);
  if (frontality < 0.5) {
    warnings.push("正面から撮影されていない可能性があります。横開脚は正面視での計測をおすすめします");
  } else if (frontality < 0.7) {
    warnings.push("カメラアングルがやや斜めです。正面からまっすぐ撮影するとより正確な評価ができます");
  }
}
