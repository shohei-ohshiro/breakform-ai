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
// Long Video Fixtures
// ============================================

/**
 * Long planche entry attempt (11 seconds at 10fps = 110 frames conceptually).
 * Simulates a video where the best planche moment is in the second half.
 * Uses the frame count that would result from coarse sampling of an 11s video.
 *
 * @param frameCount - number of frames to generate (simulating sampling density)
 */
function makeLongPlancheEntry(frameCount: number = 55): PoseTimeSeries {
  const fps = 10;
  const duration = 11.0;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    // Progress: 0 at start, 1 at end
    const progress = i / (frameCount - 1);

    // Best moment is at ~70% through the video (7.7s mark)
    // Body starts upright, progressively leans, peaks at 70%, then loses form
    const peakProgress = Math.max(0, 1 - Math.abs(progress - 0.7) * 3);

    // Large continuous movement to ensure no static interval is detected:
    // Shoulders shift forward significantly, hips/ankles rise
    const shoulderY = 0.60 - progress * 0.10 + peakProgress * 0.05;
    const shoulderX = 0.35 - progress * 0.08; // shoulders lean forward over time
    const hipY = 0.50 - peakProgress * 0.15;
    const hipX = 0.55 + progress * 0.05;
    const ankleY = 0.45 - peakProgress * 0.22;
    const ankleX = 0.85 + progress * 0.03;

    // Visibility: generally good but slightly lower at extremes
    const vis = 0.85 + peakProgress * 0.1;

    const landmarks = fill33({
      [LM.NOSE]:            lm(shoulderX - 0.05, shoulderY + 0.05, 0, vis),
      [LM.LEFT_EAR]:        lm(shoulderX - 0.07, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.RIGHT_EAR]:       lm(shoulderX - 0.03, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.LEFT_WRIST]:      lm(0.30, 0.65, 0, vis),
      [LM.RIGHT_WRIST]:     lm(0.40, 0.65, 0, vis),
      [LM.LEFT_ELBOW]:      lm(0.30, 0.60, 0, vis),
      [LM.RIGHT_ELBOW]:     lm(0.40, 0.60, 0, vis),
      [LM.LEFT_SHOULDER]:   lm(shoulderX, shoulderY, 0, vis),
      [LM.RIGHT_SHOULDER]:  lm(shoulderX + 0.10, shoulderY, 0, vis),
      [LM.LEFT_HIP]:        lm(hipX, hipY, 0, vis),
      [LM.RIGHT_HIP]:       lm(hipX + 0.10, hipY, 0, vis),
      [LM.LEFT_KNEE]:       lm(ankleX - 0.15, ankleY + 0.05, 0, vis),
      [LM.RIGHT_KNEE]:      lm(ankleX - 0.05, ankleY + 0.05, 0, vis),
      [LM.LEFT_ANKLE]:      lm(ankleX, ankleY, 0, vis),
      [LM.RIGHT_ANKLE]:     lm(ankleX + 0.10, ankleY, 0, vis),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration, sourceType: "video" };
}

/**
 * Long planche entry with a brief good moment and low-visibility frames.
 * The best pose (most horizontal) occurs in a 0.5s window with one frame
 * having poor skeleton quality.
 */
function makeLongPlancheWithBriefGoodMoment(): PoseTimeSeries {
  const fps = 10;
  const duration = 8.0;
  const frameCount = 40; // simulating coarse sampling of 8s video
  const frames: PoseFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    const progress = i / (frameCount - 1);

    // The brief good moment is at 60-65% (4.8-5.2s)
    const inGoodWindow = progress >= 0.60 && progress <= 0.65;
    const nearGoodWindow = progress >= 0.55 && progress <= 0.70;

    let shoulderY: number, hipY: number, ankleY: number;
    let vis: number;

    // Add continuous movement to prevent static detection
    const drift = progress * 0.15; // shoulders/hips shift over time
    const shoulderX = 0.35 - drift;
    const hipX = 0.55 + drift * 0.3;
    const ankleX = 0.85 + drift * 0.2;

    if (inGoodWindow) {
      // Near-horizontal body
      shoulderY = 0.52;
      hipY = 0.50;
      ankleY = 0.49;
      // One frame in this window has poor visibility
      vis = (progress > 0.62 && progress < 0.64) ? 0.2 : 0.95;
    } else if (nearGoodWindow) {
      // Approaching horizontal
      shoulderY = 0.54;
      hipY = 0.48;
      ankleY = 0.44;
      vis = 0.9;
    } else {
      // Far from horizontal — body tilted, actively moving
      shoulderY = 0.58 - progress * 0.06;
      hipY = 0.42 + progress * 0.04;
      ankleY = 0.30 + progress * 0.08;
      vis = 0.85;
    }

    const landmarks = fill33({
      [LM.NOSE]:            lm(shoulderX - 0.05, shoulderY + 0.05, 0, vis),
      [LM.LEFT_EAR]:        lm(shoulderX - 0.07, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.RIGHT_EAR]:       lm(shoulderX - 0.03, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.LEFT_WRIST]:      lm(0.30, 0.65, 0, vis),
      [LM.RIGHT_WRIST]:     lm(0.40, 0.65, 0, vis),
      [LM.LEFT_ELBOW]:      lm(0.30, 0.60, 0, vis),
      [LM.RIGHT_ELBOW]:     lm(0.40, 0.60, 0, vis),
      [LM.LEFT_SHOULDER]:   lm(shoulderX, shoulderY, 0, vis),
      [LM.RIGHT_SHOULDER]:  lm(shoulderX + 0.10, shoulderY, 0, vis),
      [LM.LEFT_HIP]:        lm(hipX, hipY, 0, vis),
      [LM.RIGHT_HIP]:       lm(hipX + 0.10, hipY, 0, vis),
      [LM.LEFT_KNEE]:       lm(ankleX - 0.15, ankleY + 0.05, 0, vis),
      [LM.RIGHT_KNEE]:      lm(ankleX - 0.05, ankleY + 0.05, 0, vis),
      [LM.LEFT_ANKLE]:      lm(ankleX, ankleY, 0, vis),
      [LM.RIGHT_ANKLE]:     lm(ankleX + 0.10, ankleY, 0, vis),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration, sourceType: "video" };
}

/**
 * Long planche entry where the only good moment is in the final 20% of the video.
 * Tests that full video scan finds candidates in the tail end.
 */
function makePlancheLateBestMoment(): PoseTimeSeries {
  const fps = 10;
  const duration = 10.0;
  const frameCount = 50;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    const progress = i / (frameCount - 1);

    // Best moment is at 85-95% through the video (8.5-9.5s)
    const inBestWindow = progress >= 0.85 && progress <= 0.95;

    // Continuous movement to prevent static detection
    const drift = progress * 0.12;
    const shoulderX = 0.35 - drift;
    const hipX = 0.55 + drift * 0.3;
    const ankleX = 0.85 + drift * 0.2;

    let shoulderY: number, hipY: number, ankleY: number;
    const vis = 0.9;

    if (inBestWindow) {
      // Near-horizontal body (good planche position)
      shoulderY = 0.52;
      hipY = 0.51;
      ankleY = 0.50;
    } else {
      // Far from horizontal — body upright, slowly leaning
      shoulderY = 0.60 - progress * 0.04;
      hipY = 0.42 + progress * 0.02;
      ankleY = 0.30 + progress * 0.06;
    }

    const landmarks = fill33({
      [LM.NOSE]:            lm(shoulderX - 0.05, shoulderY + 0.05, 0, vis),
      [LM.LEFT_EAR]:        lm(shoulderX - 0.07, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.RIGHT_EAR]:       lm(shoulderX - 0.03, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.LEFT_WRIST]:      lm(0.30, 0.65, 0, vis),
      [LM.RIGHT_WRIST]:     lm(0.40, 0.65, 0, vis),
      [LM.LEFT_ELBOW]:      lm(0.30, 0.60, 0, vis),
      [LM.RIGHT_ELBOW]:     lm(0.40, 0.60, 0, vis),
      [LM.LEFT_SHOULDER]:   lm(shoulderX, shoulderY, 0, vis),
      [LM.RIGHT_SHOULDER]:  lm(shoulderX + 0.10, shoulderY, 0, vis),
      [LM.LEFT_HIP]:        lm(hipX, hipY, 0, vis),
      [LM.RIGHT_HIP]:       lm(hipX + 0.10, hipY, 0, vis),
      [LM.LEFT_KNEE]:       lm(ankleX - 0.15, ankleY + 0.05, 0, vis),
      [LM.RIGHT_KNEE]:      lm(ankleX - 0.05, ankleY + 0.05, 0, vis),
      [LM.LEFT_ANKLE]:      lm(ankleX, ankleY, 0, vis),
      [LM.RIGHT_ANKLE]:     lm(ankleX + 0.10, ankleY, 0, vis),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration, sourceType: "video" };
}

/**
 * Long handstand video (12s) with the best hold in the middle third.
 * Tests that handstand evaluator also benefits from full scan.
 */
function makeLongHandstand(): PoseTimeSeries {
  const fps = 10;
  const duration = 12.0;
  const frameCount = 60;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    const progress = i / (frameCount - 1);

    // Stable hold in the middle (30-70% = 3.6s-8.4s)
    const inHold = progress >= 0.30 && progress <= 0.70;

    // Small jitter even in hold to be realistic, but much less
    const jitter = inHold ? 0.001 : 0.02;
    const rand = () => (Math.random() - 0.5) * jitter;

    const landmarks = fill33({
      [LM.NOSE]:            lm(0.50 + rand(), 0.73 + rand()),
      [LM.LEFT_EAR]:        lm(0.47 + rand(), 0.71 + rand(), 0.02, 0.8),
      [LM.RIGHT_EAR]:       lm(0.53 + rand(), 0.71 + rand(), 0.02, 0.8),
      [LM.LEFT_SHOULDER]:   lm(0.43 + rand(), 0.66 + rand()),
      [LM.RIGHT_SHOULDER]:  lm(0.57 + rand(), 0.66 + rand()),
      [LM.LEFT_ELBOW]:      lm(0.43 + rand(), 0.77 + rand()),
      [LM.RIGHT_ELBOW]:     lm(0.57 + rand(), 0.77 + rand()),
      [LM.LEFT_WRIST]:      lm(0.43 + rand(), 0.88 + rand()),
      [LM.RIGHT_WRIST]:     lm(0.57 + rand(), 0.88 + rand()),
      [LM.LEFT_HIP]:        lm(0.46 + rand(), inHold ? 0.40 + rand() : 0.42 + progress * 0.05),
      [LM.RIGHT_HIP]:       lm(0.54 + rand(), inHold ? 0.40 + rand() : 0.42 + progress * 0.05),
      [LM.LEFT_KNEE]:       lm(0.46 + rand(), 0.22 + rand()),
      [LM.RIGHT_KNEE]:      lm(0.54 + rand(), 0.22 + rand()),
      [LM.LEFT_ANKLE]:      lm(0.46 + rand(), 0.05 + rand()),
      [LM.RIGHT_ANKLE]:     lm(0.54 + rand(), 0.05 + rand()),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration, sourceType: "video" };
}

// ============================================
// Swipes Fixture Builder (for v3.0 cycle/mode tests)
// ============================================

type SwipePhase = "hands" | "aerial";

interface SwipeFixtureOpts {
  pattern: SwipePhase[];
  fps?: number;
  visibility?: number;
  /** Per-frame X position function for left ankle. Defaults to swinging motion. */
  leftAnkleX?: (i: number, phase: SwipePhase) => number;
  rightAnkleX?: (i: number, phase: SwipePhase) => number;
  /** Per-frame Y position function for ankles. Defaults to phase-dependent (0.25/0.85). */
  ankleY?: (i: number, phase: SwipePhase) => number;
  /** Override hip Y to test hip angle scoring */
  hipYOffset?: number;
  /** Override elbow Y to test bent-elbow detection */
  elbowYOffset?: number;
  /**
   * If true, hip / shoulder / knee / elbow / ankle Y stay constant across
   * phases — only wrists move. Use this when you need plant detection but
   * want to suppress normalization-induced velocity (e.g. weak-kick fixture).
   */
  staticBody?: boolean;
}

function buildSwipeFixture(opts: SwipeFixtureOpts): PoseTimeSeries {
  const fps = opts.fps ?? 10;
  const vis = opts.visibility ?? 0.9;
  const lAnkleX = opts.leftAnkleX ?? ((i, p) => (p === "hands" ? 0.60 + (i % 5) * 0.1 : 0.50 + (i % 5) * 0.05));
  const rAnkleX = opts.rightAnkleX ?? ((i, p) => (p === "hands" ? 0.70 + (i % 5) * 0.1 : 0.60 + (i % 5) * 0.05));
  const ankleY = opts.ankleY ?? ((_i, p) => (p === "hands" ? 0.25 : 0.85));
  const hipDy = opts.hipYOffset ?? 0;
  const elbowDy = opts.elbowYOffset ?? 0;
  const staticBody = opts.staticBody ?? false;

  const frames: PoseFrame[] = opts.pattern.map((phase, i) => {
    const t = i / fps;
    let landmarks: Landmark[];
    if (phase === "hands") {
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.92, 0, vis),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.92, 0, vis),
        [LM.LEFT_SHOULDER]: lm(staticBody ? 0.43 : 0.38, staticBody ? 0.50 : 0.62, 0, vis),
        [LM.RIGHT_SHOULDER]: lm(staticBody ? 0.57 : 0.52, staticBody ? 0.50 : 0.62, 0, vis),
        [LM.LEFT_HIP]:      lm(0.50, (staticBody ? 0.55 : 0.45) + hipDy, 0, vis),
        [LM.RIGHT_HIP]:     lm(0.60, (staticBody ? 0.55 : 0.45) + hipDy, 0, vis),
        [LM.LEFT_KNEE]:     lm(staticBody ? 0.50 : 0.55, staticBody ? 0.70 : 0.35, 0, vis),
        [LM.RIGHT_KNEE]:    lm(staticBody ? 0.60 : 0.65, staticBody ? 0.70 : 0.35, 0, vis),
        [LM.LEFT_ANKLE]:    lm(lAnkleX(i, phase), ankleY(i, phase), 0, vis),
        [LM.RIGHT_ANKLE]:   lm(rAnkleX(i, phase), ankleY(i, phase), 0, vis),
        [LM.LEFT_ELBOW]:    lm(staticBody ? 0.42 : 0.40, (staticBody ? 0.45 : 0.78) + elbowDy, 0, vis),
        [LM.RIGHT_ELBOW]:   lm(staticBody ? 0.52 : 0.50, (staticBody ? 0.45 : 0.78) + elbowDy, 0, vis),
      });
    } else {
      landmarks = fill33({
        [LM.LEFT_WRIST]:    lm(0.40, 0.40, 0, vis),
        [LM.RIGHT_WRIST]:   lm(0.50, 0.40, 0, vis),
        [LM.LEFT_SHOULDER]: lm(0.43, 0.50, 0, vis),
        [LM.RIGHT_SHOULDER]: lm(0.57, 0.50, 0, vis),
        [LM.LEFT_HIP]:      lm(0.50, 0.55, 0, vis),
        [LM.RIGHT_HIP]:     lm(0.60, 0.55, 0, vis),
        [LM.LEFT_KNEE]:     lm(0.50, 0.70, 0, vis),
        [LM.RIGHT_KNEE]:    lm(0.60, 0.70, 0, vis),
        [LM.LEFT_ANKLE]:    lm(lAnkleX(i, phase), ankleY(i, phase), 0, vis),
        [LM.RIGHT_ANKLE]:   lm(rAnkleX(i, phase), ankleY(i, phase), 0, vis),
        [LM.LEFT_ELBOW]:    lm(0.42, 0.45, 0, vis),
        [LM.RIGHT_ELBOW]:   lm(0.52, 0.45, 0, vis),
      });
    }
    return { timestamp: t, landmarks };
  });
  return { frames, fps, duration: opts.pattern.length / fps, sourceType: "video" };
}

