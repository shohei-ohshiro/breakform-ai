import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult, Landmark, JointAngles } from "@/lib/types";
import { checkUsageLimit, incrementUsage } from "@/lib/usage";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `あなたはブレイクダンスとアクロバットの専門コーチAIです。
骨格データ（関節角度と座標）を分析し、具体的で実用的なフィードバックを提供します。

回答のルール:
- 日本語で回答すること
- 具体的な数値を含めること（角度の差、推奨レップ数等）
- 怪我予防を最優先に考えること
- 初心者にもわかりやすい言葉で説明すること
- 筋トレ/ストレッチの提案には必ず種目名・回数・頻度を含めること
- 「インナーマッスルから鍛える」等の段階的アプローチを推奨すること
- JSONのみを返すこと（余計なテキストは不要）`;

interface AnalyzeRequest {
  trickName: string;
  trickNameJa: string;
  trickId: string;
  angles: JointAngles;
  landmarks: Landmark[];
  mediaType: "photo" | "video";
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { trickName, trickNameJa, trickId, angles, landmarks, mediaType } =
      body;

    if (!trickName || !angles || !landmarks) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // --- Auth & Usage Check (only if Supabase is configured) ---
    let userId: string | null = null;

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
      }
    }

    // --- Claude API Analysis ---
    const userPrompt = `
## 分析対象
技名: ${trickNameJa}（${trickName}）

## 骨格データ
関節角度:
- 左肩: ${angles.leftShoulder}°
- 右肩: ${angles.rightShoulder}°
- 左肘: ${angles.leftElbow}°
- 右肘: ${angles.rightElbow}°
- 左股関節: ${angles.leftHip}°
- 右股関節: ${angles.rightHip}°
- 左膝: ${angles.leftKnee}°
- 右膝: ${angles.rightKnee}°
- 背骨の角度: ${angles.spineAngle}°
- 骨盤の傾き: ${angles.hipAlignment}°
- 肩の傾き: ${angles.shoulderAlignment}°

ランドマーク座標（33点、正規化済み 0-1）:
${JSON.stringify(landmarks.map((l, i) => ({ index: i, x: Math.round(l.x * 1000) / 1000, y: Math.round(l.y * 1000) / 1000, visibility: Math.round(l.visibility * 100) / 100 })))}

## 求める回答フォーマット（JSONのみ返してください）
{
  "score": 0から100の数値,
  "issues": [
    {
      "priority": 1から3の優先度,
      "body_part": "対象部位",
      "description": "問題の説明（理想角度との差分を含む）",
      "ideal_angle": 理想の角度（数値）,
      "actual_angle": 実測値（数値）
    }
  ],
  "advice": [
    {
      "type": "training または stretch または warmup または injury_prevention",
      "related_issue": 1から3の対応するissue番号,
      "content": "具体的なアドバイス（種目名、レップ数、セット数、頻度を含む）"
    }
  ],
  "summary": "総合コメント（50-100文字）"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result: AnalysisResult = JSON.parse(jsonStr);

    // --- Save result & increment usage (if user is logged in and Supabase configured) ---
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

      // Save analysis result
      await supabase.from("analyses").insert({
        user_id: userId,
        trick_id: trickId || trickName,
        trick_name: trickName,
        trick_name_ja: trickNameJa,
        media_type: mediaType || "photo",
        landmarks,
        angles,
        score: result.score,
        issues: result.issues,
        advice: result.advice,
        summary: result.summary,
      });

      // Increment usage count
      await incrementUsage(supabase, userId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: "分析に失敗しました。もう一度お試しください。" },
      { status: 500 }
    );
  }
}
