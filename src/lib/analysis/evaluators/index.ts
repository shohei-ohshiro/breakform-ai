import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  TechniqueId,
} from "../types";
import { evaluateHandstand } from "./handstand";
import { evaluatePlanche } from "./planche";
import { evaluateSwipes } from "./swipes";

const EVALUATORS: Record<
  TechniqueId,
  (series: NormalizedTimeSeries, features: FeatureSet) => EvaluationResult
> = {
  handstand: evaluateHandstand,
  planche: evaluatePlanche,
  swipes: evaluateSwipes,
};

export function evaluate(
  technique: TechniqueId,
  series: NormalizedTimeSeries,
  features: FeatureSet
): EvaluationResult {
  const evaluator = EVALUATORS[technique];
  if (!evaluator) {
    throw new Error(`Unknown technique: ${technique}`);
  }
  return evaluator(series, features);
}
