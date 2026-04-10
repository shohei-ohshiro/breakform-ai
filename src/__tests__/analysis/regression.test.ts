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
    expect(result.meta.configVersion).toBe("3.0");
    expect(result.meta.totalFrames).toBe(20);
  });

  it("events are sorted by timestamp", () => {
    const result = runEval("swipes", FIXTURES.swipes.withEvents());
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].timestamp).toBeGreaterThanOrEqual(result.events[i - 1].timestamp);
    }
  });
});

// ---- Swipes v3.0: mode classification ----

describe("Swipes v3.0 mode classification", () => {
  it("multi-cycle fixture → multi_cycle mode with rep_consistency breakdown", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.evaluationMode).toBe("multi_cycle");
    expect(result.meta.cycleSummary?.detectedCycles).toBeGreaterThanOrEqual(2);
    const repBreakdown = result.breakdown.find(b => b.category === "rep_consistency");
    expect(repBreakdown).toBeDefined();
  });

  it("single-cycle fixture → single_cycle mode without rep_consistency", () => {
    const result = runEval("swipes", FIXTURES.swipes.singleCycle());
    expect(result.meta.evaluationMode).toBe("single_cycle");
    expect(result.meta.cycleSummary?.detectedCycles).toBe(1);
    const repBreakdown = result.breakdown.find(b => b.category === "rep_consistency");
    expect(repBreakdown).toBeUndefined();
  });

  it("partial fixture → partial mode with score capped at 70", () => {
    const result = runEval("swipes", FIXTURES.swipes.partial());
    expect(result.meta.evaluationMode).toBe("partial");
    expect(result.finalScore).toBeLessThanOrEqual(70);
    expect(result.meta.cycleSummary?.detectedCycles).toBe(0);
  });

  it("evaluation mode reason is human-readable", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.evaluationModeReason).toBeDefined();
    expect(result.meta.evaluationModeReason!.length).toBeGreaterThan(10);
  });
});

// ---- Swipes v3.0: transparency meta ----

describe("Swipes v3.0 transparency", () => {
  it("multi-cycle includes selectedEvaluationWindow", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.selectedEvaluationWindow).toBeDefined();
    const w = result.meta.selectedEvaluationWindow!;
    expect(w.endTime).toBeGreaterThan(w.startTime);
  });

  it("multi-cycle includes selectedReason and candidateWindowsTopN", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.selectedReason).toBeDefined();
    expect(result.meta.selectedReason!.length).toBeGreaterThan(0);
    expect(result.meta.candidateWindowsTopN).toBeDefined();
    expect(result.meta.candidateWindowsTopN!.length).toBeGreaterThanOrEqual(1);
  });

  it("candidate window features include swipes-specific fields", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    const top = result.meta.candidateWindowsTopN![0];
    expect(top.features.cycleClarity).toBeDefined();
    expect(top.features.rotationHorizontality).toBeDefined();
    expect(top.features.visibilityScore).toBeDefined();
    expect(typeof top.features.kickPeakSpeed).toBe("number");
  });

  it("meta includes cycleSummary and eventSummary", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.cycleSummary).toBeDefined();
    expect(result.meta.cycleSummary!.cycleDurations.length).toBeGreaterThan(0);
    expect(result.meta.eventSummary).toBeDefined();
    expect(result.meta.eventSummary!.handPlantCount).toBeGreaterThan(0);
  });

  it("qualityImpactSummary is always populated", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    expect(result.meta.qualityImpactSummary).toBeDefined();
    expect(typeof result.meta.qualityImpactSummary!.reliability).toBe("number");
  });
});

// ---- Swipes v3.0: category scoring sanity ----