/** Pattern helper: alternating runs of `phaseLen` between aerial and hands. */
function patternRuns(...runs: { phase: SwipePhase; len: number }[]): SwipePhase[] {
  const out: SwipePhase[] = [];
  for (const r of runs) for (let i = 0; i < r.len; i++) out.push(r.phase);
  return out;
}

/** Multi-cycle: 3 hand_plants → 2 cycles → multi_cycle mode */
function makeSwipesMultiCycle(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns(
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 3 },
    ),
  });
}

/** Single cycle: 2 hand_plants → 1 cycle → single_cycle mode */
function makeSwipesSingleCycle(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns(
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 4 },
    ),
  });
}

/** Partial: never plants hands → 0 cycles → partial mode (score capped) */
function makeSwipesPartial(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns({ phase: "aerial", len: 20 }),
  });
}

/** Multi-cycle but with weak (slow) leg movement → low kick_power */
function makeSwipesWeakKick(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns(
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 3 },
    ),
    staticBody: true, // hip / shoulder constant → no normalization-induced velocity
    leftAnkleX: () => 0.55, // no horizontal swing
    rightAnkleX: () => 0.65,
    ankleY: () => 0.55, // constant Y → no kick velocity
  });
}

/** Multi-cycle with strong left, weak right → kick_asymmetric violation */
function makeSwipesAsymmetricKick(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns(
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 3 },
    ),
    leftAnkleX: (i, p) => (p === "hands" ? 0.60 + (i % 3) * 0.18 : 0.50 + (i % 3) * 0.18),
    rightAnkleX: () => 0.70,
  });
}

