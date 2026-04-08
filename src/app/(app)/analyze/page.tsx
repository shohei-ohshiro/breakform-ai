"use client";

import { useState, useCallback, useEffect, Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Zap, Info, AlertTriangle, ChevronDown, ChevronUp, Bug } from "lucide-react";
import Link from "next/link";
import VideoUploader from "@/components/analysis/VideoUploader";
import TrickSelector from "@/components/analysis/TrickSelector";
import PoseCanvas from "@/components/analysis/PoseCanvas";
import ScoreCard from "@/components/analysis/ScoreCard";
import AdvicePanel from "@/components/analysis/AdvicePanel";
import {
  Trick,
  Landmark,
  AnalysisResult,
  AnalysisState,
} from "@/lib/types";
import { detectPoseFromImage, extractPoseTimeSeries } from "@/lib/pose/mediapipe";
import { TechniqueId, SamplingInfo } from "@/lib/analysis/types";

const STATE_MESSAGES: Record<AnalysisState, string> = {
  idle: "",
  uploading: "ファイルを読み込み中...",
  detecting: "骨格を検出中...(初回はモデルのダウンロードに時間がかかります)",
  analyzing: "AIがフォームを分析中...",
  complete: "",
  error: "エラーが発生しました",
};

interface ViolationItem {
  ruleId: string;
  severity: string;
  status?: string;
  bodyPart: string;
  message: string;
  actual: number;
  ideal: number;
  threshold?: { warn: number; fail: number };
  deviation?: number;
  unit: string;
  confidence?: number;
  scoreImpact?: number;
}

interface BreakdownItem {
  category: string;
  label: string;
  score: number;
  weight: number;
  violations?: ViolationItem[];
  measurements?: Record<string, number>;
}

interface CoverageInfoUI {
  fullScanPerformed: boolean;
  coarseScanTimeRange: [number, number];
  finalScoringWindow: {
    startTime: number;
    endTime: number;
    reason: string;
  };
  analysisPhases: {
    phase: string;
    description: string;
    timeRange: [number, number];
    frameCount: number;
  }[];
  summary: string;
}

interface ExtendedResult extends AnalysisResult {
  qualityCheck?: {
    passed: boolean;
    overallScore: number;
    warnings: string[];
  };
  viewpoint?: string;
  breakdown?: BreakdownItem[];
  qualityLevel?: "good" | "reference" | "retry";
  qualityExplanation?: string;
  meta?: {
    evaluationMode?: "hold" | "entry";
    holdDuration?: number;
    holdRatio?: number;
    confidenceNote?: string;
    analyzedFrameRange?: [number, number];
    totalFrames?: number;
    entryFrameDetails?: {
      frameIndices: number[];
      spineAngles: number[];
      selectionReason: string;
    };
    sampling?: {
      estimatedOriginalFrames: number;
      sampledFramesCount: number;
      coarseSampleCount: number;
      refinedSampleCount: number;
      samplingStrategy: string;
      selectedWindows: { startTime: number; endTime: number; reason: string; framesExtracted: number }[];
      coarseFps: number;
      refinedFps: number | null;
      videoDuration: number;
      coverageStartTime?: number;
      coverageEndTime?: number;
      coveredDurationRatio?: number;
      extractionDiagnostics?: {
        coarseFrameTimestamps: number[];
        refinedFrameTimestamps: number[];
        firstExtractedTime: number;
        lastExtractedTime: number;
        extractedFrameCount: number;
        videoDuration: number;
        durationCoverageRatio: number;
        seekTimeouts: number;
        coarseExtractionTimeMs: number;
        refineExtractionTimeMs: number;
      };
    };
    coverageInfo?: CoverageInfoUI;
  };
  // Build info (always returned)
  buildInfo?: {
    appVersion: string;
    buildId: string;
    buildTime: string;
    evaluatorConfigVersion: string;
  };
  // Debug-only fields (returned when ?debug=true)
  ruleResultJson?: Record<string, unknown>;
  featureJson?: Record<string, unknown>;
  eventJson?: unknown[];
}

export default function AnalyzePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <AnalyzePage />
    </Suspense>
  );
}

