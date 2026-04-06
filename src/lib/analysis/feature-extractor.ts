import {
  NormalizedTimeSeries,
  NormalizedFrame,
  NormalizedLandmark,
  FeatureSet,
  FrameAngles,
  FrameCoG,
  FrameVelocity,
  StaticInterval,
  LM,
} from "./types";

// Body segment mass ratios for CoG calculation
const SEGMENT_MASS = {
  head: 0.081,
  trunk: 0.497,
  upperArm: 0.028,
  forearm: 0.016,
  hand: 0.006,
  thigh: 0.1,
  shank: 0.0465,
  foot: 0.0145,
} as const;

// Landmarks to track for velocity computation
const VELOCITY_LANDMARKS = [
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.NOSE,
];

import { STATIC_DETECTION } from "./config";

/**
 * Calculate angle between three points (in degrees)
 */
export function calcAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return Math.round(angle * 10) / 10;
}

/**
 * Extract complete feature set from normalized time series
 */
export function extractFeatures(series: NormalizedTimeSeries): FeatureSet {
  const angles = series.frames.map((f) => computeFrameAngles(f));
  const cog = series.frames.map((f) => computeFrameCoG(f));
  const velocities = computeVelocities(series);
  const staticIntervals = detectStaticIntervals(series, velocities);

  return {
    angles,
    cog,
    velocities,
    staticIntervals,
    frameCount: series.frames.length,
    duration: series.duration,
  };
}

function computeFrameAngles(frame: NormalizedFrame): FrameAngles {
  const lm = frame.landmarks;
  return {
    timestamp: frame.timestamp,
    leftShoulder: calcAngle(lm[LM.LEFT_HIP], lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW]),
    rightShoulder: calcAngle(lm[LM.RIGHT_HIP], lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW]),
    leftElbow: calcAngle(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW], lm[LM.LEFT_WRIST]),
    rightElbow: calcAngle(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW], lm[LM.RIGHT_WRIST]),
    leftHip: calcAngle(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE]),
    rightHip: calcAngle(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE]),
    leftKnee: calcAngle(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE]),
    rightKnee: calcAngle(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE]),
    spineAngle: computeSpineAngle(lm),
    hipAlignment: computeAlignment(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]),
    shoulderAlignment: computeAlignment(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]),
  };
}

