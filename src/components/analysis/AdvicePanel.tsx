"use client";

import {
  Dumbbell,
  StretchHorizontal,
  Flame,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { AnalysisResult } from "@/lib/types";

interface AdvicePanelProps {
  result: AnalysisResult;
}

const ADVICE_ICONS = {
  training: Dumbbell,
  stretch: StretchHorizontal,
  warmup: Flame,
  injury_prevention: ShieldAlert,
} as const;

const ADVICE_LABELS = {
  training: "筋力トレーニング",
  stretch: "ストレッチ",
  warmup: "ウォームアップ",
  injury_prevention: "怪我予防",
} as const;

const ADVICE_COLORS = {
  training: "border-blue-500/30 bg-blue-500/5",
  stretch: "border-purple-500/30 bg-purple-500/5",
  warmup: "border-orange-500/30 bg-orange-500/5",
  injury_prevention: "border-red-500/30 bg-red-500/5",
} as const;

const PRIORITY_COLORS = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  3: "bg-blue-500/20 text-blue-400 border-blue-500/30",
} as const;

export default function AdvicePanel({ result }: AdvicePanelProps) {
  const [expandedIssue, setExpandedIssue] = useState<number | null>(0);

  return (
    <div className="space-y-6">
      {/* Issues */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          改善ポイント
        </h3>

        <div className="space-y-3">
          {result.issues.map((issue, index) => (
            <div
              key={index}
              className="border border-gray-700 rounded-lg overflow-hidden"
            >
              <button
                onClick={() =>
                  setExpandedIssue(expandedIssue === index ? null : index)
                }
                className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded border ${
                      PRIORITY_COLORS[
                        issue.priority as keyof typeof PRIORITY_COLORS
                      ] || PRIORITY_COLORS[3]
                    }`}
                  >
                    優先度 {issue.priority}
                  </span>
                  <span className="font-medium text-gray-200">
                    {issue.body_part}
                  </span>
                </div>
                {expandedIssue === index ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {expandedIssue === index && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-gray-300">{issue.description}</p>

                  {issue.ideal_angle != null && issue.actual_angle != null && (
                    <div className="flex gap-4 text-xs">
                      <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded">
                        理想: {issue.ideal_angle}°
                      </span>
                      <span className="px-2 py-1 bg-red-500/10 text-red-400 rounded">
                        現在: {issue.actual_angle}°
                      </span>
                      <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded">
                        差分:{" "}
                        {Math.abs(issue.ideal_angle - issue.actual_angle).toFixed(1)}°
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Advice */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-gray-200 mb-4">
          具体的なアドバイス
        </h3>

        <div className="space-y-3">
          {result.advice.map((advice, index) => {
            const Icon = ADVICE_ICONS[advice.type];
            const label = ADVICE_LABELS[advice.type];
            const colorClass = ADVICE_COLORS[advice.type];

            return (
              <div
                key={index}
                className={`border rounded-lg p-4 ${colorClass}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-gray-500">
                    (改善ポイント {advice.related_issue} に対応)
                  </span>
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">
                  {advice.content}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
