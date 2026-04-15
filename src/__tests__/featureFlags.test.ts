import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isFeatureEnabled, getAllFeatureFlags } from "@/lib/featureFlags";

/**
 * The flag values are read directly from process.env on each call, so we
 * can toggle them per-test. Always restore the original value in afterEach.
 */
describe("featureFlags", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("NEXT_PUBLIC_FEATURE_") || k.startsWith("FEATURE_")) {
        delete process.env[k];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("NEXT_PUBLIC_FEATURE_") || k.startsWith("FEATURE_")) {
        delete process.env[k];
      }
    }
  });

  it("returns the default value when the env var is missing", () => {
    // Defaults in featureFlags.ts are all `true` today
    expect(isFeatureEnabled("middle_split_precapture_check")).toBe(true);
    expect(isFeatureEnabled("middle_split_structured_summary")).toBe(true);
  });

  it("accepts multiple truthy spellings", () => {
    for (const val of ["1", "true", "on", "yes", "TRUE"]) {
      process.env.NEXT_PUBLIC_FEATURE_MIDDLE_SPLIT_PRECAPTURE_CHECK = val;
      expect(isFeatureEnabled("middle_split_precapture_check")).toBe(true);
    }
  });

  it("accepts multiple falsy spellings", () => {
    for (const val of ["0", "false", "off", "no"]) {
      process.env.NEXT_PUBLIC_FEATURE_MIDDLE_SPLIT_PRECAPTURE_CHECK = val;
      expect(isFeatureEnabled("middle_split_precapture_check")).toBe(false);
    }
  });

  it("falls back to default when env value is unrecognized", () => {
    process.env.NEXT_PUBLIC_FEATURE_MIDDLE_SPLIT_PRECAPTURE_CHECK = "maybe";
    expect(isFeatureEnabled("middle_split_precapture_check")).toBe(true);
  });

  it("uses the FEATURE_ prefix for server-only flags", () => {
    process.env.FEATURE_ANALYSIS_METRICS = "false";
    expect(isFeatureEnabled("analysis_metrics")).toBe(false);
    // Client-prefixed var should NOT affect a server-only flag
    process.env.NEXT_PUBLIC_FEATURE_ANALYSIS_METRICS = "true";
    expect(isFeatureEnabled("analysis_metrics")).toBe(false);
  });

  it("getAllFeatureFlags returns every known flag", () => {
    const flags = getAllFeatureFlags();
    expect(flags.middle_split_precapture_check).toBeTypeOf("boolean");
    expect(flags.middle_split_structured_summary).toBeTypeOf("boolean");
    expect(flags.analysis_metrics).toBeTypeOf("boolean");
    expect(flags.history_local_storage).toBeTypeOf("boolean");
  });
});