/** Multi-cycle with low visibility on wrists/ankles → quality impact */
function makeSwipesLowVisibility(): PoseTimeSeries {
  return buildSwipeFixture({
    pattern: patternRuns(
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 5 },
      { phase: "hands", len: 4 },
      { phase: "aerial", len: 3 },
    ),
    visibility: 0.25,
  });
}

// ============================================
// Comparison Fixtures (first-half / second-half)
// ============================================

/**
 * Make a "first half" truncation of a fixture (only first 50% of frames).
 * For testing that the front half of a video gives different results
 * than the full video or the back half.
 */
function makeFirstHalf(series: PoseTimeSeries): PoseTimeSeries {
  const midIdx = Math.floor(series.frames.length / 2);
  const frames = series.frames.slice(0, midIdx);
  return {
    frames,
    fps: series.fps,
    duration: frames[frames.length - 1]?.timestamp ?? 0,
    sourceType: series.sourceType,
  };
}

/**
 * Make a "second half" truncation of a fixture (only last 50% of frames).
 * Timestamps are re-zeroed to start at 0.
 */
function makeSecondHalf(series: PoseTimeSeries): PoseTimeSeries {
  const midIdx = Math.floor(series.frames.length / 2);
  const rawFrames = series.frames.slice(midIdx);
  const offset = rawFrames[0]?.timestamp ?? 0;
  const frames = rawFrames.map(f => ({
    ...f,
    timestamp: f.timestamp - offset,
  }));
  return {
    frames,
    fps: series.fps,
    duration: frames[frames.length - 1]?.timestamp ?? 0,
    sourceType: series.sourceType,
  };
}

