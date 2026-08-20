import { z } from "zod";
import { getAIProvider } from "@/lib/ai/provider";
import type { MatchDecision, ScoredCandidate } from "@/lib/matching/types";

const aiResponseSchema = z.object({
  decision: z.enum(["MATCH", "REVIEW", "NO_MATCH"]),
  confidence: z.number().min(0).max(1),
  candidateId: z.string().nullable(),
  reasons: z.array(z.string()),
});

export interface AiJudgeResult {
  decision: MatchDecision;
  confidence: number;
  candidateId: string | null;
  reasons: string[];
}

/**
 * Usa IA únicamente para desempatar entre candidatos ya filtrados por reglas
 * determinísticas. Nunca se le pide calcular nada ni se le da acceso a toda la
 * base de datos. Si la IA no está configurada, falla la red, o la respuesta no
 * es JSON válido con la forma esperada, devuelve null: el llamador debe quedarse
 * con la decisión determinística (REVIEW) en vez de confiar ciegamente en esto.
 */
export async function judgeWithAI(
  requestedText: string,
  candidates: ScoredCandidate[],
): Promise<AiJudgeResult | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.product.id} | ${c.product.standardName} | ${c.product.concentration}${c.product.concentrationUnit} | ${c.product.dosageForm} | x${c.product.presentationQuantity} ${c.product.presentationUnit}`,
    )
    .join("\n");

  const prompt = `PRODUCTO SOLICITADO POR EL CLIENTE:
"${requestedText}"

CANDIDATOS (ya filtrados por el mismo principio activo o un sinónimo controlado):
${candidateList}

Responde EXCLUSIVAMENTE con un JSON con esta forma exacta, sin texto adicional ni explicación fuera del JSON:
{"decision": "MATCH" | "REVIEW" | "NO_MATCH", "confidence": <número entre 0 y 1>, "candidateId": "<id del candidato elegido, o null si ninguno>", "reasons": ["..."]}

Reglas estrictas:
- Nunca elijas MATCH si la concentración del candidato no coincide exactamente con la solicitada.
- Si tienes cualquier duda razonable, responde REVIEW en vez de MATCH.
- No inventes candidatos que no estén en la lista.`;

  let rawText: string;
  try {
    const provider = getAIProvider();
    const result = await provider.complete({
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente que compara productos farmacéuticos para homologación. Respondes solo JSON válido, nunca inventas información ni candidatos.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });
    rawText = result.text;
  } catch {
    return null;
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const parsed = aiResponseSchema.safeParse(parsedJson);
  if (!parsed.success) return null;

  if (parsed.data.candidateId !== null && !candidates.some((c) => c.product.id === parsed.data.candidateId)) {
    return null; // la IA "inventó" un candidato que no le dimos: se descarta la respuesta entera
  }

  return parsed.data;
}
