/**
 * Client-side analysis history.
 *
 * Persists a compact record of each analyze run to `localStorage` so users can
 * glance at past sessions without a round-trip to the server. Intentionally
 * small — no landmarks, no event arrays, just the fields needed to render a
 * history list and to open the last run's headline.
 *
 * Gated by the `history_local_storage` feature flag so it can be disabled in
 * an incident without shipping new code.
 */

import { isFeatureEnabled } from "@/lib/featureFlags";
import { TechniqueId, QualityLevel } from "./types";

const STORAGE_KEY = "breakform:analysis_history_v1";
const MAX_ENTRIES = 20;

export interface HistoryEntry {
  /** Monotonic-ish id — `${ts}-${random}` — unique enough for a client list. */
  id: string;
  /** ms since epoch, set at save time. */
  timestamp: number;
  technique: TechniqueId;
  trickNameJa: string;
  score: number;
  qualityLevel: QualityLevel;
  reliability: number;
  /** Short headline pulled from structuredSummary when available. */
  headline?: string;
  /** Optional one-line take-away so the list can show something useful. */
  topLimiter?: string;
  /**
   * Middle-split-specific comparison metrics. Present only for middle_split
   * entries that are `historyComparable`. Kept optional so older entries still
   * deserialize cleanly and non-middle_split entries stay compact.
   */
  middleSplit?: {
    splitAngle: number;
    leftRightAngleDiff: number;
    pelvisRollAngle: number;
    trunkLeanAngle: number;
    primaryLimiterId?: string;
    primaryLimiterLabel?: string;
  };
  /** Auxiliary signal for deciding whether two entries are comparable. */
  frontalityScore?: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRaw(): HistoryEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter out malformed entries defensively — old schemas or corruption.
    return parsed.filter(
      (e): e is HistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.id === "string" &&
        typeof e.timestamp === "number" &&
        typeof e.technique === "string" &&
        typeof e.score === "number",
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: HistoryEntry[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or disabled storage — silently drop.
  }
}

/** Returns the history list, newest first. Empty when flag off or unavailable. */
export function getHistory(): HistoryEntry[] {
  if (!isFeatureEnabled("history_local_storage")) return [];
  return readRaw();
}

/**
 * Persist one new entry. Returns the updated list (newest first) so callers
 * can update their UI state without a second read.
 */
export function addHistoryEntry(
  entry: Omit<HistoryEntry, "id" | "timestamp">,
): HistoryEntry[] {
  if (!isFeatureEnabled("history_local_storage")) return [];
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const full: HistoryEntry = { ...entry, id, timestamp: now };
  const current = readRaw();
  const next = [full, ...current].slice(0, MAX_ENTRIES);
  writeRaw(next);
  return next;
}

/** Clear all history. Used by the settings/debug UI. */
export function clearHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Exposed only for tests. */
export const __internal = { STORAGE_KEY, MAX_ENTRIES };
