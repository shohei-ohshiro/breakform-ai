/**
 * Input classification for middle_split result UI.
 *
 * Single source of truth for "how should the result page treat this shot?".
 * Translates raw feature/quality signals into an actionable class the UI
 * uses to reorder layout, blur the score, or force a retake CTA.
 *
 * Kept independent of `QualityCheckResult` / `qualityLevel` on purpose:
 * those describe *how confident* we are in the numbers, while this classifies
 * *whether the input matches the analyzer's assumed capture conditions*.
 */

import {
  FeatureSet,
  InputClass,
  MiddleSplitFeatures,
  QualityCheckResult,
  RetakeReason,
  TechniqueId,
} from "./types";

export const CAPTURE_GUIDANCE_VERSION = "middle_split_capture_v1";

export interface ClassifyInputResult {
  class: InputClass;
  /** Ordered, dedup'd reasons the UI can surface directly. */
  reasons: RetakeReason[];
  /** Any signals that held the class back from `analyzable`. For debug. */
  signals: string[];
}

interface ClassifyInputArgs {
  technique: TechniqueId;
  features: FeatureSet | undefined;
  quality: QualityCheckResult;
  reliability: number;
}

/**
 * Classify a middle_split input. Non-middle_split techniques pass through as
 * `analyzable` with empty reasons for now.
 *
 * Thresholds here match the v1.1 UX design:
 * - frontality  < 0.4   → discouraged (strong side view)
 * - frontality  < 0.65  → reference   (slight angle)
 * - visibility  < 0.5   → discouraged
 * - visibility  < 0.7   → reference
 * - subjectSize < 0.08  → discouraged
 * - subjectSize < 0.15  → reference
 * - outOfFrame  > 0.25  → discouraged
 * - outOfFrame  > 0.1   → reference
 */
