"use client";

import { useEffect, useRef } from "react";
import { Landmark, CenterOfGravity } from "@/lib/types";

// MediaPipe pose connections for drawing skeleton lines
const POSE_CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], // shoulders
  [11, 23], // left shoulder to left hip
  [12, 24], // right shoulder to right hip
  [23, 24], // hips
  // Left arm
  [11, 13],
  [13, 15],
  // Right arm
  [12, 14],
  [14, 16],
  // Left leg
  [23, 25],
  [25, 27],
  // Right leg
  [24, 26],
  [26, 28],
  // Face
  [0, 11],
  [0, 12],
];

interface PoseCanvasProps {
  imageUrl: string;
  landmarks: Landmark[] | null;
  cog?: CenterOfGravity | null;
  width?: number;
  height?: number;
  highlightJoints?: number[];
}

export default function PoseCanvas({
  imageUrl,
  landmarks,
  cog,
  width,
  height,
  highlightJoints,
}: PoseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;

      const displayWidth = width || img.naturalWidth;
      const displayHeight = height || img.naturalHeight;

      // Maintain aspect ratio
      const aspect = img.naturalWidth / img.naturalHeight;
      let canvasWidth = displayWidth;
      let canvasHeight = displayWidth / aspect;

      if (canvasHeight > displayHeight) {
        canvasHeight = displayHeight;
        canvasWidth = displayHeight * aspect;
      }

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // Draw image
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

      // Draw landmarks if available
      if (landmarks) {
        drawSkeleton(ctx, landmarks, canvasWidth, canvasHeight, highlightJoints);

        // Draw center of gravity if available
        if (cog) {
          drawCenterOfGravity(ctx, cog, canvasWidth, canvasHeight);
        }
      }
    };
    img.src = imageUrl;
  }, [imageUrl, landmarks, cog, width, height, highlightJoints]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full h-auto rounded-lg"
      style={{ maxHeight: height || 600 }}
    />
  );
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  highlightJoints?: number[]
) {
  // Draw connections
  ctx.strokeStyle = "rgba(0, 255, 136, 0.8)";
  ctx.lineWidth = 3;

  for (const [start, end] of POSE_CONNECTIONS) {
    const startLm = landmarks[start];
    const endLm = landmarks[end];

    if (startLm.visibility > 0.3 && endLm.visibility > 0.3) {
      ctx.beginPath();
      ctx.moveTo(startLm.x * width, startLm.y * height);
      ctx.lineTo(endLm.x * width, endLm.y * height);
      ctx.stroke();
    }
  }

  // Draw landmark points
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (lm.visibility < 0.3) continue;

    const x = lm.x * width;
    const y = lm.y * height;

    const isHighlighted = highlightJoints?.includes(i);

    ctx.beginPath();
    ctx.arc(x, y, isHighlighted ? 8 : 5, 0, 2 * Math.PI);
    ctx.fillStyle = isHighlighted
      ? "rgba(255, 50, 50, 0.9)"
      : "rgba(0, 255, 136, 0.9)";
    ctx.fill();

    if (isHighlighted) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawCenterOfGravity(
  ctx: CanvasRenderingContext2D,
  cog: CenterOfGravity,
  width: number,
  height: number
) {
  const x = cog.x * width;
  const y = cog.y * height;

  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255, 200, 0, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner dot
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(255, 200, 0, 0.9)";
  ctx.fill();

  // Label
  ctx.fillStyle = "rgba(255, 200, 0, 1)";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("CoG", x + 16, y + 4);
}
