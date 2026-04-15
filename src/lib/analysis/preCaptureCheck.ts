/**
 * Lightweight client-side pre-capture quality check.
 *
 * Runs on a single detected frame *before* the user commits to a full
 * analysis, so we can warn them about obviously unusable shots (missing
 * body parts, bad angle, cropping) without spending a quota unit.
 *
 * Design notes
 * - Pure function over an already-detected `Landmark[]` + TechniqueId.
 * - Heuristics only — no feature extraction, no normalization, no network.
 * - Output shape mirrors `RetakeReason` so the UI can reuse styling.
 */

import { Landmark } from "@/lib/types";
import { LM, TechniqueId } from "./types";

export type PreCaptureSeverity = "info" | "warn" | "block";

export interface PreCaptureIssue {
  code:
    | "no_person"
    | "low_visibility"
    | "subject_too_small"
    | "image_cropped"
    | "not_frontal";
  severity: PreCaptureSeverity;
  message: string;
  howToFix: string;
}

export interface PreCaptureCheckResult {
  /** True when nothing at least `warn` severity was found. */
  passed: boolean;
  /** True when at least one `block` severity issue was found — UI should gate analyze. */
  blocked: boolean;
  issues: PreCaptureIssue[];
  /** Representative visibility average (for display). */
  avgVisibility: number;
}

const KEY_INDICES = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

export function runPreCaptureCheck(
  landmarks: Landmark[] | null,
  technique: TechniqueId,
): PreCaptureCheckResult {
  if (!landmarks || landmarks.length === 0) {
    return {
      passed: false,
      blocked: true,
      avgVisibility: 0,
      issues: [
        {
          code: "no_person",
          severity: "block",
          message: "人物を検出できませんでした",
          howToFix: "人物が画面内に全身で映る位置に立ち、もう一度撮影してください。",
        },
      ],
    };
  }

  const issues: PreCaptureIssue[] = [];

  // --- Visibility check on key landmarks ---
  const visSum = KEY_INDICES.reduce(
    (sum, idx) => sum + (landmarks[idx]?.visibility ?? 0),
    0,
  );
  const avgVisibility = visSum / KEY_INDICES.length;

  if (avgVisibility < 0.4) {
    issues.push({
      code: "low_visibility",
      severity: "block",
      message: `主要部位の検出精度が非常に低いです (${Math.round(avgVisibility * 100)}%)`,
      howToFix:
        "明るい場所で、体のラインがわかる服装で撮影し直してください。",
    });
  } else if (avgVisibility < 0.65) {
    issues.push({
      code: "low_visibility",
      severity: "warn",
      message: `検出精度がやや低めです (${Math.round(avgVisibility * 100)}%)`,
      howToFix:
        "照明や背景のコントラストを見直すと精度が上がる可能性があります。",
    });
  }

  // --- Subject size (shoulder-to-ankle vertical span) ---
  const lSh = landmarks[LM.LEFT_SHOULDER];
  const rSh = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lAn = landmarks[LM.LEFT_ANKLE];
  const rAn = landmarks[LM.RIGHT_ANKLE];

  if (lSh && rSh && lAn && rAn) {
    const shoulderY = (lSh.y + rSh.y) / 2;
    const ankleY = (lAn.y + rAn.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    if (bodyHeight < 0.25) {
      issues.push({
        code: "subject_too_small",
        severity: "warn",
        message: "被写体が小さく映っています",
        howToFix:
          "カメラの距離を少し縮めて、全身がちょうど収まる程度の大きさで撮影してください。",
      });
    }
  }

  // --- Cropping check: any key landmark outside [0.02, 0.98] ---
  let croppedCount = 0;
  for (const idx of KEY_INDICES) {
    const lm = landmarks[idx];
    if (!lm) continue;
    if (lm.x < 0.02 || lm.x > 0.98 || lm.y < 0.02 || lm.y > 0.98) {
      croppedCount++;
    }
  }
  if (croppedCount >= 2) {
    issues.push({
      code: "image_cropped",
      severity: "warn",
      message: "体の一部がフレーム外に出ている可能性があります",
      howToFix: "カメラを少し引いて、全身が画面内に収まるようにしてください。",
    });
  }

  // --- middle_split-specific: frontality heuristic ---
  if (technique === "middle_split" && lSh && rSh && lHip && rHip) {
    // When facing the camera, the shoulder and hip segments should span
    // meaningful horizontal width. If they collapse to nearly a point,
    // the subject is likely side-on.
    const shoulderWidth = Math.abs(lSh.x - rSh.x);
    const hipWidth = Math.abs(lHip.x - rHip.x);
    if (shoulderWidth < 0.06 && hipWidth < 0.06) {
      issues.push({
        code: "not_frontal",
        severity: "block",
        message: "横から撮影されている可能性が高いです",
        howToFix:
          "カメラを被写体のつま先側に置き、正面から撮影し直してください。",
      });
    } else if (shoulderWidth < 0.1 || hipWidth < 0.1) {
      issues.push({
        code: "not_frontal",
        severity: "warn",
        message: "正面向きが少しずれているかもしれません",
        howToFix:
          "カメラを被写体のつま先側にまっすぐ向けて構えるとより正確に評価できます。",
      });
    }
  }

  const blocked = issues.some((i) => i.severity === "block");
  const passed = issues.length === 0;
  return { passed, blocked, issues, avgVisibility };
}