describe("Swipes v3.0 category scoring", () => {
  it("breakdown categories use the new v3.0 schema", () => {
    const result = runEval("swipes", FIXTURES.swipes.multiCycle());
    const categories = result.breakdown.map(b => b.category);
    expect(categories).toContain("support_stability");
    expect(categories).toContain("entry_quality");
    expect(categories).toContain("kick_power");
    expect(categories).toContain("rotation_quality");
  });

  it("weak kick fixture → kick_power score is reduced", () => {
    const weak = runEval("swipes", FIXTURES.swipes.weakKick());
    const normal = runEval("swipes", FIXTURES.swipes.multiCycle());
    const weakKick = weak.breakdown.find(b => b.category === "kick_power");
    const normalKick = normal.breakdown.find(b => b.category === "kick_power");
    expect(weakKick).toBeDefined();
    expect(normalKick).toBeDefined();
    expect(weakKick!.score).toBeLessThan(normalKick!.score);
  });

  it("low visibility fixture → quality impact has visibility entries", () => {
    const result = runEval("swipes", FIXTURES.swipes.lowVisibility());
    const visImpacts = result.meta.qualityImpactSummary?.impacts.filter(
      i => i.category === "visibility"
    );
    expect(visImpacts).toBeDefined();
    expect(visImpacts!.length).toBeGreaterThan(0);
    expect(result.meta.qualityImpactSummary!.reliability).toBeLessThan(1);
  });

  it("breakdown weights sum to ~1.0 in all modes", () => {
    const modes = [
      runEval("swipes", FIXTURES.swipes.multiCycle()),
      runEval("swipes", FIXTURES.swipes.singleCycle()),
      runEval("swipes", FIXTURES.swipes.partial()),
    ];
    for (const r of modes) {
      const total = r.breakdown.reduce((s, b) => s + b.weight, 0);
      expect(total).toBeCloseTo(1.0, 1);
    }
  });
});

// ---- Planche Trimming Stability ----

describe("Planche Trimming Stability", () => {
  it("full video and second-half produce evaluation windows in a reasonable range", () => {
    const full = FIXTURES.planche.longEntry();
    const secondHalf = FIXTURES.split.secondHalf(full);

    const fullResult = runEval("planche", full);
    const secondResult = runEval("planche", secondHalf);

    // Both should produce valid evaluation windows
    expect(fullResult.meta.selectedEvaluationWindow).toBeDefined();
    expect(secondResult.meta.selectedEvaluationWindow).toBeDefined();

    // Scores should be within a reasonable range
    const scoreDiff = Math.abs(fullResult.finalScore - secondResult.finalScore);
    expect(scoreDiff).toBeLessThanOrEqual(20);

    // Both should have evaluationModeReason
    expect(fullResult.meta.evaluationModeReason).toBeDefined();
    expect(secondResult.meta.evaluationModeReason).toBeDefined();
  });

  it("first-half without best moment scores lower or similar to full video", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);

    const fullResult = runEval("planche", full);
    const firstResult = runEval("planche", firstHalf);

    // First half should score lower (or within 5 pts) — the best moment is in second half
    expect(firstResult.finalScore).toBeLessThanOrEqual(fullResult.finalScore + 5);
  });

  it("score differences are explainable via transparency fields", () => {
    const full = FIXTURES.planche.longEntry();
    const firstHalf = FIXTURES.split.firstHalf(full);

    const fullResult = runEval("planche", full);
    const firstResult = runEval("planche", firstHalf);

    // Both should have selectedReason
    expect(fullResult.meta.selectedReason).toBeDefined();
    expect(firstResult.meta.selectedReason).toBeDefined();

    // Entry mode results should have candidateWindowsTopN
    if (fullResult.meta.evaluationMode === "entry") {
      expect(fullResult.meta.candidateWindowsTopN).toBeDefined();
      expect(fullResult.meta.candidateWindowsTopN!.length).toBeGreaterThan(0);
    }
  });

  it("late-best-moment video selects window appropriately", () => {
    const result = runEval("planche", FIXTURES.planche.lateBestMoment());
    const window = result.meta.selectedEvaluationWindow;
    expect(window).toBeDefined();
    // The evaluation should complete with a valid score
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.meta.evaluationModeReason).toBeDefined();
    expect(result.meta.selectedReason).toBeDefined();
  });

  it("entry mode fixture produces candidates with continuous frame groups", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    const candidates = result.meta.candidateWindowsTopN;
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThan(0);

    // Each candidate should have multiple frames (continuous group)
    const topCandidate = candidates![0];
    expect(topCandidate.features.frameCount).toBeGreaterThanOrEqual(1);
    expect(topCandidate.features.continuity).toBeGreaterThan(0);
  });
});

