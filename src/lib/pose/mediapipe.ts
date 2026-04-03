"use client";

import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Landmark } from "@/lib/types";

let poseLandmarker: PoseLandmarker | null = null;
let initPromise: Promise<PoseLandmarker> | null = null;

/**
 * Initialize MediaPipe PoseLandmarker (singleton)
 */
export async function initPoseLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarker) return poseLandmarker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    return poseLandmarker;
  })();

  return initPromise;
}

/**
 * Detect pose from an image element
 */
export async function detectPoseFromImage(
  imageElement: HTMLImageElement
): Promise<Landmark[] | null> {
  const landmarker = await initPoseLandmarker();
  const result = landmarker.detect(imageElement);

  if (!result.landmarks || result.landmarks.length === 0) {
    return null;
  }

  return result.landmarks[0].map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));
}

/**
 * Detect pose from a video frame
 */
export async function detectPoseFromVideo(
  videoElement: HTMLVideoElement,
  timestampMs: number
): Promise<Landmark[] | null> {
  const landmarker = await initPoseLandmarker();

  // Switch to VIDEO mode if needed
  if (landmarker.setOptions) {
    await landmarker.setOptions({ runningMode: "VIDEO" });
  }

  const result = landmarker.detectForVideo(videoElement, timestampMs);

  if (!result.landmarks || result.landmarks.length === 0) {
    return null;
  }

  return result.landmarks[0].map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));
}

/**
 * Extract key frames from a video for analysis
 */
export async function extractKeyFrames(
  videoElement: HTMLVideoElement,
  numFrames: number = 5
): Promise<{ timestamp: number; landmarks: Landmark[] }[]> {
  const landmarker = await initPoseLandmarker();
  await landmarker.setOptions({ runningMode: "VIDEO" });

  const duration = videoElement.duration;
  const interval = duration / (numFrames + 1);
  const frames: { timestamp: number; landmarks: Landmark[] }[] = [];

  for (let i = 1; i <= numFrames; i++) {
    const time = interval * i;
    videoElement.currentTime = time;

    await new Promise<void>((resolve) => {
      videoElement.onseeked = () => resolve();
    });

    const timestampMs = Math.round(time * 1000);
    const result = landmarker.detectForVideo(videoElement, timestampMs);

    if (result.landmarks && result.landmarks.length > 0) {
      frames.push({
        timestamp: time,
        landmarks: result.landmarks[0].map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
          visibility: lm.visibility ?? 0,
        })),
      });
    }
  }

  return frames;
}
