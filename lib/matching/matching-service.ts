import { prisma } from "@/lib/db/client";
import { judgeWithAI } from "@/lib/matching/ai-judge";
import { searchCandidates } from "@/lib/matching/candidate-search";
import { compareAttributes } from "@/lib/matching/compare-attributes";
import { decideFromScore } from "@/lib/matching/decision";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey } from "@/lib/matching/normalize";
import { scoreComparison } from "@/lib/matching/score";
import type { MatchResult, ScoredCandidate } from "@/lib/matching/types";

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
  // No se exige presentación en lo que escribe un cliente: pide "cuántas
  // unidades", no "en caja de cuántas" — eso ya no es parte de la identidad
  // del medicamento (se compara por unidad en el motor de precios).
  const extraction = extractProductAttributes(rawText, { requirePresentation: false });
  if (!extraction) {
    return {
      decision: "NO_MATCH",
      confidence: 0,
      matchedProductIds: [],
      candidates: [],
      reasons: [`No se pudo determinar la concentración de "${rawText}".`],
      source: "none",
    };
  }

  const genericKey = buildGenericKey(extraction.attributes);
  const exactMatches = await prisma.product.findMany({ where: { genericKey, status: "ACTIVE" } });
  if (exactMatches.length > 0) {
    return {
      decision: "MATCH",
      confidence: 1,
      matchedProductIds: exactMatches.map((p) => p.id),
      candidates: [],
      reasons: ["Coincidencia exacta de ingrediente activo, concentración y forma farmacéutica."],
      source: "deterministic",
    };
  }

  const found = await searchCandidates(extraction.attributes);
  if (found.length === 0) {
    return {
      decision: "NO_MATCH",
      confidence: 0,
      matchedProductIds: [],
      candidates: [],
      reasons: ["No se encontró ningún producto con el mismo principio activo, ni con un sinónimo controlado conocido."],
      source: "deterministic",
    };
  }

  const scored: ScoredCandidate[] = found
    .map(({ product, viaSynonym, viaFuzzyMatch }) => {
      const comparison = compareAttributes(extraction.attributes, product);
      return {
        product,
        comparison,
        score: scoreComparison(comparison, !viaSynonym && !viaFuzzyMatch),
        viaSynonym,
        viaFuzzyMatch,
      };
    })
    .sort((a, b) => b.score - a.score);

  const fuzzyIngredientNote = scored.some((c) => c.viaFuzzyMatch)
    ? [
        `No se encontró "${extraction.attributes.activeIngredient}" tal cual en el catálogo; se muestran principios activos con escritura parecida por si hubo un error de tipeo — confírmalo antes de cotizar.`,
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
    const allExactIngredient = concentrationMatches.every((c) => !c.viaSynonym && !c.viaFuzzyMatch);

    if (distinctForms.size === 1 && allExactIngredient) {
      return {
        decision: "MATCH",
        confidence: 1,
        matchedProductIds: concentrationMatches.map((c) => c.product.id),
        candidates: scored.slice(0, 5),
        reasons: [
          `Única forma farmacéutica disponible para este principio activo y concentración: ${[...distinctForms][0]}.`,
        ],
        source: "deterministic",
      };
    }

    if (distinctForms.size >= 1) {
      const aiResult = await judgeWithAI(rawText, concentrationMatches.slice(0, 5));

      if (aiResult && aiResult.decision === "MATCH" && aiResult.candidateId) {
        const chosen = concentrationMatches.find((c) => c.product.id === aiResult.candidateId);
        if (chosen) {
          return {
            decision: "MATCH",
            confidence: aiResult.confidence,
            matchedProductIds: [chosen.product.id],
            candidates: scored.slice(0, 5),
            reasons: aiResult.reasons,
            source: "ai",
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
        candidates: scored.slice(0, 5),
        reasons: [...reasons, ...fuzzyIngredientNote],
        source: aiResult ? "ai" : "deterministic",
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
      candidates: scored.slice(0, 5),
      reasons: [describeMatch(best)],
      source: "deterministic",
    };
  }

  if (deterministicDecision === "NO_MATCH") {
    return {
      decision: "NO_MATCH",
      confidence: best.score,
      matchedProductIds: [],
      candidates: scored.slice(0, 5),
      reasons: [describeMatch(best), ...fuzzyIngredientNote],
      source: "deterministic",
    };
  }

  // REVIEW determinístico: se intenta desempatar con IA entre los candidatos
  // acotados, pero solo entre los que sí cumplen la concentración exacta (la
  // regla de la Sección 5.35 nunca se le delega a la IA).
  const eligibleForAI = scored.filter((c) => c.comparison.concentrationMatch).slice(0, 5);
  const aiResult = await judgeWithAI(rawText, eligibleForAI);

  if (aiResult && aiResult.decision === "MATCH" && aiResult.candidateId) {
    const chosen = eligibleForAI.find((c) => c.product.id === aiResult.candidateId);
    if (chosen && chosen.comparison.concentrationMatch) {
      return {
        decision: "MATCH",
        confidence: aiResult.confidence,
        matchedProductIds: [chosen.product.id],
        candidates: scored.slice(0, 5),
        reasons: aiResult.reasons,
        source: "ai",
      };
    }
  }

  if (aiResult && aiResult.decision === "NO_MATCH") {
    return {
      decision: "NO_MATCH",
      confidence: aiResult.confidence,
      matchedProductIds: [],
      candidates: scored.slice(0, 5),
      reasons: [...aiResult.reasons, ...fuzzyIngredientNote],
      source: "ai",
    };
  }

  return {
    decision: "REVIEW",
    confidence: best.score,
    matchedProductIds: [],
    candidates: scored.slice(0, 5),
    reasons: aiResult ? aiResult.reasons : [describeMatch(best), "Requiere revisión humana.", ...fuzzyIngredientNote],
    source: aiResult ? "ai" : "deterministic",
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
    },
  });

  return result;
}
