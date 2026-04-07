/**
 * Pose time-series fixtures for regression testing.
 *
 * Each fixture represents a realistic pose scenario constructed from
 * known landmark positions. These are NOT real MediaPipe outputs but
 * are designed to trigger specific evaluator behaviors.
 *
 * To add real-video fixtures later:
 * 1. Run MediaPipe on a video
 * 2. Save the PoseTimeSeries JSON to a .json file here
 * 3. Import and use in regression.test.ts
 *
 * Naming convention: {technique}_{scenario}.ts
 * Example: handstand_good, handstand_arched_back, planche_hip_sag
 */

import { Landmark } from "@/lib/types";
import { PoseFrame, PoseTimeSeries, LM } from "@/lib/analysis/types";

// ---- Helper ----
function lm(x: number, y: number, z = 0, vis = 0.9): Landmark {
  return { x, y, z, visibility: vis };
}

function fill33(overrides: Partial<Record<number, Landmark>>): Landmark[] {
  const base: Landmark[] = new Array(33).fill(null).map(() => lm(0.5, 0.5));
  for (const [idx, val] of Object.entries(overrides)) {
    if (val) base[Number(idx)] = val;
  }
  return base;
}

function makeVideoFromLandmarks(
  landmarksFn: () => Landmark[],
  frameCount: number,
  fps: number,
  jitter = 0.002
): PoseTimeSeries {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const base = landmarksFn();
    const jittered = base.map(l => ({
      ...l,
      x: l.x + (Math.random() - 0.5) * jitter,
      y: l.y + (Math.random() - 0.5) * jitter,
    }));
    frames.push({ timestamp: i / fps, landmarks: jittered });
  }
  return { frames, fps, duration: frameCount / fps, sourceType: "video" };
}

// ============================================
// Handstand Fixtures
// ============================================

/** Good handstand: straight body, shoulders open, balanced */
function goodHandstandLandmarks(): Landmark[] {
  return fill33({
    [LM.NOSE]:            lm(0.50, 0.73),
    [LM.LEFT_EAR]:        lm(0.47, 0.71, 0.02, 0.8),
    [LM.RIGHT_EAR]:       lm(0.53, 0.71, 0.02, 0.8),
    [LM.LEFT_SHOULDER]:   lm(0.43, 0.66),
    [LM.RIGHT_SHOULDER]:  lm(0.57, 0.66),
    [LM.LEFT_ELBOW]:      lm(0.43, 0.77),
    [LM.RIGHT_ELBOW]:     lm(0.57, 0.77),
    [LM.LEFT_WRIST]:      lm(0.43, 0.88),
    [LM.RIGHT_WRIST]:     lm(0.57, 0.88),
    [LM.LEFT_HIP]:        lm(0.46, 0.40),
    [LM.RIGHT_HIP]:       lm(0.54, 0.40),
    [LM.LEFT_KNEE]:       lm(0.46, 0.22),
    [LM.RIGHT_KNEE]:      lm(0.54, 0.22),
    [LM.LEFT_ANKLE]:      lm(0.46, 0.05),
    [LM.RIGHT_ANKLE]:     lm(0.54, 0.05),
  });
}

/** Arched-back handstand: hips pushed forward, lower back arched */
function archedHandstandLandmarks(): Landmark[] {
  return fill33({
    [LM.NOSE]:            lm(0.50, 0.75),
    [LM.LEFT_EAR]:        lm(0.47, 0.73, 0.02, 0.8),
    [LM.RIGHT_EAR]:       lm(0.53, 0.73, 0.02, 0.8),
    [LM.LEFT_SHOULDER]:   lm(0.43, 0.65),
    [LM.RIGHT_SHOULDER]:  lm(0.57, 0.65),
    [LM.LEFT_ELBOW]:      lm(0.43, 0.77),
    [LM.RIGHT_ELBOW]:     lm(0.57, 0.77),
    [LM.LEFT_WRIST]:      lm(0.43, 0.88),
    [LM.RIGHT_WRIST]:     lm(0.57, 0.88),
    // Hips pushed significantly forward (arched back)
    [LM.LEFT_HIP]:        lm(0.40, 0.42),
    [LM.RIGHT_HIP]:       lm(0.48, 0.42),
    // Legs angled backward to compensate
    [LM.LEFT_KNEE]:       lm(0.52, 0.25),
    [LM.RIGHT_KNEE]:      lm(0.60, 0.25),
    [LM.LEFT_ANKLE]:      lm(0.55, 0.08),
    [LM.RIGHT_ANKLE]:     lm(0.63, 0.08),
  });
}

