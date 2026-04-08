"use client";

import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Landmark } from "@/lib/types";
import { TechniqueId, SamplingInfo, SamplingWindow, ExtractionDiagnostics } from "@/lib/analysis/types";

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

// ============================================
// Sampling Strategy
// ============================================

/** Compute how many coarse frames to extract based on duration and technique */
export function computeCoarseFrameCount(
  duration: number,
  technique: TechniqueId
): { count: number; fps: number } {
  let baseDensity: number;

  if (duration <= 3) {
    baseDensity = 10;
  } else if (duration <= 10) {
    baseDensity = 8;
  } else if (duration <= 30) {
    baseDensity = 5;
  } else {
    baseDensity = 3;
  }

  // Technique adjustment
  const techMultiplier = technique === "swipes" ? 1.2 : 1.0;
  baseDensity *= techMultiplier;

  const rawCount = Math.floor(duration * baseDensity);
  const minFrames = 10;
  const maxCoarse = 120;
  const count = Math.max(minFrames, Math.min(rawCount, maxCoarse));

  return { count, fps: count / duration };
}

/** Maximum additional frames for Phase B refinement */
const MAX_REFINE_FRAMES = 30;
/** FPS for Phase B refined extraction */
const REFINE_FPS = 15;
/** How many seconds to extend around a detected window */
const REFINE_PADDING = 0.5;

interface CoarseFrame {
  timestamp: number;
  landmarks: Landmark[];
}

/**
 * Identify interesting windows from coarse-sampled frames using
 * lightweight client-side heuristics.
 */
function findRefineWindows(
  coarseFrames: CoarseFrame[],
  duration: number,
  technique: TechniqueId
): SamplingWindow[] {
  if (coarseFrames.length < 3) return [];

  const windows: SamplingWindow[] = [];

  if (technique === "planche" || technique === "handstand") {
    // For static techniques: find region where body is most horizontal (planche)
    // or most vertical (handstand)
    const targetAngle = technique === "planche" ? 0 : 90; // Y-deviation target
    const scored = coarseFrames.map((f, i) => {
      const lm = f.landmarks;
      // Rough spine verticality: Y difference between shoulder mid and hip mid
      const shoulderMidY = (lm[11].y + lm[12].y) / 2;
      const hipMidY = (lm[23].y + lm[24].y) / 2;
      const ankleMidY = (lm[27].y + lm[28].y) / 2;
      // For planche: body horizontal means shoulder, hip, ankle Y are similar
      // For handstand: body vertical means large Y difference
      const ySpread = Math.max(shoulderMidY, hipMidY, ankleMidY) - Math.min(shoulderMidY, hipMidY, ankleMidY);
      const score = technique === "planche"
        ? ySpread  // lower = more horizontal
        : -ySpread; // lower = more vertical (invert)
      return { index: i, timestamp: f.timestamp, score };
    });

    // Find the best region (lowest score)
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];
    if (best) {
      const start = Math.max(0, best.timestamp - REFINE_PADDING);
      const end = Math.min(duration, best.timestamp + REFINE_PADDING);
      // Check if this window is worth refining (not already dense enough)
      const existingInWindow = coarseFrames.filter(
        f => f.timestamp >= start && f.timestamp <= end
      ).length;
      const potentialFrames = Math.floor((end - start) * REFINE_FPS);
      if (potentialFrames > existingInWindow + 2) {
        windows.push({
          startTime: start,
          endTime: end,
          reason: technique === "planche" ? "most_horizontal" : "most_vertical",
          framesExtracted: 0, // filled after extraction
        });
      }
    }

    // Also find static (hold) regions: consecutive frames with low movement
    const holdWindow = findStaticWindow(coarseFrames, duration);
    if (holdWindow && !windowsOverlap(windows, holdWindow)) {
      windows.push(holdWindow);
    }
  } else if (technique === "swipes") {
    // For dynamic techniques: find regions with highest movement
    const movementScores: { index: number; timestamp: number; movement: number }[] = [];
    for (let i = 1; i < coarseFrames.length; i++) {
      const prev = coarseFrames[i - 1].landmarks;
      const curr = coarseFrames[i].landmarks;
      let totalMove = 0;
      // Check wrists and ankles
      for (const idx of [15, 16, 27, 28]) {
        if (idx < prev.length && idx < curr.length) {
          totalMove += Math.abs(curr[idx].x - prev[idx].x) + Math.abs(curr[idx].y - prev[idx].y);
        }
      }
      movementScores.push({
        index: i,
        timestamp: coarseFrames[i].timestamp,
        movement: totalMove,
      });
    }

    // Find peak movement region
    movementScores.sort((a, b) => b.movement - a.movement);
    if (movementScores.length > 0) {
      const peak = movementScores[0];
      const start = Math.max(0, peak.timestamp - 1.0);
      const end = Math.min(duration, peak.timestamp + 1.0);
      const existingInWindow = coarseFrames.filter(
        f => f.timestamp >= start && f.timestamp <= end
      ).length;
      const potentialFrames = Math.floor((end - start) * REFINE_FPS);
      if (potentialFrames > existingInWindow + 2) {
        windows.push({
          startTime: start,
          endTime: end,
          reason: "high_movement",
          framesExtracted: 0,
        });
      }
    }
  }

  return windows;
}

