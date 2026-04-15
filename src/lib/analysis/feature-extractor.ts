import {
  NormalizedTimeSeries,
  NormalizedFrame,
  NormalizedLandmark,
  FeatureSet,
  FrameAngles,
  FrameCoG,
  FrameVelocity,
  StaticInterval,
  MiddleSplitFeatures,
  TechniqueId,
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
 * Extract complete feature set from normalized time series.
 * When `technique` is provided, technique-specific features are also computed.
 */
export function extractFeatures(
  series: NormalizedTimeSeries,
  technique?: TechniqueId,
): FeatureSet {
  const angles = series.frames.map((f) => computeFrameAngles(f));
  const cog = series.frames.map((f) => computeFrameCoG(f));
  const velocities = computeVelocities(series);
  const staticIntervals = detectStaticIntervals(series, velocities);

  const base: FeatureSet = {
    angles,
    cog,
    velocities,
    staticIntervals,
    frameCount: series.frames.length,
    duration: series.duration,
  };

  if (technique === "middle_split" && series.frames.length > 0) {
    base.middleSplit = computeMiddleSplitFeatures(series.frames[0], angles[0]);
  }

  return base;
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

// ---------------------------------------------------------------------------
// Middle split feature extraction
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI;

/** Angle between two 2D vectors, in degrees [0, 180]. */
function angleBetween2D(
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const aMag = Math.hypot(ax, ay);
  const bMag = Math.hypot(bx, by);
  if (aMag < 1e-6 || bMag < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aMag * bMag)));
  return Math.acos(cos) * RAD_TO_DEG;
}

/** Angle of a vector from horizontal (positive x-axis), in degrees [0, 90]. */
function elevationFromHorizon(dx: number, dy: number): number {
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return 0;
  return Math.abs(Math.atan2(dy, Math.abs(dx))) * RAD_TO_DEG;
}

/** Line(hip-knee-ankle) deviation from 180° (a straight line). */
function legLineDeviation(
  hip: NormalizedLandmark,
  knee: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  const a = calcAngle(hip, knee, ankle);
  return Math.abs(180 - a);
}

/**
 * Compute middle split specific features from a single normalized frame.
 *
 * Coordinate system reminder:
 *   Origin = hip midpoint, scale = shoulder width, Y-axis positive = UP.
 */
