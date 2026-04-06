"use client";

import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Landmark } from "@/lib/types";

let poseLandmarkerImage: PoseLandmarker | null = null;
let poseLandmarkerVideo: PoseLandmarker | null = null;
let initImagePromise: Promise<PoseLandmarker> | null = null;
let initVideoPromise: Promise<PoseLandmarker> | null = null;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

/**
 * Initialize MediaPipe PoseLandmarker for IMAGE mode (singleton)
 */
async function initImageLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarkerImage) return poseLandmarkerImage;
  if (initImagePromise) return initImagePromise;

  initImagePromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarkerImage = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return poseLandmarkerImage;
  })();

  return initImagePromise;
}

/**
 * Initialize MediaPipe PoseLandmarker for VIDEO mode (singleton)
 */
async function initVideoLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarkerVideo) return poseLandmarkerVideo;
  if (initVideoPromise) return initVideoPromise;

  initVideoPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarkerVideo = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return poseLandmarkerVideo;
  })();

  return initVideoPromise;
}

function toLandmarks(
  rawLandmarks: { x: number; y: number; z: number; visibility?: number }[]
): Landmark[] {
  return rawLandmarks.map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));
}

/**
 * Detect pose from an image element
 */
export async function detectPoseFromImage(
  imageElement: HTMLImageElement
): Promise<Landmark[] | null> {
  const landmarker = await initImageLandmarker();
  const result = landmarker.detect(imageElement);

  if (!result.landmarks || result.landmarks.length === 0) {
    return null;
  }

  return toLandmarks(result.landmarks[0]);
}

/**
 * Extract pose time series from a video at a given FPS.
 * Returns an array of { timestamp, landmarks } for each successfully detected frame.
 *
 * @param video - The HTMLVideoElement (must have metadata loaded)
 * @param targetFps - Target frames per second to sample (default: 10)
 * @param onProgress - Optional callback (completedFrames, totalFrames)
 * @param maxFrames - Maximum number of frames to extract (default: 50)
 */
export async function extractPoseTimeSeries(
  video: HTMLVideoElement,
  targetFps: number = 10,
  onProgress?: (completed: number, total: number) => void,
  maxFrames: number = 50
): Promise<{ timestamp: number; landmarks: Landmark[] }[]> {
  const landmarker = await initVideoLandmarker();

  const duration = video.duration;
  const interval = 1 / targetFps;
  const totalFrames = Math.min(
    Math.floor(duration * targetFps),
    maxFrames
  );

  const frames: { timestamp: number; landmarks: Landmark[] }[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;
    if (time >= duration) break;

    video.currentTime = time;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const timestampMs = Math.round(time * 1000);
    const result = landmarker.detectForVideo(video, timestampMs);

    if (result.landmarks && result.landmarks.length > 0) {
      frames.push({
        timestamp: time,
        landmarks: toLandmarks(result.landmarks[0]),
      });
    }

    if (onProgress) {
      onProgress(i + 1, totalFrames);
    }
  }

  return frames;
}
