"use client";

import { AnalysisResult } from "@/lib/types";

interface ScoreCardProps {
  result: AnalysisResult;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function getScoreRingColor(score: number): string {
  if (score >= 80) return "stroke-green-400";
  if (score >= 60) return "stroke-yellow-400";
  if (score >= 40) return "stroke-orange-400";
  return "stroke-red-400";
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "素晴らしい！";
  if (score >= 80) return "良い";
  if (score >= 60) return "改善の余地あり";
  if (score >= 40) return "要練習";
  return "基礎から見直そう";
}

export default function ScoreCard({ result }: ScoreCardProps) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (result.score / 100) * circumference;

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-gray-200 mb-4">
        フォームスコア
      </h3>

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
              className={getScoreRingColor(result.score)}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`text-3xl font-bold ${getScoreColor(result.score)}`}
            >
              {result.score}
            </span>
            <span className="text-xs text-gray-400">/100</span>
          </div>
        </div>

        <div>
          <p className={`text-xl font-medium ${getScoreColor(result.score)}`}>
            {getScoreLabel(result.score)}
          </p>
          <p className="text-sm text-gray-400 mt-1">{result.summary}</p>
        </div>
      </div>
    </div>
  );
}
