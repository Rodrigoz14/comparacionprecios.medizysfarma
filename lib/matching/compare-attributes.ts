import type { AttributeComparison, CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

/**
 * Formas líquidas donde "X%" (peso/volumen) equivale a X*10 mg/mL — la
 * convención real de gotas oftálmicas y otras soluciones (confirmado en
 * datos reales: Disfarma/Ramédicas escriben "5MG/ML (0.5%)" para el mismo
 * producto). No aplica a sólidos/semisólidos (cremas, geles), donde "X%"
 * significa peso/peso (X g por 100g) y por eso el catálogo ya lo guarda
 * directamente en G sin necesitar conversión. "Inyectable"/"Ampolla" se
 * agregaron por un bug real (2026-10-05): "CLINDAMICINA (15%) SOLUCION
 * INYECTABLE 600 MG/4 ML" de un cliente nunca coincidía con "CLINDAMICINA
 * 600MG/4ML (150MG/ML) SOLUCION INYECTABLE" del catálogo -- misma
 * concentración real (600mg/4ml = 150mg/ml = 15%), solo que cada uno la
 * escribió con su propio valor "equivalente". Es la misma conversión segura
 * de tasa (tanto "%" como "MG/ML" ya son una RAZÓN, nunca el contenido
 * TOTAL de una ampolla) -- no tiene nada que ver con la ambigüedad de
 * Enoxaparina (eso es sobre REDUCIR una razón a "por 1 unidad", perdiendo el
 * volumen real; esto es solo cambiar de unidad sin tocar el volumen).
 */
const PERCENT_TO_MG_PER_ML_FORMS = new Set(["Solución", "Gotas", "Suspensión", "Jarabe", "Inyectable", "Ampolla"]);

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

    // Ambos son combinados de las mismas partes (mismo conteo, mismo orden --
    // siempre se ordenan alfabéticamente por principio en extract-attributes.ts),
    // pero un proveedor escribió un decimal con más o menos ceros que el otro
    // ("0.5/0.25" vs "0.50/0.25", la MISMA dosis) -- confirmado en datos reales
    // de cliente (2026-10-05, Ipratropio+Fenoterol): comparando como texto
    // nunca coincidían aunque fueran exactamente el mismo combinado.
    if (target.concentration.includes("/") && candidate.concentration.includes("/")) {
      const targetParts = target.concentration.split("/").map(Number.parseFloat);
      const candidateParts = candidate.concentration.split("/").map(Number.parseFloat);
      if (
        targetParts.length === candidateParts.length &&
        targetParts.every(
          (v, i) => Number.isFinite(v) && Number.isFinite(candidateParts[i]) && Math.abs(v - candidateParts[i]) < 0.01,
        )
      ) {
        return true;
      }
    }
  }

  // "2 MEQ" (denominador implícito 1, ver extract-attributes.ts -- un
  // proveedor que solo pone "2MEQ" sin "/ML" explícito) y "20/10 MEQ/ML"
  // (razón explícita de otro proveedor, misma tasa real: 20/10 = 2) son la
  // MISMA concentración -- mismo razonamiento que %<->MG/ML más abajo, pero
  // para miliequivalentes. Bug real confirmado (2026-10-07): "CLORURO DE
  // POTASIO 2EMQ/ML..." de un cliente solo encontraba la oferta de Disfarma
  // que coincidía por texto exacto ("2 MEQ"), nunca la de Ramédicas/
  // Ofimédicas (guardada como "20 mEq /10mL", la MISMA tasa real pero hasta
  // 30 veces más barata), porque nunca se comparaban como número.
  //
  // A propósito NO se incluye "UI" en esta misma regla: a diferencia de MEQ
  // (siempre una tasa real en este catálogo), "UI" sí puede ser el
  // contenido TOTAL de un vial sin ninguna razón de volumen implícita (p.
  // ej. "Penicilina Benzatínica 1.200.000 UI", un polvo para reconstituir
  // sin tasa alguna) -- tratar ese total como "por 1 ml" sería la misma
  // ambigüedad de Enoxaparina que ya se investigó y se descartó.
  const RATE_UNITS = new Set(["MEQ"]);
  const asRatePerMl = (value: string, unit: string): { base: string; rate: number } | null => {
    const isRatio = unit.endsWith("/ML");
    const base = isRatio ? unit.slice(0, -3) : unit;
    if (!RATE_UNITS.has(base)) return null;
    if (!isRatio) {
      const v = Number.parseFloat(value);
      return Number.isFinite(v) ? { base, rate: v } : null;
    }
    const [rawNum, rawDen] = value.split("/");
    const num = Number.parseFloat(rawNum);
    const den = rawDen !== undefined ? Number.parseFloat(rawDen) : 1;
    return Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? { base, rate: num / den } : null;
  };
  const targetRate = asRatePerMl(target.concentration, targetUnit);
  const candidateRate = asRatePerMl(candidate.concentration, candidateUnit);
  if (targetRate && candidateRate && targetRate.base === candidateRate.base) {
    return Math.abs(targetRate.rate - candidateRate.rate) < 0.001;
  }

  if (!PERCENT_TO_MG_PER_ML_FORMS.has(candidate.dosageForm)) return false;

  const asMgPerMl = (value: string, unit: string): number | null => {
    // Una forma sellada guarda el valor SIN reducir ("600/4", el contenido
    // TOTAL de esa ampolla puntual, ver extract-attributes.ts) -- hay que
    // dividir para obtener la tasa mg/ml antes de comparar, en vez de
    // truncar en el "/" (Number.parseFloat("600/4") da 600, no 150).
    const parsed = value.includes("/")
      ? (() => {
          const [numerator, denominator] = value.split("/").map((p) => Number.parseFloat(p));
          return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
            ? numerator / denominator
            : NaN;
        })()
      : Number.parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    // "MG/ML" es la unidad que extractProductAttributes() deja tras reducir
    // una razón dosis/volumen ("3MG/ML" de una concentración con "/ML"
    // explícito) -- ya es mg por ml, igual que un "MG" simple (bug real
    // confirmado 2026-10-05: Gentamicina oftálmica "3 MG/ML" de un cliente
    // nunca coincidía con "0,3%" del catálogo porque esta función solo
    // reconocía la unidad "MG" a secas, no "MG/ML").
    if (unit === "MG" || unit === "MG/ML") return parsed;
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
