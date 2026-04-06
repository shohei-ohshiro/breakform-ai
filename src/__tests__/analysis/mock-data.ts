import { Landmark } from "@/lib/types";
import { PoseFrame, PoseTimeSeries, LM } from "@/lib/analysis/types";

/**
 * Generate a set of 33 landmarks for a roughly upright standing pose.
 * Coordinates in [0,1] range (MediaPipe convention, Y-down).
 */
export function makeStandingLandmarks(): Landmark[] {
  const lm: Landmark[] = new Array(33).fill(null).map(() => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));

  // Head
  lm[LM.NOSE] = { x: 0.5, y: 0.15, z: 0, visibility: 0.95 };
  lm[LM.LEFT_EAR] = { x: 0.47, y: 0.13, z: 0.02, visibility: 0.8 };
  lm[LM.RIGHT_EAR] = { x: 0.53, y: 0.13, z: 0.02, visibility: 0.8 };

  // Shoulders
  lm[LM.LEFT_SHOULDER] = { x: 0.42, y: 0.28, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.58, y: 0.28, z: 0, visibility: 0.95 };

  // Elbows
  lm[LM.LEFT_ELBOW] = { x: 0.38, y: 0.42, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ELBOW] = { x: 0.62, y: 0.42, z: 0, visibility: 0.9 };

  // Wrists
  lm[LM.LEFT_WRIST] = { x: 0.36, y: 0.55, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_WRIST] = { x: 0.64, y: 0.55, z: 0, visibility: 0.9 };

  // Hips
  lm[LM.LEFT_HIP] = { x: 0.45, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HIP] = { x: 0.55, y: 0.55, z: 0, visibility: 0.95 };

  // Knees
  lm[LM.LEFT_KNEE] = { x: 0.44, y: 0.72, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_KNEE] = { x: 0.56, y: 0.72, z: 0, visibility: 0.9 };

  // Ankles
  lm[LM.LEFT_ANKLE] = { x: 0.43, y: 0.90, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ANKLE] = { x: 0.57, y: 0.90, z: 0, visibility: 0.9 };

  return lm;
}

/**
 * Generate a roughly "good" handstand pose.
 * Body inverted: hands at bottom, feet at top. Y-down convention.
 */
export function makeHandstandLandmarks(): Landmark[] {
  const lm: Landmark[] = new Array(33).fill(null).map(() => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));

  // Inverted: wrists at bottom, nose at top area
  lm[LM.LEFT_WRIST] = { x: 0.45, y: 0.88, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_WRIST] = { x: 0.55, y: 0.88, z: 0, visibility: 0.9 };

  lm[LM.LEFT_ELBOW] = { x: 0.44, y: 0.78, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ELBOW] = { x: 0.56, y: 0.78, z: 0, visibility: 0.9 };

  lm[LM.LEFT_SHOULDER] = { x: 0.43, y: 0.65, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.57, y: 0.65, z: 0, visibility: 0.95 };

  lm[LM.LEFT_HIP] = { x: 0.45, y: 0.40, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HIP] = { x: 0.55, y: 0.40, z: 0, visibility: 0.95 };

  lm[LM.LEFT_KNEE] = { x: 0.45, y: 0.22, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_KNEE] = { x: 0.55, y: 0.22, z: 0, visibility: 0.9 };

  lm[LM.LEFT_ANKLE] = { x: 0.45, y: 0.05, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ANKLE] = { x: 0.55, y: 0.05, z: 0, visibility: 0.9 };

  lm[LM.NOSE] = { x: 0.5, y: 0.72, z: 0, visibility: 0.9 };
  lm[LM.LEFT_EAR] = { x: 0.47, y: 0.70, z: 0.02, visibility: 0.8 };
  lm[LM.RIGHT_EAR] = { x: 0.53, y: 0.70, z: 0.02, visibility: 0.8 };

  return lm;
}

/**
 * Generate a roughly "good" planche pose.
 * Horizontal body, hands on ground (bottom), body level.
 */
export function makePlancheLandmarks(): Landmark[] {
  const lm: Landmark[] = new Array(33).fill(null).map(() => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));

  // Hands (support) at center-left
  lm[LM.LEFT_WRIST] = { x: 0.35, y: 0.60, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_WRIST] = { x: 0.45, y: 0.60, z: 0, visibility: 0.9 };

  lm[LM.LEFT_ELBOW] = { x: 0.35, y: 0.55, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ELBOW] = { x: 0.45, y: 0.55, z: 0, visibility: 0.9 };

  // Shoulders forward of hands
  lm[LM.LEFT_SHOULDER] = { x: 0.38, y: 0.50, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.48, y: 0.50, z: 0, visibility: 0.95 };

  // Body horizontal
  lm[LM.LEFT_HIP] = { x: 0.55, y: 0.50, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HIP] = { x: 0.65, y: 0.50, z: 0, visibility: 0.95 };

  lm[LM.LEFT_KNEE] = { x: 0.70, y: 0.50, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_KNEE] = { x: 0.80, y: 0.50, z: 0, visibility: 0.9 };

  lm[LM.LEFT_ANKLE] = { x: 0.85, y: 0.50, z: 0, visibility: 0.9 };
  lm[LM.RIGHT_ANKLE] = { x: 0.95, y: 0.50, z: 0, visibility: 0.9 };

  lm[LM.NOSE] = { x: 0.40, y: 0.45, z: 0, visibility: 0.9 };
  lm[LM.LEFT_EAR] = { x: 0.38, y: 0.44, z: 0.02, visibility: 0.8 };
  lm[LM.RIGHT_EAR] = { x: 0.42, y: 0.44, z: 0.02, visibility: 0.8 };

  return lm;
}

/** Create a PoseTimeSeries from a single landmarks set (image mode) */
export function makeImageSeries(landmarks: Landmark[]): PoseTimeSeries {
  return {
    frames: [{ timestamp: 0, landmarks }],
    fps: 1,
    duration: 0,
    sourceType: "image",
  };
}

/** Create a video PoseTimeSeries by repeating landmarks with small jitter */
export function makeVideoSeries(
  landmarks: Landmark[],
  frameCount: number = 15,
  fps: number = 10
): PoseTimeSeries {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const jitteredLandmarks = landmarks.map((lm) => ({
      ...lm,
      x: lm.x + (Math.random() - 0.5) * 0.001,
      y: lm.y + (Math.random() - 0.5) * 0.001,
    }));
    frames.push({
      timestamp: i / fps,
      landmarks: jitteredLandmarks,
    });
  }
  return {
    frames,
    fps,
    duration: frameCount / fps,
    sourceType: "video",
  };
}