/** Find a window where consecutive frames have minimal landmark movement */
function findStaticWindow(
  frames: CoarseFrame[],
  duration: number
): SamplingWindow | null {
  if (frames.length < 3) return null;

  let bestStart = 0;
  let bestLen = 0;
  let bestAvgMove = Infinity;
  let curStart = 0;
  let curLen = 1;
  let curTotalMove = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].landmarks;
    const curr = frames[i].landmarks;
    let move = 0;
    for (const idx of [11, 12, 23, 24, 27, 28]) {
      if (idx < prev.length && idx < curr.length) {
        move += Math.abs(curr[idx].x - prev[idx].x) + Math.abs(curr[idx].y - prev[idx].y);
      }
    }
    move /= 6;

    if (move < 0.02) {
      curLen++;
      curTotalMove += move;
    } else {
      if (curLen >= 3) {
        const avgMove = curTotalMove / (curLen - 1);
        if (curLen > bestLen || (curLen === bestLen && avgMove < bestAvgMove)) {
          bestStart = curStart;
          bestLen = curLen;
          bestAvgMove = avgMove;
        }
      }
      curStart = i;
      curLen = 1;
      curTotalMove = 0;
    }
  }

  // Check trailing window
  if (curLen >= 3) {
    const avgMove = curTotalMove / (curLen - 1);
    if (curLen > bestLen || (curLen === bestLen && avgMove < bestAvgMove)) {
      bestStart = curStart;
      bestLen = curLen;
    }
  }

  if (bestLen < 3) return null;

  const start = Math.max(0, frames[bestStart].timestamp - REFINE_PADDING);
  const end = Math.min(duration, frames[Math.min(bestStart + bestLen - 1, frames.length - 1)].timestamp + REFINE_PADDING);

  return {
    startTime: start,
    endTime: end,
    reason: "static_hold",
    framesExtracted: 0,
  };
}

function windowsOverlap(existing: SamplingWindow[], candidate: SamplingWindow): boolean {
  return existing.some(
    w => w.startTime < candidate.endTime && w.endTime > candidate.startTime
  );
}

/** Seek timeout in ms — generous to handle slow mobile decoding */
const SEEK_TIMEOUT_MS = 5000;

/**
 * Robustly seek a video to a given time and wait for completion.
 * Sets the handler BEFORE changing currentTime to avoid race conditions.
 * Returns false if seek timed out.
 */
async function seekTo(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      video.onseeked = null;
      resolve(false);
    }, SEEK_TIMEOUT_MS);

    video.onseeked = () => {
      clearTimeout(timeout);
      video.onseeked = null;
      resolve(true);
    };

    video.currentTime = time;
  });
}

