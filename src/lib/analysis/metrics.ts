/**
 * Minimal server-side metrics emitter for the analyze endpoint.
 *
 * Emits one structured JSON line per analyze request, which hosting
 * platforms like Vercel surface in their log drains. Keeping the shape
 * stable lets downstream dashboards key off fields without re-parsing
 * free text.
 *
 * Gated by the `analysis_metrics` feature flag so it can be turned off
 * cheaply in an incident.
 */

import { isFeatureEnabled } from "@/lib/featureFlags";
import {
  TechniqueId,
  QualityLevel,
  Viewpoint,
  ErrorCode,
} from "./types";

export interface AnalysisMetric {
  /** Fixed marker — makes it easy to grep the log stream. */
  kind: "analysis_metric";
  technique: TechniqueId | null;
  /** success | error */
  outcome: "success" | "error";
  durationMs: number;
  /** Only set on success */
  finalScore?: number;
  qualityLevel?: QualityLevel;
  reliability?: number;
  viewpoint?: Viewpoint;
  /** Only set on error */
  errorCode?: ErrorCode;
  /** Version provenance */
  evaluatorConfigVersion?: string;
  appVersion?: string;
  buildId?: string;
  /** ISO8601 server timestamp */
  ts: string;
}

/**
 * Emit one metric line. Never throws; a logging failure should never
 * break a real analyze request.
 */
export function recordAnalysisMetric(metric: Omit<AnalysisMetric, "kind" | "ts">): void {
  if (!isFeatureEnabled("analysis_metrics")) return;
  try {
    const line: AnalysisMetric = {
      kind: "analysis_metric",
      ts: new Date().toISOString(),
      ...metric,
    };
    // One JSON line per request. Stays under Vercel log size limits.
    console.log(JSON.stringify(line));
  } catch {
    // Intentionally swallow — never let telemetry failures leak.
  }
}