// ============================================
// Mid-plateau vs End-peak Fixture
// ============================================

/**
 * Video where middle has a stable near-horizontal plateau (5+ frames)
 * and the very end has a 1-frame peak that is slightly more horizontal.
 * Tests that plateau preference wins over single-frame end-of-clip peak.
 */
function makePlancheMidPlateauVsEndPeak(): PoseTimeSeries {
  const fps = 10;
  const duration = 8.0;
  const frameCount = 40;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    const progress = i / (frameCount - 1);

    // Continuous movement to prevent static detection
    const drift = progress * 0.12;
    const shoulderX = 0.35 - drift;
    const hipX = 0.55 + drift * 0.3;
    const ankleX = 0.85 + drift * 0.2;

    let shoulderY: number, hipY: number, ankleY: number;
    const vis = 0.9;

    // Mid-plateau: 35-55% of video (2.8s - 4.4s), near-horizontal (8° deviation)
    const inPlateau = progress >= 0.35 && progress <= 0.55;
    // End peak: last frame only, slightly better (5° deviation)
    const isEndPeak = i === frameCount - 1;

    if (isEndPeak) {
      // Single frame at end: slightly more horizontal than plateau
      shoulderY = 0.505;
      hipY = 0.503;
      ankleY = 0.500;
    } else if (inPlateau) {
      // Stable near-horizontal plateau (8° from horizontal, consistent)
      shoulderY = 0.52;
      hipY = 0.51;
      ankleY = 0.50;
    } else {
      // Far from horizontal
      shoulderY = 0.58 - progress * 0.04;
      hipY = 0.42 + progress * 0.03;
      ankleY = 0.30 + progress * 0.08;
    }

    const landmarks = fill33({
      [LM.NOSE]:            lm(shoulderX - 0.05, shoulderY + 0.05, 0, vis),
      [LM.LEFT_EAR]:        lm(shoulderX - 0.07, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.RIGHT_EAR]:       lm(shoulderX - 0.03, shoulderY + 0.04, 0.02, vis * 0.9),
      [LM.LEFT_WRIST]:      lm(0.30, 0.65, 0, vis),
      [LM.RIGHT_WRIST]:     lm(0.40, 0.65, 0, vis),
      [LM.LEFT_ELBOW]:      lm(0.30, 0.60, 0, vis),
      [LM.RIGHT_ELBOW]:     lm(0.40, 0.60, 0, vis),
      [LM.LEFT_SHOULDER]:   lm(shoulderX, shoulderY, 0, vis),
      [LM.RIGHT_SHOULDER]:  lm(shoulderX + 0.10, shoulderY, 0, vis),
      [LM.LEFT_HIP]:        lm(hipX, hipY, 0, vis),
      [LM.RIGHT_HIP]:       lm(hipX + 0.10, hipY, 0, vis),
      [LM.LEFT_KNEE]:       lm(ankleX - 0.15, ankleY + 0.05, 0, vis),
      [LM.RIGHT_KNEE]:      lm(ankleX - 0.05, ankleY + 0.05, 0, vis),
      [LM.LEFT_ANKLE]:      lm(ankleX, ankleY, 0, vis),
      [LM.RIGHT_ANKLE]:     lm(ankleX + 0.10, ankleY, 0, vis),
    });
    frames.push({ timestamp: t, landmarks });
  }

  return { frames, fps, duration, sourceType: "video" };
}