// ============================================
// Planche Fixtures
// ============================================

/** Planche with hip sag: hips dropping below shoulder-ankle line */
function plancheHipSagLandmarks(): Landmark[] {
  return fill33({
    [LM.NOSE]:            lm(0.30, 0.42),
    [LM.LEFT_EAR]:        lm(0.28, 0.41, 0.02, 0.8),
    [LM.RIGHT_EAR]:       lm(0.32, 0.41, 0.02, 0.8),
    [LM.LEFT_WRIST]:      lm(0.32, 0.60),
    [LM.RIGHT_WRIST]:     lm(0.42, 0.60),
    [LM.LEFT_ELBOW]:      lm(0.32, 0.55),
    [LM.RIGHT_ELBOW]:     lm(0.42, 0.55),
    // Shoulders forward of wrists (good lean)
    [LM.LEFT_SHOULDER]:   lm(0.36, 0.48),
    [LM.RIGHT_SHOULDER]:  lm(0.46, 0.48),
    // Hips DROPPED — significantly lower than shoulder line
    [LM.LEFT_HIP]:        lm(0.55, 0.58),
    [LM.RIGHT_HIP]:       lm(0.65, 0.58),
    [LM.LEFT_KNEE]:       lm(0.70, 0.52),
    [LM.RIGHT_KNEE]:      lm(0.80, 0.52),
    [LM.LEFT_ANKLE]:      lm(0.85, 0.48),
    [LM.RIGHT_ANKLE]:     lm(0.95, 0.48),
  });
}

/** Planche with bent elbows */
function plancheBentElbowLandmarks(): Landmark[] {
  return fill33({
    [LM.NOSE]:            lm(0.35, 0.42),
    [LM.LEFT_EAR]:        lm(0.33, 0.41, 0.02, 0.8),
    [LM.RIGHT_EAR]:       lm(0.37, 0.41, 0.02, 0.8),
    [LM.LEFT_WRIST]:      lm(0.32, 0.60),
    [LM.RIGHT_WRIST]:     lm(0.42, 0.60),
    // Elbows bent inward significantly
    [LM.LEFT_ELBOW]:      lm(0.30, 0.52),
    [LM.RIGHT_ELBOW]:     lm(0.40, 0.52),
    [LM.LEFT_SHOULDER]:   lm(0.36, 0.48),
    [LM.RIGHT_SHOULDER]:  lm(0.46, 0.48),
    // Body line OK
    [LM.LEFT_HIP]:        lm(0.55, 0.49),
    [LM.RIGHT_HIP]:       lm(0.65, 0.49),
    [LM.LEFT_KNEE]:       lm(0.70, 0.49),
    [LM.RIGHT_KNEE]:      lm(0.80, 0.49),
    [LM.LEFT_ANKLE]:      lm(0.85, 0.49),
    [LM.RIGHT_ANKLE]:     lm(0.95, 0.49),
  });
}

/**
 * Planche entry attempt: body starts upright and leans forward,
 * never reaching a stable horizontal hold. Simulates someone
 * pressing into planche but not fully achieving the position.
 */
