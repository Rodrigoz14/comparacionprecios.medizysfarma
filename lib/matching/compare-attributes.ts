import type { AttributeComparison, CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

/**
 * Compara atributos estructurados (nunca similitud de texto libre) entre lo
 * solicitado y un candidato ya encontrado por principio activo o sinónimo.
 */
export function compareAttributes(target: ExtractedAttributes, candidate: CandidateProduct): AttributeComparison {
  return {
    activeIngredientMatch: true, // candidate-search ya filtró por ingrediente o sinónimo conocido
    concentrationMatch:
      target.concentration === candidate.concentration &&
      target.concentrationUnit.toUpperCase() === candidate.concentrationUnit.toUpperCase(),
    dosageFormMatch: target.dosageForm === candidate.dosageForm,
    presentationMatch:
      target.presentationQuantity === candidate.presentationQuantity &&
      target.presentationUnit === candidate.presentationUnit,
  };
}