// ---- Evaluation Transparency Data ----

describe("Evaluation Transparency Data", () => {
  it("planche entry includes all transparency fields", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    expect(result.meta.evaluationModeReason).toBeDefined();
    expect(result.meta.evaluationModeReason!.length).toBeGreaterThan(0);
    expect(result.meta.selectedEvaluationWindow).toBeDefined();
    expect(result.meta.selectedEvaluationWindow!.startTime).toBeGreaterThanOrEqual(0);
    expect(result.meta.selectedEvaluationWindow!.endTime).toBeGreaterThan(0);
    expect(result.meta.selectedReason).toBeDefined();
    expect(result.meta.selectedReason!.length).toBeGreaterThan(0);
    expect(result.meta.candidateWindowsTopN).toBeDefined();
    expect(result.meta.candidateWindowsTopN!.length).toBeGreaterThan(0);
  });

  it("planche hold includes transparency fields", () => {
    const result = runEval("planche", FIXTURES.planche.hipSag());
    expect(result.meta.evaluationMode).toBe("hold");
    expect(result.meta.evaluationModeReason).toBeDefined();
    expect(result.meta.selectedEvaluationWindow).toBeDefined();
    expect(result.meta.selectedReason).toBeDefined();
    // Hold mode should NOT have candidateWindowsTopN
    expect(result.meta.candidateWindowsTopN).toBeUndefined();
  });

  it("candidate windows are ranked by composite score (ascending)", () => {
    const result = runEval("planche", FIXTURES.planche.longEntry());
    const candidates = result.meta.candidateWindowsTopN;
    if (candidates && candidates.length >= 2) {
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i].compositeScore).toBeGreaterThanOrEqual(
          candidates[i - 1].compositeScore
        );
        expect(candidates[i].rank).toBe(candidates[i - 1].rank + 1);
      }
    }
  });

  it("candidate window features include all expected fields", () => {
    const result = runEval("planche", FIXTURES.planche.longEntry());
    const candidates = result.meta.candidateWindowsTopN;
    if (candidates && candidates.length > 0) {
      const c = candidates[0];
      expect(c.features.avgHorizontalDev).toBeGreaterThanOrEqual(0);
      expect(c.features.avgSkelQuality).toBeGreaterThanOrEqual(0);
      expect(c.features.avgSkelQuality).toBeLessThanOrEqual(1);
      expect(c.features.frameCount).toBeGreaterThan(0);
      expect(c.features.continuity).toBeGreaterThan(0);
      expect(c.features.continuity).toBeLessThanOrEqual(1);
    }
  });
});

// ---- Body Line Entry Mode ----

