/**
 * Regression tests using realistic pose fixtures.
 *
 * These tests verify that specific evaluator behaviors are stable:
 * - Known-good poses produce expected score ranges
 * - Known-bad poses trigger specific violations
 * - Score ordering is preserved (good > bad for same technique)
 *
 * These are NOT exact-match tests. They assert:
 * - "at least this violation appears"
 * - "score is within this range"
 * - "this event type is detected"
 */

import { describe, it, expect } from "vitest";
import { evaluate } from "@/lib/analysis/evaluators";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { EvaluationResult } from "@/lib/analysis/types";
import { FIXTURES } from "./fixtures";

function runEval(
  technique: "handstand" | "planche" | "swipes",
  series: ReturnType<typeof FIXTURES.handstand.good>
): EvaluationResult {
  const normalized = normalizePoseTimeSeries(series);
  const features = extractFeatures(normalized);
  return evaluate(technique, normalized, features);
}

// ---- Handstand Regression ----

describe("Handstand Regression", () => {
  it("good handstand scores ≥ 40", () => {
    const result = runEval("handstand", FIXTURES.handstand.good());
    expect(result.finalScore).toBeGreaterThanOrEqual(40);
  });

  it("good handstand scores higher than arched-back", () => {
    const good = runEval("handstand", FIXTURES.handstand.good());
    const arched = runEval("handstand", FIXTURES.handstand.archedBack());
    expect(good.finalScore).toBeGreaterThan(arched.finalScore);
  });

  it("arched-back handstand triggers spine or hip violation", () => {
    const result = runEval("handstand", FIXTURES.handstand.archedBack());
    const spineOrHipViolation = result.violations.find(
      v => v.ruleId === "handstand_spine_bend" || v.ruleId === "handstand_hip_bend"
    );
    expect(spineOrHipViolation).toBeDefined();
  });

  it("all violations have scoreImpact", () => {
    const result = runEval("handstand", FIXTURES.handstand.archedBack());
    for (const v of result.violations) {
      expect(v.scoreImpact).toBeDefined();
      expect(v.scoreImpact).toBeGreaterThanOrEqual(0);
    }
  });

  it("violations are ranked by scoreImpact (descending)", () => {
    const result = runEval("handstand", FIXTURES.handstand.archedBack());
    if (result.violations.length >= 2) {
      for (let i = 1; i < result.violations.length; i++) {
        const prev = result.violations[i - 1].scoreImpact ?? 0;
        const curr = result.violations[i].scoreImpact ?? 0;
        // Allow equal impact (sorted by severity/confidence as tiebreaker)
        expect(prev).toBeGreaterThanOrEqual(curr - 0.01);
      }
    }
  });

  it("has stability breakdown for video input", () => {
    const result = runEval("handstand", FIXTURES.handstand.good());
    const stability = result.breakdown.find(b => b.category === "stability");
    expect(stability).toBeDefined();
  });
});

// ---- Planche Regression ----

describe("Planche Regression", () => {
  it("hip-sag planche triggers hip_sag violation", () => {
    const result = runEval("planche", FIXTURES.planche.hipSag());
    const hipSag = result.violations.find(v => v.ruleId === "planche_hip_sag");
    expect(hipSag).toBeDefined();
    expect(hipSag!.bodyPart).toBe("骨盤");
  });

  it("bent-elbow planche triggers elbow_bend violation", () => {
    const result = runEval("planche", FIXTURES.planche.bentElbow());
    const elbowBend = result.violations.find(v => v.ruleId === "planche_elbow_bend");
    expect(elbowBend).toBeDefined();
    expect(elbowBend!.bodyPart).toBe("肘");
  });

  it("bent-elbow planche has elbow_lockout breakdown with low score", () => {
    const result = runEval("planche", FIXTURES.planche.bentElbow());
    const elbowBreakdown = result.breakdown.find(b => b.category === "elbow_lockout");
    expect(elbowBreakdown).toBeDefined();
    expect(elbowBreakdown!.score).toBeLessThan(80);
  });

  it("hip-sag and bent-elbow both produce suggestions", () => {
    const hipSag = runEval("planche", FIXTURES.planche.hipSag());
    const bentElbow = runEval("planche", FIXTURES.planche.bentElbow());
    expect(hipSag.suggestionsRaw.length).toBeGreaterThan(0);
    expect(bentElbow.suggestionsRaw.length).toBeGreaterThan(0);
  });
});

// ---- Swipes Regression ----

describe("Swipes Regression", () => {
  it("swipes with events detects hand_plant events", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    const handPlants = result.events.filter(e => e.type === "hand_plant");
    expect(handPlants.length).toBeGreaterThanOrEqual(1);
  });

  it("swipes with events detects phase_change events", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    const phaseChanges = result.events.filter(e => e.type === "phase_change");
    expect(phaseChanges.length).toBeGreaterThanOrEqual(1);
  });

  it("swipes with events produces score > 0", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    expect(result.finalScore).toBeGreaterThan(0);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("early hand plant scenario produces a result", () => {
    const result = runEval("swipes", FIXTURES.swipes.earlyHandPlant());
    expect(result.technique).toBe("swipes");
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it("meta includes configVersion", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    expect(result.meta.configVersion).toBe("2.0");
    expect(result.meta.totalFrames).toBe(20);
  });

  it("events are sorted by timestamp", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].timestamp).toBeGreaterThanOrEqual(result.events[i - 1].timestamp);
    }
  });
});

// ---- Cross-technique stability ----

describe("Cross-technique stability", () => {
  it("all techniques return expected configVersion", () => {
    const hs = runEval("handstand", FIXTURES.handstand.good());
    const pl = runEval("planche", FIXTURES.planche.hipSag());
    const sw = runEval("swipes", FIXTURES.swipes.withEvents());

    expect(hs.meta.configVersion).toBe("2.0");
    expect(pl.meta.configVersion).toBe("2.3");
    expect(sw.meta.configVersion).toBe("2.0");
  });

  it("all techniques return breakdown weights summing to ~1.0", () => {
    const results = [
      runEval("handstand", FIXTURES.handstand.good()),
      runEval("planche", FIXTURES.planche.hipSag()),
      runEval("swipes", FIXTURES.swipes.withEvents()),
    ];

    for (const result of results) {
      const totalWeight = result.breakdown.reduce((s, b) => s + b.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 1);
    }
  });

  it("finalScore equals weighted sum of breakdown scores", () => {
    const results = [
      runEval("handstand", FIXTURES.handstand.good()),
      runEval("planche", FIXTURES.planche.bentElbow()),
      runEval("swipes", FIXTURES.swipes.withEvents()),
    ];

    for (const result of results) {
      const computed = Math.round(
        result.breakdown.reduce((s, b) => s + b.score * b.weight, 0)
      );
      expect(result.finalScore).toBe(computed);
    }
  });
});
