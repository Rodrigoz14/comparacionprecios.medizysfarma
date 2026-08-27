import { prisma } from "@/lib/db/client";
import { guessIngredientWithAI } from "@/lib/matching/ai-ingredient-guess";
import { judgeWithAI } from "@/lib/matching/ai-judge";
import type { CandidateSearchResult } from "@/lib/matching/candidate-search";
import { searchCandidates, searchCandidatesByIngredientText } from "@/lib/matching/candidate-search";
import { compareAttributes } from "@/lib/matching/compare-attributes";
import { decideFromScore } from "@/lib/matching/decision";
import { extractIngredientGuess, extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey } from "@/lib/matching/normalize";
import { scoreComparison } from "@/lib/matching/score";
import type { CandidateProduct, MatchResult, ScoredCandidate } from "@/lib/matching/types";

/**
 * Varios laboratorios pueden ofrecer el mismo genérico exacto (misma
 * presentación, distinto laboratorio) — mostrarlos todos como "opciones para
 * elegir" sería ruido, ya que el motor de precios los compara automáticamente
 * una vez se elige el genérico. Se conserva solo el mejor candidato por
 * genericKey, hasta un límite razonable, para que la lista de opciones que ve
 * el usuario represente variedad real (distintas formas/concentraciones), no
 * al mismo producto repetido por laboratorio — y para no truncar por
 * casualidad las opciones de un proveedor completo si superan el límite.
 */
function dedupeByGenericKey(scored: ScoredCandidate[], limit = 8): ScoredCandidate[] {
  const seen = new Set<string>();
  const result: ScoredCandidate[] = [];
  for (const c of scored) {
    if (seen.has(c.product.genericKey)) continue;
    seen.add(c.product.genericKey);
    result.push(c);
    if (result.length >= limit) break;
  }
  return result;
}

function toGuessCandidate(
  product: CandidateProduct,
  viaSubsetMatch = false,
  viaBrandMatch = false,
  viaAI = false,
): ScoredCandidate {
  return {
    product,
    comparison: { activeIngredientMatch: true, concentrationMatch: false, dosageFormMatch: false, presentationMatch: false },
    score: 0,
    viaSynonym: false,
    viaFuzzyMatch: false,
    viaSubsetMatch,
    viaBrandMatch,
    viaAI,
  };
}

/**
 * Último recurso antes de rendirse: nada encontró nada por texto, ni exacto
 * ni con ninguna de las tolerancias determinísticas. Se le pregunta a la IA a
 * qué principio activo real podría referirse (útil para texto muy mal
 * transcrito, más allá de lo que una letra de diferencia puede corregir), y
 * cada sugerencia se busca en el catálogo real con las mismas reglas de
 * siempre — si la IA no está configurada, la red falla, o ninguna sugerencia
 * encuentra nada real, se devuelve una lista vacía sin ningún efecto.
 */
