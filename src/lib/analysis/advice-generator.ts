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

  // Evaluation mode context
  const evalMode = evaluation.meta.evaluationMode;
  const isEntry = evalMode === "entry";

  const modeContext = isEntry
    ? `\n評価モード: 進入フォーム評価（静止保持が検出されなかったため、進入動作として評価）
${evaluation.meta.confidenceNote ? `備考: ${evaluation.meta.confidenceNote}` : ""}`
    : evalMode === "hold"
      ? `\n評価モード: 保持評価`
      : "";

  const qualityContext = quality.warnings.length > 0
    ? `品質警告: ${quality.warnings.join(", ")}\n品質注意: 品質に注意点がありますが参考分析として採点しています。数値の断定を避けてください。`
    : "";

  const entryToneGuidance = isEntry
    ? `
## 進入フォーム評価のトーン指示
この動画は進入（エントリー）動作です。完成保持ではありません。以下の方針で回答してください:
- 「進入としてはここができている」という肯定的な中間評価を含める
- 「次に伸ばすポイント」として改善点を提示する
- 「静止保持動画を撮るとさらに正確な評価が得られます」と補足する
- 完成保持を前提にした断定的な指摘は避ける
- 「まだ保持ではないが、進入フォームとしてはここまでできている」という段階的な表現を使う`
    : "";

  const prompt = `あなたはブレイクダンスの専門コーチです。
以下のルールベース分析結果をもとに、ユーザーへの自然な日本語フィードバックを作成してください。

## 分析対象
技名: ${techniqueName}
総合スコア: ${evaluation.finalScore}/100
ユーザーレベル: ${userLevel}
撮影アングル: ${viewpoint}
品質スコア: ${(quality.overallScore * 100).toFixed(0)}%
${qualityContext}${modeContext}

## スコア内訳
${scoreBreakdown}

## 検出された問題点
${issuesSummary || "なし"}

## 検出イベント（動作系技のみ）
${eventsSummary}

## 改善提案のドラフト
- ${suggestionsDraft}
${entryToneGuidance}

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
- issues は最大3つに統合すること（同じ根本原因の問題はまとめる。例: 体幹の傾き+全身ラインの崩れ → 1つに統合）
- 重複する body_part や類似の指摘は必ず1つにまとめる
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
 * Clusters related violations to avoid redundancy (max 3 issues).
 */
export function buildFallbackAdvice(
  evaluation: EvaluationResult
): GeneratedAdvice {
  const isEntry = evaluation.meta.evaluationMode === "entry";

  // Cluster violations by root cause (same category or overlapping body part)
  const clustered = clusterViolations(evaluation.violations);
  const issues = clustered.slice(0, 3).map((cluster, i) => ({
    priority: i < 1 ? 1 : i < 2 ? 2 : 3,
    body_part: cluster.bodyPart,
    description: cluster.message,
    ideal_angle: cluster.unit === "deg" ? cluster.ideal : undefined,
    actual_angle: cluster.unit === "deg" ? cluster.actual : undefined,
  }));

  const advice = evaluation.suggestionsRaw.slice(0, 3).map((s, i) => ({
    type: "training" as const,
    related_issue: Math.min(i + 1, issues.length),
    content: s,
  }));

  const techniqueName = TECHNIQUE_NAMES[evaluation.technique];
  let summary: string;
  if (isEntry) {
    summary =
      evaluation.finalScore >= 70
        ? `${techniqueName}の進入フォームは良い段階です。保持に向けてさらに精度を上げましょう。`
        : evaluation.finalScore >= 40
          ? `${techniqueName}への進入はできています。体幹ラインと脚の伸びが次の課題です。`
          : `${techniqueName}の進入動作を段階的に練習しましょう。`;
  } else {
    summary =
      evaluation.finalScore >= 80
        ? `${techniqueName}のフォームは良好です。細部の改善でさらにレベルアップしましょう。`
        : evaluation.finalScore >= 50
          ? `${techniqueName}の基本は出来ています。主要な改善ポイントに取り組みましょう。`
          : `${techniqueName}の基礎固めが必要です。一つずつ改善していきましょう。`;
  }

  return { issues, advice, summary };
}

/**
 * Cluster violations by related category/body part.
 * Merges overlapping violations (e.g., body_line + body_not_straight).
 * Returns representative violations sorted by impact.
 */
function clusterViolations(
  violations: EvaluationResult["violations"]
): EvaluationResult["violations"] {
  if (violations.length <= 3) return violations;

  // Group by category prefix (e.g., planche_body_line + planche_body_not_straight → body group)
  const groups = new Map<string, typeof violations>();
  for (const v of violations) {
    // Extract category from ruleId: "planche_body_line" → "body", "planche_hip_sag" → "hip"
    const parts = v.ruleId.replace(/^planche_/, "").split("_");
    const groupKey = parts[0] === "entry" ? "entry" : parts[0];

    const existing = groups.get(groupKey) ?? [];
    existing.push(v);
    groups.set(groupKey, existing);
  }

  // Pick the highest-impact violation from each group
  const representatives: typeof violations = [];
  for (const [, group] of groups) {
    // Sort by scoreImpact descending
    group.sort((a, b) => (b.scoreImpact ?? 0) - (a.scoreImpact ?? 0));
    const rep = group[0];
    // If there are merged violations, note it in the message
    if (group.length > 1) {
      const otherParts = group.slice(1).map(v => v.bodyPart).filter(p => p !== rep.bodyPart);
      if (otherParts.length > 0) {
        rep.message = `${rep.message}（${otherParts.join("・")}も関連）`;
      }
    }
    representatives.push(rep);
  }

  // Sort by scoreImpact descending
  representatives.sort((a, b) => (b.scoreImpact ?? 0) - (a.scoreImpact ?? 0));
  return representatives;
}
