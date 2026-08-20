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
 * El laboratorio nunca es parte de la homologación: cuando hay una coincidencia
 * exacta de ingrediente + concentración + forma + presentación, se devuelven
 * TODOS los productos de esa clave genérica (uno por laboratorio); elegir el más
 * barato entre ellos es responsabilidad del motor de precios, no de este.
 */
export async function resolveProductMatch(rawText: string): Promise<MatchResult> {
  const extraction = extractProductAttributes(rawText);
  if (!extraction) {
    return {
      decision: "NO_MATCH",
      confidence: 0,
      matchedProductIds: [],
      candidates: [],
      reasons: [`No se pudo determinar la concentración y/o la presentación de "${rawText}".`],
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
      reasons: ["Coincidencia exacta de ingrediente activo, concentración, forma farmacéutica y presentación."],
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
    .map(({ product, viaSynonym }) => {
      const comparison = compareAttributes(extraction.attributes, product);
      return { product, comparison, score: scoreComparison(comparison, !viaSynonym) };
    })
    .sort((a, b) => b.score - a.score);

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
      reasons: [describeMatch(best)],
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
      reasons: aiResult.reasons,
      source: "ai",
    };
  }

  return {
    decision: "REVIEW",
    confidence: best.score,
    matchedProductIds: [],
    candidates: scored.slice(0, 5),
    reasons: aiResult ? aiResult.reasons : [describeMatch(best), "Requiere revisión humana."],
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
