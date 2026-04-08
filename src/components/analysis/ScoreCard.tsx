"use client";

import { AnalysisResult } from "@/lib/types";

interface ScoreCardProps {
  result: AnalysisResult;
  qualityLevel?: "good" | "reference" | "retry";
  confidenceNote?: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function getScoreRingColor(score: number, isReference: boolean): string {
  if (isReference) return "stroke-yellow-400/60";
  if (score >= 80) return "stroke-green-400";
  if (score >= 60) return "stroke-yellow-400";
  if (score >= 40) return "stroke-orange-400";
  return "stroke-red-400";
}

function getScoreLabel(score: number, isReference: boolean): string {
  const base = score >= 90
    ? "素晴らしい！"
    : score >= 80
      ? "良い"
      : score >= 60
        ? "改善の余地あり"
        : score >= 40
          ? "要練習"
          : "基礎から見直そう";
  return isReference ? `参考: ${base}` : base;
}

export default function ScoreCard({ result, qualityLevel, confidenceNote }: ScoreCardProps) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (result.score / 100) * circumference;
  const isReference = qualityLevel === "reference";

  return (
    <div className={`rounded-xl p-6 border ${
      isReference
        ? "bg-gray-800/50 border-yellow-500/30"
        : "bg-gray-800/50 border-gray-700"
    }`}>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-200">
          {isReference ? "参考スコア" : "フォームスコア"}
        </h3>
        {isReference && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/40 text-yellow-300">
            参考値
          </span>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Score Ring */}
        <div className="relative w-32 h-32 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-gray-700"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className={getScoreRingColor(result.score, isReference)}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`text-3xl font-bold ${isReference ? "text-yellow-400/70" : getScoreColor(result.score)}`}
            >
              {result.score}
            </span>
            <span className="text-xs text-gray-400">/100</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-xl font-medium ${isReference ? "text-yellow-400/80" : getScoreColor(result.score)}`}>
            {getScoreLabel(result.score, isReference)}
          </p>
          <p className="text-sm text-gray-400 mt-1">{result.summary}</p>
          {confidenceNote && (
            <p className="text-xs text-gray-500 mt-2">{confidenceNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}
