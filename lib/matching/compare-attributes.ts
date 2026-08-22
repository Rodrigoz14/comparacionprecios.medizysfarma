import type { AttributeComparison, CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

/**
 * Formas líquidas donde "X%" (peso/volumen) equivale a X*10 mg/mL — la
 * convención real de gotas oftálmicas y otras soluciones (confirmado en
 * datos reales: Disfarma/Ramédicas escriben "5MG/ML (0.5%)" para el mismo
 * producto). No aplica a sólidos/semisólidos (cremas, geles), donde "X%"
 * significa peso/peso (X g por 100g) y por eso el catálogo ya lo guarda
 * directamente en G sin necesitar conversión.
 */
const PERCENT_TO_MG_PER_ML_FORMS = new Set(["Solución", "Gotas", "Suspensión", "Jarabe"]);

/**
 * Un cliente a veces escribe la concentración en porcentaje ("0.5%") en vez
 * de mg/mL, como lo guarda el catálogo — son la misma concentración, solo
 * expresada distinto (bug real: "Carboximetilcelulosa gotas al 0.5%" no
 * encontraba el producto real, guardado como "5MG"). Es una conversión
 * matemática exacta (% p/v = g/100mL = 10×mg/mL), no una inferencia.
 */
function concentrationsMatch(target: ExtractedAttributes, candidate: CandidateProduct): boolean {
  const targetUnit = target.concentrationUnit.toUpperCase();
  const candidateUnit = candidate.concentrationUnit.toUpperCase();
  if (target.concentration === candidate.concentration && targetUnit === candidateUnit) return true;
  if (!PERCENT_TO_MG_PER_ML_FORMS.has(candidate.dosageForm)) return false;

  const asMgPerMl = (value: string, unit: string): number | null => {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    if (unit === "MG") return parsed;
    if (unit === "%") return parsed * 10;
    return null;
  };

  const targetMg = asMgPerMl(target.concentration, targetUnit);
  const candidateMg = asMgPerMl(candidate.concentration, candidateUnit);
  return targetMg !== null && candidateMg !== null && Math.abs(targetMg - candidateMg) < 0.001;
}

/**
 * Compara atributos estructurados (nunca similitud de texto libre) entre lo
 * solicitado y un candidato ya encontrado por principio activo o sinónimo.
 */
export function compareAttributes(target: ExtractedAttributes, candidate: CandidateProduct): AttributeComparison {
  return {
    activeIngredientMatch: true, // candidate-search ya filtró por ingrediente o sinónimo conocido
    concentrationMatch: concentrationsMatch(target, candidate),
    dosageFormMatch: target.dosageForm === candidate.dosageForm,
    presentationMatch:
      target.presentationQuantity === candidate.presentationQuantity &&
      target.presentationUnit === candidate.presentationUnit,
  };
}
