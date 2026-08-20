import type { AttributeComparison } from "@/lib/matching/types";

/** Los pesos suman 1.0: una coincidencia perfecta produce confianza 1.0. */
const WEIGHTS = {
  concentration: 0.4,
  dosageForm: 0.2,
  presentation: 0.3,
  ingredientExact: 0.1,
};

export function scoreComparison(comparison: AttributeComparison, ingredientMatchedExactly: boolean): number {
  let score = 0;
  if (comparison.concentrationMatch) score += WEIGHTS.concentration;
  if (comparison.dosageFormMatch) score += WEIGHTS.dosageForm;
  if (comparison.presentationMatch) score += WEIGHTS.presentation;
  if (ingredientMatchedExactly) score += WEIGHTS.ingredientExact;
  return Math.round(score * 100) / 100;
}