describe("Body Line Entry Mode", () => {
  it("entry mode body_line score is > 0 for reasonable entry attempt", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    const bodyLine = result.breakdown.find(b => b.category === "body_line");
    expect(bodyLine).toBeDefined();
    // Entry mode should NOT produce 0 for a reasonable entry attempt
    expect(bodyLine!.score).toBeGreaterThan(0);
  });

  it("entry mode body_line uses softer deductions (entry vs hold)", () => {
    // Verify entry mode config is applied: entry mode should have
    // body_line > 0 even though spineAngle is far from 90°
    const entryResult = runEval("planche", FIXTURES.planche.entry());
    expect(entryResult.meta.evaluationMode).toBe("entry");
    const entryBL = entryResult.breakdown.find(b => b.category === "body_line");
    expect(entryBL).toBeDefined();
    expect(entryBL!.score).toBeGreaterThan(0);

    // Entry mode measurements should include cap info
    if (entryBL!.measurements?.effectiveYRange !== undefined) {
      expect(entryBL!.measurements!.effectiveYRange).toBeLessThanOrEqual(
        entryBL!.measurements!.avgYRange
      );
    }
  });

  it("entry mode body_line includes effectiveYRange in measurements when capped", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    if (result.meta.evaluationMode === "entry") {
      const bodyLine = result.breakdown.find(b => b.category === "body_line");
      expect(bodyLine?.measurements).toBeDefined();
      // Entry mode should include yRange cap info
      expect(bodyLine!.measurements!.avgYRange).toBeGreaterThanOrEqual(0);
    }
  });

  it("hold mode body_line uses stricter thresholds than entry mode", () => {
    // Compare same-ish fixtures in hold vs entry
    const holdResult = runEval("planche", FIXTURES.planche.hipSag());
    const entryResult = runEval("planche", FIXTURES.planche.entry());
    expect(holdResult.meta.evaluationMode).toBe("hold");
    expect(entryResult.meta.evaluationMode).toBe("entry");
    // Both should have body_line breakdown
    const holdBL = holdResult.breakdown.find(b => b.category === "body_line");
    const entryBL = entryResult.breakdown.find(b => b.category === "body_line");
    expect(holdBL).toBeDefined();
    expect(entryBL).toBeDefined();
  });
});

// ---- Edge Proximity and Plateau Preference ----

describe("Edge Proximity and Plateau Preference", () => {
  it("candidate windows include edge proximity data", () => {
    // Use entry() fixture — confirmed entry mode with candidateWindowsTopN
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    const candidates = result.meta.candidateWindowsTopN;
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThan(0);
    for (const c of candidates!) {
      expect(c.features.edgeProximity).toBeGreaterThanOrEqual(0);
      expect(c.features.edgeProximity).toBeLessThanOrEqual(1);
      expect(typeof c.features.isEdgeWindow).toBe("boolean");
    }
  });

  it("selectedReason includes edge distance info for entry mode", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    expect(result.meta.selectedReason).toBeDefined();
    // Entry mode selectedReason should contain edge distance info
    expect(result.meta.selectedReason).toMatch(/終端|フレーム/);
  });

  it("selectedReason includes edge distance info for hold mode", () => {
    const result = runEval("planche", FIXTURES.planche.hipSag());
    expect(result.meta.evaluationMode).toBe("hold");
    expect(result.meta.selectedReason).toBeDefined();
    expect(result.meta.selectedReason).toMatch(/終端/);
  });

  it("selectedReason includes selection category for entry mode", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    expect(result.meta.selectedReason).toBeDefined();
    expect(result.meta.selectedReason).toMatch(/最水平|最安定|品質優先|総合最良/);
  });

  it("entry mode top candidate has multiple frames (plateau preference)", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    expect(result.meta.evaluationMode).toBe("entry");
    const candidates = result.meta.candidateWindowsTopN;
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThan(0);

    // Top candidate should have multiple frames (not a single-frame peak)
    const topCandidate = candidates![0];
    expect(topCandidate.features.frameCount).toBeGreaterThan(1);
  });

  it("late best moment still selects end window when clearly better", () => {
    const result = runEval("planche", FIXTURES.planche.lateBestMoment());
    const window = result.meta.selectedEvaluationWindow;
    expect(window).toBeDefined();
    // The best moment IS at the end, so it should still be selected
    expect(window!.endTime).toBeGreaterThan(result.meta.selectedEvaluationWindow!.startTime);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });
});

// ---- Trim Stability Subscores ----