// ============================================
// Exports
// ============================================

export const FIXTURES = {
  handstand: {
    good: () => makeVideoFromLandmarks(goodHandstandLandmarks, 15, 10),
    archedBack: () => makeVideoFromLandmarks(archedHandstandLandmarks, 15, 10),
    /** Long handstand (12s) with hold in middle third */
    longHold: makeLongHandstand,
  },
  planche: {
    /** Static hold with hip sag (zero jitter → reliably detected as hold) */
    hipSag: () => makeVideoFromLandmarks(plancheHipSagLandmarks, 20, 10, 0),
    bentElbow: () => makeVideoFromLandmarks(plancheBentElbowLandmarks, 20, 10, 0),
    /** Entry attempt — progressive lean, no stable hold */
    entry: makePlancheEntry,
    /** Long entry (11s) — best moment is in the second half */
    longEntry: makeLongPlancheEntry,
    /** Long entry with brief good moment + one low-visibility frame in best window */
    briefGoodMoment: makeLongPlancheWithBriefGoodMoment,
    /** Long entry (10s) where best moment is in the final 20% only */
    lateBestMoment: makePlancheLateBestMoment,
    /** Mid-video plateau vs single-frame end peak */
    midPlateauVsEndPeak: makePlancheMidPlateauVsEndPeak,
  },
  swipes: {
    withEvents: makeSwipesWithEvents,
    earlyHandPlant: makeSwipesEarlyHandPlant,
    /** v3.0: 3 hand_plants → 2 cycles → multi_cycle mode */
    multiCycle: makeSwipesMultiCycle,
    /** v3.0: 2 hand_plants → 1 cycle → single_cycle mode */
    singleCycle: makeSwipesSingleCycle,
    /** v3.0: 0 hand_plants → 0 cycles → partial mode (score capped) */
    partial: makeSwipesPartial,
    /** v3.0: multi-cycle with no leg swing motion → low kick_power */
    weakKick: makeSwipesWeakKick,
    /** v3.0: left ankle swings, right is static → kick_asymmetric */
    asymmetricKick: makeSwipesAsymmetricKick,
    /** v3.0: low wrist/ankle visibility → quality impact warnings */
    lowVisibility: makeSwipesLowVisibility,
  },
  /** Utilities for creating comparison variants */
  split: {
    firstHalf: makeFirstHalf,
    secondHalf: makeSecondHalf,
  },
} as const;
