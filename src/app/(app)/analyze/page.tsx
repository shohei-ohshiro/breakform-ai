"use client";

import { useState, useCallback, useEffect } from "react";
import { Loader2, Zap, Info } from "lucide-react";
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
  JointAngles,
  CenterOfGravity,
} from "@/lib/types";
import { detectPoseFromImage } from "@/lib/pose/mediapipe";
import { calculateJointAngles, calculateCenterOfGravity } from "@/lib/pose/angles";

const STATE_MESSAGES: Record<AnalysisState, string> = {
  idle: "",
  uploading: "ファイルを読み込み中...",
  detecting: "骨格を検出中...(初回はモデルのダウンロードに時間がかかります)",
  analyzing: "AIがフォームを分析中...",
  complete: "",
  error: "エラーが発生しました",
};

export default function AnalyzePage() {
  const [state, setState] = useState<AnalysisState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [angles, setAngles] = useState<JointAngles | null>(null);
  const [cog, setCog] = useState<CenterOfGravity | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const handleFileSelected = useCallback((f: File, url: string) => {
    setFile(f);
    setPreviewUrl(url);
    setLandmarks(null);
    setAngles(null);
    setCog(null);
    setResult(null);
    setError(null);
    setState("idle");
  }, []);

  const handleAnalyze = async () => {
    if (!file || !selectedTrick || !previewUrl) return;

    setError(null);
    setResult(null);

    try {
      // Step 1: Detect pose
      setState("detecting");

      let detectedLandmarks: Landmark[] | null = null;

      if (file.type.startsWith("image/")) {
        // Load image and detect pose
        const img = document.getElementById("uploaded-image") as HTMLImageElement;
        if (!img) throw new Error("画像が見つかりません");

        // Wait for image to be fully loaded
        if (!img.complete) {
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
          });
        }

        detectedLandmarks = await detectPoseFromImage(img);
      } else {
        // For video, capture current frame
        const video = document.getElementById("uploaded-video") as HTMLVideoElement;
        if (!video) throw new Error("動画が見つかりません");

        // Create a canvas from the current video frame
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context error");
        ctx.drawImage(video, 0, 0);

        // Create an image from canvas
        const imgUrl = canvas.toDataURL("image/jpeg");
        const img = new Image();
        img.src = imgUrl;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
        });

        detectedLandmarks = await detectPoseFromImage(img);
      }

      if (!detectedLandmarks) {
        throw new Error(
          "ポーズを検出できませんでした。人物がはっきり写っている画像/動画を使用してください。"
        );
      }

      setLandmarks(detectedLandmarks);

      // Step 2: Calculate angles and center of gravity
      const calculatedAngles = calculateJointAngles(detectedLandmarks);
      const calculatedCog = calculateCenterOfGravity(detectedLandmarks);
      setAngles(calculatedAngles);
      setCog(calculatedCog);

      // Step 3: Send to Claude API for analysis
      setState("analyzing");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trickName: selectedTrick.name,
          trickNameJa: selectedTrick.name_ja,
          trickId: selectedTrick.id,
          angles: calculatedAngles,
          landmarks: detectedLandmarks,
          mediaType: file.type.startsWith("video/") ? "video" : "photo",
        }),
      });

      if (!response.ok) {
        throw new Error("分析に失敗しました。もう一度お試しください。");
      }

      const analysisResult: AnalysisResult = await response.json();
      setResult(analysisResult);
      setState("complete");

      // Refresh usage count
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

  const isAnalyzing = state === "detecting" || state === "analyzing";
  const canAnalyze = !!file && !!selectedTrick && !isAnalyzing;

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">
            フォーム分析
          </h1>
          <p className="text-gray-400 mt-1">
            動画や写真をアップロードして、AIがあなたのフォームを分析します
          </p>
        </div>

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
            <VideoUploader onFileSelected={handleFileSelected} />

            <TrickSelector
              selectedTrickId={selectedTrick?.id || null}
              onSelect={setSelectedTrick}
            />

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
                  {STATE_MESSAGES[state]}
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
            {/* Pose Canvas with skeleton overlay */}
            {landmarks && previewUrl && (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  骨格検出結果
                </h3>
                <PoseCanvas
                  imageUrl={previewUrl}
                  landmarks={landmarks}
                  cog={cog}
                  height={500}
                />
              </div>
            )}

            {/* Angles Display */}
            {angles && (
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm font-medium text-gray-400 mb-3">
                  検出された関節角度
                </h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    { label: "左肩", value: angles.leftShoulder },
                    { label: "右肩", value: angles.rightShoulder },
                    { label: "左肘", value: angles.leftElbow },
                    { label: "右肘", value: angles.rightElbow },
                    { label: "左股関節", value: angles.leftHip },
                    { label: "右股関節", value: angles.rightHip },
                    { label: "左膝", value: angles.leftKnee },
                    { label: "右膝", value: angles.rightKnee },
                    { label: "背骨", value: angles.spineAngle },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex justify-between px-3 py-1.5 bg-gray-900/50 rounded"
                    >
                      <span className="text-gray-400">{item.label}</span>
                      <span className="text-gray-200 font-mono">
                        {item.value}°
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score & Advice */}
            {result && (
              <>
                <ScoreCard result={result} />
                <AdvicePanel result={result} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