export function computeMiddleSplitFeatures(
  frame: NormalizedFrame,
  frameAngles: FrameAngles,
): MiddleSplitFeatures {
  const lm = frame.landmarks;

  const lHip = lm[LM.LEFT_HIP];
  const rHip = lm[LM.RIGHT_HIP];
  const lKnee = lm[LM.LEFT_KNEE];
  const rKnee = lm[LM.RIGHT_KNEE];
  const lAnkle = lm[LM.LEFT_ANKLE];
  const rAnkle = lm[LM.RIGHT_ANKLE];
  const lFoot = lm[LM.LEFT_FOOT_INDEX];
  const rFoot = lm[LM.RIGHT_FOOT_INDEX];
  const lShoulder = lm[LM.LEFT_SHOULDER];
  const rShoulder = lm[LM.RIGHT_SHOULDER];

  // Leg vectors (hip → ankle)
  const lLegVx = lAnkle.x - lHip.x;
  const lLegVy = lAnkle.y - lHip.y;
  const rLegVx = rAnkle.x - rHip.x;
  const rLegVy = rAnkle.y - rHip.y;

  // Thigh vectors (hip → knee) — used to isolate knee-bend compensation
  const lThighVx = lKnee.x - lHip.x;
  const lThighVy = lKnee.y - lHip.y;
  const rThighVx = rKnee.x - rHip.x;
  const rThighVy = rKnee.y - rHip.y;

  const splitAngleRaw = angleBetween2D(lLegVx, lLegVy, rLegVx, rLegVy);
  const splitAngleHipKnee = angleBetween2D(
    lThighVx, lThighVy, rThighVx, rThighVy,
  );

  const leftLegAngleFromHorizon = elevationFromHorizon(lLegVx, lLegVy);
  const rightLegAngleFromHorizon = elevationFromHorizon(rLegVx, rLegVy);
  const leftRightAngleDiff = Math.abs(
    leftLegAngleFromHorizon - rightLegAngleFromHorizon,
  );

  // Pelvis roll — angle of hip line from horizontal
  const hipDx = rHip.x - lHip.x;
  const hipDy = rHip.y - lHip.y;
  const pelvisRollAngle = Math.abs(
    Math.atan2(hipDy, hipDx) * RAD_TO_DEG,
  );

  // Trunk lean from vertical (image plane).
  // hip midpoint is origin → shoulder midpoint gives the trunk vector.
  const shMidX = (lShoulder.x + rShoulder.x) / 2;
  const shMidY = (lShoulder.y + rShoulder.y) / 2;
  const trunkLeanAngle = Math.abs(
    Math.atan2(shMidX, Math.abs(shMidY)) * RAD_TO_DEG,
  );
  // Signed version used by pelvis tilt (retains left/right sign info)
  const pelvisTiltProxy = Math.atan2(shMidX, Math.abs(shMidY)) * RAD_TO_DEG;

  // Shoulder vs hip depth (z) proxy for anterior/posterior pelvic tilt
  const shMidZ = (lShoulder.z + rShoulder.z) / 2;
  const hipMidZ = (lHip.z + rHip.z) / 2;
  const pelvisTiltZProxy = shMidZ - hipMidZ;

  // Knee extension: 180° = straight
  const leftKneeExtension = frameAngles.leftKnee;
  const rightKneeExtension = frameAngles.rightKnee;
  const kneeExtensionAvg = (leftKneeExtension + rightKneeExtension) / 2;
  const kneeExtensionAsymmetry = Math.abs(
    leftKneeExtension - rightKneeExtension,
  );

  const leftLegLineDeviation = legLineDeviation(lHip, lKnee, lAnkle);
  const rightLegLineDeviation = legLineDeviation(rHip, rKnee, rAnkle);

  // Turnout proxy: angle between foot vector (ankle→foot_index) and thigh vector (hip→knee).
  // Same for both legs — we ignore sign since we only care about how much the
  // foot deviates from the leg line.
  const leftFootDx = lFoot.x - lAnkle.x;
  const leftFootDy = lFoot.y - lAnkle.y;
  const rightFootDx = rFoot.x - rAnkle.x;
  const rightFootDy = rFoot.y - rAnkle.y;
  const leftFootTurnoutProxy = angleBetween2D(
    leftFootDx, leftFootDy, lThighVx, lThighVy,
  );
  const rightFootTurnoutProxy = angleBetween2D(
    rightFootDx, rightFootDy, rThighVx, rThighVy,
  );
  const turnoutAsymmetry = Math.abs(
    leftFootTurnoutProxy - rightFootTurnoutProxy,
  );

  // Trunk lean direction (coarse — only one dominant axis)
  let trunkLeanDirection: MiddleSplitFeatures["trunkLeanDirection"] = "upright";
  if (trunkLeanAngle >= 8) {
    if (Math.abs(pelvisTiltZProxy) > 0.15) {
      trunkLeanDirection = pelvisTiltZProxy > 0 ? "back" : "forward";
    } else if (shMidX > 0.08) {
      trunkLeanDirection = "right";
    } else if (shMidX < -0.08) {
      trunkLeanDirection = "left";
    }
  }

  // Frontality: small absolute z difference between shoulders and hips = frontal.
  const shoulderZSpread = Math.abs(lShoulder.z - rShoulder.z);
  const hipZSpread = Math.abs(lHip.z - rHip.z);
  const frontalityScore = Math.max(
    0,
    1 - (shoulderZSpread + hipZSpread) * 2.5,
  );

  const visValues = [
    lHip.visibility, rHip.visibility,
    lKnee.visibility, rKnee.visibility,
    lAnkle.visibility, rAnkle.visibility,
    lFoot.visibility, rFoot.visibility,
  ];
  const keyLandmarkVisibility =
    visValues.reduce((s, v) => s + v, 0) / visValues.length;

  return {
    splitAngleRaw: round1(splitAngleRaw),
    splitAngleHipKnee: round1(splitAngleHipKnee),
    leftLegAngleFromHorizon: round1(leftLegAngleFromHorizon),
    rightLegAngleFromHorizon: round1(rightLegAngleFromHorizon),
    leftRightAngleDiff: round1(leftRightAngleDiff),
    pelvisRollAngle: round1(pelvisRollAngle),
    pelvisTiltProxy: round1(pelvisTiltProxy),
    pelvisTiltZProxy: Math.round(pelvisTiltZProxy * 1000) / 1000,
    leftKneeExtension: round1(leftKneeExtension),
    rightKneeExtension: round1(rightKneeExtension),
    kneeExtensionAvg: round1(kneeExtensionAvg),
    kneeExtensionAsymmetry: round1(kneeExtensionAsymmetry),
    leftLegLineDeviation: round1(leftLegLineDeviation),
    rightLegLineDeviation: round1(rightLegLineDeviation),
    leftFootTurnoutProxy: round1(leftFootTurnoutProxy),
    rightFootTurnoutProxy: round1(rightFootTurnoutProxy),
    turnoutAsymmetry: round1(turnoutAsymmetry),
    trunkLeanAngle: round1(trunkLeanAngle),
    trunkLeanDirection,
    frontalityScore: Math.round(frontalityScore * 100) / 100,
    keyLandmarkVisibility: Math.round(keyLandmarkVisibility * 100) / 100,
    landmarkVisibility: {
      leftHip: round2(lHip.visibility),
      rightHip: round2(rHip.visibility),
      leftKnee: round2(lKnee.visibility),
      rightKnee: round2(rKnee.visibility),
      leftAnkle: round2(lAnkle.visibility),
      rightAnkle: round2(rAnkle.visibility),
      leftFootIndex: round2(lFoot.visibility),
      rightFootIndex: round2(rFoot.visibility),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
