import { Landmark, JointAngles, CenterOfGravity } from "@/lib/types";

// MediaPipe landmark indices
const LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

// Body segment mass ratios for center of gravity calculation
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

/**
 * Calculate angle between three points (in degrees)
 */
function calculateAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return Math.round(angle * 10) / 10;
}

/**
 * Calculate all joint angles from landmarks
 */
export function calculateJointAngles(landmarks: Landmark[]): JointAngles {
  const lm = landmarks;

  return {
    leftShoulder: calculateAngle(
      lm[LANDMARKS.LEFT_HIP],
      lm[LANDMARKS.LEFT_SHOULDER],
      lm[LANDMARKS.LEFT_ELBOW]
    ),
    rightShoulder: calculateAngle(
      lm[LANDMARKS.RIGHT_HIP],
      lm[LANDMARKS.RIGHT_SHOULDER],
      lm[LANDMARKS.RIGHT_ELBOW]
    ),
    leftElbow: calculateAngle(
      lm[LANDMARKS.LEFT_SHOULDER],
      lm[LANDMARKS.LEFT_ELBOW],
      lm[LANDMARKS.LEFT_WRIST]
    ),
    rightElbow: calculateAngle(
      lm[LANDMARKS.RIGHT_SHOULDER],
      lm[LANDMARKS.RIGHT_ELBOW],
      lm[LANDMARKS.RIGHT_WRIST]
    ),
    leftHip: calculateAngle(
      lm[LANDMARKS.LEFT_SHOULDER],
      lm[LANDMARKS.LEFT_HIP],
      lm[LANDMARKS.LEFT_KNEE]
    ),
    rightHip: calculateAngle(
      lm[LANDMARKS.RIGHT_SHOULDER],
      lm[LANDMARKS.RIGHT_HIP],
      lm[LANDMARKS.RIGHT_KNEE]
    ),
    leftKnee: calculateAngle(
      lm[LANDMARKS.LEFT_HIP],
      lm[LANDMARKS.LEFT_KNEE],
      lm[LANDMARKS.LEFT_ANKLE]
    ),
    rightKnee: calculateAngle(
      lm[LANDMARKS.RIGHT_HIP],
      lm[LANDMARKS.RIGHT_KNEE],
      lm[LANDMARKS.RIGHT_ANKLE]
    ),
    // Spine angle: angle between shoulder midpoint, hip midpoint, and vertical
    spineAngle: calculateSpineAngle(lm),
    // Hip alignment: angle difference between left and right hip heights
    hipAlignment: calculateAlignment(
      lm[LANDMARKS.LEFT_HIP],
      lm[LANDMARKS.RIGHT_HIP]
    ),
    // Shoulder alignment
    shoulderAlignment: calculateAlignment(
      lm[LANDMARKS.LEFT_SHOULDER],
      lm[LANDMARKS.RIGHT_SHOULDER]
    ),
  };
}

function calculateSpineAngle(lm: Landmark[]): number {
  const shoulderMid = {
    x: (lm[LANDMARKS.LEFT_SHOULDER].x + lm[LANDMARKS.RIGHT_SHOULDER].x) / 2,
    y: (lm[LANDMARKS.LEFT_SHOULDER].y + lm[LANDMARKS.RIGHT_SHOULDER].y) / 2,
    z: 0,
    visibility: 1,
  };
  const hipMid = {
    x: (lm[LANDMARKS.LEFT_HIP].x + lm[LANDMARKS.RIGHT_HIP].x) / 2,
    y: (lm[LANDMARKS.LEFT_HIP].y + lm[LANDMARKS.RIGHT_HIP].y) / 2,
    z: 0,
    visibility: 1,
  };
  // Vertical reference point (directly above hip midpoint)
  const verticalRef = { ...hipMid, y: hipMid.y - 1, z: 0, visibility: 1 };
  return calculateAngle(verticalRef, hipMid, shoulderMid);
}

