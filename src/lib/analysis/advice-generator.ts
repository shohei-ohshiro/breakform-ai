import Anthropic from "@anthropic-ai/sdk";
import {
  EvaluationResult,
  QualityCheckResult,
  Viewpoint,
  GeneratedAdvice,
  TechniqueId,
} from "./types";

const TECHNIQUE_NAMES: Record<TechniqueId, string> = {
  handstand: "倒立（ハンドスタンド）",
  planche: "プランシェ",
  swipes: "スワイプス",
};

/**
 * Generate natural-language advice using Claude API.
 * Input: structured rule-based evaluation results only (no raw landmarks).
 */
export async function generateAdvice(
  apiKey: string,
  evaluation: EvaluationResult,
  quality: QualityCheckResult,
  viewpoint: Viewpoint,
  userLevel: string
): Promise<GeneratedAdvice> {
  const anthropic = new Anthropic({ apiKey });

  const techniqueName = TECHNIQUE_NAMES[evaluation.technique];

  // Build a compact summary for Claude — no raw landmarks
  const scoreBreakdown = evaluation.breakdown
    .map(
      (b) =>
        `- ${b.label}: ${b.score}/100 (重み: ${(b.weight * 100).toFixed(0)}%)`
    )
    .join("\n");

  const issuesSummary = evaluation.violations
    .map(
      (v) =>
        `- [${v.severity}] ${v.bodyPart}: ${v.message} (実測: ${v.actual}${v.unit}, 理想: ${v.ideal}${v.unit})`
    )
    .join("\n");

  const eventsSummary =
    evaluation.events.length > 0
      ? evaluation.events
          .slice(0, 20) // limit for token efficiency
          .map(
            (e) =>
              `- ${e.type} @ ${e.timestamp.toFixed(2)}s: ${JSON.stringify(e.details)}`
          )
          .join("\n")
      : "なし";

  const suggestionsDraft = evaluation.suggestionsRaw.join("\n- ");

  const prompt = `あなたはブレイクダンスの専門コーチです。
以下のルールベース分析結果をもとに、ユーザーへの自然な日本語フィードバックを作成してください。

## 分析対象
技名: ${techniqueName}
総合スコア: ${evaluation.finalScore}/100
ユーザーレベル: ${userLevel}
撮影アングル: ${viewpoint}
品質スコア: ${(quality.overallScore * 100).toFixed(0)}%
${quality.warnings.length > 0 ? `品質警告: ${quality.warnings.join(", ")}` : ""}

## スコア内訳
${scoreBreakdown}

## 検出された問題点
${issuesSummary || "なし"}

## 検出イベント（動作系技のみ）
${eventsSummary}

## 改善提案のドラフト
- ${suggestionsDraft}

## 回答フォーマット（JSONのみ返してください）
{
  "issues": [
    {
      "priority": 1から3の優先度,
      "body_part": "対象部位",
      "description": "問題の説明（具体的な数値を含む）",
      "ideal_angle": 理想の角度（数値、該当する場合）,
      "actual_angle": 実測値（数値、該当する場合）
    }
  ],
  "advice": [
    {
      "type": "training | stretch | warmup | injury_prevention",
      "related_issue": 1から3の対応するissue番号,
      "content": "具体的なアドバイス（種目名、回数、頻度を含む）"
    }
  ],
  "summary": "総合コメント（50-100文字）"
}

ルール:
- 日本語で回答
- issues は最大5つ、severity が critical > major > minor の優先順
- advice はユーザーレベルに合わせた難易度で
- 怪我予防を最優先
- JSONのみ返す（余計なテキスト不要）`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Extract JSON
  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as GeneratedAdvice;
  } catch {
    // Fallback: construct from rule results
    return buildFallbackAdvice(evaluation);
  }
}

/**
 * Fallback if Claude API fails or returns invalid JSON.
 * Constructs advice directly from rule-based evaluation.
 */
export function buildFallbackAdvice(
  evaluation: EvaluationResult
): GeneratedAdvice {
  // Violations are pre-ranked by scoreImpact from evaluators
  const issues = evaluation.violations.slice(0, 5).map((v, i) => ({
    priority: i < 2 ? 1 : i < 4 ? 2 : 3,
    body_part: v.bodyPart,
    description: v.message,
    ideal_angle: v.unit === "deg" ? v.ideal : undefined,
    actual_angle: v.unit === "deg" ? v.actual : undefined,
  }));

  const advice = evaluation.suggestionsRaw.slice(0, 5).map((s, i) => ({
    type: "training" as const,
    related_issue: Math.min(i + 1, issues.length),
    content: s,
  }));

  const techniqueName = TECHNIQUE_NAMES[evaluation.technique];
  const summary =
    evaluation.finalScore >= 80
      ? `${techniqueName}のフォームは良好です。細部の改善でさらにレベルアップしましょう。`
      : evaluation.finalScore >= 50
        ? `${techniqueName}の基本は出来ています。主要な改善ポイントに取り組みましょう。`
        : `${techniqueName}の基礎固めが必要です。一つずつ改善していきましょう。`;

  return { issues, advice, summary };
}