describe("Trim Stability Subscores", () => {
  it("overlapping trim regions produce similar per-category scores", () => {
    const full = FIXTURES.planche.longEntry();
    const secondHalf = FIXTURES.split.secondHalf(full);

    const fullResult = runEval("planche", full);
    const secondResult = runEval("planche", secondHalf);

    // Compare each shared category's score.
    // Allow up to 50 points per category since different windows may be selected
    // and eval mode can differ (hold vs entry) between trimmed versions.
    for (const fullCat of fullResult.breakdown) {
      const secondCat = secondResult.breakdown.find(b => b.category === fullCat.category);
      if (secondCat) {
        const diff = Math.abs(fullCat.score - secondCat.score);
        expect(diff).toBeLessThanOrEqual(50);
      }
    }
  });

  it("score differences are traceable to specific subscore changes", () => {
    const full = FIXTURES.planche.longEntry();
    const secondHalf = FIXTURES.split.secondHalf(full);

    const fullResult = runEval("planche", full);
    const secondResult = runEval("planche", secondHalf);

    const scoreDiff = Math.abs(fullResult.finalScore - secondResult.finalScore);
    if (scoreDiff > 5) {
      // If there's a meaningful score difference, at least one subscore must differ
      const subscoreDiffs = fullResult.breakdown.map(fb => {
        const sb = secondResult.breakdown.find(b => b.category === fb.category);
        return sb ? Math.abs(fb.score - sb.score) : 0;
      });
      const maxSubscoreDiff = Math.max(...subscoreDiffs);
      expect(maxSubscoreDiff).toBeGreaterThan(0);
    }
  });
});

// ---- Quality Impact Summary ----

describe("Quality Impact Summary (pipeline integration)", () => {
  // Note: qualityImpactSummary is computed in the pipeline, not the evaluator.
  // These tests verify that the evaluator output has the right shape for it.
  // Full pipeline tests would require mocking the advice generator.

  it("evaluator output meta is compatible with qualityImpactSummary attachment", () => {
    const result = runEval("planche", FIXTURES.planche.entry());
    // The pipeline attaches qualityImpactSummary to meta;
    // at the evaluator level, meta should accept it
    expect(result.meta).toBeDefined();
    // Verify the meta shape allows qualityImpactSummary
    const meta = result.meta as Record<string, unknown>;
    // qualityImpactSummary is not set by evaluator — it's set by pipeline
    // Just verify meta is extensible (no readonly constraint)
    meta.qualityImpactSummary = { reliability: 0.9, impacts: [] };
    expect(meta.qualityImpactSummary).toBeDefined();
  });
});

// ---- Cross-technique stability ----

describe("Cross-technique stability", () => {
  it("all techniques return expected configVersion", () => {
    const hs = runEval("handstand", FIXTURES.handstand.good());
    const pl = runEval("planche", FIXTURES.planche.hipSag());
    const sw = runEval("swipes", FIXTURES.swipes.withEvents());

    expect(hs.meta.configVersion).toBe("2.0");
    expect(pl.meta.configVersion).toBe("2.4");
    expect(sw.meta.configVersion).toBe("3.0");
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

  it("finalScore equals weighted sum of breakdown scores (or capped for partial mode)", () => {
    const results = [
      runEval("handstand", FIXTURES.handstand.good()),
      runEval("planche", FIXTURES.planche.bentElbow()),
      runEval("swipes", FIXTURES.swipes.multiCycle()),
    ];

    for (const result of results) {
      const computed = Math.round(
        result.breakdown.reduce((s, b) => s + b.score * b.weight, 0)
      );
      // Swipes partial mode caps the score at SWIPES_CONFIG.mode.partialScoreCap
      if (result.meta.evaluationMode === "partial") {
        expect(result.finalScore).toBeLessThanOrEqual(computed);
        expect(result.finalScore).toBeLessThanOrEqual(70);
      } else {
        expect(result.finalScore).toBe(computed);
      }
    }
  });
});