function calculateAlignment(a: Landmark, b: Landmark): number {
  // Returns the tilt in degrees (0 = perfectly level)
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.round(Math.atan2(dy, dx) * (180 / Math.PI) * 10) / 10;
}

/**
 * Calculate center of gravity from landmarks using body segment mass ratios
 */
export function calculateCenterOfGravity(
  landmarks: Landmark[]
): CenterOfGravity {
  const lm = landmarks;
  let totalX = 0;
  let totalY = 0;
  let totalMass = 0;

  // Head (approximated at nose position)
  totalX += lm[LANDMARKS.NOSE].x * SEGMENT_MASS.head;
  totalY += lm[LANDMARKS.NOSE].y * SEGMENT_MASS.head;
  totalMass += SEGMENT_MASS.head;

  // Trunk (midpoint of shoulders and hips)
  const trunkX =
    (lm[LANDMARKS.LEFT_SHOULDER].x +
      lm[LANDMARKS.RIGHT_SHOULDER].x +
      lm[LANDMARKS.LEFT_HIP].x +
      lm[LANDMARKS.RIGHT_HIP].x) /
    4;
  const trunkY =
    (lm[LANDMARKS.LEFT_SHOULDER].y +
      lm[LANDMARKS.RIGHT_SHOULDER].y +
      lm[LANDMARKS.LEFT_HIP].y +
      lm[LANDMARKS.RIGHT_HIP].y) /
    4;
  totalX += trunkX * SEGMENT_MASS.trunk;
  totalY += trunkY * SEGMENT_MASS.trunk;
  totalMass += SEGMENT_MASS.trunk;

  // Arms (upper arm midpoint + forearm midpoint for each side)
  const armSegments = [
    {
      a: LANDMARKS.LEFT_SHOULDER,
      b: LANDMARKS.LEFT_ELBOW,
      mass: SEGMENT_MASS.upperArm,
    },
    {
      a: LANDMARKS.LEFT_ELBOW,
      b: LANDMARKS.LEFT_WRIST,
      mass: SEGMENT_MASS.forearm + SEGMENT_MASS.hand,
    },
    {
      a: LANDMARKS.RIGHT_SHOULDER,
      b: LANDMARKS.RIGHT_ELBOW,
      mass: SEGMENT_MASS.upperArm,
    },
    {
      a: LANDMARKS.RIGHT_ELBOW,
      b: LANDMARKS.RIGHT_WRIST,
      mass: SEGMENT_MASS.forearm + SEGMENT_MASS.hand,
    },
  ];

  for (const seg of armSegments) {
    const mx = (lm[seg.a].x + lm[seg.b].x) / 2;
    const my = (lm[seg.a].y + lm[seg.b].y) / 2;
    totalX += mx * seg.mass;
    totalY += my * seg.mass;
    totalMass += seg.mass;
  }

  // Legs (thigh + shank for each side)
  const legSegments = [
    { a: LANDMARKS.LEFT_HIP, b: LANDMARKS.LEFT_KNEE, mass: SEGMENT_MASS.thigh },
    {
      a: LANDMARKS.LEFT_KNEE,
      b: LANDMARKS.LEFT_ANKLE,
      mass: SEGMENT_MASS.shank + SEGMENT_MASS.foot,
    },
    {
      a: LANDMARKS.RIGHT_HIP,
      b: LANDMARKS.RIGHT_KNEE,
      mass: SEGMENT_MASS.thigh,
    },
    {
      a: LANDMARKS.RIGHT_KNEE,
      b: LANDMARKS.RIGHT_ANKLE,
      mass: SEGMENT_MASS.shank + SEGMENT_MASS.foot,
    },
  ];

  for (const seg of legSegments) {
    const mx = (lm[seg.a].x + lm[seg.b].x) / 2;
    const my = (lm[seg.a].y + lm[seg.b].y) / 2;
    totalX += mx * seg.mass;
    totalY += my * seg.mass;
    totalMass += seg.mass;
  }

  return {
    x: totalX / totalMass,
    y: totalY / totalMass,
  };
}
