/**
 * middle_split UX copy — centralized language constants and guardrails.
 *
 * All user-facing strings for middle_split SHOULD route through here so that
 * the "no medical-sounding claims, no absolutes" policy is enforced in one
 * place and verifiable by tests (see tests/analysis/middle-split-copy.test.ts).
 */

export const MIDDLE_SPLIT_COPY_VERSION = "middle_split_copy_v1";

/**
 * Words/phrases that MUST NOT appear in any middle_split user-facing text.
 * These either imply medical diagnosis, absolute judgment, or negative value.
 */
export const MIDDLE_SPLIT_BANNED_TERMS = [
  // Medical / anatomy-specific
  "梨状筋",
  "腸腰筋",
  "ハムストリングス",
  "内転筋群",
  "外旋筋群",
  "拘縮",
  "機能障害",
  "疾患",
  "診断",

  // Absolute / negative judgements
  "硬い",
  "硬すぎ",
  "柔らかくない",
  "悪い",
  "悪化",
  "ダメ",
  "できていない",
  "できない",
  "不可能",
  "異常",
  "問題があります",
  "不良",
  "欠陥",

  // Blame framing
  "あなたが悪い",
  "努力不足",
  "やる気",
] as const;

/**
 * Required trailing expressions — at least one must appear in any
 * "finding" / "issue description" text for middle_split.
 * This keeps the tone in the probabilistic ("〜の傾向") register.
 */
export const MIDDLE_SPLIT_REQUIRED_SOFTENERS = [
  "傾向",
  "可能性",
  "ように見え",
  "ように見え",
  "余地",
  "状態",
  "目安",
  "〜しやすい",
  "見かけ",
  "推定",
] as const;

/** Canonical advice templates used by the fallback generator. */
export const MIDDLE_SPLIT_ADVICE = {
  splitAngle:
    "股関節まわりの可動域づくりを優先しましょう。壁に背中をつけた受動開脚や、仰向けで壁づたいに脚を開く練習がおすすめです。",
  pelvis:
    "骨盤を立てることを意識しましょう。壁に背中をつけて座り、骨盤を立てた状態でできる範囲で開脚する練習が効果的です。",
  knee:
    "膝を伸ばしたまま可能な角度で止めるようにしましょう。無理に深くするより、まっすぐな脚ラインを保つことが開脚の安全性にも見た目にも効いてきます。",
  asymmetry:
    "左右差が見られます。可動域が狭く感じる側を先に、時間を長めにストレッチしてバランスを整えましょう。",
  trunk:
    "体幹をまっすぐ保つ意識を優先しましょう。無理に前や横に倒さず、背筋を伸ばしたまま開ける範囲から広げていくのがおすすめです。",
  safetyNote: "痛みを感じたら必ず中止してください。",
} as const;

/**
 * Lightweight sanitizer — replaces banned terms with a neutral placeholder.
 * This is the last-line defense for Claude-generated text.
 */
export function sanitizeMiddleSplitText(text: string): string {
  let out = text;
  for (const term of MIDDLE_SPLIT_BANNED_TERMS) {
    out = out.replaceAll(term, "—");
  }
  return out;
}

/**
 * Returns the list of banned terms that appear in the given text, for tests
 * and lint-style checks.
 */
export function findBannedTerms(text: string): string[] {
  const hits: string[] = [];
  for (const term of MIDDLE_SPLIT_BANNED_TERMS) {
    if (text.includes(term)) hits.push(term);
  }
  return hits;
}