interface ExtractWindowResult {
  frames: CoarseFrame[];
  timestamps: number[];
  seekTimeouts: number;
}

/** Extract frames from a specific time window at given FPS */
async function extractWindow(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  startTime: number,
  endTime: number,
  fps: number,
  existingTimestamps: Set<number>,
  maxFrames: number
): Promise<ExtractWindowResult> {
  const interval = 1 / fps;
  const frames: CoarseFrame[] = [];
  const timestamps: number[] = [];
  let seekTimeouts = 0;
  let t = startTime;

  while (t <= endTime && frames.length < maxFrames) {
    // Skip timestamps already covered by coarse pass (within 0.03s tolerance)
    const roundedT = Math.round(t * 1000);
    let alreadyExists = false;
    for (const existing of existingTimestamps) {
      if (Math.abs(existing - roundedT) < 30) {
        alreadyExists = true;
        break;
      }
    }

    if (!alreadyExists && t < video.duration) {
      const seekOk = await seekTo(video, t);
      if (!seekOk) {
        seekTimeouts++;
        t += interval;
        continue;
      }

      const timestampMs = Math.round(t * 1000);
      const result = landmarker.detectForVideo(video, timestampMs);

      if (result.landmarks && result.landmarks.length > 0) {
        frames.push({
          timestamp: t,
          landmarks: toLandmarks(result.landmarks[0]),
        });
        timestamps.push(t);
      }
    }

    t += interval;
  }

  return { frames, timestamps, seekTimeouts };
}

export interface ExtractionResult {
  frames: { timestamp: number; landmarks: Landmark[] }[];
  sampling: SamplingInfo;
}

/**
 * Extract pose time series from a video with adaptive two-phase sampling.
 *
 * Phase A: Coarse sampling across the FULL video duration.
 * Phase B: Re-extract interesting windows at higher density.
 *
 * @param video - The HTMLVideoElement (must have metadata loaded)
 * @param technique - The technique being analyzed (affects sampling density)
 * @param nativeFps - Estimated native FPS of the video (default: 30)
 * @param onProgress - Optional callback (completedFrames, totalFrames, phase, currentTime)
 */
