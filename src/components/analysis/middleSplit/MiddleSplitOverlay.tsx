"use client";

/**
 * SVG overlay that visualises middle_split analysis results on top of the
 * user's uploaded image. Draws:
 *
 * - Leg lines (hip → ankle) with verdict-based colours
 * - Split angle arc + label (the hero metric)
 * - Pelvis line (hip-to-hip) with roll indicator
 * - Trunk reference line (hip midpoint → shoulder midpoint)
 *
 * Landmark coordinates are MediaPipe's normalised values (0–1). The SVG
 * viewBox is set to match the image's natural pixel dimensions so that
 * `(lm.x * natW, lm.y * natH)` maps 1:1 onto the overlay.
 *
 * The component is intentionally thin — all measured values come from props
 * so that this remains a pure rendering leaf.
 */

import { useState, useCallback } from "react";
import type { Landmark } from "@/lib/types";

// MediaPipe indices we care about
const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

const MIN_VISIBILITY = 0.3;

interface MiddleSplitOverlayProps {
  imageUrl: string;
  landmarks: Landmark[];
  features: {
    splitAngleRaw: number;
    leftRightAngleDiff: number;
    pelvisRollAngle: number;
    trunkLeanAngle: number;
    frontalityScore: number;
  };
}

export default function MiddleSplitOverlay({
  imageUrl,
  landmarks,
  features,
}: MiddleSplitOverlayProps) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const onImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [],
  );

  // Shorthand: scale a landmark to viewBox coordinates
  const lx = (idx: number) => landmarks[idx].x * (dims?.w ?? 1);
  const ly = (idx: number) => landmarks[idx].y * (dims?.h ?? 1);
  const vis = (idx: number) => landmarks[idx].visibility >= MIN_VISIBILITY;

  const hasLegs =
    vis(LM.LEFT_HIP) &&
    vis(LM.RIGHT_HIP) &&
    vis(LM.LEFT_ANKLE) &&
    vis(LM.RIGHT_ANKLE);
  const hasTrunk =
    vis(LM.LEFT_SHOULDER) && vis(LM.RIGHT_SHOULDER) && hasLegs;

  // Hip midpoint
  const hipMidX = (lx(LM.LEFT_HIP) + lx(LM.RIGHT_HIP)) / 2;
  const hipMidY = (ly(LM.LEFT_HIP) + ly(LM.RIGHT_HIP)) / 2;

  return (
    <div className="relative rounded-lg overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="分析画像"
        className="w-full h-auto block"
        onLoad={onImgLoad}
      />
      {dims && hasLegs && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="overlay-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Leg lines: hip → ankle */}
          <LegLine
            x1={lx(LM.LEFT_HIP)}
            y1={ly(LM.LEFT_HIP)}
            x2={lx(LM.LEFT_ANKLE)}
            y2={ly(LM.LEFT_ANKLE)}
            side="left"
          />
          <LegLine
            x1={lx(LM.RIGHT_HIP)}
            y1={ly(LM.RIGHT_HIP)}
            x2={lx(LM.RIGHT_ANKLE)}
            y2={ly(LM.RIGHT_ANKLE)}
            side="right"
          />

          {/* Pelvis line */}
          <line
            x1={lx(LM.LEFT_HIP)}
            y1={ly(LM.LEFT_HIP)}
            x2={lx(LM.RIGHT_HIP)}
            y2={ly(LM.RIGHT_HIP)}
            stroke="rgba(168, 85, 247, 0.7)"
            strokeWidth={scaledStroke(dims, 2.5)}
            strokeDasharray={`${scaledStroke(dims, 6)} ${scaledStroke(dims, 4)}`}
          />

          {/* Trunk reference line */}
          {hasTrunk && (
            <TrunkLine
              hipMidX={hipMidX}
              hipMidY={hipMidY}
              shoulderMidX={
                (lx(LM.LEFT_SHOULDER) + lx(LM.RIGHT_SHOULDER)) / 2
              }
              shoulderMidY={
                (ly(LM.LEFT_SHOULDER) + ly(LM.RIGHT_SHOULDER)) / 2
              }
              trunkLean={features.trunkLeanAngle}
              dims={dims}
            />
          )}

          {/* Split angle arc + label */}
          <SplitAngleArc
            hipMidX={hipMidX}
            hipMidY={hipMidY}
            leftAnkleX={lx(LM.LEFT_ANKLE)}
            leftAnkleY={ly(LM.LEFT_ANKLE)}
            rightAnkleX={lx(LM.RIGHT_ANKLE)}
            rightAnkleY={ly(LM.RIGHT_ANKLE)}
            splitAngle={features.splitAngleRaw}
            dims={dims}
          />

          {/* Joint dots */}
          {[
            LM.LEFT_HIP,
            LM.RIGHT_HIP,
            LM.LEFT_ANKLE,
            LM.RIGHT_ANKLE,
          ].map(
            (idx) =>
              vis(idx) && (
                <circle
                  key={idx}
                  cx={lx(idx)}
                  cy={ly(idx)}
                  r={scaledStroke(dims, 4)}
                  fill="rgba(168, 85, 247, 0.9)"
                  stroke="white"
                  strokeWidth={scaledStroke(dims, 1.5)}
                />
              ),
          )}

          {/* Pelvis roll badge */}
          <MetricBadge
            x={hipMidX}
            y={hipMidY - scaledStroke(dims, 20)}
            label={`骨盤傾き ${Math.round(features.pelvisRollAngle)}°`}
            severity={features.pelvisRollAngle > 8 ? "warn" : "ok"}
            dims={dims}
          />

          {/* Left/right diff badge */}
          {features.leftRightAngleDiff > 3 && (
            <MetricBadge
              x={hipMidX}
              y={hipMidY + scaledStroke(dims, 50)}
              label={`左右差 ${Math.round(features.leftRightAngleDiff)}°`}
              severity={features.leftRightAngleDiff > 8 ? "warn" : "info"}
              dims={dims}
            />
          )}

          {/* Trunk lean badge */}
          {hasTrunk && features.trunkLeanAngle > 5 && (
            <MetricBadge
              x={
                (lx(LM.LEFT_SHOULDER) + lx(LM.RIGHT_SHOULDER)) / 2
              }
              y={
                (ly(LM.LEFT_SHOULDER) + ly(LM.RIGHT_SHOULDER)) / 2 -
                scaledStroke(dims, 14)
              }
              label={`体幹 ${Math.round(features.trunkLeanAngle)}°`}
              severity={features.trunkLeanAngle > 10 ? "warn" : "info"}
              dims={dims}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function LegLine({
  x1,
  y1,
  x2,
  y2,
  side,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side: "left" | "right";
}) {
  const color =
    side === "left"
      ? "rgba(56, 189, 248, 0.8)"
      : "rgba(74, 222, 128, 0.8)";
  // Estimate stroke width from the line length (adaptive)
  const len = Math.hypot(x2 - x1, y2 - y1);
  const sw = Math.max(2, len * 0.015);
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      filter="url(#overlay-glow)"
    />
  );
}

function TrunkLine({
  hipMidX,
  hipMidY,
  shoulderMidX,
  shoulderMidY,
  trunkLean,
  dims,
}: {
  hipMidX: number;
  hipMidY: number;
  shoulderMidX: number;
  shoulderMidY: number;
  trunkLean: number;
  dims: { w: number; h: number };
}) {
  const color =
    trunkLean > 10
      ? "rgba(251, 146, 60, 0.7)"
      : "rgba(148, 163, 184, 0.5)";
  return (
    <line
      x1={hipMidX}
      y1={hipMidY}
      x2={shoulderMidX}
      y2={shoulderMidY}
      stroke={color}
      strokeWidth={scaledStroke(dims, 2)}
      strokeDasharray={`${scaledStroke(dims, 8)} ${scaledStroke(dims, 4)}`}
      strokeLinecap="round"
    />
  );
}

function SplitAngleArc({
  hipMidX,
  hipMidY,
  leftAnkleX,
  leftAnkleY,
  rightAnkleX,
  rightAnkleY,
  splitAngle,
  dims,
}: {
  hipMidX: number;
  hipMidY: number;
  leftAnkleX: number;
  leftAnkleY: number;
  rightAnkleX: number;
  rightAnkleY: number;
  splitAngle: number;
  dims: { w: number; h: number };
}) {
  // Compute leg directions
  const leftDir = Math.atan2(leftAnkleY - hipMidY, leftAnkleX - hipMidX);
  const rightDir = Math.atan2(rightAnkleY - hipMidY, rightAnkleX - hipMidX);

  // Arc radius — adaptive to image size
  const legLen = Math.max(
    Math.hypot(leftAnkleX - hipMidX, leftAnkleY - hipMidY),
    Math.hypot(rightAnkleX - hipMidX, rightAnkleY - hipMidY),
  );
  const r = Math.min(legLen * 0.25, Math.min(dims.w, dims.h) * 0.12);

  // Arc endpoints
  const sx = hipMidX + r * Math.cos(leftDir);
  const sy = hipMidY + r * Math.sin(leftDir);
  const ex = hipMidX + r * Math.cos(rightDir);
  const ey = hipMidY + r * Math.sin(rightDir);

  // Determine sweep: we want the arc to go through the "bottom" (legs side).
  // In SVG, Y increases downward. The legs are generally below the hips.
  // We compute the "bottom" midpoint to decide sweep direction.
  const midAngle = (leftDir + rightDir) / 2;
  const altMidAngle = midAngle + Math.PI;
  // The correct mid-direction should point generally downward (positive Y)
  const useAlt = Math.sin(midAngle) < Math.sin(altMidAngle);
  const angleDiff = splitAngle;
  const largeArc = angleDiff > 180 ? 1 : 0;
  // sweep=1 means clockwise in SVG. We need to go from left ankle dir to
  // right ankle dir through the bottom.
  const sweep = useAlt ? 0 : 1;

  // Angle label position: at the midpoint of the arc
  const labelAngle = useAlt ? altMidAngle : midAngle;
  const labelR = r + scaledStroke(dims, 14);
  const labelX = hipMidX + labelR * Math.cos(labelAngle);
  const labelY = hipMidY + labelR * Math.sin(labelAngle);

  const arcColor =
    splitAngle >= 170
      ? "rgba(74, 222, 128, 0.9)"
      : splitAngle >= 150
        ? "rgba(250, 204, 21, 0.9)"
        : splitAngle >= 120
          ? "rgba(251, 146, 60, 0.9)"
          : "rgba(248, 113, 113, 0.9)";

  const fontSize = scaledStroke(dims, 16);
  const bgPadH = scaledStroke(dims, 6);
  const bgPadV = scaledStroke(dims, 3);
  const textWidth = fontSize * 2.5; // rough estimate for "150°"

  return (
    <g>
      <path
        d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} ${sweep} ${ex} ${ey}`}
        fill="none"
        stroke={arcColor}
        strokeWidth={scaledStroke(dims, 3)}
        strokeLinecap="round"
        filter="url(#overlay-glow)"
      />
      {/* Angle value label */}
      <rect
        x={labelX - textWidth / 2 - bgPadH}
        y={labelY - fontSize / 2 - bgPadV}
        width={textWidth + bgPadH * 2}
        height={fontSize + bgPadV * 2}
        rx={scaledStroke(dims, 4)}
        fill="rgba(0, 0, 0, 0.7)"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={arcColor}
        fontSize={fontSize}
        fontWeight="bold"
        fontFamily="ui-monospace, monospace"
      >
        {Math.round(splitAngle)}°
      </text>
    </g>
  );
}

function MetricBadge({
  x,
  y,
  label,
  severity,
  dims,
}: {
  x: number;
  y: number;
  label: string;
  severity: "ok" | "info" | "warn";
  dims: { w: number; h: number };
}) {
  const fontSize = scaledStroke(dims, 11);
  const padH = scaledStroke(dims, 5);
  const padV = scaledStroke(dims, 3);
  const textWidth = label.length * fontSize * 0.55;

  const fill =
    severity === "warn"
      ? "rgba(251, 146, 60, 0.9)"
      : severity === "info"
        ? "rgba(148, 163, 184, 0.8)"
        : "rgba(74, 222, 128, 0.8)";

  return (
    <g>
      <rect
        x={x - textWidth / 2 - padH}
        y={y - fontSize / 2 - padV}
        width={textWidth + padH * 2}
        height={fontSize + padV * 2}
        rx={scaledStroke(dims, 3)}
        fill="rgba(0, 0, 0, 0.65)"
        stroke={fill}
        strokeWidth={scaledStroke(dims, 0.8)}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={fill}
        fontSize={fontSize}
        fontFamily="ui-monospace, monospace"
      >
        {label}
      </text>
    </g>
  );
}

// ── Helpers ─────────────────────────────────────────────

/** Scale stroke/radius relative to image diagonal so the overlay looks
 *  proportional regardless of resolution. Baseline: 1000px diagonal. */
function scaledStroke(dims: { w: number; h: number }, base: number): number {
  const diag = Math.hypot(dims.w, dims.h);
  return base * (diag / 1000);
}
