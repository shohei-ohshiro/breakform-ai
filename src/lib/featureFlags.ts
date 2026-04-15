/**
 * Lightweight env-driven feature flag module.
 *
 * ## Design
 * - Flags are resolved once at module load from `process.env`.
 * - Each flag is either on (`"1" | "true" | "on"`) or off (anything else).
 * - Client-visible flags MUST use the `NEXT_PUBLIC_FEATURE_` prefix so Next.js
 *   bundles them. Server-only flags use `FEATURE_`.
 * - Default values below match today's production behavior so adding/removing
 *   a flag never silently changes behavior.
 *
 * ## Adding a flag
 * 1. Add a key + default to `FLAG_DEFAULTS` below.
 * 2. Pick the right env prefix (NEXT_PUBLIC_FEATURE_* if client reads it).
 * 3. Import `isFeatureEnabled("your_flag")` at the call site.
 * 4. Document the flag here when it's enabled/disabled in production.
 */

export type FeatureFlag =
  | "middle_split_precapture_check"
  | "middle_split_structured_summary"
  | "analysis_metrics"
  | "history_local_storage";

interface FlagSpec {
  /** Default when no env var is set. */
  default: boolean;
  /** `NEXT_PUBLIC_FEATURE_*` (client-visible) vs `FEATURE_*` (server-only). */
  visibility: "client" | "server";
  /** Human-readable purpose, surfaced in dev logs. */
  description: string;
}

const FLAG_SPECS: Record<FeatureFlag, FlagSpec> = {
  middle_split_precapture_check: {
    default: true,
    visibility: "client",
    description:
      "Run the client-side pre-capture quality check before the user commits to analyze.",
  },
  middle_split_structured_summary: {
    default: true,
    visibility: "client",
    description:
      "Render the structured summary panel on the middle_split result screen.",
  },
  analysis_metrics: {
    default: true,
    visibility: "server",
    description:
      "Emit one structured JSON log line per analyze request for ops dashboards.",
  },
  history_local_storage: {
    default: true,
    visibility: "client",
    description:
      "Persist compact analysis history to localStorage on the client.",
  },
};

function envKeyFor(flag: FeatureFlag, visibility: "client" | "server"): string {
  const suffix = flag.toUpperCase();
  return visibility === "client"
    ? `NEXT_PUBLIC_FEATURE_${suffix}`
    : `FEATURE_${suffix}`;
}

function parseEnvBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return null;
}

/**
 * Returns the current value of a feature flag.
 * Safe to call on both server and client; client-visible flags are inlined
 * at build time by Next.js.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const spec = FLAG_SPECS[flag];
  const key = envKeyFor(flag, spec.visibility);
  const raw = process.env[key];
  const parsed = parseEnvBoolean(raw);
  return parsed ?? spec.default;
}

/** Returns a plain object of all current flag values. Useful for diagnostics. */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const key of Object.keys(FLAG_SPECS) as FeatureFlag[]) {
    out[key] = isFeatureEnabled(key);
  }
  return out;
}
