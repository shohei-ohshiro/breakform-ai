import {
  PoseTimeSeries,
  NormalizedTimeSeries,
  NormalizedFrame,
  NormalizedLandmark,
  LM,
  Viewpoint,
} from "./types";
import { Landmark } from "@/lib/types";

/**
 * Normalize pose landmarks:
 * - Origin: hip midpoint
 * - Scale: shoulder width = 1.0
 * - Y-axis: positive = up (flip from MediaPipe convention)
 */
export function normalizePoseTimeSeries(
  series: PoseTimeSeries
): NormalizedTimeSeries {
  const frames: NormalizedFrame[] = [];

  for (const frame of series.frames) {
    const normalized = normalizeFrame(frame.landmarks, frame.timestamp);
    if (normalized) {
      frames.push(normalized);
    }
  }

  return {
    frames,
    fps: series.fps,
    duration: series.duration,
    sourceType: series.sourceType,
  };
}

function normalizeFrame(
  landmarks: Landmark[],
  timestamp: number
): NormalizedFrame | null {
  if (landmarks.length < 33) return null;

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  // Hip midpoint as origin
  const originX = (lHip.x + rHip.x) / 2;
  const originY = (lHip.y + rHip.y) / 2;

  // Shoulder width as scale reference
  const shoulderWidth = Math.sqrt(
    (rShoulder.x - lShoulder.x) ** 2 + (rShoulder.y - lShoulder.y) ** 2
  );

  // Avoid division by zero
  if (shoulderWidth < 0.001) return null;

  const normalized: NormalizedLandmark[] = landmarks.map((lm) => ({
    x: (lm.x - originX) / shoulderWidth,
    y: -(lm.y - originY) / shoulderWidth, // flip Y so up is positive
    z: lm.z / shoulderWidth,
    visibility: lm.visibility,
  }));

  return {
    timestamp,
    landmarks: normalized,
    shoulderWidth,
  };
}

/**
 * Detect camera viewpoint from landmark positions.
 * Uses shoulder depth (z) difference and shoulder width ratio.
 */
export function detectViewpoint(landmarks: Landmark[]): Viewpoint {
  if (landmarks.length < 33) return "unknown";

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const nose = landmarks[LM.NOSE];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  // Low visibility = can't determine
  const avgVis =
    (lShoulder.visibility +
      rShoulder.visibility +
      nose.visibility +
      lHip.visibility +
      rHip.visibility) /
    5;
  if (avgVis < 0.3) return "unknown";

  // Shoulder width in XY plane
  const shoulderWidthXY = Math.sqrt(
    (rShoulder.x - lShoulder.x) ** 2 + (rShoulder.y - lShoulder.y) ** 2
  );

  // Shoulder depth difference (z)
  const shoulderDepthDiff = Math.abs(rShoulder.z - lShoulder.z);

  // If shoulders are very narrow in XY but have large depth difference → side view
  if (shoulderWidthXY < 0.08 || shoulderDepthDiff > shoulderWidthXY * 1.5) {
    return "side";
  }

  // Check if nose is above hips (normal) or below (inverted → could be top view)
  const hipMidY = (lHip.y + rHip.y) / 2;
  if (nose.y > hipMidY + 0.3) {
    // Nose is well below hips → might be inverted (handstand) viewed from top
    return "top";
  }

  // Check if nose is behind shoulders (z) → back view
  const shoulderMidZ = (lShoulder.z + rShoulder.z) / 2;
  if (nose.z > shoulderMidZ + 0.1) {
    return "back";
  }

  return "front";
}
