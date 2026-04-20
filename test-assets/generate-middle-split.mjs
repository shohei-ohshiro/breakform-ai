#!/usr/bin/env node
/**
 * Generate middle_split test assets: SVG stick-figure images + JSON landmark fixtures.
 *
 * Each scenario produces:
 *   middle_split/<name>.svg   — visual reference
 *   middle_split/_fixtures/<name>.json — MediaPipe-compatible landmark array
 *
 * Usage:  node test-assets/generate-middle-split.mjs
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_SVG = join(__dirname, "middle_split");
const OUT_JSON = join(__dirname, "middle_split", "_fixtures");

// MediaPipe landmark indices
const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

// ────────────────────────────────────────────────────────
// Landmark generator (mirrors src/__tests__/analysis/mock-data.ts)
// ────────────────────────────────────────────────────────

function makeMiddleSplitLandmarks({
  splitAngleDeg = 170,
  pelvisRollDeg = 0,
  trunkLeanDeg = 0,
  trunkLeanDir = "right", // "left" | "right" | "forward"
  leftKneeBendDeg = 0, // extra bend away from 180
  rightKneeBendDeg = 0,
  asymmetryDeg = 0, // + means right leg higher
  visibility = 0.9,
} = {}) {
  const lm = new Array(33).fill(null).map(() => ({
    x: 0.5, y: 0.5, z: 0, visibility,
  }));

  const halfTilt = ((180 - splitAngleDeg) / 2) * (Math.PI / 180);
  const asymRad = (asymmetryDeg / 2) * (Math.PI / 180);
  const legLen = 0.32;
  const thighLen = 0.17;

  // Pelvis roll — rotate hip positions around midpoint
  const hipY = 0.55;
  const hipSpread = 0.04;
  const rollRad = pelvisRollDeg * (Math.PI / 180);
  const lHipX = 0.5 - hipSpread * Math.cos(rollRad);
  const lHipY = hipY - hipSpread * Math.sin(rollRad);
  const rHipX = 0.5 + hipSpread * Math.cos(rollRad);
  const rHipY = hipY + hipSpread * Math.sin(rollRad);

  lm[LM.LEFT_HIP] = { x: lHipX, y: lHipY, z: 0, visibility: 0.95 };
  lm[LM.RIGHT_HIP] = { x: rHipX, y: rHipY, z: 0, visibility: 0.95 };

  // Left leg (extends to left)
  const leftTilt = halfTilt + asymRad;
  const leftKneeRad = leftKneeBendDeg * (Math.PI / 180);
  lm[LM.LEFT_KNEE] = {
    x: lHipX - Math.cos(leftTilt) * thighLen,
    y: lHipY + Math.sin(leftTilt) * thighLen,
    z: 0, visibility: 0.9,
  };
  // Knee bend: ankle drops below the straight line
  const leftLegAngle = leftTilt + leftKneeRad;
  lm[LM.LEFT_ANKLE] = {
    x: lHipX - Math.cos(leftTilt) * thighLen - Math.cos(leftLegAngle) * (legLen - thighLen),
    y: lHipY + Math.sin(leftTilt) * thighLen + Math.sin(leftLegAngle) * (legLen - thighLen),
    z: 0, visibility: 0.9,
  };

  // Right leg (extends to right)
  const rightTilt = halfTilt - asymRad;
  const rightKneeRad = rightKneeBendDeg * (Math.PI / 180);
  lm[LM.RIGHT_KNEE] = {
    x: rHipX + Math.cos(rightTilt) * thighLen,
    y: rHipY + Math.sin(rightTilt) * thighLen,
    z: 0, visibility: 0.9,
  };
  const rightLegAngle = rightTilt + rightKneeRad;
  lm[LM.RIGHT_ANKLE] = {
    x: rHipX + Math.cos(rightTilt) * thighLen + Math.cos(rightLegAngle) * (legLen - thighLen),
    y: rHipY + Math.sin(rightTilt) * thighLen + Math.sin(rightLegAngle) * (legLen - thighLen),
    z: 0, visibility: 0.9,
  };

  // Feet
  lm[LM.LEFT_FOOT_INDEX] = {
    x: lm[LM.LEFT_ANKLE].x - 0.02, y: lm[LM.LEFT_ANKLE].y, z: 0, visibility: 0.85,
  };
  lm[LM.RIGHT_FOOT_INDEX] = {
    x: lm[LM.RIGHT_ANKLE].x + 0.02, y: lm[LM.RIGHT_ANKLE].y, z: 0, visibility: 0.85,
  };
  lm[LM.LEFT_HEEL] = {
    x: lm[LM.LEFT_ANKLE].x + 0.01, y: lm[LM.LEFT_ANKLE].y + 0.01, z: 0, visibility: 0.8,
  };
  lm[LM.RIGHT_HEEL] = {
    x: lm[LM.RIGHT_ANKLE].x - 0.01, y: lm[LM.RIGHT_ANKLE].y + 0.01, z: 0, visibility: 0.8,
  };

  // Trunk — apply lean
  const trunkLen = 0.22;
  const leanRad = trunkLeanDeg * (Math.PI / 180);
  const hipMidX = (lHipX + rHipX) / 2;
  const hipMidY = (lHipY + rHipY) / 2;
  let trunkDx = 0;
  let trunkDz = 0;
  if (trunkLeanDir === "right") trunkDx = Math.sin(leanRad) * trunkLen;
  else if (trunkLeanDir === "left") trunkDx = -Math.sin(leanRad) * trunkLen;
  else if (trunkLeanDir === "forward") trunkDz = 0.1;
  const shoulderMidX = hipMidX + trunkDx;
  const shoulderMidY = hipMidY - Math.cos(leanRad) * trunkLen;
  const shoulderSpread = 0.04;

  lm[LM.LEFT_SHOULDER] = { x: shoulderMidX - shoulderSpread, y: shoulderMidY, z: trunkDz, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER] = { x: shoulderMidX + shoulderSpread, y: shoulderMidY, z: trunkDz, visibility: 0.95 };

  // Arms hang down beside trunk
  lm[LM.LEFT_ELBOW] = { x: shoulderMidX - shoulderSpread - 0.04, y: shoulderMidY + 0.12, z: 0, visibility: 0.85 };
  lm[LM.RIGHT_ELBOW] = { x: shoulderMidX + shoulderSpread + 0.04, y: shoulderMidY + 0.12, z: 0, visibility: 0.85 };
  lm[LM.LEFT_WRIST] = { x: shoulderMidX - shoulderSpread - 0.06, y: shoulderMidY + 0.22, z: 0, visibility: 0.8 };
  lm[LM.RIGHT_WRIST] = { x: shoulderMidX + shoulderSpread + 0.06, y: shoulderMidY + 0.22, z: 0, visibility: 0.8 };

  // Hands
  lm[LM.LEFT_PINKY] = { ...lm[LM.LEFT_WRIST], x: lm[LM.LEFT_WRIST].x - 0.01, visibility: 0.75 };
  lm[LM.RIGHT_PINKY] = { ...lm[LM.RIGHT_WRIST], x: lm[LM.RIGHT_WRIST].x + 0.01, visibility: 0.75 };
  lm[LM.LEFT_INDEX] = { ...lm[LM.LEFT_WRIST], y: lm[LM.LEFT_WRIST].y + 0.02, visibility: 0.75 };
  lm[LM.RIGHT_INDEX] = { ...lm[LM.RIGHT_WRIST], y: lm[LM.RIGHT_WRIST].y + 0.02, visibility: 0.75 };
  lm[LM.LEFT_THUMB] = { ...lm[LM.LEFT_WRIST], x: lm[LM.LEFT_WRIST].x + 0.01, visibility: 0.75 };
  lm[LM.RIGHT_THUMB] = { ...lm[LM.RIGHT_WRIST], x: lm[LM.RIGHT_WRIST].x - 0.01, visibility: 0.75 };

  // Head
  const noseY = shoulderMidY - 0.11;
  lm[LM.NOSE] = { x: shoulderMidX, y: noseY, z: 0, visibility: 0.95 };
  lm[LM.LEFT_EAR] = { x: shoulderMidX - 0.03, y: noseY - 0.01, z: 0.02, visibility: 0.8 };
  lm[LM.RIGHT_EAR] = { x: shoulderMidX + 0.03, y: noseY - 0.01, z: 0.02, visibility: 0.8 };
  lm[LM.LEFT_EYE] = { x: shoulderMidX - 0.015, y: noseY - 0.015, z: 0, visibility: 0.85 };
  lm[LM.RIGHT_EYE] = { x: shoulderMidX + 0.015, y: noseY - 0.015, z: 0, visibility: 0.85 };
  lm[LM.LEFT_EYE_INNER] = { x: shoulderMidX - 0.008, y: noseY - 0.015, z: 0, visibility: 0.8 };
  lm[LM.RIGHT_EYE_INNER] = { x: shoulderMidX + 0.008, y: noseY - 0.015, z: 0, visibility: 0.8 };
  lm[LM.LEFT_EYE_OUTER] = { x: shoulderMidX - 0.022, y: noseY - 0.015, z: 0, visibility: 0.8 };
  lm[LM.RIGHT_EYE_OUTER] = { x: shoulderMidX + 0.022, y: noseY - 0.015, z: 0, visibility: 0.8 };
  lm[LM.MOUTH_LEFT] = { x: shoulderMidX - 0.012, y: noseY + 0.015, z: 0, visibility: 0.8 };
  lm[LM.MOUTH_RIGHT] = { x: shoulderMidX + 0.012, y: noseY + 0.015, z: 0, visibility: 0.8 };

  return lm;
}

// ────────────────────────────────────────────────────────
// SVG renderer
// ────────────────────────────────────────────────────────

const W = 600;
const H = 700;

const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
  [0, 11], [0, 12],
];

function lx(lm, idx) { return lm[idx].x * W; }
function ly(lm, idx) { return lm[idx].y * H; }

function renderSvg(lm, title, subtitle, meta) {
  const lines = CONNECTIONS.map(([a, b]) => {
    if (lm[a].visibility < 0.3 || lm[b].visibility < 0.3) return "";
    const color =
      (a === 23 && b === 25) || (a === 25 && b === 27) || (a === 27 && b === 31)
        ? "#38bdf8"
        : (a === 24 && b === 26) || (a === 26 && b === 28) || (a === 28 && b === 32)
          ? "#4ade80"
          : "#94a3b8";
    return `  <line x1="${lx(lm,a).toFixed(1)}" y1="${ly(lm,a).toFixed(1)}" x2="${lx(lm,b).toFixed(1)}" y2="${ly(lm,b).toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
  }).filter(Boolean).join("\n");

  const dots = [
    LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST,
    LM.LEFT_HIP, LM.RIGHT_HIP,
    LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
  ].map((idx) => {
    if (lm[idx].visibility < 0.3) return "";
    const isHip = idx === LM.LEFT_HIP || idx === LM.RIGHT_HIP;
    const isAnkle = idx === LM.LEFT_ANKLE || idx === LM.RIGHT_ANKLE;
    const r = isHip || isAnkle ? 5 : 3.5;
    const fill = isHip ? "#a855f7" : isAnkle ? "#f97316" : "#e2e8f0";
    return `  <circle cx="${lx(lm,idx).toFixed(1)}" cy="${ly(lm,idx).toFixed(1)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
  }).filter(Boolean).join("\n");

  // Split angle arc
  const hipMidX = (lx(lm, LM.LEFT_HIP) + lx(lm, LM.RIGHT_HIP)) / 2;
  const hipMidY = (ly(lm, LM.LEFT_HIP) + ly(lm, LM.RIGHT_HIP)) / 2;
  const laX = lx(lm, LM.LEFT_ANKLE);
  const laY = ly(lm, LM.LEFT_ANKLE);
  const raX = lx(lm, LM.RIGHT_ANKLE);
  const raY = ly(lm, LM.RIGHT_ANKLE);
  const leftDir = Math.atan2(laY - hipMidY, laX - hipMidX);
  const rightDir = Math.atan2(raY - hipMidY, raX - hipMidX);
  const arcR = 60;
  const asx = hipMidX + arcR * Math.cos(leftDir);
  const asy = hipMidY + arcR * Math.sin(leftDir);
  const aex = hipMidX + arcR * Math.cos(rightDir);
  const aey = hipMidY + arcR * Math.sin(rightDir);
  const largeArc = meta.splitAngle > 180 ? 1 : 0;
  const arcPath = `M ${asx.toFixed(1)} ${asy.toFixed(1)} A ${arcR} ${arcR} 0 ${largeArc} 1 ${aex.toFixed(1)} ${aey.toFixed(1)}`;
  const arcColor = meta.splitAngle >= 170 ? "#4ade80" : meta.splitAngle >= 150 ? "#facc15" : meta.splitAngle >= 120 ? "#fb923c" : "#f87171";

  // Label position
  const midAngle = (leftDir + rightDir) / 2;
  const labelR = arcR + 18;
  const labelX = hipMidX + labelR * Math.cos(midAngle);
  const labelY = hipMidY + labelR * Math.sin(midAngle);

  // Meta info lines
  const metaLines = Object.entries(meta)
    .map(([k, v], i) => `  <text x="12" y="${H - 10 - (Object.keys(meta).length - 1 - i) * 16}" font-size="11" fill="#64748b" font-family="monospace">${k}: ${v}</text>`)
    .join("\n");

  // Floor line
  const floorY = Math.max(ly(lm, LM.LEFT_ANKLE), ly(lm, LM.RIGHT_ANKLE)) + 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0f172a"/>

  <!-- Floor -->
  <line x1="20" y1="${floorY.toFixed(0)}" x2="${W-20}" y2="${floorY.toFixed(0)}" stroke="#334155" stroke-width="1" stroke-dasharray="8 4"/>

  <!-- Skeleton -->
${lines}
${dots}

  <!-- Split angle arc -->
  <path d="${arcPath}" fill="none" stroke="${arcColor}" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
  <text x="${labelX.toFixed(1)}" y="${(labelY + 4).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="bold" fill="${arcColor}" font-family="monospace">${meta.splitAngle}°</text>

  <!-- Title -->
  <text x="${W/2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#e2e8f0" font-family="sans-serif">${title}</text>
  <text x="${W/2}" y="48" text-anchor="middle" font-size="12" fill="#94a3b8" font-family="sans-serif">${subtitle}</text>

  <!-- Meta -->
${metaLines}
</svg>
`;
}

// ────────────────────────────────────────────────────────
// Scenario definitions
// ────────────────────────────────────────────────────────

const SCENARIOS = [
  // --- Basic flexibility levels (good form) ---
  {
    name: "stiff_90deg",
    title: "硬い人 (90°)",
    subtitle: "開脚初心者 — 膝がやや開く程度",
    params: { splitAngleDeg: 90 },
  },
  {
    name: "stiff_110deg",
    title: "硬い人 (110°)",
    subtitle: "週1ストレッチ程度の柔軟性",
    params: { splitAngleDeg: 110 },
  },
  {
    name: "average_130deg",
    title: "普通の人 (130°)",
    subtitle: "定期的にストレッチしている人",
    params: { splitAngleDeg: 130 },
  },
  {
    name: "average_150deg",
    title: "普通〜柔らかめ (150°)",
    subtitle: "柔軟性が高いが180°には届かない",
    params: { splitAngleDeg: 150 },
  },
  {
    name: "flexible_170deg",
    title: "柔らかい人 (170°)",
    subtitle: "ほぼフルスプリット寸前",
    params: { splitAngleDeg: 170 },
  },
  {
    name: "full_split_178deg",
    title: "柔らかい人 (178°)",
    subtitle: "ほぼ完璧な180度開脚",
    params: { splitAngleDeg: 178 },
  },

  // --- Form issue patterns ---
  {
    name: "stiff_with_knee_bend",
    title: "硬い + 膝曲がり (110°)",
    subtitle: "膝を曲げて代償するパターン",
    params: { splitAngleDeg: 110, leftKneeBendDeg: 15, rightKneeBendDeg: 20 },
  },
  {
    name: "average_with_pelvis_roll",
    title: "普通 + 骨盤傾き (140°)",
    subtitle: "骨盤が左右に12°傾いている",
    params: { splitAngleDeg: 140, pelvisRollDeg: 12 },
  },
  {
    name: "average_with_trunk_lean",
    title: "普通 + 体幹傾き (140°)",
    subtitle: "上半身が右に20°傾いている",
    params: { splitAngleDeg: 140, trunkLeanDeg: 20, trunkLeanDir: "right" },
  },
  {
    name: "average_asymmetric",
    title: "普通 + 左右差 (140°)",
    subtitle: "右脚が15°高く上がっている（非対称）",
    params: { splitAngleDeg: 140, asymmetryDeg: 15 },
  },
  {
    name: "flexible_with_forward_lean",
    title: "柔らかい + 前傾 (165°)",
    subtitle: "体幹が前に15°傾いて代償",
    params: { splitAngleDeg: 165, trunkLeanDeg: 15, trunkLeanDir: "forward" },
  },
  {
    name: "stiff_all_issues",
    title: "硬い + 複合課題 (100°)",
    subtitle: "膝曲がり + 骨盤傾き + 左右差 + 体幹傾き",
    params: {
      splitAngleDeg: 100,
      leftKneeBendDeg: 20,
      rightKneeBendDeg: 10,
      pelvisRollDeg: 8,
      asymmetryDeg: 10,
      trunkLeanDeg: 12,
      trunkLeanDir: "right",
    },
  },
];

// ────────────────────────────────────────────────────────
// Generate
// ────────────────────────────────────────────────────────

let readmeLines = [
  "# Middle Split Test Assets",
  "",
  "Auto-generated stick-figure images + JSON landmark fixtures.",
  "Re-generate: `node test-assets/generate-middle-split.mjs`",
  "",
  "## Scenarios",
  "",
  "| File | Split Angle | Description |",
  "|------|-------------|-------------|",
];

for (const sc of SCENARIOS) {
  const lm = makeMiddleSplitLandmarks(sc.params);

  const meta = {
    splitAngle: sc.params.splitAngleDeg ?? 170,
    pelvisRoll: sc.params.pelvisRollDeg ?? 0,
    trunkLean: sc.params.trunkLeanDeg ?? 0,
    leftKneeBend: sc.params.leftKneeBendDeg ?? 0,
    rightKneeBend: sc.params.rightKneeBendDeg ?? 0,
    asymmetry: sc.params.asymmetryDeg ?? 0,
  };

  const svg = renderSvg(lm, sc.title, sc.subtitle, meta);
  writeFileSync(join(OUT_SVG, `${sc.name}.svg`), svg);

  const fixture = {
    _comment: `${sc.title} — ${sc.subtitle}`,
    _generator: "generate-middle-split.mjs",
    params: sc.params,
    landmarks: lm,
  };
  writeFileSync(join(OUT_JSON, `${sc.name}.json`), JSON.stringify(fixture, null, 2));

  readmeLines.push(
    `| ${sc.name} | ${meta.splitAngle}° | ${sc.subtitle} |`,
  );

  console.log(`  ${sc.name}.svg + .json`);
}

// Write README
readmeLines.push(
  "",
  "## Usage in tests",
  "",
  "```typescript",
  'import fixture from "../../test-assets/middle_split/_fixtures/average_130deg.json";',
  "const series = makeImageSeries(fixture.landmarks);",
  "const normalized = normalizePoseTimeSeries(series);",
  "const features = extractFeatures(normalized, \"middle_split\");",
  "```",
  "",
  "## SVG images",
  "",
  "Open any `.svg` file in a browser. The stick figure shows:",
  "- Blue lines: left leg (hip -> knee -> ankle)",
  "- Green lines: right leg",
  "- Purple dots: hip joints",
  "- Orange dots: ankle joints",
  "- Coloured arc: split angle (green >= 170, yellow >= 150, orange >= 120, red < 120)",
  "",
);
writeFileSync(join(OUT_SVG, "README.md"), readmeLines.join("\n"));

console.log(`\nDone: ${SCENARIOS.length} scenarios generated.`);