function makePlancheEntry(): PoseTimeSeries {
  const fps = 10;
  const frames: PoseFrame[] = [];

  // 15 frames over 1.5 seconds — body progressively tilts toward horizontal
  for (let i = 0; i < 15; i++) {
    const t = i / fps;
    // Progress: 0 = upright, 1 = almost horizontal (but never gets there)
    const progress = i / 14;
    // Spine goes from ~30° (upright lean) to ~55° (halfway to horizontal 90°)
    const hipY = 0.50 - progress * 0.10; // hips rise slightly
    const ankleY = 0.40 - progress * 0.15; // ankles rise more
    const shoulderY = 0.55 + progress * 0.02; // shoulders stay roughly level

    const landmarks = fill33({
      [LM.NOSE]:            lm(0.30, shoulderY + 0.05),
      [LM.LEFT_EAR]:        lm(0.28, shoulderY + 0.04, 0.02, 0.8),
      [LM.RIGHT_EAR]:       lm(0.32, shoulderY + 0.04, 0.02, 0.8),
      [LM.LEFT_WRIST]:      lm(0.30, 0.65),
      [LM.RIGHT_WRIST]:     lm(0.40, 0.65),
      [LM.LEFT_ELBOW]:      lm(0.30, 0.60),
      [LM.RIGHT_ELBOW]:     lm(0.40, 0.60),
      [LM.LEFT_SHOULDER]:   lm(0.35, shoulderY),
      [LM.RIGHT_SHOULDER]:  lm(0.45, shoulderY),
      [LM.LEFT_HIP]:        lm(0.55, hipY),
      [LM.RIGHT_HIP]:       lm(0.65, hipY),
      [LM.LEFT_KNEE]:       lm(0.70, ankleY + 0.05),
      [LM.RIGHT_KNEE]:      lm(0.80, ankleY + 0.05),
      [LM.LEFT_ANKLE]:      lm(0.85, ankleY),
      [LM.RIGHT_ANKLE]:     lm(0.95, ankleY),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration: 1.5, sourceType: "video" };
}

// ============================================
// Swipes Fixtures
// ============================================

/**
 * Swipes with clear hand plants and leg swings.
 * Simulates a two-rotation swipe with phase transitions.
 */
function makeSwipesWithEvents(): PoseTimeSeries {
  const fps = 10;
  const frames: PoseFrame[] = [];

  // 20 frames = 2 seconds
  for (let i = 0; i < 20; i++) {
    const t = i / fps;
    const phase = Math.floor(i / 5); // 4 phases of 5 frames each

    let landmarks: Landmark[];

    if (phase === 0 || phase === 2) {
      // Hands phase: wrists low (below threshold in normalized space)
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.90),  // high Y = low in Y-up normalized
        [LM.RIGHT_WRIST]:   lm(0.50, 0.90),
        [LM.LEFT_SHOULDER]: lm(0.40, 0.60),
        [LM.RIGHT_SHOULDER]:lm(0.55, 0.60),
        [LM.LEFT_HIP]:      lm(0.50, 0.45),
        [LM.RIGHT_HIP]:     lm(0.60, 0.45),
        [LM.LEFT_KNEE]:     lm(0.55, 0.35),
        [LM.RIGHT_KNEE]:    lm(0.65, 0.35),
        // Ankles moving fast (leg swing)
        [LM.LEFT_ANKLE]:    lm(0.60 + (i % 5) * 0.05, 0.25),
        [LM.RIGHT_ANKLE]:   lm(0.70 + (i % 5) * 0.05, 0.25),
        [LM.LEFT_ELBOW]:    lm(0.40, 0.75),
        [LM.RIGHT_ELBOW]:   lm(0.50, 0.75),
      });
    } else {
      // Aerial/feet phase: wrists up, ankles down
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.40),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.40),
        [LM.LEFT_SHOULDER]: lm(0.45, 0.50),
        [LM.RIGHT_SHOULDER]:lm(0.55, 0.50),
        [LM.LEFT_HIP]:      lm(0.50, 0.55),
        [LM.RIGHT_HIP]:     lm(0.60, 0.55),
        [LM.LEFT_KNEE]:     lm(0.50, 0.70),
        [LM.RIGHT_KNEE]:    lm(0.60, 0.70),
        [LM.LEFT_ANKLE]:    lm(0.50, 0.85),
        [LM.RIGHT_ANKLE]:   lm(0.60, 0.85),
        [LM.LEFT_ELBOW]:    lm(0.42, 0.45),
        [LM.RIGHT_ELBOW]:   lm(0.52, 0.45),
      });
    }

    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration: 2.0, sourceType: "video" };
}