async function tryAIFallback(rawText: string): Promise<CandidateSearchResult[]> {
  const guesses = await guessIngredientWithAI(rawText);
  for (const guess of guesses) {
    // La IA a veces separa los principios activos de un combinado con "/"
    // (p. ej. "fenoterol/bromuro de ipratropio"), que no calza con ningún
    // separador real del catálogo (espacio o "+"); se normaliza a espacio
    // para que la búsqueda por subconjunto de palabras sí lo reconozca.
    const normalizedGuess = guess.replace(/\//g, " ");
    const found = await searchCandidatesByIngredientText(normalizedGuess);
    if (found.length > 0) {
      return found.map((f) => ({ ...f, viaAI: true }));
    }
  }
  return [];
}

/**
 * No tiene sentido ofrecerle al cliente para elegir una opción que ningún
 * proveedor tiene en existencia — terminaría en un callejón sin salida. Se
 * excluyen los candidatos sin ninguna oferta activa y con existencia
 * confirmada (nunca se asume disponibilidad: "UNKNOWN" no cuenta como
 * confirmada, igual que en checkAvailability). Si filtrar dejara la lista
 * vacía, se prefiere mostrar las opciones sin confirmar antes que no mostrar
 * nada, dejándolo explícito en las razones.
 */
async function withStockNoted(candidates: ScoredCandidate[]): Promise<{ candidates: ScoredCandidate[]; note: string[] }> {
  if (candidates.length === 0) return { candidates, note: [] };
  const productIds = candidates.map((c) => c.product.id);
  const stocked = await prisma.supplierOffer.findMany({
    where: { productId: { in: productIds }, status: "ACTIVE", availability: "AVAILABLE" },
    select: { productId: true },
    distinct: ["productId"],
  });
  const stockedIds = new Set(stocked.map((s) => s.productId));
  const inStock = candidates.filter((c) => stockedIds.has(c.product.id));

  if (inStock.length > 0) return { candidates: inStock, note: [] };
  return {
    candidates,
    note: ["Ninguna de las opciones encontradas tiene existencia confirmada con algún proveedor por ahora; verifícalo antes de cotizar."],
  };
}

/**
 * Resuelve a qué producto(s) del catálogo corresponde un texto libre (lo que
 * escribió un cliente, o la descripción de un proveedor). Sigue la arquitectura
 * de la Sección 5: reglas determinísticas primero, IA solo para desempatar casos
 * ambiguos ya acotados, y validación determinística de lo que responda la IA.
 *
 * Ni el laboratorio ni la presentación son parte de la homologación: cuando hay
 * una coincidencia exacta de ingrediente + concentración + forma farmacéutica,
 * se devuelven TODOS los productos de esa clave genérica (cualquier presentación,
 * cualquier laboratorio); elegir el más barato entre ellos —comparando por
 * unidad, no por presentación— es responsabilidad del motor de precios, no de este.
 */
export async function resolveProductMatch(rawText: string): Promise<MatchResult> {
  const result = await resolveProductMatchCore(rawText);
  // Solo se filtra por existencia cuando se le está por ofrecer al cliente una
  // lista para ELEGIR (REVIEW, o NO_MATCH que igual muestra candidatos
  // cercanos): un MATCH ya es una decisión tomada, y si no hay existencia el
  // motor de precios lo informa con claridad más abajo (NO_STOCK) — filtrar
  // ahí escondería que sí se encontró el producto exacto.
  if (result.decision === "MATCH" || result.candidates.length === 0) return result;
  const { candidates, note } = await withStockNoted(result.candidates);
  return { ...result, candidates, reasons: [...result.reasons, ...note] };
}

async function resolveProductMatchCore(rawText: string): Promise<MatchResult> {
  // No se exige presentación en lo que escribe un cliente: pide "cuántas
  // unidades", no "en caja de cuántas" — eso ya no es parte de la identidad
  // del medicamento (se compara por unidad en el motor de precios).
  const extraction = extractProductAttributes(rawText, { requirePresentation: false });
  if (!extraction) {
    // No se pudo extraer una concentración (p. ej. el cliente escribió solo
    // "Ácido Valproico", sin decir cuál). En vez de terminar en NO_MATCH sin
    // más, se busca el ingrediente solo para poder mostrar qué concentraciones
    // existen en el catálogo y que el cliente elija — nunca se adivina cuál es.
    const ingredientGuess = extractIngredientGuess(rawText);
    let found: CandidateSearchResult[] = ingredientGuess ? await searchCandidatesByIngredientText(ingredientGuess) : [];

    if (found.length === 0) {
      found = await tryAIFallback(rawText);
    }

    if (found.length > 0) {
      const candidates = dedupeByGenericKey(
        found.map((f) => toGuessCandidate(f.product, f.viaSubsetMatch, f.viaBrandMatch, f.viaAI)),
      );
      const concentrations = [...new Set(found.map((f) => `${f.product.concentration}${f.product.concentrationUnit}`))];
      const viaFuzzy = found.some((f) => f.viaFuzzyMatch);
      const viaSubset = found.some((f) => f.viaSubsetMatch);
      const viaBrand = found.some((f) => f.viaBrandMatch);
      const viaAI = found.some((f) => f.viaAI);
      return {
        decision: "REVIEW",
        confidence: 0,
        matchedProductIds: [],
        candidates,
        reasons: [
          viaAI
            ? `No se encontró "${rawText}" con las reglas normales; la IA sugirió un principio activo posible y estas opciones sí existen en el catálogo — confírmalo antes de cotizar.`
            : viaBrand
              ? `"${ingredientGuess}" no coincide con ningún principio activo, pero sí con el nombre comercial de estas opciones — confírmalo antes de cotizar.`
              : `No se especificó la concentración de "${ingredientGuess}". Concentraciones disponibles: ${concentrations.join(", ")}. Elige la opción correcta.`,
          ...(viaFuzzy
            ? [`Se muestran principios activos con escritura parecida a "${ingredientGuess}" por si hubo un error de tipeo — confírmalo antes de cotizar.`]
            : []),
          ...(viaSubset
            ? [`Se muestran combinados que incluyen "${ingredientGuess}" junto con otros principios activos adicionales — confírmalo antes de cotizar.`]
            : []),
        ],
        source: viaAI ? "ai" : "deterministic",
        requestedPresentationQuantity: null,
      };
    }

    return {
      decision: "NO_MATCH",
      confidence: 0,
      matchedProductIds: [],
      candidates: [],
      reasons: [`No se pudo determinar la concentración de "${rawText}".`],
      source: "none",
      requestedPresentationQuantity: null,
    };
  }

  // Tamaño de envase que el cliente pidió explícitamente (p. ej. "30" de
  // "jarabe X 30ML"), si lo dijo. Null si no especificó ninguno.
  const requestedPresentationQuantity = extraction.presentationSpecified
    ? extraction.attributes.presentationQuantity
    : null;

  const genericKey = buildGenericKey(extraction.attributes);
  const exactMatches = await prisma.product.findMany({ where: { genericKey, status: "ACTIVE" } });
  if (exactMatches.length > 0) {
    // Cuando el cliente pidió un tamaño de envase específico, se prefiere ese
    // producto exacto como matchedProductId[0] (el que se muestra como "el
    // producto homologado") -- el motor de precios igual compara TODA la
    // familia de genericKey por costo total, esto solo mejora cuál se
    // muestra como referencia principal.
    const ordered =
      requestedPresentationQuantity !== null
        ? [...exactMatches].sort((a, b) => {
            const aMatch = a.presentationQuantity === requestedPresentationQuantity ? 0 : 1;
            const bMatch = b.presentationQuantity === requestedPresentationQuantity ? 0 : 1;
            return aMatch - bMatch;
          })
        : exactMatches;
    return {
      decision: "MATCH",
      confidence: 1,
      matchedProductIds: ordered.map((p) => p.id),
      candidates: [],
      reasons: ["Coincidencia exacta de ingrediente activo, concentración y forma farmacéutica."],
      source: "deterministic",
      requestedPresentationQuantity,
    };
  }

  let found = await searchCandidates(extraction.attributes);
  if (found.length === 0) {
    // Nada por ninguna regla determinística (ni exacto, ni sinónimo, ni typo,
    // ni subconjunto, ni marca): último recurso, preguntarle a la IA a qué
    // principio activo real podría referirse un texto muy mal escrito o mal
    // transcrito, y verificar esa sugerencia contra el catálogo real.
    found = await tryAIFallback(rawText);
  }
  if (found.length === 0) {
    return {
      decision: "NO_MATCH",
      confidence: 0,
      matchedProductIds: [],
      candidates: [],
      reasons: ["No se encontró ningún producto con el mismo principio activo, ni con un sinónimo controlado conocido."],
      source: "deterministic",
      requestedPresentationQuantity,
    };
  }

  const scored: ScoredCandidate[] = found
    .map(({ product, viaSynonym, viaFuzzyMatch, viaSubsetMatch, viaBrandMatch, viaAI }) => {
      const comparison = compareAttributes(extraction.attributes, product);
      return {
        product,
        comparison,
        score: scoreComparison(comparison, !viaSynonym && !viaFuzzyMatch && !viaSubsetMatch && !viaBrandMatch && !viaAI),
        viaSynonym,
        viaFuzzyMatch,
        viaAI,
        viaSubsetMatch,
        viaBrandMatch,
      };
    })
    .sort((a, b) => b.score - a.score);

  const fuzzyIngredientNote = scored.some((c) => c.viaFuzzyMatch)
    ? [
        `No se encontró "${extraction.attributes.activeIngredient}" tal cual en el catálogo; se muestran principios activos con escritura parecida por si hubo un error de tipeo — confírmalo antes de cotizar.`,
      ]
    : [];

  const subsetIngredientNote = scored.some((c) => c.viaSubsetMatch)
    ? [
        `No se encontró "${extraction.attributes.activeIngredient}" tal cual en el catálogo; se muestran combinados que lo incluyen junto con otros principios activos adicionales — confírmalo antes de cotizar.`,
      ]
    : [];

  const brandMatchNote = scored.some((c) => c.viaBrandMatch)
    ? [
        `"${extraction.attributes.activeIngredient}" no coincide con ningún principio activo; se muestran productos cuyo nombre comercial se le parece — confírmalo antes de cotizar.`,
      ]
    : [];

  const aiMatchNote = scored.some((c) => c.viaAI)
    ? [
        `No se encontró "${extraction.attributes.activeIngredient}" con las reglas normales; la IA sugirió un principio activo posible y estas opciones sí existen en el catálogo — confírmalo antes de cotizar.`,
      ]
    : [];

  // El cliente no siempre dice la forma farmacéutica ("Ácido Valproico 250mg",
  // sin decir cápsula/jarabe/tableta). No especificarla no es lo mismo que una
  // forma distinta: no se debe puntuar igual que un mismatch real, porque eso
  // hunde el puntaje por debajo del umbral de revisión y termina en NO_MATCH
  // aunque el producto sí exista (el bug reportado por el cliente). Tampoco se
  // puede elegir la forma a ciegas: cápsula, jarabe y tableta no son
  // intercambiables, así que si hay más de una disponible, es ambiguo de
  // verdad y debe pasar por el mismo desempate con IA / revisión humana que
  // cualquier otro caso ambiguo — nunca se adivina.
  if (extraction.attributes.dosageForm === "No especificada") {
    const concentrationMatches = scored.filter((c) => c.comparison.concentrationMatch);
    const distinctForms = new Set(concentrationMatches.map((c) => c.product.dosageForm));
    // El atajo de "una sola forma disponible -> MATCH automático" solo es seguro
    // si el ingrediente se identificó con certeza (texto exacto): si vino por
    // sinónimo o por tolerancia a typos, la identidad del principio activo ya
    // es incierta y no se debe sumar una segunda suposición (la forma) encima.
    const allExactIngredient = concentrationMatches.every(
      (c) => !c.viaSynonym && !c.viaFuzzyMatch && !c.viaSubsetMatch && !c.viaBrandMatch && !c.viaAI,
    );

    if (distinctForms.size === 1 && allExactIngredient) {
      return {
        decision: "MATCH",
        confidence: 1,
        matchedProductIds: concentrationMatches.map((c) => c.product.id),
        candidates: dedupeByGenericKey(concentrationMatches),
        reasons: [
          `Única forma farmacéutica disponible para este principio activo y concentración: ${[...distinctForms][0]}.`,
        ],
        source: "deterministic",
        requestedPresentationQuantity,
      };
    }

    if (distinctForms.size >= 1) {
      const aiResult = await judgeWithAI(rawText, dedupeByGenericKey(concentrationMatches));

      if (aiResult && aiResult.decision === "MATCH" && aiResult.candidateId) {
        const chosen = concentrationMatches.find((c) => c.product.id === aiResult.candidateId);
        if (chosen) {
          return {
            decision: "MATCH",
            confidence: aiResult.confidence,
            matchedProductIds: [chosen.product.id],
            candidates: dedupeByGenericKey(concentrationMatches),
            reasons: aiResult.reasons,
            source: "ai",
            requestedPresentationQuantity,
          };
        }
      }

      const reasons = aiResult
        ? aiResult.reasons
        : distinctForms.size > 1
          ? [
              `El cliente no especificó la forma farmacéutica y hay varias disponibles (${[...distinctForms].join(", ")}); requiere revisión.`,
            ]
          : [`Se encontró una única forma farmacéutica (${[...distinctForms][0]}), pero el ingrediente no es una coincidencia exacta; requiere revisión.`];

      return {
        decision: "REVIEW",
        confidence: concentrationMatches[0].score,
        matchedProductIds: [],
        candidates: dedupeByGenericKey(concentrationMatches),
        reasons: [...reasons, ...fuzzyIngredientNote, ...subsetIngredientNote, ...brandMatchNote, ...aiMatchNote],
        source: aiResult ? "ai" : "deterministic",
        requestedPresentationQuantity,
      };
    }
    // distinctForms.size === 0: ningún candidato coincide en concentración;
    // sigue el flujo normal más abajo (terminará en NO_MATCH o REVIEW).
  }

  const best = scored[0];
  const deterministicDecision = decideFromScore(best.score, best.comparison.concentrationMatch);

  if (deterministicDecision === "MATCH") {
    const tied = scored.filter(
      (c) => c.score === best.score && c.comparison.concentrationMatch === best.comparison.concentrationMatch,
    );
    return {
      decision: "MATCH",
      confidence: best.score,
      matchedProductIds: tied.map((c) => c.product.id),
      candidates: dedupeByGenericKey(scored),
      reasons: [describeMatch(best)],
      source: "deterministic",
      requestedPresentationQuantity,
    };
  }

  if (deterministicDecision === "NO_MATCH") {
    return {
      decision: "NO_MATCH",
      confidence: best.score,
      matchedProductIds: [],
      candidates: dedupeByGenericKey(scored),
      reasons: [describeMatch(best), ...fuzzyIngredientNote, ...subsetIngredientNote, ...brandMatchNote, ...aiMatchNote],
      source: "deterministic",
      requestedPresentationQuantity,
    };
  }

  // REVIEW determinístico: se intenta desempatar con IA entre los candidatos
  // acotados, pero solo entre los que sí cumplen la concentración exacta (la
  // regla de la Sección 5.35 nunca se le delega a la IA).
  const eligibleForAI = dedupeByGenericKey(scored.filter((c) => c.comparison.concentrationMatch));
  const aiResult = await judgeWithAI(rawText, eligibleForAI);

  if (aiResult && aiResult.decision === "MATCH" && aiResult.candidateId) {
    const chosen = eligibleForAI.find((c) => c.product.id === aiResult.candidateId);
    if (chosen && chosen.comparison.concentrationMatch) {
      return {
        decision: "MATCH",
        confidence: aiResult.confidence,
        matchedProductIds: [chosen.product.id],
        candidates: dedupeByGenericKey(scored),
        reasons: aiResult.reasons,
        source: "ai",
        requestedPresentationQuantity,
      };
    }
  }

  if (aiResult && aiResult.decision === "NO_MATCH") {
    return {
      decision: "NO_MATCH",
      confidence: aiResult.confidence,
      matchedProductIds: [],
      candidates: dedupeByGenericKey(scored),
      reasons: [...aiResult.reasons, ...fuzzyIngredientNote, ...subsetIngredientNote, ...brandMatchNote, ...aiMatchNote],
      source: "ai",
      requestedPresentationQuantity,
    };
  }

  return {
    decision: "REVIEW",
    confidence: best.score,
    matchedProductIds: [],
    candidates: dedupeByGenericKey(scored),
    reasons: aiResult ? aiResult.reasons : [describeMatch(best), "Requiere revisión humana.", ...fuzzyIngredientNote, ...subsetIngredientNote, ...brandMatchNote, ...aiMatchNote],
    source: aiResult ? "ai" : "deterministic",
    requestedPresentationQuantity,
  };
}

function describeMatch(candidate: ScoredCandidate): string {
  const { comparison } = candidate;
  const parts: string[] = [];
  parts.push(comparison.concentrationMatch ? "misma concentración" : "concentración distinta");
  parts.push(comparison.dosageFormMatch ? "misma forma farmacéutica" : "forma farmacéutica distinta");
  parts.push(comparison.presentationMatch ? "misma presentación" : "presentación distinta");
  return `Mejor candidato: ${candidate.product.standardName} (${parts.join(", ")}).`;
}

export async function resolveCustomerRequestItem(customerRequestItemId: string): Promise<MatchResult> {
  const item = await prisma.customerRequestItem.findUniqueOrThrow({
    where: { id: customerRequestItemId },
  });

  const result = await resolveProductMatch(item.originalText);

  await prisma.customerRequestItem.update({
    where: { id: customerRequestItemId },
    data: {
      matchStatus: result.decision,
      matchConfidence: result.confidence,
      matchedProductId: result.matchedProductIds[0] ?? null,
      requestedPresentationQuantity: result.requestedPresentationQuantity,
    },
  });

  return result;
}
