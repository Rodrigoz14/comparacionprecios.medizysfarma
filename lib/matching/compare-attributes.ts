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
/**
 * Suma las dos partes de un combinado escrito como razón ("1/0.5") -- SOLO
 * tiene sentido cuando la unidad es simple (MG, G...), nunca cuando la
 * unidad ya es compuesta ("MG/ML"): ahí "1/0.5" no son dos principios
 * activos, es dosis/volumen de una sola presentación sellada (ver
 * extract-attributes.ts, formas selladas) y sumarlas no significa nada.
 */
function sumOfSplitDose(value: string): number | null {
  const parts = value.split("/");
  if (parts.length !== 2) return null;
  const sum = parts.reduce((acc, p) => acc + Number.parseFloat(p), 0);
  return Number.isFinite(sum) ? sum : null;
}

function concentrationsMatch(target: ExtractedAttributes, candidate: CandidateProduct): boolean {
  const targetUnit = target.concentrationUnit.toUpperCase();
  const candidateUnit = candidate.concentrationUnit.toUpperCase();
  if (target.concentration === candidate.concentration && targetUnit === candidateUnit) return true;

  // Un combinado real a veces se pide por la dosis TOTAL ("1.5G" de
  // Ampicilina+Sulbactam) en vez de separada por principio ("1G+0.5G" ->
  // "1/0.5"), que es como queda guardado el catálogo -- confirmado en datos
  // reales de producción (2026-10-02): "AMPICILINA SODICA + SULBACTAM
  // SODICO... 1.5G VIAL" nunca coincidía con "AMPICILINA+SULBACTAM
  // 1G+0.5G..." aunque fuera exactamente el mismo producto. No se adivina
  // CÓMO se divide la dosis total entre los principios (no se asume ningún
  // reparto) -- solo se confirma que el total coincide, suficiente para
  // ofrecerlo a revisión humana antes de cotizar.
  if (targetUnit === candidateUnit && !targetUnit.includes("/")) {
    const targetSum = target.concentration.includes("/") ? sumOfSplitDose(target.concentration) : null;
    const candidateSum = candidate.concentration.includes("/") ? sumOfSplitDose(candidate.concentration) : null;
    if (targetSum !== null && !candidate.concentration.includes("/")) {
      const candidateValue = Number.parseFloat(candidate.concentration);
      if (Number.isFinite(candidateValue) && Math.abs(targetSum - candidateValue) < 0.01) return true;
    }
    if (candidateSum !== null && !target.concentration.includes("/")) {
      const targetValue = Number.parseFloat(target.concentration);
      if (Number.isFinite(targetValue) && Math.abs(candidateSum - targetValue) < 0.01) return true;
    }
  }

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