/**
 * Swipes where hand plant timing is early / inconsistent.
 * First hand plant happens immediately, second is delayed.
 */
function makeSwipesEarlyHandPlant(): PoseTimeSeries {
  const fps = 10;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < 20; i++) {
    const t = i / fps;

    let landmarks: Landmark[];

    if (i < 3) {
      // Very early hand plant
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.92),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.92),
        [LM.LEFT_SHOULDER]: lm(0.40, 0.60),
        [LM.RIGHT_SHOULDER]:lm(0.55, 0.60),
        [LM.LEFT_HIP]:      lm(0.50, 0.45),
        [LM.RIGHT_HIP]:     lm(0.60, 0.45),
        [LM.LEFT_KNEE]:     lm(0.55, 0.35),
        [LM.RIGHT_KNEE]:    lm(0.65, 0.35),
        [LM.LEFT_ANKLE]:    lm(0.60, 0.25),
        [LM.RIGHT_ANKLE]:   lm(0.70, 0.25),
        [LM.LEFT_ELBOW]:    lm(0.40, 0.76),
        [LM.RIGHT_ELBOW]:   lm(0.50, 0.76),
      });
    } else if (i < 15) {
      // Long aerial gap (no hand plant)
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.40),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.40),
        [LM.LEFT_SHOULDER]: lm(0.45, 0.50),
        [LM.RIGHT_SHOULDER]:lm(0.55, 0.50),
        [LM.LEFT_HIP]:      lm(0.50, 0.55),
        [LM.RIGHT_HIP]:     lm(0.60, 0.55),
        [LM.LEFT_KNEE]:     lm(0.50, 0.70),
        [LM.RIGHT_KNEE]:    lm(0.60, 0.70),
        [LM.LEFT_ANKLE]:    lm(0.50, 0.85),
        [LM.RIGHT_ANKLE]:   lm(0.60, 0.85),
        [LM.LEFT_ELBOW]:    lm(0.42, 0.45),
        [LM.RIGHT_ELBOW]:   lm(0.52, 0.45),
      });
    } else {
      // Delayed second hand plant
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.91),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.91),
        [LM.LEFT_SHOULDER]: lm(0.40, 0.60),
        [LM.RIGHT_SHOULDER]:lm(0.55, 0.60),
        [LM.LEFT_HIP]:      lm(0.50, 0.45),
        [LM.RIGHT_HIP]:     lm(0.60, 0.45),
        [LM.LEFT_KNEE]:     lm(0.55, 0.35),
        [LM.RIGHT_KNEE]:    lm(0.65, 0.35),
        [LM.LEFT_ANKLE]:    lm(0.60, 0.25),
        [LM.RIGHT_ANKLE]:   lm(0.70, 0.25),
        [LM.LEFT_ELBOW]:    lm(0.40, 0.76),
        [LM.RIGHT_ELBOW]:   lm(0.50, 0.76),
      });
    }

    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration: 2.0, sourceType: "video" };
}

// ============================================
// Exports
// ============================================

export const FIXTURES = {
  handstand: {
    good: () => makeVideoFromLandmarks(goodHandstandLandmarks, 15, 10),
    archedBack: () => makeVideoFromLandmarks(archedHandstandLandmarks, 15, 10),
  },
  planche: {
    /** Static hold with hip sag (zero jitter → reliably detected as hold) */
    hipSag: () => makeVideoFromLandmarks(plancheHipSagLandmarks, 20, 10, 0),
    bentElbow: () => makeVideoFromLandmarks(plancheBentElbowLandmarks, 20, 10, 0),
    /** Entry attempt — progressive lean, no stable hold */
    entry: makePlancheEntry,
  },
  swipes: {
    withEvents: makeSwipesWithEvents,
    earlyHandPlant: makeSwipesEarlyHandPlant,
  },
} as const;
