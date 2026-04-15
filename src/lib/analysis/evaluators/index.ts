import {
  NormalizedTimeSeries,
  FeatureSet,
  EvaluationResult,
  TechniqueId,
  SamplingInfo,
} from "../types";
import { evaluateHandstand } from "./handstand";
import { evaluatePlanche } from "./planche";
import { evaluateSwipes } from "./swipes";
import { evaluateMiddleSplit } from "./middleSplit";

type EvaluatorFn = (
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo,
) => EvaluationResult;

const EVALUATORS: Record<TechniqueId, EvaluatorFn> = {
  handstand: evaluateHandstand,
  planche: evaluatePlanche,
  swipes: evaluateSwipes,
  middle_split: evaluateMiddleSplit,
};

export function evaluate(
  technique: TechniqueId,
  series: NormalizedTimeSeries,
  features: FeatureSet,
  sampling?: SamplingInfo
): EvaluationResult {
  const evaluator = EVALUATORS[technique];
  if (!evaluator) {
    throw new Error(`Unknown technique: ${technique}`);
  }
  return evaluator(series, features, sampling);
}