function AnalyzePage() {
  const searchParams = useSearchParams();
  const isDebugMode = searchParams.get("debug") === "true";

  const [state, setState] = useState<AnalysisState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [result, setResult] = useState<ExtendedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [usage, setUsage] = useState<{
    remaining: number;
    limit: number;
    authenticated: boolean;
  } | null>(null);

  // Fetch usage on mount
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});
  }, []);

  const [videoDuration, setVideoDuration] = useState<number>(0);

  const handleFileSelected = useCallback((f: File, url: string) => {
    setFile(f);
    setPreviewUrl(url);
    setLandmarks(null);
    setResult(null);
    setError(null);
    setProgress("");
    setState("idle");
    setVideoDuration(0);

    // If video, read duration for long-video warning
    if (f.type.startsWith("video/")) {
      const tempVideo = document.createElement("video");
      tempVideo.preload = "metadata";
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(tempVideo.duration);
        URL.revokeObjectURL(tempVideo.src);
      };
      tempVideo.src = URL.createObjectURL(f);
    }
  }, []);

  const handleAnalyze = async () => {
    if (!file || !selectedTrick || !previewUrl) return;

    setError(null);
    setResult(null);

    try {
      setState("detecting");

      const isVideo = file.type.startsWith("video/");
      let frames: { timestamp: number; landmarks: Landmark[] }[] = [];
      let fps = 10;
      let duration = 0;
      let sampling: SamplingInfo | undefined;

      if (isVideo) {
        // Multi-frame extraction for video
        const video = document.getElementById("uploaded-video") as HTMLVideoElement;
        if (!video) throw new Error("動画が見つかりません");

        // Ensure video metadata is loaded
        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => resolve();
          });
        }

        duration = video.duration;
        setProgress(`動画から骨格を抽出中... (${duration.toFixed(1)}秒)`);

        const technique = selectedTrick.id as TechniqueId;
        const result = await extractPoseTimeSeries(
          video,
          technique,
          30,
          (completed, total, phase, currentTime) => {
            const timeStr = currentTime != null ? `${currentTime.toFixed(1)}秒` : "";
            const durationStr = duration.toFixed(1);
            if (phase?.startsWith("refine:")) {
              const reason = phase.replace("refine:", "");
              const reasonJa = reason === "most_horizontal" ? "水平区間" :
                reason === "most_vertical" ? "垂直区間" :
                reason === "static_hold" ? "静止区間" :
                reason === "high_movement" ? "動き区間" : reason;
              setProgress(`重点分析中（${reasonJa}）: ${completed}/${total}フレーム`);
            } else {
              setProgress(`全体走査中: ${completed}/${total}フレーム（${timeStr} / ${durationStr}秒）`);
            }
          }
        );

        frames = result.frames;
        sampling = result.sampling;

        if (frames.length === 0) {
          throw new Error(
            "ポーズを検出できませんでした。人物がはっきり写っている動画を使用してください。"
          );
        }

        // Show first frame landmarks for preview
        setLandmarks(frames[0].landmarks);
      } else {
        // Single frame for image
        const img = document.getElementById("uploaded-image") as HTMLImageElement;
        if (!img) throw new Error("画像が見つかりません");

        if (!img.complete) {
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
          });
        }

        const detectedLandmarks = await detectPoseFromImage(img);
        if (!detectedLandmarks) {
          throw new Error(
            "ポーズを検出できませんでした。人物がはっきり写っている画像を使用してください。"
          );
        }

        setLandmarks(detectedLandmarks);
        frames = [{ timestamp: 0, landmarks: detectedLandmarks }];
        duration = 0;
      }

      // Send to new pipeline API
      setState("analyzing");
      setProgress("ルールベース分析中...");

      const analyzeUrl = isDebugMode ? "/api/analyze?debug=true" : "/api/analyze";
      const response = await fetch(analyzeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          technique: selectedTrick.id as TechniqueId,
          trickNameJa: selectedTrick.name_ja,
          trickId: selectedTrick.id,
          frames,
          sourceType: isVideo ? "video" : "image",
          fps,
          duration,
          sampling,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(
          errData?.error || "分析に失敗しました。もう一度お試しください。"
        );
      }

      const analysisResult: ExtendedResult = await response.json();
      setResult(analysisResult);
      setState("complete");

      // Refresh usage
      fetch("/api/usage")
        .then((r) => r.json())
        .then(setUsage)
        .catch(() => {});
    } catch (err) {
      console.error("Analysis error:", err);
      setError(err instanceof Error ? err.message : "予期せぬエラーが発生しました");
      setState("error");
    }
  };

  const [showDebug, setShowDebug] = useState(false);
  const isAnalyzing = state === "detecting" || state === "analyzing";
  const canAnalyze = !!file && !!selectedTrick && !isAnalyzing;

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">フォーム分析</h1>
          <p className="text-gray-400 mt-1">
            動画や写真をアップロードして、AIがあなたのフォームを分析します
          </p>
        </div>

        {/* Debug Mode Banner */}
        {isDebugMode && (
          <div className="mb-6 flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-sm text-purple-300">
            <Bug className="w-4 h-4 flex-shrink-0" />
            <span>デバッグモード ON — 分析後に詳細JSON（feature / event / rule_result）を表示します</span>
          </div>
        )}

        {/* Usage Banner */}
        {usage && (
          <div className="mb-6 flex items-center gap-3 p-3 bg-gray-800/50 border border-gray-700 rounded-lg text-sm">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
            {usage.remaining >= 0 ? (
              <span className="text-gray-300">
                今月の残り分析回数:{" "}
                <span
                  className={
                    usage.remaining > 0 ? "text-green-400" : "text-red-400"
                  }
                >
                  {usage.remaining}/{usage.limit}回
                </span>
                {!usage.authenticated && (
                  <>
                    {" "}
                    ・{" "}
                    <Link
                      href="/login"
                      className="text-green-400 hover:underline"
                    >
                      ログインして履歴を保存
                    </Link>
                  </>
                )}
              </span>
            ) : (
              <span className="text-green-400">有料プラン: 無制限</span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Upload & Controls */}
          <div className="space-y-6">
            <VideoUploader
              onFileSelected={handleFileSelected}
              isAnalyzing={state === "detecting"}
              analysisProgress={progress}
            />

            <TrickSelector
              selectedTrickId={selectedTrick?.id || null}
              onSelect={setSelectedTrick}
            />

            {/* Long video warning */}
            {videoDuration > 15 && (
              <div className="flex items-start gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-sm text-orange-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p>動画が長めです（{videoDuration.toFixed(1)}秒）。</p>
                  <p className="text-orange-400/70 text-xs mt-1">
                    動画全体を走査しますが、長い動画では技以外の区間（待機・歩行など）がノイズとなり、最適な採点区間の選定精度が下がることがあります。技の前後3〜5秒程度にトリミングすると、より正確な分析結果が得られます。
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className={`
                w-full flex items-center justify-center gap-2 px-6 py-4
                rounded-xl font-semibold text-lg transition-all duration-200
                ${
                  canAnalyze
                    ? "bg-green-500 hover:bg-green-400 text-black cursor-pointer"
                    : "bg-gray-800 text-gray-500 cursor-not-allowed"
                }
              `}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {progress || STATE_MESSAGES[state]}
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  分析開始
                </>
              )}
            </button>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div className="space-y-6">
            {/* Pose Canvas */}
            {landmarks && previewUrl && (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  骨格検出結果
                </h3>
                <PoseCanvas
                  imageUrl={previewUrl}
                  landmarks={landmarks}
                  height={500}
                />
              </div>
            )}

            {/* Quality Warnings + Reference Analysis Notice */}
            {result?.qualityCheck && result.qualityCheck.warnings.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <h3 className="text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  品質に関する注意
                  {result.qualityLevel === "reference" && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-300">
                      参考分析
                    </span>
                  )}
                </h3>
                <ul className="text-sm text-yellow-300/80 space-y-1">
                  {result.qualityCheck.warnings.map((w, i) => (
                    <li key={i}>- {w}</li>
                  ))}
                </ul>
                {result.qualityExplanation && (
                  <p className="mt-2 text-xs text-yellow-400/70 border-t border-yellow-500/20 pt-2">
                    {result.qualityExplanation}
                  </p>
                )}
              </div>
            )}

            {/* Evaluation Mode Banner — shown when evaluationMode is set */}
            {result?.meta?.evaluationMode && (
              <div className={`rounded-xl p-4 border ${
                result.meta.evaluationMode === "entry"
                  ? "bg-blue-500/10 border-blue-500/30"
                  : result.meta.confidenceNote
                    ? "bg-yellow-500/10 border-yellow-500/30"
                    : "bg-green-500/10 border-green-500/30"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm font-medium ${
                    result.meta.evaluationMode === "entry" ? "text-blue-400" : "text-green-400"
                  }`}>
                    {result.meta.evaluationMode === "entry" ? "進入フォーム評価" : "保持評価"}
                  </span>
                  {result.meta.holdDuration != null && result.meta.holdDuration > 0 && (
                    <span className="text-xs text-gray-500">
                      (静止保持: {result.meta.holdDuration.toFixed(1)}秒)
                    </span>
                  )}
                </div>
                {result.meta.confidenceNote && (
                  <p className="text-sm text-gray-300 mt-1">{result.meta.confidenceNote}</p>
                )}
              </div>
            )}

            {/* Coverage Summary — ALWAYS shown for video results (not gated by evaluationMode) */}
            {result?.meta?.coverageInfo && (
              <div className="rounded-xl p-4 border bg-gray-800/50 border-gray-700">
                <h3 className="text-sm font-medium text-gray-300 mb-2">解析範囲</h3>
                <p className="text-sm text-gray-400">
                  {result.meta.coverageInfo.summary}
                </p>
                {result.meta.coverageInfo.finalScoringWindow && (
                  <p className="text-xs text-gray-500 mt-1">
                    採点区間: {result.meta.coverageInfo.finalScoringWindow.startTime.toFixed(1)}〜{result.meta.coverageInfo.finalScoringWindow.endTime.toFixed(1)}秒
                    （{result.meta.coverageInfo.finalScoringWindow.reason}）
                  </p>
                )}
                {/* Sampling refinement windows */}
                {result.meta.sampling && result.meta.sampling.selectedWindows.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    重点分析: {result.meta.sampling.selectedWindows.map(w => {
                      const reasonJa = w.reason === "most_horizontal" ? "水平" :
                        w.reason === "most_vertical" ? "垂直" :
                        w.reason === "static_hold" ? "静止" :
                        w.reason === "high_movement" ? "動き" : w.reason;
                      return `${w.startTime.toFixed(1)}〜${w.endTime.toFixed(1)}秒（${reasonJa}, ${w.framesExtracted}フレーム）`;
                    }).join("、")}
                  </p>
                )}
              </div>
            )}

            {/* Debug: Diagnostic Checkpoint — single screenshot-friendly panel */}
            {isDebugMode && result?.meta && (
              <div className="rounded-xl p-4 border bg-purple-500/5 border-purple-500/30">
                <h3 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-2">
                  <Bug className="w-4 h-4" />
                  診断チェックポイント
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400">
                  <div>client: {process.env.NEXT_PUBLIC_BUILD_ID ?? "?"}</div>
                  <div>server: {result.buildInfo?.buildId ?? "?"}</div>
                  <div>app: v{result.buildInfo?.appVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "?"}</div>
                  <div>eval: v{result.buildInfo?.evaluatorConfigVersion ?? "?"}</div>
                  <div>strategy: {result.meta.sampling?.samplingStrategy ?? "n/a"}</div>
                  <div>evalMode: {result.meta.evaluationMode ?? "none"}</div>
                  {result.meta.coverageInfo && (
                    <>
                      <div>scan: {result.meta.coverageInfo.coarseScanTimeRange[0].toFixed(1)}-{result.meta.coverageInfo.coarseScanTimeRange[1].toFixed(1)}s</div>
                      <div>score: {result.meta.coverageInfo.finalScoringWindow?.startTime.toFixed(1)}-{result.meta.coverageInfo.finalScoringWindow?.endTime.toFixed(1)}s</div>
                    </>
                  )}
                  {result.meta.sampling && (
                    <>
                      <div>coarse: {result.meta.sampling.coarseSampleCount}f</div>
                      <div>refined: {result.meta.sampling.refinedSampleCount}f</div>
                      <div>total: {result.meta.sampling.sampledFramesCount}f</div>
                      <div>vidDur: {result.meta.sampling.videoDuration?.toFixed(1)}s</div>
                    </>
                  )}
                  {result.meta.sampling?.extractionDiagnostics && (() => {
                    const d = result.meta.sampling.extractionDiagnostics!;
                    return (
                      <>
                        <div>firstTime: {d.firstExtractedTime.toFixed(2)}s</div>
                        <div>lastTime: {d.lastExtractedTime.toFixed(2)}s</div>
                        <div className={d.durationCoverageRatio < 0.9 ? "text-red-400 font-bold" : "text-green-400"}>
                          coverage: {(d.durationCoverageRatio * 100).toFixed(1)}%
                        </div>
                        <div>seekFail: {d.seekTimeouts}</div>
                        <div>extractMs: {d.coarseExtractionTimeMs + d.refineExtractionTimeMs}ms</div>
                        <div>frames: {d.extractedFrameCount}</div>
                      </>
                    );
                  })()}
                  <div>range: [{result.meta.analyzedFrameRange?.join("-")}]</div>
                  <div>totalF: {result.meta.totalFrames}</div>
                </div>
                {/* Entry frame details */}
                {result.meta.entryFrameDetails && (
                  <div className="mt-2 text-[10px] text-gray-500 font-mono border-t border-gray-700/50 pt-2">
                    <div>{result.meta.entryFrameDetails.selectionReason}</div>
                    <div>frames: [{result.meta.entryFrameDetails.frameIndices.join(", ")}]</div>
                    <div>spine: [{result.meta.entryFrameDetails.spineAngles.join("°, ")}°]</div>
                  </div>
                )}
                {/* Coverage phases */}
                {result.meta.coverageInfo && (
                  <div className="mt-2 text-[10px] text-gray-500 font-mono border-t border-gray-700/50 pt-2">
                    {result.meta.coverageInfo.analysisPhases.map((p, i) => (
                      <div key={i}>
                        [{p.phase}] {p.description} ({p.timeRange[0].toFixed(1)}-{p.timeRange[1].toFixed(1)}s, {p.frameCount}f)
                      </div>
                    ))}
                  </div>
                )}
                {/* Extraction diagnostics: timestamps */}
                {result.meta.sampling?.extractionDiagnostics && (() => {
                  const d = result.meta.sampling.extractionDiagnostics!;
                  return d.coarseFrameTimestamps.length > 0 ? (
                    <div className="mt-2 text-[10px] text-gray-500 font-mono border-t border-gray-700/50 pt-2">
                      <div>coarseTs ({d.coarseFrameTimestamps.length}): [{d.coarseFrameTimestamps.slice(0, 5).map(t => t.toFixed(2)).join(", ")}{d.coarseFrameTimestamps.length > 5 ? `, ... , ${d.coarseFrameTimestamps[d.coarseFrameTimestamps.length - 1].toFixed(2)}` : ""}]</div>
                      {d.refinedFrameTimestamps.length > 0 && (
                        <div>refineTs ({d.refinedFrameTimestamps.length}): [{d.refinedFrameTimestamps.slice(0, 5).map(t => t.toFixed(2)).join(", ")}{d.refinedFrameTimestamps.length > 5 ? `, ...` : ""}]</div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            {/* Score Breakdown */}
            {result?.breakdown && result.breakdown.length > 0 && (
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm font-medium text-gray-400 mb-3">
                  スコア内訳
                  {result.viewpoint && (
                    <span className="ml-2 text-xs text-gray-500">
                      (撮影アングル: {result.viewpoint})
                    </span>
                  )}
                </h3>
                <div className="space-y-2">
                  {result.breakdown.map((b) => (
                    <div key={b.category} className="flex items-center gap-3">
                      <span className="text-sm text-gray-300 w-28 flex-shrink-0">
                        {b.label}
                      </span>
                      <div className="flex-1 bg-gray-700 rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${
                            b.score >= 80
                              ? "bg-green-400"
                              : b.score >= 60
                                ? "bg-yellow-400"
                                : b.score >= 40
                                  ? "bg-orange-400"
                                  : "bg-red-400"
                          }`}
                          style={{ width: `${b.score}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono text-gray-300 w-10 text-right">
                        {b.score}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score & Advice */}
            {result && (
              <>
                <ScoreCard
                  result={result}
                  qualityLevel={result.qualityLevel}
                  confidenceNote={result.meta?.confidenceNote}
                />
                <AdvicePanel result={result} />

                {/* Debug: Violation Details */}
                {result.breakdown && result.breakdown.some(b => b.violations && b.violations.length > 0) && (
                  <div className="bg-gray-800/30 rounded-xl border border-gray-700/50">
                    <button
                      onClick={() => setShowDebug(!showDebug)}
                      className="w-full flex items-center justify-between p-4 text-sm text-gray-500 hover:text-gray-400"
                    >
                      <span>詳細分析データ</span>
                      {showDebug ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showDebug && (
                      <div className="px-4 pb-4 space-y-4">
                        {result.breakdown.map((b) => (
                          <Fragment key={b.category}>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-xs font-medium text-gray-400">{b.label}</h4>
                                <span className="text-[10px] text-gray-600 font-mono">{b.category}</span>
                                <span className="text-[10px] text-gray-600">w={b.weight.toFixed(2)}</span>
                              </div>
                              {b.violations && b.violations.length > 0 ? (
                                <div className="space-y-1.5">
                                  {b.violations.map((v, i) => (
                                    <div key={i} className="ml-2 text-xs border-l-2 pl-2 py-0.5" style={{
                                      borderColor: v.severity === "critical" ? "#f87171" : v.severity === "major" ? "#fbbf24" : "#6b7280"
                                    }}>
                                      <div className="flex items-center gap-1.5">
                                        <span className={
                                          v.severity === "critical" ? "text-red-400" :
                                          v.severity === "major" ? "text-yellow-400" : "text-gray-400"
                                        }>
                                          [{v.severity}]
                                        </span>
                                        <span className="text-gray-300">{v.message}</span>
                                        {v.scoreImpact != null && v.scoreImpact > 0 && (
                                          <span className="text-red-400/70 text-[10px]">-{v.scoreImpact.toFixed(1)}pt</span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-gray-600 mt-0.5 font-mono flex flex-wrap gap-x-3">
                                        <span>rule: {v.ruleId}</span>
                                        <span>実測: {typeof v.actual === "number" ? v.actual.toFixed(2) : v.actual}{v.unit}</span>
                                        <span>理想: {typeof v.ideal === "number" ? v.ideal.toFixed(2) : v.ideal}{v.unit}</span>
                                        {v.threshold && (
                                          <span>閾値: warn={v.threshold.warn} fail={v.threshold.fail}</span>
                                        )}
                                        {v.confidence != null && (
                                          <span>conf={v.confidence.toFixed(2)}</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="ml-2 text-[10px] text-green-500/60">pass</div>
                              )}
                              {b.measurements && Object.keys(b.measurements).length > 0 && (
                                <div className="ml-2 mt-1 text-[10px] text-gray-600 font-mono">
                                  measurements: {Object.entries(b.measurements).map(([k, v]) =>
                                    `${k}=${typeof v === "number" ? v.toFixed(2) : v}`
                                  ).join(", ")}
                                </div>
                              )}
                            </div>
                          </Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Debug JSON Panels — only when ?debug=true and result exists */}
        {isDebugMode && result && (
          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold text-purple-300 flex items-center gap-2">
              <Bug className="w-5 h-5" />
              デバッグデータ
            </h2>

            {/* Quality Check */}
            {result.qualityCheck && (
              <DebugJsonSection title="quality_check_result" data={result.qualityCheck} />
            )}

            {/* Rule Result */}
            {result.ruleResultJson && (
              <DebugJsonSection title="rule_result_json" data={result.ruleResultJson} />
            )}

            {/* Feature JSON */}
            {result.featureJson && (
              <DebugJsonSection title="feature_json" data={result.featureJson} />
            )}

            {/* Event JSON */}
            {result.eventJson && result.eventJson.length > 0 && (
              <DebugJsonSection title="event_json" data={result.eventJson} />
            )}
          </div>
        )}

        {/* Build Info Footer */}
        <div className={`mt-8 pb-4 text-center ${isDebugMode ? "text-[11px] text-purple-400/60" : "text-[10px] text-gray-600"}`}>
          <span>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "?"}</span>
          <span className="mx-1">·</span>
          <span>{process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}</span>
          {isDebugMode && (
            <>
              <span className="mx-1">·</span>
              <span>{process.env.NEXT_PUBLIC_BUILD_TIME ?? "local"}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible JSON viewer for debug mode */
function DebugJsonSection({ title, data }: { title: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const jsonStr = JSON.stringify(data, null, 2);
  const previewStr = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "…" : jsonStr;

  return (
    <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-sm hover:bg-gray-800/50"
      >
        <span className="font-mono text-purple-400">{title}</span>
        <div className="flex items-center gap-2 text-gray-500">
          <span className="text-xs">{jsonStr.length.toLocaleString()} chars</span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      <div className="px-3 pb-3">
        <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-black/30 rounded p-2">
          {open ? jsonStr : previewStr}
        </pre>
        {!open && jsonStr.length > 200 && (
          <button
            onClick={() => setOpen(true)}
            className="mt-1 text-xs text-purple-400 hover:text-purple-300"
          >
            全て表示
          </button>
        )}
      </div>
    </div>
  );
}
