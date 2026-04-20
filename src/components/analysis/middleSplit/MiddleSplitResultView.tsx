"use client";

/**
 * middle_split UX polish v1.1 result view.
 *
 * Single top-level component driven by StructuredSummary. Renders blocks in a
 * quality-level–aware order: retake banner → hero verdict → top priority →
 * this-week practice → reliability strip → collapsible details → debug meta.
 *
 * Kept self-contained (no shared context) so the analyze page only has to pass
 * `summary` and `isDebug`, matching how the v1 panel was wired.
 */

import { useState, Fragment } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Sparkles,
  Target,
} from "lucide-react";
import type { StructuredSummary } from "@/lib/analysis/types";
import type { MiddleSplitComparison } from "@/lib/analysis/history-compare";

type Severity = "minor" | "major" | "critical";

export default function MiddleSplitResultView({
  summary,
  comparison,
  isDebug,
}: {
  summary: StructuredSummary;
  comparison?: MiddleSplitComparison | null;
  isDebug?: boolean;
}) {
  const urgency = summary.retakeAdvice.urgency;
  const level = summary.reliabilitySummary.level;
  const compareBlock = comparison ? (
    <HistoryCompareRow comparison={comparison} />
  ) : null;

  // Section ordering follows the v1.1 spec:
  // - retry   → banner, reliability first, then verdict (blurred)
  // - reference → banner, verdict, reliability, then priority
  // - good    → verdict, priority, practice, reliability (slim)
  const verdictBlock = (
    <HeroVerdict summary={summary} blurred={level === "retry"} />
  );
  const topPriorityBlock = <TopPriorityCard summary={summary} />;
  const practiceBlock = <ThisWeekPractice summary={summary} />;
  const reliabilityBlock = <ReliabilityStrip summary={summary} />;

  const ordered: React.ReactNode[] = [];

  if (urgency !== "none") {
    ordered.push(<RetakeBanner key="retake" summary={summary} />);
  }

  if (level === "retry") {
    ordered.push(<Fragment key="rel">{reliabilityBlock}</Fragment>);
    ordered.push(<Fragment key="verdict">{verdictBlock}</Fragment>);
    ordered.push(<Fragment key="top">{topPriorityBlock}</Fragment>);
    ordered.push(<Fragment key="practice">{practiceBlock}</Fragment>);
  } else if (level === "reference") {
    ordered.push(<Fragment key="verdict">{verdictBlock}</Fragment>);
    if (compareBlock) ordered.push(<Fragment key="compare">{compareBlock}</Fragment>);
    ordered.push(<Fragment key="rel">{reliabilityBlock}</Fragment>);
    ordered.push(<Fragment key="top">{topPriorityBlock}</Fragment>);
    ordered.push(<Fragment key="practice">{practiceBlock}</Fragment>);
  } else {
    ordered.push(<Fragment key="verdict">{verdictBlock}</Fragment>);
    if (compareBlock) ordered.push(<Fragment key="compare">{compareBlock}</Fragment>);
    ordered.push(<Fragment key="top">{topPriorityBlock}</Fragment>);
    ordered.push(<Fragment key="practice">{practiceBlock}</Fragment>);
    ordered.push(<Fragment key="rel">{reliabilityBlock}</Fragment>);
  }

  return (
    <div
      className="space-y-4"
      data-testid="middle-split-result-v1-1"
      data-quality-level={level}
      data-input-class={summary.meta.inputClass}
      data-urgency={urgency}
    >
      {ordered}
      <DetailsAccordion summary={summary} />
      {isDebug && <DebugMetaPanel summary={summary} />}
    </div>
  );
}

// ============================================================
// [0] Retake CTA banner
// ============================================================