export function classifyInput(args: ClassifyInputArgs): ClassifyInputResult {
  const { technique, features, quality, reliability } = args;

  if (technique !== "middle_split") {
    return { class: "analyzable", reasons: [], signals: [] };
  }

  // When the pipeline has already decided the input is unrecoverable.
  if (!quality.passed && !quality.analyzableAsReference) {
    return {
      class: "blocked",
      signals: ["quality_unrecoverable"],
      reasons: [
        {
          code: "low_reliability",
          message: "全身が映る位置まで下がってください",
          howToFix:
            "骨格検出そのものが失敗しています。明るい場所で、足先まで全身が画面内に収まるよう撮影し直してください。",
        },
      ],
    };
  }

  const ms: MiddleSplitFeatures | undefined = features?.middleSplit;
  const signals: string[] = [];
  const reasons: RetakeReason[] = [];

  let level: 0 | 1 | 2 = 0; // 0 = analyzable, 1 = reference, 2 = discouraged

  if (ms) {
    if (ms.frontalityScore < 0.4) {
      level = Math.max(level, 2) as 0 | 1 | 2;
      signals.push("frontality<0.4");
      pushReason(reasons, {
        code: "low_frontality",
        message: "正面からまっすぐ撮ってください",
        howToFix:
          "カメラがかなり斜めになっています。被写体のつま先側にカメラを置き、正面から撮り直してください。",
      });
    } else if (ms.frontalityScore < 0.65) {
      level = Math.max(level, 1) as 0 | 1 | 2;
      signals.push("frontality<0.65");
      pushReason(reasons, {
        code: "low_frontality",
        message: "もう少し正面から撮ると精度が上がります",
        howToFix:
          "カメラの向きがやや斜めになっています。被写体のつま先側にまっすぐ構え直してください。",
      });
    }

    if (ms.keyLandmarkVisibility < 0.5) {
      level = Math.max(level, 2) as 0 | 1 | 2;
      signals.push("visibility<0.5");
      pushReason(reasons, {
        code: "landmark_missing",
        message: "全身が映る位置まで下がってください",
        howToFix:
          "骨盤から足先までの検出ができていません。画面内に全身（つま先まで）が収まる距離に下がって撮影し直してください。",
      });
    } else if (ms.keyLandmarkVisibility < 0.7) {
      level = Math.max(level, 1) as 0 | 1 | 2;
      signals.push("visibility<0.7");
      pushReason(reasons, {
        code: "low_visibility",
        message: "明るい場所で撮り直してください",
        howToFix:
          "骨格検出がやや弱い状態です。明るい場所で、体のラインが見える服装にすると精度が上がります。",
      });
    }
  }

  const d = quality.details;

  if (d.subjectSize > 0 && d.subjectSize < 0.08) {
    level = Math.max(level, 2) as 0 | 1 | 2;
    signals.push("subjectSize<0.08");
    pushReason(reasons, {
      code: "subject_too_small",
      message: "1〜2歩カメラに近づいてください",
      howToFix:
        "被写体がかなり小さく映っています。全身がちょうど収まる距離まで近づいてから撮影してください。",
    });
  } else if (d.subjectSize > 0 && d.subjectSize < 0.15) {
    level = Math.max(level, 1) as 0 | 1 | 2;
    signals.push("subjectSize<0.15");
    pushReason(reasons, {
      code: "subject_too_small",
      message: "少しカメラに近づいて撮ってください",
      howToFix:
        "被写体がやや小さく映っています。全身がちょうど画面いっぱいになる距離で撮影すると精度が上がります。",
    });
  }

  if (d.outOfFrameRatio > 0.25) {
    level = Math.max(level, 2) as 0 | 1 | 2;
    signals.push("outOfFrame>0.25");
    pushReason(reasons, {
      code: "image_cropped",
      message: "足先まで画面に入れてください",
      howToFix:
        "つま先や頭などが画面外に切れています。カメラを少し引いて、全身が完全に画面内に収まるように撮影し直してください。",
    });
  } else if (d.outOfFrameRatio > 0.1) {
    level = Math.max(level, 1) as 0 | 1 | 2;
    signals.push("outOfFrame>0.1");
    pushReason(reasons, {
      code: "image_cropped",
      message: "足先まで画面に入れてください",
      howToFix:
        "一部のフレームで足先が画面外に出ています。カメラを少し引いて構え直してください。",
    });
  }

  if (!d.sufficientFrames) {
    level = Math.max(level, 2) as 0 | 1 | 2;
    signals.push("insufficient_frames");
    pushReason(reasons, {
      code: "insufficient_frames",
      message: "静止した姿勢を2秒以上キープしてください",
      howToFix:
        "分析に使えるフレームが不足しています。開脚姿勢で2秒以上静止した動画を撮り直してください。",
    });
  }

  if (reliability < 0.4 && reasons.length === 0) {
    level = Math.max(level, 2) as 0 | 1 | 2;
    signals.push("reliability<0.4");
    pushReason(reasons, {
      code: "low_reliability",
      message: "もう一度条件を揃えて撮り直してください",
      howToFix:
        "複数の要因が重なって分析信頼度が大きく下がっています。明るい場所で、全身がはっきり映る条件を整えて撮り直してください。",
    });
  }

  const inputClass: InputClass =
    level === 0 ? "analyzable" : level === 1 ? "reference" : "discouraged";

  return { class: inputClass, reasons: sortReasons(reasons), signals };
}

/**
 * Priority order for displayed retake reasons. Lower index = higher priority.
 * Matches the UX v1.1 spec — specific crop/angle issues beat generic low-reliability.
 */
const REASON_PRIORITY: RetakeReason["code"][] = [
  "image_cropped",
  "low_frontality",
  "subject_too_small",
  "landmark_missing",
  "low_visibility",
  "short_hold",
  "insufficient_frames",
  "low_reliability",
];

function reasonRank(code: RetakeReason["code"]): number {
  const i = REASON_PRIORITY.indexOf(code);
  return i === -1 ? REASON_PRIORITY.length : i;
}

function pushReason(list: RetakeReason[], r: RetakeReason): void {
  // Dedup by code — later duplicate is ignored.
  if (list.some((x) => x.code === r.code)) return;
  list.push(r);
}

function sortReasons(list: RetakeReason[]): RetakeReason[] {
  // Drop low_reliability when another specific reason already exists.
  const hasSpecific = list.some((r) => r.code !== "low_reliability");
  const filtered = hasSpecific
    ? list.filter((r) => r.code !== "low_reliability")
    : list;
  return [...filtered].sort((a, b) => reasonRank(a.code) - reasonRank(b.code));
}