export async function extractPoseTimeSeries(
  video: HTMLVideoElement,
  technique: TechniqueId = "handstand",
  nativeFps: number = 30,
  onProgress?: (completed: number, total: number, phase?: string, currentTime?: number) => void,
): Promise<ExtractionResult> {
  const landmarker = await initVideoLandmarker();

  const duration = video.duration;
  const estimatedOriginalFrames = Math.round(duration * nativeFps);

  // Phase A: Coarse sampling across entire video
  const { count: coarseCount, fps: coarseFps } = computeCoarseFrameCount(duration, technique);
  const coarseInterval = duration / coarseCount;

  const coarseFrames: CoarseFrame[] = [];
  const coarseTimestampList: number[] = [];
  let totalSeekTimeouts = 0;
  const coarseStartWall = Date.now();

  for (let i = 0; i < coarseCount; i++) {
    const time = i * coarseInterval;
    if (time >= duration) break;

    const seekOk = await seekTo(video, time);
    if (!seekOk) {
      totalSeekTimeouts++;
      if (onProgress) {
        onProgress(i + 1, coarseCount, "coarse", time);
      }
      continue;
    }

    const timestampMs = Math.round(time * 1000);
    const result = landmarker.detectForVideo(video, timestampMs);

    if (result.landmarks && result.landmarks.length > 0) {
      coarseFrames.push({
        timestamp: time,
        landmarks: toLandmarks(result.landmarks[0]),
      });
      coarseTimestampList.push(time);
    }

    if (onProgress) {
      onProgress(i + 1, coarseCount, "coarse", time);
    }
  }
  const coarseEndWall = Date.now();

  // Phase B: Identify and refine interesting windows
  const refineWindows = findRefineWindows(coarseFrames, duration, technique);
  const existingTimestamps = new Set(
    coarseFrames.map(f => Math.round(f.timestamp * 1000))
  );

  let refinedFrames: CoarseFrame[] = [];
  let refinedTotal = 0;
  const refinedTimestampList: number[] = [];
  const completedWindows: SamplingWindow[] = [];
  const refineStartWall = Date.now();

  if (refineWindows.length > 0) {
    // Budget refinement frames across windows
    const budgetPerWindow = Math.floor(MAX_REFINE_FRAMES / refineWindows.length);

    for (const window of refineWindows) {
      if (onProgress) {
        onProgress(0, budgetPerWindow, `refine:${window.reason}`, window.startTime);
      }

      const windowResult = await extractWindow(
        video,
        landmarker,
        window.startTime,
        window.endTime,
        REFINE_FPS,
        existingTimestamps,
        budgetPerWindow
      );

      // Add new timestamps to existing set
      for (const f of windowResult.frames) {
        existingTimestamps.add(Math.round(f.timestamp * 1000));
      }

      refinedFrames = refinedFrames.concat(windowResult.frames);
      refinedTimestampList.push(...windowResult.timestamps);
      refinedTotal += windowResult.frames.length;
      totalSeekTimeouts += windowResult.seekTimeouts;

      completedWindows.push({
        ...window,
        framesExtracted: windowResult.frames.length,
      });

      if (onProgress) {
        onProgress(windowResult.frames.length, budgetPerWindow, `refine:${window.reason}`, window.endTime);
      }
    }
  }
  const refineEndWall = Date.now();

  // Merge and sort all frames by timestamp
  const allFrames = [...coarseFrames, ...refinedFrames].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  // Compute actual coverage from coarse frames
  const coverageStartTime = coarseTimestampList.length > 0 ? Math.min(...coarseTimestampList) : 0;
  const coverageEndTime = coarseTimestampList.length > 0 ? Math.max(...coarseTimestampList) : duration;
  const coveredDuration = coverageEndTime - coverageStartTime;
  const coveredDurationRatio = duration > 0 ? Math.min(1.0, coveredDuration / duration) : 1.0;

  // Build extraction diagnostics
  const allExtractedTimestamps = [...coarseTimestampList, ...refinedTimestampList].sort((a, b) => a - b);
  const firstExtractedTime = allExtractedTimestamps.length > 0 ? allExtractedTimestamps[0] : 0;
  const lastExtractedTime = allExtractedTimestamps.length > 0 ? allExtractedTimestamps[allExtractedTimestamps.length - 1] : 0;

  const extractionDiagnostics: ExtractionDiagnostics = {
    coarseFrameTimestamps: coarseTimestampList,
    refinedFrameTimestamps: refinedTimestampList,
    firstExtractedTime,
    lastExtractedTime,
    extractedFrameCount: allExtractedTimestamps.length,
    videoDuration: duration,
    durationCoverageRatio: duration > 0 ? lastExtractedTime / duration : 1.0,
    seekTimeouts: totalSeekTimeouts,
    coarseExtractionTimeMs: coarseEndWall - coarseStartWall,
    refineExtractionTimeMs: refineEndWall - refineStartWall,
  };

  const sampling: SamplingInfo = {
    estimatedOriginalFrames,
    sampledFramesCount: allFrames.length,
    coarseSampleCount: coarseFrames.length,
    refinedSampleCount: refinedTotal,
    samplingStrategy: refinedTotal > 0 ? "full_scan_then_refine" : "uniform",
    selectedWindows: completedWindows,
    coarseFps,
    refinedFps: refinedTotal > 0 ? REFINE_FPS : null,
    videoDuration: duration,
    coverageStartTime,
    coverageEndTime,
    coveredDurationRatio,
    extractionDiagnostics,
  };

  return { frames: allFrames, sampling };
}