function RetakeBanner({ summary }: { summary: StructuredSummary }) {
  const { retakeAdvice } = summary;
  const urgency = retakeAdvice.urgency;
  if (urgency === "none") return null;

  const reasons = retakeAdvice.reasons.slice(0, 2);

  const tone =
    urgency === "required"
      ? "bg-red-500/10 border-red-500/40 text-red-200"
      : "bg-yellow-500/10 border-yellow-500/40 text-yellow-200";
  const title =
    urgency === "required"
      ? "撮り直しが必要です"
      : "次回はこう撮るとより正確になります";

  return (
    <div
      className={`rounded-xl border p-4 ${tone} ${urgency === "required" ? "sticky top-2 z-10 shadow-lg" : ""}`}
      data-testid="retake-banner"
      data-urgency={urgency}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {reasons.length > 0 && (
            <ul className="mt-2 space-y-2 text-xs leading-relaxed">
              {reasons.map((r) => (
                <li key={r.code}>
                  <p className="font-medium">・{r.message}</p>
                  <p className="opacity-80 ml-3 mt-0.5">{r.howToFix}</p>
                </li>
              ))}
            </ul>
          )}
          {urgency === "required" && (
            <p className="mt-2 text-[11px] opacity-80 border-t border-white/10 pt-2">
              撮り直しは分析回数を消費しません。条件を整えてからもう一度お試しください。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// [1] Hero verdict
// ============================================================

function HeroVerdict({
  summary,
  blurred,
}: {
  summary: StructuredSummary;
  blurred: boolean;
}) {
  const { currentStateSummary, meta } = summary;
  const main = currentStateSummary.mainMetric;
  const progressPct = Math.min(100, Math.max(0, main.progressRatio * 100));
  const isReference = meta.qualityLevel === "reference";

  const angleColor =
    main.value >= 170
      ? "text-green-400"
      : main.value >= 150
        ? "text-yellow-400"
        : main.value >= 120
          ? "text-orange-400"
          : "text-red-400";
  const barColor =
    main.value >= 170
      ? "bg-green-400"
      : main.value >= 150
        ? "bg-yellow-400"
        : main.value >= 120
          ? "bg-orange-400"
          : "bg-red-400";

  return (
    <div
      className={`rounded-xl p-5 border bg-gradient-to-br from-purple-500/10 to-pink-500/5 border-purple-500/30 ${blurred ? "opacity-60" : ""}`}
      data-testid="hero-verdict"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p
          className="text-base text-gray-100 leading-relaxed font-medium"
          data-testid="hero-verdict-headline"
        >
          {currentStateSummary.headline}
        </p>
        <span
          className={`flex-shrink-0 text-xs font-mono px-2 py-1 rounded border ${
            isReference
              ? "bg-yellow-500/10 border-yellow-500/40 text-yellow-300"
              : "bg-gray-700/60 border-gray-600 text-gray-300"
          }`}
          title={isReference ? "参考値です" : undefined}
        >
          {isReference ? "参考値 " : "スコア "}
          {currentStateSummary.score}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs text-gray-500">{main.label}</span>
        <span className={`text-4xl font-bold font-mono ${angleColor}`}>
          {main.value}
        </span>
        <span className="text-xl text-gray-400">{main.unit}</span>
        <span className="text-xs text-gray-500 ml-1">
          / 目標 {main.target}
          {main.unit}
        </span>
      </div>
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// [2] Top priority (strongest limiter as its own card)
// ============================================================

function TopPriorityCard({ summary }: { summary: StructuredSummary }) {
  const top = summary.primaryLimiters[0];
  if (!top) return null;

  const sevTone = sevBadgeTone(top.severity);
  const pct = progressPctForThreshold(top.evidence.value, top.evidence.threshold);

  return (
    <div
      className="rounded-xl p-5 border bg-gray-800/60 border-gray-700"
      data-testid="top-priority-card"
      data-limiter-id={top.id}
    >
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-purple-300" />
        <span className="text-[11px] uppercase tracking-wider text-purple-300 font-semibold">
          最優先
        </span>
        {top.estimatedImpact > 0 && (
          <span className="ml-auto text-[10px] text-red-400/80 font-mono">
            -{top.estimatedImpact.toFixed(1)}点相当
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h3 className="text-lg text-gray-100 font-semibold">{top.label}</h3>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${sevTone}`}
        >
          {top.severity}
        </span>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed mb-3">{top.finding}</p>
      {top.evidence.threshold && (
        <div>
          <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 mb-1">
            <span>
              実測 {top.evidence.value}
              {top.evidence.unit}
            </span>
            <span>
              warn {top.evidence.threshold.warn} / fail {top.evidence.threshold.fail}
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-400/70"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function progressPctForThreshold(
  value: number,
  threshold?: { warn: number; fail: number },
): number {
  if (!threshold) return 0;
  // Visualize "how far past warn toward fail" we are — clamped 0..100.
  const span = Math.abs(threshold.fail - threshold.warn) || 1;
  const past = Math.abs(value - threshold.warn);
  return Math.max(10, Math.min(100, (past / span) * 100));
}

// ============================================================
// [3] This-week practice
// ============================================================

function ThisWeekPractice({ summary }: { summary: StructuredSummary }) {
  const [expanded, setExpanded] = useState(false);
  const items = summary.improvementPriorities;
  const top = items[0];
  if (!top) return null;
  const rest = items.slice(1);

  return (
    <div
      className="rounded-xl p-5 border bg-gray-800/50 border-gray-700"
      data-testid="this-week-practice"
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-purple-300" />
        <span className="text-[11px] uppercase tracking-wider text-purple-300 font-semibold">
          今週まずこれ
        </span>
      </div>
      <div className="border-l-2 border-purple-500/40 pl-3">
        <p className="text-sm text-purple-200 font-medium">{top.focus}</p>
        <p className="text-xs text-gray-300 mt-1 leading-relaxed">{top.practice}</p>
        <p className="text-[10px] text-gray-500 mt-1">{top.durationHint}</p>
      </div>
      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 text-xs text-purple-300/80 hover:text-purple-200 flex items-center gap-1"
            data-testid="this-week-practice-toggle"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                残り {rest.length} 件を隠す
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                残り {rest.length} 件を見る
              </>
            )}
          </button>
          {expanded && (
            <ul className="mt-3 space-y-3">
              {rest.map((p, i) => (
                <li
                  key={`${p.forLimiterId}-${i}`}
                  className="border-l-2 border-gray-600/60 pl-3"
                >
                  <p className="text-sm text-gray-200 font-medium">{p.focus}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                    {p.practice}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">{p.durationHint}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-[10px] text-gray-500 border-t border-gray-700/50 pt-2">
        痛みを感じたら必ず中止してください。
      </p>
    </div>
  );
}

// ============================================================
// [4] Reliability strip
// ============================================================

function ReliabilityStrip({ summary }: { summary: StructuredSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { reliabilitySummary } = summary;
  const pct = Math.round(reliabilitySummary.overall * 100);
  const level = reliabilitySummary.level;

  const tone =
    level === "good"
      ? "bg-green-500/10 border-green-500/30 text-green-300"
      : level === "reference"
        ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-200"
        : "bg-red-500/10 border-red-500/30 text-red-200";
  const levelLabel =
    level === "good"
      ? "通常採点"
      : level === "reference"
        ? "参考値（精度注意）"
        : "再撮影推奨";
  const interpretation =
    level === "good"
      ? "このまま信頼できます"
      : level === "reference"
        ? "指標の傾向は読めますが、角度は±5°程度ブレる可能性があります"
        : "数値は参考にしないでください";

  const topFactor = [...reliabilitySummary.factors].sort(
    (a, b) => a.score - b.score,
  )[0];

  return (
    <div
      className={`rounded-xl border ${tone}`}
      data-testid="reliability-strip"
      data-level={level}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm"
      >
        <Info className="w-4 h-4 flex-shrink-0" />
        <span className="font-medium">信頼度 {pct}%</span>
        <span className="opacity-70">·</span>
        <span>{levelLabel}</span>
        {topFactor && (
          <>
            <span className="opacity-70">·</span>
            <span className="text-xs opacity-80">
              {topFactor.name} {Math.round(topFactor.score * 100)}%
            </span>
          </>
        )}
        <span className="ml-auto opacity-70">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>
      <div className="px-4 pb-3">
        <p className="text-[11px] opacity-80">{interpretation}</p>
        {expanded && (
          <div className="mt-2 border-t border-white/10 pt-2 space-y-1.5">
            {reliabilitySummary.factors.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-2 text-[11px] font-mono"
              >
                <span className="w-20 opacity-70">{f.name}</span>
                <div className="flex-1 h-1 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-current opacity-70"
                    style={{ width: `${Math.round(f.score * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right">
                  {Math.round(f.score * 100)}%
                </span>
              </div>
            ))}
            <p className="text-[10px] opacity-70 mt-1">{reliabilitySummary.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// [5] History compare row
// ============================================================

function HistoryCompareRow({
  comparison,
}: {
  comparison: MiddleSplitComparison;
}) {
  const prevDate = new Date(comparison.previous.timestamp);
  const prevLabel = `${prevDate.getMonth() + 1}/${prevDate.getDate()}`;

  if (!comparison.comparable) {
    return (
      <div
        className="rounded-xl border bg-gray-800/40 border-gray-700/60 p-4"
        data-testid="history-compare-row"
        data-comparable="false"
      >
        <div className="flex items-center gap-2 mb-1 text-xs text-gray-400">
          <History className="w-3.5 h-3.5" />
          <span>前回比 ({prevLabel})</span>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          {comparison.incomparableReason ?? "前回と比較できませんでした。"}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border bg-gray-800/40 border-gray-700/60 p-4"
      data-testid="history-compare-row"
      data-comparable="true"
    >
      <div className="flex items-center gap-2 mb-3 text-xs text-gray-400">
        <History className="w-3.5 h-3.5" />
        <span>前回比 ({prevLabel})</span>
        {comparison.limiter.kind === "changed" && (
          <span
            className="ml-auto text-[10px] text-purple-300/80"
            data-testid="limiter-change"
          >
            課題が変化: {comparison.limiter.previousLabel ?? "—"} →{" "}
            {comparison.limiter.latestLabel ?? "—"}
          </span>
        )}
        {comparison.limiter.kind === "same" && comparison.limiter.latestLabel && (
          <span className="ml-auto text-[10px] text-gray-500">
            最優先: {comparison.limiter.latestLabel}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {comparison.deltas.map((d) => (
          <DeltaChip key={d.key} delta={d} />
        ))}
      </div>
      {comparison.cautionNote && (
        <p className="mt-2 text-[10px] text-yellow-200/80 border-t border-white/5 pt-2">
          {comparison.cautionNote}
        </p>
      )}
    </div>
  );
}

function DeltaChip({
  delta,
}: {
  delta: MiddleSplitComparison["deltas"][number];
}) {
  const verdict = delta.verdict;
  const tone =
    verdict === "improved"
      ? "bg-green-500/10 border-green-500/30 text-green-300"
      : verdict === "regressed"
        ? "bg-red-500/10 border-red-500/30 text-red-300"
        : "bg-gray-700/40 border-gray-600/50 text-gray-400";
  const Icon =
    verdict === "improved"
      ? ArrowUp
      : verdict === "regressed"
        ? ArrowDown
        : ArrowRight;
  const sign = delta.delta > 0 ? "+" : "";
  return (
    <div
      className={`rounded-lg border px-2.5 py-2 text-[11px] ${tone}`}
      data-testid={`delta-chip-${delta.key}`}
      data-verdict={verdict}
    >
      <div className="flex items-center gap-1 opacity-80">
        <span className="truncate">{delta.label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1 font-mono">
        <span className="text-sm font-semibold">
          {Math.round(delta.latest * 10) / 10}
          {delta.unit}
        </span>
        <Icon className="w-3 h-3" />
        <span className="text-[10px] opacity-75">
          {sign}
          {delta.delta}
          {delta.unit}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// [6] Details accordion
// ============================================================

function DetailsAccordion({ summary }: { summary: StructuredSummary }) {
  const [open, setOpen] = useState(false);
  const secondary = summary.primaryLimiters.slice(1);
  const positives = summary.currentStateSummary.positiveNotes;
  const mainFindings = summary.mainFindings;

  const hasAnything =
    secondary.length > 0 || positives.length > 0 || mainFindings.length > 0;
  if (!hasAnything) return null;

  return (
    <div
      className="bg-gray-800/30 rounded-xl border border-gray-700/50"
      data-testid="details-accordion"
      data-open={open}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-sm text-gray-400 hover:text-gray-300"
      >
        <span>詳細指標</span>
        {open ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {secondary.length > 0 && (
            <section>
              <h4 className="text-xs font-medium text-gray-400 mb-2">
                その他の課題
              </h4>
              <ul className="space-y-2">
                {secondary.map((lim) => (
                  <li
                    key={lim.id}
                    className="border-l-2 pl-3 py-0.5 text-xs"
                    style={{
                      borderColor: sevBorderColor(lim.severity),
                    }}
                    data-testid="secondary-limiter"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-medium ${sevTextColor(lim.severity)}`}
                      >
                        {lim.label}
                      </span>
                      {lim.estimatedImpact > 0 && (
                        <span className="text-[10px] text-red-400/70 font-mono ml-auto">
                          -{lim.estimatedImpact.toFixed(1)}pt
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 mt-1 leading-relaxed">
                      {lim.finding}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {positives.length > 0 && (
            <section>
              <h4 className="text-xs font-medium text-gray-400 mb-1">
                良かった点
              </h4>
              <ul className="text-xs text-green-300/80 space-y-0.5">
                {positives.map((p, i) => (
                  <li key={i}>・{p}</li>
                ))}
              </ul>
            </section>
          )}

          {mainFindings.length > 0 && (
            <section>
              <h4 className="text-xs font-medium text-gray-400 mb-1">
                主要メトリクス
              </h4>
              <ul className="text-[11px] text-gray-500 font-mono space-y-0.5">
                {mainFindings.map((m, i) => (
                  <li key={i}>・{m}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// [7] Debug meta panel (debug=true only)
// ============================================================

function DebugMetaPanel({ summary }: { summary: StructuredSummary }) {
  const meta = summary.meta;
  const rows: [string, string | number | boolean][] = [
    ["technique", meta.technique],
    ["configVersion", meta.configVersion],
    ["evaluatorVersion", meta.evaluatorVersion],
    ["summaryVersion", meta.summaryVersion],
    ["captureGuidanceVersion", meta.captureGuidanceVersion],
    ["reliability", meta.reliability],
    ["qualityLevel", meta.qualityLevel],
    ["retakeRecommended", meta.retakeRecommended],
    ["historyComparable", meta.historyComparable],
    ["inputClass", meta.inputClass],
    ["generatedAt", meta.generatedAt],
  ];

  return (
    <div
      className="rounded-xl p-4 border bg-purple-500/5 border-purple-500/30"
      data-testid="debug-meta-panel"
    >
      <div className="flex items-center gap-2 mb-2">
        <Camera className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-purple-300">
          middle_split meta
        </h3>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-400">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-gray-500">{k}</dt>
            <dd
              className="text-gray-300 truncate"
              data-testid={`debug-meta-${k}`}
            >
              {String(v)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

// ============================================================
// helpers
// ============================================================

function sevBadgeTone(sev: Severity): string {
  return sev === "critical"
    ? "bg-red-500/20 border-red-500/40 text-red-300"
    : sev === "major"
      ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
      : "bg-gray-500/20 border-gray-500/40 text-gray-300";
}

function sevTextColor(sev: Severity): string {
  return sev === "critical"
    ? "text-red-400"
    : sev === "major"
      ? "text-yellow-400"
      : "text-gray-400";
}

function sevBorderColor(sev: Severity): string {
  return sev === "critical" ? "#f87171" : sev === "major" ? "#fbbf24" : "#6b7280";
}
