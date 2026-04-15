import { describe, it, expect } from "vitest";
import { runPreCaptureCheck } from "@/lib/analysis/preCaptureCheck";
import {
  makeMiddleSplitLandmarks,
  makeStandingLandmarks,
} from "./mock-data";
import { LM } from "@/lib/analysis/types";
import { Landmark } from "@/lib/types";

function withLowVisibility(lm: Landmark[]): Landmark[] {
  return lm.map((l) => ({ ...l, visibility: 0.2 }));
}

describe("runPreCaptureCheck", () => {
  it("blocks when no landmarks are provided", () => {
    const result = runPreCaptureCheck(null, "middle_split");
    expect(result.blocked).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.issues[0].code).toBe("no_person");
  });

  it("does not block a frontally-captured middle_split frame", () => {
    const result = runPreCaptureCheck(
      makeMiddleSplitLandmarks(170),
      "middle_split",
    );
    // The synthetic mock has a narrow pelvis-x by construction, so we
    // allow warn-level frontality notices — but never a hard block.
    expect(result.blocked).toBe(false);
    expect(
      result.issues.some((i) => i.severity === "block"),
    ).toBe(false);
  });

  it("blocks middle_split frames with near-zero horizontal hip width (side view)", () => {
    const lm = makeMiddleSplitLandmarks(170);
    // Collapse hips & shoulders to near-identical x (side view)
    lm[LM.LEFT_HIP] = { ...lm[LM.LEFT_HIP], x: 0.5 };
    lm[LM.RIGHT_HIP] = { ...lm[LM.RIGHT_HIP], x: 0.5 };
    lm[LM.LEFT_SHOULDER] = { ...lm[LM.LEFT_SHOULDER], x: 0.5 };
    lm[LM.RIGHT_SHOULDER] = { ...lm[LM.RIGHT_SHOULDER], x: 0.5 };
    const result = runPreCaptureCheck(lm, "middle_split");
    expect(result.blocked).toBe(true);
    expect(result.issues.some((i) => i.code === "not_frontal")).toBe(true);
  });

  it("blocks when key-landmark visibility is very low", () => {
    const result = runPreCaptureCheck(
      withLowVisibility(makeStandingLandmarks()),
      "handstand",
    );
    expect(result.blocked).toBe(true);
    expect(result.issues.some((i) => i.code === "low_visibility")).toBe(true);
  });

  it("warns (not blocks) when a couple of landmarks are outside the frame", () => {
    const lm = makeStandingLandmarks();
    lm[LM.LEFT_ANKLE] = { ...lm[LM.LEFT_ANKLE], x: -0.1 };
    lm[LM.RIGHT_ANKLE] = { ...lm[LM.RIGHT_ANKLE], x: 1.1 };
    const result = runPreCaptureCheck(lm, "handstand");
    expect(result.blocked).toBe(false);
    expect(result.issues.some((i) => i.code === "image_cropped")).toBe(true);
  });

  it("every issue carries an actionable howToFix string", () => {
    const result = runPreCaptureCheck(null, "planche");
    for (const issue of result.issues) {
      expect(issue.howToFix.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});
