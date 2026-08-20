import type { AttributeComparison } from "@/lib/matching/types";

/**
 * Los pesos suman 1.0: una coincidencia perfecta produce confianza 1.0.
 * La presentación NO pesa aquí a propósito: dos presentaciones distintas del
 * mismo medicamento (caja x30 vs x100) se comparan por precio unitario en el
 * motor de precios, no se descartan por homologación (Sección 6, ajustado a
 * pedido del cliente).
 */
const WEIGHTS = {
  concentration: 0.5,
  dosageForm: 0.3,
  ingredientExact: 0.2,
};

export function scoreComparison(comparison: AttributeComparison, ingredientMatchedExactly: boolean): number {
  let score = 0;
  if (comparison.concentrationMatch) score += WEIGHTS.concentration;
  if (comparison.dosageFormMatch) score += WEIGHTS.dosageForm;
  if (ingredientMatchedExactly) score += WEIGHTS.ingredientExact;
  return Math.round(score * 100) / 100;
}
