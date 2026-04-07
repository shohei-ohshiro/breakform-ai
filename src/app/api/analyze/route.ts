import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { checkUsageLimit, incrementUsage } from "@/lib/usage";
import { runPipeline } from "@/lib/analysis/pipeline";
import { PipelineInput, TechniqueId, PoseFrame } from "@/lib/analysis/types";
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
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequestV2 = await request.json();
    const { technique, trickId, trickNameJa, frames, sourceType, fps, duration, userLevel } = body;

    if (!technique || !frames || frames.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate technique
    const validTechniques: TechniqueId[] = ["handstand", "planche", "swipes"];
    if (!validTechniques.includes(technique)) {
      return NextResponse.json(
        { error: `対応していない技です: ${technique}` },
        { status: 400 }
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
          return NextResponse.json(
            {
              error: `今月の無料分析回数（${usage.limit}回）を使い切りました。有料プランにアップグレードするか、来月までお待ちください。`,
              usageExceeded: true,
              remaining: usage.remaining,
              limit: usage.limit,
            },
            { status: 429 }
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
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    const pipelineInput: PipelineInput = {
      frames: frames as PoseFrame[],
      technique,
      sourceType,
      fps: fps || 10,
      duration: duration || 0,
      userLevel: (userLevel ?? experienceLevel ?? "beginner") as PipelineInput["userLevel"],
    };

    const result = await runPipeline(pipelineInput, anthropicApiKey);

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
      });

      await incrementUsage(supabase, userId);
    }

    // Return UI-compatible result
    const debugMode = new URL(request.url).searchParams.get("debug") === "true";

    const responseBody: Record<string, unknown> = {
      score: result.score,
      issues: result.issues,
      advice: result.advice,
      summary: result.summary,
      qualityCheck: result.qualityCheck,
      viewpoint: result.viewpoint,
      breakdown: result.ruleResultJson.breakdown,
      meta: {
        evaluationMode: result.ruleResultJson.meta.evaluationMode,
        holdDuration: result.ruleResultJson.meta.holdDuration,
        holdRatio: result.ruleResultJson.meta.holdRatio,
        confidenceNote: result.ruleResultJson.meta.confidenceNote,
        analyzedFrameRange: result.ruleResultJson.meta.analyzedFrameRange,
        totalFrames: result.ruleResultJson.meta.totalFrames,
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
    return NextResponse.json(
      { error: "分析に失敗しました。もう一度お試しください。" },
      { status: 500 }
    );
  }
}