function computeSpineAngle(lm: NormalizedLandmark[]): number {
  const shoulderMid: NormalizedLandmark = {
    x: (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2,
    y: (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2,
    z: 0,
    visibility: 1,
  };
  const hipMid: NormalizedLandmark = {
    x: (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2,
    y: (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2,
    z: 0,
    visibility: 1,
  };
  // Vertical reference: directly above hip midpoint
  const verticalRef: NormalizedLandmark = {
    ...hipMid,
    y: hipMid.y + 1, // up is positive in normalized coords
    z: 0,
    visibility: 1,
  };
  return calcAngle(verticalRef, hipMid, shoulderMid);
}

function computeAlignment(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.round(Math.atan2(dy, dx) * (180 / Math.PI) * 10) / 10;
}

function computeFrameCoG(frame: NormalizedFrame): FrameCoG {
  const lm = frame.landmarks;
  let totalX = 0;
  let totalY = 0;
  let totalMass = 0;

  // Head
  totalX += lm[LM.NOSE].x * SEGMENT_MASS.head;
  totalY += lm[LM.NOSE].y * SEGMENT_MASS.head;
  totalMass += SEGMENT_MASS.head;

  // Trunk
  const trunkX =
    (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x + lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 4;
  const trunkY =
    (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y + lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 4;
  totalX += trunkX * SEGMENT_MASS.trunk;
  totalY += trunkY * SEGMENT_MASS.trunk;
  totalMass += SEGMENT_MASS.trunk;

  // Arm segments
  const armSegs = [
    { a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW, mass: SEGMENT_MASS.upperArm },
    { a: LM.LEFT_ELBOW, b: LM.LEFT_WRIST, mass: SEGMENT_MASS.forearm + SEGMENT_MASS.hand },
    { a: LM.RIGHT_SHOULDER, b: LM.RIGHT_ELBOW, mass: SEGMENT_MASS.upperArm },
    { a: LM.RIGHT_ELBOW, b: LM.RIGHT_WRIST, mass: SEGMENT_MASS.forearm + SEGMENT_MASS.hand },
  ];
  for (const seg of armSegs) {
    const mx = (lm[seg.a].x + lm[seg.b].x) / 2;
    const my = (lm[seg.a].y + lm[seg.b].y) / 2;
    totalX += mx * seg.mass;
    totalY += my * seg.mass;
    totalMass += seg.mass;
  }

  // Leg segments
  const legSegs = [
    { a: LM.LEFT_HIP, b: LM.LEFT_KNEE, mass: SEGMENT_MASS.thigh },
    { a: LM.LEFT_KNEE, b: LM.LEFT_ANKLE, mass: SEGMENT_MASS.shank + SEGMENT_MASS.foot },
    { a: LM.RIGHT_HIP, b: LM.RIGHT_KNEE, mass: SEGMENT_MASS.thigh },
    { a: LM.RIGHT_KNEE, b: LM.RIGHT_ANKLE, mass: SEGMENT_MASS.shank + SEGMENT_MASS.foot },
  ];
  for (const seg of legSegs) {
    const mx = (lm[seg.a].x + lm[seg.b].x) / 2;
    const my = (lm[seg.a].y + lm[seg.b].y) / 2;
    totalX += mx * seg.mass;
    totalY += my * seg.mass;
    totalMass += seg.mass;
  }

  return {
    timestamp: frame.timestamp,
    x: totalX / totalMass,
    y: totalY / totalMass,
  };
}

function computeVelocities(
  series: NormalizedTimeSeries
): Map<number, FrameVelocity[]> {
  const result = new Map<number, FrameVelocity[]>();

  for (const lmIdx of VELOCITY_LANDMARKS) {
    const vels: FrameVelocity[] = [];

    for (let i = 1; i < series.frames.length; i++) {
      const prev = series.frames[i - 1];
      const curr = series.frames[i];
      const dt = curr.timestamp - prev.timestamp;
      if (dt <= 0) continue;

      const dx = curr.landmarks[lmIdx].x - prev.landmarks[lmIdx].x;
      const dy = curr.landmarks[lmIdx].y - prev.landmarks[lmIdx].y;

      vels.push({
        timestamp: curr.timestamp,
        landmarkIndex: lmIdx,
        vx: dx / dt,
        vy: dy / dt,
        speed: Math.sqrt(dx * dx + dy * dy) / dt,
      });
    }

    result.set(lmIdx, vels);
  }

  return result;
}

/**
 * Detect intervals where the body is approximately static.
 * Uses average speed of key landmarks.
 */
function detectStaticIntervals(
  series: NormalizedTimeSeries,
  velocities: Map<number, FrameVelocity[]>
): StaticInterval[] {
  if (series.frames.length < 2) {
    // Single frame → treat entire thing as a static interval
    if (series.frames.length === 1) {
      return [
        {
          startTime: series.frames[0].timestamp,
          endTime: series.frames[0].timestamp,
          startIndex: 0,
          endIndex: 0,
          avgMovement: 0,
        },
      ];
    }
    return [];
  }

  // Compute per-frame average speed across tracked landmarks
  const frameCount = series.frames.length;
  const avgSpeeds: number[] = new Array(frameCount).fill(0);

  for (const [, vels] of velocities) {
    for (const vel of vels) {
      // Find frame index by timestamp
      const idx = series.frames.findIndex((f) => f.timestamp === vel.timestamp);
      if (idx >= 0) {
        avgSpeeds[idx] += vel.speed / VELOCITY_LANDMARKS.length;
      }
    }
  }

  // Find contiguous regions below threshold
  const intervals: StaticInterval[] = [];
  let startIdx: number | null = null;

  for (let i = 0; i < frameCount; i++) {
    if (avgSpeeds[i] < STATIC_DETECTION.movementThreshold) {
      if (startIdx === null) startIdx = i;
    } else {
      if (startIdx !== null) {
        const endIdx = i - 1;
        const duration =
          series.frames[endIdx].timestamp - series.frames[startIdx].timestamp;
        if (duration >= STATIC_DETECTION.minDuration) {
          const avgMov =
            avgSpeeds
              .slice(startIdx, endIdx + 1)
              .reduce((a, b) => a + b, 0) / (endIdx - startIdx + 1);
          intervals.push({
            startTime: series.frames[startIdx].timestamp,
            endTime: series.frames[endIdx].timestamp,
            startIndex: startIdx,
            endIndex: endIdx,
            avgMovement: avgMov,
          });
        }
        startIdx = null;
      }
    }
  }

  // Handle trailing static interval
  if (startIdx !== null) {
    const endIdx = frameCount - 1;
    const duration =
      series.frames[endIdx].timestamp - series.frames[startIdx].timestamp;
    if (duration >= STATIC_DETECTION.minDuration || series.sourceType === "image") {
      const avgMov =
        avgSpeeds
          .slice(startIdx, endIdx + 1)
          .reduce((a, b) => a + b, 0) / (endIdx - startIdx + 1);
      intervals.push({
        startTime: series.frames[startIdx].timestamp,
        endTime: series.frames[endIdx].timestamp,
        startIndex: startIdx,
        endIndex: endIdx,
        avgMovement: avgMov,
      });
    }
  }

  return intervals;
}
