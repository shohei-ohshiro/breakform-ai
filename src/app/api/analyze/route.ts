import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { checkUsageLimit, incrementUsage } from "@/lib/usage";
import { runPipeline } from "@/lib/analysis/pipeline";
import {
  PipelineInput,
  TechniqueId,
  PoseFrame,
  SamplingInfo,
  ErrorCode,
  ApiErrorResponse,
} from "@/lib/analysis/types";
import { recordAnalysisMetric } from "@/lib/analysis/metrics";
import { Landmark } from "@/lib/types";

interface AnalyzeRequestV2 {
  technique: TechniqueId;
  trickNameJa: string;
  trickId: string;
  frames: { timestamp: number; landmarks: Landmark[] }[];
  sourceType: "image" | "video";
  fps: number;
  duration: number;
  userLevel?: "beginner" | "intermediate" | "advanced" | "expert";
  sampling?: SamplingInfo;
}

function apiError(
  errorCode: ErrorCode,
  error: string,
  status: number,
  detail?: Record<string, unknown>,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json<ApiErrorResponse>(
    detail ? { error, errorCode, detail } : { error, errorCode },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const requestStartMs = Date.now();
  let metricTechnique: TechniqueId | null = null;

  const errorWithMetric = (
    errorCode: ErrorCode,
    error: string,
    status: number,
    detail?: Record<string, unknown>,
  ): NextResponse<ApiErrorResponse> => {
    recordAnalysisMetric({
      technique: metricTechnique,
      outcome: "error",
      durationMs: Date.now() - requestStartMs,
      errorCode,
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID,
    });
    return apiError(errorCode, error, status, detail);
  };

  try {
    const body: AnalyzeRequestV2 = await request.json();
    const { technique, trickId, trickNameJa, frames, sourceType, fps, duration, userLevel, sampling } = body;
    metricTechnique = technique ?? null;

    if (!technique || !frames || frames.length === 0) {
      return errorWithMetric(
        "missing_fields",
        "必須フィールドが不足しています (technique または frames)",
        400,
      );
    }

    // Validate technique
    const validTechniques: TechniqueId[] = ["handstand", "planche", "swipes", "middle_split"];
    if (!validTechniques.includes(technique)) {
      return errorWithMetric(
        "unsupported_technique",
        `対応していない技です: ${technique}`,
        400,
        { technique, supported: validTechniques },
      );
    }

    // --- Auth & Usage Check ---
    let userId: string | null = null;
    let experienceLevel: string | null = null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const response = NextResponse.next();
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        userId = user.id;

        // Check usage limit
        const usage = await checkUsageLimit(supabase, user.id);
        if (!usage.allowed) {
          return errorWithMetric(
            "usage_limit_exceeded",
            `今月の無料分析回数（${usage.limit}回）を使い切りました。有料プランにアップグレードするか、来月までお待ちください。`,
            429,
            {
              usageExceeded: true,
              remaining: usage.remaining,
              limit: usage.limit,
            },
          );
        }

        // Fetch user experience level
        const { data: profile } = await supabase
          .from("profiles")
          .select("experience_level")
          .eq("id", user.id)
          .single();
        experienceLevel = profile?.experience_level ?? null;
      }
    }

    // --- Run Analysis Pipeline ---
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return errorWithMetric(
        "api_key_missing",
        "分析APIキーが設定されていません。管理者にお問い合わせください。",
        500,
      );
    }

    const pipelineInput: PipelineInput = {
      frames: frames as PoseFrame[],
      technique,
      sourceType,
      fps: fps || 10,
      duration: duration || 0,
      userLevel: (userLevel ?? experienceLevel ?? "beginner") as PipelineInput["userLevel"],
      sampling: sampling ?? undefined,
    };

    const result = await runPipeline(pipelineInput, anthropicApiKey);

    recordAnalysisMetric({
      technique: metricTechnique,
      outcome: "success",
      durationMs: Date.now() - requestStartMs,
      finalScore: result.finalScore,
      qualityLevel: result.qualityLevel,
      reliability: result.reliability,
      viewpoint: result.viewpoint,
      evaluatorConfigVersion: result.ruleResultJson.meta.configVersion,
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID,
    });

    // --- Save result & increment usage ---
    if (userId && supabaseUrl && supabaseAnonKey) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // no-op for saving
          },
        },
      });

      await supabase.from("analyses").insert({
        user_id: userId,
        trick_id: trickId || technique,
        trick_name: technique,
        trick_name_ja: trickNameJa,
        media_type: sourceType,
        // Legacy fields (set to null — no longer sending raw landmarks to DB)
        landmarks: null,
        angles: null,
        // New pipeline data
        score: result.finalScore,
        issues: result.issues,
        advice: result.advice,
        summary: result.summary,
        feature_json: result.featureJson,
        event_json: result.eventJson,
        rule_result_json: result.ruleResultJson,
        viewpoint: result.viewpoint,
        quality_check_result: result.qualityCheck,
        final_score: result.finalScore,
        // Sprint 3 production fields (migration 003)
        reliability: result.reliability,
        quality_level: result.qualityLevel,
        retake_reasons: result.retakeReasons,
        structured_summary: result.structuredSummary ?? null,
        evaluator_config_version: result.ruleResultJson.meta.configVersion,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
        build_id: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      });

      await incrementUsage(supabase, userId);
    }

    // Return UI-compatible result
    const debugMode = new URL(request.url).searchParams.get("debug") === "true";

    // For normal mode, strip large timestamp arrays from diagnostics
    const samplingForResponse = result.ruleResultJson.meta.sampling;
    let samplingMeta = samplingForResponse;
    if (samplingForResponse && !debugMode && samplingForResponse.extractionDiagnostics) {
      const { coarseFrameTimestamps, refinedFrameTimestamps, ...compactDiag } =
        samplingForResponse.extractionDiagnostics;
      samplingMeta = {
        ...samplingForResponse,
        extractionDiagnostics: {
          ...compactDiag,
          coarseFrameTimestamps: [],
          refinedFrameTimestamps: [],
        },
      };
    }

    const buildInfo = {
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
      buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? "local",
      evaluatorConfigVersion: result.ruleResultJson.meta.configVersion,
    };

    const responseBody: Record<string, unknown> = {
      score: result.score,
      issues: result.issues,
      advice: result.advice,
      summary: result.summary,
      qualityCheck: result.qualityCheck,
      viewpoint: result.viewpoint,
      breakdown: result.ruleResultJson.breakdown,
      qualityLevel: result.qualityLevel,
      qualityExplanation: result.qualityExplanation,
      reliability: result.reliability,
      retakeRecommended: result.retakeRecommended,
      retakeReasons: result.retakeReasons,
      structuredSummary: result.structuredSummary,
      // Compact middle_split feature payload — always exposed (not gated on
      // debug) so the history compare UI can read it without a full featureJson.
      middleSplitFeatures: result.featureJson.middleSplit
        ? {
            splitAngleRaw: result.featureJson.middleSplit.splitAngleRaw,
            leftRightAngleDiff: result.featureJson.middleSplit.leftRightAngleDiff,
            pelvisRollAngle: result.featureJson.middleSplit.pelvisRollAngle,
            trunkLeanAngle: result.featureJson.middleSplit.trunkLeanAngle,
            frontalityScore: result.featureJson.middleSplit.frontalityScore,
          }
        : undefined,
      buildInfo,
      meta: {
        evaluationMode: result.ruleResultJson.meta.evaluationMode,
        holdDuration: result.ruleResultJson.meta.holdDuration,
        holdRatio: result.ruleResultJson.meta.holdRatio,
        confidenceNote: result.ruleResultJson.meta.confidenceNote,
        analyzedFrameRange: result.ruleResultJson.meta.analyzedFrameRange,
        totalFrames: result.ruleResultJson.meta.totalFrames,
        entryFrameDetails: result.ruleResultJson.meta.entryFrameDetails,
        sampling: samplingMeta,
        coverageInfo: result.ruleResultJson.meta.coverageInfo,
        // Evaluation transparency fields (always returned)
        evaluationModeReason: result.ruleResultJson.meta.evaluationModeReason,
        selectedEvaluationWindow: result.ruleResultJson.meta.selectedEvaluationWindow,
        selectedReason: result.ruleResultJson.meta.selectedReason,
        candidateWindowsTopN: result.ruleResultJson.meta.candidateWindowsTopN,
        qualityImpactSummary: result.ruleResultJson.meta.qualityImpactSummary,
        cycleSummary: result.ruleResultJson.meta.cycleSummary,
        eventSummary: result.ruleResultJson.meta.eventSummary,
      },
    };

    if (debugMode) {
      responseBody.ruleResultJson = result.ruleResultJson;
      responseBody.featureJson = result.featureJson;
      responseBody.eventJson = result.eventJson;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Analysis error:", error);
    return errorWithMetric(
      "pipeline_error",
      "分析に失敗しました。もう一度お試しください。",
      500,
      { message: error instanceof Error ? error.message : String(error) },
    );
  }
}
